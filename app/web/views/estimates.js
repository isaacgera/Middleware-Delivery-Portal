/**
 * Requests view (Stage 5) — both roles. ("Requests" is the UI name for estimates.)
 * Two modes, driven by the hash:
 *   #/estimates        -> repository list + "Add Request" + search/filter
 *   #/estimates/:id    -> the builder: header, line grid with live totals, add-from-catalogue
 *                         (scoped to the request's Component + Size).
 * Totals come from the server engine (never recomputed client-side for the authoritative
 * figure); the grid shows the per-line computed values the API returns.
 */
import { api, ApiError } from '../api.js';
import { exportRequestPdf, previewRequestPdf, exportRequestsTablePdf } from './pdf-export.js';

// Component codes -> display label (WILDFLY shows as WFY, per Isaac's catalogue labels).
const COMPONENT_PILL = { MQ: 'MQ', WLS: 'WLS', WILDFLY: 'WFY', CFT: 'CFT' };
// Dropdown order for the Component field (display label : stored code).
const COMPONENT_OPTIONS = [
  ['CFT', 'CFT'],
  ['MQ', 'MQ'],
  ['WFY', 'WILDFLY'],
  ['WLS', 'WLS'],
];
const SIZE_OPTIONS = ['TO', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
const CFU_OPTIONS = ['Architecture', 'Business', 'Consumer', 'Corporate', 'Data & AI', 'International', 'Networks', 'Openreach'];

// Request status workflow: New (default) → Pending → Approved → In Progress → Done.
// Any status is selectable at any time (no transition restriction, no editing lock).
const STATUS_LABEL = {
  NEW: 'New',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled',
};
// The active workflow statuses. Archiving is a separate action (Archive / Un-archive button).
const STATUS_OPTIONS = ['NEW', 'PENDING', 'APPROVED', 'IN_PROGRESS', 'DONE'];

/**
 * Status options to offer in the dropdown, given the current status:
 *  - active status (New/Pending/Approved/In Progress) → the 5 active + "Cancelled".
 *  - Done → the 5 active (can move back into the flow; cannot be cancelled).
 *  - Cancelled → the 4 active non-Done, to REVIVE it (can't go straight to Done; Archive is
 *    a separate action). The server enforces the same rules.
 */
function statusOptionsFor(current) {
  if (current === 'CANCELLED') return ['NEW', 'PENDING', 'APPROVED', 'IN_PROGRESS'];
  if (current === 'DONE') return STATUS_OPTIONS;
  // active statuses
  return [...STATUS_OPTIONS, 'CANCELLED'];
}

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
function compLabel(code) {
  return COMPONENT_PILL[code] || code;
}
function selectOptions(values, selected) {
  return values.map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`).join('');
}
function componentSelectOptions(selected) {
  return COMPONENT_OPTIONS
    .map(([label, code]) => `<option value="${esc(code)}"${code === selected ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

// ---- entry point: dispatch list vs builder based on the sub-path ----

export async function renderEstimates(view, subPath) {
  const id = (subPath || '').replace(/^\//, '').trim();
  if (id) return renderBuilder(view, id);
  return renderList(view);
}

// ============================================================
// Repository list
// ============================================================

// Columns shown in the list, with the accessor used for both display and filtering.
const LIST_COLUMNS = [
  { key: 'jiraReference', label: 'JIRA Ref', get: (e) => e.jiraReference },
  { key: 'summary', label: 'Summary', get: (e) => e.summary },
  { key: 'customerName', label: 'Customer', get: (e) => e.customerName },
  { key: 'cfu', label: 'CFU', get: (e) => e.cfu },
  { key: 'component', label: 'Component', get: (e) => compLabel(e.component) },
  { key: 'size', label: 'Size', get: (e) => e.size },
  { key: 'approver', label: 'Approver', get: (e) => e.approver },
  { key: 'status', label: 'Status', get: (e) => STATUS_LABEL[e.status] || e.status },
  { key: 'lineCount', label: 'Lines', get: (e) => String(e.lineCount ?? 0) },
  { key: 'totalPd', label: 'Total PD', get: (e) => String(e.totalPd ?? 0) },
  { key: 'grandTotalCost', label: 'Total Cost', get: (e) => money(e.grandTotalCost ?? 0) },
];

// Columns for the bulk export (PD/USP intentionally excluded for now). Separate from LIST_COLUMNS
// so the on-screen table and the export can diverge. `raw` yields export-friendly values.
const EXPORT_COLUMNS = [
  { label: 'JIRA Reference', raw: (e) => e.jiraReference ?? '' },
  { label: 'Summary', raw: (e) => e.summary ?? '' },
  { label: 'Customer', raw: (e) => e.customerName ?? '' },
  { label: 'CFU', raw: (e) => e.cfu ?? '' },
  { label: 'Component', raw: (e) => compLabel(e.component) },
  { label: 'Size', raw: (e) => e.size ?? '' },
  { label: 'Approver', raw: (e) => e.approver ?? '' },
  { label: 'Status', raw: (e) => STATUS_LABEL[e.status] || e.status },
  { label: 'TCS Cost (GBP)', raw: (e) => Number(e.tcsCost ?? 0).toFixed(2) },
  { label: 'FTE Cost (GBP)', raw: (e) => Number(e.fteCost ?? 0).toFixed(2) },
  { label: 'Total Cost (GBP)', raw: (e) => Number(e.grandTotalCost ?? 0).toFixed(2) },
];

let allRequests = []; // cache of the full list for client-side search/filter
let listPage = 1;     // current page (client-side pagination)
const LIST_PAGE_SIZE = 10;

async function renderList(view) {
  view.innerHTML = `
    <div class="est-list-head">
      <h1>Requests</h1>
      <div class="est-list-head-actions">
        <div class="actions-menu" id="exp-menu">
          <button type="button" class="btn-ghost actions-toggle" id="exp-toggle"
                  aria-haspopup="true" aria-expanded="false" aria-controls="exp-list">
            Export <span class="actions-caret" aria-hidden="true">▾</span>
          </button>
          <div class="actions-list" id="exp-list" role="menu" aria-label="Export requests" hidden>
            <button type="button" role="menuitem" id="exp-pdf">PDF</button>
            <button type="button" role="menuitem" id="exp-csv">CSV</button>
            <button type="button" role="menuitem" id="exp-json">JSON</button>
          </div>
        </div>
        <button type="button" class="btn-primary" id="est-new">Add Request</button>
      </div>
    </div>
    <div class="card" style="margin-top: var(--space-4);">
      <div class="est-search">
        <input id="f-search" type="search" placeholder="Search all columns — JIRA, summary, customer, CFU, component, approver, status…" aria-label="Search requests" />
        <label class="est-date-filter" title="Created on or after"><span>From</span><input id="f-from" type="date" aria-label="Created from (YYYY-MM-DD)" title="Format: YYYY-MM-DD" /></label>
        <label class="est-date-filter" title="Created on or before"><span>To</span><input id="f-to" type="date" aria-label="Created to (YYYY-MM-DD)" title="Format: YYYY-MM-DD" /></label>
        <label class="est-archived-toggle" title="Show archived requests instead of active ones">
          <input id="f-archived" type="checkbox" /> <span>Show archived</span>
        </label>
        <button type="button" class="btn-ghost" id="f-clear" title="Clear search &amp; filters">Clear</button>
      </div>
    </div>
    <div id="est-results" style="margin-top: var(--space-5);">Loading…</div>
  `;

  view.querySelector('#est-new').addEventListener('click', () => openNewRequestDialog(view));

  // Export menu (CSV / PDF) — exports the CURRENT filtered selection (whole set, not just the page).
  wireMenu(view.querySelector('#exp-menu'), view.querySelector('#exp-toggle'), view.querySelector('#exp-list'));
  view.querySelector('#exp-pdf').addEventListener('click', () => exportRequests(view, 'pdf'));
  view.querySelector('#exp-csv').addEventListener('click', () => exportRequests(view, 'csv'));
  view.querySelector('#exp-json').addEventListener('click', () => exportRequests(view, 'json'));

  const deb = debounce(() => { listPage = 1; applyListFilters(view); }, 120);
  view.querySelector('#f-search').addEventListener('input', deb);
  view.querySelector('#f-from').addEventListener('change', () => { listPage = 1; applyListFilters(view); });
  view.querySelector('#f-to').addEventListener('change', () => { listPage = 1; applyListFilters(view); });
  // The archived toggle changes the server query (archived rows aren't in the default set).
  view.querySelector('#f-archived').addEventListener('change', () => loadList(view));
  view.querySelector('#f-clear').addEventListener('click', () => {
    view.querySelector('#f-search').value = '';
    view.querySelector('#f-from').value = '';
    view.querySelector('#f-to').value = '';
    view.querySelectorAll('.col-filter').forEach((i) => { i.value = ''; });
    listPage = 1;
    applyListFilters(view);
  });

  await loadList(view);
}

async function loadList(view) {
  const el = view.querySelector('#est-results');
  const showArchived = view.querySelector('#f-archived')?.checked;
  if (el) { el.setAttribute('aria-busy', 'true'); el.innerHTML = '<p class="muted">Loading…</p>'; }
  try {
    // Archived requests are excluded from the default list by the server; request them explicitly.
    const data = await api.get(`/api/estimates${showArchived ? '?status=ARCHIVED' : ''}`);
    allRequests = data.items || [];
    // Newest first so "latest 10" is meaningful (falls back to stable order if no createdAt).
    allRequests.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    if (!allRequests.length) {
      el.innerHTML = showArchived
        ? '<p class="muted">No archived requests.</p>'
        : '<p class="muted">No requests yet. Click “Add Request” to create one.</p>';
      return;
    }
    renderListTable(view);
  } catch (e) {
    el.innerHTML = `<p class="form-error">Could not load requests: ${esc(e.message)}</p>`;
  } finally {
    if (el) el.removeAttribute('aria-busy');
  }
}

/** Build the table shell once (headers + a per-column filter row), then populate the body. */
function renderListTable(view) {
  const el = view.querySelector('#est-results');
  el.innerHTML = `
    <div class="table-pager" id="est-pager">
      <span class="table-pager-range muted" id="est-range"></span>
      <span class="table-pager-controls">
        <button type="button" class="btn-ghost" id="est-prev" aria-label="Previous page">‹ Prev</button>
        <button type="button" class="btn-ghost" id="est-next" aria-label="Next page">Next ›</button>
      </span>
    </div>
    <table class="data-table est-list-table">
      <thead>
        <tr>${LIST_COLUMNS.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr>
        <tr class="col-filter-row">
          ${LIST_COLUMNS.map((c) => `<th><input class="col-filter" data-key="${c.key}" type="text" placeholder="Filter" aria-label="Filter by ${esc(c.label)}" /></th>`).join('')}
          <th></th>
        </tr>
      </thead>
      <tbody id="est-tbody"></tbody>
    </table>`;

  // Filters reset to page 1 and re-render.
  const deb = debounce(() => { listPage = 1; applyListFilters(view); }, 120);
  el.querySelectorAll('.col-filter').forEach((i) => i.addEventListener('input', deb));
  el.querySelector('#est-prev').addEventListener('click', () => { if (listPage > 1) { listPage -= 1; applyListFilters(view); } });
  el.querySelector('#est-next').addEventListener('click', () => { listPage += 1; applyListFilters(view); });

  listPage = 1;
  applyListFilters(view);
}

/** The current filtered set (search + per-column filters) over the loaded requests — the single
 *  source of truth shared by the table render and the bulk export. */
function filteredRequests(view) {
  const search = (view.querySelector('#f-search')?.value || '').trim().toLowerCase();
  const from = view.querySelector('#f-from')?.value || ''; // 'YYYY-MM-DD'
  const to = view.querySelector('#f-to')?.value || '';
  const colFilters = {};
  view.querySelectorAll('.col-filter').forEach((i) => {
    const v = i.value.trim().toLowerCase();
    if (v) colFilters[i.getAttribute('data-key')] = v;
  });
  return allRequests.filter((e) => {
    // Created-date range (inclusive), compared on the YYYY-MM-DD portion of created_at.
    if (from || to) {
      const day = String(e.createdAt || '').slice(0, 10);
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    if (search) {
      const haystack = LIST_COLUMNS.map((c) => String(c.get(e) ?? '')).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    for (const c of LIST_COLUMNS) {
      const f = colFilters[c.key];
      if (f && !String(c.get(e) ?? '').toLowerCase().includes(f)) return false;
    }
    return true;
  });
}

/** Bulk-export the current filtered selection as CSV or PDF. */
async function exportRequests(view, format) {
  const rows = filteredRequests(view);
  if (!rows.length) { alert('No requests match the current filters to export.'); return; }
  const archived = view.querySelector('#f-archived')?.checked;
  const scope = archived ? 'archived' : 'active';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mdp-requests-${scope}-${stamp}`;

  if (format === 'json') {
    // Import-friendly shape: meaningful request fields with stable names, NO internal MDP-XXXX
    // ref or DB ids (those must not travel for a future re-import). Wrapped in a small envelope
    // so an importer can version-check + validate. NOTE: the import pipeline itself is a separate,
    // not-yet-built feature (tracked in SPEC-tasks) — this is the on-the-wire format for it.
    const records = rows.map((e) => ({
      jiraReference: e.jiraReference ?? '',
      summary: e.summary ?? '',
      customerName: e.customerName ?? '',
      cfu: e.cfu ?? '',
      component: e.component ?? '',
      size: e.size ?? '',
      approver: e.approver ?? '',
      status: e.status ?? '',
      externalRef: e.externalRef ?? null,
      ipCode: e.ipCode ?? null,
      ioReference: e.ioReference ?? null,
      remarks: e.remarks ?? null,
      createdAt: e.createdAt ?? null,
      // Figures are informational for the export; an importer would recompute from lines.
      lineCount: e.lineCount ?? 0,
      tcsCost: Number(e.tcsCost ?? 0),
      fteCost: Number(e.fteCost ?? 0),
      totalCost: Number(e.grandTotalCost ?? 0),
    }));
    const payload = {
      type: 'mdp.requests',
      version: 1,
      exportedAt: new Date().toISOString(),
      scope,
      count: records.length,
      requests: records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${filename}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  if (format === 'csv') {
    const esc2 = (v) => {
      const s = String(v ?? '');
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = EXPORT_COLUMNS.map((c) => esc2(c.label)).join(',');
    const lines = rows.map((e) => EXPORT_COLUMNS.map((c) => esc2(c.raw(e))).join(','));
    // Prepend a BOM so Excel reads UTF-8 (£ etc.) correctly.
    const csv = '\uFEFF' + [header, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${filename}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  // PDF — a landscape summary table via the shared pdf-export helper.
  try {
    await exportRequestsTablePdf({
      title: `MDP Requests — ${scope} (${rows.length})`,
      columns: EXPORT_COLUMNS.map((c) => c.label),
      rows: rows.map((e) => EXPORT_COLUMNS.map((c) => c.raw(e))),
      filename: `${filename}.pdf`,
    });
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Could not generate the PDF.');
  }
}

function applyListFilters(view) {
  const tbody = view.querySelector('#est-tbody');
  if (!tbody) return;

  const rows = filteredRequests(view);

  // Clamp the page to the available range, then slice to the current page (10 per page).
  const totalPages = Math.max(1, Math.ceil(rows.length / LIST_PAGE_SIZE));
  if (listPage > totalPages) listPage = totalPages;
  if (listPage < 1) listPage = 1;
  const start = (listPage - 1) * LIST_PAGE_SIZE;
  const pageRows = rows.slice(start, start + LIST_PAGE_SIZE);

  tbody.innerHTML = pageRows.map((e) => `
    <tr data-id="${e.id}" style="cursor:pointer;">
      <td><strong>${esc(e.jiraReference)}</strong></td>
      <td>${esc(e.summary)}</td>
      <td>${esc(e.customerName)}</td>
      <td>${esc(e.cfu)}</td>
      <td>${esc(compLabel(e.component))}</td>
      <td><span class="badge">${esc(e.size)}</span></td>
      <td>${esc(e.approver)}</td>
      <td><span class="badge status-${esc(e.status)}">${esc(STATUS_LABEL[e.status] || e.status)}</span></td>
      <td>${num(e.lineCount)}</td>
      <td>${num(e.totalPd ?? 0)}</td>
      <td class="num-cell"><strong>${money(e.grandTotalCost ?? 0)}</strong></td>
      <td><a class="btn-ghost" href="#/estimates/${e.id}">Open</a></td>
    </tr>`).join('');

  // Range indicator + pager buttons.
  const rangeEl = view.querySelector('#est-range');
  if (rangeEl) {
    rangeEl.textContent = rows.length
      ? `${start + 1}–${start + pageRows.length} of ${rows.length} request${rows.length === 1 ? '' : 's'}`
      : '0 requests';
  }
  const prev = view.querySelector('#est-prev');
  const next = view.querySelector('#est-next');
  if (prev) prev.disabled = listPage <= 1;
  if (next) next.disabled = listPage >= totalPages;

  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      window.location.hash = `#/estimates/${row.getAttribute('data-id')}`;
    });
  });
}

// ---- Add Request dialog ----

function openNewRequestDialog(view) {
  const host = document.createElement('div');
  host.className = 'est-modal-backdrop';
  host.innerHTML = `
    <div class="card est-modal est-modal-wide" role="dialog" aria-modal="true" aria-labelledby="est-modal-title">
      <h2 id="est-modal-title" style="margin-top:0;">Add Request</h2>
      <p class="muted" style="margin-top:0;">The request pins the current active Menu Card. Component &amp; Size scope which services you can add.</p>
      <div class="est-form-grid">
        <div class="field"><span>JIRA Reference *</span><input id="n-jira" type="text" placeholder="e.g. ARCH-1234" /></div>
        <div class="field"><span>Summary / Title *</span><input id="n-summary" type="text" placeholder="e.g. Q3 MQ uplift" /></div>
        <div class="field"><span>Customer *</span><input id="n-customer" type="text" placeholder="Customer name" /></div>
        <div class="field"><span>CFU *</span><select id="n-cfu"><option value="">Select…</option>${selectOptions(CFU_OPTIONS)}</select></div>
        <div class="field"><span>Approver *</span><input id="n-approver" type="text" placeholder="Approver name" /></div>
        <div class="field"><span>Component *</span><select id="n-component"><option value="">Select…</option>${componentSelectOptions()}</select></div>
        <div class="field"><span>Size *</span><select id="n-size"><option value="">Select…</option>${selectOptions(SIZE_OPTIONS)}</select></div>
        <div class="field"><span>External Ref</span><input id="n-external" type="text" /></div>
        <div class="field"><span>IP Code</span><input id="n-ip" type="text" /></div>
        <div class="field"><span>IO Reference</span><input id="n-io" type="text" /></div>
        <div class="field est-form-full"><span>Remarks</span><textarea id="n-remarks" rows="2"></textarea></div>
      </div>
      <div id="n-error" class="form-error" style="display:none;"></div>
      <div class="est-modal-actions">
        <button type="button" class="btn-ghost" id="n-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="n-create">Create</button>
      </div>
    </div>`;
  view.appendChild(host);

  const close = () => host.remove();
  host.querySelector('#n-cancel').addEventListener('click', close);
  host.addEventListener('click', (e) => { if (e.target === host) close(); });

  host.querySelector('#n-create').addEventListener('click', async () => {
    const errEl = host.querySelector('#n-error');
    errEl.style.display = 'none';
    // clear any previous highlights
    host.querySelectorAll('.field-invalid').forEach((el) => el.classList.remove('field-invalid'));
    const val = (id) => host.querySelector(id).value.trim();
    const body = {
      jiraReference: val('#n-jira'),
      summary: val('#n-summary'),
      customerName: val('#n-customer'),
      cfu: val('#n-cfu'),
      approver: val('#n-approver'),
      component: val('#n-component'),
      size: val('#n-size'),
      externalRef: val('#n-external') || undefined,
      ipCode: val('#n-ip') || undefined,
      ioReference: val('#n-io') || undefined,
      remarks: val('#n-remarks') || undefined,
    };
    const required = [
      ['jiraReference', '#n-jira', 'JIRA Reference'],
      ['summary', '#n-summary', 'Summary / Title'],
      ['customerName', '#n-customer', 'Customer'],
      ['cfu', '#n-cfu', 'CFU'],
      ['approver', '#n-approver', 'Approver'],
      ['component', '#n-component', 'Component'],
      ['size', '#n-size', 'Size'],
    ];
    const missing = [];
    for (const [key, sel, label] of required) {
      if (!body[key]) {
        missing.push(label);
        host.querySelector(sel).classList.add('field-invalid');
      }
    }
    if (missing.length) {
      errEl.textContent = (missing.length === 1 ? 'Please complete: ' : 'Please complete these fields: ') + missing.join(', ') + '.';
      errEl.style.display = 'block';
      host.querySelector(required.find(([k]) => !body[k])[1]).focus();
      return;
    }
    try {
      const created = await api.post('/api/estimates', body);
      close();
      window.location.hash = `#/estimates/${created.id}`;
    } catch (e) {
      errEl.textContent = e instanceof ApiError ? e.message : 'Could not create the request.';
      errEl.style.display = 'block';
    }
  });
}

// ============================================================
// Builder (single request)
// ============================================================

let current = null; // last-loaded request object (for rowVersion)

async function renderBuilder(view, id) {
  view.innerHTML = `<p><a href="#/estimates">← All requests</a></p><div id="est-builder">Loading…</div>`;
  await loadBuilder(view, id);
}

async function loadBuilder(view, id) {
  const host = view.querySelector('#est-builder');
  try {
    current = await api.get(`/api/estimates/${id}`);
  } catch (e) {
    host.innerHTML = `<p class="form-error">Could not load request: ${esc(e.message)}</p>`;
    return;
  }
  const e = current;
  const t = e.totals;

  host.innerHTML = `
    <div class="est-head">
      <div>
        <h1 style="margin-bottom:0;">${esc(e.jiraReference)} <span class="badge status-${esc(e.status)}">${esc(STATUS_LABEL[e.status] || e.status)}</span></h1>
        <p class="muted" style="margin-top:var(--space-1);">${esc(e.summary)} — ${esc(e.customerName)}</p>
        <p class="muted" style="margin-top:0;">
          ${esc(e.cfu)} · ${esc(compLabel(e.component))} / ${esc(e.size)} · Approver: ${esc(e.approver)}
        </p>
      </div>
      <div class="est-head-actions">
        <div class="actions-menu status-menu" id="est-status-menu">
          <button type="button" class="btn-primary actions-toggle" id="est-status-toggle"
                  aria-haspopup="true" aria-expanded="false" aria-controls="est-status-list"
                  ${e.status === 'ARCHIVED' ? 'disabled title="Un-archive this request to change its status"' : ''}>
            <span class="status-toggle-label">Status: ${esc(STATUS_LABEL[e.status] || e.status)}</span>
            <span class="actions-caret" aria-hidden="true">▾</span>
          </button>
          <div class="actions-list" id="est-status-list" role="menu" aria-label="Set status" hidden>
            ${statusOptionsFor(e.status).map((s) => {
              const cls = [s === e.status ? 'is-current' : '', s === 'CANCELLED' ? 'status-opt-cancel' : ''].filter(Boolean).join(' ');
              return `<button type="button" role="menuitemradio" aria-checked="${s === e.status}" data-status="${s}"${cls ? ` class="${cls}"` : ''}>${esc(STATUS_LABEL[s])}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="actions-menu" id="est-actions">
          <button type="button" class="btn-primary actions-toggle" id="est-actions-toggle"
                  aria-haspopup="true" aria-expanded="false" aria-controls="est-actions-list">
            Actions <span class="actions-caret" aria-hidden="true">▾</span>
          </button>
          <div class="actions-list" id="est-actions-list" role="menu" aria-label="Request actions" hidden>
            <button type="button" role="menuitem" id="est-preview">Preview</button>
            <button type="button" role="menuitem" id="est-export">Export</button>
            <button type="button" role="menuitem" id="est-clone">Clone</button>
            ${e.status === 'ARCHIVED'
              ? '<button type="button" role="menuitem" id="est-unarchive">Un-archive</button>'
              : '<button type="button" role="menuitem" id="est-archive">Archive</button>'}
            <button type="button" role="menuitem" id="est-edit">Edit</button>
            <div class="actions-divider" role="separator"></div>
            <button type="button" role="menuitem" class="danger" id="est-delete">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <div class="est-meta card">
      ${metaCell('External Ref', e.externalRef)}
      ${metaCell('IP Code', e.ipCode)}
      ${metaCell('IO Reference', e.ioReference)}
      ${metaCell('Remarks', e.remarks)}
    </div>

    <div class="totals-strip card">
      ${totalCell('Lines', num(t.lineCount))}
      ${totalCell('Total PD', num(t.totalPd))}
      ${totalCell('Story Points', num(t.totalUsp))}
      ${totalCell('ATOM', num(t.totalAtom))}
      ${totalCell('TCS Cost', money(t.totalUspCost))}
      ${totalCell('FTE Cost', money(t.totalOverheadCost))}
      ${totalCell('Grand Total', money(t.grandTotalCost), true)}
    </div>

    <div class="est-lines-head">
      <h2>Line items <span class="muted" style="font-weight:400;">(${esc(compLabel(e.component))} / ${esc(e.size)})</span></h2>
      <button type="button" class="btn-primary" id="line-add">Add from catalogue</button>
    </div>
    <div id="est-lines"></div>
    <div id="est-picker"></div>
  `;

  renderLines(view);

  // ---- Status dropdown (custom, matches the Actions menu) ----
  wireMenu(host.querySelector('#est-status-menu'), host.querySelector('#est-status-toggle'), host.querySelector('#est-status-list'));
  host.querySelectorAll('#est-status-list [data-status]').forEach((item) => {
    item.addEventListener('click', async () => {
      const to = item.getAttribute('data-status');
      if (to === e.status) return;
      try {
        current = await api.post(`/api/estimates/${id}/status`, { status: to, rowVersion: e.rowVersion });
        announce(`Status changed to ${STATUS_LABEL[to] || to}.`);
        await loadBuilder(view, id);
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Could not change status');
      }
    });
  });

  // ---- Actions menu ----
  wireMenu(host.querySelector('#est-actions'), host.querySelector('#est-actions-toggle'), host.querySelector('#est-actions-list'));

  host.querySelector('#est-edit').addEventListener('click', () => openEditDialog(view, id));
  host.querySelector('#est-delete').addEventListener('click', () => confirmDelete(view, id));

  // Preview PDF — generate + open in a new tab; NOT recorded (per design §6).
  host.querySelector('#est-preview').addEventListener('click', async (ev) => {
    const btn = ev.target;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      await previewRequestPdf(current);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not generate the PDF preview');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });

  // Export PDF — generate + deliver (download/share), then record the export server-side
  // (GeneratedDocument + ESTIMATE_EXPORT audit). The record is best-effort: a delivered file
  // shouldn't be reported as failed just because the audit write hiccuped.
  host.querySelector('#est-export').addEventListener('click', async (ev) => {
    const btn = ev.target;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Generating…';
    try {
      const result = await exportRequestPdf(current);
      if (result.delivered === 'cancelled') return; // user dismissed the share sheet
      try {
        await api.post(`/api/estimates/${id}/export`, { fileName: result.filename, sizeBytes: result.sizeBytes });
      } catch {
        // file already delivered to the user; the export record is secondary
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not generate the PDF');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });

  // Clone — deep-copies the request (new refs, lines included) and opens the copy so the
  // user can rename its "-COPY" JIRA reference.
  host.querySelector('#est-clone').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      const clone = await api.post(`/api/estimates/${id}/clone`, {});
      window.location.hash = `#/estimates/${clone.id}`;
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not clone the request');
      ev.target.disabled = false;
    }
  });

  // Archive / Un-archive — archiving is just a status change to ARCHIVED (any-to-any workflow);
  // un-archiving restores it to NEW. Both go through the normal status endpoint.
  const archiveBtn = host.querySelector('#est-archive');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      if (!window.confirm(`Archive request ${e.jiraReference}? It will be hidden from the default list (find it via “Show archived”).`)) return;
      try {
        await api.post(`/api/estimates/${id}/status`, { status: 'ARCHIVED', rowVersion: e.rowVersion });
        window.location.hash = '#/estimates';
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Could not archive the request');
      }
    });
  }
  const unarchiveBtn = host.querySelector('#est-unarchive');
  if (unarchiveBtn) {
    unarchiveBtn.addEventListener('click', async () => {
      try {
        current = await api.post(`/api/estimates/${id}/status`, { status: 'NEW', rowVersion: e.rowVersion });
        await loadBuilder(view, id);
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Could not un-archive the request');
      }
    });
  }

  const addBtn = host.querySelector('#line-add');
  if (addBtn) addBtn.addEventListener('click', () => openPicker(view, id));
}

