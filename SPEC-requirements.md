# Middleware Delivery Portal (MDP) — SPEC: Requirements

- **Project:** Middleware Delivery Portal (MDP)
- **Phase:** Phase 1 — Estimation & Planning
- **Tier / Category:** Complex / Work
- **Status:** In Progress (code-complete gate: awaiting sign-off before any "Built")
- **Owner:** Isaac A Gera (Middleware Delivery Team)
- **Source documents:** `Middleware Delivery Portal (MDP).md` (requirements draft), `Middleware_Architecture_Menu_Card_2627_V5.xlsx` (reference Menu Card workbook, read end-to-end)
- **Last updated:** 2026-11-05 (Stage 12 Spec-Reviewer alignment — R7 PDF now client-side jsPDF; R4.2 adds ARCHIVED + CANCELLED; NFR1 Entra deferral explicit; NFR12 acceptance criterion + met-evidence; A3/A4/A5 reflect SQLite-in-prod + dependency-free runtime / Track-2 parked. Earlier: 2026-10-21 Stage 5 Request rename + field rework.)

---

## 1. Purpose & Vision

MDP is a centralized, multi-user, server-backed web platform that replaces the current
spreadsheet-based ("Menu Card") middleware estimation and costing process with a single,
governed source of truth.

Phase 1 delivers **Estimation & Planning**: importing approved Menu Card data, building
customer estimates from it, calculating effort and cost deterministically, storing and
searching estimates, generating customer-ready PDF documents, and auditing all activity.

**Guiding principle:** MDP is a **deterministic lookup-and-multiply calculator over approved,
FY-versioned Menu Card values** — it is NOT an estimation engine. Every PD/USP/ATOM/cost
figure is stored from the imported Menu Card as-is and displayed; the only arithmetic MDP
performs is `stored value × quantity` and summing totals. MDP shall not independently
calculate or alter effort/cost values.

---

## 2. Background & Problem Statement

Estimation is currently done through Excel "Menu Card" workbooks, causing:

- Manual spreadsheet navigation and repetitive calculation
- Multiple uncontrolled spreadsheet versions
- No central estimate repository or reliable history
- Limited auditability and governance
- Manual, inconsistent generation of customer-facing documents
- Difficulty locating prior estimates as demand grows

MDP centralizes this so a small team (3–5 concurrent users) works from the same data in real
time, with versioned reference data and a full audit trail.

---

## 3. Users & Roles

Phase 1 has **two roles**:

| Role | Can do |
|---|---|
| **Delivery Manager (DM)** | Create / edit / clone / archive estimates; add/edit/delete/duplicate estimate lines; run calculations; search & filter the estimate repository; generate & download PDF exports; view dashboards. |
| **Administrator** | **Full superset of Delivery Manager**, PLUS: Menu Card management (upload / validate / version / activate / archive); user management; system settings; view import & audit logs. |

- Administrator can do anything a Delivery Manager can do.
- (Deferred from the original draft: the Estimator and Solution Architect roles are NOT in
  Phase 1; the two-role model above replaces them.)

---

## 4. Reference Data — the Menu Card (ground truth from the real workbook)

The approved Menu Card workbook is the master source of estimation data. The real V5/FY27
workbook was analysed directly; the following reflects its **actual** structure (which differs
from the original requirements draft and governs the design).

### 4.1 Workbook structure
Six worksheets: `Version`, `Variables`, then one tab per **component**: `MQ`, `Weblogic`,
`CFT`, `WildFly`.

- **Product = Component Name** (MQ / WLS / CFT / WildFly). All four are tagged to a single
  fixed App ID **`APP02752`** (SALSA ID) which is **metadata only** — not significant to
  estimating, not stored per estimate line.
- The four components do **NOT** share a column layout — each has its own effort-phase
  columns before a shared costing tail.

