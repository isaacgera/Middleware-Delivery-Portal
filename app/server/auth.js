/**
 * Auth helpers shared by routes — resolve the current principal from the request session,
 * and guards that throw 401/403 when the caller isn't allowed.
 */
import { getSessionUserId } from './sessions.js';
import { findById, toUserView } from './repo/users.js';
import { unauthorized, forbidden } from './http-util.js';
import { Role } from './constants.js';

/** Returns a principal view { id, username, displayName, role } or null. */
export function getPrincipal(req, res) {
  const userId = getSessionUserId(req, res);
  if (!userId) return null;
  const row = findById(userId);
  if (!row || !row.is_active) return null;
  const v = toUserView(row);
  return { id: v.id, username: v.username, displayName: v.displayName, role: v.role };
}

/** Throws 401 if not authenticated; otherwise returns the principal. */
export function requireAuth(req, res) {
  const p = getPrincipal(req, res);
  if (!p) throw unauthorized();
  return p;
}

/** Throws 401 if not authed, 403 if the role isn't permitted; returns the principal. */
export function requireRole(req, res, role) {
  const p = requireAuth(req, res);
  // Administrator is a superset of Delivery Manager.
  if (p.role === Role.ADMINISTRATOR) return p;
  if (p.role !== role) throw forbidden();
  return p;
}
