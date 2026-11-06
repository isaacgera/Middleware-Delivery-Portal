# Middleware Delivery Portal (MDP) — Session Log

Running log of work across sessions. Newest entries at the top. Companion to the SPEC trilogy
(`SPEC-requirements.md`, `SPEC-design.md`, `SPEC-tasks.md`) and the backlog row in `Ideas.md`.

---

## 2026-11-06 (later x3) — Feature 9.12: on-screen Menu Card creation (Quick Spec → built, code-complete)

Built the on-screen Menu Card creation feature as a Quick Spec. **Decisions (Isaac):** calculator
mode with editable computed fields; the yearly **rates are editable on the version header** (they
change ~annually); Scope **A** (full form builder), structured to leave room for **C**
(import-then-edit) later; new **`MENUCARD_CREATE`** audit action.

### What was built
- **`server/menucard-calc.js`** — cost helper deriving the six values from PD + rates
  (USP=PD×2, ATOM=PD×1, USP Cost=USP×blendedRate, Overhead=USP Cost×overhead%, Total=sum),
  **integer-pence** (no float drift, mirrors engine.js). Golden MQ XL verified (PD 54 → USP 108 /
  ATOM 54 / 6000.48 / 2400.19 / 8400.67). Preview-only: the route stores submitted values verbatim
  (so admin overrides — e.g. "Test Only" £144 rows — survive; MDP never recomputes stored variants).
- **`POST /api/menucards`** (admin-only, `routes/menucard-routes.js`) — validates the header (label,
  FY, blendedUspRate, overheadPct, peopleDayRate) + each variant (component/size enums, description,
  six numeric values, **duplicate Component+Size+Description guard**), calls the existing
  `createDraftVersion(...)` to stage a DRAFT (no `.xlsx`; `hasFile=false`), writes `MENUCARD_CREATE`.
  Reuses the single-ACTIVE activation + DRAFT lifecycle unchanged.
- **Frontend** (`web/views/menucards.js`) — a collapsible "Create new" panel beside the import card:
  editable rate header + an add/remove **variant grid**; each row takes Component/Size/description/PD
  and shows live-computed USP/ATOM/TCS/FTE/Total (client mirror of the cost helper), **every value
  editable** for overrides; changing a rate re-previews rows; saves → DRAFT → activate in the
  Versions list. Small CSS added (header grid + variant table).
- **`MENUCARD_CREATE`** added to `constants.js` AuditAction.
- **Tests:** `test/menucard-calc.test.mjs` (+6) — cost golden/small/zero/£144, DRAFT staging,
  override-preserved, created-DRAFT activates. **Suite 38 → 44, all green.**

### Verified
`node --check` clean on all changed/new JS; **44/44** `node --test`. Cost golden match confirmed
independently. **Browser sign-off pending from Isaac** (serve locally, Menu Cards tab → "Create new"
→ add rows, watch costs compute, save DRAFT, activate). Import path untouched.

### Status
**9.12 code-complete, awaiting browser sign-off.** Independent of the BT deployment. Tracked future
still open: 9.11 import pipeline; Entra ID 2.7; lower-value a11y polish.

---

## 2026-11-06 (later still) — a11y: modal focus-trap (closes the highest-value deferred Stage-10 item)

While deployment waits on the BT server, picked off an independent, session-completable feature:
the **modal focus-trap** — the top deferred should-fix from the Pre-Live audit (10.6).

### What was built
- New reusable **`trapFocus(host, dialog, remove)`** helper in `web/views/estimates.js`:
  - Tab / Shift+Tab **cycle within** the open dialog (wrap at both ends).
  - **Escape** closes the modal.
  - Focus **moves into** the dialog on open (first field, else the dialog itself).
  - Focus is **restored to the triggering control** on close (keyboard users aren't dumped at the
    top of the page).
  - Returns a wrapped `close()` that tears down the key handler + restores focus.
- Wired both modals to it: **Add Request** (`openNewRequestDialog`) and **Edit details**
  (`openEditDialog`). Existing Cancel-button + backdrop-click closers reuse the wrapped `close`.

### Verified
`node --check` clean on estimates.js; **38/38** tests still pass (frontend-only change). Browser
keyboard check recommended at next sign-off (Tab can't leave the modal; Esc closes; focus returns
to the opener). Review file + SPEC-tasks updated; remaining deferred a11y items are all lower-value.

---

## 2026-11-06 (later) — Deployment prep artifacts (deploy/ folder) — ready for the BT-side go-live

With CI green on all three remotes, prepped the concrete deployment artifacts so the BT-side steps
(11.5 + the rest of 11.8) are copy-paste rather than figure-it-out. All verified locally where
possible; execution is still on the BT server.

### Added `deploy/` folder
- **`README.md`** — order of operations + the app's run facts (`node server/server.js`, loopback
  `127.0.0.1:4000`, env vars, SIGINT/SIGTERM, `/api/health`).
- **`nginx-mdp.conf`** — nginx TLS termination + reverse proxy to loopback; HTTP→HTTPS redirect;
  X-Forwarded-Proto; 20 MB upload headroom; health-probe location.
- **`iis-web.config-notes.md`** — the IIS + **ARR** equivalent (URL Rewrite rules, enable-proxy,
  the `HTTP_X_FORWARDED_PROTO` server-variable gotcha, 20 MB request limit). BT is Windows so this
  is the likely path.
- **`mdp.env.sample`** — production `.env` template: `NODE_ENV=production` (→ Secure cookie),
  `SESSION_SECRET` with a one-line generator, loopback HOST/PORT, idle timeout, encrypted-volume
  DB/doc paths.
- **`run-as-service-windows.md`** — boot-start + restart-on-crash via **NSSM** (recommended) or
  Task Scheduler; health-check verification; logging.
- **`backup-mdp.cmd`** — Task Scheduler wrapper: runs `backup-db.mjs --verify` (non-zero exit on
  failure) then copies the newest snapshot to an off-box share.

### Verified
`backup-db.mjs --verify` re-run (exit 0, lossless). YAML/config files hand-checked (no tabs, valid
structure). DEPLOYMENT.md §0 checklist now points at these ready-made files; SPEC-tasks 11.5 → `[~]`
(prep done, BT execution remaining).

### Remaining (unchanged) — BT-side
Provision the server (Node 22+, encrypted volume, `.env`, change seeded passwords, service, backup
schedule) → reverse proxy + TLS → smoke-test → 12.2 e2e → 12.4 sign-off → Built.

---

## 2026-11-06 — Installability (install-only PWA, NOT offline) + git repo init (pre-push)

Picking up the BT-side deployment thread. Before pushing to GitLab, Isaac asked for MDP to be
**installable**. Added it deliberately as **install-only, not offline-first** — MDP is a shared-data
server-backed app (SPEC-design §1 "not local-first, not a PWA"), so caching data would risk stale
estimates across users.

### What was added
- **`web/manifest.webmanifest`** — name/short_name/description, `display: standalone`,
  `theme_color #0a66c2`, `background_color #f6f7f9`, the four existing icons (192/512 + maskable).
- **`web/sw.js`** — a deliberately conservative service worker: **never caches or intercepts
  `/api/…`** (always live); static shell is **network-first** (fresh when online, cached copy only
  as a fallback on a network blip); non-GET + cross-origin bypass entirely. `CACHE_NAME = mdp-shell-v1`
  (bump on front-end release). It exists to meet the install bar, not to run offline.
- **`index.html`** — `<link rel="manifest">`, `theme-color`, icon + apple-touch-icon links.
- **`app.js`** — fire-and-forget `navigator.serviceWorker.register('/sw.js')` on load (non-fatal if
  unsupported; needs a secure context — localhost in dev, HTTPS in prod).
- **`server/static.js`** — added the `.webmanifest` MIME type (`application/manifest+json`).
- Copied the four `icon-*.png` from `app/` into `app/web/` (must be under the served web root).
- **SPEC-requirements NFR9** updated to record the install-only (not-offline) stance so it's not a
  future contradiction.

### Verified
Test suite still **38/38**; manifest JSON validates; `node --check` clean on app.js / sw.js /
static.js. **Install VERIFIED by Isaac (2026-11-06):** ran `node server/server.js` locally, opened
http://127.0.0.1:4000 in the browser, and successfully **installed MDP as a desktop app** (own
window, Start-menu entry). Confirms the install-only PWA works end-to-end. (Clarified for Isaac:
PWA install is a browser feature over a *running* server — local now, BT server for the team later;
it is independent of the GitLab/GitHub repos, which are just code storage.)

### Git repo initialised (local) — ready to push
- `git init` in the MDP root; added a **root `.gitignore`** (belt-and-braces over app/ + parked
  stack): excludes `.env`, `**/data/`, `*.db*`, `**/node_modules/`, `.last-test-summary.txt`, build
  output, OS cruft.
- **Dry-run verified clean**: no `.env`, no `.db`, no `node_modules` in the tracked set — only
  `.env.example` templates, source, tests, docs, SPEC trilogy, CI, and the vendored jsPDF.
- **Initial commit `9b8f212`** on branch `master`, 112 files, working tree clean. *(NOTE: this
  commit predates the installability files above — a follow-up commit will include them before push.)*

### Remaining (unchanged, BT-side) + the push
- **Push:** create empty projects on **BT Team GitLab**, **Personal GitLab**, and **GitHub** (no
  auto-README), add remotes, push `main`. Needs Isaac's credentials/SSO — Forjé provides the exact
  commands; Isaac runs them. (BT Zscaler may force SSH over HTTPS for git — fall back to SSH if the
  HTTPS push throws a TLS error.)
- Then: 11.8 provision → 11.5 deploy+TLS → 12.2 e2e → 12.4 sign-off → Built. See DEPLOYMENT.md §0.

### UPDATE (2026-11-06, same session) — pushed to all 3 remotes + BT CI GREEN
- **Local git:** branch renamed `master`→**`main`**; remotes `team` (BT Team), `personal` (BT
  personal), `github` (`isaacgera/Middleware-Delivery-Portal`), plus an **`all`** remote with all
  three push URLs for one-command fan-out (`git push all main`).
- **Pushed** to all three via `git push all main`. BT Team verified in browser (commit `7566afb3`,
  2 commits, 378 KiB, no node_modules/db/secrets — ignore rules held).
- **CI made green on BT Team.** First pipeline sat **pending/stuck** — cause: BT shared runners are
  **tagged**, our jobs were untagged so nothing matched. Fix: added `default: tags:
  [mobius_shared_runner]` to `.gitlab-ci.yml` (the online instance runner "Runner #1 VuEZOSXN",
  desc `mobius_shared_runner`). Pushed → pipeline **#7894903 PASSED** (3m22s): syntax-check ✅ +
  unit-tests ✅ (**38/38 ran in BT CI**, Docker `node:22`, zero npm). Commit `e0897c00`.