function metaCell(label, value) {
  const v = value && String(value).trim() ? esc(value) : '<span class="muted">—</span>';
  return `<div class="meta-cell"><span class="meta-label">${esc(label)}</span><span class="meta-value">${v}</span></div>`;
}
function totalCell(label, value, strong) {
  return `<div class="total-cell"><span class="total-label">${esc(label)}</span><span class="total-value${strong ? ' grand' : ''}">${value}</span></div>`;
}

function renderLines(view) {
  const el = view.querySelector('#est-lines');
  const e = current;
  if (!e.lines.length) {
    el.innerHTML = '<p class="muted">No lines yet. Add services from the catalogue (scoped to this request’s Component &amp; Size).</p>';
    return;
  }
  el.innerHTML = `
    <table class="data-table est-lines-table">
      <thead>
        <tr>
          <th>Component</th><th>Size</th><th>Service</th><th>Qty</th>
          <th>PD</th><th>Story Pts</th><th>TCS Cost</th><th>FTE Cost</th><th>Line Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${e.lines.map((l) => {
          const c = l.computed;
          return `
          <tr data-line="${l.id}">
            <td>${esc(compLabel(l.component))}</td>
            <td><span class="badge">${esc(l.size)}</span></td>
            <td>${esc(firstLine(l.description))}</td>
            <td><input class="qty-input" type="number" min="0.25" step="0.25" value="${esc(l.quantity)}" data-line="${l.id}" aria-label="Quantity" /></td>
            <td>${num(c.linePd)}</td>
            <td>${num(c.lineUsp)}</td>
            <td>${money(c.lineUspCost)}</td>
            <td>${money(c.lineOverheadCost)}</td>
            <td><strong>${money(c.lineTotalCost)}</strong></td>
            <td class="line-actions">
              <button type="button" class="btn-ghost" data-dup="${l.id}" title="Duplicate line" aria-label="Duplicate line ${esc(firstLine(l.description))}"><span aria-hidden="true">⧉</span></button>
              <button type="button" class="btn-ghost danger" data-del="${l.id}" title="Delete line" aria-label="Delete line ${esc(firstLine(l.description))}"><span aria-hidden="true">✕</span></button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  el.querySelectorAll('.qty-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const lineId = input.getAttribute('data-line');
      const q = Number(input.value);
      if (!Number.isFinite(q) || q <= 0) { input.value = '1'; return; }
      try {
        current = await api.patch(`/api/estimates/${e.id}/lines/${lineId}`, { quantity: q, rowVersion: current.rowVersion });
        refreshBuilder(view);
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Could not update line');
        refreshBuilder(view);
      }
    });
  });
  el.querySelectorAll('[data-dup]').forEach((b) => b.addEventListener('click', async () => {
    try {
      current = await api.post(`/api/estimates/${e.id}/lines/${b.getAttribute('data-dup')}/duplicate`, { rowVersion: current.rowVersion });
      announce('Line duplicated.');
      refreshBuilder(view);
    } catch (err) { alert(err instanceof ApiError ? err.message : 'Could not duplicate line'); }
  }));
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try {
      current = await api.del(`/api/estimates/${e.id}/lines/${b.getAttribute('data-del')}`);
      announce('Line deleted.');
      refreshBuilder(view);
    } catch (err) { alert(err instanceof ApiError ? err.message : 'Could not delete line'); }
  }));
}

