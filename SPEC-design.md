# Middleware Delivery Portal (MDP) — SPEC: Design

- **Project:** Middleware Delivery Portal (MDP)
- **Phase:** Phase 1 — Estimation & Planning
- **Companion docs:** `SPEC-requirements.md`, `SPEC-tasks.md`
- **Last updated:** 2026-11-05 (Stage 12 Spec-Reviewer alignment — §1 diagram + §2 stack table now show Live Track 1 / parked Track 2 side by side; §0 DB note + §8 reflect SQLite-in-prod. Earlier: 2026-10-28 §10.5 Catalogue integration, Stage 9 reframe.)

This document defines the Phase 1 technical architecture. It assumes the requirements and
Menu Card analysis in `SPEC-requirements.md` (especially Section 4 — the real workbook
structure, and the `Component + Size + Description` variant identity).

---

## 0. Implementation note — stack change (2026-10-20)

> **The target stack below (Fastify / Prisma / React + Vite) could not be installed on the
> BT machine.** BT's network (Zscaler SSL-inspecting proxy) blocks `npm install` tarball
> downloads from the public registry with 403s, and no internal Nexus npm registry was
> available/configured. After exhausting the package-level and registry-level options, the
> prototype was **re-implemented dependency-free** so it runs on Node's standard library alone
> (confirmed working on Node v24.21.0, no `npm install`).
>
> **Dependency-free substitutions (the only thing that changed — the design intent below holds):**
> | Target (parked) | Dependency-free build (live, in `app/`) |
> |---|---|
> | Fastify | `node:http` + a tiny in-house router (`http-util.js`) |
> | Prisma ORM | `node:sqlite` + thin query layer (`repo/*.js`) |
> | React + Vite | vanilla HTML/CSS/JS (ES modules), served by the Node server |
> | bcryptjs | `node:crypto` scrypt (`crypto-util.js`) |
> | Zod | small in-house validators (`validate.js`) |
> | pdfmake (planned, server-side) | **vendored jsPDF, client-side** (Stage 7 — generated in the browser, delivered adaptively) |
>
> **Unchanged:** the data model (7 entities), the two roles + RBAC, snapshot-on-add, the
> FY-versioned Menu Card, the single-ACTIVE transaction rule, deterministic calculation, and the
> audit log. The original npm stack is preserved under `_parked-npm-stack/` and can be revived if
> BT npm access (a Nexus registry) ever becomes available. **Live code lives in `app/`.**
>
> **Note on the DB (Stage 11, 2026-11-05):** the live track now runs **SQLite in production too**
> (not Postgres/SQL Server) — see §8. The §1 diagram and §2 table have been updated to show both
> tracks side by side, so they no longer need mental mapping; Track 2 is clearly labelled as parked.

### 0.1 Menu Card lifecycle refinement (2026-10-20, Stage 3 feedback)

The original "immutable once activated; archived is final" stance has been softened for
practical use, without weakening the core principle:

- **ARCHIVED is reversible** — an archived version can be **reactivated** (promoted back to
  ACTIVE, demoting whatever is currently active). The single-ACTIVE invariant still holds via
  the activation transaction. Archive now means "not currently active," not "retired forever."
- **Delete a version** is allowed, but **guarded**: refused if the version is ACTIVE, or if any
  **estimate references it** (protecting snapshot integrity / avoiding orphaned pinned
  estimates). Deleting cascades its variants.
- **Metadata edit** is allowed for **label and financial year only**. The **as-imported
  effort/cost values are never editable** — the core "deterministic calculator over approved,
  unaltered Menu Card values" principle is preserved; correct values by re-importing a
  corrected workbook as a new version.

---

## 1. Architecture Overview

MDP is a conventional **client ⇄ API ⇄ database** web application (not local-first, not a PWA).

