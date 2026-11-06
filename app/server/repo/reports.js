/**
 * Reporting aggregates (Stage 9) — read-only roll-ups over requests + their lines.
 *
 * Money: to stay consistent with engine.js (integer pence to avoid binary-float drift), cost
 * sums are accumulated as SUM(ROUND(snap_*_cost * 100) * quantity) in pence, then converted back
 * to pounds at the edge. Effort (PD/USP) may be fractional and is summed directly.
 *
 * All aggregates accept a shared, optional filter { cfu, component, status, from, to } applied to
 * the request (`estimates`) row — so the whole dashboard can be scoped consistently. An empty /
 * missing value means "no constraint on that dimension".
 *
 * Status vocabulary (EstimateStatus): NEW / PENDING / APPROVED / IN_PROGRESS / DONE / ARCHIVED.
 */
import { getDb } from '../db.js';
import { Component, EstimateStatus, CFU, SIZES } from '../constants.js';

function toPounds(pence) { return Math.round(pence || 0) / 100; }
function roundEffort(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

/**
 * Build a WHERE fragment + params for the shared filter, against the estimates alias `e`.
 * Returns { where: 'WHERE ...' | '', params: [...] }. `to` as a bare date covers the whole day.
 */
function buildFilter({ cfu, component, status, from, to } = {}) {
  const clauses = [];
  const params = [];
  if (cfu) { clauses.push('e.cfu = ?'); params.push(cfu); }
  if (component) { clauses.push('e.component = ?'); params.push(component); }
  if (status) { clauses.push('e.status = ?'); params.push(status); }
  if (from) { clauses.push('date(e.created_at) >= date(?)'); params.push(from); }
  if (to) { clauses.push('date(e.created_at) <= date(?)'); params.push(to); }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Count requests grouped by a column, filling a fixed key set with 0s, under the filter. */
function groupedCounts(column, keys, filter) {
  const db = getDb();
  const { where, params } = buildFilter(filter);
  const rows = db.prepare(`SELECT e.${column} AS k, COUNT(*) c FROM estimates e ${where} GROUP BY e.${column}`).all(...params);
  const counts = {};
  for (const k of keys) counts[k] = 0;
  for (const r of rows) counts[r.k] = (counts[r.k] || 0) + r.c;
  return counts;
}

// ---- individual reports (all filter-aware) ----

/** R9.1 — request volume: total + per-status + created/approved/archived headline. */
export function volumeReport(filter) {
  const byStatus = groupedCounts('status', Object.values(EstimateStatus), filter);
  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
  return {
    total,
    byStatus,
    headline: {
      created: total,
      approved: byStatus[EstimateStatus.APPROVED] || 0,
      inProgress: byStatus[EstimateStatus.IN_PROGRESS] || 0,
      archived: byStatus[EstimateStatus.ARCHIVED] || 0,
    },
  };
}

/** R9.2 — requests per component (every component present). */
export function byProductReport(filter) {
  const counts = groupedCounts('component', Object.values(Component), filter);
  const items = Object.entries(counts).map(([component, count]) => ({ component, count }));
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

/** Requests per CFU (every known CFU present). */
export function byCfuReport(filter) {
  const counts = groupedCounts('cfu', CFU, filter);
  const items = Object.entries(counts).map(([cfu, count]) => ({ cfu, count }));
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

/** Requests per request-level Size, kept in the TO..XXL order. */
export function bySizeReport(filter) {
  const counts = groupedCounts('size', SIZES, filter);
  const ordered = SIZES.filter((s) => s in counts).concat(
    Object.keys(counts).filter((s) => !SIZES.includes(s)),
  );
  const items = ordered.map((size) => ({ size, count: counts[size] }));
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

/** Requests created per month (gap-filled date timeline). */
export function timelineReport(filter) {
  const db = getDb();
  const { where, params } = buildFilter(filter);
  const rows = db.prepare(
    `SELECT strftime('%Y-%m', e.created_at) AS ym, COUNT(*) c FROM estimates e ${where} GROUP BY ym ORDER BY ym`,
  ).all(...params);
  if (!rows.length) return { items: [], total: 0 };
  const counts = {};
  for (const r of rows) counts[r.ym] = r.c;
  const [startY, startM] = rows[0].ym.split('-').map(Number);
  const [endY, endM] = rows[rows.length - 1].ym.split('-').map(Number);
  const items = [];
  let y = startY; let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    items.push({ month: ym, count: counts[ym] || 0 });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

/**
 * R9.3 — value overview: total PD, total USP, total cost (+ TCS/FTE split), a per-component cost
 * split, and a by-customer breakdown. Cost in integer pence. All under the shared filter (which
 * applies to the parent request via the join).
 */
export function valueReport(filter) {
  const db = getDb();
  const { where, params } = buildFilter(filter);

  const totals = db.prepare(
    `SELECT
        COALESCE(SUM(l.snap_pd  * l.quantity), 0)                       AS pd,
        COALESCE(SUM(l.snap_usp * l.quantity), 0)                       AS usp,
        COALESCE(SUM(ROUND(l.snap_total_cost    * 100) * l.quantity), 0) AS cost_pence,
        COALESCE(SUM(ROUND(l.snap_usp_cost      * 100) * l.quantity), 0) AS tcs_pence,
        COALESCE(SUM(ROUND(l.snap_overhead_cost * 100) * l.quantity), 0) AS fte_pence
       FROM estimates e JOIN estimate_lines l ON l.estimate_id = e.id ${where}`,
  ).get(...params);

  const byComponentRows = db.prepare(
    `SELECT e.component AS component,
            COALESCE(SUM(ROUND(l.snap_total_cost * 100) * l.quantity), 0) AS cost_pence,
            COALESCE(SUM(l.snap_usp * l.quantity), 0)                     AS usp
       FROM estimates e JOIN estimate_lines l ON l.estimate_id = e.id ${where}
      GROUP BY e.component`,
  ).all(...params);
  const byComponent = {};      // per-component total cost (£)
  const byComponentUsp = {};   // per-component USP (story points)
  for (const comp of Object.values(Component)) { byComponent[comp] = 0; byComponentUsp[comp] = 0; }
  for (const r of byComponentRows) {
    byComponent[r.component] = toPounds(r.cost_pence);
    byComponentUsp[r.component] = roundEffort(r.usp);
  }

  const byCfuRows = db.prepare(
    `SELECT e.cfu AS cfu,
            COALESCE(SUM(ROUND(l.snap_total_cost * 100) * l.quantity), 0) AS cost_pence
       FROM estimates e JOIN estimate_lines l ON l.estimate_id = e.id ${where}
      GROUP BY e.cfu`,
  ).all(...params);
  const byCfuCost = {};
  for (const r of byCfuRows) byCfuCost[r.cfu] = toPounds(r.cost_pence);

  const totalCostP = totals.cost_pence || 0;
  const share = (costPence) => (totalCostP > 0 ? Math.round((costPence / totalCostP) * 100) : 0);

  // Revenue-share tables: cost + whole-number % of total cost, largest first.
  const componentShare = byComponentRows
    .map((r) => ({ key: r.component, cost: toPounds(r.cost_pence), pct: share(r.cost_pence) }))
    .filter((r) => r.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const cfuShare = byCfuRows
    .map((r) => ({ key: r.cfu, cost: toPounds(r.cost_pence), pct: share(r.cost_pence) }))
    .filter((r) => r.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  return {
    totalPd: roundEffort(totals.pd),
    totalUsp: roundEffort(totals.usp),
    totalCost: toPounds(totals.cost_pence),
    totalTcsCost: toPounds(totals.tcs_pence),
    totalFteCost: toPounds(totals.fte_pence),
    byComponent,     // { MQ: £, WLS: £, CFT: £, WILDFLY: £ }
    byComponentUsp,  // { MQ: usp, WLS: usp, CFT: usp, WILDFLY: usp }
    byCfuCost,       // { CFU: £ }
    componentShare,  // [{ key, cost, pct }] revenue share by component
    cfuShare,        // [{ key, cost, pct }] revenue share by CFU
  };
}

/**
 * One-call dashboard payload: KPIs + every chart series + the by-customer table, all honouring
 * the same filter. Keeps the dashboard consistent and snappy under a filter change.
 */
export function summaryReport(filter) {
  const volume = volumeReport(filter);
  const value = valueReport(filter);
  const byCfu = byCfuReport(filter);

  // CFU headline: how many CFUs have any activity, and which has the most requests.
  const activeCfus = byCfu.items.filter((i) => i.count > 0);
  const topCfu = activeCfus.slice().sort((a, b) => b.count - a.count)[0] || null;

  return {
    filter: filter || {},
    kpis: {
      totalCost: value.totalCost,
      totalTcsCost: value.totalTcsCost,
      totalFteCost: value.totalFteCost,
      byComponentCost: value.byComponent,
      byComponentUsp: value.byComponentUsp,
      totalRequests: volume.total,
      approved: volume.headline.approved,
      inProgress: volume.headline.inProgress,
      totalUsp: value.totalUsp,
      totalPd: value.totalPd,
      activeCfuCount: activeCfus.length,
      topCfu: topCfu ? { cfu: topCfu.cfu, count: topCfu.count } : null,
    },
    volume,
    byProduct: byProductReport(filter),
    byCfu,
    bySize: bySizeReport(filter),
    timeline: timelineReport(filter),
    value: {
      totalCost: value.totalCost,
      componentShare: value.componentShare, // revenue share by product (component)
      cfuShare: value.cfuShare,             // revenue share by CFU
    },
  };
}

/** Distinct filter option values present in the data (for the filter dropdowns). */
export function filterOptions() {
  const db = getDb();
  const distinct = (col) => db.prepare(`SELECT DISTINCT ${col} v FROM estimates WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`).all().map((r) => r.v);
  // Sizes kept in the TO..XXL ladder order rather than alphabetical.
  const sizeOrder = SIZES;
  const sizes = distinct('size').sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b));
  return {
    cfus: distinct('cfu'),
    components: distinct('component'),
    sizes,
    customers: distinct('customer_name'),
    statuses: Object.values(EstimateStatus),
  };
}
