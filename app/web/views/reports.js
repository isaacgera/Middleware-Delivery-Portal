/**
 * Reporting dashboards (Stage 9) — WealthOrah-style layout:
 *   filter bar (CFU / Component / Status / date range) → KPI summary cards → 2-col chart grid
 *   → by-customer table. One /api/reports/summary call, re-fetched when a filter changes.
 * Read-only, both roles. Hand-rolled SVG charts (charts.js); figures also in text/table (a11y).
 */
import { api } from '../api.js';
import { summaryCard, barChart, donut, lineChart } from './charts.js';
import { exportSummaryTablesPdf } from './pdf-export.js';

const COMPONENT_LABEL = { MQ: 'MQ', WLS: 'WLS', WILDFLY: 'WFY', CFT: 'CFT' };
let lastSummary = null;   // latest /summary payload, for the export
let lastFilterQs = '';    // the filter query string in force, for the export filename/title
const STATUS_LABEL = {
  NEW: 'New', PENDING: 'Pending', APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress', DONE: 'Done', ARCHIVED: 'Archived', CANCELLED: 'Cancelled',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function money(n) {
  if (typeof n !== 'number') return esc(n);
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Compact money for sub-rows: £1.2k / £3.4M. */
function moneyShort(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return '£' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '£' + (v / 1e3).toFixed(1) + 'k';
  return '£' + v.toFixed(0);
}
function compLabel(c) { return COMPONENT_LABEL[c] || c; }
function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return String(ym);
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'short', year: 'numeric' });
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function renderReports(view) {
  view.innerHTML = `
    <div class="est-list-head">
      <h1>Dashboards</h1>
      <div class="actions-menu" id="dexp-menu">
        <button type="button" class="btn-ghost actions-toggle" id="dexp-toggle"
                aria-haspopup="true" aria-expanded="false" aria-controls="dexp-list">
          Export <span class="actions-caret" aria-hidden="true">▾</span>
        </button>
        <div class="actions-list" id="dexp-list" role="menu" aria-label="Export summary" hidden>
          <button type="button" role="menuitem" id="dexp-pdf">PDF</button>
          <button type="button" role="menuitem" id="dexp-csv">CSV</button>
        </div>
      </div>
    </div>
    <p class="muted" style="margin-top:calc(var(--space-2) * -1);">Overview of the request pipeline.</p>

    <div class="card dash-filter-card">
      <div class="dash-filters">
        <label class="field"><span>CFU</span>
          <select id="f-cfu"><option value="">All CFUs</option></select></label>
        <label class="field"><span>Component</span>
          <select id="f-component"><option value="">All components</option></select></label>
        <label class="field"><span>Status</span>
          <select id="f-status"><option value="">All statuses</option></select></label>
        <label class="field"><span>From</span><input id="f-from" type="date" /></label>
        <label class="field"><span>To</span><input id="f-to" type="date" /></label>
        <button type="button" class="btn-ghost" id="f-clear">Clear</button>
      </div>
    </div>

    <div id="dash-kpis" class="summary-grid">Loading&hellip;</div>
    <div id="dash-charts" class="dash-grid-2"></div>
    <div id="dash-revenue" class="dash-grid-2"></div>
  `;

  // Populate the filter dropdowns from the data.
  try {
    const opts = await api.get('/api/reports/filters');
    const cfuSel = view.querySelector('#f-cfu');
    for (const c of opts.cfus || []) cfuSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`);
    const compSel = view.querySelector('#f-component');
    for (const c of opts.components || []) compSel.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(compLabel(c))}</option>`);
    const statusSel = view.querySelector('#f-status');
    for (const s of opts.statuses || []) statusSel.insertAdjacentHTML('beforeend', `<option value="${esc(s)}">${esc(STATUS_LABEL[s] || s)}</option>`);
  } catch { /* non-fatal — filters just stay "All" */ }

  const reload = debounce(() => loadDashboard(view), 120);
  ['#f-cfu', '#f-component', '#f-status', '#f-from', '#f-to'].forEach((sel) =>
    view.querySelector(sel).addEventListener('change', reload));
  view.querySelector('#f-clear').addEventListener('click', () => {
    ['#f-cfu', '#f-component', '#f-status', '#f-from', '#f-to'].forEach((sel) => { view.querySelector(sel).value = ''; });
    loadDashboard(view);
  });

  // Export menu (CSV / PDF of the current filtered summary).
  const expMenu = view.querySelector('#dexp-menu');
  const expToggle = view.querySelector('#dexp-toggle');
  const expList = view.querySelector('#dexp-list');
  const closeExp = () => {
    expList.hidden = true; expToggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
  };
  function onDocClick(ev) { if (!expMenu.contains(ev.target)) closeExp(); }
  expToggle.addEventListener('click', () => {
    if (expList.hidden) { expList.hidden = false; expToggle.setAttribute('aria-expanded', 'true'); document.addEventListener('click', onDocClick, true); }
    else closeExp();
  });
  view.querySelector('#dexp-csv').addEventListener('click', () => { closeExp(); exportSummary('csv'); });
  view.querySelector('#dexp-pdf').addEventListener('click', () => { closeExp(); exportSummary('pdf'); });

  await loadDashboard(view);
}

