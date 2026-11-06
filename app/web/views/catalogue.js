/** Product Catalogue view (both roles) — browse/filter the active Menu Card's variants. */
import { api } from '../api.js';

// short display codes for component pills (value -> pill label)
const COMPONENT_PILL = { MQ: 'MQ', WLS: 'WLS', WILDFLY: 'WFY', CFT: 'CFT' };
// full label for the detail panel
const COMPONENT_LABEL = {
  MQ: 'IBM MQ',
  WLS: 'Oracle WebLogic',
  CFT: 'Axway CFT',
  WILDFLY: 'WildFly',
};
const SIZE_SEQUENCE = ['TO', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
const COMPONENT_ORDER = ['MQ', 'WLS', 'WILDFLY', 'CFT'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function money(n) {
  if (typeof n !== 'number') return esc(n);
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n) {
  return typeof n === 'number' ? String(n) : esc(n);
}
function firstLine(desc) {
  const s = String(desc || '');
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

// selected filter sets; empty set = "All"
const selComponents = new Set();
const selSizes = new Set();
let allItems = []; // last fetched (already server-sorted)
let searchText = '';

export async function renderCatalogue(view) {
  view.innerHTML = `
    <h1>Product Catalogue</h1>
    <div id="cat-banner" class="muted">Loading…</div>

    <div class="card cat-controls" style="margin-top: var(--space-4);">
      <div class="cat-controls-left">
        <div class="pill-group">
          <span class="pill-label">Component</span>
          <div class="pills" id="cat-comp-pills"></div>
        </div>
        <div class="pill-group" style="margin-top: var(--space-3);">
          <span class="pill-label">Size</span>
          <div class="pills" id="cat-size-pills"></div>
        </div>
      </div>
      <div class="cat-controls-right">
        <label class="field">
          <span>Search</span>
          <input id="cat-q" type="text" placeholder="Search all columns…" />
        </label>
        <div class="cat-controls-meta">
          <span id="cat-count" class="muted"></span>
          <button type="button" class="btn-ghost" id="cat-clear">Clear filters</button>
        </div>
      </div>
    </div>

    <div id="cat-results" style="margin-top: var(--space-5);">Loading…</div>
    <div id="cat-detail"></div>
  `;

  buildComponentPills(view);
  buildSizePills(view);

  const qInput = view.querySelector('#cat-q');
  let t;
  qInput.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      searchText = qInput.value.trim().toLowerCase();
      renderTable(view);
    }, 150);
  });

  view.querySelector('#cat-clear').addEventListener('click', () => {
    selComponents.clear();
    selSizes.clear();
    searchText = '';
    qInput.value = '';
    buildComponentPills(view);
    buildSizePills(view);
    loadFromServer(view);
  });

  await loadFromServer(view);
}

// ---- pills ----

function buildComponentPills(view) {
  const wrap = view.querySelector('#cat-comp-pills');
  const pills = [pill('All', selComponents.size === 0, 'comp', '')]
    .concat(COMPONENT_ORDER.map((c) => pill(COMPONENT_PILL[c], selComponents.has(c), 'comp', c)));
  wrap.innerHTML = pills.join('');
  wrap.querySelectorAll('[data-pill]').forEach((el) => {
    el.addEventListener('click', () => {
      const val = el.getAttribute('data-val');
      if (val === '') selComponents.clear();
      else {
        if (selComponents.has(val)) selComponents.delete(val);
        else selComponents.add(val);
      }
      buildComponentPills(view);
      loadFromServer(view);
    });
  });
}

function buildSizePills(view) {
  const wrap = view.querySelector('#cat-size-pills');
  const pills = [pill('All', selSizes.size === 0, 'size', '')]
    .concat(SIZE_SEQUENCE.map((s) => pill(s, selSizes.has(s), 'size', s)));
  wrap.innerHTML = pills.join('');
  wrap.querySelectorAll('[data-pill]').forEach((el) => {
    el.addEventListener('click', () => {
      const val = el.getAttribute('data-val');
      if (val === '') selSizes.clear();
      else {
        if (selSizes.has(val)) selSizes.delete(val);
        else selSizes.add(val);
      }
      buildSizePills(view);
      loadFromServer(view);
    });
  });
}

function pill(label, active, kind, val) {
  // aria-pressed conveys the toggle state to screen readers (the .active class is visual only).
  return `<button type="button" class="pill${active ? ' active' : ''}" aria-pressed="${active ? 'true' : 'false'}" data-pill="${kind}" data-val="${esc(val)}">${esc(label)}</button>`;
}

// ---- data ----

