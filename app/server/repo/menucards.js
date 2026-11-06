/**
 * Menu Card data-access — versions + their service variants, plus the single-ACTIVE
 * activation transaction (the authoritative guarantee that at most one version is ACTIVE).
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db.js';
import { config } from '../config.js';
import { MenuCardStatus } from '../constants.js';

const UPLOAD_DIR = join(config.docStorageDir, '..', 'menucard-uploads');

// ---- views ----

function toVersionView(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    financialYear: row.financial_year,
    sourceFilename: row.source_filename,
    status: row.status,
    blendedUspRate: row.blended_usp_rate,
    overheadPct: row.overhead_pct,
    peopleDayRate: row.people_day_rate,
    importSummary: row.import_summary ? JSON.parse(row.import_summary) : null,
    hasFile: !!row.stored_file_path,
    uploadedById: row.uploaded_by_id,
    uploadedAt: row.uploaded_at,
  };
}

export function toVariantView(row) {
  if (!row) return null;
  return {
    id: row.id,
    menuCardVersionId: row.menu_card_version_id,
    component: row.component,
    size: row.size,
    changeCategory: row.change_category,
    description: row.description,
    scope: row.scope ?? null,
    assumptions: row.assumptions ?? null,
    exclusions: row.exclusions ?? null,
    pd: row.pd,
    usp: row.usp,
    atom: row.atom,
    uspCost: row.usp_cost,
    overheadCost: row.overhead_cost,
    totalCost: row.total_cost,
    currentPartnerCost: row.current_partner_cost ?? null,
  };
}

// ---- create a DRAFT version with its variants (single transaction) ----

export function createDraftVersion({ version, variants, uploadedById, importSummary, fileBuffer }) {
  const db = getDb();
  const versionId = randomUUID();

  // Persist the original uploaded .xlsx (so it can be downloaded later).
  let storedFilePath = null;
  if (fileBuffer) {
    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
    storedFilePath = join(UPLOAD_DIR, `${versionId}.xlsx`);
    writeFileSync(storedFilePath, fileBuffer);
  }

  const insertVersion = db.prepare(
    `INSERT INTO menu_card_versions
       (id, label, financial_year, source_filename, status,
        blended_usp_rate, overhead_pct, people_day_rate, import_summary, stored_file_path, uploaded_by_id)
     VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
  );
  const insertVariant = db.prepare(
    `INSERT INTO service_variants
       (id, menu_card_version_id, component, size, change_category, description,
        scope, assumptions, exclusions, pd, usp, atom, usp_cost, overhead_cost, total_cost,
        current_partner_cost, effort_phases, row_index)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    insertVersion.run(
      versionId,
      version.label,
      version.financialYear,
      version.sourceFilename,
      version.blendedUspRate,
      version.overheadPct,
      version.peopleDayRate,
      importSummary ? JSON.stringify(importSummary) : null,
      storedFilePath,
      uploadedById,
    );
    for (const v of variants) {
      insertVariant.run(
        randomUUID(),
        versionId,
        v.component,
        v.size,
        v.changeCategory,
        v.description,
        v.scope ?? null,
        v.assumptions ?? null,
        v.exclusions ?? null,
        v.pd,
        v.usp,
        v.atom,
        v.uspCost,
        v.overheadCost,
        v.totalCost,
        v.currentPartnerCost ?? null,
        v.effortPhases ? JSON.stringify(v.effortPhases) : null,
        v.rowIndex ?? 0,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getVersion(versionId);
}

// ---- reads ----

export function listVersions() {
  return getDb()
    .prepare(
      `SELECT v.*, (SELECT COUNT(*) FROM service_variants sv WHERE sv.menu_card_version_id = v.id) AS variant_count
         FROM menu_card_versions v
        ORDER BY v.uploaded_at DESC`,
    )
    .all()
    .map((r) => ({ ...toVersionView(r), variantCount: r.variant_count }));
}

export function getVersion(id) {
  const row = getDb().prepare('SELECT * FROM menu_card_versions WHERE id = ?').get(id);
  if (!row) return null;
  const variants = getDb()
    .prepare('SELECT * FROM service_variants WHERE menu_card_version_id = ? ORDER BY component, row_index')
    .all(id)
    .map(toVariantView);
  return { ...toVersionView(row), variants };
}

export function getActiveVersion() {
  const row = getDb()
    .prepare("SELECT * FROM menu_card_versions WHERE status = 'ACTIVE' LIMIT 1")
    .get();
  return row ? toVersionView(row) : null;
}

// ---- activation (single-ACTIVE guarantee via transaction) ----

export function activateVersion(id) {
  const db = getDb();
  const target = db.prepare('SELECT * FROM menu_card_versions WHERE id = ?').get(id);
  if (!target) return { ok: false, reason: 'NOT_FOUND' };
  // Archived versions CAN be reactivated (the data is still here) — a DRAFT or ARCHIVED
  // version is promoted to ACTIVE, and whatever was ACTIVE is demoted to ARCHIVED.
  if (target.status === MenuCardStatus.ACTIVE) return { ok: true }; // already active, no-op

  db.exec('BEGIN');
  try {
    // demote any current ACTIVE to ARCHIVED, then promote the target — atomic.
    db.prepare("UPDATE menu_card_versions SET status = 'ARCHIVED' WHERE status = 'ACTIVE'").run();
    db.prepare("UPDATE menu_card_versions SET status = 'ACTIVE' WHERE id = ?").run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

export function archiveVersion(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM menu_card_versions WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  db.prepare("UPDATE menu_card_versions SET status = 'ARCHIVED' WHERE id = ?").run(id);
  return { ok: true };
}

// ---- delete (guarded) ----

/**
 * Delete a version and its variants. Refused if:
 *  - the version is ACTIVE (archive or switch active first), or
 *  - any estimate references it (would orphan pinned estimates / break snapshot integrity).
 */
