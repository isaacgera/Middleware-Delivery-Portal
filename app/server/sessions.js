/**
 * Session management — in-memory session store + a signed session cookie.
 * Dependency-free: HMAC-signed cookie value (via node:crypto) so a tampered cookie is rejected.
 * Sessions expire after an idle timeout (config.sessionIdleMinutes), sliding on each use.
 *
 * NOTE (prototype): sessions live in memory, so restarting the server logs everyone out.
 * That's fine for the prototype; a persistent store is a later concern.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { randomToken } from './crypto-util.js';

const COOKIE_NAME = 'mdp_sid';
const sessions = new Map(); // sid -> { userId, createdAt, lastSeen }

function idleMs() {
  return config.sessionIdleMinutes * 60 * 1000;
}

// ---- cookie signing (value.signature) ----

function sign(value) {
  const sig = createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  return `${value}.${sig}`;
}

function unsign(signed) {
  if (!signed || typeof signed !== 'string') return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return value;
}

// ---- cookie parsing / serialising ----

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setCookie(res, name, value, { maxAgeMs } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (config.isProd) parts.push('Secure');
  if (typeof maxAgeMs === 'number') parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  appendSetCookie(res, parts.join('; '));
}

function clearCookie(res, name) {
  appendSetCookie(res, `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// support multiple Set-Cookie headers
function appendSetCookie(res, cookieStr) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', [cookieStr]);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookieStr]);
  else res.setHeader('Set-Cookie', [existing, cookieStr]);
}

// ---- session lifecycle ----

export function createSession(res, userId) {
  const sid = randomToken(32);
  const now = Date.now();
  sessions.set(sid, { userId, createdAt: now, lastSeen: now });
  setCookie(res, COOKIE_NAME, sign(sid), { maxAgeMs: idleMs() });
  return sid;
}

export function destroySession(req, res) {
  const sid = readSid(req);
  if (sid) sessions.delete(sid);
  clearCookie(res, COOKIE_NAME);
}

function readSid(req) {
  const cookies = parseCookies(req);
  const signed = cookies[COOKIE_NAME];
  return unsign(signed);
}

/** Returns the active userId for this request, or null. Slides the idle window. */
export function getSessionUserId(req, res) {
  const sid = readSid(req);
  if (!sid) return null;
  const sess = sessions.get(sid);
  if (!sess) return null;

  const now = Date.now();
  if (now - sess.lastSeen > idleMs()) {
    sessions.delete(sid);
    if (res) clearCookie(res, COOKIE_NAME);
    return null;
  }
  sess.lastSeen = now;
  // refresh cookie max-age (sliding expiry)
  if (res) setCookie(res, COOKIE_NAME, sign(sid), { maxAgeMs: idleMs() });
  return sess.userId;
}
