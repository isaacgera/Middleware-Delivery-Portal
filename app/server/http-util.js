/**
 * Minimal HTTP helpers on top of node:http — a tiny router, JSON body parsing, and typed
 * error responses. Keeps server.js readable without any web framework.
 */

/** Explicit HTTP error we throw deliberately; the server renders it as a JSON ApiError. */
export class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (m = 'Not found') => new HttpError(404, 'NOT_FOUND', m);
export const unauthorized = (m = 'Not authenticated') => new HttpError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'Not permitted') => new HttpError(403, 'FORBIDDEN', m);
export const conflict = (m = 'Conflict', d) => new HttpError(409, 'CONFLICT', m, d);
export const badRequest = (m = 'Bad request', d) => new HttpError(400, 'BAD_REQUEST', m, d);

/** Send a JSON response. */
export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Render any thrown error as a consistent ApiError JSON shape. */
export function sendError(res, err) {
  if (err instanceof HttpError) {
    sendJson(res, err.statusCode, {
      error: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }
  // unexpected — log server-side, return a generic 500
  console.error('[unhandled error]', err);
  sendJson(res, 500, { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}

/** Read and JSON-parse a request body (with a size guard). Returns {} for empty bodies. */
export function readJsonBody(req, { limitBytes = 15 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(badRequest('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(badRequest('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Tiny path router. Register routes with method + pattern like '/api/estimates/:id'.
 * match() returns { handler, params } or null.
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const paramNames = [];
    const regexStr =
      '^' +
      pattern.replace(/:[^/]+/g, (m) => {
        paramNames.push(m.slice(1));
        return '([^/]+)';
      }) +
      '/?$';
    this.routes.push({ method, regex: new RegExp(regexStr), paramNames, handler });
  }

  get(p, h) {
    this.add('GET', p, h);
  }
  post(p, h) {
    this.add('POST', p, h);
  }
  patch(p, h) {
    this.add('PATCH', p, h);
  }
  del(p, h) {
    this.add('DELETE', p, h);
  }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { handler: r.handler, params };
    }
    return null;
  }
}