### 4.2 Per-component effort-phase columns (vary by component)
| Component | Effort-phase columns |
|---|---|
| **MQ** | Requirements Analysis; Publish HLD & DD; Develop and Build; Design/Scripts Review & Sign Off; Deployment & Sanity; Cutover Plan & Execution; Overhead |
| **Weblogic (WLS)** | Requirements Analysis; Prepare Build Scripts; Post Build Verifications; Overhead |
| **CFT** | Requirements Analysis/clarifications/quality checks; Implement; Post implementation testing; Release/Go-live support |
| **WildFly** | Requirements Analysis; Configuration Modification; Post Build Verifications; Overhead |

### 4.3 Shared costing tail (all components)
`Median Effort – PD`, `USP`, `ATOM`, `USP Cost`, `Vendor Cost` (a.k.a. Overhead/TCS cost),
`Total Cost`, and `Current Partner Cost` (present for MQ/WLS/CFT; absent for WildFly).

### 4.4 Meaning of the stored values (confirmed)
- **PD = Person Days** — the "Median Effort – PD", the sum of the per-phase effort columns.
- **USP = Unique Story Points** — in the workbook, `USP = PD × 2` (a derived value).
- **ATOM** — a unit of 8 hours; in the workbook `ATOM = PD × 1` (a derived value).
- **USP Cost** = `PD × 2 × blended USP rate` (blended rate `£55.56`; some "Test Only" rows
  use the People-Day rate `£144`).
- **Vendor Cost / Overhead** = `USP Cost × 40%` (flat "Overhead %" cell per component tab).
- **Total Cost** = `USP Cost + Vendor Cost` (= `USP Cost × 1.40`).
- **Current Partner Cost** = reference/benchmark only (may be a range e.g. "7500 to 8000" or
  "NA"); **not** part of MDP's calculation.

> **MDP stores all six values (PD, USP, ATOM, USP Cost, Overhead/Vendor Cost, Total Cost) as
> imported and never recomputes them.** The blended rate and overhead % live in the `Variables`
> tab and matter only if a Menu Card is regenerated — which is out of Phase 1 scope.

### 4.5 Line-item identity (critical design decision)
Size (T-shirt: TO/XS/S/M/L/XL/XXL) is **NOT unique within a component** — e.g. MQ has two
`M` rows and two `XS` rows with different change-category descriptions, and components use
different size ladders (WildFly has no XXL). Therefore:

- **A catalogue line / estimate line is identified by `Component + Size + Change-Category
  Description` (the service variant)** — never by Size alone.
- Size options and available variants are **data-driven from the active Menu Card**, never
  hardcoded.

### 4.6 Financial-year versioning
The Menu Card is **versioned per Financial Year** (the sample is "FY27 contract / V5"). FY is a
first-class attribute of a Menu Card version. The `Variables` tab carries FY27/FY28/FY29 rates.

---

## 5. Scope

### 5.1 In scope (Phase 1)
1. Authentication (temporary username/password) + Role-Based Access Control (2 roles)
2. Menu Card Management (Excel import, validate, version, activate, archive, import log)
3. Product Catalogue (searchable/filterable, variant-level)
4. Estimate Builder (header + line items, status lifecycle)
5. Cost Calculation Engine (lookup × quantity + totals)
6. Estimate Repository (store/search/filter/clone/version/archive)
7. Export Engine (**PDF only**; client-side vendored jsPDF — see Module 7 amendment)
8. Audit Logging (eight event types)
9. Reporting — three read-only dashboards

### 5.2 Out of scope (Phase 1 — deferred)
Revenue tracking · financial trend analysis · resource capacity planning · margin analytics ·
forecasting · AI assistant · customer portal · **DOCX export** · in-app Menu Card editing or
independent effort calculation · admin "regenerate Menu Card" tooling.

---

## 6. Functional Requirements

### Module 1 — Authentication & Access Control
- **R1.1** Temporary username/password login; passwords stored **hashed** (never plaintext),
  server-side.
- **R1.2** Role-Based Access Control enforcing the two roles (Section 3), checked
  **server-side** on every protected operation (not just hidden in the UI).
- **R1.3** Session timeout after a configurable idle period (**default 30 minutes**; O1 to
  confirm final value with the team).
