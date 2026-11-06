/** Menu Cards admin view — upload/import an .xlsx OR create on screen; list, activate, archive. */
import { api, ApiError } from '../api.js';
import { trapFocus } from './modal-util.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

const COMPONENTS = [['CFT', 'CFT'], ['MQ', 'MQ'], ['WildFly', 'WILDFLY'], ['WLS', 'WLS']];
const SIZES = ['TO', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];

/**
 * Client-side mirror of server/menucard-calc.js (integer-pence, no float drift). Used for the LIVE
 * preview in the create form. The server recomputes authoritatively on save from the same formulas,
 * but we send the (possibly admin-overridden) six values and the server stores them verbatim.
 */
function computeVariant(pd, blendedUspRate, overheadPct) {
  const pdN = Number(pd) || 0;
  const rateP = Math.round((Number(blendedUspRate) || 0) * 100);
  const ovPct = Number(overheadPct) || 0;
  const usp = Math.round(pdN * 2 * 10000) / 10000;
  const atom = Math.round(pdN * 1 * 10000) / 10000;
  const uspCostP = Math.round(usp * rateP);
  const overheadP = Math.round(uspCostP * ovPct / 100);
  const totalP = uspCostP + overheadP;
  return {
    pd: Math.round(pdN * 10000) / 10000, usp, atom,
    uspCost: Math.round(uspCostP) / 100,
    overheadCost: Math.round(overheadP) / 100,
    totalCost: Math.round(totalP) / 100,
  };
}

