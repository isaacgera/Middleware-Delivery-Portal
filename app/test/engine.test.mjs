/**
 * Calculation engine (server/engine.js) — pure functions, no DB.
 * Covers task 5.4: line = snapshot × qty, totals = Σ, integer-pence money math (no float drift),
 * rounding only at the edge. Golden values come from the real V5 MQ XL variant (design §4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLine, computeEstimate } from '../server/engine.js';
import { MQ_XL_GOLDEN as G } from './helpers.mjs';

/** Build a line row in the shape the engine expects (snap_* fields + quantity). */
function line(golden, quantity) {
  return {
    snap_pd: golden.pd, snap_usp: golden.usp, snap_atom: golden.atom,
    snap_usp_cost: golden.uspCost, snap_overhead_cost: golden.overheadCost,
    snap_total_cost: golden.totalCost, quantity,
  };
}

test('computeLine: snapshot × quantity for the MQ XL golden values', () => {
  const r = computeLine(line(G, 1));
  assert.equal(r.linePd, 54);
  assert.equal(r.lineUsp, 108);
  assert.equal(r.lineAtom, 54);
  assert.equal(r.lineUspCost, 6000.48);
  assert.equal(r.lineOverheadCost, 2400.19);
  assert.equal(r.lineTotalCost, 8400.67);
});

test('computeLine: qty 2 doubles every value with no float drift', () => {
  const r = computeLine(line(G, 2));
  assert.equal(r.linePd, 108);
  assert.equal(r.lineUspCost, 12000.96);
  assert.equal(r.lineOverheadCost, 4800.38);
  // 8400.67 × 2 = 16801.34 exactly (the spec's headline integer-pence check).
  assert.equal(r.lineTotalCost, 16801.34);
});

test('computeEstimate: sums many pence-carrying lines exactly (no drift)', () => {
  // Three lines whose totals are 8400.67, 8400.67×1, and a second small variant.
  const small = { pd: 6, usp: 12, atom: 6, uspCost: 666.72, overheadCost: 266.69, totalCost: 933.41 };
  const lines = [line(G, 1), line(G, 1), line(small, 1)];
  const { totals } = computeEstimate(lines);
  // 8400.67 + 8400.67 + 933.41 = 17734.75 exactly.
  assert.equal(totals.grandTotalCost, 17734.75);
  // Clean literals, NOT naive JS addition (6000.48+6000.48+666.72 drifts to ...679999). The
  // engine returning the clean value is exactly the no-float-drift guarantee under test.
  assert.equal(totals.totalUspCost, 12667.68);
  assert.equal(totals.totalOverheadCost, 5067.07);
  assert.equal(totals.lineCount, 3);
  // TCS + FTE must reconstruct the grand total (the invariant the export relies on).
  assert.equal(
    Math.round(totals.totalUspCost * 100) + Math.round(totals.totalOverheadCost * 100),
    Math.round(totals.grandTotalCost * 100),
  );
});

test('computeEstimate: empty estimate is all zero', () => {
  const { lines, totals } = computeEstimate([]);
  assert.equal(lines.length, 0);
  assert.equal(totals.grandTotalCost, 0);
  assert.equal(totals.totalPd, 0);
  assert.equal(totals.lineCount, 0);
});

test('computeEstimate: fractional effort (0.5 PD) rounds cleanly, not to a float tail', () => {
  const half = { pd: 0.5, usp: 1, atom: 0.5, uspCost: 55.56, overheadCost: 22.22, totalCost: 77.78 };
  const { totals } = computeEstimate([line(half, 3)]); // 0.5 × 3 = 1.5
  assert.equal(totals.totalPd, 1.5);
  assert.equal(totals.grandTotalCost, 233.34); // 77.78 × 3
});