**Live architecture (Track 1 — dependency-free, what ships):**
```
┌──────────────┐     HTTPS/JSON      ┌──────────────┐    node:sqlite   ┌──────────────┐
│  Browser SPA │  ───────────────▶  │  API server  │  ───────────▶  │   Database   │
│ vanilla HTML │  ◀───────────────  │ node:http    │  ◀───────────  │ SQLite file  │
│  /CSS/JS (ES)│                     │ (Node stdlib)│                 │ (dev + prod) │
└──────────────┘                     └──────┬───────┘                 └──────────────┘
        │ client-side jsPDF (vendored)       │ writes/reads
        ▼ download / share sheet             ▼
   customer PDF                     ┌──────────────────┐
   (bytes in browser)              │ Server filesystem │  export METADATA only
                                   │  (doc store)      │  (path marker + DB record)
                                   └──────────────────┘
```
> The PDF is generated **in the browser** (vendored jsPDF) and delivered adaptively; the server
> stores only the export's metadata. (Track 2 — the parked React+Vite / Fastify / Prisma /
> pdfmake stack — would render the PDF server-side; see §0 and §2.)

- **Single backend process + single database** — right-sized for 3–5 concurrent users.
- **Shared state:** the DB is the single source of truth; every client reads/writes it, so all
  users see the same estimates and (later) finance data.
- **Stateless-ish API** with server-side sessions for auth; horizontal scaling is not required
  for Phase 1 but nothing in the design precludes it later.

---

## 2. Technology Stack

> **Read this table as two tracks.** The **Live build (Track 1)** column is what actually ships
> — dependency-free, Node standard library only (BT blocks npm; see §0). The **Parked target
> (Track 2)** column is the original npm stack, preserved under `_parked-npm-stack/` and revived
> only if BT provides an npm/Nexus registry or mandates a managed DB. Everything that matters —
> data model, RBAC, snapshot-on-add, single-ACTIVE rule, deterministic calculation, audit — is
> identical across both tracks; only the technology differs.

| Layer | **Live build (Track 1 — ships)** | Parked target (Track 2) | Notes |
|---|---|---|---|
| **Frontend** | **Vanilla HTML/CSS/JS** (ES modules), served by the Node server | React + Vite + TypeScript | Interactive grids, live totals, catalogue search, dashboards — all hand-rolled, no build step. |
| **Backend** | **`node:http`** + a tiny in-house router (`http-util.js`) | Node + TypeScript + Fastify | Node v24.21.0, no admin, no `npm install`. |
| **Data layer** | **`node:sqlite`** + thin query repos (`repo/*.js`), hand-written SQL | Prisma ORM | Track 2's "one-line provider switch" does not apply to Track 1 (it uses SQLite in prod too — §8). |
| **Database** | **SQLite** — dev AND prod (Stage 11 decision) | SQLite (dev) → PostgreSQL / SQL Server (prod) | 3–5 users fit SQLite comfortably; keeps the dependency-free guarantee. See §8 + DEPLOYMENT.md §4. |
| **Auth** | Server-side session (signed HttpOnly cookie) + **`node:crypto` scrypt** hashing; **Entra ID (OIDC) seam** present (integration deferred) | bcryptjs + same seam | Temp login shipped; OIDC is task 2.7. |
| **PDF** | **Client-side, vendored jsPDF** — generated in the browser, delivered adaptively; server records metadata only | Server-side pdfmake (Puppeteer fallback) | Changed in Stage 7 (req R7). |
| **Charts** | **Hand-rolled inline SVG** (`charts.js`) — bars, donuts, line | Chart.js / Recharts | Dependency-free; themed + accessible. |
| **Excel import** | **In-house `.xlsx` reader** (`xlsx.js`: ZIP inflate via `node:zlib` + regex XML) | ExcelJS / SheetJS | Header-text column mapping; the real V5 workbook verified. |
| **Validation** | **In-house validators** (`validate.js`) | Zod (shared FE/BE schemas) | Same intent — explicit, typed-at-the-edge input checks. |

### 2.1 Repository layout (monorepo, npm workspaces)
```
mdp/
  package.json            # workspaces: apps/*, packages/*
  apps/
    web/                  # React + Vite + TS SPA
    api/                  # Node + TS + Fastify
  packages/
    shared/               # shared TS types + Zod schemas (DTOs, enums)
  prisma/
    schema.prisma         # datasource provider switched by env
    migrations/
  docs/                   # SPEC files, this design, ADRs
  .env.example            # documented config keys (no secrets committed)
```