- **CI now GREEN on all three remotes (confirmed by Isaac, 2026-11-06):** BT Team ✅, BT Personal ✅
  (both GitLab, via the `mobius_shared_runner` tag), and **GitHub ✅** via a new GitHub Actions
  workflow `.github/workflows/ci.yml` (commit `e1aadcc`) — mirrors the GitLab pipeline (syntax-check
  + `node --test` 38/38) on GitHub's hosted Ubuntu runner, no runner tagging needed. Dependency-free
  design confirmed portable across all three CI environments (all just `node:22`, zero npm).

---

## 2026-11-05 (later still) — Stage 11 (deploy prep) + Stage 12 (spec review + user docs) — all session-completable parts done

Picked up Stage 11 → Stage 12. Everything that can be done **before** the BT deployment is now
complete; the only remaining Phase-1 work is BT-side (provision/deploy) + Isaac's sign-off.
Also recorded a future enhancement request (on-screen Menu Card creation) as task 9.12.

### Future request captured (task 9.12)
Isaac asked for an **on-screen Menu Card creation form / pro-forma**, alongside the `.xlsx` upload,
in the admin Menu Cards area. Recorded in SPEC-tasks §Future build (next to 9.11 import). Feasibility
good — the server already exposes `createDraftVersion({version,variants})`; a form would call the
same seam via a new `POST /api/menucards` route. Two build-time decisions flagged: **verbatim vs
calculator** entry, and **scope of the first increment** (options A full builder / B add-rows / C
import-then-edit / D single-variant modal; recommended A as goal, C as strong first increment).
**Medium-tier → Quick Spec when built.** Not scheduled.

### Stage 11 — Deployment & production-DB validation (reframed)
Decision driven by Isaac's answers (BT GitLab + BT local server; lock-down unconfirmed; 3–5 users):
- **11.2 — Production DB = SQLite** (live dependency-free track), not Postgres/SQL Server. Rationale:
  fits 3–5 users; preserves the dependency-free guarantee (no driver to install on a possibly-locked
  server); and dev=prod engine, so the "SQLite-green ≠ prod-green" worry dissolves. Recorded in
  SPEC-design §8 + DEPLOYMENT.md §4. **Dual-track kept:** the parked Prisma/Fastify/React stack
  (`_parked-npm-stack/`) is "Track 2" — the npm + Postgres/SQL Server escape hatch, revived only if
  BT allows npm/Nexus or mandates a managed DB.
- **11.1 — CI:** wrote `.gitlab-ci.yml` (Node 22 image; syntax-check stage over all server+web JS +
  the runner + backup script; test stage = `node app/run-tests.mjs`). No npm step (no deps).
- **11.3 — Prod-DB test pass:** because prod IS SQLite, the existing `node --test` suite (38/38,
  runs against real `node:sqlite` throwaway DBs) already exercises the production engine; CI runs it.
- **11.4 — PDF storage:** documented (client-generated; metadata only; on the encrypted volume).
- **11.6 — Backup & restore — BUILT + VERIFIED:** added dependency-free `app/backup-db.mjs` (atomic
  `VACUUM INTO`, safe on a live DB; `--verify` runs `integrity_check` + row counts; non-zero exit for
  scheduled-task detection). **Test restore proven lossless** against the real dev DB — every core
  table's row count + a content fingerprint matched, `integrity_check: ok`. Procedure in DEPLOYMENT.md §5.
- **11.7 — Operational notes:** session timeout, request-ref format, PDF retention, in-memory
  sessions, SQLite single-writer — DEPLOYMENT.md §6.
- **DEPLOYMENT.md** gained a scannable **§0 Go-live checklist** (Provision 11.8 / Go-live 11.5 /
  once-only), plus §4 (DB decision), §5 (backup/restore), §6 (ops notes).
- **New task 11.8** added: BT-side provisioning (repo create+push, server stand-up, secrets, change
  seeded passwords, schedule backup).

### Stage 12 — Spec review, verification & sign-off (session-completable parts)
- **12.1 — Spec Reviewer run + ALL findings resolved.** Verdict: coverage strong, shipped app sound;
  all 10 findings were **documentation drift** (specs lagging Stage 7–11 reality), not code defects.
  Fixed: 3 blockers (R7 PDF → client-side jsPDF; design §1 diagram + §2 stack table now show Live
  Track 1 / parked Track 2 side by side), 4 should-fix (design §8 two-track; R4.2 + ARCHIVED/CANCELLED;
  NFR12 acceptance criterion + met-evidence; NFR1 Entra deferral explicit), 3 nice-to-have; plus stale
  A3/A4/A5. Report: `.agents/reviews/stage12-spec-review.md`. **No code changes needed.**
- **12.3 — Licence** confirmed Internal / open (revisit before wider go-live).
- **12.5 — User docs created:** `overview.html` + `userguide.html` in the app-family style (inline MDP
  tokens, light/dark, Forjé footer; userguide covers sign-in, catalogue, requests, lines/snapshots,
  status/archive/cancel, PDF export, clone/edit, dashboards, analytics, Menu Cards admin, audit, a11y).

### Verified
Test suite still 38/38 (edits were docs + new non-app scripts); `backup-db.mjs` syntax-checks clean
and ran for real with a verified lossless restore. `.gitlab-ci.yml` written (runs on BT GitLab once pushed).

### Status
**MDP: In Progress. Stages 0–10 complete; Stage 11 + 12 complete EXCEPT the deployment-gated items.**
**Not "Built"** — that waits on Isaac's sign-off of the deployed app.

### REMAINING — all BT-side / Isaac (nothing more buildable in a dev session)
See DEPLOYMENT.md §0 for the full checklist.
1. **11.8 Provision (Isaac/BT):** create + push the BT GitLab repo (CI then runs); stand up the BT
   server (Node 22+, TLS reverse proxy, encrypted volume); set a real `SESSION_SECRET` +
   `NODE_ENV=production`; **change the seeded admin/manager passwords**; schedule `backup-db.mjs` +
   an off-box copy.
2. **11.5 Deploy + smoke-test (Isaac/BT):** run behind TLS; real users log in over HTTPS and exercise
   the core flows.
3. **12.2 End-to-end pass (Isaac):** verify the deployed app against the prod (SQLite) DB.
4. **12.4 Sign-off → Built (Isaac):** when satisfied, flip Ideas.md to **Built (MDP v1.0.0)** per the
   backlog-sync rule (Forjé never flips this — it's Isaac's call after seeing it live).
5. **Open question (Isaac):** confirm whether the BT server is locked down / has a Nexus registry —
   the only trigger that would ever revive Track 2 (npm + Postgres/SQL Server).

### Tracked future builds (not Phase-1 blockers)
- **2.7** Entra ID OIDC (real identity, replaces seeded users) — natural fit with the BT deploy.
- **9.11** Request import pipeline (consumes the export JSON).
- **9.12** On-screen Menu Card creation form (see top of this entry).
- **Deferred Stage-10 a11y should-fixes** (logged in `.agents/reviews/stage10-prelive-audit.md`) —
  highest-value is the **modal focus-trap**; worth doing before wider go-live.

---

## 2026-11-05 (later) — Stage 10 NFR hardening & accessibility (10.1–10.6) — code-complete + browser-verified

Same session as the test suite below. After confirming Stages 0–9 had no blockers, worked straight
through Stage 10. All items done; Isaac browser-verified the a11y fixes.

### 10.5 Branding footer
Footer was already present + correct ("Powered by Forjé" / "© 2026 Isaac A Gera"). Added a
**`@media print`** block in `global.css` hiding the footer, proto-banner, header/nav/theme-toggle
from any page printout (the client-side jsPDF deliverable carries its own footer, unaffected).
Copyright holder confirmed **Isaac A Gera** for MDP (may change later).

### 10.4 Accessibility pass (first round)
App was already strong (global `:focus-visible`, ARIA-rich dropdowns with keyboard support via
`wireMenu`, labelled modals, self-describing theme toggle). Closed the gaps: **aria-label on the
icon-only line buttons** (Duplicate/Delete; glyphs `aria-hidden`), **focus-move to `#view`
(tabindex=-1) on route change** (guarded against stealing focus from inputs), a **universal
reduced-motion backstop**. Token contrast verified AA in both themes except `--muted` (flagged).

### 10.1 / 10.2 (review tasks — confirmed, not rebuilt)
10.1: every write route validates via `validate.js`; repo re-validates enums + business rules;
`readJsonBody` size-guarded; uniform `HttpError`→`sendError` `{error,message,details}` shape.
10.2: indexes present on the hot columns; client-side pagination; audit caps at 200 — within the
3s / ~5-user target. Minor notes logged (route-level quantity validation; server-side pager later).

### 10.3 Secrets / TLS / at-rest
Verified secrets are env-only (`SESSION_SECRET`/`DB_PATH`/`DOC_STORAGE_DIR` via `config`; scrypt-only
passwords; no hardcoded secrets); nothing sensitive committed (no `.env` on disk, `.gitignore`
covers `.env`/`data/`/`*.db`, folder not yet a git repo). Wrote a new **`DEPLOYMENT.md`** at the MDP
root: secrets table + prod-secret generator, TLS-via-reverse-proxy + `NODE_ENV=production`→`Secure`
cookie (cookie already HttpOnly+SameSite=Lax), at-rest guidance, Stage-11 carry-forward list.

### 10.6 Pre-Live Testing Agent + fixes
Ran the **Pre-Live Testing Agent** (read-only) against the live app on the sample DB (admin) at
laptop + mobile. Verdict "minor fixes first". Report saved to
`.agents/reviews/stage10-prelive-audit.md`. **Isaac chose: fix all BLOCKERS + all NICE-TO-HAVE;
defer SHOULD-FIX.** Implemented (all dependency-free):
- **Blockers:** `--muted` `#8a94a3`→`#6b7280` (AA; dark left as-is, already passed); `#view`
  `aria-label`; **catalogue rows keyboard-activatable** (role=link + tabindex=0 + aria-label +
  Enter/Space + focus style); icon-button `:focus-visible` style.
- **Nice-to-have:** live region `#sr-live` + `announce()`/`window.mdpAnnounce` wired into estimates
  status-change + line add/duplicate/delete; **skip link** (focuses `#view` without tripping the
  hash router); explicit SVG reduced-motion guard; date-format hints on the From/To filters;
  `aria-busy` loading states on the Requests list + Catalogue.
- **Deferred SHOULD-FIX (logged):** filter-label `for`/`id`, pill `aria-pressed`, sortable headers,
  login focus check, mobile tap-target bump, **modal focus-trap (highest-value — do before wider
  go-live)**, column-filter input labels.

### Verified
`node --check` clean on all edited JS; `node --test` suite still **38/38** (edits were frontend-only).
**Browser-verified by Isaac (2026-11-05):** contrast in light+dark, skip link, catalogue keyboard
row activation, icon-button focus, and Ctrl+P print-preview excluding the footer/banner.