function currentFilter(view) {
  const p = new URLSearchParams();
  const set = (key, sel) => { const v = view.querySelector(sel).value; if (v) p.set(key, v); };
  set('cfu', '#f-cfu');
  set('component', '#f-component');
  set('status', '#f-status');
  set('from', '#f-from');
  set('to', '#f-to');
  return p.toString();
}

async function loadDashboard(view) {
  const kpisEl = view.querySelector('#dash-kpis');
  const chartsEl = view.querySelector('#dash-charts');
  const revEl = view.querySelector('#dash-revenue');
  const qs = currentFilter(view);
  try {
    const d = await api.get(`/api/reports/summary${qs ? `?${qs}` : ''}`);
    lastSummary = d;          // cache for the export
    lastFilterQs = qs;
    renderKpis(kpisEl, d);
    renderCharts(chartsEl, d);
    renderRevenue(revEl, d.value);
  } catch (e) {
    kpisEl.innerHTML = `<p class="form-error">Could not load dashboards: ${esc(e.message)}</p>`;
    chartsEl.innerHTML = '';
    revEl.innerHTML = '';
  }
}

/** Whole-number percentage of part/total; null when total is 0 (so no % is shown). */
function pctOf(part, total) {
  const t = Number(total) || 0;
  if (t <= 0) return null;
  return Math.round((Number(part) || 0) / t * 100);
}

/** Describe the active filter in plain words (for the export title/subtitle). */
function filterSummaryText() {
  if (!lastFilterQs) return 'All requests (no filters)';
  const p = new URLSearchParams(lastFilterQs);
  const bits = [];
  if (p.get('cfu')) bits.push(`CFU: ${p.get('cfu')}`);
  if (p.get('component')) bits.push(`Component: ${compLabel(p.get('component'))}`);
  if (p.get('status')) bits.push(`Status: ${STATUS_LABEL[p.get('status')] || p.get('status')}`);
  if (p.get('from')) bits.push(`From: ${p.get('from')}`);
  if (p.get('to')) bits.push(`To: ${p.get('to')}`);
  return bits.length ? bits.join(' · ') : 'All requests (no filters)';
}

/** Build the summary as labelled sections ({ heading, columns, rows }) from the cached payload. */
function buildSummarySections(d) {
  const k = d.kpis || {};
  const num = (n) => (Number(n) || 0).toLocaleString('en-GB');
  const gbp = (n) => Number(n || 0).toFixed(2);
  const sections = [];

  sections.push({
    heading: 'Key figures',
    columns: ['Metric', 'Value'],
    rows: [
      ['Total requests', num(k.totalRequests)],
      ['Approved', num(k.approved)],
      ['In Progress', num(k.inProgress)],
      ['Total USP (story points)', num(k.totalUsp)],
      ['Total PD', num(k.totalPd)],
      ['TCS cost (GBP)', gbp(k.totalTcsCost)],
      ['FTE cost (GBP)', gbp(k.totalFteCost)],
      ['Total cost (GBP)', gbp(k.totalCost)],
    ],
  });

  const statusRows = Object.entries(d.volume?.byStatus || {}).map(([s, c]) => [STATUS_LABEL[s] || s, num(c)]);
  if (statusRows.length) sections.push({ heading: 'Requests by status', columns: ['Status', 'Count'], rows: statusRows });

  const prodRows = (d.byProduct?.items || []).map((i) => [compLabel(i.component), num(i.count)]);
  if (prodRows.length) sections.push({ heading: 'Requests by product', columns: ['Component', 'Count'], rows: prodRows });

  const cfuRows = (d.byCfu?.items || []).map((i) => [i.cfu, num(i.count)]);
  if (cfuRows.length) sections.push({ heading: 'Requests by CFU', columns: ['CFU', 'Count'], rows: cfuRows });

  const sizeRows = (d.bySize?.items || []).map((i) => [i.size, num(i.count)]);
  if (sizeRows.length) sections.push({ heading: 'Requests by size', columns: ['Size', 'Count'], rows: sizeRows });

  const compShare = (d.value?.componentShare || []).map((r) => [compLabel(r.key), gbp(r.cost), `${r.pct}%`]);
  if (compShare.length) sections.push({ heading: 'Revenue share by product', columns: ['Component', 'Revenue (GBP)', 'Share'], rows: compShare });

  const cfuShare = (d.value?.cfuShare || []).map((r) => [r.key, gbp(r.cost), `${r.pct}%`]);
  if (cfuShare.length) sections.push({ heading: 'Revenue share by CFU', columns: ['CFU', 'Revenue (GBP)', 'Share'], rows: cfuShare });

  return sections;
}

