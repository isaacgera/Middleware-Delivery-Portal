# Middleware Delivery Portal (MDP) — SPEC: Tasks

- **Project:** Middleware Delivery Portal (MDP)
- **Phase:** Phase 1 — Estimation & Planning
- **Companion docs:** `SPEC-requirements.md`, `SPEC-design.md`
- **Last updated:** 2026-11-05 (Durable **`node --test`** suite added — 38 tests / 6 files, all passing — closing the long-deferred test tasks **0.7 / 1.6 / 5.8 / 7.6**. Run `node app/run-tests.mjs`; see `app/test/README.md`. Remaining pre-Stage-10 items are all intentional future work: **2.7** Entra ID (→ Stage 11) and **9.11** request import (tracked). Next: Stage 10 NFR/a11y.)

Implementation plan for Phase 1, sequenced so each stage leaves the app runnable and testable.
Checkboxes track progress. **Nothing is "Built" until Isaac verifies and signs off** (status
stays In Progress until then).

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done
**Reqs** references map tasks back to `SPEC-requirements.md` requirement IDs.

> **Implementation note (2026-10-20):** the build is **dependency-free** (Node standard
> library only) because BT's network blocks `npm install` — see `SPEC-design.md §0`. Task
> wording below still mentions the parked tooling (npm workspaces, Fastify, Prisma, React,
> Vite, Vitest); read those as their dependency-free equivalents (`node:http`, `node:sqlite`,
> vanilla JS, `node:crypto`). Live code is in `app/`; the npm stack is parked in
> `_parked-npm-stack/`. **Progress so far: Stage 0 ✅, Stage 2 ✅, Stage 3 ✅ (incl. follow-ups) —
> all built + verified in browser by Isaac. Stage 1 (data layer) was folded into the
> dependency-free Stage 0. Stage 4 (Product Catalogue) ✅ built + verified. Stage 5 (Estimate
> Builder + Calculation Engine) ✅, Stage 6 (Request Repository — clone + archive) ✅, and
> Stage 7 (PDF export — client-side jsPDF) + task 8.5, Stage 8 (audit viewer — Audit/History
> role split), and **Stage 9 COMPLETE** — part (i) dashboards, part (ii) flow analytics + run-rate
> + Filter/Compare modes, part (iii) bulk/filtered export (PDF/CSV/JSON + date-range on Requests,
> PDF/CSV summary on Dashboards) — plus a **CANCELLED** status, all ✅ **verified in browser by
> Isaac (2026-10-28/29)**. Reusable seeder (`app/seed-sample-data.mjs` → separate `mdp-sample.db`)
> holds **~100 time-spread requests** (incl. Cancelled) as the standing test dataset; build
> conventions live in **design §12**. Next: **Stage 10** (NFR/accessibility), then 11 (deploy +
> prod DB) and 12 (sign-off → Built). Tracked future builds: request import (9.11), Catalogue
> integration (§10.5), Entra ID, durable `node --test` suite.**

---

## Stage 0 — Project scaffolding & tooling
- [x] 0.1 Project structure under `app/` (dependency-free; no npm workspaces) — `app/server/`, `app/web/`.
- [x] 0.2 Code conventions (plain ESM, consistent structure). *(ESLint/Prettier were in the parked npm stack; not needed for the no-build version.)*
- [x] 0.3 `app/server`: **`node:http`** server skeleton, `/api/health`, config loader (`config.js`, plain `.env`), error handler (`http-util.js`).
- [x] 0.4 `app/web`: **vanilla HTML/CSS/JS** skeleton, hash router, API client (`api.js`), base layout + light/dark tokens + manual theme toggle.
- [x] 0.5 `app/server/constants.js`: shared enums (roles, statuses, components, actions). *(Validators added in Stage 2 `validate.js` instead of Zod.)*
- [x] 0.6 `app/.env.example` documenting config; `app/README.md` dev-run notes (`node server/server.js`, no install).
- [x] 0.7 Test harness — **DONE (2026-11-05)**: a durable **`node --test`** suite (zero npm, Node 24 built-in) now lives in `app/test/` and replaces the throwaway harnesses. Run with `node app/run-tests.mjs` (a small programmatic runner — `node --test <dir>`/globs are unreliable on this Windows+Node 24 setup). **38 tests across 6 files, all passing.** Each DB test uses a throwaway temp SQLite DB (`useTempDb()` + `DB_PATH`, refuses real `mdp.db`/`mdp-sample.db`) and closes the handle in `after()`. Closes 1.6 / 5.8 / 7.6 too. See `app/test/README.md` and `SPEC-design.md §12.6`.
- **Verify:** ✅ `node server/server.js` starts the server; health check returns `{status:ok, db:connected}`; frontend served. Confirmed in browser by Isaac.

## Stage 1 — Data layer (folded into dependency-free Stage 0)
- [x] 1.1 `app/server/schema.sql` with all 7 tables + relations (design §3). *(Hand-written SQL instead of a Prisma schema.)*
- [x] 1.2 **SQLite via `node:sqlite`** (built-in, Node 22+) as the prototype store — real relational DB, not localStorage; prod Postgres/SQL Server later.
- [x] 1.3 Schema applied on first run (`initSchema` in `db.js`); no migration tool needed for the prototype.
- [x] 1.4 Single-`ACTIVE`-MenuCardVersion invariant via **serialized activation transaction** — **done in Stage 3** (task 3.6, B1): activation demotes the prior ACTIVE and promotes the new one atomically; invariant verified in the DB.
- [x] 1.5 Seed: `admin` + `manager` users (scrypt-hashed), empty catalogue (`db.js seedUsers`).
- [x] 1.6 Unit tests — **DONE (2026-11-05)** via the `node --test` suite (see 0.7). The data layer is now exercised by `menucards.test.mjs` (single-ACTIVE activation transaction, reactivate, guarded delete) and `estimates.test.mjs` (Request model, snapshots, concurrency) against throwaway SQLite DBs.
- **Verify:** ✅ DB created at `app/data/mdp.db`, schema + seed applied, health check reports `db:connected`.

