/**
 * Menu Card management routes (Administrator only):
 *   POST /api/menucards/import   (multipart .xlsx)  -> parse, stage as DRAFT, return summary
 *   GET  /api/menucards                              -> list versions
 *   GET  /api/menucards/active                       -> active version meta
 *   GET  /api/menucards/:id                          -> version + variants
 *   POST /api/menucards/:id/activate                 -> single-ACTIVE transaction
 *   POST /api/menucards/:id/archive                  -> archive
 * Writes MENUCARD_UPLOAD and MENUCARD_ACTIVATION audit events.
 */
import { createReadStream, existsSync } from 'node:fs';
import { readJsonBody, badRequest, notFound, conflict } from '../http-util.js';
import { readMultipart } from '../multipart.js';
import { requireString, optionalString, requireNumber } from '../validate.js';
import { requireRole } from '../auth.js';
import { Role, AuditAction, Component, SIZES } from '../constants.js';
import { parseXlsx } from '../xlsx.js';
import { parseMenuCard } from '../menucard-parser.js';
import {
  createDraftVersion,
  listVersions,
  getVersion,
  getActiveVersion,
  activateVersion,
  archiveVersion,
  deleteVersion,
  updateVersionMeta,
  getVersionFile,
} from '../repo/menucards.js';
import { writeEvent } from '../repo/audit.js';