/** Re-render totals strip + lines from `current` without a full reload (keeps scroll). */
function refreshBuilder(view) {
  const e = current;
  const t = e.totals;
  const strip = view.querySelector('.totals-strip');
  if (strip) {
    strip.innerHTML =
      totalCell('Lines', num(t.lineCount)) +
      totalCell('Total PD', num(t.totalPd)) +
      totalCell('Story Points', num(t.totalUsp)) +
      totalCell('ATOM', num(t.totalAtom)) +
      totalCell('TCS Cost', money(t.totalUspCost)) +
      totalCell('FTE Cost', money(t.totalOverheadCost)) +
      totalCell('Grand Total', money(t.grandTotalCost), true);
  }
  renderLines(view);
}

// ---- add-from-catalogue picker (scoped to this request's Component + Size) ----

async function openPicker(view, id) {
  const panel = view.querySelector('#est-picker');
  panel.innerHTML = '<div class="card" style="margin-top:var(--space-5);">Loading catalogue…</div>';
  let data;
  try {
    data = await api.get(`/api/estimates/${id}/catalogue`);
  } catch (e) {
    panel.innerHTML = `<div class="card"><p class="form-error">Could not load catalogue: ${esc(e.message)}</p></div>`;
    return;
  }
  const items = data.items || [];
  panel.innerHTML = `
    <div class="card est-picker" style="margin-top:var(--space-5);">
      <div class="est-picker-head">
        <h2 style="margin:0;">Add a service — ${esc(compLabel(data.component))} / ${esc(data.size)}</h2>
        <input id="pick-q" type="text" placeholder="Search services…" />
        <button type="button" class="btn-ghost" id="pick-close">Close</button>
      </div>
      <div id="pick-results"></div>
    </div>`;
  const resultsEl = panel.querySelector('#pick-results');

  if (!items.length) {
    resultsEl.innerHTML = `<p class="muted">No active catalogue services for ${esc(compLabel(data.component))} / ${esc(data.size)}.</p>`;
  }

  const draw = (filter) => {
    const f = (filter || '').toLowerCase();
    const shown = items.filter((v) => !f || firstLine(v.description).toLowerCase().includes(f));
    if (!shown.length) { resultsEl.innerHTML = '<p class="muted">No services match.</p>'; return; }
    resultsEl.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Service</th><th>PD</th><th>Line Total</th><th></th></tr></thead>
        <tbody>
          ${shown.map((v) => `
            <tr>
              <td>${esc(firstLine(v.description))}</td>
              <td>${num(v.pd)}</td>
              <td>${money(v.totalCost)}</td>
              <td><button type="button" class="btn-ghost" data-add="${v.id}">Add</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    resultsEl.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        current = await api.post(`/api/estimates/${id}/lines`, { serviceVariantId: b.getAttribute('data-add'), quantity: 1, rowVersion: current.rowVersion });
        announce('Line added to the request.');
        refreshBuilder(view);
      } catch (err) {
        alert(err instanceof ApiError ? err.message : 'Could not add line');
        b.disabled = false;
      }
    }));
  };
  if (items.length) draw('');
  const q = panel.querySelector('#pick-q');
  const deb = debounce(() => draw(q.value.trim()), 150);
  q.addEventListener('input', deb);
  panel.querySelector('#pick-close').addEventListener('click', () => { panel.innerHTML = ''; });
}

// ---- edit header dialog ----

function openEditDialog(view, id) {
  const e = current;
  const hasLines = (e.lines || []).length > 0;
  const host = document.createElement('div');
  host.className = 'est-modal-backdrop';
  host.innerHTML = `
    <div class="card est-modal est-modal-wide" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <h2 id="edit-title" style="margin-top:0;">Edit details</h2>
      ${hasLines ? '<p class="muted" style="margin-top:0;">Component &amp; Size are locked while line items exist (remove lines to change them).</p>' : ''}
      <div class="est-form-grid">
        <div class="field"><span>JIRA Reference *</span><input id="e-jira" type="text" value="${esc(e.jiraReference)}" /></div>
        <div class="field"><span>Summary / Title *</span><input id="e-summary" type="text" value="${esc(e.summary)}" /></div>
        <div class="field"><span>Customer *</span><input id="e-customer" type="text" value="${esc(e.customerName)}" /></div>
        <div class="field"><span>CFU *</span><select id="e-cfu">${selectOptions(CFU_OPTIONS, e.cfu)}</select></div>
        <div class="field"><span>Approver *</span><input id="e-approver" type="text" value="${esc(e.approver)}" /></div>
        <div class="field"><span>Component *</span><select id="e-component"${hasLines ? ' disabled' : ''}>${componentSelectOptions(e.component)}</select></div>
        <div class="field"><span>Size *</span><select id="e-size"${hasLines ? ' disabled' : ''}>${selectOptions(SIZE_OPTIONS, e.size)}</select></div>
        <div class="field"><span>External Ref</span><input id="e-external" type="text" value="${esc(e.externalRef || '')}" /></div>
        <div class="field"><span>IP Code</span><input id="e-ip" type="text" value="${esc(e.ipCode || '')}" /></div>
        <div class="field"><span>IO Reference</span><input id="e-io" type="text" value="${esc(e.ioReference || '')}" /></div>
        <div class="field est-form-full"><span>Remarks</span><textarea id="e-remarks" rows="2">${esc(e.remarks || '')}</textarea></div>
      </div>
      <div id="e-error" class="form-error" style="display:none;"></div>
      <div class="est-modal-actions">
        <button type="button" class="btn-ghost" id="e-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="e-save">Save</button>
      </div>
    </div>`;
  view.appendChild(host);
  const close = () => host.remove();
  host.querySelector('#e-cancel').addEventListener('click', close);
  host.addEventListener('click', (ev) => { if (ev.target === host) close(); });
  host.querySelector('#e-save').addEventListener('click', async () => {
    const errEl = host.querySelector('#e-error');
    errEl.style.display = 'none';
    const val = (sel) => host.querySelector(sel).value.trim();
    const patch = {
      jiraReference: val('#e-jira'),
      summary: val('#e-summary'),
      customerName: val('#e-customer'),
      cfu: val('#e-cfu'),
      approver: val('#e-approver'),
      externalRef: val('#e-external'),
      ipCode: val('#e-ip'),
      ioReference: val('#e-io'),
      remarks: val('#e-remarks'),
      rowVersion: e.rowVersion,
    };
    // Only send Component/Size when editable (avoid a needless no-op that could trip the guard).
    if (!hasLines) {
      patch.component = val('#e-component');
      patch.size = val('#e-size');
    }
    try {
      current = await api.patch(`/api/estimates/${id}`, patch);
      close();
      await loadBuilder(view, id);
    } catch (err) {
      errEl.textContent = err instanceof ApiError ? err.message : 'Could not save.';
      errEl.style.display = 'block';
    }
  });
}

function confirmDelete(view, id) {
  const e = current;
  if (!window.confirm(`Delete request ${e.jiraReference}? This cannot be undone.`)) return;
  api.del(`/api/estimates/${id}`)
    .then(() => { window.location.hash = '#/estimates'; })
    .catch((err) => alert(err instanceof ApiError ? err.message : 'Could not delete'));
}

// ---- util ----

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Announce to screen readers via the app's polite live region (set up in app.js). No-op if absent. */
function announce(msg) {
  if (typeof window.mdpAnnounce === 'function') window.mdpAnnounce(msg);
}

/**
 * Wire a toggle + dropdown list into an open/close menu (used by both the Status and Actions
 * dropdowns so they behave identically): toggles on the button, closes on outside-click,
 * Escape, or after any menu item is activated. Focuses the first item on open for keyboard use.
 */
function wireMenu(wrap, toggle, list) {
  if (!wrap || !toggle || !list) return;
  const onDocClick = (ev) => { if (!wrap.contains(ev.target)) close(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { close(); toggle.focus(); } };
  function open() {
    list.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    const first = list.querySelector('[role^="menuitem"]');
    if (first) first.focus();
  }
  function close() {
    list.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  }
  toggle.addEventListener('click', () => { if (list.hidden) open(); else close(); });
  list.querySelectorAll('[role^="menuitem"]').forEach((item) => {
    item.addEventListener('click', () => close());
  });
}
