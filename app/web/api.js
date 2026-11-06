/** Tiny fetch wrapper for the MDP API. Sends cookies, parses JSON, throws on non-2xx. */

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const e = body && typeof body === 'object' ? body : {};
    throw new ApiError(res.status, e.error || 'HTTP_ERROR', e.message || `Request failed (${res.status})`, e.details);
  }
  return body;
}

export const api = {
  get: (p) => request(p),
  post: (p, b) => request(p, { method: 'POST', body: b ? JSON.stringify(b) : undefined }),
  patch: (p, b) => request(p, { method: 'PATCH', body: b ? JSON.stringify(b) : undefined }),
  del: (p) => request(p, { method: 'DELETE' }),
};
