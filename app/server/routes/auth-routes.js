/**
 * Authentication routes: login, logout, me, change-own-password.
 * Registers handlers on the shared Router. Writes LOGIN/LOGOUT audit events.
 */
import { readJsonBody, unauthorized, badRequest } from '../http-util.js';
import { requireString } from '../validate.js';
import { verifyPassword } from '../crypto-util.js';
import { createSession, destroySession } from '../sessions.js';
import { getPrincipal, requireAuth } from '../auth.js';
import { findByUsername, findById, setLastLogin, setPassword } from '../repo/users.js';
import { writeEvent } from '../repo/audit.js';
import { AuditAction } from '../constants.js';

export function registerAuthRoutes(router) {
  // POST /api/auth/login
  router.post('/api/auth/login', async ({ req, res }) => {
    const body = await readJsonBody(req);
    const username = requireString(body, 'username');
    const password = requireString(body, 'password');

    const user = findByUsername(username);
    // Generic message — don't reveal whether the username exists.
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      throw unauthorized('Invalid username or password');
    }

    createSession(res, user.id);
    setLastLogin(user.id);
    writeEvent({
      userId: user.id,
      action: AuditAction.LOGIN,
      objectType: 'Session',
      objectId: user.id,
    });

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };
  });

  // POST /api/auth/logout
  router.post('/api/auth/logout', async ({ req, res }) => {
    const principal = getPrincipal(req, res);
    destroySession(req, res);
    if (principal) {
      writeEvent({
        userId: principal.id,
        action: AuditAction.LOGOUT,
        objectType: 'Session',
        objectId: principal.id,
      });
    }
    return { ok: true };
  });

  // GET /api/auth/me
  router.get('/api/auth/me', async ({ req, res }) => {
    const principal = getPrincipal(req, res);
    if (!principal) throw unauthorized();
    return principal;
  });

  // POST /api/users/me/password  (change own password)
  router.post('/api/users/me/password', async ({ req, res }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const currentPassword = requireString(body, 'currentPassword');
    const newPassword = requireString(body, 'newPassword', { min: 8 });

    const user = findById(principal.id);
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      throw badRequest('Current password is incorrect');
    }
    setPassword(principal.id, newPassword);
    // (Password change isn't one of the eight spec audit actions; logged as a generic event.)
    writeEvent({
      userId: principal.id,
      action: 'PASSWORD_CHANGE',
      objectType: 'User',
      objectId: principal.id,
    });
    return { ok: true };
  });
}
