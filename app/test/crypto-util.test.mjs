/**
 * Password hashing (server/crypto-util.js) — scrypt, the no-dependency bcrypt replacement.
 * Covers task 2.1: salted hash, correct verify, wrong-password reject, tamper reject.
 * No DB needed (pure crypto).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, randomToken } from '../server/crypto-util.js';

test('hashPassword produces the scrypt$salt$hash format', () => {
  const h = hashPassword('correct horse battery staple');
  const parts = h.split('$');
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts.length, 3);
  assert.ok(parts[1].length > 0 && parts[2].length > 0);
});

test('the same password hashes differently each time (random salt)', () => {
  assert.notEqual(hashPassword('pw'), hashPassword('pw'));
});

test('verifyPassword accepts the right password, rejects the wrong one', () => {
  const h = hashPassword('s3cret!');
  assert.equal(verifyPassword('s3cret!', h), true);
  assert.equal(verifyPassword('wrong', h), false);
});

test('verifyPassword rejects a tampered or malformed hash', () => {
  const h = hashPassword('pw');
  const tampered = h.slice(0, -2) + (h.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifyPassword('pw', tampered), false);
  assert.equal(verifyPassword('pw', 'not-a-valid-hash'), false);
  assert.equal(verifyPassword('pw', ''), false);
});

test('randomToken returns a hex string of the requested byte length', () => {
  const t = randomToken(16);
  assert.match(t, /^[0-9a-f]+$/);
  assert.equal(t.length, 32); // 16 bytes -> 32 hex chars
});
