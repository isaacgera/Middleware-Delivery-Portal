/**
 * Flow Analytics (Stage 9 part ii) — a separate read-only page with three scope MODES, chosen
 * via a pill so they can be trialled side by side:
 *   Overall  — whole-pipeline flow metrics (the baseline).
 *   Filter   — narrow every metric to a slice (Component / Size / CFU / Customer / date range).
 *   Compare  — break a key-metric table down BY a chosen dimension (Component / Size / CFU / Customer).
 * Both roles. Hand-rolled SVG charts (charts.js); data also in text/tables (a11y).
 *
 * NOTE: this trio is a deliberate trial — once Isaac picks a keeper, the other modes get stripped.
 */
import { api } from '../api.js';
import { summaryCard, barChart } from './charts.js';

const STATUS_LABEL = {
  NEW: 'New', PENDING: 'Pending', APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress', DONE: 'Done', ARCHIVED: 'Archived', CANCELLED: 'Cancelled',
};
const COMPONENT_LABEL = { MQ: 'MQ', WLS: 'WLS', WILDFLY: 'WFY', CFT: 'CFT' };
const AGING_OPTIONS = [7, 14, 30, 60];
// Two modes kept (Isaac trialled all three; Overall was dropped as it's just Filter with nothing
// selected). Filter = drill into a slice; Compare = break a metric down across a dimension.
const MODES = [['filter', 'Filter'], ['compare', 'Compare']];
const COMPARE_DIMS = [['component', 'Component'], ['size', 'Size'], ['cfu', 'CFU'], ['customer', 'Customer']];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function days(n) {
  if (n === null || n === undefined) return '—';
  return `${n.toLocaleString('en-GB')} day${n === 1 ? '' : 's'}`;
}
function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return String(ym);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
function compLabel(c) { return COMPONENT_LABEL[c] || c; }

// Page state (kept simple; re-render on change). Filter is the default (empty = whole pipeline).
const state = { mode: 'filter', agingDays: '30', groupBy: 'component', filter: {}, options: null, agingPage: 1, agingItems: [] };
const AGING_PAGE_SIZE = 10;

export async function renderAnalytics(view) {
  // Load filter option values once.
  try { state.options = await api.get('/api/reports/filters'); } catch { state.options = null; }

  view.innerHTML = `
    <h1>Flow Analytics</h1>
    <p class="muted" style="margin-top:calc(var(--space-2) * -1);">How work moves through the pipeline, and a plain run-rate projection.</p>

    <div class="mode-pill" role="tablist" aria-label="Analytics scope">
      ${MODES.map(([m, lbl]) => `<button type="button" role="tab" data-mode="${m}" class="pill-btn${m === state.mode ? ' active' : ''}" aria-selected="${m === state.mode}">${lbl}</button>`).join('')}
    </div>

    <div class="card dash-filter-card" id="an-controls"></div>
    <div id="an-body"></div>
  `;

  view.querySelectorAll('.pill-btn').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.getAttribute('data-mode');
    view.querySelectorAll('.pill-btn').forEach((x) => {
      const on = x.getAttribute('data-mode') === state.mode;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', String(on));
    });
    renderControls(view);
    loadAnalytics(view);
  }));

  renderControls(view);
  await loadAnalytics(view);
}

