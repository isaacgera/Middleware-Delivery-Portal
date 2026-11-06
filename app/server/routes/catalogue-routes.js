/**
 * Product Catalogue routes — read-only view of the ACTIVE Menu Card's service variants.
 * Available to BOTH roles (Delivery Manager + Administrator) via requireAuth.
 *   GET /api/catalogue?component=&size=&q=   -> { activeVersion, items, filters }
 *   GET /api/catalogue/variants/:id          -> full variant detail
 */
import { notFound } from '../http-util.js';
import { requireAuth } from '../auth.js';
import { queryActiveCatalogue, getVariant, getActiveFilters } from '../repo/menucards.js';

/** Read a filter param as an array: supports ?k=a,b and ?k=a&k=b. Empty -> undefined. */
function multiVal(query, key) {
  const all = query.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  return all.length ? all : undefined;
}

export function registerCatalogueRoutes(router) {
  // GET /api/catalogue — variants of the active version, with optional multi-value filters.
  // component/size accept comma-separated or repeated params (e.g. ?component=MQ,WLS).
  router.get('/api/catalogue', async ({ req, res, query }) => {
    requireAuth(req, res);
    const components = multiVal(query, 'component');
    const sizes = multiVal(query, 'size');

    const { activeVersion, items } = queryActiveCatalogue({ components, sizes });
    const filters = getActiveFilters();

    return {
      activeVersion: activeVersion
        ? {
            id: activeVersion.id,
            label: activeVersion.label,
            financialYear: activeVersion.financialYear,
            sourceFilename: activeVersion.sourceFilename,
          }
        : null,
      filters,
      items,
      total: items.length,
    };
  });

  // GET /api/catalogue/variants/:id — full variant detail
  router.get('/api/catalogue/variants/:id', async ({ req, res, params }) => {
    requireAuth(req, res);
    const variant = getVariant(params.id);
    if (!variant) throw notFound('Service variant not found');
    return variant;
  });
}
