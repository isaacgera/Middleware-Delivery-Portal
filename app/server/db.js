/**
 * Data layer — opens the SQLite database via the built-in node:sqlite module (Node 22+),
 * initialises the schema on first run, and seeds starter users. No ORM, no npm dependency.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { hashPassword } from './crypto-util.js';
import { Role } from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

/** Lazily open (and cache) the database connection. */
export function getDb() {
  if (_db) return _db;
  // ensure the data directory exists
  const dir = dirname(config.dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  _db = new DatabaseSync(config.dbPath);
  _db.exec('PRAGMA foreign_keys = ON;');
  return _db;
}

/** Close and forget the cached connection (used by tests so the process can exit cleanly). */
export function closeDb() {
  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
    _db = null;
  }
}

/** Create tables (idempotent) and seed starter users if the table is empty. */
export function initSchema() {
  const db = getDb();
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  db.exec(sql);
  migrate(db);
  seedUsers(db);
}

/** Idempotent column additions for DBs created before a column existed (prototype migrations). */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(menu_card_versions)').all();
  const hasStoredFile = cols.some((c) => c.name === 'stored_file_path');
  if (!hasStoredFile) {
    db.exec('ALTER TABLE menu_card_versions ADD COLUMN stored_file_path TEXT');
  }

  migrateEstimatesToRequests(db);
}

/**
 * Stage 5 amendment — rework the estimates table into the "Request" shape:
 *   renames: estimate_number -> jira_reference, name -> summary,
 *            opportunity_ref -> external_ref, description -> remarks
 *   adds:    request_ref (MDP-XXXX internal), cfu, approver, component, size,
 *            ip_code, io_reference
 * Idempotent: each step is guarded by a column-existence check, so it runs at most once per DB.
 * New mandatory columns are added as nullable at the DB level (SQLite can't add NOT NULL to a
 * populated table); mandatoriness is enforced in app validation.
 */
function migrateEstimatesToRequests(db) {
  const has = (name) => db.prepare('PRAGMA table_info(estimates)').all().some((c) => c.name === name);

  // renames (SQLite 3.25+; Node 24's bundled SQLite supports RENAME COLUMN)
  if (has('estimate_number') && !has('jira_reference')) {
    db.exec('ALTER TABLE estimates RENAME COLUMN estimate_number TO jira_reference');
  }
  if (has('name') && !has('summary')) {
    db.exec('ALTER TABLE estimates RENAME COLUMN name TO summary');
  }
  if (has('opportunity_ref') && !has('external_ref')) {
    db.exec('ALTER TABLE estimates RENAME COLUMN opportunity_ref TO external_ref');
  }
  if (has('description') && !has('remarks')) {
    db.exec('ALTER TABLE estimates RENAME COLUMN description TO remarks');
  }

  // additions (nullable at DB level; app enforces the mandatory ones)
  const addCol = (name, decl) => { if (!has(name)) db.exec(`ALTER TABLE estimates ADD COLUMN ${name} ${decl}`); };
  addCol('request_ref', 'TEXT');
  addCol('cfu', 'TEXT');
  addCol('approver', 'TEXT');
  addCol('component', 'TEXT');
  addCol('size', 'TEXT');
  addCol('ip_code', 'TEXT');
  addCol('io_reference', 'TEXT');

  // Indexes on the new columns — created here (not in schema.sql) because on an old-shape DB
  // the columns don't exist when schema.sql first runs.
  db.exec('CREATE INDEX IF NOT EXISTS idx_est_component ON estimates(component)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_est_cfu ON estimates(cfu)');

  // Backfill request_ref for any pre-existing rows so the internal key is populated.
  const needsRef = db.prepare("SELECT id FROM estimates WHERE request_ref IS NULL OR request_ref = ''").all();
  if (needsRef.length) {
    // find current max MDP-#### to continue the sequence
    const rows = db.prepare('SELECT request_ref FROM estimates WHERE request_ref LIKE ?').all('MDP-%');
    let max = 0;
    for (const r of rows) {
      const m = /^MDP-(\d+)$/.exec(r.request_ref || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const upd = db.prepare('UPDATE estimates SET request_ref = ? WHERE id = ?');
    for (const r of needsRef) {
      max += 1;
      upd.run(`MDP-${String(max).padStart(4, '0')}`, r.id);
    }
  }

  // Status workflow change — remap the TRULY-DEAD legacy status values onto the new set.
  // DRAFT and UNDER_REVIEW no longer exist anywhere in the app, so these only ever touch genuine
  // pre-Stage-5 legacy rows and are idempotent (nothing matches on later boots).
  //
  // NOTE: there is intentionally NO 'ARCHIVED'->'DONE' remap. The old lifecycle's ARCHIVED (which
  // meant "finished") and the Stage 6 ARCHIVED (a live, user-set status) share the same string, so
  // a value-based remap can't tell them apart — and because it would re-fire on every boot it would
  // silently turn every genuinely-archived request into DONE after a restart (a data-loss bug).
  // Any real pre-Stage-5 legacy data was already migrated on an earlier boot, so dropping it is safe.
  const remapStatus = db.prepare('UPDATE estimates SET status = ? WHERE status = ?');
  remapStatus.run('NEW', 'DRAFT');
  remapStatus.run('PENDING', 'UNDER_REVIEW');
  // Any row with no/unknown status falls back to NEW. ARCHIVED (Stage 6) and CANCELLED (Stage 9)
  // are valid statuses and MUST stay in this allow-list, otherwise those requests would be
  // silently reset to NEW on the next boot.
  db.exec(
    "UPDATE estimates SET status = 'NEW' WHERE status IS NULL OR status NOT IN ('NEW','PENDING','APPROVED','IN_PROGRESS','DONE','ARCHIVED','CANCELLED')",
  );
}

function seedUsers(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (row.n > 0) return; // already seeded

  const insert = db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, email, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );

  insert.run(
    randomUUID(),
    'admin',
    hashPassword('admin123'),
    'MDP Administrator',
    'admin@example.local',
    Role.ADMINISTRATOR,
  );
  insert.run(
    randomUUID(),
    'manager',
    hashPassword('manager123'),
    'Delivery Manager',
    'manager@example.local',
    Role.DELIVERY_MANAGER,
  );

  console.log('Seeded starter users:');
  console.log('  admin   / admin123   (Administrator)');
  console.log('  manager / manager123 (Delivery Manager)');
  console.log('  >> Change these before any real use.');
}
