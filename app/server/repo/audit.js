/**
 * Audit log — append-only writer. No update/delete paths are exposed anywhere in the app,
 * which keeps the log tamper-evident (per the spec's audit requirements).
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';

/**
 * Write an audit event.
 * @param {object} e
 * @param {string|null} e.userId
 * @param {string} e.action       one of AuditAction
 * @param {string} e.objectType   e.g. 'User', 'Estimate', 'MenuCardVersion', 'Session'
 * @param {string} e.objectId
 * @param {object} [e.detail]      optional JSON-serialisable detail
 */
export function writeEvent({ userId = null, action, objectType, objectId, detail }) {
  getDb()
    .prepare(
      `INSERT INTO audit_events (id, user_id, action, object_type, object_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      userId,
      action,
      objectType,
      String(objectId),
      detail ? JSON.stringify(detail) : null,
    );
}

/**
 * Read audit events (viewer; newest first). Optional filters:
 *   action  — exact AuditAction (or 'PASSWORD_CHANGE')
 *   userId  — exact user id
 *   from/to — inclusive date range on the event timestamp. Accepts a date ('YYYY-MM-DD') or a
 *             full datetime; `to` as a bare date covers the whole day (compared via date()).
 *   limit   — max rows (default 200)
 */
export function listEvents({ action, userId, from, to, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  if (action) {
    clauses.push('a.action = ?');
    params.push(action);
  }
  if (userId) {
    clauses.push('a.user_id = ?');
    params.push(userId);
  }
  if (from) {
    // date() normalises both sides to a day boundary so a bare 'YYYY-MM-DD' works as expected.
    clauses.push('date(a.timestamp) >= date(?)');
    params.push(from);
  }
  if (to) {
    clauses.push('date(a.timestamp) <= date(?)');
    params.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);
  return getDb()
    .prepare(
      `SELECT a.*, u.display_name AS user_name
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.user_id
         ${where}
        ORDER BY a.timestamp DESC, a.id DESC
        LIMIT ?`,
    )
    .all(...params)
    .map((r) => ({
      id: r.id,
      userName: r.user_name ?? null,
      timestamp: r.timestamp,
      action: r.action,
      objectType: r.object_type,
      objectId: r.object_id,
      detail: r.detail ? JSON.parse(r.detail) : null,
    }));
}

/** Distinct users that appear in the audit log (for the viewer's user filter). */
export function listAuditUsers() {
  return getDb()
    .prepare(
      `SELECT DISTINCT a.user_id AS id, u.display_name AS name
         FROM audit_events a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.user_id IS NOT NULL
        ORDER BY name`,
    )
    .all()
    .map((r) => ({ id: r.id, name: r.name ?? r.id }));
}