- **R1.4** User profile (view own details; change own password).
- **R1.5** **Entra ID seam:** authentication is behind an abstraction so Microsoft Entra ID
  (OIDC) can be integrated later in Phase 1 without reworking the role model or app code.
  (Entra ID integration itself is a later Phase 1 increment, not the first release.)

### Module 2 — Menu Card Management (Administrator only)
- **R2.1** Upload a Menu Card Excel (`.xlsx`) file.
- **R2.2** **Product-aware parser:** handle the four different per-component effort-column
  layouts (Section 4.2) mapping down to the shared costing tail (4.3); clean embedded
  tabs/newlines in description cells.
- **R2.3** Validation rules — mandatory: Component, Size, PD, Total Cost. Flag duplicate
  variants (same Component+Size+Description). Report validation errors before activation.
- **R2.4** Create a **version** on import, carrying: version label, **Financial Year**, source
  filename, uploaded-by, uploaded-date, captured blended-USP rate and overhead %.
- **R2.5** **Exactly one Active version** at a time; activating a version makes it the source
  for new estimates; previous active version is retained (archived), never deleted.
- **R2.6** Archive obsolete versions; view version history and per-import audit log.
- **R2.7** A Menu Card version is **immutable once activated** (corrections = import a new
  version, not edit in place).

### Module 3 — Product Catalogue
- **R3.1** Read-only, searchable, filterable view of the **active** Menu Card's service
  variants.
- **R3.2** Each entry shows: Component, Service Category, Size, Description, Scope,
  Assumptions, Exclusions, PD, USP, ATOM, USP Cost, Overhead Cost, Total Cost (and reference
  Current Partner Cost where present).
- **R3.3** Search by text; filter by Component and Size.
- **R3.4** Selection is at **variant** granularity (Component+Size+Description).

### Module 4 — Request Builder  *(an "estimate" is called a **Request** in the UI)*
- **R4.1** Request header fields:
  - **JIRA Reference** (user-typed, **mandatory, unique** — the visible handle, e.g. `ARCH-1234`)
  - **Summary / Title** (mandatory)
  - **Customer Name** (mandatory)
  - **CFU** — Customer Facing Unit (mandatory; dropdown, alphabetical: Architecture, Business,
    Consumer, Corporate, Data & AI, International, Networks, Openreach)
  - **Approver** (mandatory; free text)
  - **Component** (mandatory; dropdown CFT / MQ / WFY / WLS — from the catalogue)
  - **Size** (mandatory; dropdown TO / XS / S / M / L / XL / XXL — from the catalogue)
  - **External Ref** (optional)
  - **IP Code** (optional)
  - **IO Reference** (optional)
  - **Remarks** (optional)
  - plus system fields: Status, Version, Created By, Created Date.
- **R4.1a** The backend assigns an **internal reference `MDP-XXXX`** (auto, sequential,
  zero-padded) as the primary human-readable key. It is **backend-only and never displayed** —
  the user never sees or edits it. The **JIRA Reference** is the user-facing identifier; it is
  typed by the user (it originates in JIRA), **mandatory**, and **unique on save** (a duplicate
  is rejected with a clear message). There is no auto-suggest for the JIRA Reference.
- **R4.1b** **Component + Size scope the line items.** A request's Component and Size determine
  which catalogue variants its lines may be drawn from — the add-from-catalogue list is filtered
  to that Component + Size, and the server rejects any line outside the scope. Component/Size
  cannot be changed once the request has line items (remove the lines first); this prevents
  orphaning snapshotted lines.
- **R4.2** Request status workflow: **New (default) → Pending → Approved → In Progress → Done**,
  with two additional states added during the build:
  - **ARCHIVED** (Stage 6) — a separate "filed away" state, not on the active line. Reached via
    an explicit **Archive** action; archived requests are hidden from the default list (surfaced
    via a "Show archived" filter) and restored by **un-archiving** back to an active status.
  - **CANCELLED** (Stage 9) — for a request stopped partway. Reachable from any active status,
    but **guarded**: a DONE or ARCHIVED request cannot be cancelled, and a CANCELLED request
    must be **revived** to an active status before it can go to Done/Archived. (This is the only
    transition restriction.)
  Otherwise transitions among the five active statuses are **unrestricted** — any status, any
  time — and status does **not** lock editing (header and lines remain editable). (Replaces the
  earlier Draft→Under Review→Approved→Archived lifecycle; legacy values migrate DRAFT→New,
  Under Review→Pending, Approved→Approved, old-Archived→Done.)