/** The controls row depends on the mode. */
function renderControls(view) {
  const el = view.querySelector('#an-controls');
  const agingSel = `
    <label class="field"><span>Aging threshold</span>
      <select id="a-aging">${AGING_OPTIONS.map((d) => `<option value="${d}"${String(d) === state.agingDays ? ' selected' : ''}>${d} days</option>`).join('')}</select>
    </label>`;

  if (state.mode === 'compare') {
    el.innerHTML = `<div class="dash-filters">
      <label class="field"><span>Break down by</span>
        <select id="a-groupby">${COMPARE_DIMS.map(([v, lbl]) => `<option value="${v}"${v === state.groupBy ? ' selected' : ''}>${lbl}</option>`).join('')}</select>
      </label>
      ${agingSel}
    </div>`;
    el.querySelector('#a-groupby').addEventListener('change', (e) => { state.groupBy = e.target.value; loadAnalytics(view); });
  } else if (state.mode === 'filter') {
    const o = state.options || {};
    const opts = (arr, labelFn) => (arr || []).map((v) => `<option value="${esc(v)}">${esc(labelFn ? labelFn(v) : v)}</option>`).join('');
    el.innerHTML = `<div class="dash-filters">
      <label class="field"><span>Component</span><select id="f-component"><option value="">All</option>${opts(o.components, compLabel)}</select></label>
      <label class="field"><span>Size</span><select id="f-size"><option value="">All</option>${opts(o.sizes)}</select></label>
      <label class="field"><span>CFU</span><select id="f-cfu"><option value="">All</option>${opts(o.cfus)}</select></label>
      <label class="field"><span>Customer</span><select id="f-customer"><option value="">All</option>${opts(o.customers)}</select></label>
      <label class="field"><span>From</span><input id="f-from" type="date" /></label>
      <label class="field"><span>To</span><input id="f-to" type="date" /></label>
      ${agingSel}
      <button type="button" class="btn-ghost" id="f-clear">Clear</button>
    </div>`;
    ['#f-component', '#f-size', '#f-cfu', '#f-customer', '#f-from', '#f-to'].forEach((sel) =>
      el.querySelector(sel).addEventListener('change', () => loadAnalytics(view)));
    el.querySelector('#f-clear').addEventListener('click', () => {
      ['#f-component', '#f-size', '#f-cfu', '#f-customer', '#f-from', '#f-to'].forEach((sel) => { el.querySelector(sel).value = ''; });
      loadAnalytics(view);
    });
  } else {
    el.innerHTML = `<div class="dash-filters">${agingSel}</div>`;
  }
  const ageEl = el.querySelector('#a-aging');
  if (ageEl) ageEl.addEventListener('change', (e) => { state.agingDays = e.target.value; loadAnalytics(view); });
}

function readFilter(view) {
  const g = (sel) => { const n = view.querySelector(sel); return n && n.value ? n.value : ''; };
  const f = {
    component: g('#f-component'), size: g('#f-size'), cfu: g('#f-cfu'),
    customer: g('#f-customer'), from: g('#f-from'), to: g('#f-to'),
  };
  state.filter = f;
  return f;
}

async function loadAnalytics(view) {
  const body = view.querySelector('#an-body');
  body.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const p = new URLSearchParams({ mode: state.mode, agingDays: state.agingDays });

  if (state.mode === 'compare') {
    p.set('groupBy', state.groupBy);
  } else if (state.mode === 'filter') {
    const f = readFilter(view);
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  }

  try {
    const d = await api.get(`/api/analytics/flow?${p.toString()}`);
    if (state.mode === 'compare') renderCompare(body, d);
    else renderFlow(body, d);
  } catch (e) {
    body.innerHTML = `<p class="form-error">Could not load analytics: ${esc(e.message)}</p>`;
  }
}

// ---- Overall / Filter rendering (same metric layout; Filter just scopes it) ----

function renderFlow(body, d) {
  // Only call it "scoped" when a filter value is actually set — an empty Filter view is the
  // whole pipeline and shouldn't look narrowed.
  const hasFilter = d.filter && Object.values(d.filter).some((v) => v);
  const matchedNote = hasFilter
    ? `<p class="muted" style="margin-top:0;">Scope: <strong>${d.matched}</strong> matching request${d.matched === 1 ? '' : 's'}.</p>`
    : '';
  body.innerHTML = `
    ${matchedNote}
    <div id="an-kpis" class="summary-grid"></div>
    <div id="an-charts" class="dash-grid-2"></div>
    <div id="an-runrate" class="card report-card"></div>
    <div id="an-aging" class="card report-card"></div>
  `;
  if (hasFilter && d.matched === 0) {
    body.querySelector('#an-kpis').innerHTML = '<p class="muted">No requests match this scope. Widen the filters.</p>';
    return;
  }
  renderKpis(body.querySelector('#an-kpis'), d);
  renderCharts(body.querySelector('#an-charts'), d);
  renderRunRate(body.querySelector('#an-runrate'), d.runRate);
  // Fresh dataset → cache the aging items + reset to the first page.
  state.agingItems = (d.aging && d.aging.items) || [];
  state.agingPage = 1;
  renderAging(body.querySelector('#an-aging'), d.aging);
}

