/**
 * Reporting routes (Stage 9) — read-only dashboards, available to BOTH roles
 * (Delivery Managers may view dashboards per requirements R5.2).
 *
 * All endpoints accept the shared filter query params: cfu, component, status, from, to.
 *   GET /api/reports/summary    -> one-call dashboard payload (KPIs + all chart series + table)
 *   GET /api/reports/filters    -> distinct option values for the filter dropdowns
 *   GET /api/reports/volume      -> request volume (total + per-status + headline)
 *   GET /api/reports/by-product  -> counts per component
 *   GET /api/reports/by-cfu      -> counts per CFU
 *   GET /api/reports/by-size     -> counts per request Size (TO..XXL)
 *   GET /api/reports/timeline    -> requests created per month
 *   GET /api/reports/value       -> total PD/USP/cost + component split + by-customer
 */
import { requireAuth } from '../auth.js';
import {
  summaryReport, filterOptions,
  volumeReport, byProductReport, valueReport,
  byCfuReport, bySizeReport, timelineReport,
} from '../repo/reports.js';

/** Pull the shared filter from the query string (empty params omitted). */
function filterFrom(query) {
  return {
    cfu: query.get('cfu') || undefined,
    component: query.get('component') || undefined,
    status: query.get('status') || undefined,
    from: query.get('from') || undefined,
    to: query.get('to') || undefined,
  };
}

export function registerReportRoutes(router) {
  router.get('/api/reports/summary', async ({ req, res, query }) => {
    requireAuth(req, res);
    return summaryReport(filterFrom(query));
  });

  router.get('/api/reports/filters', async ({ req, res }) => {
    requireAuth(req, res);
    return filterOptions();
  });

  router.get('/api/reports/volume', async ({ req, res, query }) => {
    requireAuth(req, res);
    return volumeReport(filterFrom(query));
  });

  router.get('/api/reports/by-product', async ({ req, res, query }) => {
    requireAuth(req, res);
    return byProductReport(filterFrom(query));
  });

  router.get('/api/reports/by-cfu', async ({ req, res, query }) => {
    requireAuth(req, res);
    return byCfuReport(filterFrom(query));
  });

  router.get('/api/reports/by-size', async ({ req, res, query }) => {
    requireAuth(req, res);
    return bySizeReport(filterFrom(query));
  });

  router.get('/api/reports/timeline', async ({ req, res, query }) => {
    requireAuth(req, res);
    return timelineReport(filterFrom(query));
  });

  router.get('/api/reports/value', async ({ req, res, query }) => {
    requireAuth(req, res);
    return valueReport(filterFrom(query));
  });
}
