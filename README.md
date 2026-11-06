# Middleware Delivery Portal (MDP)

**Phase 1 — Estimation & Planning.** A centralized, multi-user web platform that replaces
spreadsheet-based ("Menu Card") middleware estimation and costing across **IBM MQ, Oracle
WebLogic (WLS), Axway CFT and WildFly**.

> Status: **early version / prototype** (v0.1.0-proto). Runs locally against SQLite; moves to
> PostgreSQL or SQL Server at deployment with a one-line provider switch. Not open-source
> (Internal — see licence note below).

See the spec trilogy for full detail: [`SPEC-requirements.md`](SPEC-requirements.md),
[`SPEC-design.md`](SPEC-design.md), [`SPEC-tasks.md`](SPEC-tasks.md).

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Backend | Node + TypeScript + Fastify |
| Data layer | Prisma ORM |
| DB (prototype/dev) | **SQLite** (local file — no install/admin needed) |
| DB (production) | PostgreSQL or SQL Server (decided at deploy) |
| PDF export | Server-side (pdfmake) |
| Auth | Temp username/password (bcryptjs) → Entra ID (OIDC) seam later |

Monorepo via **npm workspaces**:

```
apps/
  web/        React + Vite + TS SPA
  api/        Node + TS + Fastify API
packages/
  shared/     Shared TS types + Zod schemas + enums
prisma/
  schema.prisma   Prisma schema (provider switched by env)
```

---

## Prerequisites

- **Node.js >= 20** and **npm** (verified: Node v24.21.0 / npm 11.19.0; installs per-user, no
  admin rights required).
- No database to install — the prototype uses SQLite (a local file).

---

## First-time setup

Run these in the project root (`Middleware Delivery Portal (MDP)/`):

```bat
npm install
copy .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run db:seed
```

- `copy .env.example .env` then edit `.env` if needed (defaults work for local dev).
- `prisma:migrate` creates the local SQLite DB (`prisma/dev.db`) from the schema.
- `db:seed` adds a starter Administrator and Delivery Manager user.

## Running (development)

> Start these yourself in a terminal — they are long-running dev servers.

Two terminals (recommended, clearest output on Windows):

```bat
npm run dev:api
```
```bat
npm run dev:web
```

- API: http://localhost:3000  (health check: http://localhost:3000/api/health)
- Web: http://localhost:5173

## Other commands

```bat
npm run prisma:studio   :: browse the local DB
npm run lint            :: ESLint
npm run format          :: Prettier
npm run test            :: Vitest (unit tests)
npm run build           :: production build of all workspaces
```

---

## Data & storage (prototype phase)

- **Database:** local SQLite file at `prisma/dev.db` (gitignored). A real relational DB on the
  same Prisma layer used in production — not browser storage — so the prototype exercises the
  real architecture.
- **Generated PDFs:** saved to a local folder (path in `.env`), with metadata recorded in the
  DB. Moves to the server filesystem / GitLab when deployed (no code change).
- **Secrets:** configuration via `.env` only; never commit `.env` or credentials.

---

## Licence

**Internal / not for distribution** (left open for now). Formal licence/ownership (BT vs other)
to be confirmed before any wider go-live.

---

*Powered by Forjé*
*© 2026 Isaac A Gera. All rights reserved.*
