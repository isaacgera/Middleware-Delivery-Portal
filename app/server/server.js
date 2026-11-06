/**
 * MDP dependency-free server entry point.
 * Built entirely on Node's standard library (node:http, node:sqlite, node:crypto) — no npm
 * install required. Run with:  node server/server.js   (from the app/ folder)
 */
import http from 'node:http';
import { URL } from 'node:url';
import { config } from './config.js';
import { Router, sendJson, sendError, notFound } from './http-util.js';
import { serveStatic } from './static.js';
import { getDb, initSchema } from './db.js';
import { APP_VERSION } from './constants.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerUserRoutes } from './routes/user-routes.js';
import { registerMenuCardRoutes } from './routes/menucard-routes.js';
import { registerCatalogueRoutes } from './routes/catalogue-routes.js';
import { registerEstimateRoutes } from './routes/estimate-routes.js';
import { registerAuditRoutes } from './routes/audit-routes.js';
import { registerReportRoutes } from './routes/report-routes.js';
import { registerAnalyticsRoutes } from './routes/analytics-routes.js';

// ---- Build the router + register routes ----
const router = new Router();

// Health check — confirms server + DB are up.
router.get('/api/health', async () => {
  let dbOk = false;
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return {
    status: dbOk ? 'ok' : 'degraded',
    service: 'mdp-api',
    version: APP_VERSION,
    db: dbOk ? 'connected' : 'unavailable',
    runtime: 'node ' + process.version + ' (dependency-free)',
    time: new Date().toISOString(),
  };
});

// Stage 2 — auth & user management
registerAuthRoutes(router);
registerUserRoutes(router);

// Stage 3 — Menu Card management (admin)
registerMenuCardRoutes(router);

// Stage 4 — Product Catalogue (both roles)
registerCatalogueRoutes(router);

// Stage 5 — Estimate Builder + Calculation Engine (both roles)
registerEstimateRoutes(router);

// Stage 8 — Audit viewer (role-scoped: Audit for admin, History for others)
registerAuditRoutes(router);

// Stage 9 — Reporting dashboards (both roles)
registerReportRoutes(router);

// Stage 9 part ii — Flow analytics (both roles)
registerAnalyticsRoutes(router);

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith('/api/')) {
      const matched = router.match(req.method, pathname);
      if (!matched) throw notFound(`No route for ${req.method} ${pathname}`);
      const ctx = { req, res, params: matched.params, query: url.searchParams };
      const result = await matched.handler(ctx);
      // If the handler already started the response (e.g. streamed a file download via
      // res.writeHead + pipe), don't try to send JSON on top of it.
      if (res.headersSent || res.writableEnded) return;
      sendJson(res, 200, result ?? {});
      return;
    }

    // Everything else -> static frontend
    serveStatic(req, res, config.webDir, pathname);
  } catch (err) {
    if (!res.writableEnded) sendError(res, err);
  }
});

// ---- Boot ----
function start() {
  // ensure DB + schema exist before serving
  initSchema();
  server.listen(config.port, config.host, () => {
    console.log(`MDP (dependency-free) listening on http://${config.host}:${config.port}`);
    console.log(`Health: http://${config.host}:${config.port}/api/health`);
    console.log(`DB: ${config.dbPath}`);
  });
}

const shutdown = (sig) => {
  console.log(`\n${sig} received, shutting down.`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