async function loadFromServer(view) {
  const params = new URLSearchParams();
  if (selComponents.size) params.set('component', [...selComponents].join(','));
  if (selSizes.size) params.set('size', [...selSizes].join(','));
  const results = view.querySelector('#cat-results');
  view.querySelector('#cat-detail').innerHTML = '';
  if (results) { results.setAttribute('aria-busy', 'true'); results.innerHTML = '<p class="muted">Loading…</p>'; }
  try {
    const data = await api.get('/api/catalogue?' + params.toString());
    allItems = data.items;
    renderBanner(view, data.activeVersion);
    renderTable(view);
  } catch (e) {
    results.innerHTML = `<p class="form-error">Could not load catalogue: ${esc(e.message)}</p>`;
  } finally {
    if (results) results.removeAttribute('aria-busy');
  }
}

function renderBanner(view, activeVersion) {
  const el = view.querySelector('#cat-banner');
  if (!activeVersion) {
    el.innerHTML =
      '<span class="badge warn">No active Menu Card</span> An administrator needs to import and activate a Menu Card.';
    return;
  }
  const fy = activeVersion.financialYear ? ` (${esc(activeVersion.financialYear)})` : '';
  el.innerHTML = `Active Menu Card: <strong>${esc(activeVersion.sourceFilename)}</strong>${fy}`;
}

// ---- table (client-side search across all displayed columns) ----

function rowMatchesSearch(v) {
  if (!searchText) return true;
  const hay = [
    COMPONENT_PILL[v.component] || v.component,
    v.size,
    firstLine(v.description),
    num(v.usp),
    money(v.uspCost),
    money(v.overheadCost),
    money(v.totalCost),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(searchText);
}

function renderTable(view) {
  const el = view.querySelector('#cat-results');
  const items = allItems.filter(rowMatchesSearch);
  const countEl = view.querySelector('#cat-count');
  if (countEl) countEl.textContent = `${items.length} of ${allItems.length} services`;
  if (!items.length) {
    el.innerHTML = '<p class="muted">No services match the current filters.</p>';
    return;
  }
  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Component</th><th>Size</th><th>Service</th>
          <th>Story Points</th><th>TCS Cost</th><th>FTE Cost</th><th>Total Cost</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (v) => `
          <tr data-variant="${v.id}" role="link" tabindex="0"
              aria-label="View details for ${esc(COMPONENT_LABEL[v.component] || v.component)} ${esc(v.size)} — ${esc(firstLine(v.description))}">
            <td>${esc(COMPONENT_PILL[v.component] || v.component)}</td>
            <td><span class="badge">${esc(v.size)}</span></td>
            <td>${esc(firstLine(v.description))}</td>
            <td>${num(v.usp)}</td>
            <td>${money(v.uspCost)}</td>
            <td>${money(v.overheadCost)}</td>
            <td><strong>${money(v.totalCost)}</strong></td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-variant]').forEach((row) => {
    const open = () => showDetail(view, row.getAttribute('data-variant'));
    row.addEventListener('click', open);
    // Keyboard activation for the focusable row (role="link"): Enter or Space.
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        open();
      }
    });
  });
}

// ---- detail ----

async function showDetail(view, id) {
  const panel = view.querySelector('#cat-detail');
  panel.innerHTML = '<div class="card" style="margin-top:var(--space-5);">Loading…</div>';
  try {
    const v = await api.get(`/api/catalogue/variants/${id}`);
    panel.innerHTML = `
      <div class="card cat-detail" style="margin-top: var(--space-5);">
        <h2 style="margin-top:0;">
          ${esc(COMPONENT_LABEL[v.component] || v.component)} — <span class="badge">${esc(v.size)}</span>
        </h2>
        <p style="white-space:pre-line;">${esc(v.description)}</p>
        <table class="kv">
          <tr><th>Story Points (USP)</th><td>${num(v.usp)}</td></tr>
          <tr><th>ATOM</th><td>${num(v.atom)}</td></tr>
          <tr><th>PD (Person Days)</th><td>${num(v.pd)}</td></tr>
          <tr><th>TCS Cost</th><td>${money(v.uspCost)}</td></tr>
          <tr><th>FTE Cost</th><td>${money(v.overheadCost)}</td></tr>
          <tr><th>Total Cost</th><td><strong>${money(v.totalCost)}</strong></td></tr>
          ${v.currentPartnerCost ? `<tr><th>Current Partner Cost (ref)</th><td>${esc(v.currentPartnerCost)}</td></tr>` : ''}
        </table>
        ${v.scope ? `<h3>Scope</h3><p style="white-space:pre-line;">${esc(v.scope)}</p>` : ''}
        ${v.assumptions ? `<h3>Assumptions</h3><p style="white-space:pre-line;">${esc(v.assumptions)}</p>` : ''}
        ${v.exclusions ? `<h3>Exclusions</h3><p style="white-space:pre-line;">${esc(v.exclusions)}</p>` : ''}
        <button class="btn-ghost" id="cat-detail-close" type="button">Close</button>
      </div>`;
    panel.querySelector('#cat-detail-close').addEventListener('click', () => {
      panel.innerHTML = '';
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    panel.innerHTML = `<div class="card"><p class="form-error">Could not load detail: ${esc(e.message)}</p></div>`;
  }
}
