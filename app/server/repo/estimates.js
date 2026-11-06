/**
 * Request ("estimate") data-access — headers + lines, the internal MDP-XXXX reference, the
 * user-typed JIRA reference, the status lifecycle, snapshot-on-add, and rowVersion
 * optimistic concurrency.
 *
 * Core principles (design §3–§4, §6.1, §9):
 *  - A request PINS a MenuCardVersion (`menu_card_version_id`) at creation time.
 *  - The request carries a Component + Size that SCOPE which catalogue variants its lines may
 *    be drawn from (see `scopedCatalogue`).
 *  - Each line SNAPSHOTS the variant's six values at add-time (snap_*). Re-importing or
 *    changing the active Menu Card later NEVER alters an existing request's figures.
 *  - Derived totals are NOT stored — they are computed on demand by engine.js.
 *  - `request_ref` is the backend-only `MDP-XXXX` key (auto, hidden). `jira_reference` is the
 *    user-typed, mandatory, UNIQUE handle shown everywhere.
 *  - `row_version` guards against lost updates; ANY header or line change bumps it (S4).
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import {
  EstimateStatus,
  EstimateStatusDefault,
  EstimateTerminalStatuses,
  REQUEST_REF_PREFIX,
  Component,
  CFU,
  SIZES,
} from '../constants.js';
import { computeEstimate } from '../engine.js';
import { conflict, badRequest, notFound } from '../http-util.js';
import { queryActiveCatalogue } from './menucards.js';

// ---- views ----

function toRequestView(row) {
  if (!row) return null;
  return {
    id: row.id,
    // requestRef (MDP-XXXX) is intentionally internal — not surfaced to the UI.
    jiraReference: row.jira_reference,
    summary: row.summary,
    customerName: row.customer_name,
    cfu: row.cfu,
    approver: row.approver,
    component: row.component,
    size: row.size,
    externalRef: row.external_ref ?? null,
    ipCode: row.ip_code ?? null,
    ioReference: row.io_reference ?? null,
    remarks: row.remarks ?? null,
    version: row.version,
    status: row.status,
    menuCardVersionId: row.menu_card_version_id,
    // Pinned Menu Card version info (present when the row was fetched with the join, e.g.
    // getEstimate; absent in the lightweight list query — hence the conditional).
    menuCardVersion: row.mcv_label !== undefined
      ? { label: row.mcv_label ?? null, financialYear: row.mcv_fy ?? null, sourceFilename: row.mcv_filename ?? null }
      : undefined,
    createdById: row.created_by_id,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: row.row_version,
  };
}

function toLineView(row) {
  return {
    id: row.id,
    estimateId: row.estimate_id,
    serviceVariantId: row.service_variant_id,
    component: row.component,
    size: row.size,
    description: row.description,
    quantity: row.quantity,
    snapPd: row.snap_pd,
    snapUsp: row.snap_usp,
    snapAtom: row.snap_atom,
    snapUspCost: row.snap_usp_cost,
    snapOverheadCost: row.snap_overhead_cost,
    snapTotalCost: row.snap_total_cost,
    notes: row.notes ?? null,
    sortOrder: row.sort_order,
  };
}

// ---- internal MDP-XXXX reference (backend key, never shown) ----

function nextRequestRef(db) {
  const rows = db.prepare('SELECT request_ref FROM estimates WHERE request_ref LIKE ?').all(`${REQUEST_REF_PREFIX}%`);
  let max = 0;
  const re = new RegExp(`^${REQUEST_REF_PREFIX}(\\d+)$`);
  for (const r of rows) {
    const m = re.exec(r.request_ref || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${REQUEST_REF_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

// ---- JIRA reference (user-typed, unique, mandatory) ----

/** Normalise a JIRA reference: trim + uppercase. No forced prefix (it comes from JIRA as-is). */
function normaliseJira(input) {
  const v = String(input || '').trim().toUpperCase();
  if (!v) throw badRequest('JIRA Reference is required');
  if (v.length > 50) throw badRequest('JIRA Reference must be at most 50 characters');
  return v;
}

