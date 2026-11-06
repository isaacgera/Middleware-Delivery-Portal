/**
 * Config loader — reads a plain .env file (KEY=value lines) with no third-party dependency.
 * Falls back to sensible defaults so the prototype runs out of the box with `node server.js`.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// app/ root is one level up from app/server/
export const APP_ROOT = join(__dirname, '..');

function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvFile(join(APP_ROOT, '.env'));
const env = { ...fileEnv, ...process.env }; // real env vars win over .env file

export const config = {
  port: Number(env.PORT || 4000),
  host: env.HOST || '127.0.0.1',
  // DB file lives in app/data/mdp.db by default
  dbPath: env.DB_PATH || join(APP_ROOT, 'data', 'mdp.db'),
  // session signing secret (dev default; change for any real use)
  sessionSecret: env.SESSION_SECRET || 'dev-only-change-me-secret',
  sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES || 30),
  // generated PDFs / exports (local prototype storage)
  docStorageDir: env.DOC_STORAGE_DIR || join(APP_ROOT, 'data', 'generated-docs'),
  // directory of static frontend assets
  webDir: join(APP_ROOT, 'web'),
  isProd: env.NODE_ENV === 'production',
};
