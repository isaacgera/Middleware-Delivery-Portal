/**
 * Generated-document records (Stage 7).
 *
 * NOTE on the client-side-jsPDF approach: because BT's network blocks npm (design §0), the PDF
 * is generated IN THE BROWSER with vendored jsPDF and delivered straight to the user — the
 * server never holds the file bytes. So we record the export as METADATA only (who/when/which
 * pinned version/filename/size) for audit + traceability; `file_path` is the marker
 * 'client-generated' rather than a real server path. If PDF generation ever moves server-side
 * (e.g. a Nexus registry appears and pdfmake becomes installable), this record gains a real
 * stored path with no schema change.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';

const CLIENT_MARKER = 'client-generated';

/** Record a generated document for a request. Returns the stored row (view shape). */
export function recordGeneratedDocument({ estimateId, fileName, menuCardVersionId, generatedById, sizeBytes }) {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO generated_documents
         (id, estimate_id, format, file_path, file_name, menu_card_version_id, generated_by_id, size_bytes)
       VALUES (?, ?, 'PDF', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      estimateId,
      CLIENT_MARKER,
      String(fileName || 'request.pdf'),
      menuCardVersionId ?? null,
      generatedById,
      Number.isFinite(Number(sizeBytes)) ? Math.round(Number(sizeBytes)) : 0,
    );
  return getGeneratedDocument(id);
}

export function getGeneratedDocument(id) {
  const r = getDb().prepare('SELECT * FROM generated_documents WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id,
    estimateId: r.estimate_id,
    format: r.format,
    fileName: r.file_name,
    filePath: r.file_path,
    menuCardVersionId: r.menu_card_version_id ?? null,
    generatedById: r.generated_by_id,
    generatedAt: r.generated_at,
    sizeBytes: r.size_bytes,
  };
}

/** List generated-document records for a request (newest first). */
export function listGeneratedDocuments(estimateId) {
  return getDb()
    .prepare('SELECT * FROM generated_documents WHERE estimate_id = ? ORDER BY generated_at DESC, id DESC')
    .all(estimateId)
    .map((r) => ({
      id: r.id,
      fileName: r.file_name,
      generatedAt: r.generated_at,
      sizeBytes: r.size_bytes,
      generatedById: r.generated_by_id,
    }));
}