- **R4.3** Request line fields: Component, Service (variant/description), Size, Quantity, Notes
  (Component/Size are fixed to the request's scope).
- **R4.4** Line operations: Add, Edit, Delete, Duplicate. (Line Delete is a hard delete of a
  *line*; requests themselves are never hard-deleted — only Archived per R4.2/R6.3. The
  `ESTIMATE_DELETE` audit event records **line** deletions; request-level delete is a prototype
  convenience.)
- **R4.5** Each request **pins the Menu Card version** it is built on.
- **R4.6** **Snapshot-on-add:** when a line is added, the variant's six values are **snapshotted
  onto the line**, so a later Menu Card change never silently alters an existing request.

### Module 5 — Cost Calculation Engine
- **R5.1** For each line: `Line PD = snapshot PD × Quantity`; `Line Cost = snapshot Total Cost
  × Quantity`. Likewise line-level USP, ATOM, USP Cost, Overhead Cost = snapshot value × Qty.
- **R5.2** Estimate totals: Total PD, Total USP, Total ATOM, Total USP Cost, Total Overhead
  Cost, Grand Total Cost.
- **R5.3** Totals recalculate automatically whenever lines change.
- **R5.4** The engine performs **no independent effort/cost computation** beyond ×quantity and
  summation.

### Module 6 — Request Repository
- **R6.1** View, search, filter requests. The **list (landing) page shows each request's Total
  Cost and Total PD** directly (computed per row), so costs are visible without opening a
  request.
- **R6.1a** The list provides a **generic search box** matching across all displayed columns
  (JIRA Ref, Summary, Customer, CFU, Component, Size, Approver, Status) **plus a per-column
  filter row** for narrowing an individual column. Searching/filtering is client-side over the
  loaded set for instant response.
- **R6.2** Search criteria: JIRA Reference, Customer, Component, Status, CFU, Approver, Created
  By. (Date range deferred.)
- **R6.3** Version history per estimate; clone estimate; archive estimate.
- **R6.4** All users (both roles) see the **same shared estimates** in real time (on refresh);
  the DB is the single source of truth.

### Module 7 — Export Engine (PDF only, Phase 1)
> **Amendment (2026-10-28, Stage 7):** PDF generation is **client-side** using a **vendored
> jsPDF** library, not the originally-planned server-side pdfmake. Rationale: BT's network
> blocks npm (the whole live build is dependency-free), and the Menu Card Catalogue had already
> proven the vendored-jsPDF + adaptive-delivery pattern. The server does not render the PDF; it
> only records the export as metadata. The customer artifact and its contents are unchanged in
> intent — only where the bytes are produced differs.
- **R7.1** Generate a customer-ready **PDF** in the browser (vendored **jsPDF**), delivered
  adaptively: **download** on desktop, native **share sheet** on mobile, with a fallback. (The
  server records the export; it does not generate the file.)
- **R7.2** PDF content **as refined with Isaac (Stage 7)**: Cover; a **Summary** two-column
  grid (Customer, CFU, Component, Approver, Status, Recorded by, Date received, plus External
  Ref/IP/IO when present); **Cost Summary** (Story Points, TCS Cost, FTE Cost, emphasised Grand
  Total); **Remarks**. *(The original list — Line-Item Breakdown, Assumptions, Exclusions,
  Menu Card Version — was removed at Isaac's request during Stage 7.)*
- **R7.3** **Preview** (opens the PDF in a new tab, no server record) vs **Export** (delivers
  the file, then records a `GeneratedDocument` + `ESTIMATE_EXPORT` audit event).
- **R7.4** Record each export's **metadata in the DB** (filename, pinned version, creator,
  size). Because the browser holds the bytes, `file_path` is the marker `'client-generated'`
  rather than a server path; if generation ever moves server-side this gains a real path with
  no schema change. (Binaries are not stored as DB blobs.)

### Module 8 — Audit Logging
- **R8.1** Capture events: Login, Logout, Menu Card Upload, Menu Card Activation, Estimate
  Creation, Estimate Modification, Estimate (line) Deletion, Estimate Export. (Estimate
  archival is recorded as an Estimate Modification — estimates are not hard-deleted.)
- **R8.2** Each record captures: User, Timestamp, Action, Object Affected.
- **R8.3** Audit log is **append-only** (tamper-evident); not editable through the app.

### Module 9 — Reporting Dashboards (read-only)
- **R9.1 Dashboard 1 — Estimate Volume:** count created / approved / archived.
- **R9.2 Dashboard 2 — Estimates by Product:** counts for MQ / WLS / CFT / WildFly.
- **R9.3 Dashboard 3 — Estimate Value Overview:** Total Estimated PD, Total Estimated Cost,
  Estimates by Customer.

---

## 7. Non-Functional Requirements

- **NFR1 Authentication:** temporary username/password now (shipped); **Microsoft Entra ID
  (OIDC)** is the later target behind the auth seam. **Status: the OIDC provider itself is
  explicitly deferred** (tracked as task 2.7) — the abstraction/seam is in place, the Entra
  integration is a later Phase-1 increment and is NOT part of this sign-off.
- **NFR2 Authorization:** RBAC, enforced server-side.
- **NFR3 Performance:** interactive CRUD and search transactions complete within **3 seconds
  (p95, at 5 concurrent users)**. Excel import and PDF generation are explicitly **excluded**
  from this target (they are expected to be longer-running and show progress feedback instead).
- **NFR4 Availability:** target **99.5%**.
- **NFR5 Audit logging:** mandatory, append-only.
- **NFR6 Encryption:** data encrypted **in transit** (HTTPS/TLS) and **at rest** (DB-level).
- **NFR7 Concurrency / scale:** correct, safe concurrent use for **3–5 users** sharing the
  same data (the draft's 100 users / 10,000 estimates / 50,000 lines is **non-binding
  headroom**, not a build or test target). Protection against lost updates on shared records:
  optimistic concurrency on estimate headers, with any line change bumping the parent
  estimate's `rowVersion`; Menu Card activation serialized in a transaction (see R2.5 / design
  §9).
