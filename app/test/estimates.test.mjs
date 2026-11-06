/**
 * Request ("estimate") repo (server/repo/estimates.js) against a throwaway SQLite DB.
 *
 * Covers the harness checks the SPEC references (tasks 5.1/5.3/5.5, 6.2, 9.7, 9.10):
 *   - create: mandatory-field validation + JIRA normalise + uniqueness (409)
 *   - internal MDP-XXXX hidden from the view; JIRA surfaced
 *   - scoped line-add (in-scope ok, out-of-scope 400) + snapshot-on-add
 *   - snapshot immutability after the source variant changes
 *   - rowVersion optimistic concurrency (stale 409, correct ok), bumped by line ops
 *   - Component/Size scope-lock while lines exist (409)
 *   - clone: fresh ref + -COPY jira, NEW/rowVersion 0, lines copied with snapshots
 *   - archive hidden from default list, surfaced via status=ARCHIVED
 *   - CANCELLED guards (can't cancel DONE/ARCHIVED; can't send CANCELLED straight to DONE/ARCHIVED)
 *   - listEstimates per-row TCS/FTE/Total (TCS + FTE === Total)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, cleanupTempDb, insertMenuCard, userId, MQ_XL_GOLDEN } from './helpers.mjs';

useTempDb(); // MUST run before importing db.js/repos (config caches DB_PATH at import time)

const { initSchema, getDb } = await import('../server/db.js');
const estimates = await import('../server/repo/estimates.js');

let db;
let adminId;
let versionId;
let mqXlVariantId;
let mqSVariantId;

before(() => {
  initSchema();
  db = getDb();
  adminId = userId(db, 'admin');
  const seeded = insertMenuCard(db, {
    status: 'ACTIVE',
    uploadedById: adminId,
    variants: [
      MQ_XL_GOLDEN,
      { component: 'MQ', size: 'S', description: 'MQ S change', pd: 6, usp: 12, atom: 6, uspCost: 666.72, overheadCost: 266.69, totalCost: 933.41 },
      { component: 'WLS', size: 'M', description: 'WLS M change', pd: 10, usp: 20, atom: 10, uspCost: 1111.20, overheadCost: 444.48, totalCost: 1555.68 },
    ],
  });
  versionId = seeded.versionId;
  mqXlVariantId = seeded.variantIds['MQ/XL/MQ XL change'];
  mqSVariantId = seeded.variantIds['MQ/S/MQ S change'];
});

after(cleanupTempDb);

/** Helper: create a valid MQ/XL request. */
function makeRequest(jira = 'ARCH-1000', over = {}) {
  return estimates.createEstimate({
    jiraReference: jira, summary: 'Test request', customerName: 'Acme',
    cfu: 'Architecture', approver: 'Jane Approver', component: 'MQ', size: 'XL',
    menuCardVersionId: versionId, createdById: adminId, ...over,
  });
}

test('create: valid request saves; MDP-XXXX internal ref is hidden, JIRA surfaced + uppercased', () => {
  const r = makeRequest('arch-1'); // lowercase in -> uppercased
  assert.equal(r.jiraReference, 'ARCH-1');
  assert.equal(r.requestRef, undefined, 'internal MDP-XXXX must never be on the view');
  assert.equal(r.status, 'NEW');
  assert.equal(r.rowVersion, 0);
  // confirm the internal ref exists in the row even though the view hides it
  const row = db.prepare('SELECT request_ref FROM estimates WHERE id = ?').get(r.id);
  assert.match(row.request_ref, /^MDP-\d{4}$/);
});

test('create: duplicate JIRA is rejected with 409 (case-insensitive)', () => {
  makeRequest('ARCH-DUP');
  assert.throws(() => makeRequest('arch-dup'), (e) => e.statusCode === 409 && e.code === 'CONFLICT');
});

test('create: missing mandatory fields throw 400', () => {
  assert.throws(() => makeRequest('ARCH-M1', { cfu: 'NotACFU' }), (e) => e.statusCode === 400);
  assert.throws(() => makeRequest('ARCH-M2', { approver: '' }), (e) => e.statusCode === 400);
  assert.throws(() => makeRequest('ARCH-M3', { summary: '' }), (e) => e.statusCode === 400);
  assert.throws(() => makeRequest('ARCH-M4', { component: 'NOPE' }), (e) => e.statusCode === 400);
  assert.throws(() => makeRequest('ARCH-M5', { size: 'HUGE' }), (e) => e.statusCode === 400);
});

test('lines: in-scope add snapshots the six values; out-of-scope add is rejected 400', () => {
  const r = makeRequest('ARCH-LINE');
  // out-of-scope: an MQ/S variant on an MQ/XL request must be refused
  assert.throws(() => estimates.addLine(r.id, { serviceVariantId: mqSVariantId, quantity: 1 }, r.rowVersion),
    (e) => e.statusCode === 400, 'MQ/S variant must be rejected on an MQ/XL request');

  const after = estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 2 }, r.rowVersion);
  const l = after.lines[0];
  assert.equal(l.snapPd, 54);
  assert.equal(l.snapTotalCost, 8400.67);
  assert.equal(l.computed.lineTotalCost, 16801.34); // 8400.67 × 2
  assert.equal(after.totals.grandTotalCost, 16801.34);
});