## Stage 2 — Authentication & RBAC  **(Reqs: R1.1–R1.5, NFR1–NFR2)**
- [x] 2.1 Auth provider with **`node:crypto` scrypt** hashing (`crypto-util.js`, `auth.js`) — the no-native-dependency equivalent of bcryptjs (design §7, N5).
- [x] 2.2 Login / logout / me endpoints; signed **HttpOnly** session cookie (HMAC); idle timeout **30 min** (sliding) — `sessions.js`, `routes/auth-routes.js`.
- [x] 2.3 RBAC guards (`ADMINISTRATOR ⊇ DELIVERY_MANAGER`) enforced server-side on protected routes (`auth.js requireRole`).
- [x] 2.4 Change-own-password endpoint (`POST /api/users/me/password`).
- [x] 2.5 Admin user management (`GET/POST /api/users`, `PATCH /api/users/:id`) — admin-only (`routes/user-routes.js`).
- [ ] 2.7 **Entra ID seam** — documented in design §7; provider abstraction present, OIDC provider not yet stubbed in the dependency-free build. *(Carry forward.)*
- [x] 2.8 Verified: auth flows, RBAC allow/deny, scrypt hashing; **LOGIN/LOGOUT audit events** written (confirmed in DB).
- **Verify:** ✅ Both roles log in; Delivery Manager blocked from `/api/users` with **403 server-side** (not just UI); audit rows confirmed. Signed off in browser by Isaac.

## Stage 3 — Menu Card import & versioning (Admin)  **(Reqs: R2.1–R2.7)** — DONE + verified
- [x] 3.1 **Dependency-free `.xlsx` reader** (`xlsx.js`: manual ZIP inflate via `node:zlib` + regex XML parse — no ExcelJS). Header-text column mapping (robust to layout differences) for MQ/WLS/CFT/WildFly → shared costing tail. **Worksheet→enum map** (`Weblogic`→`WLS`; `Version`/`Variables` skipped).
- [x] 3.2 Cell-text normalisation (strip `\t`, collapse `\r\n`→`\n`, fix `t*` bullet artefacts) in `menucard-parser.js`.
- [x] 3.3 Parse `Version` + `Variables` tabs → label, FY, blendedUspRate (55.56), overheadPct (40), peopleDayRate (144).
- [x] 3.4 Validation (mandatory Component/Size/PD/Total; skip `Overhead %` footer; duplicate-variant flagging) + warnings.
- [x] 3.5 Import endpoint (multipart via in-house `multipart.js`) → stage as `DRAFT` MenuCardVersion + ServiceVariants; return summary (counts, warnings).
- [x] 3.6 Activate endpoint (**serialized transaction**: new→ACTIVE, prior→ARCHIVED, atomic — B1) + archive. Single-ACTIVE invariant verified in DB.
- [x] 3.7 Import audit events (MENUCARD_UPLOAD, MENUCARD_ACTIVATION) — confirmed written.
- [x] 3.8 Admin UI: upload + FY field, parse-summary review, version table with status badges, activate/archive.
- [x] 3.9 Verified against the **real V5 workbook**: 38 variants (MQ 9 / WLS 13 / CFT 10 / WildFly 6), MQ XL golden values (PD 54 / USP 108 / ATOM 54 / USP Cost 6000.48 / Overhead 2400.19 / Total 8400.67) correct end-to-end.
- **Verify:** ✅ imported real `.xlsx`; counts + golden values match exactly; single ACTIVE; audit rows present. Signed off by Isaac.

### Stage 3 follow-ups (Isaac feedback) — DONE + verified
- [x] 3.10 **Reactivate** archived versions (lifecycle softened — archive is reversible; single-ACTIVE still holds). Design §0.1.
- [x] 3.11 **Delete** a version — guarded: refused if ACTIVE or referenced by an estimate; cascades variants.
- [x] 3.12 **Edit metadata** (label + financial year + display filename) — never the as-imported values.
- [x] 3.13 **Store original uploaded `.xlsx`** (`stored_file_path`, idempotent migration) + **Download** route with a **timestamped filename**; download verified byte-identical to the upload. Pre-storage versions show no download ("re-import to enable").

## Stage 4 — Product Catalogue  **(Reqs: R3.1–R3.4)** — DONE + verified
- [x] 4.1 Catalogue API over the **active** version (`GET /api/catalogue?component=&size=&q=`), **both roles** (requireAuth). Data-driven filters via `getActiveFilters()`.
- [x] 4.2 Variant detail endpoint (`GET /api/catalogue/variants/:id`) — all six values + scope/assumptions/exclusions + reference partner cost.
- [x] 4.3 Frontend (`web/views/catalogue.js`): active-version banner, component/size/search filters, results table, click-through variant detail panel (money-formatted). Catalogue nav for both roles.
- [x] 4.4 Verified: size ladders differ per component; Size-not-unique handled correctly.
- **Verify:** ✅ 38 variants from active V5; MQ filter = 9 with **two distinct `M` variants**; **WildFly has no XXL**; MQ XL detail = PD 54 / USP 108 / ATOM 54 / Total 8400.67; Delivery Manager can access. Signed off by Isaac (pending browser confirm).

