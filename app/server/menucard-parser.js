/**
 * Menu Card parser — turns a parsed workbook ({sheets:[{name,rows}]}) into a staged
 * MenuCardVersion + ServiceVariants, with validation warnings.
 *
 * Strategy: locate columns by HEADER TEXT (not fixed indices), so the four components' differing
 * layouts are all handled by the same logic, and minor column shuffles don't break import.
 *
 * Returns: {
 *   version: { label, financialYear, blendedUspRate, overheadPct, peopleDayRate },
 *   variants: [ { component, size, changeCategory, description, scope, assumptions, exclusions,
 *                 pd, usp, atom, uspCost, overheadCost, totalCost, currentPartnerCost,
 *                 effortPhases, rowIndex } ],
 *   warnings: [ string ],
 *   counts: { [component]: n },
 * }
 */
import { WorksheetToComponent, NonComponentSheets } from './constants.js';

const norm = (v) => (v === undefined || v === null ? '' : String(v)).trim();
const normLower = (v) => norm(v).toLowerCase().replace(/\s+/g, ' ');

/** Clean a description cell: strip stray leading tabs, normalise newlines, trim. */
function cleanText(v) {
  if (v === undefined || v === null) return '';
  return String(v)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^\s*t\*/gm, '*') // the workbook has some "t*" artefacts before bullets
    .replace(/\t/g, ' ')
    .trim();
}

/** Parse a cost/number cell -> number or null (ignores currency symbols/commas). */
function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = norm(v).replace(/[£$,]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

// Header-name matchers (lowercased, space-normalised "includes" tests).
const HEADER = {
  size: (h) => h === 'change category' || h.includes('t-shirt') || h === 'size',
  changeCategory: (h) => h === 'change category',
  description: (h) => h.includes('change category description') || h === 'description',
  pd: (h) => h.includes('median effort') || h === 'pd' || h.includes('- pd'),
  usp: (h) => h === 'usp',
  atom: (h) => h === 'atom',
  uspCost: (h) => h === 'usp cost',
  vendorCost: (h) => h === 'vendor cost' || h === 'overhead',
  totalCost: (h) => h === 'total cost',
  partnerCost: (h) => h.includes('current partner cost'),
};

/** Find the header row index within a sheet (the row containing "Change Category" + a PD col). */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = rows[i].map(normLower);
    const hasCat = cells.some((c) => c === 'change category');
    const hasPd = cells.some((c) => c.includes('median effort') || c.includes('- pd'));
    if (hasCat && hasPd) return i;
  }
  return -1;
}

/** Build a column-index map from the header row. */
function mapColumns(headerCells) {
  const lower = headerCells.map(normLower);
  const find = (pred) => {
    const idx = lower.findIndex((h) => pred(h));
    return idx;
  };
  // IMPORTANT — the workbook's cost headers are off-by-one vs their real meaning (confirmed
  // against the requirements doc's authoritative values for MQ XL: USP Cost 6000.48, Overhead
  // 2400.19, Total 8400.67, where 6000.48 x 0.40 = 2400.19 and 6000.48 + 2400.19 = 8400.67):
  //   header "USP Cost"   -> actually the per-USP RATE (e.g. 55.56)  -> NOT stored as a cost
  //   header "Vendor Cost"-> actually the real USP/TCS COST (6000.48) -> store as uspCost
  //   header "Overhead"   -> actually the overhead COST (2400.19)     -> store as overheadCost
  //   header "Total Cost" -> the grand total (8400.67)                -> store as totalCost
  return {
    changeCategory: find((h) => h === 'change category'),
    description: find(HEADER.description),
    pd: find(HEADER.pd),
    usp: find((h) => h === 'usp'),
    atom: find((h) => h === 'atom'),
    rate: find((h) => h === 'usp cost'), // mislabelled: this is the rate, not a cost
    uspCost: find((h) => h === 'vendor cost'), // the real USP/TCS cost
    overheadCost: find((h) => h === 'overhead'), // the overhead cost
    totalCost: find((h) => h === 'total cost'),
    partnerCost: find(HEADER.partnerCost),
  };
}

/**
 * In the workbook the "size" (T-shirt) value lives in the "Change Category" column
 * (values TO/XS/S/M/L/XL/XXL), and the human text is in "Change Category Description".
 * So: size column = the "Change Category" header; description column = "...Description".
 */

