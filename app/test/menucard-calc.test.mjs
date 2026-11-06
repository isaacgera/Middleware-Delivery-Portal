/**
 * Menu Card cost calculator (server/menucard-calc.js) + on-screen create flow (task 9.12).
 *
 * Two parts:
 *   1. computeVariant() — pure cost maths from PD + rates, integer-pence (no drift). Golden MQ XL.
 *   2. The create flow — compute rows, then stage them via createDraftVersion (the same call the
 *      POST /api/menucards route makes), and confirm the DRAFT + variants land with values intact,
 *      including an admin OVERRIDE being preserved (not recomputed).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, cleanupTempDb, userId } from './helpers.mjs';
import { computeVariant } from '../server/menucard-calc.js';

useTempDb();

const { initSchema, getDb } = await import('../server/db.js');
const menucards = await import('../server/repo/menucards.js');

let db;
let adminId;

before(() => {
  initSchema();
  db = getDb();
  adminId = userId(db, 'admin');
});

after(cleanupTempDb);

// ---- 1. cost maths ----

test('computeVariant: MQ XL golden (PD 54 @ 55.56 / 40%)', () => {
  const r = computeVariant(54, { blendedUspRate: 55.56, overheadPct: 40 });
  assert.equal(r.pd, 54);
  assert.equal(r.usp, 108);   // PD × 2
  assert.equal(r.atom, 54);   // PD × 1
  assert.equal(r.uspCost, 6000.48);    // 108 × 55.56
  assert.equal(r.overheadCost, 2400.19); // 6000.48 × 40%
  assert.equal(r.totalCost, 8400.67);  // sum
  // TCS + FTE must reconstruct the total exactly (integer-pence, no drift)
  assert.equal(Math.round(r.uspCost * 100) + Math.round(r.overheadCost * 100), Math.round(r.totalCost * 100));
});

test('computeVariant: a small row stays exact (PD 6)', () => {
  const r = computeVariant(6, { blendedUspRate: 55.56, overheadPct: 40 });
  assert.equal(r.usp, 12);
  assert.equal(r.uspCost, 666.72);     // 12 × 55.56
  assert.equal(r.overheadCost, 266.69); // 666.72 × 40% = 266.688 -> 266.69
  assert.equal(r.totalCost, 933.41);
});

test('computeVariant: zero PD -> all zero; different rate recomputes', () => {
  assert.equal(computeVariant(0, { blendedUspRate: 55.56, overheadPct: 40 }).totalCost, 0);
  // the people-day rate (144) used for "Test Only" rows gives a different, still-exact result
  const r = computeVariant(1, { blendedUspRate: 144, overheadPct: 40 });
  assert.equal(r.usp, 2);
  assert.equal(r.uspCost, 288);        // 2 × 144
  assert.equal(r.overheadCost, 115.2); // 288 × 40%
  assert.equal(r.totalCost, 403.2);
});

// ---- 2. create flow (what POST /api/menucards does: compute -> stage DRAFT) ----

/** Build a variant payload row the way the route expects (six values + identity). */
function row(component, size, description, pd, rates, overrides = {}) {
  const c = computeVariant(pd, rates);
  return { component, size, description, pd: c.pd, usp: c.usp, atom: c.atom,
    uspCost: c.uspCost, overheadCost: c.overheadCost, totalCost: c.totalCost, ...overrides };
}

test('create flow: stages a DRAFT with computed rows; values persist intact', () => {
  const rates = { blendedUspRate: 55.56, overheadPct: 40 };
  const variants = [
    row('MQ', 'XL', 'MQ XL change', 54, rates),
    row('WLS', 'M', 'WLS M change', 10, rates),
  ].map((v, i) => ({
    component: v.component, size: v.size, changeCategory: v.size, description: v.description,
    scope: null, assumptions: null, exclusions: null,
    pd: v.pd, usp: v.usp, atom: v.atom, uspCost: v.uspCost, overheadCost: v.overheadCost, totalCost: v.totalCost,
    currentPartnerCost: null, effortPhases: null, rowIndex: i,
  }));

  const version = menucards.createDraftVersion({
    version: { label: 'V6-onscreen', financialYear: 'FY28', sourceFilename: 'V6 (created on screen)',
      blendedUspRate: 55.56, overheadPct: 40, peopleDayRate: 144 },
    variants, uploadedById: adminId,
    importSummary: { counts: { MQ: 1, WLS: 1 }, warnings: [], createdOnScreen: true },
    fileBuffer: null,
  });

  assert.equal(version.status, 'DRAFT');
  assert.equal(version.hasFile, false); // no .xlsx for an on-screen card
  const full = menucards.getVersion(version.id);
  assert.equal(full.variants.length, 2);
  const mqXl = full.variants.find((x) => x.component === 'MQ' && x.size === 'XL');
  assert.equal(mqXl.totalCost, 8400.67);
  assert.equal(mqXl.uspCost, 6000.48);
});

test('create flow: an admin OVERRIDE is stored verbatim (never recomputed)', () => {
  const rates = { blendedUspRate: 55.56, overheadPct: 40 };
  // Override the total to a bespoke figure (e.g. a negotiated "Test Only" row).
  const overridden = row('CFT', 'S', 'CFT S Test Only', 3, rates, { totalCost: 999.99, uspCost: 700, overheadCost: 299.99 });
  const version = menucards.createDraftVersion({
    version: { label: 'V6-override', financialYear: 'FY28', sourceFilename: 'V6 ovr',
      blendedUspRate: 55.56, overheadPct: 40, peopleDayRate: 144 },
    variants: [{
      component: 'CFT', size: 'S', changeCategory: 'S', description: 'CFT S Test Only',
      scope: null, assumptions: null, exclusions: null,
      pd: overridden.pd, usp: overridden.usp, atom: overridden.atom,
      uspCost: 700, overheadCost: 299.99, totalCost: 999.99,
      currentPartnerCost: null, effortPhases: null, rowIndex: 0,
    }],
    uploadedById: adminId, importSummary: { counts: { CFT: 1 }, warnings: [], createdOnScreen: true }, fileBuffer: null,
  });
  const v = menucards.getVersion(version.id).variants[0];
  assert.equal(v.totalCost, 999.99, 'override must be stored, not recomputed');
  assert.equal(v.uspCost, 700);
});

test('create flow: the created DRAFT can be activated (reuses the single-ACTIVE transaction)', () => {
  const version = menucards.createDraftVersion({
    version: { label: 'V6-activate', financialYear: 'FY28', sourceFilename: 'x',
      blendedUspRate: 55.56, overheadPct: 40, peopleDayRate: 144 },
    variants: [{ component: 'MQ', size: 'S', changeCategory: 'S', description: 'MQ S',
      scope: null, assumptions: null, exclusions: null,
      pd: 6, usp: 12, atom: 6, uspCost: 666.72, overheadCost: 266.69, totalCost: 933.41,
      currentPartnerCost: null, effortPhases: null, rowIndex: 0 }],
    uploadedById: adminId, importSummary: null, fileBuffer: null,
  });
  const res = menucards.activateVersion(version.id);
  assert.equal(res.ok, true);
  assert.equal(menucards.getActiveVersion().id, version.id);
});