function renderKpis(el, d) {
  const c2d = d.cycleTime.createdToDone;
  const rr = d.runRate;
  const cycleVal = c2d.count === 0 ? '—'
    : c2d.count < 3 ? `~${days(c2d.medianDays)}` : days(c2d.medianDays);
  el.innerHTML =
    summaryCard({
      label: 'Avg Cycle Time',
      value: cycleVal,
      sub: [
        { label: 'Mean', value: c2d.meanDays != null ? days(c2d.meanDays) : '—' },
        { label: 'Completed', value: String(c2d.count) },
      ],
      accent: true,
    }) +
    summaryCard({
      label: 'Throughput',
      value: `${d.throughput.total} done`,
      sub: [{ label: 'Across months', value: String(d.throughput.items.length) }],
    }) +
    summaryCard({
      label: 'Backlog Projection',
      value: rr.projectedMonths != null ? `~${rr.projectedMonths} mo` : '—',
      sub: [
        { label: 'Backlog PD', value: (rr.backlogPd || 0).toLocaleString('en-GB') },
        { label: 'PD/month', value: (rr.avgPdPerMonth || 0).toLocaleString('en-GB') },
      ],
    }) +
    summaryCard({
      label: 'Aging Requests',
      value: String(d.aging.agingCount),
      sub: [
        { label: 'Open total', value: String(d.aging.openCount) },
        { label: 'Threshold', value: `${d.aging.thresholdDays}d` },
      ],
    });
  if (d.cycleTime.createdToDone.count > 0 && d.cycleTime.createdToDone.count < 3) {
    el.insertAdjacentHTML('beforeend', '<p class="muted" style="grid-column:1/-1;font-size:var(--fs-sm);margin:0;">Cycle time is based on very few completed requests — treat as indicative.</p>');
  }
}

function chartCard(title, note, svg) {
  return `
    <div class="card report-card">
      <h2>${esc(title)}</h2>
      ${note ? `<p class="muted" style="margin-top:0;">${esc(note)}</p>` : ''}
      ${svg}
    </div>`;
}

function renderCharts(el, d) {
  const tp = (d.throughput.items || []).map((i) => ({ label: monthLabel(i.month), value: i.count, display: String(i.count) }));
  const dwell = (d.dwell || []).map((i) => ({ label: STATUS_LABEL[i.status] || i.status, value: i.avgDays, display: days(i.avgDays) }));
  el.innerHTML =
    chartCard('Throughput (reaching Done / month)', `${d.throughput.total || 0} completed`, barChart(tp, { ariaTitle: 'Requests completed per month' })) +
    chartCard('Avg time in each stage', 'Average days before moving on', barChart(dwell, { ariaTitle: 'Average dwell time per status' }));
}

function renderRunRate(el, rr) {
  el.innerHTML = `
    <h2>Run-rate projection</h2>
    <p style="margin-top:0;">${esc(rr.note)}</p>
    <ul class="runrate-assumptions">
      <li>Recent throughput: <strong>${(rr.avgPdPerMonth || 0).toLocaleString('en-GB')} PD/month</strong> (average of the last ${rr.monthsConsidered} active month${rr.monthsConsidered === 1 ? '' : 's'}).</li>
      <li>Committed backlog: <strong>${(rr.backlogPd || 0).toLocaleString('en-GB')} PD</strong> (Approved + In Progress).</li>
      <li>Projection: <strong>${rr.projectedMonths != null ? `~${rr.projectedMonths} months` : 'n/a'}</strong> = backlog ÷ recent throughput.</li>
    </ul>
    <p class="muted" style="font-size:var(--fs-sm);">A simple run-rate, not a forecast — it assumes recent pace continues and doesn't model priorities, capacity changes or new work arriving.</p>`;
}

