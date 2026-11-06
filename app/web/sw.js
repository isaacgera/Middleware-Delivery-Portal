/**
 * MDP service worker — INSTALLABILITY ONLY, deliberately NOT offline-first.
 *
 * MDP is a server-backed, multi-user, shared-database app (see SPEC-design §1: "not local-first,
 * not a PWA"). Caching shared data would risk showing one user stale estimates/menu cards, so this
 * worker is intentionally conservative:
 *
 *   - It exists purely so the app meets the installability bar (a registered SW with a fetch
 *     handler + a manifest) — letting users "install" MDP as a desktop/taskbar window.
 *   - API / data requests (/api/…) are NEVER cached and NEVER intercepted — always straight to the
 *     network, so the shared source of truth is always live.
 *   - Static shell assets (html/js/css/icons) use NETWORK-FIRST: fetch fresh when online, fall back
 *     to a cached copy only if the network fails (e.g. a brief blip), so updates are never masked.
 *   - Non-GET requests bypass the worker entirely.
 *
 * Bump CACHE_NAME on any front-end release so old shell assets are evicted.
 */
const CACHE_NAME = 'mdp-shell-v1';

// The static shell worth keeping a fallback copy of. API responses are deliberately absent.
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/api.js',
  '/session.js',
  '/theme.js',
  '/styles/tokens.css',
  '/styles/global.css',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Pre-cache the shell best-effort; a missing optional asset must not fail the install.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(SHELL.map((url) => cache.add(url))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Drop old shell caches on a version bump, then take control of open pages.
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GETs. Everything else (POST/PATCH/DELETE, cross-origin) goes to network.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // NEVER cache or intercept API / data — always live from the server (shared source of truth).
  if (url.pathname.startsWith('/api/')) return;

  // Static shell: network-first, cache only as an offline fallback. Keeps data/updates fresh.
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Refresh the cached copy of successful shell responses for a future network blip.
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
  );
});
