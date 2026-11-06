# MDP — dependency-free prototype (`app/`)

This is the **runnable** MDP build: it uses **only Node.js built-ins** (no `npm install`),
because BT's network blocks public npm downloads. See `../_parked-npm-stack/README-PARKED.md`
for the richer Fastify/Prisma/React stack that's parked until npm access is available.

## What it uses (all built into Node, nothing to install)
- **`node:http`** — the web server
- **`node:sqlite`** — a real local SQLite database (Node 22+; confirmed on your Node v24)
- **`node:crypto`** — scrypt password hashing
- **vanilla HTML/CSS/JS** — the frontend (no React/Vite/build step)

The spec, data model, two roles, deterministic calculator, snapshot-on-add and audit log are
**unchanged** from `../SPEC-*.md` — only the implementation technology differs, and it still
ports to the parked stack / Postgres later.

## Requirements
- **Node.js 22 or newer** (you have v24). Nothing else.

## Run it
From **this `app/` folder**, in a terminal:

```bat
node server/server.js
```

That's it — no install step. On first run it creates the local database
(`data/mdp.db`), applies the schema, and seeds two users.

Then open: **http://127.0.0.1:4000**

- Health check (JSON): http://127.0.0.1:4000/api/health
- Seeded logins (dev only — change before real use):
  - `admin` / `admin123` (Administrator)
  - `manager` / `manager123` (Delivery Manager)

Stop the server with **Ctrl+C**.

## Layout
```
app/
  server/        Node built-in backend
    server.js      entry point (node:http)
    config.js      reads optional .env (plain, no dependency)
    db.js          node:sqlite data layer + schema init + seed
    schema.sql     the 7 tables
    crypto-util.js scrypt password hashing
    http-util.js   tiny router + JSON helpers
    static.js      serves the frontend
    constants.js   roles / components / statuses (shared source of truth)
  web/           vanilla frontend (served by the server)
    index.html
    app.js         hash router + views
    api.js         fetch wrapper
    styles/        tokens.css (light/dark) + global.css
  data/          created on first run — SQLite DB + generated docs (gitignored)
```

## Config (optional)
Copy `.env.example` to `.env` to override defaults (port, session secret, DB path). The app
runs fine with no `.env`.

## Tests
A dependency-free regression suite (Node's built-in `node --test`). From this `app/` folder:

```bat
node run-tests.mjs
```

Runs every `test/*.test.mjs` (currently 38 tests) against throwaway temp SQLite DBs — the real
`data/mdp.db` and the sample DB are never touched. See `test/README.md`.

## Backup
Make a consistent, safe backup of the live SQLite database (atomic `VACUUM INTO`; safe to run
while the server is up):

```bat
node backup-db.mjs --verify
```

Writes `data/backups/mdp-backup-<timestamp>.db` and (with `--verify`) runs an integrity check.
Restore = stop the app, copy a backup over `data/mdp.db`, restart. Full procedure + schedule in
`../DEPLOYMENT.md §5`.

## Deployment
Production runs on **SQLite too** (same engine as dev — a Stage 11 decision, for 3–5 users and
to keep the dependency-free guarantee). The full go-live checklist (BT GitLab repo + CI, TLS
reverse proxy, `NODE_ENV=production`, secrets, scheduled backup) is in **`../DEPLOYMENT.md`**.
The parked npm/Prisma/Postgres stack under `../_parked-npm-stack/` is the alternate "Track 2",
revived only if an npm registry or a managed DB is ever needed.

---

*Powered by Forjé*
*© 2026 Isaac A Gera. All rights reserved.*
