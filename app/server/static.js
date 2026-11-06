/**
 * Static file server for the vanilla frontend in app/web/. Safe path resolution (no traversal),
 * basic content types, and SPA-style fallback to index.html for non-asset routes.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function serveStatic(req, res, webDir, pathname) {
  // prevent path traversal
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(webDir, safe);

  // directory or unknown route -> SPA index.html fallback
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(webDir, 'index.html');
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const type = TYPES[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(res);
}
