-- MDP schema (SQLite / node:sqlite). Dependency-free equivalent of the Prisma schema.
-- Enum-like fields are TEXT, validated in application code against constants.js.
-- Money/effort values are REAL (stored as imported from the Menu Card; never recomputed).
-- The "exactly one ACTIVE MenuCardVersion" rule is enforced by a transaction in app code.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL,                 -- DELIVERY_MANAGER | ADMINISTRATOR
  is_active     INTEGER NOT NULL DEFAULT 1,    -- boolean 0/1
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS menu_card_versions (
  id               TEXT PRIMARY KEY,
  label            TEXT NOT NULL,              -- e.g. "V5"
  financial_year   TEXT NOT NULL,              -- e.g. "FY27"
  source_filename  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | ACTIVE | ARCHIVED
  blended_usp_rate REAL NOT NULL,
  overhead_pct     REAL NOT NULL,
  people_day_rate  REAL NOT NULL,
  import_summary   TEXT,                       -- JSON string
  stored_file_path TEXT,                       -- path to the original uploaded .xlsx (nullable)
  uploaded_by_id   TEXT NOT NULL,
  uploaded_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (uploaded_by_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_mcv_status ON menu_card_versions(status);
CREATE INDEX IF NOT EXISTS idx_mcv_fy ON menu_card_versions(financial_year);

CREATE TABLE IF NOT EXISTS service_variants (
  id                   TEXT PRIMARY KEY,
  menu_card_version_id TEXT NOT NULL,
  component            TEXT NOT NULL,          -- MQ | WLS | CFT | WILDFLY
  size                 TEXT NOT NULL,          -- TO/XS/S/M/L/XL/XXL (data-driven)
  change_category      TEXT NOT NULL,
  description          TEXT NOT NULL,
  scope                TEXT,
  assumptions          TEXT,
  exclusions           TEXT,
  pd                   REAL NOT NULL,
  usp                  REAL NOT NULL,
  atom                 REAL NOT NULL,
  usp_cost             REAL NOT NULL,
  overhead_cost        REAL NOT NULL,
  total_cost           REAL NOT NULL,
  current_partner_cost TEXT,                   -- free text / range / "NA"
  effort_phases        TEXT,                   -- JSON string
  row_index            INTEGER NOT NULL,
  FOREIGN KEY (menu_card_version_id) REFERENCES menu_card_versions(id) ON DELETE CASCADE,
  UNIQUE (menu_card_version_id, component, size, description)
);
CREATE INDEX IF NOT EXISTS idx_sv_mcv_comp ON service_variants(menu_card_version_id, component);

-- "estimates" are called "Requests" in the UI. Internal key is `request_ref` (MDP-XXXX,
-- backend-only, never shown); `jira_reference` is the user-typed, unique, mandatory handle.
CREATE TABLE IF NOT EXISTS estimates (
  id                   TEXT PRIMARY KEY,
  request_ref          TEXT UNIQUE,            -- MDP-XXXX internal reference (hidden)
  jira_reference       TEXT NOT NULL UNIQUE,   -- user-typed, e.g. ARCH-1234 / PROJ-567
  summary              TEXT NOT NULL,          -- was "name" (Summary / Title)
  customer_name        TEXT NOT NULL,
  cfu                  TEXT NOT NULL,          -- Customer Facing Unit (mandatory)
  approver             TEXT NOT NULL,          -- free-text approver name (mandatory)
  component            TEXT NOT NULL,          -- MQ | WLS | CFT | WILDFLY (scopes the catalogue)
  size                 TEXT NOT NULL,          -- TO/XS/S/M/L/XL/XXL (scopes the catalogue)
  external_ref         TEXT,                   -- was "opportunity_ref"
  ip_code              TEXT,
  io_reference         TEXT,
  remarks              TEXT,                   -- was "description"
  version              INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL DEFAULT 'NEW',   -- EstimateStatus (New/Pending/Approved/In Progress/Done)
  menu_card_version_id TEXT NOT NULL,          -- pinned
  created_by_id        TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  row_version          INTEGER NOT NULL DEFAULT 0, -- optimistic concurrency
  FOREIGN KEY (menu_card_version_id) REFERENCES menu_card_versions(id),
  FOREIGN KEY (created_by_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_est_status ON estimates(status);
CREATE INDEX IF NOT EXISTS idx_est_customer ON estimates(customer_name);
CREATE INDEX IF NOT EXISTS idx_est_created_by ON estimates(created_by_id);
CREATE INDEX IF NOT EXISTS idx_est_created_at ON estimates(created_at);
-- idx_est_component / idx_est_cfu are created in db.js migrate() AFTER the columns are
-- guaranteed to exist (an old-shape DB won't have them when schema.sql first runs).

CREATE TABLE IF NOT EXISTS estimate_lines (
  id                 TEXT PRIMARY KEY,
  estimate_id        TEXT NOT NULL,
  service_variant_id TEXT NOT NULL,
  component          TEXT NOT NULL,            -- denormalised
  size               TEXT NOT NULL,
  description        TEXT NOT NULL,
  quantity           REAL NOT NULL,
  -- snapshot of the six values at add-time
  snap_pd            REAL NOT NULL,
  snap_usp           REAL NOT NULL,
  snap_atom          REAL NOT NULL,
  snap_usp_cost      REAL NOT NULL,
  snap_overhead_cost REAL NOT NULL,
  snap_total_cost    REAL NOT NULL,
  notes              TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
  FOREIGN KEY (service_variant_id) REFERENCES service_variants(id)
);
CREATE INDEX IF NOT EXISTS idx_line_estimate ON estimate_lines(estimate_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  detail      TEXT,                            -- JSON string
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);

CREATE TABLE IF NOT EXISTS generated_documents (
  id                   TEXT PRIMARY KEY,
  estimate_id          TEXT NOT NULL,
  format               TEXT NOT NULL DEFAULT 'PDF',
  file_path            TEXT NOT NULL,
  file_name            TEXT NOT NULL,
  menu_card_version_id TEXT,
  generated_by_id      TEXT NOT NULL,
  generated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  size_bytes           INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_doc_estimate ON generated_documents(estimate_id);
