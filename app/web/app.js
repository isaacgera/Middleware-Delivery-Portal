/**
 * MDP frontend — session-aware vanilla app. No framework, no build step.
 * Stage 2: login gate, session-aware header (user chip + logout), role-aware nav, route guards.
 */
import { api, ApiError } from './api.js';
import { initTheme } from './theme.js';
import { loadSession, getPrincipal, isAdmin, logout } from './session.js';
import { renderLogin } from './views/login.js';
import { renderMenuCards } from './views/menucards.js';
import { renderCatalogue } from './views/catalogue.js';
import { renderEstimates } from './views/estimates.js';
import { renderAudit } from './views/audit.js';
import { renderReports } from './views/reports.js';
import { renderAnalytics } from './views/analytics.js';

const view = document.getElementById('view');
const nav = document.querySelector('.app-nav');

// ---- Authenticated views ----

async function renderDashboard() {
  const p = getPrincipal();
  view.innerHTML = `
    <h1>Home</h1>
    <p class="muted">Welcome, ${escapeHtml(p.displayName)}. Phase 1 — Estimation &amp; Planning.</p>
    <div class="card" style="margin-top: var(--space-5); max-width: 520px;">
      <h2 style="margin-top:0;">API connectivity</h2>
      <div id="health">Checking&hellip;</div>
    </div>
  `;
  const el = document.getElementById('health');
  try {
    const h = await api.get('/api/health');
    el.innerHTML = `
      <ul style="list-style:none; padding:0; margin:0; display:grid; gap:8px;">
        <li>Status: <span class="badge ${h.status === 'ok' ? 'ok' : 'warn'}">${h.status}</span></li>
        <li>Database: <span class="badge">${h.db}</span></li>
        <li class="muted">${h.service} v${h.version}</li>
        <li class="muted">${h.runtime}</li>
      </ul>`;
  } catch {
    el.innerHTML = `<p><span class="badge warn">offline</span> Could not reach the API.</p>`;
  }
}

function renderPlaceholder(title, stage) {
  view.innerHTML = `
    <h1>${title}</h1>
    <div class="card" style="margin-top: var(--space-5);">
      <p style="margin:0;">This area is part of <strong>${stage}</strong> and is not built yet.</p>
    </div>`;
}

// ---- Routes (with optional admin-only guard) ----

const routes = {
  '/': { render: renderDashboard },
  '/estimates': {
    // Prefix route: handles both /estimates and /estimates/:id (subPath passed through).
    prefix: true,
    render: (subPath) => renderEstimates(view, subPath),
  },
  '/catalogue': {
    render: () => renderCatalogue(view),
  },
  '/menu-cards': {
    render: () => renderMenuCards(view),
    adminOnly: true,
  },
  '/audit': {
    // Shared route: Administrators see the full "Audit" log; other roles see their own
    // "History" (server scopes non-admins to their own events — see audit-routes.js).
    render: () => renderAudit(view, isAdmin()),
  },
  '/reports': {
    // Reporting dashboards — both roles (DMs may view dashboards per requirements R5.2).
    render: () => renderReports(view),
  },
  '/analytics': {
    // Flow analytics + run-rate — both roles.
    render: () => renderAnalytics(view),
  },
};

function currentPath() {
  return window.location.hash.replace(/^#/, '') || '/';
}

function setActiveNav(path) {
  document.querySelectorAll('.app-nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-route') === path);
  });
}

// ---- Header (session-aware) ----