### Status
**MDP: In Progress. Stage 10 COMPLETE** (10.1–10.6). **Not "Built."** Remaining Phase 1: **Stage 11**
(repo/CI, prod DB choice + migrations/tests on real DB, backup/restore gate, TLS deploy) and
**Stage 12** (Spec Reviewer, e2e on prod DB, licence, Isaac sign-off → Built, userguide + overview).
Carry-forward: deferred SHOULD-FIX a11y items (esp. modal focus-trap); Entra ID (2.7, Stage 11);
request import (9.11). Ideas.md unchanged (still In Progress).

### Next
Stage 11 — deployment & production-DB validation. The `node --test` suite + `DEPLOYMENT.md` are the
groundwork for 11.3 (run the suite against the prod DB) and the TLS/secrets steps.

---

## 2026-11-05 — Durable `node --test` suite (closes the deferred test tasks 0.7 / 1.6 / 5.8 / 7.6)

### Why
Before moving to Stage 10, re-checked Stages 0–9 for genuinely pending items. Found three buckets:
(1) the **test-suite debt** (0.7/1.6/5.8/7.6 — all the *same* root cause: npm blocked, so no
permanent runner; logic was proven via throwaway harnesses + browser sign-off); (2) **Entra ID
(2.7)** — intentional future work, natural home Stage 11; (3) **request import (9.11)** — a tracked
future feature. Only the test suite has a real forward dependency (**11.3** "run the full test suite
against the production DB" has no suite to run). Chose to build it now so Stage 10's NFR/a11y
hardening has a regression net and Stage 11.3 becomes executable.

### What was built
- **`app/test/` — a dependency-free `node --test` suite** (Node 24 built-in; no npm), porting the
  deleted harness assertions into durable files:
  - `engine.test.mjs` (5) — line = snapshot × qty, Σ totals, **integer-pence / no float drift**
    (MQ XL golden 8400.67×2 = 16801.34), edge rounding. *(One test even caught my own naive-JS
    expected value drifting — the engine returned the clean value, proving the guarantee.)*
  - `estimates.test.mjs` (11) — JIRA unique/mandatory validation, scoped line-add + snapshot,
    rowVersion concurrency, scope-lock, clone (`-COPY`/`-COPY2`), archive hide/surface,
    **CANCELLED guards** both directions, per-row TCS+FTE=Total.
  - `menucards.test.mjs` (5) — **single-ACTIVE activation transaction**, reactivate archived,
    guarded delete (ACTIVE / referenced), scoped catalogue sort (TO→XXL).
  - `audit.test.mjs` (6) — **append-only** (asserts no mutating export), action/user/date-range
    filters, distinct users.
  - `flow.test.mjs` (6) — throughput, cycle time (Created→Done 15 / Approved→Done 10), aging,
    run-rate (backlog 108 PD → ~1 mo), empty-filter clean, compare sums back to total.
  - `crypto-util.test.mjs` (5) — scrypt salt/verify/reject/tamper.
  - `helpers.mjs` — `useTempDb()` (throwaway temp SQLite via `DB_PATH`, **refuses real
    mdp.db/mdp-sample.db**), `insertMenuCard()` fixture, MQ XL golden values.
- **`app/run-tests.mjs`** — one-command runner driving Node's test runner programmatically over
  `test/*.test.mjs` (plain `node --test <dir>` / quoted globs are unreliable on this Windows+Node 24
  setup). Prints `==== MDP test summary: N passed, M failed … ====`, exits non-zero on failure, and
  drops a one-line sidecar (`.last-test-summary.txt`, gitignored) for truncation-prone shells.
- **`app/server/db.js`** — added `closeDb()` (additive, non-breaking). Tests call it in `after()` so
  the node:sqlite handle closes and the test process exits cleanly (an open handle was swallowing
  the runner's output).
- Docs: `app/test/README.md` (run instructions + coverage + safety), `.gitignore` entry.

### Verified
- **Full suite: 38 tests across 6 files, all passing** (`node app/run-tests.mjs`). Every DB test
  runs against a fresh throwaway temp DB; the real + sample DBs are never touched.

### Status
**MDP: In Progress.** Tasks **0.7 / 1.6 / 5.8 / 7.6 now DONE**. Stages 0–9 have **no remaining
blockers**; the only open pre-Stage-10 items are intentional future work: **2.7 Entra ID** (→ Stage
11) and **9.11 request import** (tracked). **Not "Built"** (Stage 12). Ideas.md unchanged (still
In Progress).

### Next
- **Stage 10 — NFR hardening & accessibility** (10.1 validation + error shape, 10.2 indexing/
  pagination sanity, 10.3 secrets/TLS notes, 10.4 a11y pass, 10.5 branding footer, 10.6 Pre-Live
  Testing Agent). The new suite is the regression net for this hardening.
- Carry forward: Entra ID (Stage 11), request import 9.11, stale-process restart discipline. A
  direct `documents.js` test can be added later if wanted (PDF *build* stays browser-only).

---

## 2026-10-29 (later) — Stage 9 part (iii): bulk/filtered export (9.7 complete) + build conventions captured

All built, verified (node --check + targeted harnesses), and browser-signed-off by Isaac.

### Bulk / filtered export (task 9.7) — Requests list
- **Export ▾ menu** on the Requests list head → **PDF · CSV · JSON** (relabelled from "Export X").
- Exports the **current filtered selection** (search + per-column filters + archived toggle +
  the new date range), the whole filtered set — not just the visible page. Refactored the filter
  predicate into a shared `filteredRequests(view)` so the table and the export use one source.
- **Columns:** JIRA Reference, Summary, Customer, CFU, Component, Size, Approver, Status, **TCS
  Cost, FTE Cost, Total Cost** (Isaac's tweak: dropped the Lines column, added the TCS/FTE split
  before Total). `listEstimates` now returns per-row `tcsCost`/`fteCost` (integer-pence; verified
  TCS+FTE=Total on all rows).
- **CSV:** UTF-8 BOM (Excel £), proper escaping (quotes/commas/newlines), `mdp-requests-<scope>-<date>.csv`.
- **PDF:** landscape summary table via vendored jsPDF (`exportRequestsTablePdf`), paginated,
  repeating header, title+count+date, Forjé footer.
- **JSON (import-friendly):** an envelope `{ type:'mdp.requests', version:1, exportedAt, scope,
  count, requests:[…] }` with clean request fields and **no internal MDP-XXXX ref / DB ids** (so
  it can feed a future import). Verified shape 6/6. *(The import pipeline itself is NOT built —
  tracked as a separate future build; see SPEC-tasks 9.11.)*

### Requests list — created-date range filter
- Added **From / To** (created date, inclusive) to the search bar; resets paging; cleared by Clear.
  The export inherits it, so "export MQ requests created between X and Y" now works by filtering
  then exporting.

### Dashboards — filtered summary export
- **Export ▾ menu** on the Dashboards head → **PDF · CSV** (no JSON — it's aggregate data, not
  re-importable). Exports the **current filtered summary as tables** (not charts-as-images):
  Key figures (requests/approved/in-progress/USP/PD/TCS/FTE/Total), by status, by product, by CFU,
  by size, and revenue share by product + by CFU. The active filter is named in the title/subtitle.
- CSV = section-stacked (Excel-friendly for pivoting); PDF = a portrait report
  (`exportSummaryTablesPdf`). This is the "pivot-like reporting" ask, driven by the existing
  Dashboards filters rather than a separate pivot feature. Verified sections 6/6.

### Build conventions captured (from Isaac's "workflows/artifacts" question)
- Added **SPEC-design §12 "Build conventions & gotchas"**: the change→verify loop (no npm test
  runner → throwaway `.mjs` harnesses + `node --check` + browser sign-off), the sample-DB/DB_PATH
  workflow, the stale-process trap, the **add-a-status/field checklist** (incl. the db.js boot
  allow-list trap that nearly bit twice), money (integer-pence) + chart conventions, and a
  `node --test` durable-tests pointer. Also noted `node --test` on task 0.7.

### Status
**MDP: In Progress.** **Stage 9 now COMPLETE** (parts i dashboards, ii flow analytics + modes,
iii export). **Not "Built".** Remaining Phase 1: Stage 10 (NFR/accessibility), Stage 11 (deploy +
prod DB), Stage 12 (final sign-off → Built). Deferred/tracked: **request import pipeline (9.11)**;
Menu Card Catalogue integration (Option 2, §10.5); Entra ID OIDC seam; durable `node --test` suite.

---

## 2026-10-29 — Dashboards polish, chart types, pagination, and a new CANCELLED status

All items below built, verified (node --check + targeted harnesses), and browser-signed-off by Isaac.

### Stage 6 archive-after-restart re-check — CLOSED
Re-verified the earlier `db.js` ARCHIVED→DONE data-loss fix in the browser: archive → stop/restart
server → still Archived; same for un-archive. The carried-forward follow-up is closed.

### Dashboards polish + 9.2c (KPI cards)
- **Landing nav "Dashboard" → "Home"** (kept the API-connectivity health card) so it no longer
  clashes with the "Dashboards" reporting tab.
- **9.2c fixed** — the KPI summary cards were too tall/clumsy. Slimmed them: Total Cost now shows
  a small TCS/FTE line (not the full component split), CFUs Active shows just the top CFU. The big
  component/CFU breakdowns moved OUT of the cards and INTO donut charts.
- **New chart types (hand-rolled SVG, dependency-free, themed, in `charts.js`):**
  - `donut()` — proportion splits (By product, By CFU), with a legend (swatch/label/value/%),
    centre total, categorical colour tokens (`--chart-1..8`, light+dark). **Bug fixed:** a single
    100% slice rendered with a notch — now drawn as a stroked circle (clean full ring).
  - `lineChart()` — the monthly timeline is now a trend line with a value label on each point
    (there's no y-axis, so the numbers sit on the points).
  - By status / By size stay bars.
- **Revenue-share tables** — replaced the "Value by customer" table with two grids: **Revenue
  share by CFU** and **Revenue share by Product**, each cost + % of total (verified both sum to
  the total, no float drift). Added per-CFU cost to the value aggregate + `componentShare`/`cfuShare`.

### Pagination (Prev/Next, 10 per page)
- **Requests list** — 10 per page, newest first, "X–Y of N" top-right + Prev/Next; search/filter
  resets to page 1 and the count reflects the filtered set.
- **Analytics aging table** — same treatment (10/page, most-aged first); client-side, re-pages
  without re-fetch; changing the aging threshold resets to page 1.
- Shared `.table-pager` style.

### New status: CANCELLED (Isaac's request)
A request can be stopped after a while, so added **CANCELLED** — selectable from any active status,
but **not** from DONE/ARCHIVED, and a cancelled request can be **revived** to an active status but
not sent straight to DONE/ARCHIVED. (The first real transition restriction in an otherwise
any-to-any workflow.)
- `constants.js`: `EstimateStatus.CANCELLED` + label + `EstimateTerminalStatuses` ([DONE, ARCHIVED]).
- `repo/estimates.js changeStatus`: the guard (block DONE/ARCHIVED→CANCELLED and CANCELLED→
  DONE/ARCHIVED; everything else still any-to-any).
- `repo/flow.js`: CANCELLED excluded from aging/open (and naturally from backlog + throughput —
  it never reaches DONE), so flow metrics stay honest.
- `db.js`: added CANCELLED to the boot status allow-list (avoided the same silent-reset trap that
  bit ARCHIVED earlier).
- UI: status dropdown offers a red "Cancelled" only from active statuses; from CANCELLED it offers
  the active statuses to revive (not DONE/ARCHIVED). Red `.badge.status-CANCELLED`. STATUS_LABEL
  updated across estimates/reports/analytics/pdf-export views.
- Verified 8/8 (guard both directions + analytics exclusion).

### Sample DB
Re-seeded `mdp-sample.db` → still 100 requests, now including **7 Cancelled** (with proper cancel
transition history). Full status spread: DONE 32 / IN_PROGRESS 15 / APPROVED 13 / PENDING 13 /
ARCHIVED 10 / NEW 10 / CANCELLED 7.

### Status
**MDP: In Progress.** Stage 9 parts (i)+(ii) complete + polished; CANCELLED status added. **Not
"Built".** Remaining: Stage 9 **part (iii)** bulk/filtered export (9.7 — format decision still open:
summary PDF vs CSV). Then Stages 10–12 (NFR/a11y, deploy + prod DB, sign-off).

---

## 2026-10-28 (later still) — Stage 9 part (ii): flow analytics + run-rate + Filter/Compare modes

### Summary
Built the Analytics page (flow analytics + an honest run-rate projection), signed off by Isaac.
Added scope modes after a design trial, and upgraded the sample DB to a realistic 100-request set.

### What was built
- **`server/repo/flow.js`** — reconstructs each request's timeline from `created_at` + its
  `{from,to}` status-transition audit events, then computes **throughput** (reaching DONE/month),
  **cycle time** (Created→Done + Approved→Done, median+mean), **per-stage dwell**, **aging**
  (open, days in current status, flag > threshold), and a **run-rate** (recent PD/month vs
  APPROVED+IN_PROGRESS backlog PD → ~N months, inputs shown, non-statistical, null-guarded).
- **`routes/analytics-routes.js`** — `GET /api/analytics/flow?mode=&...` (both roles); `server.js` registered.
- **`web/views/analytics.js`** — separate **Analytics** nav page: KPI cards (cycle, throughput,
  backlog projection, aging), throughput + dwell charts, run-rate explainer, aging table.

### Scope modes (the Overall/Filter/Compare trial)
Isaac asked to visualise the scoping options, so I built all three behind a **pill** to trial them,
then **kept Filter + Compare** (Overall dropped — it's just an empty Filter):
- **Filter** — Component/Size/CFU/Customer + date range re-scopes every metric (in-memory
  `applyFilter` over the timelines); "N matching" note + empty-scope guard.
- **Compare** — break the key metrics down by a chosen dimension (`flowCompare`) as a cycle-time
  bar chart + a metrics-by-group table; <3-completed groups show "—" to avoid misleading medians.
`/api/reports/filters` extended with sizes + customers; `.mode-pill` segmented control in CSS.

### Sample DB upgraded (standing test dataset)
Seeder bumped to **~100 requests** with **time-spread** history — created dates over ~12 months
and each transition written at a believable past date (fixes the earlier "all at now" artifact, so
flow metrics read realistically). Spread across all 4 components, all 7 sizes (TO..XXL added), all
8 CFUs, 8 customers, a realistic status funnel. Added a defensive table-clear so re-runs can't
collide on UNIQUE keys if the file is locked.

### Verified
- Flow harness **11/11** vs hand-scripted dates (throughput, cycle Created→Done 15 / Approved→Done
  10.5, NEW dwell 2.5, aging 0@30d/2@7d, run-rate 54 PD/mo · 108 backlog · ~2.0 mo).
- Filter/Compare harness **9/9** (component=MQ→28 exact, impossible combo→0 clean, compare counts +
  throughput sum back to overall 100/44, thin-group null guard). `node --check` clean throughout.
- Browser sign-off by Isaac on the sample DB (metrics read sensibly; Filter + Compare both useful → kept).

### Status
**MDP: In Progress.** Stage 9 parts (i) + (ii) complete + verified. **Not "Built".** Ideas.md unchanged.

### Next
- Stage 9 **part (iii)** — bulk/filtered export (9.7); format decision still open (summary PDF vs CSV).
- Open polish: **9.2c** KPI summary-card sub-row layout (two-column felt clumsy — revisit).
- Later: surface the Approved→Done cycle perspective as a toggle (already computed).

---

## 2026-10-28 (later still) — Stage 6 archive-after-restart re-check CLOSED

Isaac re-verified in the browser (real dev DB) that the `db.js` `ARCHIVED→DONE` data-loss fix
holds: archive a request → stop & restart the server → hard-refresh → still **Archived** (not
silently flipped to DONE); repeated the restart test for **un-archive** too — both good. The
carried-forward follow-up from the data-loss fix is now closed. Next: Stage 9 part (ii) flow
analytics + run-rate (9.4–9.5), then part (iii) bulk export (9.7); KPI summary-card polish (9.2c)
still open.

---

## 2026-10-28 (later still) — Stage 9: extra breakdowns + WealthOrah-style filtered dashboard

### Summary
Extended the dashboards with three more breakdowns, then reworked the whole dashboards page into a
WealthOrah-style layout (filter bar → KPI summary cards → chart grid → table) with **functional
filters** that re-scope everything. Backend + aggregates all verified; the KPI-card visual polish
is parked as an open item (see below).

### What was built
- **Three new breakdowns** (verified 6/6 harness): by **CFU**, by request **Size** (TO..XXL), and a
  by-month **created timeline** (gap-filled). Endpoints `/api/reports/by-cfu|by-size|timeline`.
- **Shared filter across all aggregates** — `reports.js` gained a `buildFilter({cfu,component,status,from,to})`
  applied everywhere; a one-call **`GET /api/reports/summary`** returns KPIs + every chart series +
  the by-customer table under the current filter, plus **`/api/reports/filters`** for the dropdowns.
  `valueReport` now also returns per-component **cost** and **USP** splits.
- **Dashboard rework** (`web/views/reports.js`): filter bar (CFU/Component/Status/From/To/Clear,
  populated from `/filters`, debounced re-fetch) → 4 KPI **summary cards** (`summaryCard()` in
  `charts.js`, MDP-toned subtle gradient, accent card = Total Cost) → **2-col chart grid** (Timeline,
  By status, By product, By CFU, By size) → by-customer table. `global.css`: summary-grid + gradient
  cards + hover-lift/sibling-dim emphasis + responsive 2-col grid, reduced-motion honoured.
- **% shares in the cards** — each sub-row shows a whole-number % of its card's total (cost split %,
  approved/in-progress %, top/all-CFU %).

### Verified
- `node --check` clean on all changed files. Temp harnesses: new breakdowns **6/6**; filtered
  summary **16/16** (unfiltered reconciles — 18 reqs, £490,817.04, splits sum exactly, 6 customers,
  4 timeline months; component=MQ→8, status=DONE→4, impossible combo→0 clean); % split sums coherent
  (cost & USP both 54/32/12/2 = 100%). Harnesses deleted.
- Browser: Isaac reviewed the reworked dashboard + filters.

### OPEN UI item (parked — revisit next time)
The **KPI summary-card sub-row layout isn't final.** Two refinements landed this session:
(1) the per-component **USP split was removed as a duplicate** — cost is derived from USP, so the
%s are identical and showing both was redundant (USP card now shows "across N requests"); and
(2) card height was reduced by laying the sub-rows out as a **2-column grid** — but Isaac finds
that **clumsy**. The data/filters work fine; this is purely visual polish. Options to try next:
let cards size to their own content, a scrollable sub-list, top-N + "others" for CFU, or a cleaner
sub-row treatment. Tracked as task **9.2c**.

### Housekeeping
- Fixed a duplicated `9.4` line in `SPEC-tasks.md` (pre-existing copy-paste artifact).

### Status
**MDP: In Progress.** Stage 9 part (i) + extensions code-complete; KPI-card polish open. Parts (ii)
flow analytics + run-rate (9.4–9.5) and (iii) bulk export (9.7) still to build. **Not "Built".**
Ideas.md unchanged.

### Next
- Decide the KPI-card sub-row treatment, then Stage 9 **part (ii)** flow analytics + run-rate
  (groundwork ready: from/to history + date filter + 44 transition events in the sample DB), then
  **part (iii)** bulk/filtered export (9.7).
- Still outstanding: browser re-check of the Stage 6 archive-after-restart (the db.js fix).

---

## 2026-10-28 (later still) — Stage 9 part (i): basic dashboards + sample-data seeder + a data-loss fix

### Summary
Built the first of Stage 9's three parts — the three basic reporting dashboards (R9.1–R9.3) —
with hand-rolled SVG charts (Isaac chose Option B over vendoring Chart.js). Then built a reusable
sample-data seeder so the dashboards (and later the flow analytics) have realistic data. Chasing
a seeder oddity uncovered and fixed a genuine data-loss bug in the live app.

### What was built (dashboards)
- `server/repo/reports.js` — volume / by-product / value aggregates; money in **integer pence**
  to match the engine (no float drift).
- `server/routes/report-routes.js` — `GET /api/reports/volume|by-product|value` (both roles);
  registered in `server.js`.
- `web/views/charts.js` — dependency-free inline-SVG `barChart()` + `statCard()`, token-themed,
  accessible (role=img + aria summary, visible value labels, data also in a table).
- `web/views/reports.js` — "Dashboards" view (Volume, By Product, Value + by-customer table).
- `app.js` nav + `/reports` route (both roles); `global.css` stat/chart styles.
- Verified: temp harness **12/12** vs hand-calculated values (no drift); `node --check` clean.

### Sample-data seeder (reusable)
- `app/seed-sample-data.mjs` — builds a **separate** `app/data/mdp-sample.db` (hard-refuses to
  touch the real `mdp.db`): ACTIVE V5 Menu Card + 18 variants; 18 requests across 6 customers /
  all 4 components / all statuses, with lines and **44 status-transition events** (so dashboards
  and the upcoming flow analytics have real history). Reproducible (seeded PRNG), spreads
  created_at over ~120 days. Run the server with `DB_PATH` pointed at the sample DB to demo;
  start normally for the real data.

### Data-loss bug found + fixed (affects the LIVE app, not just sample data)
While verifying the seed, archived requests kept coming back as DONE. Root cause: `db.js`'s boot
migration had an **`ARCHIVED→DONE` status remap** — a leftover from the Stage-5 lifecycle
migration (when ARCHIVED meant "finished"). Since **Stage 6 made ARCHIVED a live, user-set
status**, that line silently reset every genuinely-archived request to DONE **on every server
restart**. The two legacy strings (old vs new ARCHIVED) are identical, so a value-based remap
can't tell them apart. **Fix:** removed the `ARCHIVED→DONE` remap (kept DRAFT/UNDER_REVIEW — those
are truly dead). Verified archived rows now survive an `initSchema` re-run. This is exactly the
silent corruption the build rules warn about; good that the seeder surfaced it.
→ **Follow-up for next browser session:** re-check the Stage 6 flow end-to-end — archive a request,
restart the server, confirm it's still archived.

### Verified / signed off
- **Browser sign-off by Isaac (2026-10-28)** on the dashboards against the sample DB (volume
  New3/Pending3/Approved3/InProgress3/Done4/Archived2; by-product MQ8/WLS7/CFT2/WFY1; value
  £490,817.04). Sample data reviewed and OK.

### Status
**MDP: In Progress.** Stage 9 **part (i) complete + verified**. Parts (ii) flow analytics +
run-rate (9.4–9.5) and (iii) bulk export (9.7) still to build. **Not "Built"** (Stage 12). Ideas.md unchanged.

### Next
- **Stage 9 part (ii):** flow analytics (throughput, cycle time, per-stage dwell, aging) +
  run-rate projection — groundwork ready (8.5 from/to history + the Stage 8 date-range filter +
  the sample DB's 44 transition events).
- Then **part (iii):** bulk/filtered export (9.7) — needs the format decision (summary PDF vs CSV).
- Carry forward: stale-process restart discipline; re-verify Stage 6 archive-after-restart; Entra
  ID OIDC seam; permanent test runner.

---

## 2026-10-28 (later still) — Stage 8: Audit viewer (Audit/History role split) — built + signed off

### Summary
Built the Stage 8 audit viewer and Isaac signed it off the same session. The append-only writer
and event coverage were already in place from earlier stages, so the work was the viewer + a
role-aware scoping split. Also retired the deferred date-range filter here (6.1).

### What was built
- **Audit viewer, role-split** (Isaac's call): **Administrator → "Audit"** = the full log across
  all users, with action / user / date-range filters + a User column. **Other roles → "History"**
  = their own events only, titled "My history", no user filter/column.
- **Scoping enforced server-side** (defence in depth): a non-admin's `userId` is forced to the
  caller regardless of any `user` param, and `GET /api/audit/users` is Admin-only. A Delivery
  Manager cannot read anyone else's history even by hand-crafting the request.
- `listEvents` gained **date-range (from/to)** filtering — this retires the date-range debt
  deferred from Stage 6 (6.1) and unblocks Stage 9's period-based analytics/export.

### Files
- `server/repo/audit.js` — `listEvents` from/to; `listAuditUsers()`.
- `server/routes/audit-routes.js` (NEW) — `GET /api/audit` (role-scoped), `GET /api/audit/users` (admin-only); registered in `server.js`.
- `web/views/audit.js` (NEW) — filters + results table, adapts title/columns/filters by role.
- `web/app.js` — `/audit` route passes `isAdmin()`; nav label swaps **Audit ↔ History** by role.
- `web/styles/global.css` — audit filter/table styles.
- `SPEC-tasks.md` — ticked 8.1–8.4; housekeeping: ticked 1.4 (done in Stage 3), noted date-range moved to Stage 8 on 6.1.

### Verified
- Temp Node harness **20/20** (8 event types write/read; append-only — no update/delete exported;
  fields present; action/user/date filters; `listAuditUsers`). Harness deleted. `node --check`
  clean on all changed files.
- **Browser sign-off by Isaac:** Admin Audit (all + filters) and Manager History (own only, 41)
  both correct.

### Sign-off scare worth remembering — the stale-process trap (again)
Manager History briefly showed **138** events (should be 41). Chased it: a DB dump showed clean
attribution (admin 97 / manager 41, **0 NULL user_ids**) and the repo scoped correctly
(`listEvents({userId: manager})` = 41). Root cause: the **running server was still serving the
pre-scoping route** (scoping was added after the last restart; Node doesn't hot-reload). A fresh
restart fixed it. **Lesson reinforced: after any server-side edit, fully stop + restart `node
server.js`.** Not a code bug.

### Status
**MDP: In Progress.** Stage 8 complete + verified. **Not "Built"** (Stage 12, Isaac's call).
Ideas.md unchanged.

### Next
- **Stage 9 — Reporting dashboards + flow analytics + run-rate projection + bulk/filtered export
  (9.7).** The `{ from, to }` transition history (8.5) and the date-range filter are now both in
  place, so the flow-analytics groundwork is ready.
- Carry forward: stale-process restart discipline (bit us again today); Entra ID OIDC seam;
  permanent test runner; pagination (audit list caps at 200 — fine at current scale);
  12-month auto-archive.

---

## 2026-10-28 (later) — Stage 7: PDF export (client-side jsPDF) + task 8.5 — built + signed off

### Summary
Built Stage 7 and folded in task 8.5, both browser-signed-off by Isaac the same session. PDF
export went **client-side with vendored jsPDF** (not the original server-side pdfmake plan — npm
is blocked; reused the Menu Card Catalogue's proven vendored-jsPDF + adaptive-delivery pattern).
Then iterated the PDF content and the builder-header UI with Isaac until both looked right.

### What was built
- **Task 8.5 (done early):** status route reads the previous status before `changeStatus` and logs
  `detail: { change:'status', from, to, status }`. Transition history now accrues cleanly — the
  raw material for Stage 9 flow analytics.
- **PDF export** (`web/views/pdf-export.js`): `buildRequestDoc()` renders a portrait A4
  customer PDF; `exportRequestPdf()` builds + delivers (download desktop / share mobile / fallback)
  and returns filename+size; `previewRequestPdf()` opens in a tab with no record. jsPDF vendored
  at `web/vendor/jspdf.umd.min.js`, loaded lazily via the Catalogue's UMD `<script>` injector.
- **Server:** `getEstimate` now joins the pinned Menu Card version (label/FY/filename), exposed as
  `menuCardVersion` on the view (list query unaffected). New `repo/documents.js`
  (recordGeneratedDocument / get / list; `file_path` = marker `'client-generated'` since the
  browser holds the bytes). New `POST /api/estimates/:id/export` records a `GeneratedDocument` +
  `ESTIMATE_EXPORT` audit. Preview records nothing (design §6).

### PDF content — refined with Isaac
- Summary → **two-column grid, no boxes**; dropped **Size**; added **Recorded by** (creator's
  display name, role-agnostic — Admin or DM) + **Date received** (created date).
- **Removed** Line-Item Breakdown, Assumptions, Exclusions, Menu Card Version.
- Cost Summary → kept **Story Points, TCS Cost, FTE Cost** + emphasised Grand Total; **removed PD
  + ATOM**. Kept **Remarks**. Loosened spacing for a cozier layout.

### Builder-header UI — refined with Isaac
- Collapsed the button row into a tidy **Actions ▾ dropdown** (Preview, Export, Clone, Archive,
  Edit, Delete) — **bug fixed:** the menu was always-open because a `display:flex` overrode the
  `hidden` attribute; now `display` is applied only via `:not([hidden])`.
- **Status** turned into a **custom dropdown matching Actions** (same solid-blue button, same
  188px width, "Status: <value>" inside the box, current status highlighted). Open/close logic
  refactored into a shared `wireMenu()` helper used by both.

### Verified
- Temp Node harness (8.5 + export): **14/14 pass** (from/to recorded; pinned version exposed;
  requestRef still hidden; totals 16801.34; GeneratedDocument w/ client-generated marker +
  size; ESTIMATE_EXPORT links to the doc). Harness deleted. `node --check` clean on all changed
  files.
- **Browser sign-off by Isaac (2026-10-28):** Preview + Export on both Administrator and Delivery
  Manager roles; PDF content/spacing approved after the field rework; Actions + Status dropdowns
  approved.

### Captured for later (Isaac's requests this session)
- **Bulk / filtered export** — export a SET of requests by **status / period / creator** in one go.
  Logged as **Stage 9 task 9.7** (shares the analytics slicing + needs the deferred date-range
  filter). Format still open: summary PDF vs CSV vs ZIP-of-PDFs — decide on use case at build time.

### Status
**MDP: In Progress.** Stage 7 + 8.5 complete + verified. **Not "Built"** (Stage 12, Isaac's call).
Ideas.md unchanged.

### Next
- **Stage 8 — Audit viewer** (the rest of Stage 8; 8.5 already done). Then **Stage 9 — reporting +
  flow analytics + run-rate projection + bulk/filtered export (9.7)**.
- Carry forward: stale-process restart discipline; Entra ID OIDC seam; permanent test runner;
  deferred date-range/pagination; 12-month auto-archive.

---

## 2026-10-28 (later) — Stage 6: Request Repository (clone + archive) — built + signed off

### Summary
Built Stage 6 and Isaac signed it off in the browser the same session. Scope was deliberately
trimmed: most of the "repository" (list + search + per-column filters + per-row totals) already
landed in Stage 5, so Stage 6 was really **Clone** + **Archive**, surfaced in the UI. Pagination,
date-range filter, estimate version-history, and the **12-month auto-archive** were consciously
**deferred** (manual Archive button now; auto-archive later). PDF export is Stage 7.

### What was built
- **Clone a request** (`cloneEstimate`, `repo/estimates.js`): deep-copies the header with a fresh
  internal **MDP-XXXX** and a derived **unique JIRA** (`<src>-COPY`, then `-COPY2`…), status reset
  to NEW, rowVersion 0, pinned MenuCardVersion preserved, and **every line copied with its
  snapshot values intact** (clone figures are independent of the current Menu Card). Route
  `POST /api/estimates/:id/clone` writes an ESTIMATE_CREATE audit event. UI: Clone button on the
  builder → opens the copy so the `-COPY` JIRA can be renamed.
- **Archive** (separate `ARCHIVED` status, not a synonym for Done): reached via an explicit
  Archive action (rides the existing `POST /:id/status`, any-to-any). `listEstimates` now
  **hides ARCHIVED by default**; archived rows surface only via `status=ARCHIVED`. UI: Archive /
  Un-archive buttons on the builder, a **"Show archived"** toggle on the list, a dashed
  **Archived** badge, and a disabled status dropdown while archived.

### Files changed
- `server/constants.js` — `EstimateStatus.ARCHIVED` + label + `EstimateActiveStatuses` (the 5
  non-archived statuses).
- `server/repo/estimates.js` — `cloneEstimate()` + `deriveCloneJira()`; `listEstimates`
  default-hides ARCHIVED.
- `server/routes/estimate-routes.js` — `POST /:id/clone`.
- `server/db.js` — **bug fix:** added ARCHIVED to the boot status-remap allow-list (otherwise
  archived requests would be silently reset to NEW on the next boot — the exact silent-data
  corruption the build rules warn against).
- `web/views/estimates.js`, `web/styles/global.css` — the UI above.

### Verified
- **Server logic** — temporary Node harness, **21/21 checks pass** (clone refs/status/rowVersion,
  line copy, pinned-version preserved, snapshot immutability after mutating the source variant;
  archive hides from default list, `status=ARCHIVED` surfaces it, un-archive restores). Harness
  deleted after running. All four server files + the view pass `node --check`.
- **Browser sign-off by Isaac (2026-10-28):** Clone → rename → Archive → Show archived →
  Un-archive, all five passed.

### Status
**MDP: In Progress.** Stage 6 complete + verified. **Not "Built"** — that stays for Stage 12 when
Phase 1 ships (Isaac's call). Ideas.md row unchanged (In Progress).

### Next
- **Stage 7 — PDF export**, decided **client-side jsPDF** (Option A — reuse the Menu Card
  Catalogue's vendored-jsPDF + adaptive-delivery pattern; dodges the npm block). Document
  sections: cover, summary, line-item breakdown, assumptions/exclusions, cost summary, version
  info; plus GeneratedDocument metadata + ESTIMATE_EXPORT audit.
- Then Stage 8 (audit viewer), **Stage 9 (reporting dashboards — the insights views)**, 10
  (NFR/a11y), 11 (deploy + prod DB), 12 (sign-off → Built).
- Deferred and tracked: pagination/date-range, request version-history, **12-month auto-archive**.
- Carry forward: stale-process restart discipline; Entra ID OIDC seam; permanent test runner.

---

## 2026-10-28 — Stage 5 browser sign-off; integration decision captured

### Stage 5 signed off (browser-verified by Isaac)
Started the server fresh (clean start, no stale process) and walked the Requests area end-to-end
in the browser. All checks passed:
- **Add Request** form carries all fields (JIRA Reference, Summary/Title, CFU, Approver,
  Component, Size, External Ref, IP Code, IO Reference, Remarks) and saves.
- **Scoped catalogue picker** shows only the request's Component+Size variants.
- **Line + live totals strip** update on quantity change.
- **Scope lock** — can't change Component/Size while lines exist.
- **Status workflow** — New → Pending → Approved → In Progress → Done, any-to-any, badge colours.
- **Requests list** — Total Cost / Total PD columns, generic search + per-column filters,
  "X of N requests" count, Clear.

**Stage 5 is now DONE + verified.** Updated `SPEC-tasks.md` (Stage 5 header → DONE, 5.2 reworded
to the actual five-status any-to-any workflow replacing the stale guarded lifecycle, 5.8 verify
line + top progress banner). **MDP status stays In Progress** — "Built" is reserved for Stage 12
when Phase 1 ships (Isaac's call per the backlog-sync rule). Ideas.md row unchanged.

### Menu Card Catalogue integration — decision recorded
Agreed to finish MDP's Phase 1 core first, then integrate the standalone **Menu Card Catalogue**
via **Option 2** (fold it into MDP as its built-in catalogue UI). Captured in `SPEC-design.md`
new **§10.5** (four options weighed, Option 2 chosen, sequencing + "notes for when we reach it")
and ADR #7. Standalone PWA stays Built/untouched until the port is done and verified, then retired
on sign-off.

### Next
- **Stage 6 — Estimate/Request Repository:** list/search/filter at scale, clone, archive,
  shared-state visibility across sessions, pagination + indexes.
- Then **Stage 7 — PDF export**, then the Option 2 catalogue integration.
- Carry forward: after any server-side edit, fully stop + restart `node server.js` (stale-process
  trap); Entra ID OIDC seam stub; permanent test runner still deferred while npm is blocked.

---

## 2026-10-21 — End-of-session marker (MDP parked for today)

MDP was **parked mid-stream** today after the Requests UX pass below: we deliberately pivoted to
spin the Menu Card import + Product Catalogue out into a **separate standalone PWA** ("Menu Card
Catalogue", under `Work/Menu Card Catalogue/`) to keep MDP simple. **MDP itself was left
untouched** during that work.

**MDP status at end of day:** Stages 0–4 verified; Stage 5 (Requests + engine) and the later
Requests UX pass (new status workflow, list totals, search/filter) are **code-complete and
logic-verified but still awaiting Isaac's browser sign-off** — the server must be restarted so
the migration + new code load (see the stale-process note in an earlier entry). Status stays
**In Progress**.

**Next time on MDP:** restart the server fresh, browser-test the Requests area end-to-end, then
decide the next stage (Stage 6 Repository / Stage 7 PDF export).

---

## 2026-10-21 (later still) — Requests UX pass: new status workflow, list totals, search/filter

### Summary
Three Isaac-requested improvements to the Requests area, plus a bug-root-cause note. All logic
re-verified (15 checks, all pass). Still **In Progress** — awaiting browser sign-off.

### 1. New status workflow (replaced the old lifecycle)
- `EstimateStatus` is now **New (default) → Pending → Approved → In Progress → Done**.
- **Any-to-any** transitions — removed the `EstimateStatusTransitions` guard; the user sets
  whatever status fits.
- **No editing lock** — removed `assertEditable` (the old APPROVED/ARCHIVED line-edit lock);
  header and lines are editable in every status.
- **Migration:** legacy values remap on boot — DRAFT→NEW, UNDER_REVIEW→PENDING,
  APPROVED→APPROVED, ARCHIVED→DONE (idempotent; unknowns fall back to NEW). New status badge
  colours added.

### 2. Total cost on the Requests landing page
- `listEstimates` now computes **grandTotalCost** and **totalPd** per row via SQL SUM of
  `snap_total_cost×qty` / `snap_pd×qty` (rounded at the display edge). The list table shows
  **Total Cost** and **Total PD** columns, so cost is visible without opening a request.

### 3. Search + per-column filters on the list
- Replaced the three fixed filter boxes with a **generic search box** (matches across all
  columns — JIRA, summary, customer, CFU, component, size, approver, status) **and a
  per-column filter row** under the headers. Both are client-side over the loaded set for
  instant response (Catalogue pattern). Added a "Clear" button and an "X of N requests" count.

### Files changed
- `server/constants.js` — `EstimateStatus` new five values, `EstimateStatusDefault`,
  `EstimateStatusLabel`, `LegacyStatusMap`; removed `EstimateStatusTransitions`.
- `server/repo/estimates.js` — create inserts `EstimateStatusDefault`; `changeStatus` any-to-any;
  removed `assertEditable` (4 call sites); `listEstimates` returns per-row totals.
- `server/db.js` — migration remaps legacy statuses (idempotent).
- `server/schema.sql` — status default `'NEW'`.
- `web/views/estimates.js` — list reworked (generic search + per-column filters + Total Cost/PD
  columns + count); builder status dropdown = all five, freely selectable; removed all
  locked/editable UI branches.
- `web/styles/global.css` — search bar, column-filter row, numeric cell, new status badge colours.

### Root-cause note on the earlier "name is required" error
That was **not** a code bug — the Node server process (PID 28432) had been running since before
the Request-model rewrite, so it was still executing the old route that validated a `name`
field. Node doesn't hot-reload; each "restart" started a second process that couldn't bind port
4000 and exited, leaving the stale one serving. **Killing the old process fixed it.** Lesson:
after server-side edits, the running `node server.js` must be fully stopped and restarted
(confirm nothing else holds port 4000). Also hardened `validate.js` to accept friendly field
labels so any server-side validation message reads properly (e.g. "Summary / Title is required").

### Verified (temporary Node harnesses, 15 checks, ALL PASS; harnesses deleted)
- Default status NEW; five statuses; create starts NEW.
- NEW→DONE and DONE→PENDING allowed (no guard); unknown status rejected (400).
- A line can be added while status = APPROVED (no lock).
- List returns grandTotalCost 16801.34, totalPd 108, lineCount 1 for a 2×(MQ XL) request.
- Legacy status migration (DRAFT→NEW etc.) + idempotent on second run.
- Frontend `node --check` clean.

### Status
**MDP: In Progress.** These three changes are **code-complete and logic-verified — awaiting
Isaac's browser sign-off** (restart the server so the migration + new code load, then hard-refresh
the browser). Not "Built".

---

## 2026-10-21 (later) — Stage 5 amendment: Estimate → **Request**, header fields reworked

### Summary
Reworked the Stage 5 entity from "Estimate" into a "Request" per Isaac's 11-point spec: renamed
labels/fields, added six new fields (two of them scope the catalogue), introduced a hidden
internal key, and migrated the dev DB in place. All logic re-verified (23 checks across the
Request model + the column-rename migration, all pass). Still **In Progress** — awaiting Isaac's
browser sign-off.

### The 11 changes (as built)
1. Nav tab **Estimates → Requests**; button **New estimate → Add Request**.
2. Estimate Number (`ARCH-XXXX`) → **JIRA Reference**: now **user-typed, mandatory, unique**
   (no auto-suggest). A separate **internal `MDP-XXXX`** key is auto-assigned as the backend
   primary reference and is **never shown** on screen.
3. Name → **Summary / Title**.
4. New **CFU** (Customer Facing Unit) — mandatory dropdown, alphabetical (Architecture,
   Business, Consumer, Corporate, Data & AI, International, Networks, Openreach).
5. New **Approver** — mandatory, free text.
6. Opportunity Ref → **External Ref**.
7. New **Component** — mandatory dropdown (CFT / MQ / WFY→WILDFLY / WLS, from the catalogue).
8. New **Size** — mandatory dropdown (TO / XS / S / M / L / XL / XXL).
9. New **IP Code** — optional.
10. New **IO Reference** — optional.
11. Description → **Remarks** (optional).

### Key behaviour: Component + Size drive the catalogue (Isaac's clarification)
The request's header **Component + Size scope its line items**. The add-from-catalogue picker is
served from a new endpoint `GET /api/estimates/:id/catalogue` that returns only the active
variants matching the request's Component+Size. The server also **rejects any line outside the
scope** (400), and **Component/Size are locked once lines exist** (must remove lines to change
them) so snapshotted lines can't be orphaned. Lines, the engine, snapshot-on-add, live totals
and rowVersion concurrency are all unchanged.

### Files changed
- `server/constants.js` — added `CFU[]` (alphabetical), `SIZES[]`, `REQUEST_REF_PREFIX='MDP-'`;
  removed the now-unused `ESTIMATE_NUMBER_PREFIX`.
- `server/schema.sql` — estimates table reworked: `request_ref` (MDP-XXXX, UNIQUE, hidden),
  `jira_reference` (NOT NULL UNIQUE), `summary`, `cfu`, `approver`, `component`, `size`,
  `external_ref`, `ip_code`, `io_reference`, `remarks`.
- `server/db.js` — `migrateEstimatesToRequests()`: idempotent **RENAME COLUMN**
  (estimate_number→jira_reference, name→summary, opportunity_ref→external_ref,
  description→remarks) + **ADD COLUMN** for the new fields (nullable at DB level; app enforces
  mandatory) + **backfills `request_ref`** (MDP-####) for existing rows. **Bug caught & fixed:**
  the two new indexes (`idx_est_component`, `idx_est_cfu`) had to move out of `schema.sql` into
  the migration (after the columns exist), else schema load throws "no such column: component"
  on an old-shape DB.
- `server/repo/estimates.js` — rewritten for the Request model: `nextRequestRef`,
  `normaliseJira`, validators (CFU/Component/Size/Approver), `scopedCatalogue(id)`, scope
  enforcement in `addLine`, Component/Size-change lock while lines exist, `listEstimates`
  filters (jira/customer/status/component/cfu). View exposes `jiraReference` etc. but **never**
  `requestRef`.
- `server/routes/estimate-routes.js` — removed `next-number`; added `GET :id/catalogue`;
  create/patch accept all new fields. Audit events unchanged.
- `web/views/estimates.js` — "Requests" list + Add Request/Edit modals (two-column form with
  CFU/Component/Size dropdowns), meta strip, scoped picker, updated columns. `web/app.js` nav
  label → Requests. `web/styles/global.css` — form-grid + meta-strip styles.

### Verified (temporary Node harnesses vs throwaway SQLite DBs — 23 checks, ALL PASS; harnesses deleted)
- Request create persists all new fields; JIRA normalised/uppercased + **duplicate rejected
  (409)**; internal `request_ref` = `MDP-0001` in DB but **absent from the API view**.
- Mandatory validation: bad CFU / Component / Size and empty Approver each rejected (400).
- Scoped catalogue returns only MQ/XL; in-scope line add works; **out-of-scope WLS/S add
  rejected (400)**; Component/Size change blocked while lines exist (409).
- Totals + **snapshot immutability** still hold (variant changed to 99999 → request stayed
  16801.34).
- **Migration on a real old-shape DB:** all four columns renamed, new columns added, data
  preserved through the rename, `request_ref` backfilled, and **idempotent on a second run**.

### Still the same environment caveat
Couldn't boot the HTTP server from this shell (the OneDrive-path-with-parentheses `cd` quirk).
Logic is verified; **browser sign-off is Isaac's** — start it manually:
`node "<app>\server\server.js"` → http://127.0.0.1:4000 (admin/admin123 or manager/manager123).
On first boot the dev DB migrates in place automatically.

### Status
**MDP: In Progress.** Stage 5 + the Request-model amendment are **code-complete and
logic-verified — awaiting Isaac's browser sign-off**. Not "Built".

---

## 2026-10-21 — Stage 5: Estimate Builder + Calculation Engine

### Summary
Built the deterministic heart of MDP — the estimate builder and its calculation engine —
dependency-free, matching the established `app/` patterns. Server logic and HTTP route-wiring
verified end-to-end against a throwaway SQLite DB (31 checks, all pass). **Not yet browser-
signed-off by Isaac**, so status stays In Progress.

### What was built
- **`server/engine.js` (pure, no I/O):** `computeLine` / `computeEstimate`. Line = snapshot ×
  quantity; estimate totals = Σ lines. **Money done in integer pence** then converted back to
  pounds so many lines sum with no binary-float drift; PD/USP/ATOM rounded to 4 dp at the edge.
  Derived totals are never stored — computed on demand (design §4).
- **`server/repo/estimates.js`:** estimate header CRUD; the **`ARCH-XXXX`** mechanism
  (`suggestNextNumber` = max+1 zero-padded, `normaliseNumber`, uniqueness enforced in a
  transaction with a clear 409); **snapshot-on-add** lines (copies the variant's six values at
  add-time; the estimate pins its MenuCardVersion at create); line add/edit/delete/duplicate;
  guarded **status lifecycle** (`EstimateStatusTransitions`); **`rowVersion` optimistic
  concurrency** (any line change bumps the parent's row_version — S4); APPROVED/ARCHIVED
  estimates are locked against line edits.
- **`server/routes/estimate-routes.js`** (both roles, `requireAuth`), registered in
  `server.js`: list/search, `next-number`, create, get, header PATCH, status POST, delete,
  totals, and the four line endpoints. Writes **ESTIMATE_CREATE / ESTIMATE_MODIFY /
  ESTIMATE_DELETE** audit events. `next-number` is registered before `:id` so it isn't
  shadowed.
- **Frontend `web/views/estimates.js`:** repository list + search/filter, New-estimate modal
  (pre-fills the suggested ARCH number), the builder (header + status control + Edit/Delete),
  a **line grid with inline quantity edit + duplicate/delete** and a **live totals strip**, and
  an **add-from-catalogue picker**. `app.js` router extended to support the prefix route
  `/estimates/:id` (sub-path + nav highlight). Stage-5 CSS appended to `global.css` using the
  existing tokens (totals strip, modal, status badges) — themes light/dark.

### Verified (temporary Node harness vs throwaway SQLite DB — 31 checks, ALL PASS)
- Engine: 8400.67 × 2 = 16801.34; Σ grand total 21468.38 and 13067.71 **exact** (no float drift);
  Σ PD sums correct.
- ARCH number: first suggestion `ARCH-0001`, increments to `ARCH-0002`, **duplicate rejected
  (409)**.
- Snapshot-on-add: MQ golden total 8400.67 captured; rowVersion bumps on each line change.
- **Snapshot immutability:** after a line was added, the source variant's `total_cost` was
  changed to 99999 — the estimate's figure stayed 21468.38 (the core integrity guarantee).
- Concurrency: stale `rowVersion` rejected (409); correct one succeeds.
- Status: DRAFT→UNDER_REVIEW→APPROVED allowed; APPROVED→DRAFT rejected (409); APPROVED estimate
  locked against line edits.
- Route-wiring smoke test: all estimate endpoints resolve; `next-number` not shadowed by `:id`.
- The harness files (`_verify-*.mjs`, `_run-verify.bat`) were deleted after running.

### Environment notes / gotchas (carry forward)
- **Could not boot the HTTP server from this session's shell.** The terminal wrapper injects a
  `cd "<OneDrive path with (parentheses)>" ;` prefix that fails with "The system cannot find the
  path specified" before `node` runs — so starting `server/server.js` as a process didn't work
  here. The server itself is fine (it resolves paths via `import.meta.url`); this is purely the
  known Windows/OneDrive shell quirk. **Isaac should start it manually to browser-test:**
  `node "<app>\server\server.js"` then open **http://127.0.0.1:4000** (logins `admin`/`admin123`
  or `manager`/`manager123`).
- Reliable verification pattern on this machine: a **cwd-independent `.mjs`** (imports via
  absolute `file://` URLs, sets its own `DB_PATH` to a temp file) run by **absolute path** with
  output redirected to a temp file, then read back. Plain `cd`-prefixed or chained cmd lines are
  unreliable here.

### Status
**MDP: In Progress.** Stages 0, 2, 3, 4 verified in browser by Isaac. **Stage 5 code-complete
and logic-verified — awaiting Isaac's browser sign-off** (create an estimate, add lines, watch
live totals, exercise the status lifecycle in the running app). Not "Built".

### Next
- **Isaac to browser-test Stage 5** on port 4000 and sign off.
- Then **Stage 6 — Estimate Repository** (list/search/filter at scale, clone, archive,
  shared-state visibility) and **Stage 7 — PDF export**.
- Carry forward: Entra ID OIDC seam stub (2.7); permanent test runner still deferred while npm
  is blocked; active Menu Card predates file-storage (re-import to enable download).

---

## 2026-10-20 (cont.) — Stage 4: Product Catalogue

### Summary
Read-only catalogue over the active Menu Card, for **both roles**. Light stage — the query
layer already existed from Stage 3.

### What was built
- **Routes (`routes/catalogue-routes.js`, requireAuth = both roles):**
  `GET /api/catalogue?component=&size=&q=` → `{ activeVersion, filters, items, total }`;
  `GET /api/catalogue/variants/:id` → full variant detail.
- **Repo:** added `getActiveFilters()` → distinct components + sizes-by-component (data-driven
  dropdowns).
- **Frontend (`web/views/catalogue.js`):** active-version banner (or "no active Menu Card"),
  component + size + debounced text-search filters, results table, click-through detail panel
  showing all six values (£-formatted) + scope/assumptions/exclusions + partner-cost reference.
  Wired into the router for both roles (not admin-only).

### Verified (end-to-end, as Delivery Manager)
Catalogue accessible to the DM role; active V5 / FY26-27, **38 variants**; MQ filter = 9 with
**two distinct `M` variants** (Size-not-unique handled); **WildFly has no XXL** (per-component
size ladders); variant detail returns correct golden values (MQ XL Total £8,400.67) + partner
cost. Both roles confirmed.

### Catalogue refinements (Isaac feedback, same day — all verified)
- **Banner** shows the Menu Card **filename + (FY)** — version label dropped.
- **Component filter → pills** (MQ / WLS / **WFY** / CFT), multi-select, "All" default, selected
  highlighted. **Size filter → pills** in fixed sequence TO/XS/S/M/L/XL/XXL, multi-select, "All".
- **Table columns** relabelled to the team's terms: **Story Points** (USP), **TCS Cost**
  (= stored uspCost), **FTE Cost** (= stored overheadCost), **Total Cost** (= TCS + FTE).
  *(Display labels only — underlying data fields unchanged.)*
- **Search** spans all displayed columns (client-side).
- **Sort:** component (A–Z) → size (TO→XXL) → **USP ascending** (3rd level; matters for WLS,
  which has several variants per size — verified XS 4→8→16, XXL 72→96).
- **Filter box layout:** filters on the left, **search + live "X of N services" count + Clear
  filters** on the right; box height reduced (previously half-empty).

### Status
**MDP: In Progress.** Stages 0, 2, 3 (+ follow-ups), 4 (+ catalogue refinements) code-complete
and verified. Not "Built".

### Next
- **Stage 5 — Estimate Builder + Calculation Engine:** the `ARCH-XXXX` estimate, line items with
  snapshot-on-add, the deterministic `value × quantity` engine, status lifecycle, optimistic
  concurrency. This is the next substantial stage.
- Carry forward: Entra ID OIDC seam stub (2.7); test harness deferred while npm is blocked;
  active Menu Card predates file-storage (no download until re-imported); real `.xlsx` lives
  off-Desktop (ask Isaac for path when needed).

---

## 2026-10-20 (cont.) — Stage 3: Menu Card Management + follow-ups

### Summary
Built the heart of MDP — the Excel import pipeline that turns the real Menu Card workbook into
the live catalogue — entirely dependency-free, then added a round of lifecycle/file enhancements
from Isaac's feedback. All verified end-to-end (HTTP + direct DB checks) and signed off.

### What was built
1. **Dependency-free `.xlsx` reader (`xlsx.js`)** — an `.xlsx` is a ZIP of XML, so it walks the
   ZIP central directory and inflates entries with `node:zlib` (`inflateRawSync`), then regex-
   parses sharedStrings + each sheet into dense rows. No ExcelJS/SheetJS. Verified on the real
   workbook (6 sheets, correct row counts).
2. **Menu Card parser (`menucard-parser.js`)** — maps columns by **header text** (robust to the
   four components' differing layouts), worksheet→component (`Weblogic`→`WLS`), cleans cell text,
   reads Variables (rates) + Version (label), validates + flags duplicate variants.
   - **Key gotcha found by testing against real data:** the workbook's cost headers are
     **mislabelled/off-by-one**. The header "USP Cost" actually holds the per-USP *rate* (55.56);
     the real USP/TCS cost (6000.48) sits under "Vendor Cost"; the overhead cost (2400.19) under
     "Overhead". Confirmed against the requirements doc's authoritative MQ XL values
     (6000.48 × 1.40 = 8400.67). Parser remaps accordingly. **Lesson: test the parser against the
     actual file, not assumptions.**
3. **Data access (`repo/menucards.js`)** — create DRAFT version + variants (transaction),
   list/get/getActive, **activate via serialized single-ACTIVE transaction**, archive, and the
   catalogue query (ready for Stage 4).
4. **Routes (`routes/menucard-routes.js`)** — admin-only: import (multipart via in-house
   `multipart.js`), list, get, active, activate, archive. MENUCARD_UPLOAD + MENUCARD_ACTIVATION
   audit events.
5. **Admin UI (`web/views/menucards.js`)** — upload + FY field, parse-summary review, version
   table with status badges + actions. Wired into the router (admin-only).

### Verified (real V5 workbook, end-to-end)
Import → staged DRAFT, **38 variants** (MQ 9 / WLS 13 / CFT 10 / WildFly 6), 0 warnings; **MQ XL
golden values correct** (PD 54 / USP 108 / ATOM 54 / USP Cost 6000.48 / Overhead 2400.19 / Total
8400.67). Activate → exactly **one ACTIVE** (DB-confirmed). Audit events present. Edge cases
handled (WildFly has no partner-cost column, WLS "NA" preserved, duplicate M/XS sizes distinct,
multi-line descriptions clean).

### Follow-ups added from Isaac's feedback (all verified)
- **Reactivate archived versions** — lifecycle softened: archive is now reversible (one click
  back to ACTIVE; single-ACTIVE still guaranteed). Documented in `SPEC-design.md §0.1`.
- **Delete a version** — guarded: refused if ACTIVE or referenced by an estimate; cascades its
  variants. (DB-confirmed: 0 orphaned rows after delete.)
- **Edit metadata** — label + financial year + display filename. **Never the as-imported
  effort/cost values** (core principle preserved; correct values by re-importing).
- **Store the original uploaded `.xlsx`** + **Download** it back, with a **timestamped filename**
  (`name_YYYY-MM-DD_HHMMSS.xlsx`). Added `stored_file_path` column via an idempotent migration in
  `db.js`. Verified the download is **byte-identical** to the upload. Versions imported *before*
  this feature correctly show no download ("re-import to enable").
- Server dispatch fix: handlers that stream a response (file download) are detected via
  `res.headersSent` so the server doesn't try to also send JSON (avoids double-send).

### Environment notes / gotchas (carry forward)
- **The real `Middleware_Architecture_Menu_Card_2627(_V5).xlsx` is no longer on the Desktop** —
  Isaac moved/renamed it (dropped the "V5"). For future import tests, ask Isaac for its current
  path. (For one verification I generated a synthetic minimal `.xlsx` with `node:zlib` to drive
  the import→download→integrity check.)
- The **version label comes from the workbook's internal Version tab**, not the filename — so a
  file renamed to drop "V5" still showed label "V5" (correct). Use Edit to relabel if desired.
- Current DB state: one ACTIVE version imported *before* file-storage existed, so it has **no
  download** until re-imported.
- Same shell discipline as before (temp-file + read-back; absolute-path `node` run; port 4000).

### Status
**MDP: In Progress.** Stages 0, 2, 3 (+ Stage 3 follow-ups) code-complete and **verified in
browser by Isaac**. Not "Built" (Phase 1 not shipped).

### Next
- **Stage 4 — Product Catalogue:** read-only browse/search/filter of the active Menu Card's
  variants, for both roles (the catalogue query layer already exists in `repo/menucards.js`).
- Carry forward: Entra ID OIDC seam stub (task 2.7); test harness deferred while npm is blocked.

---

## 2026-10-20 — Spec, stack decision, pivot to dependency-free, Stages 0 + 2

### Summary
Took MDP from a requirements document all the way to a running, authenticated prototype — via
a significant mid-build stack pivot forced by the BT network environment.

### What happened (in order)
1. **Requirements analysis (Plan mode).** Read the MDP requirements doc and the **real
   `Middleware_Architecture_Menu_Card_2627_V5.xlsx`** (extracted via Node's built-in zip/XML —
   the workbook has 6 tabs: Version, Variables, MQ, Weblogic, CFT, WildFly). Key findings that
   shaped the design:
   - PD = Person Days; **USP = Unique Story Points (= PD×2)**; **ATOM (= PD×1)**; costs are
     derived (USP Cost = PD×2×£55.56; Vendor/Overhead = ×40%; Total = ×1.40). MDP **stores all
     six values as-imported and never recomputes** them.
   - **Size is NOT unique within a component** → line identity = **Component + Size +
     Change-Category Description** (the "service variant").
   - Four components have **different per-tab column layouts** → product-aware parser needed.
   - Menu Card is **FY-versioned**.
2. **Decisions locked with Isaac:** 2 roles (Delivery Manager; Administrator = superset);
   multi-user (3–5) shared-state server app (a deliberate departure from the local-first
   family); snapshot-on-add estimate lines; PDF-only export; temp username/password auth now
   with an Entra ID (OIDC) seam later; Estimate Number = **`ARCH-XXXX`** (auto-suggested,
   editable by DM/Admin, unique on save); licence = Internal/open for now; PDFs stored locally
   now → server/GitLab later.
3. **Wrote the SPEC trilogy**, ran the **Spec Reviewer** agent over it ("Needs work — close to
   ready"; verified the MQ XL golden value £8,400.67), and folded in its Blockers/Should-fixes
   (active-version transaction, estimate-number mechanism, backup/restore NFR, etc.).
4. **Agreed stack:** React+Vite / Node+Fastify / Prisma / SQLite(dev)→Postgres|SQL Server(prod).
   Verified **Node v24.21.0 + npm 11.19.0** present (per-user, no admin).
5. **Stage 0 scaffold built** with the npm stack… then hit a wall: **`npm install` is blocked
   by BT's Zscaler proxy** (403 on tarball downloads from `registry.npmjs.org`). Diagnosed
   thoroughly — removing pino-pretty didn't help (thread-stream is a dep of pino, which Fastify
   needs); version overrides hit ETARGET/403; `.npmrc` showed only a Zscaler `cafile` and the
   default public registry; no internal Nexus npm registry was configured/available.
6. **Pivot to Option B — dependency-free build** (Isaac's call). Re-implemented on Node's
   standard library alone:
   - `node:http` (+ in-house router) instead of Fastify
   - `node:sqlite` (confirmed working on v24) instead of Prisma
   - vanilla HTML/CSS/JS instead of React/Vite
   - `node:crypto` scrypt instead of bcryptjs; in-house validators instead of Zod
   - The npm stack is **parked in `_parked-npm-stack/`** (with a README) for possible revival
     if a Nexus registry ever becomes available.
7. **Stage 0 (dependency-free) — DONE + verified in browser.** `app/` server + SQLite +
   vanilla frontend; `/api/health` returns `{status:ok, db:connected}`; manual light/dark theme
   toggle added at Isaac's request. Runs with `node server/server.js` — no install.
8. **Stage 2 — Auth & RBAC — DONE + verified in browser.** Signed HttpOnly session cookie
   (30-min sliding idle), scrypt passwords, two-role RBAC enforced **server-side**, admin user
   management, change-password, LOGIN/LOGOUT **audit events**. Verified end-to-end via curl
   (9-step flow incl. a Delivery Manager correctly 403'd from `/api/users`) and the audit rows
   confirmed in the DB. Login gate, session-aware header (user + role chip + Sign out), and
   role-aware nav (Menu Cards hidden for DMs) all confirmed by Isaac.

### Current state
- **Live code:** `app/` (dependency-free). **Parked:** `_parked-npm-stack/`.
- **Runs:** `node server/server.js` from `app/`, serves API + frontend on **http://127.0.0.1:4000**.
- **Seeded logins (dev only):** `admin`/`admin123` (Administrator), `manager`/`manager123`
  (Delivery Manager).
- **DB:** `app/data/mdp.db` (SQLite; gitignored). 7 tables created; users seeded.
- **Backlog:** `Ideas.md` row = **In Progress** (Complex / Work).
- **MDP status: In Progress** — Stages 0 and 2 code-complete and signed off by Isaac. (Not
  "Built" — that's reserved for Phase 1 shipping per the backlog-sync rule.)

### Environment notes / gotchas (for next session)
- **Do NOT rely on `npm install`** on this machine — Zscaler blocks it. The build is
  deliberately dependency-free. If a BT **Nexus npm registry URL** ever turns up, wire it into
  `.npmrc` and the parked stack becomes viable again.
- **Run the server with an absolute path** (`node "<abs>/app/server/server.js"`) — `cd` into
  the project folder is unreliable because the OneDrive path has spaces + parentheses. The
  server resolves its own paths via `import.meta.url`, so cwd doesn't matter.
- **Port 4000** = our Node server (API + frontend). Not VS Code Live Server (5500), which can't
  run MDP (no backend).
- Shell quirk on this machine: chained/complex PowerShell commands often return no output;
  writing to a temp file + reading it back is the reliable pattern.
- In-memory sessions → restarting the server logs everyone out (fine for the prototype).

### Next up
- **Stage 3 — Menu Card Management:** the Excel import pipeline (product-aware parser for the
  four component layouts → shared costing tail), validation + duplicate flagging, version
  create → **activate (single-ACTIVE transaction)** → archive, import audit, and the admin UI.
  This is where the real `V5` workbook becomes the live catalogue.
- Carry forward: Entra ID OIDC seam stub (task 2.7); a test harness is deferred while npm is
  unavailable.
