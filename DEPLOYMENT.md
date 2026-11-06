# MDP — Deployment & Security Notes

Operational security and deployment guidance for the Middleware Delivery Portal. Companion to the
SPEC trilogy (`SPEC-requirements.md`, `SPEC-design.md`, `SPEC-tasks.md`). This document is started
at **Stage 10 (task 10.3 — secrets, TLS, at-rest)** and is expanded at **Stage 11** with the
production-DB, backup/restore and go-live procedure.

> **Current state:** the app is the dependency-free prototype in `app/` (Node built-ins only — no
> `npm install`, because BT's network blocks public npm). It runs over plain HTTP on
> `127.0.0.1:4000` for local development. The notes below describe what MUST change before any
> shared / production deployment.

---

## 0. Go-live checklist (BT side — tasks 11.5 + 11.8)

Everything code/docs/CI is prepared; these steps happen in the BT environment. Do them roughly in
order — provisioning (11.8) first, then the go-live itself (11.5). Section references point to the
detail below.

**Provision (11.8)**
- [x] ~~Create the BT GitLab repo; push `app/` + root files.~~ **DONE 2026-11-06** — pushed to BT Team
  (`robt/app02752/middleware-delivery-portal`), BT Personal (`615509493/…`) and GitHub
  (`isaacgera/Middleware-Delivery-Portal`), branch `main`. A local `all` remote fans out to all three
  (`git push all main`).
- [x] ~~Before the first commit, confirm ignore rules.~~ **DONE** — dry-run verified no `.env`/`data/`/
  `*.db`/`node_modules` tracked (root `.gitignore` added).
- [x] ~~CI runs automatically.~~ **DONE + GREEN** — BT Team pipeline #7894903 PASSED (syntax-check +
  38/38 tests, Docker `node:22`). **Learning:** BT shared runners are **tagged**, so the jobs carry
  `tags: [mobius_shared_runner]` in `.gitlab-ci.yml` (untagged jobs sit "pending/stuck"). If a
  different BT project/runner is used, change that tag to match the runner shown under
  *Settings → CI/CD → Runners*.
- [ ] Provision the BT server: install **Node 22+**; put the app on an **encrypted volume** (BitLocker / BT disk encryption). (§3)
- [ ] Lock file/folder permissions on `data/` (DB + docs) to the app's service account only. (§3)
- [ ] Copy `deploy/mdp.env.sample` → `app/.env`; generate + set a real **`SESSION_SECRET`** (not the dev default) and **`NODE_ENV=production`**. (§1, §2 — ready-made template in `deploy/`.)
- [ ] **Change the seeded passwords** — `admin123` / `manager123` must not survive to prod. (§1)
- [ ] Run MDP as a **service** that starts on boot + restarts on crash — see `deploy/run-as-service-windows.md` (NSSM or Task Scheduler).
- [ ] Schedule the daily **backup** via Task Scheduler calling `deploy/backup-mdp.cmd` (runs `backup-db.mjs --verify` + an **off-box copy**). (§5)

**Go live (11.5)**
- [ ] Run the app with `NODE_ENV=production`; bind to loopback (`127.0.0.1`) so only the proxy reaches it. (§2)
- [ ] Put a **TLS reverse proxy** in front — ready-made configs in `deploy/`: `nginx-mdp.conf` (nginx) or `iis-web.config-notes.md` (IIS + ARR). HTTPS cert on the proxy; HTTP→HTTPS redirect. (§2)
- [ ] **Smoke-test with real users** over HTTPS: log in (both roles), create a request + add lines, export a PDF, view Dashboards/Analytics, check Audit. (task 11.5)
- [ ] Confirm the backup task has produced at least one verified snapshot before announcing go-live. (§5)

**Once-only / as-needed**
- [ ] Confirm whether the server is locked down / has a Nexus registry — decides if **Track 2** (npm + Postgres/SQL Server) ever becomes relevant. (§4)
- [ ] Entra ID OIDC for real identity (task 2.7) — when tackled, replaces the seeded users.

---

## 1. Secrets — environment only (task 10.3)

**Principle:** no secret is ever hardcoded in source or committed to version control. Every secret
is read from the environment (via a process env var, or a local `.env` file that is never
committed), with a dev-only default so the prototype runs out of the box.

