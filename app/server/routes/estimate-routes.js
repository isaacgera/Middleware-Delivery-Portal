/**
 * Request ("estimate") routes (Stage 5) — available to BOTH roles (requireAuth).
 *   GET  /api/estimates                          -> list/search
 *   POST /api/estimates                          -> create (ESTIMATE_CREATE)
 *   GET  /api/estimates/:id                       -> header + lines + computed totals
 *   GET  /api/estimates/:id/catalogue             -> catalogue scoped to the request's Component+Size
 *   POST /api/estimates/:id/clone                 -> deep-copy a request (ESTIMATE_CREATE)
 *   POST /api/estimates/:id/export                -> record a client-generated PDF (ESTIMATE_EXPORT)
 *   GET  /api/estimates/:id/totals                -> computed totals only
 *   PATCH /api/estimates/:id                       -> header edit (ESTIMATE_MODIFY, rowVersion)
 *   POST /api/estimates/:id/status                -> status transition (ESTIMATE_MODIFY)
 *   DELETE /api/estimates/:id                      -> delete (ESTIMATE_DELETE)
 *   POST /api/estimates/:id/lines                 -> add line, snapshot-on-add (ESTIMATE_MODIFY)
 *   PATCH /api/estimates/:id/lines/:lineId         -> edit qty/notes (ESTIMATE_MODIFY)
 *   DELETE /api/estimates/:id/lines/:lineId        -> delete line (ESTIMATE_MODIFY)
 *   POST /api/estimates/:id/lines/:lineId/duplicate -> duplicate line (ESTIMATE_MODIFY)
 *
 * The JIRA Reference is user-typed (no auto-suggest); the internal MDP-XXXX ref is assigned in
 * the repo and never surfaced here. Writes ESTIMATE_CREATE / ESTIMATE_MODIFY / ESTIMATE_DELETE.
 */
import { readJsonBody, notFound, badRequest } from '../http-util.js';
import { requireAuth, requireRole } from '../auth.js';
import { requireString, optionalString, requireEnum } from '../validate.js';
import { AuditAction, EstimateStatus, Role } from '../constants.js';
import { getActiveVersion } from '../repo/menucards.js';
import { previewImport, commitImport } from '../repo/request-import.js';
import {
  createEstimate,
  cloneEstimate,
  getEstimate,
  listEstimates,
  scopedCatalogue,
  updateEstimateHeader,
  changeStatus,
  deleteEstimate,
  addLine,
  updateLine,
  deleteLine,
  duplicateLine,
} from '../repo/estimates.js';
import { writeEvent } from '../repo/audit.js';
import { recordGeneratedDocument } from '../repo/documents.js';

/** Read an optional integer rowVersion from a request body. */
function rowVersionOf(body) {
  const v = body?.rowVersion;
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw badRequest('rowVersion must be an integer');
  return n;
}

