/**
 * Flow-analytics routes (Stage 9 part ii) — read-only, BOTH roles (requireAuth).
 *   GET /api/analytics/flow?mode=overall|filter|compare&...
 *     mode=overall (default) -> whole-pipeline flow report
 *     mode=filter            -> flow report narrowed by component/size/cfu/customer/from/to
 *     mode=compare&groupBy=  -> key metrics broken down by a dimension (component|size|cfu|customer)
 *   Common params: agingDays (default 30), recentMonths (default 3).
 */
import { requireAuth } from '../auth.js';
import { flowReport, flowCompare } from '../repo/flow.js';

export function registerAnalyticsRoutes(router) {
  router.get('/api/analytics/flow', async ({ req, res, query }) => {
    requireAuth(req, res);
    const agingRaw = Number(query.get('agingDays'));
    const recentRaw = Number(query.get('recentMonths'));
    const agingDays = Number.isFinite(agingRaw) && agingRaw > 0 ? Math.min(agingRaw, 365) : 30;
    const recentMonths = Number.isFinite(recentRaw) && recentRaw > 0 ? Math.min(recentRaw, 24) : 3;
    const mode = query.get('mode') || 'overall';

    if (mode === 'compare') {
      return { mode, ...flowCompare(query.get('groupBy') || 'component', { agingDays }) };
    }

    const filter = mode === 'filter' ? {
      component: query.get('component') || undefined,
      size: query.get('size') || undefined,
      cfu: query.get('cfu') || undefined,
      customer: query.get('customer') || undefined,
      from: query.get('from') || undefined,
      to: query.get('to') || undefined,
    } : null;

    return { mode, ...flowReport({ agingDays, recentMonths, filter }) };
  });
}