| Secret / sensitive value | Source | Dev default | Production requirement |
|---|---|---|---|
| `SESSION_SECRET` | env / `.env` (`config.sessionSecret`) | `dev-only-change-me-secret` | **Mandatory override** with a long, random value (see below). Signs the session cookie HMAC — a known secret lets anyone forge a session. |
| `DB_PATH` / DB connection | env (`config.dbPath`) | `./data/mdp.db` (local SQLite) | Points at the production DB (Stage 11). Keep any DB username/password in env, never in source. |
| `DOC_STORAGE_DIR` | env (`config.docStorageDir`) | `./data/generated-docs` | Set to the production document location (A6 / O2). |
| Seeded user passwords | `db.js seedUsers` (dev seed) | `admin123` / `manager123` | **Change immediately** on any real deployment; the seed is for local dev only and prints a "change these" warning. |

**Generate a production session secret** (any one of):

```bat
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Set it in the deployment environment (never in a committed file), e.g. `SESSION_SECRET=<value>`.

### Nothing sensitive is committed — verified (2026-11-05)
- There is **no `.env` file on disk** — the app runs on built-in defaults, so there is no real
  secret to leak.
- `.gitignore` (`app/.gitignore`) already excludes `.env`, `data/`, `*.db`, `*.db-journal`,
  `*.sqlite`, `*.log` — so the real database (`data/mdp.db`), the sample DB, generated docs and
  uploaded Menu Cards are all excluded from version control.
- The MDP folder is **not yet a git repo** (repo init is Stage 11.1), so nothing is tracked yet.
  When the repo is created, confirm the ignore rules are active before the first commit
  (`git status` should not list `.env`, `data/`, or any `.db`).

---

## 2. Transport security — TLS (task 10.3)

The app server (`node:http`) serves **plain HTTP** and binds to `127.0.0.1` for local dev. It does
**not** terminate TLS itself. For any shared/production deployment:

- **Run behind a TLS-terminating reverse proxy** (nginx, IIS/ARR, a cloud load balancer, or
  BT-standard ingress). The proxy holds the certificate and forwards to the app over the loopback
  / private network. (This is the Stage 11.5 "deploy behind TLS reverse proxy" step.)
- **Set `NODE_ENV=production`.** This flips `config.isProd`, which adds the **`Secure`** attribute
  to the session cookie (`sessions.js`) so the browser only ever sends it over HTTPS. Without it,
  the cookie could travel over plain HTTP.
- The session cookie is already **`HttpOnly`** (no JS access) and **`SameSite=Lax`** (CSRF
  mitigation) in all environments; `Secure` is the one flag gated on production.
- **Redirect HTTP→HTTPS** at the proxy, and consider HSTS once the certificate chain is stable.
- Bind the app to the loopback or a private interface so it is only reachable **through** the
  proxy, never directly.

---

## 3. Data at rest (task 10.3)

- **Prototype:** data lives in a local SQLite file (`data/mdp.db`) plus generated documents and
  uploaded Menu Card `.xlsx` files under `data/`. These are developer-machine files, gitignored,
  not encrypted.
- **Production (SQLite — see §4 for the decision):**
  - The DB is a single SQLite file on the BT server. Put it on a volume with **encryption at rest**
    (BitLocker / BT disk encryption) and restrict NTFS/file permissions to the app's service
    account only. SQLite has no server-side at-rest encryption of its own, so this is a
    filesystem-level control.
  - Store generated PDFs / uploaded Menu Cards on the same access-controlled, encrypted volume.
  - Restrict filesystem/DB permissions to the app's service account only.
  - **Passwords** are stored only as salted **scrypt** hashes (`crypto-util.js`) — never plaintext,
    never reversible. The dev seed passwords must still be changed on deployment.
  - **Local-first stance holds:** MDP sends no user data off-device/off-host to any third party.
    There is no analytics, tracking, or external call with customer data. (The only outbound
    concern to watch is the future Entra ID OIDC seam — task 2.7, Stage 11 — which would talk to
    the identity provider only.)

---

## 4. Production database decision (task 11.2) — SQLite, with an npm/Postgres escape hatch

**Decision (2026-11-05, Isaac):** production runs on **SQLite** (`node:sqlite`), the same engine as
dev. Two tracks are maintained:

- **Track 1 — live (`app/`), dependency-free, SQLite in prod.** This is what deploys to BT.
- **Track 2 — parked (`_parked-npm-stack/`), Prisma + Fastify + React, Postgres/SQL Server.** The
  "other direction": revived only if BT allows an npm/Nexus registry **or** a managed DB is later
  mandated for data-governance/scale reasons. Prisma's one-line provider switch (SPEC-design §8)
  still applies to that track.

**Why SQLite for production here:**
- **Scale fits.** 3–5 concurrent internal users is comfortably within single-file SQLite territory.
  A managed Postgres/SQL Server would add scale we'll never use plus real ops burden.
- **Keeps the dependency-free guarantee.** No DB driver ships inside Node, so a managed DB would
  reintroduce the exact npm dependency the build avoids — risky when the BT server's lock-down
  status is unconfirmed. SQLite needs nothing installed.
- **"SQLite-green" risk dissolves (task 11.3).** The design-§8 worry ("don't trust SQLite in dev,
  the prod DB differs") only applied to a *different* prod engine. Here dev and prod are the **same
  engine**, so the `node --test` suite — which already runs against real `node:sqlite` throwaway
  DBs — IS the production-DB test pass. 11.3 reduces to "run `node app/run-tests.mjs` on the
  deployment box's Node" (done automatically by CI, see `.gitlab-ci.yml`).

**Revisit triggers for Track 2:** sustained concurrency well beyond ~5 users, a mandate for a
central managed DB, or BT confirming an npm/Nexus registry is available on the server.

---

## 5. Backup & restore (task 11.6 — a go-live gate)

SQLite backup is simple *and* must be done safely (never a raw copy of a live file). Use the
provided dependency-free script, which uses SQLite's atomic `VACUUM INTO`:

### Back up
From the `app/` folder:
```bat
node backup-db.mjs --verify
```
- Writes a consistent snapshot to `app/data/backups/mdp-backup-<timestamp>.db` (safe while the
  server is running).
- `--verify` reopens the backup, runs `PRAGMA integrity_check`, and prints row counts per table.
- `--db <path>` / `--out <dir>` override source/destination. Exit code is non-zero on failure, so a
  **Windows Task Scheduler** job (or cron) can detect problems.

**Schedule:** a daily scheduled task running the command above, writing to an
encrypted/backed-up location (and ideally copied off-box). Retain e.g. 30 daily snapshots; prune
older ones.

### Restore
1. **Stop the app** (so nothing is mid-write).
2. Copy the chosen `mdp-backup-<timestamp>.db` over the live DB path (default `app/data/mdp.db`).
   Keep the file you restored FROM.
3. Restart the app. Confirm the health check and a couple of screens.

### Restore verified (no data loss) — 2026-11-05
The backup→restore round-trip was tested against the real dev DB: `VACUUM INTO` snapshot +
`integrity_check: ok`, and a table-by-table row-count + content-fingerprint comparison between the
live DB and the backup matched exactly (users/menu-cards/variants/estimates/lines/audit/docs all
equal). **Result: lossless.** This satisfies the 11.6 "tested restore" gate for the SQLite track.

---

## 6. Operational notes (task 11.7)

- **O1 — Session timeout:** 30 min idle, sliding (`SESSION_IDLE_MINUTES`, `sessions.js`). Confirm
  the final value with the team; change via env, no code change.
- **O3 — Request reference:** internal `MDP-XXXX` (auto, hidden) + user-typed unique **JIRA
  Reference** (mandatory, 409 on duplicate). Settled in Stage 5.
- **O5 — Generated-PDF retention:** no automatic cleanup (conscious omission). PDFs are
  client-generated and recorded as metadata only; revisit if the `generated_documents` table or the
  doc folder grows large.
- **Sessions are in memory:** restarting the server logs everyone out (acceptable at this scale).
- **Single-writer note:** SQLite serialises writes; at 3–5 users this is invisible. If a future
  load profile ever shows write contention, that's a Track-2 (Postgres) signal, not a tuning knob.

---

## 7. Still on the BT side (can't be completed from the dev session)

These need the real environment and are yours to action; the code/docs/CI above are the groundwork:

- **11.1** Create the BT GitLab repo and push; the included `.gitlab-ci.yml` runs syntax-check +
  the test suite on every push/MR. Confirm the ignore rules before the first commit (§1).
- **11.5** Deploy behind the BT TLS reverse proxy; set `NODE_ENV=production`; smoke-test with real
  users.
- **11.6 (operational)** Wire the backup command into a scheduled task on the server + an off-box
  copy; the *procedure* is proven above.
- **2.7** Entra ID OIDC for real identity (replaces the dev seed users) — Track-appropriate when
  tackled.
- **Confirm** whether the BT server is locked down / has a Nexus registry (decides if Track 2 ever
  becomes relevant).

---

*Powered by Forjé*
*© 2026 Isaac A Gera. All rights reserved.*
