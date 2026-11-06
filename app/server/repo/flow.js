/**
 * Flow analytics (Stage 9 part ii, tasks 9.4–9.5).
 *
 * Deliberately FLOW ANALYTICS + an honest RUN-RATE, not a statistical forecasting model — at a
 * handful of users and modest volume, transparent metrics are the right ceiling (design §10).
 *
 * Everything is reconstructed from data MDP already keeps:
 *   - each request's `created_at` (authoritative creation time), and
 *   - its status-transition history: append-only ESTIMATE_MODIFY audit events whose detail is
 *     { change:'status', from, to } with the event `timestamp`.
 * No new storage; this is a read model over the audit log + estimates + snapshotted line values.
 *
 * Metrics:
 *   - throughput     : requests reaching DONE per month (keyed on the first to=DONE event)
 *   - cycleTime      : Created→Done and Approved→Done (median + mean days)
 *   - dwell          : average days a request spends in each status before leaving it
 *   - aging          : open requests (not DONE/ARCHIVED) sitting in their current status longer
 *                      than `agingDays` (default 30; tweakable)
 *   - runRate        : recent PD/month reaching DONE vs the committed (APPROVED+IN_PROGRESS)
 *                      backlog PD → ~N months of work, with the inputs returned for transparency
 */
import { getDb } from '../db.js';
import { EstimateStatus } from '../constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a SQLite datetime ('YYYY-MM-DD HH:MM:SS', UTC) to epoch ms. */
function parseTs(s) {
  if (!s) return NaN;
  const iso = String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z');
  return new Date(iso).getTime();
}
function daysBetween(aMs, bMs) {
  return (bMs - aMs) / DAY_MS;
}
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function roundEffort(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }
function median(sortedAsc) {
  const a = sortedAsc;
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function ymOf(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Build a per-request timeline:
 *   { id, status, createdMs, events:[{from,to,ms}] (ascending), pd }
 * events come from ESTIMATE_MODIFY status audit rows; pd is the request's snapshotted PD total.
 */
function buildTimelines() {
  const db = getDb();

  const requests = db.prepare(
    `SELECT e.id, e.status, e.created_at, e.component, e.size, e.cfu, e.customer_name AS customer,
            COALESCE((SELECT SUM(l.snap_pd * l.quantity) FROM estimate_lines l WHERE l.estimate_id = e.id), 0) AS pd
       FROM estimates e`,
  ).all();

  // All status-change events, oldest first, grouped by request id.
  const evRows = db.prepare(
    `SELECT object_id AS id, timestamp AS ts, detail
       FROM audit_events
      WHERE action = 'ESTIMATE_MODIFY' AND object_type = 'Estimate'
        AND detail LIKE '%"change":"status"%'
      ORDER BY timestamp ASC, id ASC`,
  ).all();

  const eventsById = new Map();
  for (const r of evRows) {
    let d;
    try { d = JSON.parse(r.detail); } catch { d = null; }
    if (!d || d.change !== 'status') continue;
    const ms = parseTs(r.ts);
    if (Number.isNaN(ms)) continue;
    if (!eventsById.has(r.id)) eventsById.set(r.id, []);
    eventsById.get(r.id).push({ from: d.from ?? null, to: d.to, ms });
  }

  return requests.map((e) => ({
    id: e.id,
    status: e.status,
    component: e.component,
    size: e.size,
    cfu: e.cfu,
    customer: e.customer,
    createdMs: parseTs(e.created_at),
    pd: Number(e.pd) || 0,
    events: eventsById.get(e.id) || [],
  }));
}

/**
 * Narrow a timelines array by an in-memory filter. All keys optional; empty = no constraint.
 * The date range (from/to, 'YYYY-MM-DD') is applied to the request's CREATION date, consistent
 * with the rest of the app.
 */
function applyFilter(timelines, { component, size, cfu, customer, from, to } = {}) {
  const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : null;
  const toMs = to ? Date.parse(`${to}T23:59:59Z`) : null;
  return timelines.filter((tl) => {
    if (component && tl.component !== component) return false;
    if (size && tl.size !== size) return false;
    if (cfu && tl.cfu !== cfu) return false;
    if (customer && tl.customer !== customer) return false;
    if (fromMs != null && !(tl.createdMs >= fromMs)) return false;
    if (toMs != null && !(tl.createdMs <= toMs)) return false;
    return true;
  });
}

/** First timestamp at which a request transitioned INTO `status`, or null. */
function firstReached(tl, status) {
  for (const ev of tl.events) if (ev.to === status) return ev.ms;
  return null;
}

/**
 * Throughput: count of requests whose FIRST DONE transition fell in each calendar month.
 * Gap-filled across the observed range so the chart is continuous.
 */
function throughput(timelines) {
  const months = {};
  for (const tl of timelines) {
    const doneMs = firstReached(tl, EstimateStatus.DONE);
    if (doneMs == null) continue;
    const ym = ymOf(doneMs);
    months[ym] = (months[ym] || 0) + 1;
  }
  const keys = Object.keys(months).sort();
  if (!keys.length) return { items: [], total: 0 };
  const [sY, sM] = keys[0].split('-').map(Number);
  const [eY, eM] = keys[keys.length - 1].split('-').map(Number);
  const items = [];
  let y = sY; let m = sM;
  while (y < eY || (y === eY && m <= eM)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    items.push({ month: ym, count: months[ym] || 0 });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

/** Cycle time from an anchor timestamp to the first DONE, over requests that reached DONE. */
function cycleFrom(timelines, anchorFn) {
  const days = [];
  for (const tl of timelines) {
    const doneMs = firstReached(tl, EstimateStatus.DONE);
    if (doneMs == null) continue;
    const anchorMs = anchorFn(tl);
    if (anchorMs == null || Number.isNaN(anchorMs)) continue;
    const d = daysBetween(anchorMs, doneMs);
    if (d >= 0) days.push(d);
  }
  if (!days.length) return { count: 0, medianDays: null, meanDays: null };
  const asc = days.slice().sort((a, b) => a - b);
  const mean = days.reduce((s, n) => s + n, 0) / days.length;
  return { count: days.length, medianDays: round1(median(asc)), meanDays: round1(mean) };
}

/**
 * Per-stage dwell: average days a request spent IN each status before leaving it. A request
 * "enters" its first status at creation (NEW), then each event moves it on; the interval between
 * entering a status and the next transition is that status's dwell. The current (unfinished)
 * status is NOT counted here (that's what "aging" is for).
 */
function dwell(timelines) {
  const totals = {}; // status -> { sumDays, n }
  const add = (status, d) => {
    if (d < 0) return;
    if (!totals[status]) totals[status] = { sumDays: 0, n: 0 };
    totals[status].sumDays += d;
    totals[status].n += 1;
  };
  for (const tl of timelines) {
    if (!tl.events.length) continue;
    // Entered the first event's `from` status at creation.
    let enteredMs = tl.createdMs;
    let curStatus = tl.events[0].from || EstimateStatus.NEW;
    for (const ev of tl.events) {
      if (!Number.isNaN(enteredMs)) add(curStatus, daysBetween(enteredMs, ev.ms));
      curStatus = ev.to;
      enteredMs = ev.ms;
    }
    // trailing (current) status is intentionally left for aging, not dwell.
  }
  const items = Object.entries(totals).map(([status, t]) => ({
    status,
    avgDays: round1(t.sumDays / t.n),
    samples: t.n,
  }));
  // Keep a sensible status order.
  const order = Object.values(EstimateStatus);
  items.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return items;
}

/**
 * Aging: requests still open (not DONE/ARCHIVED) whose time in their CURRENT status exceeds
 * `agingDays`. Entered-current = the last transition's ts, or created_at if none.
 */
function aging(timelines, agingDays, nowMs) {
  const open = [];
  for (const tl of timelines) {
    // DONE/ARCHIVED are finished/filed; CANCELLED is stopped — none count as "open" for aging.
    if (tl.status === EstimateStatus.DONE
      || tl.status === EstimateStatus.ARCHIVED
      || tl.status === EstimateStatus.CANCELLED) continue;
    const enteredMs = tl.events.length ? tl.events[tl.events.length - 1].ms : tl.createdMs;
    if (Number.isNaN(enteredMs)) continue;
    const d = daysBetween(enteredMs, nowMs);
    open.push({ id: tl.id, status: tl.status, daysInStatus: round1(d), aging: d > agingDays });
  }
  open.sort((a, b) => b.daysInStatus - a.daysInStatus);
  return open;
}

/** Decorate the aging list with human fields (jira ref, summary) for the table. */
function agingWithLabels(agingList) {
  if (!agingList.length) return [];
  const db = getDb();
  const get = db.prepare('SELECT jira_reference AS jira, summary, customer_name AS customer FROM estimates WHERE id = ?');
  return agingList.map((a) => {
    const r = get.get(a.id) || {};
    return { ...a, jira: r.jira || a.id, summary: r.summary || '', customer: r.customer || '' };
  });
}

/**
 * Run-rate projection (honest, non-statistical):
 *   avgPdPerMonth = mean PD/month of requests reaching DONE over the last `recentMonths` months
 *                   that have any completions (we average over months with throughput so a long
 *                   idle gap doesn't understate the rate).
 *   backlogPd     = Σ snapshot PD for requests currently APPROVED or IN_PROGRESS (committed work)
 *   projectedMonths = backlogPd / avgPdPerMonth  (null when there's no recent throughput)
 * All inputs are returned so the UI can state the assumptions plainly.
 */
function runRate(timelines, recentMonths) {
  // PD completed per month (first DONE).
  const pdByMonth = {};
  for (const tl of timelines) {
    const doneMs = firstReached(tl, EstimateStatus.DONE);
    if (doneMs == null) continue;
    const ym = ymOf(doneMs);
    pdByMonth[ym] = (pdByMonth[ym] || 0) + tl.pd;
  }
  const monthsWithDone = Object.keys(pdByMonth).sort();
  const recent = monthsWithDone.slice(-recentMonths);
  const recentPd = recent.reduce((s, ym) => s + pdByMonth[ym], 0);
  const avgPdPerMonth = recent.length ? recentPd / recent.length : 0;

  // Committed backlog PD (APPROVED + IN_PROGRESS).
  let backlogPd = 0;
  for (const tl of timelines) {
    if (tl.status === EstimateStatus.APPROVED || tl.status === EstimateStatus.IN_PROGRESS) backlogPd += tl.pd;
  }

  const projectedMonths = avgPdPerMonth > 0 ? round1(backlogPd / avgPdPerMonth) : null;

  return {
    avgPdPerMonth: roundEffort(avgPdPerMonth),
    monthsConsidered: recent.length,
    recentMonthsRequested: recentMonths,
    backlogPd: roundEffort(backlogPd),
    projectedMonths,
    note: projectedMonths == null
      ? 'Not enough completed requests yet to estimate a run-rate.'
      : `At ~${roundEffort(avgPdPerMonth)} PD/month completed (avg of the last ${recent.length} active month(s)), the ${roundEffort(backlogPd)} PD of Approved + In-Progress work is roughly ${projectedMonths} month(s).`,
  };
}

/**
 * Compute the full flow-analytics payload, optionally narrowed to a slice.
 * @param {object} [opts] { agingDays=30, recentMonths=3, nowMs=Date.now(),
 *                           filter?: {component,size,cfu,customer,from,to} }
 */
export function flowReport({ agingDays = 30, recentMonths = 3, nowMs = Date.now(), filter = null } = {}) {
  let timelines = buildTimelines();
  if (filter) timelines = applyFilter(timelines, filter);
  const agingList = aging(timelines, agingDays, nowMs);
  return {
    agingDays,
    recentMonths,
    filter: filter || null,
    matched: timelines.length,
    throughput: throughput(timelines),
    cycleTime: {
      createdToDone: cycleFrom(timelines, (tl) => tl.createdMs),
      approvedToDone: cycleFrom(timelines, (tl) => firstReached(tl, EstimateStatus.APPROVED)),
    },
    dwell: dwell(timelines),
    aging: {
      thresholdDays: agingDays,
      openCount: agingList.length,
      agingCount: agingList.filter((a) => a.aging).length,
      items: agingWithLabels(agingList),
    },
    runRate: runRate(timelines, recentMonths),
  };
}

/** Minimum completed requests in a group before we trust its median cycle time. */
const MIN_CYCLE_SAMPLES = 3;

/**
 * Compare key flow metrics BROKEN DOWN BY a dimension (component | size | cfu | customer).
 * Returns one row per group value with: count, completed, cycleMedianDays (null when too few
 * completed to be reliable), throughput (total reaching DONE), avgDwellDays (across all stages),
 * open, aging, and backlogPd. Groups are sorted by request count (desc).
 * @param {string} dimension  one of 'component' | 'size' | 'cfu' | 'customer'
 */
export function flowCompare(dimension, { agingDays = 30, nowMs = Date.now() } = {}) {
  const valid = ['component', 'size', 'cfu', 'customer'];
  const dim = valid.includes(dimension) ? dimension : 'component';
  const timelines = buildTimelines();

  const groups = new Map();
  for (const tl of timelines) {
    const key = tl[dim] ?? '(none)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tl);
  }

  const rows = [];
  for (const [group, tls] of groups) {
    const c2d = cycleFrom(tls, (t) => t.createdMs);
    const tp = throughput(tls);
    const dw = dwell(tls);
    const avgDwell = dw.length ? round1(dw.reduce((s, d) => s + d.avgDays, 0) / dw.length) : null;
    const agingList = aging(tls, agingDays, nowMs);
    const backlogPd = tls.reduce((s, t) =>
      s + ((t.status === EstimateStatus.APPROVED || t.status === EstimateStatus.IN_PROGRESS) ? t.pd : 0), 0);
    rows.push({
      group,
      count: tls.length,
      completed: c2d.count,
      cycleMedianDays: c2d.count >= MIN_CYCLE_SAMPLES ? c2d.medianDays : null,
      cycleReliable: c2d.count >= MIN_CYCLE_SAMPLES,
      throughput: tp.total,
      avgDwellDays: avgDwell,
      open: agingList.length,
      aging: agingList.filter((a) => a.aging).length,
      backlogPd: roundEffort(backlogPd),
    });
  }

  rows.sort((a, b) => b.count - a.count);
  return { dimension: dim, agingDays, groups: rows, total: timelines.length };
}
