/**
 * Flow analytics (server/repo/flow.js) against a throwaway SQLite DB with a HAND-SCRIPTED
 * transition history, so throughput / cycle time / dwell / aging / run-rate have known answers.
 *
 * Covers tasks 9.4–9.6. Timelines are reconstructed from each request's created_at plus its
 * ESTIMATE_MODIFY status audit events (detail {change:'status',from,to}).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, cleanupTempDb, insertMenuCard, userId, MQ_XL_GOLDEN } from './helpers.mjs';

useTempDb();

const { initSchema, getDb } = await import('../server/db.js');
const flow = await import('../server/repo/flow.js');

let db;
let adminId;
let versionId;
let variantId;

/** Insert a request row directly with a chosen created_at + status + one line (for PD). */
function seedRequest(id, jira, createdAt, status, qty = 1) {
  db.prepare(
    `INSERT INTO estimates
       (id, request_ref, jira_reference, summary, customer_name, cfu, approver, component, size,
        version, status, menu_card_version_id, created_by_id, created_at, updated_at, row_version)
     VALUES (?, ?, ?, 'S', 'Acme', 'Architecture', 'A', 'MQ', 'XL', 1, ?, ?, ?, ?, ?, 0)`,
  ).run(id, `MDP-${id}`, jira, status, versionId, adminId, createdAt, createdAt);
  // one MQ XL line -> 54 PD per unit
  db.prepare(
    `INSERT INTO estimate_lines
       (id, estimate_id, service_variant_id, component, size, description, quantity,
        snap_pd, snap_usp, snap_atom, snap_usp_cost, snap_overhead_cost, snap_total_cost, sort_order)
     VALUES (?, ?, ?, 'MQ', 'XL', 'MQ XL', ?, 54, 108, 54, 6000.48, 2400.19, 8400.67, 0)`,
  ).run(`line-${id}`, id, variantId, qty);
}

/** Append a status-transition audit event at a chosen timestamp. */
function transition(reqId, from, to, ts) {
  db.prepare(
    `INSERT INTO audit_events (id, user_id, timestamp, action, object_type, object_id, detail)
     VALUES (?, ?, ?, 'ESTIMATE_MODIFY', 'Estimate', ?, ?)`,
  ).run(`ev-${reqId}-${to}-${ts}`, adminId, ts, reqId, JSON.stringify({ change: 'status', from, to }));
}

before(() => {
  initSchema();
  db = getDb();
  adminId = userId(db, 'admin');
  const seeded = insertMenuCard(db, { status: 'ACTIVE', uploadedById: adminId, variants: [MQ_XL_GOLDEN] });
  versionId = seeded.versionId;
  variantId = seeded.variantIds['MQ/XL/MQ XL change'];

  // R1: created Jan 1, -> APPROVED Jan 6, -> DONE Jan 16  (Created->Done 15d, Approved->Done 10d)
  seedRequest('r1', 'A-1', '2026-01-01 00:00:00', 'DONE');
  transition('r1', 'NEW', 'APPROVED', '2026-01-06 00:00:00');
  transition('r1', 'APPROVED', 'DONE', '2026-01-16 00:00:00');

  // R2: created Jan 1, -> APPROVED Jan 6, -> DONE Jan 16 (same -> stable medians)
  seedRequest('r2', 'A-2', '2026-01-01 00:00:00', 'DONE');
  transition('r2', 'NEW', 'APPROVED', '2026-01-06 00:00:00');
  transition('r2', 'APPROVED', 'DONE', '2026-01-16 00:00:00');

  // R3: still APPROVED (committed backlog PD); created long ago -> aging
  seedRequest('r3', 'A-3', '2026-01-01 00:00:00', 'APPROVED');
  transition('r3', 'NEW', 'APPROVED', '2026-01-02 00:00:00');

  // R4: IN_PROGRESS (also committed backlog)
  seedRequest('r4', 'A-4', '2026-01-01 00:00:00', 'IN_PROGRESS');
  transition('r4', 'NEW', 'IN_PROGRESS', '2026-01-03 00:00:00');
});

after(cleanupTempDb);

test('throughput: two requests reached DONE, both in 2026-01', () => {
  const r = flow.flowReport({ nowMs: Date.parse('2026-02-01T00:00:00Z') });
  assert.equal(r.throughput.total, 2);
  const jan = r.throughput.items.find((i) => i.month === '2026-01');
  assert.equal(jan.count, 2);
});

test('cycle time: Created->Done median 15d, Approved->Done median 10d', () => {
  const r = flow.flowReport({ nowMs: Date.parse('2026-02-01T00:00:00Z') });
  assert.equal(r.cycleTime.createdToDone.count, 2);
  assert.equal(r.cycleTime.createdToDone.medianDays, 15);
  assert.equal(r.cycleTime.approvedToDone.medianDays, 10);
});

test('aging: open requests (APPROVED/IN_PROGRESS) counted; DONE excluded', () => {
  const r = flow.flowReport({ agingDays: 30, nowMs: Date.parse('2026-03-01T00:00:00Z') });
  // r3 (APPROVED) + r4 (IN_PROGRESS) are open; r1/r2 DONE are not
  assert.equal(r.aging.openCount, 2);
  assert.ok(r.aging.agingCount >= 2, 'both are well past 30 days by March');
});

test('run-rate: backlog PD = 108 (2 committed × 54), projection uses completed PD/month', () => {
  const r = flow.flowReport({ nowMs: Date.parse('2026-02-01T00:00:00Z') });
  // committed backlog = r3 + r4 = 54 + 54 = 108
  assert.equal(r.runRate.backlogPd, 108);
  // completed PD in Jan = r1 + r2 = 108, over 1 active month => 108 PD/mo => ~1.0 month
  assert.equal(r.runRate.avgPdPerMonth, 108);
  assert.equal(r.runRate.projectedMonths, 1);
});

test('filter: component=WLS matches nothing here (empty-scope is clean, not an error)', () => {
  const r = flow.flowReport({ filter: { component: 'WLS' }, nowMs: Date.parse('2026-02-01T00:00:00Z') });
  assert.equal(r.matched, 0);
  assert.equal(r.throughput.total, 0);
  assert.equal(r.runRate.projectedMonths, null);
});

test('compare by component: group counts sum back to the overall total', () => {
  const c = flow.flowCompare('component', { nowMs: Date.parse('2026-02-01T00:00:00Z') });
  const sum = c.groups.reduce((s, g) => s + g.count, 0);
  assert.equal(sum, c.total);
  assert.equal(c.total, 4);
});