function parseComponentSheet(component, rows, warnings) {
  const headerRowIdx = findHeaderRow(rows);
  if (headerRowIdx === -1) {
    warnings.push(`${component}: could not locate a header row; sheet skipped.`);
    return [];
  }
  const header = rows[headerRowIdx];
  const col = mapColumns(header);

  if (col.changeCategory === -1 || col.pd === -1 || col.totalCost === -1) {
    warnings.push(
      `${component}: missing required columns (need Change Category, Median Effort - PD, Total Cost); sheet skipped.`,
    );
    return [];
  }

  const variants = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const sizeRaw = norm(row[col.changeCategory]);
    // skip footer rows like "Overhead %" / blank
    if (!sizeRaw) continue;
    if (sizeRaw.toLowerCase().includes('overhead %')) continue;

    const pd = toNumber(row[col.pd]);
    const totalCost = toNumber(row[col.totalCost]);
    // a real variant row must have a size + PD + total
    if (pd === null || totalCost === null) continue;

    variants.push({
      component,
      size: sizeRaw,
      changeCategory: sizeRaw,
      description: cleanText(col.description !== -1 ? row[col.description] : ''),
      scope: null,
      assumptions: null,
      exclusions: null,
      pd,
      usp: toNumber(row[col.usp]) ?? 0,
      atom: toNumber(row[col.atom]) ?? 0,
      uspCost: toNumber(row[col.uspCost]) ?? 0,
      overheadCost: toNumber(row[col.overheadCost]) ?? 0,
      totalCost,
      currentPartnerCost: col.partnerCost !== -1 ? norm(row[col.partnerCost]) || null : null,
      effortPhases: null,
      rowIndex: r,
    });
  }

  if (variants.length === 0) {
    warnings.push(`${component}: no valid variant rows found.`);
  }
  return variants;
}

/** Parse the Variables tab for the blended USP rate, overhead %, people-day rate. */
function parseVariables(rows) {
  let blendedUspRate = null;
  let peopleDayRate = null;
  for (const row of rows) {
    const label = normLower(row[0]);
    const label1 = normLower(row[1]);
    // take the FIRST "People Day" row (the Year-1 rate, 144), not later FY columns
    if (label === 'people day' && peopleDayRate === null) peopleDayRate = toNumber(row[2]);
    // "Blended USP" appears in a label cell with the value alongside
    for (let i = 0; i < row.length; i++) {
      if (normLower(row[i]).includes('blended usp')) {
        // value is usually the next non-empty numeric cell
        for (let j = i + 1; j < row.length; j++) {
          const n = toNumber(row[j]);
          if (n !== null) {
            blendedUspRate = n;
            break;
          }
        }
      }
    }
    void label1;
  }
  return { blendedUspRate, peopleDayRate };
}

/** Parse the Version tab for the latest version label + date (best-effort). */
function parseVersionTab(rows) {
  // rows like: [version, author, notes, date]; take the last data row's version label
  let label = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = norm(rows[i][0]);
    if (v && v.toLowerCase() !== 'version') {
      label = v;
      break;
    }
  }
  return { label };
}

/** Find the overhead % (flat per-component "Overhead %" footer cell; usually 40). */
function findOverheadPct(sheets) {
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (let i = 0; i < row.length; i++) {
        if (normLower(row[i]).includes('overhead %')) {
          const n = toNumber(row[i + 1]);
          if (n !== null) return n;
        }
      }
    }
  }
  return null;
}

export function parseMenuCard(workbook, { financialYear, sourceFilename } = {}) {
  const warnings = [];
  const variants = [];
  const counts = {};

  for (const sheet of workbook.sheets) {
    if (NonComponentSheets.includes(sheet.name)) continue;
    const component = WorksheetToComponent[sheet.name];
    if (!component) {
      warnings.push(`Unknown worksheet "${sheet.name}" ignored (not a known component).`);
      continue;
    }
    const sheetVariants = parseComponentSheet(component, sheet.rows, warnings);
    counts[component] = sheetVariants.length;
    variants.push(...sheetVariants);
  }

  // flag duplicate variants (same component+size+description)
  const seen = new Map();
  for (const v of variants) {
    const key = `${v.component}|${v.size}|${v.description}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) {
    if (n > 1) warnings.push(`Duplicate variant (${n}x): ${key.slice(0, 80)}…`);
  }

  const varsSheet = workbook.sheets.find((s) => s.name === 'Variables');
  const versionSheet = workbook.sheets.find((s) => s.name === 'Version');
  const vars = varsSheet ? parseVariables(varsSheet.rows) : {};
  const ver = versionSheet ? parseVersionTab(versionSheet.rows) : {};
  const overheadPct = findOverheadPct(workbook.sheets);

  const version = {
    label: ver.label ?? 'imported',
    financialYear: financialYear ?? 'FY??',
    sourceFilename: sourceFilename ?? 'menu-card.xlsx',
    blendedUspRate: vars.blendedUspRate ?? 55.56,
    overheadPct: overheadPct ?? 40,
    peopleDayRate: vars.peopleDayRate ?? 144,
  };

  if (variants.length === 0) {
    warnings.push('No variants parsed from any component sheet — check the workbook format.');
  }

  return { version, variants, warnings, counts };
}