## Stage 5 — Request Builder + Calculation Engine  **(Reqs: R4.1–R4.6, R5.1–R5.4)** — DONE + verified in browser (2026-10-28)
> **Amendment (2026-10-21):** "Estimate" renamed to **Request** in the UI; header fields reworked
> per Isaac's spec — internal hidden `MDP-XXXX` key + user-typed unique **JIRA Reference**;
> Name→Summary, Opportunity Ref→External Ref, Description→Remarks; added **CFU** (dropdown,
> mandatory), **Approver** (free text, mandatory), **Component** + **Size** (dropdowns, mandatory,
> and they **scope** the catalogue line-add), **IP Code**, **IO Reference**. Dev DB migrated in
> place (idempotent RENAME/ADD + backfill, verified on a real old-shape DB). Nav tab Estimates→
> **Requests**, button New estimate→**Add Request**. Lines + engine + concurrency + snapshot all unchanged.
- [x] 5.1 Request CRUD (header fields). **JIRA Reference** user-typed, **mandatory, unique on save** (409 on dup); internal **`MDP-XXXX`** auto-assigned and hidden (`repo/estimates.js` nextRequestRef/normaliseJira/jiraInUse). CFU/Approver/Component/Size mandatory + validated. Verified: JIRA normalise+dup-409; MDP-0001 hidden from view; all mandatory validations (400).
- [x] 5.2 Status workflow **New → Pending → Approved → In Progress → Done**, **any-to-any** (the earlier guarded Draft→Under Review→Approved→Archived lifecycle was replaced in the 2026-10-21 Requests UX pass; `EstimateStatusTransitions` guard removed, no edit lock). Legacy values remap on boot (DRAFT→NEW, UNDER_REVIEW→PENDING, APPROVED→APPROVED, ARCHIVED→DONE). Verified in browser: all five statuses selectable, badge colours change.
- [x] 5.3 Line add/edit/delete/duplicate; **snapshot variant's six values on add** (`addLine` copies snap_*); MenuCardVersion pinned at create. **Lines scoped to the request's Component+Size** — `addLine` rejects an out-of-scope variant (400); Component/Size locked while lines exist (409). `scopedCatalogue(id)` feeds the picker. Verified: in-scope add OK, out-of-scope rejected, snapshot immutability, scope-lock.
- [x] 5.4 Deterministic engine (pure fn, `engine.js`): line = snapshot × qty; totals = Σ; **integer-pence money math (no float drift)**, round at display only. Verified: 8400.67×2=16801.34; Σ=21468.38 exact.
- [x] 5.5 `rowVersion` optimistic-concurrency on estimate updates (NFR7) with clear 409 conflict; **any line add/edit/delete/duplicate bumps the parent estimate's `rowVersion`** (S4). Verified: stale rowVersion rejected (409); correct one succeeds. Also locks line edits on APPROVED/ARCHIVED.
- [x] 5.6 Frontend (`web/views/estimates.js`): **Requests** list + search (JIRA/customer/status; columns JIRA Ref, Summary, CFU, Component, Size, Status, Lines), **Add Request** + Edit modals with all new fields and CFU/Component/Size dropdowns, request header with meta strip (External Ref/IP Code/IO Reference/Remarks), line grid with **live totals strip**, **scoped** add-from-catalogue picker, status control, delete. Nav label Estimates→Requests. Router prefix route `/estimates/:id` unchanged.
- [x] 5.7 Audit events (ESTIMATE_CREATE / ESTIMATE_MODIFY / ESTIMATE_DELETE) written from the routes.
- [x] 5.8 Tests — **DONE (2026-11-05)**: the throwaway harness checks are now durable in `app/test/estimates.test.mjs` + `engine.test.mjs` (snapshot immutability, integer-pence totals maths, rowVersion concurrency conflict, JIRA uniqueness + mandatory validation, scoped line-add, scope-lock, clone, archive hide/surface, CANCELLED guards, per-row TCS/FTE split). Runs under the standing `node --test` suite (see 0.7).
- **Verify:** ✅ (server-logic) created a Request with all fields, confirmed MDP-XXXX hidden + JIRA unique, added an in-scope line and saw it rejected out-of-scope, mutated the source variant and totals held, and migrated a real old-shape DB (renames + backfill, idempotent). ✅ **Browser sign-off by Isaac (2026-10-28):** Add Request form (all fields) saves; scoped catalogue picker; line + live totals strip update on qty; Component/Size scope-lock while lines exist; five-status any-to-any workflow; Requests list Total Cost/Total PD columns + generic search + per-column filters + "X of N" count + Clear. Stage 5 complete.

## Stage 6 — Request Repository  **(Reqs: R6.1–R6.4)** — DONE + verified in browser (2026-10-28)
- [x] 6.1 List/search/filter API — the list + search/filter (JIRA, customer, status, component, CFU, createdBy) and per-row totals already landed in Stage 5; Stage 6 added the **default-hide of ARCHIVED** (archived rows surface only via `status=ARCHIVED`). **Pagination deferred** (premature at 3–5 users; the list filters client-side and is instant — can add any time). **Date-range filter** was pulled into **Stage 8** (2026-10-28) — the audit viewer needs date filtering anyway, and it unblocks Stage 9's period-based export/analytics.
- [x] 6.2 **Clone** a request — `cloneEstimate()` deep-copies the header with a **fresh internal MDP-XXXX** + a **derived unique JIRA** (`<src>-COPY`, then `-COPY2`…), status reset to NEW, rowVersion 0, pinned MenuCardVersion preserved, and **all lines copied with their snapshots intact** (so the clone's figures are independent of the current Menu Card). **Archive** — a separate `ARCHIVED` status reached via an explicit Archive action; un-archive moves it back to NEW. *(Estimate's own version history — deferred; not needed for Phase 1.)*
- [x] 6.3 Frontend: **Clone** + **Archive / Un-archive** buttons on the builder; a **"Show archived"** toggle on the list (reloads with `?status=ARCHIVED`); dashed **Archived** badge; archived requests show a disabled status dropdown + Un-archive. (`web/views/estimates.js`, `web/styles/global.css`.)
- [x] 6.4 Verified via temporary Node harness (21 checks, all pass; harness deleted): clone makes fresh refs + `-COPY`/`-COPY2` JIRA, resets to NEW/rowVersion 0, copies lines, preserves pinned version, **snapshot immutability holds** after mutating the source variant; archive hides from the default list, `status=ARCHIVED` surfaces it, un-archive restores. **Bug caught & fixed:** the boot status-remap in `db.js` would have reset ARCHIVED rows to NEW — ARCHIVED added to its allow-list. Shared-state across sessions is a server app over one DB (verify at leisure with two browsers).
- **Verify:** ✅ **Browser sign-off by Isaac (2026-10-28):** Clone (copy with `-COPY` ref + lines) → rename → Archive (drops from list) → Show archived (reappears, dashed badge) → Un-archive (returns to active list). All five passed. Stage 6 complete.
- **Post-fix re-check (2026-10-28):** ✅ After the `db.js` `ARCHIVED→DONE` data-loss fix, Isaac re-verified the full cycle in the browser on the real dev DB — archive → **stop & restart server** → hard-refresh → request is **still Archived** (not silently flipped to DONE); and the same restart test for **un-archive**. The data-loss bug is confirmed closed.

