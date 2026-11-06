/**
 * Minimal multipart/form-data parser (dependency-free) — just enough to pull a single uploaded
 * file + simple text fields out of a browser form POST. Buffers the whole request (fine for the
 * small Menu Card .xlsx uploads in this prototype).
 *
 * Returns: { files: { <fieldName>: { filename, data: Buffer } }, fields: { <name>: string } }
 */
import { badRequest } from './http-util.js';

export function readMultipart(req, { limitBytes = 15 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    const m = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(ctype);
    if (!m) {
      reject(badRequest('Expected multipart/form-data'));
      return;
    }
    const boundary = '--' + (m[1] || m[2]).trim();

    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(badRequest('Upload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(parseBody(Buffer.concat(chunks), boundary));
      } catch (e) {
        reject(badRequest('Could not parse upload'));
        void e;
      }
    });
  });
}

function parseBody(buf, boundary) {
  const files = {};
  const fields = {};
  const bBuf = Buffer.from(boundary);
  const CRLFCRLF = Buffer.from('\r\n\r\n');

  // split into parts on the boundary
  let start = indexOf(buf, bBuf, 0);
  while (start !== -1) {
    const next = indexOf(buf, bBuf, start + bBuf.length);
    if (next === -1) break;
    // part is between this boundary and the next (skip the leading CRLF after boundary)
    let partStart = start + bBuf.length;
    // stop if this is the closing boundary ("--" right after)
    if (buf[partStart] === 0x2d && buf[partStart + 1] === 0x2d) break;
    if (buf[partStart] === 0x0d && buf[partStart + 1] === 0x0a) partStart += 2;
    // part ends just before the trailing CRLF preceding next boundary
    let partEnd = next;
    if (buf[partEnd - 2] === 0x0d && buf[partEnd - 1] === 0x0a) partEnd -= 2;

    const part = buf.subarray(partStart, partEnd);
    const headerEnd = indexOf(part, CRLFCRLF, 0);
    if (headerEnd !== -1) {
      const headerText = part.toString('utf8', 0, headerEnd);
      const content = part.subarray(headerEnd + CRLFCRLF.length);
      const nameM = /name="([^"]*)"/i.exec(headerText);
      const fileM = /filename="([^"]*)"/i.exec(headerText);
      const fieldName = nameM ? nameM[1] : null;
      if (fieldName) {
        if (fileM && fileM[1]) {
          files[fieldName] = { filename: fileM[1], data: Buffer.from(content) };
        } else {
          fields[fieldName] = content.toString('utf8');
        }
      }
    }
    start = next;
  }

  return { files, fields };
}

// Buffer.indexOf works, but keep an explicit helper for clarity/robustness.
function indexOf(haystack, needle, from) {
  return haystack.indexOf(needle, from);
}
