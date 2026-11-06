/**
 * Dependency-free .xlsx reader. An .xlsx is a ZIP of XML files; we unzip with node:zlib
 * (raw inflate) by walking the ZIP central directory, then parse sharedStrings + each sheet.
 * No third-party library. Handles the stored (0) and deflate (8) compression methods.
 *
 * Returns: { sheets: [{ name, rows: [ [cellA, cellB, ...], ... ] }] }
 * Cell values are strings/numbers; empty cells are '' and rows are dense up to the last cell.
 */
import { inflateRawSync } from 'node:zlib';

// ---- ZIP parsing (End of Central Directory -> Central Directory -> local entries) ----

function readZipEntries(buf) {
  // find End Of Central Directory record (signature 0x06054b50), searching from the end
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Not a valid zip/xlsx (no EOCD record)');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = {};
  const CDH_SIG = 0x02014b50;
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(cdOffset) !== CDH_SIG) break;
    const compMethod = buf.readUInt16LE(cdOffset + 10);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);

    // read the local file header to find where the data actually starts
    const LFH_SIG = 0x04034b50;
    if (buf.readUInt32LE(localHeaderOffset) === LFH_SIG) {
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      let content;
      if (compMethod === 0) {
        content = Buffer.from(raw); // stored
      } else if (compMethod === 8) {
        content = inflateRawSync(raw); // deflate
      } else {
        content = null; // unsupported method; skip
      }
      if (content) entries[name] = content;
    }

    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---- tiny XML helpers (regex-based; enough for Excel's simple cell XML) ----

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // amp last
}

// parse sharedStrings.xml -> array of strings
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // each <si>...</si> is one string; it may contain multiple <t> runs
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    let str = '';
    while ((t = tRe.exec(inner)) !== null) str += t[1];
    out.push(decodeXmlEntities(str));
  }
  return out;
}

// column letters -> 0-based index (A=0, B=1, ... Z=25, AA=26)
function colToIndex(ref) {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// parse a worksheet XML into dense rows of values
function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowXml = rm[1];
    const cells = [];
    let maxIdx = -1;
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rowXml)) !== null) {
      const attrs = cm[1] ?? cm[3] ?? '';
      const body = cm[2] ?? '';
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const idx = refMatch ? colToIndex(refMatch[1]) : maxIdx + 1;
      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : null;

      let value = '';
      if (type === 's') {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vM) value = shared[parseInt(vM[1], 10)] ?? '';
      } else if (type === 'inlineStr') {
        const tM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
        if (tM) value = decodeXmlEntities(tM[1]);
      } else {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vM) {
          const raw = decodeXmlEntities(vM[1]);
          const num = Number(raw);
          value = raw !== '' && !Number.isNaN(num) ? num : raw;
        }
      }
      cells[idx] = value;
      if (idx > maxIdx) maxIdx = idx;
    }
    // densify
    const dense = [];
    for (let i = 0; i <= maxIdx; i++) dense[i] = cells[i] === undefined ? '' : cells[i];
    rows.push(dense);
  }
  return rows;
}

/** Parse an .xlsx Buffer into { sheets: [{ name, rows }] }. */
export function parseXlsx(buffer) {
  const entries = readZipEntries(buffer);

  const shared = parseSharedStrings(
    entries['xl/sharedStrings.xml']?.toString('utf8') ?? '',
  );

  // workbook.xml gives sheet names + rId; the rels map rId -> target file
  const workbookXml = entries['xl/workbook.xml']?.toString('utf8') ?? '';
  const relsXml = entries['xl/_rels/workbook.xml.rels']?.toString('utf8') ?? '';

  // rId -> target (e.g. "worksheets/sheet1.xml")
  const relMap = {};
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let r;
  while ((r = relRe.exec(relsXml)) !== null) {
    const idM = /Id="([^"]+)"/.exec(r[1]);
    const tgtM = /Target="([^"]+)"/.exec(r[1]);
    if (idM && tgtM) relMap[idM[1]] = tgtM[1];
  }

  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/>/g;
  let s;
  while ((s = sheetRe.exec(workbookXml)) !== null) {
    const nameM = /name="([^"]*)"/.exec(s[1]);
    const ridM = /r:id="([^"]+)"/.exec(s[1]);
    if (!nameM || !ridM) continue;
    const name = decodeXmlEntities(nameM[1]);
    let target = relMap[ridM[1]];
    if (!target) continue;
    // normalise to full path within the zip
    if (!target.startsWith('xl/')) target = 'xl/' + target.replace(/^\//, '');
    const sheetXml = entries[target]?.toString('utf8');
    if (!sheetXml) continue;
    sheets.push({ name, rows: parseSheet(sheetXml, shared) });
  }

  return { sheets };
}