function renderAging(el, aging) {
  const rows = state.agingItems || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / AGING_PAGE_SIZE));
  if (state.agingPage > totalPages) state.agingPage = totalPages;
  if (state.agingPage < 1) state.agingPage = 1;
  const start = (state.agingPage - 1) * AGING_PAGE_SIZE;
  const pageRows = rows.slice(start, start + AGING_PAGE_SIZE);
  const range = rows.length ? `${start + 1}–${start + pageRows.length} of ${rows.length}` : '0';

  el.innerHTML = `
    <div class="table-pager">
      <h2 style="margin:0;">Aging &amp; open requests</h2>
      ${rows.length ? `<span class="table-pager-controls">
        <span class="table-pager-range muted">${esc(range)}</span>
        <button type="button" class="btn-ghost" id="aging-prev" aria-label="Previous page"${state.agingPage <= 1 ? ' disabled' : ''}>‹ Prev</button>
        <button type="button" class="btn-ghost" id="aging-next" aria-label="Next page"${state.agingPage >= totalPages ? ' disabled' : ''}>Next ›</button>
      </span>` : ''}
    </div>
    <p class="muted" style="margin-top:0;">Open requests (not Done/Archived) by time in current status. Flagged over ${aging.thresholdDays} days.</p>
    ${rows.length ? `
    <table class="data-table">
      <thead><tr><th>JIRA</th><th>Summary</th><th>Status</th><th>Days in status</th></tr></thead>
      <tbody>
        ${pageRows.map((r) => `
          <tr${r.aging ? ' class="row-aging"' : ''}>
            <td><strong>${esc(r.jira)}</strong></td>
            <td>${esc(r.summary)}</td>
            <td><span class="badge status-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span></td>
            <td>${days(r.daysInStatus)}${r.aging ? ' <span class="aging-flag" title="Over the aging threshold">aging</span>' : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<p class="muted">No open requests.</p>'}`;

  const prev = el.querySelector('#aging-prev');
  const next = el.querySelector('#aging-next');
  if (prev) prev.addEventListener('click', () => { if (state.agingPage > 1) { state.agingPage -= 1; renderAging(el, aging); } });
  if (next) next.addEventListener('click', () => { if (state.agingPage < totalPages) { state.agingPage += 1; renderAging(el, aging); } });
}

// ---- Compare rendering ----

function renderCompare(body, d) {
  const dimLabel = (COMPARE_DIMS.find(([v]) => v === d.dimension) || [, 'Dimension'])[1];
  const rows = d.groups || [];
  // Chart: median cycle time per group (only reliable ones), largest first.
  const cycleData = rows.filter((r) => r.cycleMedianDays != null)
    .map((r) => ({ label: d.dimension === 'component' ? compLabel(r.group) : r.group, value: r.cycleMedianDays, display: days(r.cycleMedianDays) }));
  const label = (g) => (d.dimension === 'component' ? compLabel(g) : g);

  body.innerHTML = `
    <div class="card report-card">
      <h2>Cycle time by ${esc(dimLabel)}</h2>
      <p class="muted" style="margin-top:0;">Median days Created → Done per ${esc(dimLabel.toLowerCase())} (groups with fewer than 3 completed are shown as “—”).</p>
      ${cycleData.length ? barChart(cycleData, { ariaTitle: `Median cycle time by ${dimLabel}` }) : '<p class="muted">Not enough completed requests in any group yet.</p>'}
    </div>
    <div class="card report-card">
      <h2>Metrics by ${esc(dimLabel)}</h2>
      <table class="data-table">
        <thead><tr>
          <th>${esc(dimLabel)}</th><th>Requests</th><th>Completed</th><th>Cycle (median)</th>
          <th>Throughput</th><th>Avg dwell</th><th>Open</th><th>Aging</th><th>Backlog PD</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td><strong>${esc(label(r.group))}</strong></td>
              <td>${r.count}</td>
              <td>${r.completed}</td>
              <td>${r.cycleMedianDays != null ? days(r.cycleMedianDays) : '<span class="muted">—</span>'}</td>
              <td>${r.throughput}</td>
              <td>${r.avgDwellDays != null ? days(r.avgDwellDays) : '—'}</td>
              <td>${r.open}</td>
              <td>${r.aging}</td>
              <td>${(r.backlogPd || 0).toLocaleString('en-GB')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted" style="font-size:var(--fs-sm);margin-top:var(--space-3);">Cycle median hidden (“—”) where a group has fewer than 3 completed requests, to avoid misleading figures.</p>
    </div>`;
}
