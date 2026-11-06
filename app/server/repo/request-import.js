/**
 * Request import pipeline (task 9.11) — consume the `type:mdp.requests` export envelope and create
 * header-only requests.
 *
 * Design decisions (Isaac, 2026-11-06):
 *  - HEADERS ONLY. The export carries headers + cost summaries but no line items, so imported
 *    requests have NO lines (totals are £0 until lines are re-added). No attempt to rebuild lines.
 *  - SKIP DUPLICATES. A row whose JIRA reference already exists is skipped + reported; the import
 *    never overwrites and never aborts the whole batch on a duplicate.
 *  - PRESERVE STATUS. The exported status is kept (validated against EstimateStatus; unknown → NEW).
 *  - ATTRIBUTE TO THE IMPORTING ADMIN. The export has no creator field, so every imported request
 *    is created_by the admin performing the import, audited with detail { imported:true }.
 *  - PREVIEW then COMMIT. preview classifies every row and writes NOTHING; commit creates the
 *    importable ones in one pass.
 *  - Each request PINS the current ACTIVE Menu Card (same as a manual create).
 *
 * This module is pure data-access + validation; the route wires HTTP + audit around it.
 */
import { getDb } from '../db.js';
import { EstimateStatus } from '../constants.js';
import { createEstimate } from './estimates.js';
import { getActiveVersion } from './menucards.js';
import { badRequest } from '../http-util.js';

const VALID_STATUSES = new Set(Object.values(EstimateStatus));

/** Is this JIRA reference already used by an existing request? (case-insensitive, matches create) */
function jiraExists(jira) {
  const norm = String(jira || '').trim().toUpperCase();
  if (!norm) return false;
  return !!getDb().prepare('SELECT id FROM estimates WHERE jira_reference = ?').get(norm);
}

/**
 * Validate the envelope shape. Throws badRequest on anything that isn't a recognisable
 * mdp.requests v1 export. Returns the requests array.
 */
export function parseEnvelope(payload) {
  if (!payload || typeof payload !== 'object') throw badRequest('Import file is not valid JSON.');
  if (payload.type !== 'mdp.requests') throw badRequest('Not an MDP requests export (missing type "mdp.requests").');
  if (Number(payload.version) !== 1) throw badRequest(`Unsupported export version: ${payload.version}. This build imports version 1.`);
  if (!Array.isArray(payload.requests)) throw badRequest('Export has no "requests" array.');
  if (payload.requests.length === 0) throw badRequest('The export contains no requests.');
  if (payload.requests.length > 1000) throw badRequest('Too many requests in one import (max 1000).');
  return payload.requests;
}

/**
 * Classify each row for the preview WITHOUT writing anything.
 * @returns { importable:[{index,jira,summary,customer,component,size,status}],
 *            duplicates:[{index,jira,reason}], errors:[{index,jira,reason}], activeVersion }
 */
export function previewImport(payload) {
  const requests = parseEnvelope(payload);
  const active = getActiveVersion();

  const importable = [];
  const duplicates = [];
  const errors = [];
  const seenInFile = new Set(); // catch duplicates WITHIN the file too

  requests.forEach((r, i) => {
    const jira = String(r?.jiraReference || '').trim().toUpperCase();
    const where = { index: i, jira: jira || '(blank)' };

    // Minimum required header fields (mirror createEstimate's mandatory set).
    const missing = [];
    if (!jira) missing.push('jiraReference');
    if (!String(r?.summary || '').trim()) missing.push('summary');
    if (!String(r?.customerName || '').trim()) missing.push('customerName');
    if (!String(r?.cfu || '').trim()) missing.push('cfu');
    if (!String(r?.approver || '').trim()) missing.push('approver');
    if (!String(r?.component || '').trim()) missing.push('component');
    if (!String(r?.size || '').trim()) missing.push('size');
    if (missing.length) { errors.push({ ...where, reason: `missing ${missing.join(', ')}` }); return; }

    if (!active) { errors.push({ ...where, reason: 'no active Menu Card to pin' }); return; }

    if (seenInFile.has(jira)) { duplicates.push({ ...where, reason: 'duplicate within the file' }); return; }
    seenInFile.add(jira);

    if (jiraExists(jira)) { duplicates.push({ ...where, reason: 'JIRA already exists in MDP' }); return; }

    const statusRaw = String(r?.status || '').trim().toUpperCase();
    const status = VALID_STATUSES.has(statusRaw) ? statusRaw : EstimateStatus.NEW;

    importable.push({
      index: i, jira, summary: String(r.summary).trim(),
      customer: String(r.customerName).trim(), component: String(r.component).trim(),
      size: String(r.size).trim(), status,
      statusSanitised: statusRaw !== status, // flag if we had to fall back to NEW
    });
  });

  return {
    activeVersion: active ? { id: active.id, label: active.label, financialYear: active.financialYear } : null,
    counts: { total: requests.length, importable: importable.length, duplicates: duplicates.length, errors: errors.length },
    importable, duplicates, errors,
  };
}

/**
 * Commit the import: create every importable row (header-only), preserving status, attributed to
 * `importerId`. Returns the per-row outcomes. Duplicates/errors are reported, not created.
 * The caller writes the audit events (it has the principal + wants ESTIMATE_CREATE per row).
 * @returns { created:[{index,jira,id,status}], skipped:[...duplicates...], errors:[...], activeVersion }
 */
export function commitImport(payload, importerId) {
  const preview = previewImport(payload);
  const requests = payload.requests;
  const active = getActiveVersion();
  if (!active) throw badRequest('No active Menu Card — an administrator must activate one before importing.');

  const db = getDb();
  const created = [];
  const failed = [];

  for (const item of preview.importable) {
    const r = requests[item.index];
    try {
      // Header-only create (pins active version, assigns MDP-XXXX, status defaults to NEW).
      const est = createEstimate({
        jiraReference: r.jiraReference,
        summary: r.summary,
        customerName: r.customerName,
        cfu: r.cfu,
        approver: r.approver,
        component: r.component,
        size: r.size,
        externalRef: r.externalRef ?? undefined,
        ipCode: r.ipCode ?? undefined,
        ioReference: r.ioReference ?? undefined,
        remarks: r.remarks ?? undefined,
        menuCardVersionId: active.id,
        createdById: importerId,
      });

      // Preserve the exported status (createEstimate always starts NEW). Set it directly — this is
      // a fresh imported record, so the normal changeStatus transition guards don't apply.
      if (item.status !== 'NEW') {
        db.prepare('UPDATE estimates SET status = ? WHERE id = ?').run(item.status, est.id);
      }

      created.push({ index: item.index, jira: item.jira, id: est.id, status: item.status });
    } catch (err) {
      // A row that slipped past preview (e.g. a race on JIRA uniqueness) is reported, not fatal.
      failed.push({ index: item.index, jira: item.jira, reason: err?.message || 'create failed' });
    }
  }

  return {
    activeVersion: preview.activeVersion,
    counts: {
      total: preview.counts.total,
      created: created.length,
      skipped: preview.duplicates.length,
      errors: preview.errors.length + failed.length,
    },
    created,
    skipped: preview.duplicates,
    errors: [...preview.errors, ...failed],
  };
}