---

## 3. Data Model (Prisma schema — logical)

> Money stored as integer **minor units (pence)** or `Decimal` to avoid float drift; PD/USP/
> ATOM may be fractional (e.g. 0.5, 1.25) so stored as `Decimal`/`Float` with fixed precision.
> **Snapshotted values on `EstimateLine` are the source of truth for an estimate's figures.**

### 3.1 Entities

**User**
- `id` (uuid, pk), `username` (unique), `passwordHash`, `displayName`, `email`,
  `role` (enum: `DELIVERY_MANAGER` | `ADMINISTRATOR`), `isActive` (bool),
  `createdAt`, `lastLoginAt`.

**MenuCardVersion**
- `id` (pk), `label` (e.g. "V5"), `financialYear` (e.g. "FY27"), `sourceFilename`,
  `uploadedById` (fk User), `uploadedAt`, `status` (enum: `DRAFT` | `ACTIVE` | `ARCHIVED`),
  `blendedUspRate` (Decimal, e.g. 55.56), `overheadPct` (Decimal, e.g. 40),
  `peopleDayRate` (Decimal, e.g. 144), `importSummary` (json: row counts, warnings).
- **Invariant — at most one `ACTIVE`:** enforced authoritatively by a **serialized
  activation transaction** (see §5 step 7 and §9): activating version N demotes the current
  ACTIVE→ARCHIVED and promotes N→ACTIVE atomically in one transaction, so the invariant never
  depends on a DB partial/filtered unique index (which Prisma does not model portably across
  SQLite/Postgres/SQL Server). A unique index may be added on supported providers as belt-and-
  braces, but the transaction is the guarantee.
- Immutable once `ACTIVE` (no edits; corrections = new version).

**ServiceVariant**  (catalogue line)
- `id` (pk), `menuCardVersionId` (fk), `component` (enum: `MQ` | `WLS` | `CFT` | `WILDFLY`),
  `size` (string: TO/XS/S/M/L/XL/XXL — data-driven, not a hard enum),
  `changeCategory` (string), `description` (text), `scope` (text), `assumptions` (text),
  `exclusions` (text),
  `pd` (Decimal), `usp` (Decimal), `atom` (Decimal), `uspCost` (Decimal),
  `overheadCost` (Decimal), `totalCost` (Decimal), `currentPartnerCost` (string, nullable),
  `effortPhases` (json: the per-component phase columns, stored for reference),
  `rowIndex` (int, source row for traceability).
- **Natural key within a version:** `(menuCardVersionId, component, size, description)` —
  unique; duplicates flagged at import.