test('snapshot immutability: mutating the source variant does not change an existing line', () => {
  const r = makeRequest('ARCH-SNAP');
  const withLine = estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 1 }, r.rowVersion);
  assert.equal(withLine.totals.grandTotalCost, 8400.67);
  // mutate the catalogue variant AFTER the line was added
  db.prepare('UPDATE service_variants SET total_cost = 999999, usp_cost = 1 WHERE id = ?').run(mqXlVariantId);
  const reread = estimates.getEstimate(r.id);
  assert.equal(reread.totals.grandTotalCost, 8400.67, 'existing line must keep its snapshot');
  // restore so later tests keep the golden value
  db.prepare('UPDATE service_variants SET total_cost = 8400.67, usp_cost = 6000.48 WHERE id = ?').run(mqXlVariantId);
});

test('rowVersion: stale version is rejected 409; a line op bumps it', () => {
  const r = makeRequest('ARCH-RV');
  const v0 = r.rowVersion;
  const afterAdd = estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 1 }, v0);
  assert.equal(afterAdd.rowVersion, v0 + 1, 'adding a line bumps rowVersion');
  // a stale rowVersion on the next op must 409
  assert.throws(() => estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 1 }, v0),
    (e) => e.statusCode === 409);
});

test('scope-lock: cannot change Component/Size while lines exist (409)', () => {
  const r = makeRequest('ARCH-LOCK');
  const withLine = estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 1 }, r.rowVersion);
  assert.throws(() => estimates.updateEstimateHeader(r.id, { size: 'S' }, withLine.rowVersion),
    (e) => e.statusCode === 409);
});

test('clone: fresh internal ref + -COPY jira, status NEW, rowVersion 0, lines copied with snapshots', () => {
  const r = makeRequest('ARCH-SRC');
  estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 2 }, r.rowVersion);
  const clone = estimates.cloneEstimate(r.id, adminId);
  assert.equal(clone.jiraReference, 'ARCH-SRC-COPY');
  assert.equal(clone.status, 'NEW');
  assert.equal(clone.rowVersion, 0);
  assert.equal(clone.lines.length, 1);
  assert.equal(clone.lines[0].snapTotalCost, 8400.67);
  assert.equal(clone.totals.grandTotalCost, 16801.34, 'clone carries the source figures');
  // internal refs differ
  const srcRef = db.prepare('SELECT request_ref FROM estimates WHERE id = ?').get(r.id).request_ref;
  const clRef = db.prepare('SELECT request_ref FROM estimates WHERE id = ?').get(clone.id).request_ref;
  assert.notEqual(srcRef, clRef);
  // a second clone of the same source derives -COPY2
  const clone2 = estimates.cloneEstimate(r.id, adminId);
  assert.equal(clone2.jiraReference, 'ARCH-SRC-COPY2');
});

test('archive: hidden from default list, surfaced via status=ARCHIVED', () => {
  const r = makeRequest('ARCH-ARCHIVE');
  estimates.changeStatus(r.id, 'ARCHIVED', r.rowVersion);
  const defaultList = estimates.listEstimates({});
  assert.ok(!defaultList.some((x) => x.id === r.id), 'archived must not appear in the default list');
  const archivedList = estimates.listEstimates({ status: 'ARCHIVED' });
  assert.ok(archivedList.some((x) => x.id === r.id), 'status=ARCHIVED must surface it');
});

test('CANCELLED guards: cannot cancel DONE/ARCHIVED; cannot send CANCELLED straight to DONE/ARCHIVED', () => {
  // DONE -> CANCELLED blocked
  const done = makeRequest('ARCH-DONE');
  const d1 = estimates.changeStatus(done.id, 'DONE', done.rowVersion);
  assert.throws(() => estimates.changeStatus(done.id, 'CANCELLED', d1.rowVersion),
    (e) => e.statusCode === 409);

  // active -> CANCELLED allowed; CANCELLED -> DONE blocked; CANCELLED -> active allowed (revive)
  const c = makeRequest('ARCH-CANCEL');
  const c1 = estimates.changeStatus(c.id, 'CANCELLED', c.rowVersion);
  assert.equal(c1.status, 'CANCELLED');
  assert.throws(() => estimates.changeStatus(c.id, 'DONE', c1.rowVersion), (e) => e.statusCode === 409);
  assert.throws(() => estimates.changeStatus(c.id, 'ARCHIVED', c1.rowVersion), (e) => e.statusCode === 409);
  const revived = estimates.changeStatus(c.id, 'IN_PROGRESS', c1.rowVersion);
  assert.equal(revived.status, 'IN_PROGRESS');
});

test('listEstimates: per-row TCS + FTE === Total (integer-pence, no drift)', () => {
  const r = makeRequest('ARCH-SPLIT');
  estimates.addLine(r.id, { serviceVariantId: mqXlVariantId, quantity: 1 }, r.rowVersion);
  const row = estimates.listEstimates({}).find((x) => x.id === r.id);
  assert.equal(row.tcsCost, 6000.48);
  assert.equal(row.fteCost, 2400.19);
  assert.equal(row.grandTotalCost, 8400.67);
  assert.equal(
    Math.round(row.tcsCost * 100) + Math.round(row.fteCost * 100),
    Math.round(row.grandTotalCost * 100),
  );
});
