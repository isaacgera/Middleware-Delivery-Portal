/**
 * MDP sample-data seeder (Stage 9 demo data).
 *
 * Populates a SEPARATE SQLite DB with realistic sample data so the Dashboards (and later the
 * flow analytics) have something meaningful to show — a spread of requests across customers,
 * components and statuses, with lines, plus real status-transition history.
 *
 * SAFETY: this refuses to run against the normal dev DB (app/data/mdp.db). It targets its own
 * file — by default app/data/mdp-sample.db — so your real test data is never touched. Override
 * with  SAMPLE_DB_PATH=...  if you want a different location.
 *
 * Run:
 *   node seed-sample-data.mjs
 * Then start the server pointed at the sample DB:
 *   (cmd)        set DB_PATH=<app>\data\mdp-sample.db && node server\server.js
 *   (PowerShell) $env:DB_PATH="<app>\data\mdp-sample.db"; node server\server.js
 * Switch back to real data by starting the server normally (no DB_PATH).
 *
 * Logins are the usual seeded users: admin/admin123, manager/manager123.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultSample = join(__dirname, 'data', 'mdp-sample.db');
const samplePath = process.env.SAMPLE_DB_PATH || defaultSample;

// Guard: never let this point at the real dev DB.
if (/[\\/]mdp\.db$/i.test(samplePath)) {
  console.error('Refusing to seed the main dev DB (mdp.db). Use a separate SAMPLE_DB_PATH.');
  process.exit(1);
}

// Fresh start: remove any previous sample DB so the data set is clean and reproducible.
for (const ext of ['', '-wal', '-shm']) {
  try { if (existsSync(samplePath + ext)) rmSync(samplePath + ext); } catch { /* ignore */ }
}

// Point the app's config at the sample DB BEFORE importing anything that opens it.
process.env.DB_PATH = samplePath;

const srv = join(__dirname, 'server').replace(/\\/g, '/');
const { initSchema, getDb } = await import(`file://${srv}/db.js`);
// Note: this seeder inserts directly (not via the repos) so it can fully control created_at and
// each transition's audit timestamp — the repo's changeStatus/writeEvent always stamp "now",
// which would bunch all flow history into today. Data is still schema-valid + scope-correct.

initSchema();
const db = getDb();

// Defensive clean: if the file couldn't be deleted above (e.g. OneDrive/file lock), wipe the
// data tables so re-runs can't collide on UNIQUE keys. Users are left (re-seeded by initSchema).
db.exec('DELETE FROM audit_events; DELETE FROM generated_documents; DELETE FROM estimate_lines; DELETE FROM estimates; DELETE FROM service_variants; DELETE FROM menu_card_versions;');

const admin = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
const manager = db.prepare("SELECT id FROM users WHERE username='manager'").get().id;

// ---- 1. Menu Card version + variants (one ACTIVE version) ----
const mcvId = randomUUID();
db.prepare(
  `INSERT INTO menu_card_versions (id, label, financial_year, source_filename, uploaded_by_id, status,
     blended_usp_rate, overhead_pct, people_day_rate)
   VALUES (?, 'V5', 'FY27', 'Middleware_Menu_Card_FY27_V5.xlsx', ?, 'ACTIVE', 55.56, 40, 144)`,
).run(mcvId, admin);

// A believable catalogue: each component with a few sizes. Costs follow the family's shape
// (total = usp_cost + overhead_cost) with sensible magnitudes per size.
const SIZE_FACTOR = { TO: 0.25, XS: 0.5, S: 1, M: 2, L: 3.5, XL: 5.5, XXL: 8 };
const COMP_SIZES = {
  MQ: ['TO', 'XS', 'S', 'M', 'L', 'XL', 'XXL'],
  WLS: ['TO', 'XS', 'S', 'M', 'L', 'XL'],
  CFT: ['TO', 'S', 'M', 'L', 'XL'],
  WILDFLY: ['S', 'M', 'L'],
};
const COMP_NAME = { MQ: 'IBM MQ', WLS: 'Oracle WebLogic', CFT: 'Axway CFT', WILDFLY: 'WildFly' };

