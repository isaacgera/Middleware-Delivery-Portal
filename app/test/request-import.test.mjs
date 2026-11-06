/**
 * Request import pipeline (server/repo/request-import.js) — task 9.11.
 *
 * Covers the decided behaviour: envelope validation, preview classification (importable /
 * duplicate / error) writing NOTHING, duplicate-skip (existing + within-file), status preserve +
 * sanitise, header-only creation on commit, and attribution to the importing admin.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, cleanupTempDb, insertMenuCard, userId, MQ_XL_GOLDEN } from './helpers.mjs';

useTempDb();

const { initSchema, getDb } = await import('../server/db.js');
const menucards = await import('../server/repo/menucards.js');
const estimates = await import('../server/repo/estimates.js');
const imp = await import('../server/repo/request-import.js');

let db;
let adminId;

before(() => {
  initSchema();
  db = getDb();
  adminId = userId(db, 'admin');
  // An ACTIVE Menu Card is required for import (requests pin it).
  const seeded = insertMenuCard(db, { status: 'ACTIVE', uploadedById: adminId, variants: [MQ_XL_GOLDEN] });
  void seeded;
});

after(cleanupTempDb);

/** Build a valid mdp.requests envelope from an array of request objects. */
function envelope(requests) {
  return { type: 'mdp.requests', version: 1, exportedAt: new Date().toISOString(), scope: 'active', count: requests.length, requests };
}
/** A minimal valid importable request row. */
function reqRow(jira, over = {}) {
  return { jiraReference: jira, summary: 'Imported', customerName: 'Acme', cfu: 'Architecture',
    approver: 'A', component: 'MQ', size: 'XL', status: 'APPROVED', ...over };
}

test('parseEnvelope rejects non-mdp.requests / wrong version / empty', () => {
  assert.throws(() => imp.parseEnvelope({}), (e) => e.statusCode === 400);
  assert.throws(() => imp.parseEnvelope({ type: 'mdp.requests', version: 2, requests: [] }), (e) => e.statusCode === 400);
  assert.throws(() => imp.parseEnvelope({ type: 'mdp.requests', version: 1, requests: [] }), (e) => e.statusCode === 400);
});

test('preview classifies importable / error (missing fields) and writes nothing', () => {
  const before = estimates.listEstimates({}).length;
  const p = imp.previewImport(envelope([
    reqRow('IMP-1'),
    reqRow('IMP-2', { cfu: '' }), // missing mandatory -> error
  ]));
  assert.equal(p.counts.importable, 1);
  assert.equal(p.counts.errors, 1);
  assert.equal(p.importable[0].jira, 'IMP-1');
  // nothing created by a preview
  assert.equal(estimates.listEstimates({}).length, before);
});

test('preview flags duplicates: already-existing + within-file', () => {
  // create an existing request to collide with
  estimates.createEstimate({ jiraReference: 'EXIST-1', summary: 's', customerName: 'c', cfu: 'Architecture',
    approver: 'a', component: 'MQ', size: 'XL',
    menuCardVersionId: menucards.getActiveVersion().id, createdById: adminId });

  const p = imp.previewImport(envelope([
    reqRow('EXIST-1'),           // already exists -> duplicate
    reqRow('DUP-FILE'),
    reqRow('dup-file'),          // same JIRA twice in the file -> second is duplicate
  ]));
  const dupJiras = p.duplicates.map((d) => d.jira);
  assert.ok(dupJiras.includes('EXIST-1'));
  assert.equal(p.duplicates.filter((d) => d.jira === 'DUP-FILE').length, 1); // one of the two flagged
  assert.equal(p.counts.importable, 1); // only the first DUP-FILE
});

test('commit creates header-only requests, preserves status, attributes to importer', () => {
  const result = imp.commitImport(envelope([
    reqRow('COMMIT-1', { status: 'APPROVED' }),
    reqRow('COMMIT-2', { status: 'IN_PROGRESS' }),
  ]), adminId);

  assert.equal(result.counts.created, 2);
  // fetch one back and check it
  const row = estimates.listEstimates({}).find((e) => e.jiraReference === 'COMMIT-1');
  assert.ok(row, 'COMMIT-1 was created');
  assert.equal(row.status, 'APPROVED', 'exported status preserved');
  assert.equal(row.lineCount, 0, 'header-only: no lines');
  assert.equal(row.grandTotalCost, 0, 'no lines -> zero cost');
  // attributed to the importing admin
  const full = estimates.getEstimate(row.id);
  assert.equal(full.createdById, adminId);
});

test('commit sanitises an unknown status to NEW', () => {
  const result = imp.commitImport(envelope([reqRow('COMMIT-BADSTATUS', { status: 'BOGUS' })]), adminId);
  assert.equal(result.counts.created, 1);
  const row = estimates.listEstimates({}).find((e) => e.jiraReference === 'COMMIT-BADSTATUS');
  assert.equal(row.status, 'NEW', 'unknown status falls back to NEW');
});

test('commit skips a duplicate without creating it', () => {
  imp.commitImport(envelope([reqRow('ONCE-1')]), adminId); // create it
  const second = imp.commitImport(envelope([reqRow('ONCE-1'), reqRow('FRESH-1')]), adminId);
  assert.equal(second.counts.created, 1);        // only FRESH-1
  assert.equal(second.counts.skipped, 1);        // ONCE-1 skipped
  assert.ok(second.created.some((c) => c.jira === 'FRESH-1'));
  assert.ok(second.skipped.some((d) => d.jira === 'ONCE-1'));
});