- **NFR12 Backup & restore:** as the system of record, the database has a defined, tested
  **backup and restore** procedure (MDP holds the single source of truth — unlike the
  local-first app family, there is no per-device export acting as backup).
  **Acceptance criterion:** a backup can be produced from a live database without downtime, and
  a restore from that backup reproduces the data with **no loss** — verified by a round-trip
  check (row counts + a content fingerprint per core table match, and `integrity_check` returns
  `ok`). **Met (2026-11-05):** `app/backup-db.mjs` (atomic `VACUUM INTO`) + a tested restore
  round-trip against the real dev DB passed losslessly (see DEPLOYMENT.md §5). Wiring the
  scheduled task + off-box copy on the deployment server is the remaining operational step.
- **NFR8 Browsers:** Edge and Chrome.
- **NFR9 Responsive design:** desktop-first with tablet support (not a mobile/PWA app).
- **NFR10 Data safety:** validate on import; never corrupt/lose estimate data; snapshotting
  preserves historical estimate integrity across Menu Card changes.
- **NFR11 Secrets discipline:** no credentials/keys committed; configuration (DB connection,
  future Entra secrets) via environment, never in source.

---

## 8. Data Model (entities — detailed in SPEC-design)

1. **MenuCardVersion** — FY-versioned container; exactly one Active; immutable once activated;
   captures blended rate + overhead % at import.
2. **ServiceVariant** — a catalogue line under a MenuCardVersion; keyed by
   Component+Size+Description; holds the six stored values + reference data.