const variantsByCompSize = {};
let rowIdx = 0;
const insV = db.prepare(
  `INSERT INTO service_variants (id, menu_card_version_id, component, size, change_category, description,
     scope, assumptions, exclusions, pd, usp, atom, usp_cost, overhead_cost, total_cost, current_partner_cost, row_index)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const [comp, sizes] of Object.entries(COMP_SIZES)) {
  for (const size of sizes) {
    const f = SIZE_FACTOR[size];
    const pd = Math.round(10 * f * 10) / 10;            // person days
    const usp = Math.round(pd * 2 * 10) / 10;           // USP = PD x 2
    const atom = pd;                                    // ATOM = PD x 1
    const uspCost = Math.round(usp * 55.56 * 100) / 100;      // story-point cost
    const overhead = Math.round(uspCost * 0.40 * 100) / 100;  // 40% overhead
    const total = Math.round((uspCost + overhead) * 100) / 100;
    const id = randomUUID();
    rowIdx += 1;
    insV.run(
      id, mcvId, comp, size, `${size} change`,
      `${COMP_NAME[comp]} ${size} — standard delivery package`,
      `In scope: build & configure ${COMP_NAME[comp]} ${size}.`,
      'Assumes environments and access are available.',
      'Excludes third-party licence costs.',
      pd, usp, atom, uspCost, overhead, total,
      comp === 'WILDFLY' ? 'NA' : `£${Math.round(total * 0.9)}–£${Math.round(total * 1.1)}`,
      rowIdx,
    );
    variantsByCompSize[`${comp}/${size}`] = id;
  }
}

// ---- 2. Requests across customers / components / statuses, with TIME-SPREAD history ----
const CUSTOMERS = ['Acme Retail', 'Globex', 'Initech', 'Umbrella Health', 'Soylent', 'Wonka Logistics', 'Stark Industries', 'Wayne Enterprises'];
const CFUS = ['Architecture', 'Business', 'Consumer', 'Corporate', 'Data & AI', 'International', 'Networks', 'Openreach'];
const APPROVERS = ['R. Sharma', 'J. Okafor', 'L. Chen', 'M. Patel', 'S. Nguyen', 'K. Brown', 'P. Adeyemi'];

// A small deterministic PRNG so re-runs produce the same set (reproducible demo).
let seed = 20261028;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// The ordered active-status path; a request's FINAL status is reached by walking this prefix.
const PREFIX = {
  NEW: ['NEW'],
  PENDING: ['NEW', 'PENDING'],
  APPROVED: ['NEW', 'PENDING', 'APPROVED'],
  IN_PROGRESS: ['NEW', 'PENDING', 'APPROVED', 'IN_PROGRESS'],
  DONE: ['NEW', 'PENDING', 'APPROVED', 'IN_PROGRESS', 'DONE'],
  ARCHIVED: ['NEW', 'PENDING', 'APPROVED', 'IN_PROGRESS', 'DONE', 'ARCHIVED'],
  // Cancelled after a while in progress (the common "stopped mid-flight" case).
  CANCELLED: ['NEW', 'PENDING', 'APPROVED', 'IN_PROGRESS', 'CANCELLED'],
};

// Target ~100 requests with a realistic funnel (counts out of ~100), incl. some Cancelled.
const STATUS_MIX = [
  ['DONE', 32], ['ARCHIVED', 10], ['IN_PROGRESS', 15],
  ['APPROVED', 13], ['PENDING', 13], ['NEW', 10], ['CANCELLED', 7],
];
const FINAL_STATUSES = [];
for (const [status, n] of STATUS_MIX) for (let i = 0; i < n; i += 1) FINAL_STATUSES.push(status);
// Deterministic shuffle so creation dates aren't clustered by status.
for (let i = FINAL_STATUSES.length - 1; i > 0; i -= 1) {
  const j = Math.floor(rnd() * (i + 1));
  [FINAL_STATUSES[i], FINAL_STATUSES[j]] = [FINAL_STATUSES[j], FINAL_STATUSES[i]];
}

const allCompSizes = Object.keys(variantsByCompSize); // "COMP/SIZE"

// Direct inserts so we fully control created_at + each transition's audit timestamp (the repo's
// changeStatus/writeEvent always stamp "now", which would bunch all flow history into today).
const insEst = db.prepare(
  `INSERT INTO estimates (id, request_ref, jira_reference, summary, customer_name, cfu, approver,
     component, size, external_ref, ip_code, io_reference, remarks, version, status,
     menu_card_version_id, created_by_id, created_at, updated_at, row_version)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?, ?, ?, ?, 0)`,
);
const insLine = db.prepare(
  `INSERT INTO estimate_lines (id, estimate_id, service_variant_id, component, size, description,
     quantity, snap_pd, snap_usp, snap_atom, snap_usp_cost, snap_overhead_cost, snap_total_cost, sort_order)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insEvent = db.prepare(
  `INSERT INTO audit_events (id, user_id, timestamp, action, object_type, object_id, detail)
   VALUES (?, ?, ?, ?, 'Estimate', ?, ?)`,
);
const fmt = (d) => {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
};
const daysAgo = (nDays, hour = 9) => {
  const d = new Date(Date.now() - nDays * 24 * 60 * 60 * 1000);
  d.setUTCHours(hour, pickInt(0, 59), 0, 0);
  return fmt(d);
};