## Stage 7 — PDF Export  **(Reqs: R7.1–R7.4)** — DONE + verified in browser (2026-10-28)
> **Built CLIENT-SIDE with vendored jsPDF, not server-side pdfmake** (design §0 — BT's network
> blocks npm, and the Menu Card Catalogue already proved the vendored-jsPDF + adaptive-delivery
> pattern). The PDF is generated in the browser and delivered adaptively (download on desktop,
> share sheet on mobile, with a fallback); the server records the export as metadata only.
- [x] 7.1 **Preview vs Export split** (design §6): **Preview** builds + opens the PDF in a new tab, **no server record**; **Export** builds + delivers, then records a `GeneratedDocument` + `ESTIMATE_EXPORT` audit via `POST /api/estimates/:id/export`. `web/views/pdf-export.js` (`buildRequestDoc` / `exportRequestPdf` / `previewRequestPdf`), lazy UMD jsPDF loader vendored at `web/vendor/jspdf.umd.min.js`.
- [x] 7.2 Document sections **as refined with Isaac (2026-10-28)**: Cover; **Summary as a two-column grid, no boxes** (Customer, CFU, Component, Approver, Status, **Recorded by** = creator's display name [role-agnostic], **Date received** = created date; External Ref/IP/IO when present; **Size removed**); **Cost Summary** = Story Points, TCS Cost, FTE Cost + emphasised Grand Total (**PD + ATOM removed**); **Remarks** retained. **Line-Item Breakdown, Assumptions, Exclusions and Menu Card Version were removed** at Isaac's request. Spacing loosened for a cozier layout.
- [x] 7.3 `GeneratedDocument` recorded (filename, pinned version, creator, size); **`file_path` = marker `'client-generated'`** since the browser holds the bytes (not a server path). `repo/documents.js`. If generation ever moves server-side, this gains a real path with no schema change.
- [x] 7.4 Export route writes the **ESTIMATE_EXPORT** audit event (links to the document id). Preview writes nothing (per design §6).
- [x] 7.5 Frontend: **Preview** + **Export** live in a tidy **Actions ▾ dropdown** (Preview, Export, Clone, Archive, Edit, Delete) in the builder header, paired with a matching custom **Status** dropdown (same style/width). Branding: "Powered by Forjé" footer is **on** the customer PDF (it IS the deliverable, not app chrome) and excluded nowhere relevant here.
- [x] 7.6 Tests — **DONE (2026-11-05)** for the server-side slice: `ESTIMATE_EXPORT` audit coverage and the append-only audit guarantee are in `app/test/audit.test.mjs` (part of the standing `node --test` suite, see 0.7). **Note:** the client-side PDF *build* (`web/views/pdf-export.js`, vendored jsPDF) is browser-only and stays Isaac's visual sign-off (done 2026-10-28) — it isn't unit-testable in the Node suite. `GeneratedDocument` metadata recording is exercised indirectly; a direct `documents.js` test can be added if ever wanted.
- **Verify:** ✅ **Browser sign-off by Isaac (2026-10-28):** Preview + Export both work (tested on Administrator and Delivery Manager roles); PDF content/spacing approved after field rework; Actions + Status dropdowns approved. Stage 7 complete.

## Stage 8 — Audit Logging (cross-cutting)  **(Reqs: R8.1–R8.3, NFR5)** — DONE + verified in browser (2026-10-28)
- [x] 8.1 Central append-only audit writer (`repo/audit.js writeEvent`) — insert-only, no update/delete path exported anywhere (tamper-evident). *(Already in place from earlier stages; confirmed in the Stage 8 harness.)*
- [x] 8.2 Audit viewer **with a role split** (Isaac's call, 2026-10-28): **Administrator → "Audit"** (full log across all users, with an action/user/date-range filter + User column); **other roles → "History"** (their OWN events only, no user filter/column). **Scoping enforced server-side** — a non-admin's `userId` is forced to the caller regardless of any `user` param, and `/api/audit/users` is Admin-only (defence in depth). New `routes/audit-routes.js` (`GET /api/audit`, `GET /api/audit/users`), `web/views/audit.js`, nav label swaps Audit/History by role. `listEvents` gained **date-range (from/to)** filtering (retires the deferred 6.1 date-range debt). `listAuditUsers()` feeds the admin user filter.
- [x] 8.3 All eight event types fire from the right operations — LOGIN/LOGOUT (auth), MENUCARD_UPLOAD/MENUCARD_ACTIVATION (menucards), ESTIMATE_CREATE (create+clone)/ESTIMATE_MODIFY (header/status/lines)/ESTIMATE_DELETE/ESTIMATE_EXPORT (estimates). Verified present in the harness + browser.
- [x] 8.4 Verified via temp Node harness (20 checks, all pass; harness deleted): 8 event types write+read; events carry user/timestamp/action/object; **append-only** (no update/delete writer exported); action/user/date-range filters correct; `listAuditUsers` distinct. `node --check` clean on all changed files. **Note:** a one-off "manager History showed 138 not 41" scare during sign-off was the **stale-process trap** (server still serving the pre-scoping route) — a DB dump confirmed clean attribution (admin 97 / manager 41 / 0 NULLs) and the repo scoping returned exactly 41; a fresh server restart fixed the view. Not a code bug.
- **Verify:** ✅ **Browser sign-off by Isaac (2026-10-28):** Admin "Audit" shows all + filters; Delivery Manager "History" shows own events only (41, correctly scoped) after a clean restart. Stage 8 complete.
- [x] 8.5 **Status-transition audit detail enriched with `{ from, to }`** (done early, during Stage 7, 2026-10-28). The status route now reads the previous status before `changeStatus` and logs `detail: { change: 'status', from, to, status }` (`status` kept for back-compat). History now accrues as a clean, analysable transition record — the raw material for the Stage 9 flow analytics (9.4–9.5). Verified via temp harness (from:NEW→to:APPROVED recorded). *(The rest of Stage 8 — audit viewer, coverage, append-only — completed 2026-10-28.)*

## Stage 9 — Reporting Dashboards + flow analytics  **(Reqs: R9.1–R9.3)**
> **Scope reframed 2026-10-28 (Isaac's forecasting question).** The original three static views
> (volume / by-product / value) stand, but Stage 9 is extended with **timeline-based flow
> analytics + a run-rate projection** built from the status-transition audit history (needs 8.5's
> `{ from, to }` enrichment landed first). Deliberately **flow analytics + run-rate, NOT a
> statistical forecasting model** — at 3–5 users and modest volume, honest flow metrics + a simple
> projection are the right ceiling; a predictive model would imply more certainty than the data
> supports. See design §10 for the reasoning.
### Part (i) — the three basic dashboards — DONE + verified in browser (2026-10-28)
- [x] 9.1 Report endpoints (`routes/report-routes.js`, both roles): `GET /api/reports/volume` (total + per-status + headline created/approved/archived), `/by-product` (counts per component incl. 0s), `/value` (total PD, total cost, TCS/FTE, by-customer). Aggregates in `repo/reports.js`; money in **integer pence** to match the engine (no float drift).
- [x] 9.2 Frontend dashboards (`web/views/reports.js`) — **hand-rolled inline-SVG bar charts + stat cards** (`web/views/charts.js`), NOT Chart.js (npm blocked; Isaac chose Option B). Read-only, both roles, "Dashboards" nav item. Accessible: charts carry `role="img"` + aria-label summaries and visible value labels (not colour-only); value data also shown as a table. Themed via tokens (light/dark).
- [x] 9.3 Verified via temp Node harness (12 checks, all pass; harness deleted): volume counts, per-product counts (incl. WILDFLY 0), total PD/cost, and by-customer sums all match hand-calculated values exactly (26202.01 / 17801.34 / 8400.67 — no drift). `node --check` clean on all changed files. ✅ **Browser sign-off by Isaac (2026-10-28)** against the seeded sample DB (18 requests: volume New3/Pending3/Approved3/InProgress3/Done4/Archived2; by-product MQ8/WLS7/CFT2/WFY1; value £490,817.04). Part (i) complete.
- **Sample data:** reusable seeder `app/seed-sample-data.mjs` builds a SEPARATE `app/data/mdp-sample.db` (refuses to touch `mdp.db`): ACTIVE V5 Menu Card + 18 variants, 18 requests across 6 customers / all components / all statuses, with lines + 44 status-transition events (feeds dashboards now and flow analytics later). Run the server with `DB_PATH` pointed at it to demo.
- **Bug fixed during this work (data-loss, affects live app):** `db.js` boot migration had an `ARCHIVED→DONE` status remap (a leftover from the Stage-5 lifecycle migration). Since Stage 6 made ARCHIVED a *live* status, that line silently reset every genuinely-archived request to DONE **on each server restart**. Removed it (DRAFT/UNDER_REVIEW remaps kept — those strings are truly dead). Verified: archived rows now survive an `initSchema` re-run. *(Recommend a quick browser re-check of Stage 6 archive → restart → still archived.)*

#### Part (i) extension — extra breakdowns, WealthOrah-style rework + functional filters (2026-10-28)
- [x] 9.1b Added three more breakdowns (verified vs hand-calc, 6/6 harness): **by CFU**, **by request Size** (TO..XXL order), and a **by-month created timeline** (gap-filled). New endpoints `/api/reports/by-cfu|by-size|timeline`.
- [x] 9.2b **Dashboard reworked to a WealthOrah-style layout** (Isaac's request): a **functional filter bar** (CFU / Component / Status / date From–To / Clear) that re-scopes the *whole* dashboard; **KPI summary cards** on top (Total Cost w/ per-component £ split + %, Total Requests w/ Approved/In-Progress + %, Total USP w/ "across N requests", CFUs Active w/ full per-CFU split + %); then the charts in a **2-col grid**; by-customer table full-width. One-call `GET /api/reports/summary` (+ `/filters`) with shared filter params; all aggregates now take a shared `{cfu,component,status,from,to}` filter. MDP-toned subtle-gradient cards (accent card uses `--primary`), hover-lift + sibling-dim emphasis, reduced-motion honoured. Verified: filtered aggregates match hand-calc (16/16 harness) — component=MQ→8, status=DONE→4, impossible combo→0 clean; cost/USP splits sum to totals exactly.
- [x] 9.2c **KPI summary-card polish — DONE (2026-10-29).** Resolved the too-tall/clumsy cards: the big component/CFU breakdowns were **moved out of the cards into donut charts**, leaving slim cards (Total Cost → small TCS/FTE line; CFUs Active → top CFU only). Also this pass: donut charts for By-product + By-CFU, a trend line (with on-point value labels) for the monthly timeline, two **Revenue-share tables** (by CFU, by Product) replacing Value-by-customer, Prev/Next **pagination** (10/page) on the Requests list + Analytics aging table, landing tab renamed **Dashboard→Home**, and a donut full-circle render fix. *(orig note: 2-column sub-row grid was the interim attempt Isaac found clumsy; superseded by the donut approach. Earlier sub-list / top-N+others for CFU / a cleaner sub-row treatment). Functionality is fine; this is purely the visual polish of the KPI cards.

### Part (ii) — flow analytics + run-rate — DONE + verified in browser (2026-10-28)
- [x] 9.4 **Flow analytics** on a separate **Analytics** page (`web/views/analytics.js`, `server/repo/flow.js`, `routes/analytics-routes.js`), reconstructed from each request's `created_at` + its `{from,to}` status-transition audit history: **throughput** (reaching DONE per month, gap-filled), **cycle time** (Created→Done median+mean now; Approved→Done also computed for a later toggle), **per-stage dwell** (avg days in each status before leaving), and **aging** (open = not DONE/ARCHIVED, days in current status, flagged > threshold; tweakable 7/14/30/60). Both roles.
- [x] 9.5 **Run-rate projection** (honest, non-statistical): recent PD/month reaching DONE (avg over last N active months) vs committed backlog PD (APPROVED + IN_PROGRESS) → ~N months, with the inputs shown in plain language and a "not a forecast" caveat. Divide-by-zero guarded (→ "insufficient data").
- [x] 9.6 Verified via temp Node harness against a hand-scripted transition history (**11/11**): throughput buckets, cycle median/mean (Created→Done 15, Approved→Done 10.5), dwell, aging at 30d vs 7d, run-rate (54 PD/mo, 108 backlog, ~2.0 mo). Plus a filter/compare consistency harness (**9/9**): filter component=MQ→28 exact, impossible combo→0 clean, compare group counts+throughput sum back to overall (100/44), thin-group null guard. `node --check` clean on all changed files.
- [x] 9.6b **Scope modes — Filter + Compare** (Isaac trialled Overall/Filter/Compare via a pill, kept **Filter + Compare**; Overall dropped as it's just an empty Filter). **Filter** mode: Component/Size/CFU/Customer + date range re-scopes every metric (with an "N matching" note + empty-scope guard). **Compare** mode: break the key metrics down by a chosen dimension (Component/Size/CFU/Customer) as a cycle-time bar chart + a full metrics-by-group table, with a <3-completed "indicative/—" guard. Shared `/api/reports/filters` extended with sizes + customers. Pill = segmented control in `global.css`.
- **Sample data upgraded (2026-10-28):** seeder bumped to **~100 requests** with **time-spread** history — created dates over ~12 months and each status transition written at a believable historical date (fixes the earlier "all at now" artifact so cycle/throughput/dwell/run-rate read realistically). Well distributed: all 4 components, all 7 sizes (TO..XXL), all 8 CFUs, 8 customers, realistic status funnel. Added a defensive table-clear so re-runs can't collide on UNIQUE keys if the file is locked. This is the standing test dataset going forward.

### Dashboards polish, chart types + pagination — DONE + verified (2026-10-29)
- [x] 9.8 **Chart types + card polish** (see 9.2c): donut charts for By-product + By-CFU (legend + categorical `--chart-1..8` tokens + full-circle render fix), a **trend line** with on-point value labels for the monthly timeline, bars retained for By-status/By-size. KPI cards slimmed (9.2c). Two **Revenue-share tables** (by CFU, by Product; cost + %, verified to sum to total). Landing nav **Dashboard → Home** (de-conflicts with the "Dashboards" reporting tab).
- [x] 9.9 **Pagination (Prev/Next, 10/page)** on the Requests list (newest first, "X–Y of N", resets on filter) and the Analytics aging table (most-aged first). Shared `.table-pager`.

### New status: CANCELLED — DONE + verified (2026-10-29)
- [x] 9.10 Added **CANCELLED** (Isaac's request — requests can be stopped after processing a while). Selectable from any active status; **blocked** from DONE/ARCHIVED; a cancelled request can be **revived** to an active status but not sent straight to DONE/ARCHIVED (the first transition restriction in the otherwise any-to-any workflow, enforced server-side in `changeStatus`). Excluded from analytics aging/backlog/throughput (never reaches DONE). Red badge + red dropdown option. Added to the `db.js` boot allow-list (avoids the ARCHIVED-style silent-reset trap). Sample DB re-seeded with 7 Cancelled (with cancel transition history). Verified 8/8 (guard both directions + analytics exclusion).

### Part (iii) — bulk / filtered export — DONE + verified in browser (2026-10-29)
- [x] 9.7 **Bulk / filtered export.** Export ▾ menu on the **Requests list** → **PDF · CSV · JSON**, exporting the current filtered selection (search + per-column filters + archived toggle + a new **created-date range** on the list). Columns: JIRA / Summary / Customer / CFU / Component / Size / Approver / Status / **TCS Cost / FTE Cost / Total Cost** (Lines dropped at Isaac's request; `listEstimates` now returns per-row tcsCost/fteCost, integer-pence, TCS+FTE=Total verified). CSV = UTF-8 BOM + escaped; PDF = landscape paginated table (`exportRequestsTablePdf`); JSON = import-friendly envelope (`type:mdp.requests`, v1) with clean fields + **no internal MDP-XXXX / DB ids**. A separate **Dashboards** Export ▾ → **PDF · CSV** outputs the current filtered summary **as tables** (Key figures + by status/product/CFU/size + revenue share by product/CFU; filter named in the title) — the "pivot-like reporting" ask reusing the Dashboards filters (`exportSummaryTablesPdf`). Verified: bulk CSV logic 10/10, dashboard sections 6/6, JSON shape 6/6, list TCS/FTE 3/3. *(orig note kept: lands here not Stage 7 because it reuses the analytics slicing; date-range filter from Stage 6 added. Format still open** — three candidates: (a) one multi-request **summary PDF** (a section/row per request — good for an "approved pipeline this quarter" overview); (b) a **CSV** of the filtered set (best for analysis); (c) a **ZIP of individual PDFs** (literal "export all", heaviest — needs a vendored zip lib). Leaning (a) or (b); confirm the use case (internal overview vs customer-facing) when we build it. The single-request detailed PDF (Stage 7) stays the per-customer artifact.

### Future build (tracked, not scheduled)
- [ ] 9.11 **Request import pipeline** (Isaac, 2026-10-29) — consume the import-friendly JSON that the Requests export now produces (`type:mdp.requests` envelope) to **create requests** in MDP. Deliberately deferred as its own feature because it *writes records* and carries real data-safety weight: validation, duplicate JIRA handling, which fields are accepted, who the import is attributed to, whether/how to reconstruct status-transition history, and a confirm/preview step. The export format is already shaped for it (no internal MDP-XXXX / DB ids travel). Scope + confirm with Isaac before building.
- [ ] 9.12 **On-screen Menu Card creation (form / pro-forma)** (Isaac, 2026-11-05) — add a way to **create a Menu Card on screen**, alongside the existing `.xlsx` upload, in the Menu Cards (admin) area. **Feasibility: good** — the server already exposes a clean seam, `repo/menucards.js createDraftVersion({ version, variants, … })`, which the importer merely feeds; a form would call the same function via a new `POST /api/menucards` (JSON) route, then stage a DRAFT and activate through the existing flow. The real work is the **frontend editable grid** + validation, plus two design decisions to pin down at build time:
  1. **Verbatim vs calculator.** The importer stores the six values (PD/USP/ATOM/USP-cost/overhead-cost/total-cost) *as-imported, never recomputed*. The form could either (a) match that (type all six), or (b) become a **calculator** — type PD + the version's rates (blended USP rate, overhead %, people-day rate) and derive USP/costs. (b) is more work but far less error-prone and fits the engine's integer-pence discipline; likely the better choice. Decide explicitly.
  2. **Scope of the first increment.** Options discussed:
     - **A — full form builder:** version header (label/FY/3 rates) + an editable multi-row variant grid across the four components → save as DRAFT. The headline feature Isaac asked for.
     - **B — add/edit variant rows on an existing DRAFT** (lighter; "the card's mostly right, add two services").
     - **C — import-then-edit:** make a staged DRAFT's rows editable before activation (add/tweak/delete). Highest value-for-effort; fixes today's "re-import to correct anything" limitation and naturally subsumes B.
     - **D — single-variant "add one service" modal** (simplest, clunkiest for many rows).
    Recommendation: frame **A** as the goal, consider **C** as a strong first increment. **Medium-tier → do a Quick Spec** when built (new route + validation + non-trivial editable grid + the verbatim-vs-calculator call + data-safety on a core table). Reuses the activation/single-ACTIVE transaction, audit (MENUCARD_UPLOAD or a new MENUCARD_CREATE action — decide), and the DRAFT→ACTIVE lifecycle unchanged.

## Stage 10 — NFR hardening & accessibility  **(Reqs: NFR3–NFR11)**
- [x] 10.1 Input validation + consistent API error shape — **reviewed + confirmed DONE (2026-11-05)**. Every write route validates via the in-house `validate.js` (`requireString`/`optionalString`/`requireEnum`/`requireNumber`, length caps + labels — the dependency-free Zod equivalent), the repo layer re-validates enums (CFU/Component/Size) + business rules, and `readJsonBody` has a 15 MB size guard. Error shape is uniform: `HttpError` → `sendError` renders `{ error, message, details }` with the right status (400/401/403/404/409/500). *Minor note:* line `quantity` is validated in the repo rather than at the route — functionally covered (clean 400), left as-is to avoid churn.
- [x] 10.2 Indexing/pagination review — **reviewed + confirmed DONE (2026-11-05)** for the 3–5 user / 3-second target. Indexes exist on estimates(status/customer/created_at/created_by/component/cfu), service_variants, estimate_lines(estimate_id), audit_events(action/timestamp/user). Requests list + Analytics aging table paginate client-side (10/page); audit caps at 200. Comfortably within target at this scale; a server-side pager is a trivial later add if volume grows (noted, not needed now).
- [x] 10.3 Secrets via env only; nothing sensitive committed; TLS/at-rest notes — **DONE (2026-11-05)**. (1) **Secrets env-only, verified:** `SESSION_SECRET`/`DB_PATH`/`DOC_STORAGE_DIR` all come from `config` (env/.env, dev defaults); no hardcoded secrets; scrypt-only password storage. (2) **Nothing committed, verified:** no `.env` on disk, `.gitignore` excludes `.env`/`data/`/`*.db`, and the folder isn't a git repo yet (init is 11.1) so nothing is tracked. (3) **Notes written** → new `DEPLOYMENT.md` at the MDP root: secrets table + prod session-secret generator, TLS via reverse proxy + `NODE_ENV=production` → `Secure` cookie (cookie already HttpOnly+SameSite=Lax), at-rest guidance (encrypted DB + doc store, scrypt), and a Stage-11 carry-forward list. The deep prod-DB / backup-restore / deploy steps remain Stage 11 (11.2/11.3/11.5/11.6) by design.
- [x] 10.4 Accessibility pass — **DONE (2026-11-05)**: global `:focus-visible` ring already present; added **`aria-label` to the icon-only line buttons** (Duplicate/Delete — were `title`-only glyphs; glyphs now `aria-hidden`); custom Status/Actions dropdowns already carry `aria-haspopup`/`aria-expanded`/`aria-controls` + `role=menu`/`menuitem`/`menuitemradio`/`aria-checked` and keyboard support (Escape + focus-return + focus-first-item via `wireMenu`); modals already `role=dialog`/`aria-modal`/`aria-labelledby`; theme toggle updates `aria-label`+`title` per state. Added **focus-move to `#view` (tabindex=-1) on route change** so SR/keyboard users land in new content (guarded against stealing focus from a field). Added a universal **reduced-motion** backstop. Token contrast verified AA in light+dark for text/text-light/primary; `--muted` is sub-AA but used only for incidental hints (flagged for 10.6 confirmation).
- [x] 10.5 Branding footer — **DONE (2026-11-05)**: the "Powered by Forjé" + "© 2026 Isaac A Gera. All rights reserved." footer was already in `index.html`, tokenised in `global.css` (themes light/dark). Added a **`@media print`** block hiding the footer + proto-banner + header/nav/toggle from any page printout (the client-side jsPDF deliverable carries its own footer and is unaffected). Copyright holder confirmed **Isaac A Gera** for MDP (may change later).
- [x] 10.6 **Pre-Live Testing Agent run — DONE (2026-11-05).** Audited the live app (sample DB, admin) at laptop + mobile; verdict "minor fixes first". Report saved to `.agents/reviews/stage10-prelive-audit.md`. **Isaac chose to fix all BLOCKERS + all NICE-TO-HAVE; SHOULD-FIX deferred.** Fixed: `--muted` contrast (→ `#6b7280`, AA); `#view` aria-label; catalogue rows keyboard-activatable (role=link + Enter/Space + focus style); icon-button focus style; live region + `announce()`; skip link; SVG reduced-motion guard; date-format hints; `aria-busy` loading states. Deferred (logged in the review): filter-label `for`/`id`, pill `aria-pressed`, sortable headers, login focus check, mobile tap-target bump, **modal focus-trap (highest-value deferred item)**, column-filter input labels. `node --check` clean; suite still 38/38. **Browser sign-off pending from Isaac.**

## Stage 11 — Deployment & production DB validation  **(Reqs: A3, A4, NFR6)**
> **Stage 11 reframed (2026-11-05, Isaac).** Deployment target = **BT GitLab + a BT local server**,
> 3–5 users, server lock-down status unconfirmed. **Decision: production runs on SQLite** (the live
> dependency-free `app/` track), with the parked Prisma stack (`_parked-npm-stack/`) kept as the
> **Track 2** npm/Postgres-or-SQL-Server escape hatch. Rationale in DEPLOYMENT.md §4 + SPEC-design
> §8. This collapses most Stage-11 risk: dev and prod are the SAME engine, so 11.3's "SQLite-green ≠
> prod-green" worry dissolves. Code/docs/CI prepared this session; the actual provisioning + deploy
> are on the BT side (see 11.5/11.8).

- [x] 11.1 **Repo + CI pipeline — DONE + GREEN ON BT (2026-11-06).** `.gitlab-ci.yml`: Node 22
  image, **syntax-check** stage (`node --check` over all server+web JS + runner + backup script)
  and **test** stage (`node app/run-tests.mjs`). No npm/bundle step. **Repo created + pushed** to
  BT Team, BT Personal, and GitHub (branch `main`; local `all` remote fans out). **BT Team pipeline
  #7894903 PASSED** — both stages green, 38/38 tests ran in BT CI on Docker `node:22` with zero npm.
  Fix applied to get a runner: tagged jobs with `mobius_shared_runner` (BT shared runners are
  tagged; untagged jobs were stuck pending). **CI GREEN on all three remotes:** BT Team ✅,
  BT Personal ✅ (GitLab, same tag), **GitHub ✅** via `.github/workflows/ci.yml` (GitHub Actions,
  hosted Ubuntu runner, mirrors the pipeline). All verified by Isaac 2026-11-06.
- [x] 11.2 **Production DB decided — SQLite (DONE 2026-11-05).** Live track stays `node:sqlite`,
  unchanged dev→prod; Track 2 (Prisma + Postgres/SQL Server) parked as the escape hatch with
  documented revisit triggers. Recorded in SPEC-design §8 + DEPLOYMENT.md §4.
- [x] 11.3 **Test suite = the production-DB test pass — DONE (2026-11-05).** Because prod IS SQLite,
  the `node --test` suite (38/38, runs against real `node:sqlite` throwaway DBs) already exercises
  the production engine; CI runs it on the deployment box's Node. No separate prod-DB migration/test
  pass needed on the live track. *(Applies to Track 2 only if ever revived.)*
- [x] 11.4 **Generated-PDF storage documented — DONE.** PDFs are client-generated (vendored jsPDF)
  and recorded as metadata only; stored under the app's doc folder on the same encrypted,
  access-controlled volume as the DB. Retention = no auto-cleanup (O5, conscious). DEPLOYMENT.md §3/§6.
- [~] 11.5 Deploy behind TLS reverse proxy; smoke-test with real users. **(BT-side execution; prep
  DONE 2026-11-06.)** Ready-made artifacts added under `deploy/`: `nginx-mdp.conf` + `iis-web.config-notes.md`
  (TLS reverse proxy, HTTP→HTTPS, forward to loopback `127.0.0.1:4000`, X-Forwarded-Proto), `mdp.env.sample`
  (prod env incl. `NODE_ENV=production`→Secure cookie + `SESSION_SECRET` generator), `run-as-service-windows.md`
  (NSSM / Task Scheduler for boot+restart), `backup-mdp.cmd` (scheduled backup + off-box copy), `deploy/README.md`
  (order of operations). Remaining = run it on the BT box + smoke-test.
- [x] 11.6 **Backup & restore — DONE + VERIFIED (2026-11-05).** Added dependency-free
  `app/backup-db.mjs` (atomic `VACUUM INTO`, safe on a live DB; `--verify` runs `integrity_check` +
  row counts; non-zero exit for scheduled-task detection). **Test restore proven lossless:** a
  backup→compare round-trip against the real dev DB matched every table's row count + a content
  fingerprint exactly (users/menu-cards/variants/estimates/lines/audit/docs), `integrity_check: ok`.
  Procedure + schedule in DEPLOYMENT.md §5. Wiring the scheduled task + off-box copy is BT-side.
- [x] 11.7 **Operational notes — DONE.** Session timeout (O1, 30 min sliding, env-tunable),
  request-ref format (O3), PDF retention (O5), in-memory sessions, SQLite single-writer note — all
  in DEPLOYMENT.md §6.
- [ ] 11.8 **BT-side provisioning (NEW, tracked).** Create+push the GitLab repo; stand up the BT
  server (Node 22+, TLS reverse proxy, encrypted volume, scheduled backup, off-box copy); set
  `NODE_ENV=production` + a real `SESSION_SECRET`; change the seeded passwords; smoke-test. The
  session-completable groundwork (CI, backup, docs, decisions) is all done above.

## Stage 12 — Spec review, verification & sign-off
- [x] 12.1 **Spec Reviewer run + findings resolved — DONE (2026-11-05).** Verdict: coverage strong, shipped app sound; all 10 findings were documentation drift (specs lagging Stage 7–11 reality), not code defects. **Fixed all:** 3 blockers (R7 PDF → client-side jsPDF; design §1 diagram + §2 stack table → Live Track 1 / parked Track 2 side by side), 4 should-fix (design §8 two-track; R4.2 + ARCHIVED/CANCELLED; NFR12 acceptance criterion + met-evidence; NFR1 Entra deferral explicit), 3 nice-to-have (R7.2 content; future-builds → covered by 9.11/9.12; §0.1). Also corrected stale A3/A4/A5. Report: `.agents/reviews/stage12-spec-review.md`. No code changes needed.
- [ ] 12.2 End-to-end test pass against production DB. **(BT-side — needs the deployed app from 11.5/11.8.)**
- [x] 12.3 **Licence confirmed Internal / open (2026-11-05, stands).** Revisit formal licence/ownership (BT vs other) before any wider go-live (O4) — flagged, not blocking Phase-1 internal use.
- [ ] 12.4 Isaac verifies the **deployed** app; only then flip Ideas.md status to **Built (MDP v1.0.0)** per the backlog-sync rule. **(Gated on deployment + Isaac sign-off — correctly NOT done from the dev session.)**
- [~] 12.5 **User docs created (2026-11-05):** `overview.html` + `userguide.html` written in the app-family style (inline MDP tokens, light/dark, Forjé footer; userguide covers sign-in, catalogue, requests, lines/snapshots, status/archive/cancel, PDF export, clone/edit, dashboards, analytics, Menu Cards admin, audit, a11y). SESSION-LOG update = the wrap-up step. README refresh optional. *(Docs done; log update at wrap-up.)*

---

## Open / resolved items
- **O1** Session-timeout duration — default 30 min set; confirm final value with team.
- **O2 (resolved)** PDFs stored **locally now** (folder + DB metadata) → server/GitLab later (A6).
- **O3 (resolved)** Estimate Number = **`ARCH-XXXX`**, auto-suggested, `XXXX` editable by DM/Admin, unique on save (R4.1a / design §6.1).
- **O4 (resolved for now)** Licence = **Internal / open**; revisit before wider go-live.
- **O5** Generated-PDF retention/cleanup — deferred; conscious omission.
- **Storage** Prototype uses **SQLite** (not localStorage); prod DB **PostgreSQL vs SQL Server** decided at Stage 11.

## Sequencing notes
- Stages 0→2 are the foundation; 3 (Menu Card) must precede 4–5 (catalogue/estimates need data).
- Audit (Stage 8) is wired incrementally as each module lands, then consolidated.
- Deployment/prod-DB validation (Stage 11) is explicitly separate so SQLite-dev convenience
  never masks a production-DB difference.

---

*Powered by Forjé*
*© 2026 Isaac A Gera. All rights reserved.*