function statusBadge(status) {
  const cls = status === 'ACTIVE' ? 'ok' : status === 'DRAFT' ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

export async function renderMenuCards(view) {
  view.innerHTML = `
    <h1>Menu Cards</h1>
    <p class="muted">Create a Menu Card on screen, or upload an approved workbook (.xlsx) — review,
      then activate. Exactly one version is active at a time.</p>

    <div class="mc-top-grid">
      <div class="card mc-top-card">
        <div class="mc-card-body">
          <h2 style="margin-top:0;">Create</h2>
          <p class="muted">No spreadsheet needed — set the year's rates, add service rows (costs
            calculate from PD automatically, each value still editable), and save as a
            <strong>DRAFT</strong> you then activate.</p>
        </div>
        <div class="mc-card-actions">
          <button type="button" class="btn-primary" id="mc-create-toggle">Create</button>
        </div>
      </div>

      <div class="mc-or" aria-hidden="true">OR</div>

      <div class="card mc-top-card">
        <form id="mc-form" class="mc-card-form">
          <div class="mc-card-body">
            <h2 style="margin-top:0;">Import</h2>
            <div class="mc-import-fields">
              <label class="field">
                <span>Workbook (.xlsx)</span>
                <input id="mc-file" type="file" accept=".xlsx" required />
              </label>
              <label class="field">
                <span>Financial year (optional)</span>
                <input id="mc-fy" type="text" placeholder="FY27" />
              </label>
            </div>
            <div id="mc-error" class="form-error" role="alert" hidden></div>
          </div>
          <div class="mc-card-actions">
            <button class="btn-primary" type="submit" id="mc-submit">Upload &amp; Parse</button>
          </div>
        </form>
        <div id="mc-summary"></div>
      </div>
    </div>

    <div style="margin-top: var(--space-6);">
      <h2>Versions</h2>
      <div id="mc-versions">Loading…</div>
    </div>
  `;

  wireCreate(view);

  const form = view.querySelector('#mc-form');
  const errorEl = view.querySelector('#mc-error');
  const summaryEl = view.querySelector('#mc-summary');
  const submitBtn = view.querySelector('#mc-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    summaryEl.innerHTML = '';
    const fileInput = view.querySelector('#mc-file');
    const fy = view.querySelector('#mc-fy').value.trim();
    if (!fileInput.files || !fileInput.files[0]) {
      errorEl.textContent = 'Please choose a .xlsx file.';
      errorEl.hidden = false;
      return;
    }

    // multipart upload — use raw fetch (do NOT set Content-Type; the browser sets the boundary)
    const fd = new FormData();
    fd.append('file', fileInput.files[0]);
    if (fy) fd.append('financialYear', fy);

    submitBtn.disabled = true;
    submitBtn.textContent = 'Parsing…';
    try {
      const res = await fetch('/api/menucards/import', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const text = await res.text();
      const body = text ? JSON.parse(text) : {};
      if (!res.ok) {
        throw new ApiError(res.status, body.error || 'ERR', body.message || 'Import failed', body.details);
      }
      renderSummary(summaryEl, body);
      await loadVersions(view);
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : 'Upload failed.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload & Parse';
    }
  });

  await loadVersions(view);
}

function renderSummary(el, body) {
  const counts = body.counts || {};
  const countRows = Object.entries(counts)
    .map(([k, v]) => `<li>${esc(k)}: <strong>${v}</strong></li>`)
    .join('');
  const warns = (body.warnings || [])
    .map((w) => `<li class="muted">${esc(w)}</li>`)
    .join('');
  el.innerHTML = `
    <div class="card" style="background: var(--surface-2);">
      <p style="margin-top:0;"><span class="badge ok">Parsed</span>
        Staged as <strong>DRAFT</strong> — ${body.totalVariants} variants from
        <strong>${esc(body.version?.label)}</strong> (${esc(body.version?.financialYear)}).</p>
      <ul>${countRows}</ul>
      ${warns ? `<p class="muted">Warnings:</p><ul>${warns}</ul>` : '<p class="muted">No warnings.</p>'}
      <p class="muted">Review the version below, then <strong>Activate</strong> to make it live.</p>
    </div>`;
}

async function loadVersions(view) {
  const wrap = view.querySelector('#mc-versions');
  try {
    const { items } = await api.get('/api/menucards');
    if (!items.length) {
      wrap.innerHTML = '<p class="muted">No Menu Card versions yet. Import one above.</p>';
      return;
    }
    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Version</th><th>FY</th><th>Status</th><th>Variants</th><th>Uploaded</th><th></th></tr>
        </thead>
        <tbody>
          ${items
            .map(
              (v) => `
            <tr>
              <td><strong>${esc(v.label)}</strong><br><span class="muted" style="font-size:var(--fs-sm)">${esc(v.sourceFilename)}</span></td>
              <td>${esc(v.financialYear)}</td>
              <td>${statusBadge(v.status)}</td>
              <td>${v.variantCount}</td>
              <td class="muted" style="font-size:var(--fs-sm)">${esc(v.uploadedAt)}</td>
              <td style="white-space:nowrap;">
                ${v.status !== 'ACTIVE' ? `<button class="btn-ghost" data-activate="${v.id}">Activate</button>` : ''}
                ${v.status !== 'ARCHIVED' ? `<button class="btn-ghost" data-archive="${v.id}">Archive</button>` : ''}
                ${v.hasFile ? `<a class="btn-ghost" href="/api/menucards/${v.id}/download">Download</a>` : ''}
                <button class="btn-ghost" data-edit="${v.id}" data-label="${esc(v.label)}" data-fy="${esc(v.financialYear)}" data-file="${esc(v.sourceFilename)}">Edit</button>
                ${v.status !== 'ACTIVE' ? `<button class="btn-ghost" data-delete="${v.id}" data-label="${esc(v.label)}">Delete</button>` : ''}
              </td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;

    wrap.querySelectorAll('[data-activate]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.post(`/api/menucards/${btn.getAttribute('data-activate')}/activate`);
          await loadVersions(view);
        } catch {
          btn.disabled = false;
        }
      });
    });
    wrap.querySelectorAll('[data-archive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archive this version? (You can reactivate it again later.)')) return;
        btn.disabled = true;
        try {
          await api.post(`/api/menucards/${btn.getAttribute('data-archive')}/archive`);
          await loadVersions(view);
        } catch {
          btn.disabled = false;
        }
      });
    });
    wrap.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-edit');
        const curLabel = btn.getAttribute('data-label');
        const curFy = btn.getAttribute('data-fy');
        const curFile = btn.getAttribute('data-file');
        const label = prompt('Version label:', curLabel);
        if (label === null) return;
        const financialYear = prompt('Financial year (e.g. FY27):', curFy);
        if (financialYear === null) return;
        const sourceFilename = prompt('File name (display):', curFile);
        if (sourceFilename === null) return;
        try {
          await api.patch(`/api/menucards/${id}`, {
            label: label.trim(),
            financialYear: financialYear.trim(),
            sourceFilename: sourceFilename.trim(),
          });
          await loadVersions(view);
        } catch (e) {
          alert('Could not update: ' + (e.message || 'error'));
        }
      });
    });
    wrap.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete');
        const label = btn.getAttribute('data-label');
        if (!confirm(`Delete version "${label}" permanently? This cannot be undone.`)) return;
        btn.disabled = true;
        try {
          await api.del(`/api/menucards/${id}`);
          await loadVersions(view);
        } catch (e) {
          btn.disabled = false;
          alert('Could not delete: ' + (e.message || 'error'));
        }
      });
    });
  } catch (e) {
    wrap.innerHTML = `<p class="form-error">Could not load versions: ${esc(e.message)}</p>`;
  }
}

// ============================================================
// Create a Menu Card on screen (task 9.12)
// ============================================================

let rowSeq = 0; // unique ids for dynamic rows

function wireCreate(view) {
  const toggle = view.querySelector('#mc-create-toggle');
  toggle.addEventListener('click', () => openCreateModal(view));
}

/** Open the "Create a Menu Card" form in a modal dialog (Cancel / Save footer). */
function openCreateModal(view) {
  const host = document.createElement('div');
  host.className = 'est-modal-backdrop';
  host.innerHTML = `
    <div class="card est-modal mc-create-modal" role="dialog" aria-modal="true" aria-labelledby="cm-title">
      <button type="button" class="modal-close" id="cm-x" aria-label="Close"><span aria-hidden="true">✕</span></button>
      <h2 id="cm-title" style="margin-top:0;">Create a Menu Card</h2>
      <div class="mc-create-form">
        <div class="mc-header-grid">
          <label class="field"><span>Version label *</span><input id="cm-label" type="text" placeholder="e.g. V6" /></label>
          <label class="field"><span>Financial year *</span><input id="cm-fy" type="text" placeholder="e.g. FY28" /></label>
          <label class="field"><span>Blended USP rate (£) *</span><input id="cm-rate" type="number" step="0.01" min="0" value="55.56" /></label>
          <label class="field"><span>Overhead % *</span><input id="cm-ovh" type="number" step="0.01" min="0" value="40" /></label>
          <label class="field"><span>People-day rate (£) *</span><input id="cm-pdr" type="number" step="0.01" min="0" value="144" /></label>
        </div>
        <p class="muted" style="margin:var(--space-2) 0;">Rates change roughly yearly — edit them above and
          the rows below recalculate (except any value you've overridden).</p>

        <div style="overflow-x:auto;">
          <table class="data-table mc-variant-table">
            <thead>
              <tr>
                <th>Component *</th><th>Size *</th><th>Description *</th><th>PD *</th>
                <th>USP</th><th>ATOM</th><th>TCS Cost</th><th>FTE Cost</th><th>Total</th><th></th>
              </tr>
            </thead>
            <tbody id="cm-rows"></tbody>
          </table>
        </div>
        <button type="button" class="btn-ghost" id="cm-add-row">+ Add service row</button>

        <div id="cm-error" class="form-error" role="alert" hidden style="margin-top:var(--space-3);"></div>
        <div id="cm-create-summary" style="margin-top:var(--space-3);"></div>
      </div>
      <div class="est-modal-actions">
        <button type="button" class="btn-ghost" id="cm-cancel">Cancel</button>
        <button type="button" class="btn-primary" id="cm-save">Save as DRAFT</button>
      </div>
    </div>`;
  view.appendChild(host);
  const panel = host.querySelector('.mc-create-form');
  const close = trapFocus(host, host.querySelector('[role="dialog"]'), () => host.remove());
  host.querySelector('#cm-cancel').addEventListener('click', close);
  host.querySelector('#cm-x').addEventListener('click', close);
  host.addEventListener('click', (e) => { if (e.target === host) close(); });

  const addRow = () => {
    const id = `r${++rowSeq}`;
    const tr = document.createElement('tr');
    tr.dataset.row = id;
    tr.innerHTML = `
      <td><select class="cm-comp" aria-label="Component">${COMPONENTS.map(([l, c]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select></td>
      <td><select class="cm-size" aria-label="Size">${SIZES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></td>
      <td><input class="cm-desc" type="text" aria-label="Description" placeholder="Service description" /></td>
      <td><input class="cm-pd num-cell" type="number" step="0.25" min="0" value="0" aria-label="PD" style="width:5rem;" /></td>
      <td><input class="cm-usp num-cell" type="number" step="0.0001" aria-label="USP" style="width:5rem;" /></td>
      <td><input class="cm-atom num-cell" type="number" step="0.0001" aria-label="ATOM" style="width:5rem;" /></td>
      <td><input class="cm-tcs num-cell" type="number" step="0.01" aria-label="TCS Cost" style="width:6rem;" /></td>
      <td><input class="cm-fte num-cell" type="number" step="0.01" aria-label="FTE Cost" style="width:6rem;" /></td>
      <td><input class="cm-total num-cell" type="number" step="0.01" aria-label="Total Cost" style="width:6rem;" /></td>
      <td><button type="button" class="btn-ghost danger cm-del" aria-label="Remove row"><span aria-hidden="true">✕</span></button></td>`;
    panel.querySelector('#cm-rows').appendChild(tr);
    // PD change recomputes this row's derived fields (clearing any override on those fields).
    tr.querySelector('.cm-pd').addEventListener('input', () => recalcRow(view, panel, tr));
    tr.querySelector('.cm-del').addEventListener('click', () => tr.remove());
    recalcRow(view, panel, tr);
  };

  panel.querySelector('#cm-add-row').addEventListener('click', addRow);
  addRow(); // start with one row

  // Rate changes recompute every row (re-deriving from PD).
  ['#cm-rate', '#cm-ovh'].forEach((sel) => {
    panel.querySelector(sel).addEventListener('input', () => {
      panel.querySelectorAll('#cm-rows tr').forEach((tr) => recalcRow(view, panel, tr));
    });
  });

  panel.querySelector('#cm-save').addEventListener('click', () => saveCreate(view, panel, close));

  // Focus the first field for keyboard users.
  const firstField = panel.querySelector('#cm-label');
  if (firstField) firstField.focus();
}

/** Recompute a row's six derived fields from its PD + the current header rates. */
function recalcRow(view, panel, tr) {
  const rate = panel.querySelector('#cm-rate').value;
  const ovh = panel.querySelector('#cm-ovh').value;
  const pd = tr.querySelector('.cm-pd').value;
  const c = computeVariant(pd, rate, ovh);
  tr.querySelector('.cm-usp').value = c.usp;
  tr.querySelector('.cm-atom').value = c.atom;
  tr.querySelector('.cm-tcs').value = c.uspCost;
  tr.querySelector('.cm-fte').value = c.overheadCost;
  tr.querySelector('.cm-total').value = c.totalCost;
}

async function saveCreate(view, panel, close) {
  const errEl = panel.querySelector('#cm-error');
  const summaryEl = panel.querySelector('#cm-create-summary');
  errEl.hidden = true; summaryEl.innerHTML = '';

  const val = (sel) => panel.querySelector(sel).value.trim();
  const label = val('#cm-label');
  const financialYear = val('#cm-fy');
  const blendedUspRate = Number(val('#cm-rate'));
  const overheadPct = Number(val('#cm-ovh'));
  const peopleDayRate = Number(val('#cm-pdr'));

  const fail = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
  if (!label) return fail('Version label is required.');
  if (!financialYear) return fail('Financial year is required.');
  if (!Number.isFinite(blendedUspRate) || blendedUspRate < 0) return fail('Blended USP rate must be a number ≥ 0.');
  if (!Number.isFinite(overheadPct) || overheadPct < 0) return fail('Overhead % must be a number ≥ 0.');

  const rows = [...panel.querySelectorAll('#cm-rows tr')];
  if (!rows.length) return fail('Add at least one service row.');

  const variants = [];
  for (let i = 0; i < rows.length; i++) {
    const tr = rows[i];
    const num = (c) => Number(tr.querySelector(c).value);
    const description = tr.querySelector('.cm-desc').value.trim();
    if (!description) return fail(`Row ${i + 1}: description is required.`);
    const pd = num('.cm-pd');
    if (!Number.isFinite(pd) || pd < 0) return fail(`Row ${i + 1}: PD must be a number ≥ 0.`);
    variants.push({
      component: tr.querySelector('.cm-comp').value,
      size: tr.querySelector('.cm-size').value,
      description,
      pd,
      usp: num('.cm-usp'),
      atom: num('.cm-atom'),
      uspCost: num('.cm-tcs'),
      overheadCost: num('.cm-fte'),
      totalCost: num('.cm-total'),
    });
  }

  const saveBtn = panel.querySelector('#cm-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    const body = await api.post('/api/menucards', {
      label, financialYear, blendedUspRate, overheadPct, peopleDayRate, variants,
    });
    // Close the modal and surface the result in the main page (next to the Import summary area).
    if (typeof close === 'function') close();
    const mainSummary = view.querySelector('#mc-summary');
    if (mainSummary) {
      mainSummary.innerHTML = `<div class="card" style="background:var(--surface-2); margin-top:var(--space-4);">
        <p style="margin:0;"><span class="badge ok">Created</span> Staged <strong>${esc(body.version?.label)}</strong>
        (${esc(body.version?.financialYear)}) as a DRAFT with <strong>${body.totalVariants}</strong> variants.
        Activate it in the Versions list below.</p></div>`;
    }
    await loadVersions(view);
  } catch (err) {
    fail(err instanceof ApiError ? err.message : 'Could not create the Menu Card.');
    saveBtn.disabled = false; saveBtn.textContent = 'Save as DRAFT';
  }
}
