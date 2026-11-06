/**
 * MDP database backup — dependency-free (Node built-ins + node:sqlite only).
 *
 * Makes a CONSISTENT backup of the live SQLite database using SQLite's own `VACUUM INTO`, which
 * writes a fully-formed, defragmented copy of the database in a single atomic operation. This is
 * safe to run while the server is live (unlike a raw file copy, which can capture a torn page or
 * miss the -wal/-journal). The output is a standalone .db you can restore by copying it back.
 *
 * Usage (from the app/ folder):
 *   node backup-db.mjs                         # backs up the configured DB -> ./data/backups/
 *   node backup-db.mjs --db ./data/mdp.db      # explicit source
 *   node backup-db.mjs --out D:\mdp-backups    # explicit destination directory
 *   node backup-db.mjs --verify                # after backup, open the copy + integrity_check
 *
 * Exit code 0 on success, non-zero on failure (so a scheduled task / CI can detect problems).
 *
 * Restore (see DEPLOYMENT.md §Backup & restore): stop the app, replace the live DB file with a
 * chosen backup, restart. Always keep the backup you restored FROM.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- tiny arg parser (no dependency) ----
function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag) => process.argv.includes(flag);

// Source DB: --db, else DB_PATH, else the app default (app/data/mdp.db).
const srcDb = resolve(
  getArg('--db') || process.env.DB_PATH || join(__dirname, 'data', 'mdp.db'),
);
// Destination dir: --out, else app/data/backups/.
const outDir = resolve(getArg('--out') || join(__dirname, 'data', 'backups'));
const doVerify = hasFlag('--verify');

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function fail(msg) {
  console.error(`[backup] ERROR: ${msg}`);
  process.exit(1);
}

if (!existsSync(srcDb)) fail(`source database not found: ${srcDb}`);
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const base = basename(srcDb).replace(/\.db$/i, '') || 'mdp';
const outFile = join(outDir, `${base}-backup-${timestamp()}.db`);

console.log(`[backup] source:      ${srcDb}`);
console.log(`[backup] destination: ${outFile}`);

let db;
try {
  // Open read-only — a backup must never modify the source.
  db = new DatabaseSync(srcDb, { readOnly: true });
  // VACUUM INTO writes a single consistent snapshot. The path is a string literal in SQL, so
  // escape embedded single quotes defensively.
  const safePath = outFile.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${safePath}'`);
} catch (err) {
  fail(`VACUUM INTO failed: ${err.message}`);
} finally {
  try { db?.close(); } catch { /* ignore */ }
}

if (!existsSync(outFile)) fail('backup file was not created');
const sizeKb = (statSync(outFile).size / 1024).toFixed(1);
console.log(`[backup] OK — wrote ${sizeKb} KB`);

// ---- optional verification: open the backup and run an integrity check ----
if (doVerify) {
  let check;
  try {
    check = new DatabaseSync(outFile, { readOnly: true });
    const row = check.prepare('PRAGMA integrity_check').get();
    const result = row && (row.integrity_check ?? Object.values(row)[0]);
    if (result !== 'ok') fail(`integrity_check on the backup returned: ${result}`);
    // A light sanity read: confirm the core tables are present + countable.
    const tables = ['users', 'menu_card_versions', 'service_variants', 'estimates', 'estimate_lines', 'audit_events'];
    for (const t of tables) {
      const c = check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
      console.log(`[verify] ${t}: ${c.n} row(s)`);
    }
    console.log('[verify] integrity_check: ok');
  } catch (err) {
    fail(`verification failed: ${err.message}`);
  } finally {
    try { check?.close(); } catch { /* ignore */ }
  }
}

console.log('[backup] done.');
