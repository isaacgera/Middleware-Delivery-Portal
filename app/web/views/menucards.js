/** Menu Cards admin view — upload/import an .xlsx, review summary, list versions, activate/archive. */
import { api, ApiError } from '../api.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function statusBadge(status) {
  const cls = status === 'ACTIVE' ? 'ok' : status === 'DRAFT' ? 'warn' : '';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

export async function renderMenuCards(view) {
  view.innerHTML = `
    <h1>Menu Cards</h1>
    <p class="muted">Upload an approved Menu Card workbook (.xlsx), review the parsed summary,
      then activate it. Exactly one version is active at a time.</p>

    <div class="card" style="margin-top: var(--space-5); max-width: 640px;">
      <h2 style="margin-top:0;">Import a Menu Card</h2>
      <form id="mc-form">
        <label class="field">
          <span>Workbook (.xlsx)</span>
          <input id="mc-file" type="file" accept=".xlsx" required />
        </label>
        <label class="field">
          <span>Financial year (optional — e.g. FY27)</span>
          <input id="mc-fy" type="text" placeholder="FY27" />
        </label>
        <div id="mc-error" class="form-error" role="alert" hidden></div>
        <button class="btn-primary" type="submit" id="mc-submit">Upload &amp; parse</button>
      </form>
      <div id="mc-summary" style="margin-top: var(--space-4);"></div>
    </div>

    <div style="margin-top: var(--space-6);">
      <h2>Versions</h2>
      <div id="mc-versions">Loading…</div>
    </div>
  `;

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
      submitBtn.textContent = 'Upload & parse';
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