/** Export the current filtered dashboard summary as CSV or PDF (tables, not charts). */
async function exportSummary(format) {
  if (!lastSummary) { alert('Dashboard data is still loading — try again in a moment.'); return; }
  const sections = buildSummarySections(lastSummary);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mdp-dashboard-summary-${stamp}`;
  const filterText = filterSummaryText();

  if (format === 'csv') {
    const esc2 = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const out = [];
    out.push(`MDP Dashboard summary`);
    out.push(`Filter,${esc2(filterText)}`);
    out.push(`Generated,${esc2(new Date().toLocaleString('en-GB'))}`);
    out.push('');
    for (const sec of sections) {
      out.push(esc2(sec.heading));
      out.push(sec.columns.map(esc2).join(','));
      for (const row of sec.rows) out.push(row.map(esc2).join(','));
      out.push('');
    }
    const csv = '\uFEFF' + out.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${filename}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  try {
    await exportSummaryTablesPdf({
      title: 'MDP Dashboard Summary',
      subtitle: `Filter — ${filterText}`,
      sections,
      filename: `${filename}.pdf`,
    });
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not generate the PDF.');
  }
}

function renderKpis(el, d) {
  const k = d && d.kpis;
  if (!k) { el.innerHTML = ''; return; }

  // Slim cards: a headline figure + at most one or two small sub-figures. The full component
  // and CFU breakdowns now live in the donut charts below (keeps the cards short — 9.2c).
  el.innerHTML =
    summaryCard({
      label: 'Total Cost',
      value: money(k.totalCost || 0),
      sub: [
        { label: 'TCS', value: moneyShort(k.totalTcsCost || 0) },
        { label: 'FTE', value: moneyShort(k.totalFteCost || 0) },
      ],
      accent: true,
    }) +
    summaryCard({
      label: 'Total Requests',
      value: String(k.totalRequests || 0),
      sub: [
        { label: 'Approved', value: String(k.approved || 0), pct: pctOf(k.approved, k.totalRequests) },
        { label: 'In Progress', value: String(k.inProgress || 0), pct: pctOf(k.inProgress, k.totalRequests) },
      ],
    }) +
    summaryCard({
      label: 'Total USP (Story Points)',
      value: (k.totalUsp || 0).toLocaleString('en-GB'),
      sub: [{ label: 'Across requests', value: String(k.totalRequests || 0) }],
    }) +
    summaryCard({
      label: 'CFUs Active',
      value: String(k.activeCfuCount || 0),
      sub: k.topCfu ? [{ label: `Top: ${k.topCfu.cfu}`, value: String(k.topCfu.count), pct: pctOf(k.topCfu.count, k.totalRequests) }] : [{ label: 'No activity', value: '—' }],
    });
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
  const timeline = (d.timeline.items || []).map((i) => ({ label: monthLabel(i.month), value: i.count, display: String(i.count) }));
  const status = Object.entries(d.volume.byStatus || {}).map(([s, c]) => ({ label: STATUS_LABEL[s] || s, value: c, display: String(c) }));
  const product = (d.byProduct.items || []).map((i) => ({ label: compLabel(i.component), value: i.count, display: String(i.count) }));
  const cfu = (d.byCfu.items || []).map((i) => ({ label: i.cfu, value: i.count, display: String(i.count) }));
  const size = (d.bySize.items || []).map((i) => ({ label: i.size, value: i.count, display: String(i.count) }));

  el.innerHTML =
    // Time series → trend line.
    chartCard('Requests over time', `${d.timeline.total || 0} created`, lineChart(timeline, { ariaTitle: 'Requests created per month' })) +
    // Proportions of a whole → donuts.
    chartCard('By product', `${d.byProduct.total || 0} requests`, donut(product, { ariaTitle: 'Requests by component', centreLabel: String(d.byProduct.total || 0) })) +
    chartCard('By CFU', `${d.byCfu.total || 0} requests`, donut(cfu, { ariaTitle: 'Requests by CFU', centreLabel: String(d.byCfu.total || 0) })) +
    // Categorical (ordered/ladder) → bars.
    chartCard('By status', null, barChart(status, { ariaTitle: 'Requests by status' })) +
    chartCard('By size', `${d.bySize.total || 0} requests`, barChart(size, { ariaTitle: 'Requests by size' }));
}

/** Two revenue-share tables: by CFU and by Product (component), each cost + % of total cost. */
function renderRevenue(el, value) {
  value = value || {};
  const shareTable = (title, rows, labelFn) => {
    const list = rows || [];
    return `
      <div class="card report-card">
        <h2>${esc(title)}</h2>
        ${list.length ? `
        <table class="data-table">
          <thead><tr><th>${esc(title.replace('Revenue share by ', ''))}</th><th>Revenue</th><th>Share</th></tr></thead>
          <tbody>
            ${list.map((r) => `
              <tr>
                <td>${esc(labelFn ? labelFn(r.key) : r.key)}</td>
                <td class="num-cell"><strong>${money(r.cost ?? 0)}</strong></td>
                <td>${r.pct ?? 0}%</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p class="muted">No costed requests match these filters.</p>'}
      </div>`;
  };
  el.innerHTML =
    shareTable('Revenue share by CFU', value.cfuShare) +
    shareTable('Revenue share by Product', value.componentShare, compLabel);
}