3. **Estimate / Request** (header) — pins a MenuCardVersion; has status lifecycle. Carries an
   internal `MDP-XXXX` key (hidden) + a user-typed unique **JIRA Reference**, plus Summary,
   Customer, **CFU**, **Approver**, **Component**, **Size**, External Ref, IP Code, IO
   Reference, Remarks. (UI name: **Request**.)
4. **EstimateLine** — references a ServiceVariant (within the request's Component+Size scope) +
   quantity + notes; stores a **snapshot** of the variant's six values at add-time.
5. **AuditEvent** — append-only; user/timestamp/action/object.
6. **User** — credentials (hashed), role, profile.
7. **GeneratedDocument** — metadata + filesystem path for exported PDFs.

---

## 9. Future Roadmap (Phase 1 must not require redesign to support these)

- **Phase 2 — Financial Tracking:** revenue recording, cost tracking, quarterly/annual
  reporting. *Hook:* estimates already carry FY + pinned version + value snapshots; actuals
  attach as related records.
- **Phase 3 — Executive Dashboards:** financial trends, portfolio reporting, product analysis.
  *Hook:* audit + estimate history are structured and queryable from day one.
- **Phase 4 — Advanced Insights:** forecasting, AI-assisted & predictive reporting. *Hook:*
  clean historical data + server-side engine provide a place for a model to reason later.
- **Auth evolution:** temp login → Entra ID OIDC (same RBAC roles).
- **Export evolution:** add DOCX alongside PDF.

---

## 10. Assumptions & Open Items

- **A1** App ID `APP02752` is fixed and non-significant; stored as version metadata only.
- **A2** "Product" throughout MDP means **Component** (MQ/WLS/CFT/WildFly).
- **A3** **SQLite in both dev and production** (Stage 11 decision, 2026-11-05). The live build
  uses `node:sqlite` directly (a real relational DB, file-based, no install/admin — NOT browser
  localStorage). At 3–5 concurrent users this is the right fit and keeps the dependency-free
  guarantee. Because dev and prod are the **same engine**, the "SQLite passing ≠ production
  passing" concern does not apply to the live track (the test suite already runs against real
  SQLite). The **PostgreSQL / SQL Server** path survives as **Track 2** — the parked
  Prisma/Fastify/React stack (`_parked-npm-stack/`), revived only if BT allows an npm/Nexus
  registry or a managed DB is later mandated (see SPEC-design §8, DEPLOYMENT.md §4).
- **A4** Hosting: the live build runs on the **Node.js runtime alone** (`node server/server.js`
  — no Vite/Fastify/build step; that tooling is the parked Track 2) and demonstrates shared
  multi-user behaviour locally. Production: a BT local server behind a TLS reverse proxy,
  deployed via BT GitLab CI (`.gitlab-ci.yml` runs the syntax-check + test suite); the SQLite
  DB file on the server is the system of record. See DEPLOYMENT.md.
- **A6** **Generated PDFs: stored locally** (a folder on the dev machine, path tracked in the
  DB) during the prototype phase; moved to the server filesystem / GitLab when MDP is deployed
  — same code, configured path.
- **A5** Node.js (v24.21.0) confirmed installed per-user (no admin). The live build needs
  **only the Node runtime** — no npm install, no node_modules, no Python. (npm is noted as
  unavailable on BT's network, which is why the build is dependency-free; it is required only
  to revive Track 2.)
- **O1 (open)** Exact session-timeout duration — to confirm with the team.
- **O2 (resolved for prototype)** Generated PDFs stored **locally now** (folder + DB metadata);
  server filesystem / GitLab when deployed. See A6.
- **O3 (resolved)** Estimate Number format = **`ARCH-XXXX`**, auto-suggested, `XXXX` editable
  by DM/Admin, uniqueness enforced on save. See R4.1a.
- **O4 (resolved for now)** **Licensing** — marked **Internal** / left open for now; revisit
  the formal licence/ownership (BT vs other) before any wider go-live. Does not block the
  build.
- **O5 (deferred)** Generated-PDF **retention/cleanup** policy — none in Phase 1 (files
  accumulate); conscious omission, to revisit.

---

*Powered by Forjé*
*© 2026 Isaac A Gera. All rights reserved.*
