/**
 * Audit log (server/repo/audit.js) against a throwaway SQLite DB.
 *
 * Covers tasks 8.1–8.4: append-only writer (no update/delete path exported), events carry
 * user/timestamp/action/object, action/user/date-range filters, and listAuditUsers() distinct.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, cleanupTempDb, userId } from './helpers.mjs';

useTempDb();

const { initSchema, getDb } = await import('../server/db.js');
const audit = await import('../server/repo/audit.js');

let db;
let adminId;
let managerId;

before(() => {
  initSchema();
  db = getDb();
  adminId = userId(db, 'admin');
  managerId = userId(db, 'manager');

  // Seed a spread of events with explicit timestamps so the date filter is testable.
  const ins = db.prepare(
    `INSERT INTO audit_events (id, user_id, timestamp, action, object_type, object_id, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  const add = (uid, action, ts, detail) =>
    ins.run(`ev-${n++}`, uid, ts, action, 'Estimate', 'obj-1', detail ? JSON.stringify(detail) : null);

  add(adminId, 'LOGIN', '2026-01-01 09:00:00');
  add(adminId, 'ESTIMATE_CREATE', '2026-01-02 09:00:00');
  add(adminId, 'ESTIMATE_MODIFY', '2026-01-03 09:00:00', { change: 'status', from: 'NEW', to: 'APPROVED' });
  add(managerId, 'LOGIN', '2026-02-10 09:00:00');
  add(managerId, 'ESTIMATE_EXPORT', '2026-02-15 09:00:00');
});

after(cleanupTempDb);

test('writeEvent appends; events carry user/timestamp/action/object', () => {
  const before = audit.listEvents({}).length;
  audit.writeEvent({ userId: adminId, action: 'ESTIMATE_DELETE', objectType: 'Estimate', objectId: 'obj-x' });
  const rows = audit.listEvents({});
  assert.equal(rows.length, before + 1);
  const latest = rows[0]; // newest first
  assert.equal(latest.action, 'ESTIMATE_DELETE');
  assert.equal(latest.objectType, 'Estimate');
  assert.equal(latest.objectId, 'obj-x');
  assert.ok(latest.timestamp, 'timestamp present');
});

test('append-only: the repo exposes NO update or delete function', () => {
  assert.equal(typeof audit.writeEvent, 'function');
  assert.equal(typeof audit.listEvents, 'function');
  assert.equal(typeof audit.listAuditUsers, 'function');
  // nothing that could mutate/remove an existing event
  for (const key of Object.keys(audit)) {
    assert.ok(!/update|delete|remove|edit/i.test(key), `unexpected mutating export: ${key}`);
  }
});

test('filter by action', () => {
  const logins = audit.listEvents({ action: 'LOGIN' });
  assert.ok(logins.length >= 2);
  assert.ok(logins.every((e) => e.action === 'LOGIN'));
});

test('filter by user scopes to that user only', () => {
  const managerEvents = audit.listEvents({ userId: managerId });
  assert.ok(managerEvents.length >= 2);
  // every returned event belongs to the manager (name match since repo returns names)
  const managerName = db.prepare('SELECT display_name AS n FROM users WHERE id = ?').get(managerId).n;
  assert.ok(managerEvents.every((e) => e.userName === managerName));
});

test('date-range filter (inclusive, bare YYYY-MM-DD covers the day)', () => {
  const jan = audit.listEvents({ from: '2026-01-01', to: '2026-01-31' });
  assert.ok(jan.length >= 3, 'the three January events');
  assert.ok(jan.every((e) => e.timestamp.startsWith('2026-01')));
  const feb = audit.listEvents({ from: '2026-02-01', to: '2026-02-28' });
  assert.ok(feb.every((e) => e.timestamp.startsWith('2026-02')));
});

test('listAuditUsers returns distinct users present in the log', () => {
  const users = audit.listAuditUsers();
  const ids = users.map((u) => u.id);
  assert.ok(ids.includes(adminId));
  assert.ok(ids.includes(managerId));
  // distinct — no duplicate ids
  assert.equal(new Set(ids).size, ids.length);
});
