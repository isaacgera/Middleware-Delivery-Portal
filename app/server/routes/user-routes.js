/**
 * User-management routes (Administrator only). Create/list/update users.
 * RBAC is enforced server-side via requireRole(ADMINISTRATOR) — not just hidden in the UI.
 */
import { readJsonBody, conflict, notFound } from '../http-util.js';
import { requireRole } from '../auth.js';
import { requireString, optionalString, requireEnum, optionalBoolean } from '../validate.js';
import { Role } from '../constants.js';
import {
  listUsers,
  createUser,
  updateUser,
  findById,
  findByUsername,
  toUserView,
} from '../repo/users.js';

const ROLES = [Role.DELIVERY_MANAGER, Role.ADMINISTRATOR];

export function registerUserRoutes(router) {
  // GET /api/users  (admin)
  router.get('/api/users', async ({ req, res }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    return { items: listUsers() };
  });

  // POST /api/users  (admin) — create a user
  router.post('/api/users', async ({ req, res }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const body = await readJsonBody(req);
    const username = requireString(body, 'username', { min: 3, max: 64 });
    const displayName = requireString(body, 'displayName', { min: 1, max: 128 });
    const email = optionalString(body, 'email', { max: 200 });
    const role = requireEnum(body, 'role', ROLES);
    const password = requireString(body, 'password', { min: 8 });

    if (findByUsername(username)) {
      throw conflict('A user with that username already exists');
    }
    const created = createUser({ username, displayName, email, role, password });
    return created;
  });

  // PATCH /api/users/:id  (admin) — update display/email/role/active
  router.patch('/api/users/:id', async ({ req, res, params }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const body = await readJsonBody(req);
    const existing = findById(params.id);
    if (!existing) throw notFound('User not found');

    const displayName = optionalString(body, 'displayName', { max: 128 });
    const email = optionalString(body, 'email', { max: 200 });
    const role = body.role === undefined ? undefined : requireEnum(body, 'role', ROLES);
    const isActive = optionalBoolean(body, 'isActive');

    const updated = updateUser(params.id, { displayName, email, role, isActive });
    return updated ?? toUserView(existing);
  });
}
