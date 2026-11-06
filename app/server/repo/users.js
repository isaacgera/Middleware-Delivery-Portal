/**
 * User data-access. Thin query layer over node:sqlite (the dependency-free equivalent of a
 * Prisma repository). Returns plain row objects; never exposes password_hash to API views.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { hashPassword } from '../crypto-util.js';

/** Map a DB row to a safe view object (no password hash). */
export function toUserView(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email ?? null,
    role: row.role,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function findByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null;
}

export function findById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function listUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY username').all().map(toUserView);
}

export function createUser({ username, displayName, email, role, password }) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO users (id, username, password_hash, display_name, email, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(id, username, hashPassword(password), displayName, email ?? null, role);
  return toUserView(findById(id));
}

export function updateUser(id, { displayName, email, role, isActive }) {
  const current = findById(id);
  if (!current) return null;
  getDb()
    .prepare(
      `UPDATE users
         SET display_name = ?, email = ?, role = ?, is_active = ?
       WHERE id = ?`,
    )
    .run(
      displayName ?? current.display_name,
      email !== undefined ? email : current.email,
      role ?? current.role,
      isActive !== undefined ? (isActive ? 1 : 0) : current.is_active,
      id,
    );
  return toUserView(findById(id));
}

export function setPassword(id, newPassword) {
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), id);
}

export function setLastLogin(id) {
  getDb().prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}
