/**
 * Menu Card cost calculator (task 9.12 — on-screen Menu Card creation).
 *
 * Derives a service variant's six values from PD + the version's rates, using the SAME formulas
 * the real Menu Card workbook uses:
 *   USP       = PD × 2
 *   ATOM      = PD × 1
 *   USP Cost  = USP × blendedUspRate
 *   Overhead  = USP Cost × (overheadPct / 100)
 *   Total     = USP Cost + Overhead
 *
 * Money is computed in INTEGER PENCE then converted back to pounds (2dp) — mirroring engine.js so
 * there is no binary-float drift (the same discipline that keeps estimate totals exact).
 *
 * This is a PREVIEW/helper only: the create route stores whatever six values are submitted (which
 * may be admin OVERRIDES of these computed defaults — e.g. "Test Only" rows that use the £144
 * people-day rate, or an irregular ATOM). MDP never recomputes stored variant values afterwards.
 *
 * Verified golden (MQ XL): PD 54 @ blended 55.56 / overhead 40 →
 *   USP 108, ATOM 54, USP Cost 6000.48, Overhead 2400.19, Total 8400.67.
 */

function toPence(pounds) { return Math.round((Number(pounds) || 0) * 100); }
function toPounds(pence) { return Math.round(pence) / 100; }
function roundEffort(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

/**
 * Compute the six derived values for one variant from PD + rates.
 * @param {number} pd              person-days (the single driver input)
 * @param {object} rates           { blendedUspRate, overheadPct }
 * @returns {{ pd, usp, atom, uspCost, overheadCost, totalCost }}  money fields in pounds (2dp)
 */
export function computeVariant(pd, { blendedUspRate, overheadPct } = {}) {
  const pdN = Number(pd) || 0;
  const rate = Number(blendedUspRate) || 0;
  const ovPct = Number(overheadPct) || 0;

  const usp = roundEffort(pdN * 2);
  const atom = roundEffort(pdN * 1);

  // Money in integer pence. USP Cost = USP × rate(£/USP). rate in pence = toPence(rate); USP is a
  // unitless count, so USP × ratePence is already pence. Overhead = USP Cost × overhead%.
  const uspCostP = Math.round(usp * toPence(rate));
  const overheadP = Math.round(uspCostP * ovPct / 100);
  const totalP = uspCostP + overheadP;

  return {
    pd: roundEffort(pdN),
    usp,
    atom,
    uspCost: toPounds(uspCostP),
    overheadCost: toPounds(overheadP),
    totalCost: toPounds(totalP),
  };
}