function jiraInUse(jira, exceptId = null) {
  const row = exceptId
    ? getDb().prepare('SELECT id FROM estimates WHERE jira_reference = ? AND id != ?').get(jira, exceptId)
    : getDb().prepare('SELECT id FROM estimates WHERE jira_reference = ?').get(jira);
  return !!row;
}

// ---- mandatory-field validation shared by create/update ----

function validateCfu(v) {
  if (!CFU.includes(v)) throw badRequest(`CFU must be one of: ${CFU.join(', ')}`);
  return v;
}
function validateComponent(v) {
  const allowed = Object.values(Component);
  if (!allowed.includes(v)) throw badRequest(`Component must be one of: ${allowed.join(', ')}`);
  return v;
}
function validateSize(v) {
  if (!SIZES.includes(v)) throw badRequest(`Size must be one of: ${SIZES.join(', ')}`);
  return v;
}
function requireApprover(v) {
  const s = String(v || '').trim();
  if (!s) throw badRequest('Approver is required');
  if (s.length > 200) throw badRequest('Approver must be at most 200 characters');
  return s;
}

// ---- create ----

/**
 * Create a new request (header). Pins the given menu card version. Validates the mandatory
 * fields and JIRA-reference uniqueness inside a transaction; auto-assigns the internal ref.
 */