export function registerEstimateRoutes(router) {
  // GET /api/estimates — list/search (both roles)
  router.get('/api/estimates', async ({ req, res, query }) => {
    requireAuth(req, res);
    return {
      items: listEstimates({
        jira: query.get('jira') || undefined,
        customer: query.get('customer') || undefined,
        status: query.get('status') || undefined,
        createdById: query.get('createdBy') || undefined,
        component: query.get('component') || undefined,
        cfu: query.get('cfu') || undefined,
      }),
    };
  });

  // POST /api/estimates — create a new request, pinned to the active Menu Card
  router.post('/api/estimates', async ({ req, res }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);

    // Mandatory. (CFU / Component / Size values are validated against their lists in the repo.)
    const jiraReference = requireString(body, 'jiraReference', { max: 50, label: 'JIRA Reference' });
    const summary = requireString(body, 'summary', { max: 200, label: 'Summary / Title' });
    const customerName = requireString(body, 'customerName', { max: 200, label: 'Customer' });
    const cfu = requireString(body, 'cfu', { max: 50, label: 'CFU' });
    const approver = requireString(body, 'approver', { max: 200, label: 'Approver' });
    const component = requireString(body, 'component', { max: 20, label: 'Component' });
    const size = requireString(body, 'size', { max: 10, label: 'Size' });
    // Optional.
    const externalRef = optionalString(body, 'externalRef', { max: 100, label: 'External Ref' });
    const ipCode = optionalString(body, 'ipCode', { max: 100, label: 'IP Code' });
    const ioReference = optionalString(body, 'ioReference', { max: 100, label: 'IO Reference' });
    const remarks = optionalString(body, 'remarks', { max: 5000, label: 'Remarks' });

    const active = getActiveVersion();
    if (!active) {
      throw badRequest('No active Menu Card — an administrator must import and activate one before creating requests.');
    }

    const estimate = createEstimate({
      jiraReference, summary, customerName, cfu, approver, component, size,
      externalRef, ipCode, ioReference, remarks,
      menuCardVersionId: active.id,
      createdById: principal.id,
    });

    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_CREATE,
      objectType: 'Estimate',
      objectId: estimate.id,
      detail: { jiraReference: estimate.jiraReference, customerName: estimate.customerName },
    });
    return estimate;
  });

  // POST /api/estimates/import — bulk-import requests from an mdp.requests export (ADMIN only).
  // ?mode=preview (default) classifies rows and writes NOTHING; ?mode=commit creates the
  // importable ones (header-only, status preserved, attributed to the importing admin). Task 9.11.
  router.post('/api/estimates/import', async ({ req, res, query }) => {
    const principal = requireRole(req, res, Role.ADMINISTRATOR);
    const payload = await readJsonBody(req);
    const mode = (query.get('mode') || 'preview').toLowerCase();

    if (mode === 'preview') {
      return previewImport(payload);
    }
    if (mode === 'commit') {
      const result = commitImport(payload, principal.id);
      // One ESTIMATE_CREATE per created request, flagged as imported for a clean audit trail.
      for (const row of result.created) {
        writeEvent({
          userId: principal.id,
          action: AuditAction.ESTIMATE_CREATE,
          objectType: 'Estimate',
          objectId: row.id,
          detail: { imported: true, sourceJira: row.jira, status: row.status },
        });
      }
      return result;
    }
    throw badRequest('mode must be "preview" or "commit"');
  });

  // GET /api/estimates/:id — full request with lines + computed totals
  router.get('/api/estimates/:id', async ({ req, res, params }) => {
    requireAuth(req, res);
    const est = getEstimate(params.id);
    if (!est) throw notFound('Request not found');
    return est;
  });

  // GET /api/estimates/:id/catalogue — catalogue scoped to the request's Component + Size
  router.get('/api/estimates/:id/catalogue', async ({ req, res, params }) => {
    requireAuth(req, res);
    return scopedCatalogue(params.id);
  });

  // POST /api/estimates/:id/clone — deep-copy a request (new refs, lines + snapshots preserved)
  router.post('/api/estimates/:id/clone', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const est = cloneEstimate(params.id, principal.id);
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_CREATE,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { clonedFrom: params.id, jiraReference: est.jiraReference },
    });
    return est;
  });

  // POST /api/estimates/:id/export — record a client-generated PDF export (ESTIMATE_EXPORT).
  // The PDF itself is built + delivered in the browser (vendored jsPDF); this records the
  // export as metadata for audit/traceability. (Preview does NOT hit this — no record, per design §6.)
  router.post('/api/estimates/:id/export', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const est = getEstimate(params.id);
    if (!est) throw notFound('Request not found');

    const fileName = optionalString(body, 'fileName', { max: 200 }) || `MDP-${est.jiraReference}.pdf`;
    const sizeBytes = Number(body?.sizeBytes);

    const docRecord = recordGeneratedDocument({
      estimateId: est.id,
      fileName,
      menuCardVersionId: est.menuCardVersionId,
      generatedById: principal.id,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    });
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_EXPORT,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { format: 'PDF', fileName, documentId: docRecord.id },
    });
    return { ok: true, document: docRecord };
  });

  // GET /api/estimates/:id/totals — computed totals only (cheap poll for live totals)
  router.get('/api/estimates/:id/totals', async ({ req, res, params }) => {
    requireAuth(req, res);
    const est = getEstimate(params.id);
    if (!est) throw notFound('Request not found');
    return { totals: est.totals, rowVersion: est.rowVersion };
  });

  // PATCH /api/estimates/:id — header edit
  router.patch('/api/estimates/:id', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const patch = {};
    if (body.jiraReference !== undefined) patch.jiraReference = optionalString(body, 'jiraReference', { max: 50 });
    if (body.summary !== undefined) patch.summary = optionalString(body, 'summary', { max: 200 });
    if (body.customerName !== undefined) patch.customerName = optionalString(body, 'customerName', { max: 200 });
    if (body.cfu !== undefined) patch.cfu = optionalString(body, 'cfu', { max: 50 });
    if (body.approver !== undefined) patch.approver = optionalString(body, 'approver', { max: 200 });
    if (body.component !== undefined) patch.component = optionalString(body, 'component', { max: 20 });
    if (body.size !== undefined) patch.size = optionalString(body, 'size', { max: 10 });
    if (body.externalRef !== undefined) patch.externalRef = optionalString(body, 'externalRef', { max: 100 }) ?? null;
    if (body.ipCode !== undefined) patch.ipCode = optionalString(body, 'ipCode', { max: 100 }) ?? null;
    if (body.ioReference !== undefined) patch.ioReference = optionalString(body, 'ioReference', { max: 100 }) ?? null;
    if (body.remarks !== undefined) patch.remarks = optionalString(body, 'remarks', { max: 5000 }) ?? null;

    const est = updateEstimateHeader(params.id, patch, rowVersionOf(body));
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_MODIFY,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { change: 'header' },
    });
    return est;
  });

  // POST /api/estimates/:id/status — status transition (any-to-any)
  router.post('/api/estimates/:id/status', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const status = requireEnum(body, 'status', Object.values(EstimateStatus));

    // Capture the PREVIOUS status before changing, so the audit event records the full
    // transition { from, to } — the raw material for Stage 9 flow analytics (task 8.5).
    const before = getEstimate(params.id);
    if (!before) throw notFound('Request not found');
    const from = before.status;

    const est = changeStatus(params.id, status, rowVersionOf(body));
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_MODIFY,
      objectType: 'Estimate',
      objectId: est.id,
      // `status` kept for backward-compatibility with any existing reader; from/to is the
      // transition record used by flow analytics.
      detail: { change: 'status', from, to: status, status },
    });
    return est;
  });

  // DELETE /api/estimates/:id
  router.del('/api/estimates/:id', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const result = deleteEstimate(params.id);
    if (!result.ok) throw notFound('Request not found');
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_DELETE,
      objectType: 'Estimate',
      objectId: params.id,
    });
    return { ok: true };
  });

  // ---- lines ----

  // POST /api/estimates/:id/lines — add a line (snapshots the variant's six values)
  router.post('/api/estimates/:id/lines', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const serviceVariantId = requireString(body, 'serviceVariantId', { max: 100 });
    const quantity = body.quantity ?? 1;
    const notes = optionalString(body, 'notes', { max: 2000 });
    const est = addLine(params.id, { serviceVariantId, quantity, notes }, rowVersionOf(body));
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_MODIFY,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { change: 'line-add', serviceVariantId },
    });
    return est;
  });

  // PATCH /api/estimates/:id/lines/:lineId — edit quantity/notes only
  router.patch('/api/estimates/:id/lines/:lineId', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const patch = {};
    if (body.quantity !== undefined) patch.quantity = body.quantity;
    if (body.notes !== undefined) patch.notes = optionalString(body, 'notes', { max: 2000 }) ?? null;
    const est = updateLine(params.id, params.lineId, patch, rowVersionOf(body));
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_MODIFY,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { change: 'line-edit', lineId: params.lineId },
    });
    return est;
  });

  // DELETE /api/estimates/:id/lines/:lineId
  router.del('/api/estimates/:id/lines/:lineId', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    // DELETE carries no body; rowVersion can be supplied via header for concurrency if desired.
    const hdr = req.headers['x-row-version'];
    const expected = hdr !== undefined ? Number(hdr) : undefined;
    const est = deleteLine(params.id, params.lineId, Number.isInteger(expected) ? expected : undefined);
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_MODIFY,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { change: 'line-delete', lineId: params.lineId },
    });
    return est;
  });

  // POST /api/estimates/:id/lines/:lineId/duplicate
  router.post('/api/estimates/:id/lines/:lineId/duplicate', async ({ req, res, params }) => {
    const principal = requireAuth(req, res);
    const body = await readJsonBody(req);
    const est = duplicateLine(params.id, params.lineId, rowVersionOf(body));
    writeEvent({
      userId: principal.id,
      action: AuditAction.ESTIMATE_MODIFY,
      objectType: 'Estimate',
      objectId: est.id,
      detail: { change: 'line-duplicate', lineId: params.lineId },
    });
    return est;
  });
}