export function deleteVersion(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM menu_card_versions WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  if (row.status === MenuCardStatus.ACTIVE) return { ok: false, reason: 'ACTIVE' };

  const ref = db
    .prepare('SELECT COUNT(*) AS n FROM estimates WHERE menu_card_version_id = ?')
    .get(id);
  if (ref.n > 0) return { ok: false, reason: 'REFERENCED', count: ref.n };

  db.exec('BEGIN');
  try {
    // variants cascade via FK ON DELETE CASCADE, but delete explicitly to be safe/portable.
    db.prepare('DELETE FROM service_variants WHERE menu_card_version_id = ?').run(id);
    db.prepare('DELETE FROM menu_card_versions WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

// ---- metadata edit (label + financial year only; never the as-imported values) ----

export function updateVersionMeta(id, { label, financialYear, sourceFilename }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM menu_card_versions WHERE id = ?').get(id);
  if (!row) return { ok: false, reason: 'NOT_FOUND' };
  db.prepare(
    'UPDATE menu_card_versions SET label = ?, financial_year = ?, source_filename = ? WHERE id = ?',
  ).run(
    label ?? row.label,
    financialYear ?? row.financial_year,
    sourceFilename ?? row.source_filename,
    id,
  );
  return { ok: true, version: toVersionView(db.prepare('SELECT * FROM menu_card_versions WHERE id = ?').get(id)) };
}

/** Returns {path, filename} for the stored original .xlsx, or null if none. */
export function getVersionFile(id) {
  const row = getDb()
    .prepare('SELECT stored_file_path, source_filename FROM menu_card_versions WHERE id = ?')
    .get(id);
  if (!row || !row.stored_file_path) return null;
  return { path: row.stored_file_path, filename: row.source_filename };
}

// ---- catalogue (variants of the active version) ----

// Fixed T-shirt size ordering for sorting (TO smallest → XXL largest).
const SIZE_ORDER = { TO: 0, XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6 };

/**
 * Query the active version's variants.
 * @param components string[] (optional) — filter to these components
 * @param sizes      string[] (optional) — filter to these sizes
 * Results sorted by component (alphabetical) then size (TO→XXL order).
 */
export function queryActiveCatalogue({ components, sizes } = {}) {
  const active = getActiveVersion();
  if (!active) return { activeVersion: null, items: [] };

  const clauses = ['menu_card_version_id = ?'];
  const params = [active.id];

  if (Array.isArray(components) && components.length) {
    clauses.push(`component IN (${components.map(() => '?').join(',')})`);
    params.push(...components);
  }
  if (Array.isArray(sizes) && sizes.length) {
    clauses.push(`size IN (${sizes.map(() => '?').join(',')})`);
    params.push(...sizes);
  }

  const rows = getDb()
    .prepare(`SELECT * FROM service_variants WHERE ${clauses.join(' AND ')}`)
    .all(...params)
    .map(toVariantView);

  rows.sort((a, b) => {
    if (a.component !== b.component) return a.component < b.component ? -1 : 1;
    const sa = SIZE_ORDER[a.size] ?? 99;
    const sb = SIZE_ORDER[b.size] ?? 99;
    if (sa !== sb) return sa - sb;
    // third level: USP ascending (meaningful where a component has several variants per
    // size, e.g. WLS). Fall back to description for a stable order.
    if ((a.usp ?? 0) !== (b.usp ?? 0)) return (a.usp ?? 0) - (b.usp ?? 0);
    return (a.description || '').localeCompare(b.description || '');
  });

  return { activeVersion: active, items: rows };
}

export function getVariant(id) {
  const row = getDb().prepare('SELECT * FROM service_variants WHERE id = ?').get(id);
  return row ? toVariantView(row) : null;
}

/** Distinct (component, size) pairs present in the active version — drives data-driven filters. */
export function getActiveFilters() {
  const active = getActiveVersion();
  if (!active) return { components: [], sizesByComponent: {} };
  const rows = getDb()
    .prepare(
      'SELECT DISTINCT component, size FROM service_variants WHERE menu_card_version_id = ? ORDER BY component, size',
    )
    .all(active.id);
  const components = [...new Set(rows.map((r) => r.component))];
  const sizesByComponent = {};
  for (const r of rows) {
    (sizesByComponent[r.component] ??= []).push(r.size);
  }
  return { components, sizesByComponent };
}
