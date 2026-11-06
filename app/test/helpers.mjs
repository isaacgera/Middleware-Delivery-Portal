/**
 * Shared test helpers for the MDP `node --test` suite.
 *
 * SAFETY: every test runs against a THROWAWAY SQLite database in the OS temp directory. We never
 * open the real `app/data/mdp.db` or the sample `mdp-sample.db`. The mechanism is:
 *   - `config.dbPath` honours the `DB_PATH` env var (see server/config.js), and `config` is
 *     evaluated ONCE at import time. So each test file MUST call `useTempDb()` BEFORE importing
 *     any server module that transitively imports config/db. `node --test` runs every test file
 *     in its own process, so there is no cross-file leakage of the env var or the cached db.
 *
 * Typical use (top of a *.test.mjs file, before any repo import):
 *
 *   import { useTempDb } from './helpers.mjs';
 *   useTempDb();                              // sets process.env.DB_PATH -> temp file
 *   const { initSchema, getDb } = await import('../server/db.js');
 *   initSchema();
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let _tempDir = null;

/**
 * Point the app's DB at a fresh throwaway file and guarantee it is NOT one of the real DBs.
 * Returns the temp db path. Call this at module top, before importing db.js/config.js.
 */
export function useTempDb() {
  _tempDir = mkdtempSync(join(tmpdir(), 'mdp-test-'));
  const dbPath = join(_tempDir, `${randomUUID()}.db`);
  if (/mdp\.db$|mdp-sample\.db$/.test(dbPath)) {
    throw new Error(`Refusing to use a real DB path in tests: ${dbPath}`);
  }
  process.env.DB_PATH = dbPath;
  // Deterministic session secret so nothing depends on the dev default.
  process.env.SESSION_SECRET = 'test-only-secret';
  return dbPath;
}

/**
 * Close the DB connection and remove the throwaway temp directory. Safe to call in `after()`.
 * Closing the node:sqlite handle lets the test process exit cleanly (an open handle otherwise
 * keeps it alive and the runner's output can be lost).
 */
export async function cleanupTempDb() {
  try {
    const { closeDb } = await import('../server/db.js');
    closeDb();
  } catch { /* db.js may not have been imported in a given test file */ }
  if (_tempDir) {
    try { rmSync(_tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    _tempDir = null;
  }
}

/**
 * Insert a menu card version + its service variants directly (bypassing the .xlsx importer),
 * so repo tests have catalogue data without needing a real workbook.
 *
 * @param db           the sqlite handle from getDb()
 * @param opts.status  'DRAFT' | 'ACTIVE' | 'ARCHIVED'  (default 'ACTIVE')
 * @param opts.variants array of { component, size, description, pd, usp, atom, uspCost,
 *                       overheadCost, totalCost } — the six snapshot values live here.
 * @param opts.uploadedById  a seeded user id (the DB seeds admin + manager on initSchema).
 * @returns { versionId, variantIds: { '<component>/<size>/<description>': id } }
 */
export function insertMenuCard(db, { status = 'ACTIVE', variants = [], uploadedById, label = 'V5', financialYear = 'FY27' } = {}) {
  const versionId = randomUUID();
  db.prepare(
    `INSERT INTO menu_card_versions
       (id, label, financial_year, source_filename, status,
        blended_usp_rate, overhead_pct, people_day_rate, uploaded_by_id)
     VALUES (?, ?, ?, ?, ?, 55.56, 40, 144, ?)`,
  ).run(versionId, label, financialYear, `${label}.xlsx`, status, uploadedById);

  const insertVariant = db.prepare(
    `INSERT INTO service_variants
       (id, menu_card_version_id, component, size, change_category, description,
        pd, usp, atom, usp_cost, overhead_cost, total_cost, row_index)
     VALUES (?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const variantIds = {};
  let i = 0;
  for (const v of variants) {
    const id = randomUUID();
    insertVariant.run(
      id, versionId, v.component, v.size, v.description,
      v.pd, v.usp, v.atom, v.uspCost, v.overheadCost, v.totalCost, i,
    );
    variantIds[`${v.component}/${v.size}/${v.description}`] = id;
    i += 1;
  }
  return { versionId, variantIds };
}

/** Fetch a seeded user id by username ('admin' | 'manager'). initSchema() seeds both. */
export function userId(db, username) {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!row) throw new Error(`Seeded user "${username}" not found`);
  return row.id;
}

/** The canonical MQ XL golden variant from the real V5 workbook (design §4 / task 3.9). */
export const MQ_XL_GOLDEN = {
  component: 'MQ', size: 'XL', description: 'MQ XL change',
  pd: 54, usp: 108, atom: 54, uspCost: 6000.48, overheadCost: 2400.19, totalCost: 8400.67,
};
