# MDP test suite (`node --test`, dependency-free)

A standing regression suite built on Node's **built-in** test runner — no npm, no dependency to
install (consistent with MDP's dependency-free design, SPEC-design §0). It replaces the
throwaway `.mjs` harnesses used during Stages 5–9 with durable tests, closing tasks
**0.7 / 1.6 / 5.8 / 7.6** and giving Stage 11.3 ("run the full test suite against the production
DB") an actual suite to run.

## Run it

One command (from the repo, path adjusted to your shell):

```
node app/run-tests.mjs
```

`run-tests.mjs` drives Node's test runner programmatically over every `test/*.test.mjs` file.
It prints a plain final line, e.g. `==== MDP test summary: 38 passed, 0 failed, across 6 files ====`,
and exits non-zero on any failure. (A one-line copy is also written to `app/.last-test-summary.txt`,
handy when a wrapping shell truncates captured stdout on Windows.)

A single file can still be run directly:

```
node --test "app/test/engine.test.mjs"
```

> Note: `node --test app/test/` (a bare directory) and quoted globs are unreliable on this
> Windows + Node 24 setup — hence the small runner script.

## Safety

Every DB-backed test calls `useTempDb()` **before** importing any server module. That points
`config.dbPath` (via `DB_PATH`) at a fresh throwaway SQLite file in the OS temp dir and refuses
any path ending in `mdp.db` / `mdp-sample.db`. The real database and the sample database are never
opened. Each file runs in its own process, so there's no cross-file state leakage, and each closes
its connection in an `after()` hook (`closeDb()`), which also lets the process exit cleanly.

## Coverage

| File | Module under test | What it proves (SPEC tasks) |
|---|---|---|
| `engine.test.mjs` | `server/engine.js` | line = snapshot × qty, Σ totals, integer-pence (no float drift), edge rounding — **5.4** |
| `estimates.test.mjs` | `server/repo/estimates.js` | JIRA unique/mandatory validation, scoped line-add + snapshot, rowVersion concurrency, scope-lock, clone, archive hide/surface, CANCELLED guards, TCS/FTE split — **5.1/5.3/5.5, 6.2, 9.7, 9.10** |
| `menucards.test.mjs` | `server/repo/menucards.js` | single-ACTIVE activation transaction, reactivate, guarded delete (ACTIVE/referenced), scoped catalogue sort — **1.4/3.6, 3.10/3.11, 4.1** |
| `audit.test.mjs` | `server/repo/audit.js` | append-only (no mutating export), action/user/date-range filters, distinct users — **8.1–8.4** |
| `flow.test.mjs` | `server/repo/flow.js` | throughput, cycle time, aging, run-rate, filter, compare — **9.4–9.6** |
| `crypto-util.test.mjs` | `server/crypto-util.js` | scrypt salt/verify/reject/tamper — **2.1** |

Fixtures live in `helpers.mjs` (`useTempDb`, `insertMenuCard`, the real MQ XL golden values).
