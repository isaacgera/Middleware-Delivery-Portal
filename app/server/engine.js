/**
 * Deterministic calculation engine (Stage 5, design §4).
 *
 * Pure functions only — NO database access, NO I/O, NO persistence of derived totals.
 * Everything is computed on demand from the snapshotted line values. This is the heart of
 * MDP's "deterministic lookup-and-multiply calculator" principle: a line is just its
 * snapshot × quantity, and an estimate total is just the sum of its lines.
 *
 * Money handling: the Menu Card's cost values can carry pence (e.g. 8400.67). To avoid binary
 * float drift when multiplying by quantity and summing many lines, money is converted to
 * integer pence, all arithmetic is done in integer pence, and it is only converted back to a
 * pounds Number at the very end. PD/USP/ATOM are effort counts that may be fractional
 * (e.g. 0.5) so they use plain Number arithmetic rounded to a fixed precision at the edge.
 */

// ---- money helpers (integer-pence to avoid float drift) ----

/** Pounds (Number) -> integer pence. Rounds to nearest penny. */
function toPence(pounds) {
  return Math.round((Number(pounds) || 0) * 100);
}

/** Integer pence -> pounds (Number, 2 dp exact). */
function toPounds(pence) {
  return Math.round(pence) / 100;
}

/** Round an effort value (PD/USP/ATOM) to a sane fixed precision (4 dp) to avoid float tails. */
function roundEffort(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/**
 * Compute a single line's six derived values = snapshot × quantity.
 * Accepts a line row carrying the snap_* fields (as stored) plus quantity.
 * Returns an object of the six line values (money fields already in pounds Number, 2 dp).
 */
export function computeLine(line) {
  const qty = Number(line.quantity) || 0;
  // money via pence
  const uspCostP = toPence(line.snap_usp_cost) * qty;
  const overheadP = toPence(line.snap_overhead_cost) * qty;
  const totalP = toPence(line.snap_total_cost) * qty;
  return {
    linePd: roundEffort((Number(line.snap_pd) || 0) * qty),
    lineUsp: roundEffort((Number(line.snap_usp) || 0) * qty),
    lineAtom: roundEffort((Number(line.snap_atom) || 0) * qty),
    lineUspCost: toPounds(uspCostP),
    lineOverheadCost: toPounds(overheadP),
    lineTotalCost: toPounds(totalP),
  };
}

/**
 * Compute an estimate's totals from its line rows.
 * Sums are accumulated in integer pence (money) / raw numbers (effort) and rounded once.
 * @param {Array} lines  array of line rows with snap_* fields + quantity
 * @returns {{ lines: Array, totals: object }}
 *   lines: each input line decorated with its computed six values + id/display fields
 *   totals: the six estimate-level sums
 */
export function computeEstimate(lines = []) {
  let pdSum = 0;
  let uspSum = 0;
  let atomSum = 0;
  let uspCostP = 0;
  let overheadP = 0;
  let totalP = 0;

  const computed = lines.map((line) => {
    const qty = Number(line.quantity) || 0;
    pdSum += (Number(line.snap_pd) || 0) * qty;
    uspSum += (Number(line.snap_usp) || 0) * qty;
    atomSum += (Number(line.snap_atom) || 0) * qty;
    uspCostP += toPence(line.snap_usp_cost) * qty;
    overheadP += toPence(line.snap_overhead_cost) * qty;
    totalP += toPence(line.snap_total_cost) * qty;
    return { ...line, ...computeLine(line) };
  });

  return {
    lines: computed,
    totals: {
      totalPd: roundEffort(pdSum),
      totalUsp: roundEffort(uspSum),
      totalAtom: roundEffort(atomSum),
      totalUspCost: toPounds(uspCostP),
      totalOverheadCost: toPounds(overheadP),
      grandTotalCost: toPounds(totalP),
      lineCount: lines.length,
    },
  };
}