function renderHeaderNav() {
  const admin = isAdmin();
  // Build nav: Menu Cards is admin-only.
  nav.innerHTML = `
    <a href="#/" data-route="/">Home</a>
    <a href="#/estimates" data-route="/estimates">Requests</a>
    <a href="#/catalogue" data-route="/catalogue">Catalogue</a>
    <a href="#/reports" data-route="/reports">Dashboards</a>
    <a href="#/analytics" data-route="/analytics">Analytics</a>
    ${admin ? '<a href="#/menu-cards" data-route="/menu-cards">Menu Cards</a>' : ''}
    <a href="#/audit" data-route="/audit">${admin ? 'Audit' : 'History'}</a>
  `;

  // user chip + logout, inserted into the header-right area
  let chip = document.getElementById('user-chip');
  const headerRight = document.querySelector('.app-header-right');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'user-chip';
    chip.className = 'user-chip';
    // place before the theme toggle
    const toggle = document.getElementById('theme-toggle');
    headerRight.insertBefore(chip, toggle);
  }
  const p = getPrincipal();
  chip.innerHTML = `
    <span class="user-name">${escapeHtml(p.displayName)}</span>
    <span class="user-role">${p.role === 'ADMINISTRATOR' ? 'Admin' : 'Delivery Mgr'}</span>
    <button class="btn-ghost" id="logout-btn" type="button">Sign out</button>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout();
    showLogin();
  });
}

function clearHeaderForLogin() {
  nav.innerHTML = '';
  const chip = document.getElementById('user-chip');
  if (chip) chip.remove();
}

// ---- App flow ----

function showLogin() {
  clearHeaderForLogin();
  renderLogin(view, enterApp);
}

async function enterApp() {
  renderHeaderNav();
  router();
}

function router() {
  // guard: must be authenticated
  if (!getPrincipal()) {
    showLogin();
    return;
  }
  const path = currentPath();

  // Exact match first; otherwise look for a prefix route (e.g. /estimates/<id>).
  let route = routes[path];
  let subPath = '';
  let navKey = path;
  if (!route) {
    const prefixKey = Object.keys(routes).find(
      (k) => routes[k].prefix && (path === k || path.startsWith(k + '/')),
    );
    if (prefixKey) {
      route = routes[prefixKey];
      subPath = path.slice(prefixKey.length); // e.g. "/<id>"
      navKey = prefixKey;
    }
  }
  if (!route) {
    renderPlaceholder('Not found', 'unknown route');
    return;
  }
  // admin-only guard (defence in depth; API also enforces)
  if (route.adminOnly && !isAdmin()) {
    view.innerHTML = `<div class="card"><p style="margin:0;">You don't have access to this area.</p></div>`;
    return;
  }
  setActiveNav(navKey);
  route.render(subPath);
  // Accessibility: move focus to the main region on navigation so keyboard + screen-reader
  // users land in the freshly rendered content instead of staying on the clicked nav link.
  // #view is tabindex="-1" (programmatically focusable, not in the tab order). Guard against
  // yanking focus away from an input the user is actively typing in.
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
  if (!typing) {
    try { view.focus({ preventScroll: false }); } catch { /* older browsers */ }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * Announce a short message to screen readers via the polite live region (#sr-live). Clears first
 * so the same message announced twice in a row is still read. Used after async actions (status
 * change, delete, line add) so SR users get feedback without a focus change. (a11y nice-to-have.)
 */
export function announce(message) {
  const region = document.getElementById('sr-live');
  if (!region) return;
  region.textContent = '';
  // next tick so a repeat of the same text still triggers the SR announcement
  setTimeout(() => { region.textContent = String(message || ''); }, 30);
}
// Expose for view modules that are loaded as separate ES modules importing from here.
window.mdpAnnounce = announce;

// ---- Boot ----

window.addEventListener('hashchange', router);

/**
 * Skip link: focus the main region without triggering the hash router. The anchor's href="#view"
 * would otherwise be read by the router as a route change; intercept it, move focus, and keep the
 * current route. (a11y nice-to-have #2.)
 */
document.querySelector('.skip-link')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  if (view) { view.focus(); view.scrollIntoView({ block: 'start' }); }
});

initTheme();

(async function boot() {
  await loadSession();
  if (getPrincipal()) {
    renderHeaderNav();
  }
  router();
})();
