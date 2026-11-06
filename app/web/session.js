/** Frontend session state — tracks the current principal, loaded from GET /api/auth/me. */
import { api, ApiError } from './api.js';

let principal = null; // { id, username, displayName, role } or null

export function getPrincipal() {
  return principal;
}

export function isAdmin() {
  return principal?.role === 'ADMINISTRATOR';
}

/** Load current session from the server. Returns the principal or null. */
export async function loadSession() {
  try {
    principal = await api.get('/api/auth/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) principal = null;
    else principal = null; // treat any failure as logged-out for the prototype
  }
  return principal;
}

export async function login(username, password) {
  principal = await api.post('/api/auth/login', { username, password });
  return principal;
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } finally {
    principal = null;
  }
}