**Estimate**  (header)
- `id` (pk), `estimateNumber` (unique, system-generated), `name`, `customerName`,
  `opportunityRef`, `description`, `version` (int, for estimate's own versioning),
  `status` (enum: `DRAFT` | `UNDER_REVIEW` | `APPROVED` | `ARCHIVED`),
  `menuCardVersionId` (fk — **pinned** card version), `createdById` (fk), `createdAt`,
  `updatedAt`, `rowVersion` (int/timestamp — optimistic concurrency).

**EstimateLine**
- `id` (pk), `estimateId` (fk), `serviceVariantId` (fk — provenance),
  `component`, `size`, `description` (denormalised for display stability),
  `quantity` (Decimal),
  **snapshot fields** (captured at add-time): `snapPd`, `snapUsp`, `snapAtom`, `snapUspCost`,
  `snapOverheadCost`, `snapTotalCost` (all Decimal),
  `notes` (text), `sortOrder` (int).
- Line computed values = snapshot × quantity (computed in API/engine, not stored unless
  cached).

**AuditEvent**  (append-only)
- `id` (pk), `userId` (fk, nullable for pre-login failures), `timestamp`,
  `action` (enum: LOGIN, LOGOUT, MENUCARD_UPLOAD, MENUCARD_ACTIVATION, ESTIMATE_CREATE,
  ESTIMATE_MODIFY, ESTIMATE_DELETE, ESTIMATE_EXPORT),
  `objectType` (string), `objectId` (string), `detail` (json).
- No update/delete paths exposed.

**GeneratedDocument**
- `id` (pk), `estimateId` (fk), `format` (enum: `PDF`), `filePath` (server path),
  `fileName`, `generatedById` (fk), `generatedAt`, `menuCardVersionId` (fk, for provenance),
  `sizeBytes`.

### 3.2 Relationships
- `MenuCardVersion 1─* ServiceVariant`
- `MenuCardVersion 1─* Estimate` (pinned)
- `Estimate 1─* EstimateLine`
- `ServiceVariant 1─* EstimateLine` (provenance; line keeps its own snapshot + denorm fields)
- `Estimate 1─* GeneratedDocument`
- `User 1─* Estimate` / `AuditEvent` / `GeneratedDocument`

---

## 4. Calculation Engine (deterministic)

Pure function, server-side, no persistence of derived totals required:

```
linePD        = snapPd        × quantity
lineUSP       = snapUsp       × quantity
lineATOM      = snapAtom      × quantity
lineUSPCost   = snapUspCost   × quantity
lineOverhead  = snapOverheadCost × quantity
lineTotalCost = snapTotalCost × quantity

estimate.totalPD        = Σ linePD
estimate.totalUSP       = Σ lineUSP
estimate.totalATOM      = Σ lineATOM
estimate.totalUSPCost   = Σ lineUSPCost
estimate.totalOverhead  = Σ lineOverhead
estimate.grandTotalCost = Σ lineTotalCost
```

- No rate/overhead recomputation. Rates live on `MenuCardVersion` for reference/Phase-2 only.
- Decimal arithmetic (no binary float) for money; round only at display/export.

---

## 5. Menu Card Import Pipeline (Module 2)

1. **Receive** uploaded `.xlsx` (Admin only); size/type guarded.
2. **Parse per worksheet** with a **component-specific column map** (the four layouts in
   requirements §4.2) — each maps its effort-phase columns + the shared costing tail.
   **Worksheet-name → component-enum mapping is explicit** (config-driven): worksheet
   `MQ`→`MQ`, `Weblogic`→`WLS`, `CFT`→`CFT`, `WildFly`→`WILDFLY`. (Note the tab is literally
   "Weblogic" but the enum is `WLS`.) Unknown/extra worksheets (e.g. `Version`, `Variables`)
   are handled explicitly, not treated as components.
3. **Normalise** cell text (strip embedded tabs/`\t`, collapse newlines in descriptions).
4. **Read `Variables`/`Version` tabs** → capture blendedUspRate, overheadPct, peopleDayRate,
   label, FY.
5. **Validate:** mandatory Component/Size/PD/Total; flag duplicate variants; collect warnings.
6. **Stage as `DRAFT` MenuCardVersion** with its ServiceVariants; present a review summary
   (counts, warnings, diffs vs current active) before activation.
7. **Activate** (explicit Admin action, transactional): new version → `ACTIVE`, prior active →
   `ARCHIVED`; write `MENUCARD_UPLOAD` + `MENUCARD_ACTIVATION` audit events.
8. Parser column maps are **config-driven** so a future component or layout tweak is a mapping
   change, not a rewrite.

---

## 6. API Surface (representative REST, JSON)

### 6.1 Estimate Number (`ARCH-XXXX`, auto-suggested + editable)
Format is `ARCH-XXXX` (fixed `ARCH-` prefix). On new-estimate, the API **suggests** the next
default by taking the current max `XXXX` + 1 (zero-padded to 4+ digits), but the DM/Admin may
**edit the `XXXX`**. Because the value is user-editable it cannot rely on a collision-proof
sequence, so **uniqueness is a validated constraint**: `estimateNumber` has a **unique index**,
and create/update runs inside a transaction that rejects a duplicate with a clear 409-style
error ("Estimate number already in use"). The auto-suggest is a convenience default only; the
unique index is the guarantee. (This supersedes the earlier sequence-only approach now that the
number is editable.)

Auth & session
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `POST /api/users/me/password`

Users (Admin)
- `GET/POST /api/users` · `PATCH /api/users/:id` (activate/deactivate, role)

Menu Cards (Admin for writes)
- `POST /api/menucards/import` (multipart) → draft + summary
- `POST /api/menucards/:id/activate` · `POST /api/menucards/:id/archive`
- `GET /api/menucards` · `GET /api/menucards/:id` · `GET /api/menucards/active`

Catalogue
- `GET /api/catalogue?component=&size=&q=` (from active version)
- `GET /api/catalogue/variants/:id`

Estimates
- `GET /api/estimates?number=&customer=&component=&status=&createdBy=&from=&to=`
- `POST /api/estimates` · `GET /api/estimates/:id` · `PATCH /api/estimates/:id`
  (name/customer/status… with `rowVersion` optimistic check)
- `POST /api/estimates/:id/clone` · `POST /api/estimates/:id/archive`
- Lines: `POST /api/estimates/:id/lines` (snapshots on add) ·
  `PATCH .../lines/:lineId` · `DELETE .../lines/:lineId` ·
  `POST .../lines/:lineId/duplicate`
- `GET /api/estimates/:id/totals`

Export
- `GET /api/estimates/:id/export/pdf/preview` → renders the PDF to a **transient stream and
  does NOT persist** a `GeneratedDocument` (inline preview; no audit event)
- `POST /api/estimates/:id/export/pdf` → generates, **stores on filesystem + records
  `GeneratedDocument`**, writes `ESTIMATE_EXPORT` audit event, returns doc metadata/stream
- `GET /api/documents/:id` (download a previously generated, persisted PDF)

Dashboards
- `GET /api/reports/volume` · `GET /api/reports/by-product` · `GET /api/reports/value`

Audit (Admin)
- `GET /api/audit?user=&action=&from=&to=`

Every protected route re-checks role server-side (RBAC middleware).

---

## 7. Authentication & RBAC Design (with Entra ID seam)

- **AuthProvider interface** (seam): `authenticate(credentials) → principal`,
  `getPrincipal(session)`. Phase 1 implementation = `LocalPasswordProvider`. **Password
  hashing: `bcryptjs` (pure-JS, no native build toolchain)** — preferred over `argon2`/native
  `bcrypt` because the locked-down, no-admin Windows dev machine (requirements A5) may lack the
  native build tools those need, the same reasoning that chose pdfmake over Puppeteer. Revisit
  Argon2 only if it installs cleanly in the target environment. Future = `EntraOidcProvider` implementing the same interface —
  **only this module changes.**
- Session: secure, http-only, same-site cookie; configurable idle timeout (NFR3/O1).
- **RBAC middleware** guards routes by role; `ADMINISTRATOR` ⊇ `DELIVERY_MANAGER`.
- UI hides disallowed actions **and** the API enforces them (defence in depth).

---

## 8. Dev→Prod Database Portability

> **Stage 11 decision (2026-11-05): production runs on SQLite — the live track does NOT switch DB.**
> The Prisma "one-line provider switch" below describes the **parked Track 2** (`_parked-npm-stack/`),
> kept as an escape hatch. The live dependency-free `app/` build (`node:sqlite`, hand-written SQL)
> ships SQLite to production unchanged. See DEPLOYMENT.md §4 for the full rationale.

**Two tracks:**

- **Track 1 — live (`app/`), SQLite in dev AND prod.** Chosen because: 3–5 concurrent users fit
  single-file SQLite comfortably; it preserves the dependency-free guarantee (no DB driver to
  install on a possibly-locked-down BT server); and — the key point — **dev and prod are the same
  engine**, so the "never treat SQLite-green as production-green" discipline below *dissolves*: the
  `node --test` suite already runs against real `node:sqlite` throwaway DBs, so it IS the
  production-DB test pass (task 11.3). There is no SQL-dialect gap to manage on this track.
- **Track 2 — parked (`_parked-npm-stack/`), Prisma + Postgres/SQL Server.** The original portable
  plan, revived only if BT allows an npm/Nexus registry or mandates a managed DB. For that track:
  - Single `prisma/schema.prisma`; `datasource.provider` + `DATABASE_URL` from env
    (dev `sqlite` → prod `postgresql`/`sqlserver`).
  - **Known divergences to manage** (Track 2 only): type affinities, case-sensitivity, some
    functions/`Decimal` precision differ between SQLite and PG/MSSQL — so for THAT track the
    discipline holds: run migrations + the full test suite against the **actual production DB**
    before go-live; never treat SQLite-green as production-green.

**Revisit triggers for Track 2:** sustained concurrency well beyond ~5 users, a central-managed-DB
mandate, or confirmation that the BT server has a usable npm/Nexus registry.

---

## 9. Non-Functional Design Notes

- **Concurrency (NFR7):** `rowVersion` optimistic-concurrency on `Estimate` updates → reject
  stale writes with a clear "reload" conflict; transactions around Menu Card activation and
  status changes.
- **Performance (NFR3):** indexed search columns (estimateNumber, customerName, status,
  component, createdAt); paginated list endpoints.
- **Encryption (NFR6):** TLS at the reverse proxy; DB at-rest encryption at the server/engine
  level; secrets via env.
- **Audit (NFR5):** write audit events in the same transaction as the audited action where
  feasible; append-only.
- **Accessibility/responsive (NFR9):** semantic HTML, keyboard-navigable grids, visible focus,
  desktop-first layout degrading to tablet; light/dark via design tokens.
- **Branding:** unobtrusive "Powered by Forjé" + copyright footer (© Isaac A Gera), excluded
  from generated PDF/customer output.

---

## 10. Phase-2+ Forward-Compatibility (no redesign required)

- **Financials:** add `ActualRecord`/`RevenueRecord` tables linked to `Estimate`
  (estimated-vs-actual); FY already on `MenuCardVersion`/pinned per estimate.
- **Dashboards (P3):** read models/materialised queries over existing audit + estimate data.
- **Flow analytics & work projection (Stage 9, reframed 2026-10-28):** the append-only audit log
  already timestamps every `ESTIMATE_CREATE` and status change, so a request's journey across
  stages is recoverable — the raw material for **throughput, cycle time, per-stage dwell time,
  aging, and pipeline PD/cost**, plus a simple **run-rate projection** (backlog ÷ recent
  PD/month-to-Done ≈ N months of work). Two design points: (1) the status-transition event must
  record **`{ from, to }`**, not just the new status, so transitions are a clean record rather
  than a reconstruction — hence task **8.5 (do early)**, because history accrued before that lands
  can't be fully reconstructed. (2) Deliberately **flow analytics + run-rate, not a statistical
  forecasting model** — at 3–5 users and modest volume, honest flow metrics are the right ceiling;
  a predictive model would overstate certainty. If request volume ever grows enough to justify it,
  a proper forecasting layer slots in as a read-only analytics service over the same history (P4),
  with no change to the core write model.
- **AI (P4):** read-only analytics service over the historical store; no change to core write
  model.
- **Entra ID:** swap auth provider (§7).
- **DOCX:** add a second exporter behind the same export interface used for PDF.

---

## 10.5 Menu Card Catalogue integration (planned — after Phase 1 core)

The standalone **Menu Card Catalogue** app (`Work/Menu Card Catalogue/`, a Built client-only
PWA) and MDP already **share the same parsing brain**: the Catalogue's `js/parser.js` and
`js/xlsx-reader.js` are faithful browser ports of MDP's `server/menucard-parser.js` and
`server/xlsx.js` (same header-text column mapping, same confirmed cost-column off-by-one, same
golden values — MQ XL = £8,400.67). They diverge only in runtime: MDP parses in Node and stores
to SQLite with versioning/auth/audit; the Catalogue parses in the browser and stores to
localStorage, single-user, offline, no server.

So "integration" is not about reconciling two logics — it's about how the catalogue viewer
relates to the server that already holds the authoritative data.

### Options considered
1. **Catalogue as a read-only view of MDP's live data.** The standalone app fetches MDP's active
   Menu Card (the existing `GET /api/catalogue`) instead of importing its own `.xlsx`. One source
   of truth, but the Catalogue loses its offline/standalone independence (needs the server +
   auth). Low–ish effort.
2. **Fold the Catalogue into MDP as its built-in catalogue UI. ◀ CHOSEN.** Retire the standalone
   app and make its polished table / pill filters / PDF export the front-end for MDP's existing
   Stage 4 catalogue (currently more basic). Best data layer (MDP) + best viewer UI (Catalogue),
   one app, no sync problem. Cost: anyone who just wants to browse now needs MDP; porting the UI
   into MDP's view layer is real work. Medium effort.
3. **Keep both; share the engine via a common module.** Extract the parser + xlsx reader into one
   shared core both apps import (MDP wrapping Node I/O, the Catalogue wrapping browser I/O). Kills
   the duplicated-parser drift risk; both apps keep their identity. But the data stays in two
   separate copies — not true integration. Low–medium effort.
4. **Export/import bridge.** MDP exports the active Menu Card as catalogue JSON (the Catalogue's
   `mcc_catalogue_v1` shape); the Catalogue imports it alongside `.xlsx`. Tiny change, both stay
   independent/offline, but it's a manual point-in-time snapshot, not live. Low effort.

### Decision (2026-10-28)
**Option 2 — fold the Catalogue into MDP as its built-in catalogue UI**, scheduled **after MDP's
Phase 1 core is complete** (Stages 5 sign-off, 6 Repository, 7 PDF export). Rationale: one source
of truth, no duplicate imports, and MDP's governed data under the nicer Catalogue viewer. The
standalone PWA remains Built and untouched until the port is done and verified, then is retired
deliberately (not deleted without sign-off).

### Notes for when we reach it
- The Catalogue's UI (pill filters, generic + per-column search, stacked-card mobile view,
  full-catalogue PDF via vendored jsPDF with adaptive delivery) is the target front-end; MDP's
  Stage 4 `web/views/catalogue.js` is what it would replace/upgrade.