/** Build a timestamped download filename: name_YYYY-MM-DD_HHMMSS.xlsx */
function timestampedName(filename) {
  const base = filename.replace(/\.xlsx$/i, '') || 'menu-card';
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${base}_${ts}.xlsx`;
}

export function registerMenuCardRoutes(router) {
  // POST /api/menucards/import  (admin) — upload + parse + stage DRAFT
  router.post('/api/menucards/import', async ({ req, res }) => {
    const principal = requireRole(req, res, Role.ADMINISTRATOR);
    const { files, fields } = await readMultipart(req);

    const file = files.file || files.menucard || Object.values(files)[0];
    if (!file) throw badRequest('No file uploaded (expected a .xlsx in field "file")');
    if (!/\.xlsx$/i.test(file.filename)) {
      throw badRequest('Uploaded file must be a .xlsx workbook');
    }

    let workbook;
    try {
      workbook = parseXlsx(file.data);
    } catch {
      throw badRequest('Could not read the workbook — is it a valid .xlsx file?');
    }

    const financialYear = (fields.financialYear || '').trim() || undefined;
    const parsed = parseMenuCard(workbook, {
      financialYear,
      sourceFilename: file.filename,
    });

    if (parsed.variants.length === 0) {
      throw badRequest('No service variants found in the workbook', {
        warnings: parsed.warnings,
      });
    }

    const summary = { counts: parsed.counts, warnings: parsed.warnings };
    const version = createDraftVersion({
      version: parsed.version,
      variants: parsed.variants,
      uploadedById: principal.id,
      importSummary: summary,
      fileBuffer: file.data, // keep the original .xlsx for later download
    });

    writeEvent({
      userId: principal.id,
      action: AuditAction.MENUCARD_UPLOAD,
      objectType: 'MenuCardVersion',
      objectId: version.id,
      detail: { label: version.label, counts: parsed.counts },
    });

    return {
      version,
      counts: parsed.counts,
      warnings: parsed.warnings,
      totalVariants: parsed.variants.length,
    };
  });

  // POST /api/menucards  (admin) — CREATE a Menu Card on screen (no .xlsx) and stage it as DRAFT.
  // Body: { label, financialYear, blendedUspRate, overheadPct, peopleDayRate, variants:[ ... ] }.
  // Each variant carries the SIX values as submitted (the client calculates them from PD + the
  // rates, with optional admin overrides). The server stores them verbatim — it does NOT recompute
  // (same principle as the importer); it only VALIDATES shape, ranges, and duplicate variants.
  router.post('/api/menucards', async ({ req, res }) => {
    const principal = requireRole(req, res, Role.ADMINISTRATOR);
    const body = await readJsonBody(req);

    // --- header ---
    const label = requireString(body, 'label', { max: 100, label: 'Version label' });
    const financialYear = requireString(body, 'financialYear', { max: 20, label: 'Financial year' });
    const blendedUspRate = requireNumber(body, 'blendedUspRate', { min: 0 });
    const overheadPct = requireNumber(body, 'overheadPct', { min: 0, max: 1000 });
    const peopleDayRate = requireNumber(body, 'peopleDayRate', { min: 0 });

    // --- variants ---
    const rows = Array.isArray(body.variants) ? body.variants : null;
    if (!rows || rows.length === 0) {
      throw badRequest('At least one service variant is required.');
    }
    if (rows.length > 500) throw badRequest('Too many variants (max 500).');

    const components = Object.values(Component);
    const seen = new Set();
    const variants = rows.map((v, i) => {
      const where = `Variant ${i + 1}`;
      const component = v?.component;
      if (!components.includes(component)) throw badRequest(`${where}: Component must be one of ${components.join(', ')}.`);
      const size = v?.size;
      if (!SIZES.includes(size)) throw badRequest(`${where}: Size must be one of ${SIZES.join(', ')}.`);
      const description = String(v?.description ?? '').trim();
      if (!description) throw badRequest(`${where}: Description is required.`);
      if (description.length > 2000) throw badRequest(`${where}: Description too long (max 2000).`);

      // Duplicate guard — same key the importer flags (Component+Size+Description must be unique).
      const key = `${component}|${size}|${description.toLowerCase()}`;
      if (seen.has(key)) throw badRequest(`${where}: duplicate variant (${component}/${size}/"${description.slice(0, 40)}…").`);
      seen.add(key);

      const numOr = (field, { min = 0 } = {}) => {
        const n = Number(v?.[field]);
        if (!Number.isFinite(n) || n < min) throw badRequest(`${where}: ${field} must be a number ≥ ${min}.`);
        return n;
      };

      return {
        component,
        size,
        changeCategory: size, // the workbook keeps the size in the "Change Category" column
        description,
        scope: v?.scope ? String(v.scope).slice(0, 5000) : null,
        assumptions: v?.assumptions ? String(v.assumptions).slice(0, 5000) : null,
        exclusions: v?.exclusions ? String(v.exclusions).slice(0, 5000) : null,
        pd: numOr('pd'),
        usp: numOr('usp'),
        atom: numOr('atom'),
        uspCost: numOr('uspCost'),
        overheadCost: numOr('overheadCost'),
        totalCost: numOr('totalCost'),
        currentPartnerCost: v?.currentPartnerCost ? String(v.currentPartnerCost).slice(0, 200) : null,
        effortPhases: null,
        rowIndex: i,
      };
    });

    // Build the counts summary (per component) like the importer does.
    const counts = {};
    for (const v of variants) counts[v.component] = (counts[v.component] || 0) + 1;

    const version = createDraftVersion({
      version: {
        label,
        financialYear,
        sourceFilename: `${label} (created on screen)`,
        blendedUspRate,
        overheadPct,
        peopleDayRate,
      },
      variants,
      uploadedById: principal.id,
      importSummary: { counts, warnings: [], createdOnScreen: true },
      fileBuffer: null, // no .xlsx for an on-screen card (download stays disabled; re-import to enable)
    });

    writeEvent({
      userId: principal.id,
      action: AuditAction.MENUCARD_CREATE,
      objectType: 'MenuCardVersion',
      objectId: version.id,
      detail: { label, counts, source: 'on-screen' },
    });

    return { version, counts, totalVariants: variants.length };
  });

  // GET /api/menucards  (admin) — list versions
  router.get('/api/menucards', async ({ req, res }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    return { items: listVersions() };
  });

  // GET /api/menucards/active  (admin) — active version meta
  router.get('/api/menucards/active', async ({ req, res }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    return getActiveVersion() ?? {};
  });

  // GET /api/menucards/:id  (admin) — version + variants
  router.get('/api/menucards/:id', async ({ req, res, params }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const v = getVersion(params.id);
    if (!v) throw notFound('Menu card version not found');
    return v;
  });

  // POST /api/menucards/:id/activate  (admin) — DRAFT or ARCHIVED can be activated
  router.post('/api/menucards/:id/activate', async ({ req, res, params }) => {
    const principal = requireRole(req, res, Role.ADMINISTRATOR);
    const result = activateVersion(params.id);
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') throw notFound('Menu card version not found');
      throw badRequest('Could not activate version');
    }
    writeEvent({
      userId: principal.id,
      action: AuditAction.MENUCARD_ACTIVATION,
      objectType: 'MenuCardVersion',
      objectId: params.id,
    });
    return { ok: true };
  });

  // POST /api/menucards/:id/archive  (admin)
  router.post('/api/menucards/:id/archive', async ({ req, res, params }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const result = archiveVersion(params.id);
    if (!result.ok) throw notFound('Menu card version not found');
    return { ok: true };
  });

  // PATCH /api/menucards/:id  (admin) — edit metadata ONLY (label + financial year).
  // The as-imported effort/cost values are never editable — correct them by re-importing.
  router.patch('/api/menucards/:id', async ({ req, res, params }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const body = await readJsonBody(req);
    const label = optionalString(body, 'label', { max: 100 });
    const financialYear = optionalString(body, 'financialYear', { max: 20 });
    const sourceFilename = optionalString(body, 'sourceFilename', { max: 200 });
    const result = updateVersionMeta(params.id, { label, financialYear, sourceFilename });
    if (!result.ok) throw notFound('Menu card version not found');
    return result.version;
  });

  // DELETE /api/menucards/:id  (admin) — guarded (not ACTIVE, not referenced by estimates)
  router.del('/api/menucards/:id', async ({ req, res, params }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const result = deleteVersion(params.id);
    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') throw notFound('Menu card version not found');
      if (result.reason === 'ACTIVE') {
        throw conflict('Cannot delete the active version — archive or switch active first.');
      }
      if (result.reason === 'REFERENCED') {
        throw conflict(
          `Cannot delete — ${result.count} estimate(s) reference this version.`,
        );
      }
      throw badRequest('Could not delete version');
    }
    return { ok: true };
  });

  // GET /api/menucards/:id/download  (admin) — stream the stored original .xlsx
  router.get('/api/menucards/:id/download', async ({ req, res, params }) => {
    requireRole(req, res, Role.ADMINISTRATOR);
    const file = getVersionFile(params.id);
    if (!file || !existsSync(file.path)) {
      throw notFound('No stored file for this version (it predates file storage — re-import to enable download).');
    }
    const downloadName = timestampedName(file.filename || 'menu-card.xlsx');
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    });
    createReadStream(file.path).pipe(res);
    // response is streamed; handler returns nothing (server checks res.writableEnded)
  });
}