let jira = 1000;
let created = 0;

for (const finalStatus of FINAL_STATUSES) {
  const compSize = pick(allCompSizes);
  const [component, size] = compSize.split('/');
  jira += pickInt(1, 5);
  const id = randomUUID();
  created += 1;
  const actor = rnd() > 0.5 ? manager : admin;

  // Creation date spread over the last ~360 days; completed/archived skew older (time to finish),
  // newer statuses skew recent.
  const ageBand = { DONE: [60, 360], ARCHIVED: [120, 360], IN_PROGRESS: [20, 150],
    APPROVED: [10, 90], PENDING: [3, 45], NEW: [0, 20], CANCELLED: [40, 240] }[finalStatus];
  const createdAt = daysAgo(pickInt(ageBand[0], ageBand[1]));
  const createdMs = new Date(createdAt.replace(' ', 'T') + 'Z').getTime();

  insEst.run(
    id, `MDP-${String(created).padStart(4, '0')}`, `ARCH-${jira}`,
    `${COMP_NAME[component]} ${size} rollout for project ${jira}`,
    pick(CUSTOMERS), pick(CFUS), pick(APPROVERS), component, size,
    rnd() > 0.5 ? `OPP-${pickInt(100, 999)}` : null,
    rnd() > 0.6 ? 'Priority delivery requested by the account team.' : null,
    finalStatus, mcvId, actor, createdAt, createdAt,
  );
  insEvent.run(randomUUID(), actor, createdAt, 'ESTIMATE_CREATE', id, JSON.stringify({ jiraReference: `ARCH-${jira}` }));

  // 1–3 lines within scope.
  const sv = db.prepare('SELECT * FROM service_variants WHERE id = ?').get(variantsByCompSize[compSize]);
  const lineCount = pickInt(1, 3);
  for (let i = 0; i < lineCount; i += 1) {
    insLine.run(randomUUID(), id, sv.id, sv.component, sv.size, sv.description,
      pickInt(1, 4), sv.pd, sv.usp, sv.atom, sv.usp_cost, sv.overhead_cost, sv.total_cost, i);
  }

  // Walk the status prefix with a believable gap after each step (never into the future).
  const path = PREFIX[finalStatus];
  let prevMs = createdMs;
  let prevStatus = 'NEW';
  for (let i = 1; i < path.length; i += 1) {
    const to = path[i];
    let ms = prevMs + pickInt(2, 18) * 24 * 60 * 60 * 1000;
    if (ms > Date.now()) ms = Date.now() - pickInt(0, 2) * 24 * 60 * 60 * 1000;
    insEvent.run(randomUUID(), actor, fmt(new Date(ms)), 'ESTIMATE_MODIFY', id,
      JSON.stringify({ change: 'status', from: prevStatus, to, status: to }));
    prevStatus = to;
    prevMs = ms;
  }
  db.prepare('UPDATE estimates SET updated_at = ? WHERE id = ?').run(fmt(new Date(prevMs)), id);
}

console.log('Sample data seeded into:', samplePath);
console.log(`  Menu Card: V5 / FY27 (ACTIVE) with ${rowIdx} variants`);
console.log(`  Requests: ${created} across ${CUSTOMERS.length} customers / all components / all statuses,`);
console.log('    with lines + TIME-SPREAD status history (created dates over ~12 months, realistic transition gaps)');
console.log('');
console.log('Run the server against it:');
console.log(`  (cmd)        set DB_PATH=${samplePath} && node server\\server.js`);
console.log(`  (PowerShell) $env:DB_PATH="${samplePath}"; node server\\server.js`);
console.log('Logins: admin/admin123  or  manager/manager123');
process.exit(0);
