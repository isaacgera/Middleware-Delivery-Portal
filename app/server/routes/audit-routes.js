/**
 * Audit viewer routes (Stage 8).
 *   GET /api/audit?action=&user=&from=&to=&limit=  -> filtered audit events (newest first)
 *   GET /api/audit/users                            -> distinct users in the log (filter dropdown)
 *
 * Available to BOTH roles for now (requireAuth) — Isaac will confirm whether to gate this to
 * Administrator after verifying. The log itself is append-only (repo/audit.js); this is read-only.
 */
import { requireAuth, requireRole } from '../auth.js';
import { AuditAction, Role } from '../constants.js';
import { listEvents, listAuditUsers } from '../repo/audit.js';

// The action values the viewer can filter by: the eight spec actions + the generic PASSWORD_CHANGE.
const AUDIT_ACTIONS = [...Object.values(AuditAction), 'PASSWORD_CHANGE'];

export function registerAuditRoutes(router) {
  // GET /api/audit — filtered list.
  //   Administrator  → "Audit": the full log across all users (the `user` filter is honoured).
  //   Delivery Mgr   → "History": their OWN events only. The user scope is forced to the caller
  //                    server-side (defence in depth) so a non-admin can't read anyone else's log.
  router.get('/api/audit', async ({ req, res, query }) => {
    const principal = requireAuth(req, res);
    const isAdmin = principal.role === Role.ADMINISTRATOR;

    const rawLimit = Number(query.get('limit'));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;
    const action = query.get('action') || undefined;

    return {
      scope: isAdmin ? 'all' : 'self',
      actions: AUDIT_ACTIONS,
      items: listEvents({
        action: action && AUDIT_ACTIONS.includes(action) ? action : undefined,
        // Non-admins are locked to their own events regardless of any `user` param supplied.
        userId: isAdmin ? (query.get('user') || undefined) : principal.id,
        from: query.get('from') || undefined,
        to: query.get('to') || undefined,
        limit,
      }),
    };
  });

  // GET /api/audit/users — distinct users for the filter dropdown. Administrator only
  // (the user filter is meaningless for the self-scoped History view).
  router.get('/api/audit/users', async ({ req, res }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    return { users: listAuditUsers() };
  });
}