export function createEstimate({
  jiraReference, summary, customerName, cfu, approver, component, size,
  externalRef, ipCode, ioReference, remarks, menuCardVersionId, createdById,
}) {
  const db = getDb();

  const mcv = db.prepare('SELECT id FROM menu_card_versions WHERE id = ?').get(menuCardVersionId);
  if (!mcv) throw badRequest('The selected Menu Card version does not exist');

  const jira = normaliseJira(jiraReference);
  const summaryV = String(summary || '').trim();
  if (!summaryV) throw badRequest('Summary / Title is required');
  const customerV = String(customerName || '').trim();
  if (!customerV) throw badRequest('Customer is required');
  const cfuV = validateCfu(cfu);
  const approverV = requireApprover(approver);
  const componentV = validateComponent(component);
  const sizeV = validateSize(size);

  const id = randomUUID();
  db.exec('BEGIN');
  try {
    if (jiraInUse(jira)) {
      db.exec('ROLLBACK');
      throw conflict(`JIRA Reference "${jira}" is already in use. Choose another.`);
    }
    db.prepare(
      `INSERT INTO estimates
         (id, request_ref, jira_reference, summary, customer_name, cfu, approver, component, size,
          external_ref, ip_code, io_reference, remarks,
          version, status, menu_card_version_id, created_by_id, row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    ).run(
      id,
      nextRequestRef(db),
      jira,
      summaryV,
      customerV,
      cfuV,
      approverV,
      componentV,
      sizeV,
      externalRef ?? null,
      ipCode ?? null,
      ioReference ?? null,
      remarks ?? null,
      EstimateStatusDefault,
      menuCardVersionId,
      createdById,
    );
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(id);
}

// ---- clone ----

/**
 * Derive a unique JIRA reference for a clone by suffixing the source with -COPY, then
 * -COPY2, -COPY3, … until one is free. Kept within the 50-char limit by trimming the base.
 */
function deriveCloneJira(db, sourceJira) {
  const inUse = (j) => !!db.prepare('SELECT id FROM estimates WHERE jira_reference = ?').get(j);
  const base = String(sourceJira || '').trim().toUpperCase();
  for (let n = 1; n < 1000; n += 1) {
    const suffix = n === 1 ? '-COPY' : `-COPY${n}`;
    const room = 50 - suffix.length;
    const candidate = `${base.slice(0, Math.max(0, room))}${suffix}`;
    if (!inUse(candidate)) return candidate;
  }
  // Extremely unlikely fallback: a time-based suffix.
  return `COPY-${Date.now()}`.slice(0, 50);
}

/**
 * Clone a request: a new header (fresh internal MDP-XXXX, a derived unique JIRA reference,
 * status reset to the default NEW, rowVersion 0) plus a faithful copy of every line with its
 * SNAPSHOT values intact (so the clone carries the same figures, independent of the current
 * Menu Card). The pinned MenuCardVersion is preserved from the source. Done in one transaction.
 */
export function cloneEstimate(sourceId, createdById) {
  const db = getDb();
  const src = db.prepare('SELECT * FROM estimates WHERE id = ?').get(sourceId);
  if (!src) throw notFound('Request not found');

  const newId = randomUUID();
  db.exec('BEGIN');
  try {
    const newJira = deriveCloneJira(db, src.jira_reference);
    db.prepare(
      `INSERT INTO estimates
         (id, request_ref, jira_reference, summary, customer_name, cfu, approver, component, size,
          external_ref, ip_code, io_reference, remarks,
          version, status, menu_card_version_id, created_by_id, row_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    ).run(
      newId,
      nextRequestRef(db),
      newJira,
      `${src.summary} (copy)`.slice(0, 200),
      src.customer_name,
      src.cfu,
      src.approver,
      src.component,
      src.size,
      src.external_ref,
      src.ip_code,
      src.io_reference,
      src.remarks,
      EstimateStatusDefault,
      src.menu_card_version_id,
      createdById,
    );

    // Copy lines verbatim (snapshots + quantity + notes + order) under the new request id.
    const srcLines = db
      .prepare('SELECT * FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order, rowid')
      .all(sourceId);
    const insertLine = db.prepare(
      `INSERT INTO estimate_lines
         (id, estimate_id, service_variant_id, component, size, description, quantity,
          snap_pd, snap_usp, snap_atom, snap_usp_cost, snap_overhead_cost, snap_total_cost,
          notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of srcLines) {
      insertLine.run(
        randomUUID(), newId, l.service_variant_id, l.component, l.size, l.description, l.quantity,
        l.snap_pd, l.snap_usp, l.snap_atom, l.snap_usp_cost, l.snap_overhead_cost, l.snap_total_cost,
        l.notes, l.sort_order,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(newId);
}

// ---- reads ----

export function getEstimate(id) {
  const row = getDb()
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name,
              m.label AS mcv_label, m.financial_year AS mcv_fy, m.source_filename AS mcv_filename
         FROM estimates e
         LEFT JOIN users u ON u.id = e.created_by_id
         LEFT JOIN menu_card_versions m ON m.id = e.menu_card_version_id
        WHERE e.id = ?`,
    )
    .get(id);
  if (!row) return null;
  const lineRows = getDb()
    .prepare('SELECT * FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order, rowid')
    .all(id);
  const { lines, totals } = computeEstimate(lineRows);
  return {
    ...toRequestView(row),
    lines: lines.map((l) => ({ ...toLineView(l), computed: {
      linePd: l.linePd, lineUsp: l.lineUsp, lineAtom: l.lineAtom,
      lineUspCost: l.lineUspCost, lineOverheadCost: l.lineOverheadCost, lineTotalCost: l.lineTotalCost,
    } })),
    totals,
  };
}

/**
 * List/search requests. Filters are all optional; newest first.
 * ARCHIVED requests are HIDDEN by default — they surface only when the caller explicitly
 * filters for `status: 'ARCHIVED'` (the "view archived" path).
 */
export function listEstimates({ jira, customer, status, createdById, component, cfu } = {}) {
  const clauses = [];
  const params = [];
  if (jira) { clauses.push('e.jira_reference LIKE ?'); params.push(`%${jira.toUpperCase()}%`); }
  if (customer) { clauses.push('e.customer_name LIKE ?'); params.push(`%${customer}%`); }
  if (status) {
    // Explicit status filter (including status=ARCHIVED to view archived requests).
    clauses.push('e.status = ?');
    params.push(status);
  } else {
    // Default view excludes archived requests.
    clauses.push('e.status != ?');
    params.push(EstimateStatus.ARCHIVED);
  }
  if (createdById) { clauses.push('e.created_by_id = ?'); params.push(createdById); }
  if (component) { clauses.push('e.component = ?'); params.push(component); }
  if (cfu) { clauses.push('e.cfu = ?'); params.push(cfu); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name,
              (SELECT COUNT(*) FROM estimate_lines l WHERE l.estimate_id = e.id) AS line_count,
              (SELECT COALESCE(SUM(ROUND(l.snap_total_cost * 100) * l.quantity), 0)
                 FROM estimate_lines l WHERE l.estimate_id = e.id) AS grand_total_p,
              (SELECT COALESCE(SUM(ROUND(l.snap_usp_cost * 100) * l.quantity), 0)
                 FROM estimate_lines l WHERE l.estimate_id = e.id) AS tcs_p,
              (SELECT COALESCE(SUM(ROUND(l.snap_overhead_cost * 100) * l.quantity), 0)
                 FROM estimate_lines l WHERE l.estimate_id = e.id) AS fte_p,
              (SELECT COALESCE(SUM(l.snap_pd * l.quantity), 0)
                 FROM estimate_lines l WHERE l.estimate_id = e.id) AS total_pd
         FROM estimates e LEFT JOIN users u ON u.id = e.created_by_id
         ${where}
        ORDER BY e.created_at DESC, e.rowid DESC`,
    )
    .all(...params);
  return rows.map((r) => ({
    ...toRequestView(r),
    lineCount: r.line_count,
    // Money summed in integer pence (mirrors engine.js, no float drift) then back to pounds.
    grandTotalCost: Math.round(r.grand_total_p) / 100,
    tcsCost: Math.round(r.tcs_p) / 100,   // Vendor / TCS cost
    fteCost: Math.round(r.fte_p) / 100,   // FTE (overhead) cost
    totalPd: Math.round(r.total_pd * 10000) / 10000,
  }));
}

/**
 * The catalogue scoped to a request's Component + Size — the variants its lines may be drawn
 * from. Returns [] if the request has no lines-compatible active catalogue.
 */
export function scopedCatalogue(id) {
  const row = getDb().prepare('SELECT component, size FROM estimates WHERE id = ?').get(id);
  if (!row) throw notFound('Request not found');
  const { items } = queryActiveCatalogue({ components: [row.component], sizes: [row.size] });
  return { component: row.component, size: row.size, items };
}

// ---- header update ----

export function updateEstimateHeader(id, patch, expectedRowVersion) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
  if (!row) throw notFound('Request not found');
  assertRowVersion(row, expectedRowVersion);

  const hasLines = db.prepare('SELECT COUNT(*) AS n FROM estimate_lines WHERE estimate_id = ?').get(id).n > 0;

  const next = {
    jira_reference: patch.jiraReference !== undefined ? normaliseJira(patch.jiraReference) : row.jira_reference,
    summary: patch.summary !== undefined ? mustTrim(patch.summary, 'Summary / Title', 200) : row.summary,
    customer_name: patch.customerName !== undefined ? mustTrim(patch.customerName, 'Customer', 200) : row.customer_name,
    cfu: patch.cfu !== undefined ? validateCfu(patch.cfu) : row.cfu,
    approver: patch.approver !== undefined ? requireApprover(patch.approver) : row.approver,
    component: patch.component !== undefined ? validateComponent(patch.component) : row.component,
    size: patch.size !== undefined ? validateSize(patch.size) : row.size,
    external_ref: patch.externalRef !== undefined ? patch.externalRef : row.external_ref,
    ip_code: patch.ipCode !== undefined ? patch.ipCode : row.ip_code,
    io_reference: patch.ioReference !== undefined ? patch.ioReference : row.io_reference,
    remarks: patch.remarks !== undefined ? patch.remarks : row.remarks,
  };

  // Changing Component/Size would orphan lines drawn from the old scope — refuse while lines exist.
  if (hasLines && (next.component !== row.component || next.size !== row.size)) {
    throw conflict('Remove the line items before changing this request\u2019s Component or Size.');
  }

  db.exec('BEGIN');
  try {
    if (next.jira_reference !== row.jira_reference && jiraInUse(next.jira_reference, id)) {
      db.exec('ROLLBACK');
      throw conflict(`JIRA Reference "${next.jira_reference}" is already in use. Choose another.`);
    }
    db.prepare(
      `UPDATE estimates
          SET jira_reference = ?, summary = ?, customer_name = ?, cfu = ?, approver = ?,
              component = ?, size = ?, external_ref = ?, ip_code = ?, io_reference = ?, remarks = ?,
              row_version = row_version + 1, updated_at = datetime('now')
        WHERE id = ?`,
    ).run(
      next.jira_reference, next.summary, next.customer_name, next.cfu, next.approver,
      next.component, next.size, next.external_ref, next.ip_code, next.io_reference, next.remarks,
      id,
    );
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(id);
}

function mustTrim(v, label, max) {
  const s = String(v || '').trim();
  if (!s) throw badRequest(`${label} is required`);
  if (s.length > max) throw badRequest(`${label} must be at most ${max} characters`);
  return s;
}

// ---- status lifecycle ----

export function changeStatus(id, newStatus, expectedRowVersion) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM estimates WHERE id = ?').get(id);
  if (!row) throw notFound('Request not found');
  assertRowVersion(row, expectedRowVersion);

  if (!Object.values(EstimateStatus).includes(newStatus)) {
    throw badRequest('Unknown request status');
  }
  if (newStatus === row.status) return getEstimate(id); // no-op

  // CANCELLED rules (the only transition restriction in an otherwise any-to-any workflow):
  //  - can't cancel a finished/filed request (DONE or ARCHIVED → CANCELLED is blocked);
  //  - a cancelled request can be revived to an active status, but not sent straight to
  //    DONE/ARCHIVED (it must re-enter the active flow first).
  if (newStatus === EstimateStatus.CANCELLED && EstimateTerminalStatuses.includes(row.status)) {
    throw conflict('A completed or archived request cannot be cancelled.');
  }
  if (row.status === EstimateStatus.CANCELLED && EstimateTerminalStatuses.includes(newStatus)) {
    throw conflict('Revive the cancelled request to an active status before marking it Done or Archived.');
  }

  // Otherwise any-to-any transition is allowed by design — the user sets whatever status fits.
  db.prepare(
    `UPDATE estimates SET status = ?, row_version = row_version + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(newStatus, id);
  return getEstimate(id);
}

// ---- delete ----

export function deleteEstimate(id) {
  const db = getDb();
  const row = db.prepare('SELECT id FROM estimates WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM estimate_lines WHERE estimate_id = ?').run(id);
    db.prepare('DELETE FROM estimates WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return { ok: true };
}

// ---- lines ----

/**
 * Add a line by snapshotting a service variant's six values AT THIS MOMENT. The variant must
 * match the request's Component + Size scope. Bumps the parent request's row_version (S4).
 */
export function addLine(estimateId, { serviceVariantId, quantity = 1, notes }, expectedRowVersion) {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  if (!est) throw notFound('Request not found');
  assertRowVersion(est, expectedRowVersion);

  const variant = db.prepare('SELECT * FROM service_variants WHERE id = ?').get(serviceVariantId);
  if (!variant) throw badRequest('Service variant not found');
  // Enforce the scope: the line must match the request's Component + Size.
  if (variant.component !== est.component || variant.size !== est.size) {
    throw badRequest(`This request only accepts ${est.component} / ${est.size} services.`);
  }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw badRequest('Quantity must be greater than zero');

  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM estimate_lines WHERE estimate_id = ?')
    .get(estimateId).m;

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO estimate_lines
         (id, estimate_id, service_variant_id, component, size, description, quantity,
          snap_pd, snap_usp, snap_atom, snap_usp_cost, snap_overhead_cost, snap_total_cost,
          notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      estimateId,
      variant.id,
      variant.component,
      variant.size,
      variant.description,
      qty,
      variant.pd,
      variant.usp,
      variant.atom,
      variant.usp_cost,
      variant.overhead_cost,
      variant.total_cost,
      notes ?? null,
      maxOrder + 1,
    );
    bumpRowVersion(db, estimateId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(estimateId);
}

/** Edit a line's quantity/notes only. Snapshot values are immutable. Bumps row_version. */
export function updateLine(estimateId, lineId, { quantity, notes }, expectedRowVersion) {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  if (!est) throw notFound('Request not found');
  assertRowVersion(est, expectedRowVersion);

  const line = db.prepare('SELECT * FROM estimate_lines WHERE id = ? AND estimate_id = ?').get(lineId, estimateId);
  if (!line) throw notFound('Line not found');

  let qty = line.quantity;
  if (quantity !== undefined) {
    qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw badRequest('Quantity must be greater than zero');
  }
  const nextNotes = notes !== undefined ? (notes ?? null) : line.notes;

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE estimate_lines SET quantity = ?, notes = ? WHERE id = ?').run(qty, nextNotes, lineId);
    bumpRowVersion(db, estimateId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(estimateId);
}

/** Delete a line. Bumps row_version. */
export function deleteLine(estimateId, lineId, expectedRowVersion) {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  if (!est) throw notFound('Request not found');
  assertRowVersion(est, expectedRowVersion);

  const line = db.prepare('SELECT id FROM estimate_lines WHERE id = ? AND estimate_id = ?').get(lineId, estimateId);
  if (!line) throw notFound('Line not found');

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM estimate_lines WHERE id = ?').run(lineId);
    bumpRowVersion(db, estimateId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(estimateId);
}

/** Duplicate a line (copies its snapshot + quantity + notes, appended at the end). */
export function duplicateLine(estimateId, lineId, expectedRowVersion) {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  if (!est) throw notFound('Request not found');
  assertRowVersion(est, expectedRowVersion);

  const line = db.prepare('SELECT * FROM estimate_lines WHERE id = ? AND estimate_id = ?').get(lineId, estimateId);
  if (!line) throw notFound('Line not found');

  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM estimate_lines WHERE estimate_id = ?')
    .get(estimateId).m;

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO estimate_lines
         (id, estimate_id, service_variant_id, component, size, description, quantity,
          snap_pd, snap_usp, snap_atom, snap_usp_cost, snap_overhead_cost, snap_total_cost,
          notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      estimateId,
      line.service_variant_id,
      line.component,
      line.size,
      line.description,
      line.quantity,
      line.snap_pd,
      line.snap_usp,
      line.snap_atom,
      line.snap_usp_cost,
      line.snap_overhead_cost,
      line.snap_total_cost,
      line.notes,
      maxOrder + 1,
    );
    bumpRowVersion(db, estimateId);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already ended */ }
    throw err;
  }
  return getEstimate(estimateId);
}

// ---- helpers ----

function bumpRowVersion(db, estimateId) {
  db.prepare(
    `UPDATE estimates SET row_version = row_version + 1, updated_at = datetime('now') WHERE id = ?`,
  ).run(estimateId);
}

/** Optimistic-concurrency guard. If the caller supplied a rowVersion, it must match. */
function assertRowVersion(row, expected) {
  if (expected === undefined || expected === null) return; // caller opted out
  if (Number(expected) !== Number(row.row_version)) {
    throw conflict(
      'This request was changed by someone else since you loaded it. Reload and try again.',
      { currentRowVersion: row.row_version },
    );
  }
}
