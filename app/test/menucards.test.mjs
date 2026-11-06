/**
 * Menu Card repo (server/repo/menucards.js) against a throwaway SQLite DB.
 *
 * Covers tasks 1.4 / 3.6 (single-ACTIVE activation transaction), 3.10/3.11 (reactivate +
 * guarded delete), and 4.1 (scoped catalogue + data-driven filters):
 *   - activation demotes the prior ACTIVE and promotes the target (at most one ACTIVE)
 *   - an ARCHIVED version can be reactivated
 *   - delete refused when ACTIVE or referenced by a request; allowed otherwise
 *   - queryActiveCatalogue scopes by component/size and sorts TO->XXL
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, cleanupTempDb, insertMenuCard, userId, MQ_XL_GOLDEN } from './helpers.mjs';

useTempDb();

const { initSchema, getDb } = await import('../server/db.js');
const menucards = await import('../server/repo/menucards.js');
const estimates = await import('../server/repo/estimates.js');

let db;
let adminId;

before(() => {
  initSchema();
  db = getDb();
  adminId = userId(db, 'admin');
});

after(cleanupTempDb);

function countActive() {
  return db.prepare("SELECT COUNT(*) AS n FROM menu_card_versions WHERE status = 'ACTIVE'").get().n;
}

test('single-ACTIVE invariant: activating a new version demotes the old one', () => {
  const a = insertMenuCard(db, { status: 'ACTIVE', uploadedById: adminId, label: 'V4', variants: [MQ_XL_GOLDEN] });
  const b = insertMenuCard(db, { status: 'DRAFT', uploadedById: adminId, label: 'V5', variants: [MQ_XL_GOLDEN] });
  assert.equal(countActive(), 1);

  const res = menucards.activateVersion(b.versionId);
  assert.equal(res.ok, true);
  assert.equal(countActive(), 1, 'exactly one ACTIVE after activation');
  assert.equal(menucards.getActiveVersion().id, b.versionId);
  // the previously-active version is now ARCHIVED
  const prev = db.prepare('SELECT status FROM menu_card_versions WHERE id = ?').get(a.versionId);
  assert.equal(prev.status, 'ARCHIVED');
});

test('an ARCHIVED version can be reactivated', () => {
  const archived = db.prepare("SELECT id FROM menu_card_versions WHERE status = 'ARCHIVED' LIMIT 1").get();
  const res = menucards.activateVersion(archived.id);
  assert.equal(res.ok, true);
  assert.equal(countActive(), 1);
  assert.equal(menucards.getActiveVersion().id, archived.id);
});

test('delete is refused for an ACTIVE version, allowed for a non-referenced DRAFT', () => {
  const active = menucards.getActiveVersion();
  assert.deepEqual(menucards.deleteVersion(active.id), { ok: false, reason: 'ACTIVE' });

  const draft = insertMenuCard(db, { status: 'DRAFT', uploadedById: adminId, label: 'V-DEL', variants: [MQ_XL_GOLDEN] });
  assert.deepEqual(menucards.deleteVersion(draft.versionId), { ok: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM menu_card_versions WHERE id = ?').get(draft.versionId).n, 0);
});

test('delete is refused when a request references the version', () => {
  // make a fresh version ACTIVE so a request can pin it, then archive-switch and try to delete
  const v = insertMenuCard(db, {
    status: 'DRAFT', uploadedById: adminId, label: 'V-REF',
    variants: [MQ_XL_GOLDEN],
  });
  menucards.activateVersion(v.versionId);
  estimates.createEstimate({
    jiraReference: 'REF-1', summary: 'pin', customerName: 'Acme', cfu: 'Architecture',
    approver: 'A', component: 'MQ', size: 'XL', menuCardVersionId: v.versionId, createdById: adminId,
  });
  // switch active away so the ACTIVE guard isn't the reason it refuses
  const other = insertMenuCard(db, { status: 'DRAFT', uploadedById: adminId, label: 'V-OTHER', variants: [MQ_XL_GOLDEN] });
  menucards.activateVersion(other.versionId);
  const res = menucards.deleteVersion(v.versionId);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'REFERENCED');
  assert.equal(res.count, 1);
});

test('queryActiveCatalogue scopes by component/size and sorts TO->XXL', () => {
  // Build a dedicated active version with a mixed set to test sort + scope.
  const v = insertMenuCard(db, {
    status: 'DRAFT', uploadedById: adminId, label: 'V-CAT',
    variants: [
      { component: 'MQ', size: 'XL', description: 'MQ XL', pd: 54, usp: 108, atom: 54, uspCost: 6000.48, overheadCost: 2400.19, totalCost: 8400.67 },
      { component: 'MQ', size: 'S', description: 'MQ S', pd: 6, usp: 12, atom: 6, uspCost: 666.72, overheadCost: 266.69, totalCost: 933.41 },
      { component: 'WLS', size: 'M', description: 'WLS M', pd: 10, usp: 20, atom: 10, uspCost: 1111.2, overheadCost: 444.48, totalCost: 1555.68 },
    ],
  });
  menucards.activateVersion(v.versionId);

  const all = menucards.queryActiveCatalogue({});
  assert.equal(all.items.length, 3);

  const mqOnly = menucards.queryActiveCatalogue({ components: ['MQ'] });
  assert.equal(mqOnly.items.length, 2);
  // MQ S should sort before MQ XL (TO->XXL order)
  assert.equal(mqOnly.items[0].size, 'S');
  assert.equal(mqOnly.items[1].size, 'XL');

  const mqXl = menucards.queryActiveCatalogue({ components: ['MQ'], sizes: ['XL'] });
  assert.equal(mqXl.items.length, 1);
  assert.equal(mqXl.items[0].totalCost, 8400.67);
});
