/**
 * Audit viewer (Stage 8) — read-only browse of the append-only audit log.
 * Filters: action, user, date from/to. Available to both roles for now.
 */
import { api } from '../api.js';

// Friendly labels for the audit actions.
const ACTION_LABEL = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  MENUCARD_UPLOAD: 'Menu Card upload',
  MENUCARD_ACTIVATION: 'Menu Card activation',
  ESTIMATE_CREATE: 'Request created',
  ESTIMATE_MODIFY: 'Request modified',
  ESTIMATE_DELETE: 'Request deleted',
  ESTIMATE_EXPORT: 'Request exported',
  PASSWORD_CHANGE: 'Password change',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function actionLabel(a) { return ACTION_LABEL[a] || a; }
function fmtTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('en-GB');
}
/** Compact, readable one-line summary of the JSON detail blob. */
function summariseDetail(detail) {
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  return parts.join(' · ');
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/**
 * @param view   the view container
 * @param admin  true for Administrators ("Audit" — full log, user filter) vs
 *               false for other roles ("History" — own events only, no user filter).
 */
export async function renderAudit(view, admin = false) {
  actionsPopulated = false; // fresh render — repopulate the action dropdown
  const title = admin ? 'Audit log' : 'My history';
  const blurb = admin
    ? 'All recorded activity across users.'
    : 'A record of your own activity.';
  view.innerHTML = `
    <div class="est-list-head">
      <h1>${title}</h1>
    </div>
    <p class="muted" style="margin-top:calc(var(--space-2) * -1);">${blurb}</p>
    <div class="card" style="margin-top: var(--space-4);">
      <div class="audit-filters">
        <label class="field">
          <span>Action</span>
          <select id="a-action"><option value="">All actions</option></select>
        </label>
        ${admin ? `
        <label class="field">
          <span>User</span>
          <select id="a-user"><option value="">All users</option></select>
        </label>` : ''}
        <label class="field">
          <span>From</span>
          <input id="a-from" type="date" />
        </label>
        <label class="field">
          <span>To</span>
          <input id="a-to" type="date" />
        </label>
        <button type="button" class="btn-ghost" id="a-clear">Clear</button>
      </div>
    </div>
    <div id="a-results" style="margin-top: var(--space-5);">Loading&hellip;</div>
  `;

  // Populate the user dropdown (admin only — distinct users in the log).
  if (admin) {
    try {
      const { users } = await api.get('/api/audit/users');
      const sel = view.querySelector('#a-user');
      for (const u of users) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name;
        sel.appendChild(opt);
      }
    } catch { /* non-fatal — the filter just stays "All users" */ }
  }

  const reload = debounce(() => loadAudit(view, admin), 150);
  view.querySelector('#a-action').addEventListener('change', reload);
  if (admin) view.querySelector('#a-user').addEventListener('change', reload);
  view.querySelector('#a-from').addEventListener('change', reload);
  view.querySelector('#a-to').addEventListener('change', reload);
  view.querySelector('#a-clear').addEventListener('click', () => {
    view.querySelector('#a-action').value = '';
    const userSel = view.querySelector('#a-user');
    if (userSel) userSel.value = '';
    view.querySelector('#a-from').value = '';
    view.querySelector('#a-to').value = '';
    loadAudit(view, admin);
  });

  await loadAudit(view, admin);
}

let actionsPopulated = false;

async function loadAudit(view, admin = false) {
  const el = view.querySelector('#a-results');
  const params = new URLSearchParams();
  const action = view.querySelector('#a-action').value;
  const userSel = view.querySelector('#a-user');
  const user = userSel ? userSel.value : '';
  const from = view.querySelector('#a-from').value;
  const to = view.querySelector('#a-to').value;
  if (action) params.set('action', action);
  if (admin && user) params.set('user', user);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const data = await api.get(`/api/audit${params.toString() ? `?${params}` : ''}`);

    // Populate the action dropdown once, from the server's authoritative list.
    if (!actionsPopulated && Array.isArray(data.actions)) {
      const sel = view.querySelector('#a-action');
      for (const a of data.actions) {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = actionLabel(a);
        sel.appendChild(opt);
      }
      actionsPopulated = true;
    }

    const items = data.items || [];
    if (!items.length) {
      el.innerHTML = '<p class="muted">No audit events match these filters.</p>';
      return;
    }
    el.innerHTML = `
      <table class="data-table audit-table">
        <thead>
          <tr><th>When</th>${admin ? '<th>User</th>' : ''}<th>Action</th><th>Object</th><th>Detail</th></tr>
        </thead>
        <tbody>
          ${items.map((e) => `
            <tr>
              <td class="audit-when">${esc(fmtTime(e.timestamp))}</td>
              ${admin ? `<td>${esc(e.userName || '—')}</td>` : ''}
              <td><span class="badge">${esc(actionLabel(e.action))}</span></td>
              <td class="audit-object">${esc(e.objectType)}<span class="muted"> ${esc(e.objectId)}</span></td>
              <td class="audit-detail">${esc(summariseDetail(e.detail))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted" style="margin-top:var(--space-3);">${items.length} event${items.length === 1 ? '' : 's'}${items.length >= 200 ? ' (showing the most recent 200 — narrow the filters to see more)' : ''}</p>`;
  } catch (e) {
    el.innerHTML = `<p class="form-error">Could not load the audit log: ${esc(e.message)}</p>`;
  }
}