- Column labels already match the team's terms (Story Points / TCS Cost / FTE Cost / Total Cost)
  in both apps — no reconciliation needed.
- MDP's PDF story is server-side (pdfmake planned, Stage 7). Decide at port time whether the
  catalogue PDF stays client-side (reuse the vendored jsPDF approach) or moves server-side for
  consistency with estimate/request exports.
- Shared parsing logic should ideally converge (Option 3's extraction) *as part of* this port, so
  there's one parser, not two — removing the standing drift risk for good.
- Re-confirm licence/branding carry across (both are © Isaac A Gera, Internal/open for now).

---

## 11. Key Design Decisions (ADR-style summary)

1. **All-TypeScript (React/Vite + Node)** over Next.js+FastAPI — single language, lightest
   footprint on a locked-down machine, no Python dependency. *(Python present but Store-sandbox
   build; not used.)*
2. **Prisma + SQLite(dev)/Postgres(prod)** — solves the no-admin dev constraint without
   compromising the production relational DB.
3. **Snapshot-on-add + pinned MenuCardVersion** — guarantees historical estimate integrity when
   Menu Card values change across FYs.
4. **Variant identity = Component+Size+Description** — because Size is not unique in the real
   workbook.
5. **PDFs on filesystem, metadata in DB** — avoids blob bloat; keeps backups/reporting clean.
6. **Auth behind a provider seam** — temp login now, Entra ID OIDC later with a single-module
   change.
7. **Menu Card Catalogue integration via Option 2** (fold the standalone PWA into MDP as its
   built-in catalogue UI), scheduled after Phase 1 core — see §10.5.

---

## 12. Build conventions & gotchas (how MDP is actually built)

Captured 2026-10-29 from the recurring patterns across the build. These are MDP-specific habits,
not general advice — read them before making changes so the next session is consistent.

### 12.1 The change → verify loop (no npm, so no test runner)
npm is blocked on the BT machine (§0), so there's no installed test framework. The verification
pattern that's used for every server-side change:
1. Make the change.
2. `node --check <file>` on each touched `.js` (catches syntax/parse errors fast).
3. Write a **throwaway `.mjs` harness** (named `_verify-*.mjs` / `_*-check.mjs`) that:
   - sets its own `DB_PATH` to a temp file (or points at `mdp-sample.db` for a read-only sanity read),
   - imports the real repo/engine modules via absolute `file://` URLs,
   - seeds a **hand-calculable** dataset and asserts computed values match (PASS/FAIL lines),
   - exits non-zero on any failure.
4. Run it, read the result, then **delete the harness** (build rule: no stray files; these are
   not a real test suite).
5. Restart the server and hand to Isaac for **browser sign-off** (the only thing a harness can't do).
- Shell quirk (this OneDrive path): stdout is often swallowed, so redirect to a `%TEMP%` file and
  read it back. Prefer the dedicated read tool over `type`.

### 12.2 Sample DB workflow
- `app/seed-sample-data.mjs` builds a **separate** `app/data/mdp-sample.db` (it hard-refuses to
  touch the real `mdp.db`, and clears its own tables defensively so re-runs can't collide).
- It inserts **directly** (not via the repos) so it can backdate `created_at` and each status
  transition's audit timestamp — the repos always stamp "now", which would bunch all flow history
  into today. Data stays schema-valid + scope-correct.
- To demo against it: start the server with `DB_PATH` pointed at the sample DB. Start **normally
  (no `DB_PATH`)** to get back to real data. It's the standing ~100-request test dataset.

### 12.3 Stale-process trap (bitten more than once)
Node doesn't hot-reload. After ANY server-side edit you MUST fully stop and restart
`node server/server.js`, confirming nothing else holds port 4000 — otherwise the old process
keeps serving old routes (this masqueraded as the "name is required" ghost bug, and the
"History showed 138 not 41" scare).

### 12.4 Adding a new status (or field) — checklist
Derived from the ARCHIVED and CANCELLED work. Touch these, in order:
1. `constants.js` — the enum value + `EstimateStatusLabel` + any grouping arrays (active/terminal).
2. `repo/estimates.js changeStatus` — any transition guard (the workflow is otherwise any-to-any).
3. `repo/flow.js` — decide how analytics treats it (open/aging? backlog? throughput?). CANCELLED
   and the terminal states are excluded from "open/aging".
4. **`db.js` boot status allow-list — THE TRAP.** The migration resets any status NOT in its
   `NOT IN (...)` list back to NEW on every boot. A new live status MUST be added here or it's
   silently wiped on restart. This has nearly bitten twice (ARCHIVED fixed retroactively; CANCELLED
   added proactively).
5. UI — status dropdown options + badge colour (`.badge.status-X`), and the `STATUS_LABEL` maps
   duplicated across `estimates.js` / `reports.js` / `analytics.js` / `pdf-export.js`.
6. `seed-sample-data.mjs` — add it to the status mix + a `PREFIX` path + an `ageBand` entry so the
   sample DB exercises it.
7. Verify (12.1) + browser sign-off.

### 12.5 Money + charts
- **Money:** always integer-pence accumulation (`SUM(ROUND(x*100)*qty)` → `/100`) to match
  `engine.js` and avoid binary-float drift. Verified repeatedly (totals sum exactly).
- **Charts are hand-rolled inline SVG** (`web/views/charts.js`) — no Chart.js (npm blocked).
  Bars for categorical/ordered data, donuts for proportions-of-a-whole (with a text legend so
  meaning isn't colour-only), a line for time series. A single 100% donut slice must be drawn as
  a stroked circle, not an arc path (arc start==end is ambiguous — caused a render notch).

### 12.6 Durable tests — a future candidate (no npm needed)
The delete-after-use harnesses are deliberate, but they leave no persistent suite. If durable
tests are ever wanted, **`node --test`** (built into Node 24, zero dependencies) is the natural
fit — the existing harness assertions would port almost directly. Tracked as a backlog note in
`SPEC-tasks.md` (0.7).

---

*Powered by Forjé*
*© 2026 Isaac A Gera. All rights reserved.*
