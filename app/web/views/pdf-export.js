/**
 * Request → customer-facing PDF (Stage 7).
 *
 * Client-side generation with jsPDF (vendored locally, no CDN) — chosen over the original
 * server-side pdfmake plan because BT's network blocks npm installs (design §0). Follows the
 * ios-pwa-patterns rule: GENERATE the artifact in-app, then DELIVER adaptively
 *   - touch / mobile (incl. installed PWA): navigator.share({files}) → native share sheet
 *   - desktop: download the file
 * with a last-resort fallback so the control never dead-ends. The library is loaded lazily so a
 * missing/blocked vendor file can't break the rest of the app.
 *
 * Document sections (design §7 / task 7.2): Cover, Summary, Line-Item Breakdown, Assumptions,
 * Exclusions, Cost Summary, Generated Date + Menu Card version info.
 *
 * The figures come straight from the loaded request object (snapshotted line values + the
 * server-computed totals) — the PDF never recomputes anything.
 */

// Brand accent (matches the app's primary token, kept literal here for the canvas context).
const BRAND = [10, 102, 194];
const INK = [26, 36, 48];
const MUTED = [138, 148, 163];

const COMPONENT_LABEL = { MQ: 'MQ', WLS: 'WLS', WILDFLY: 'WFY', CFT: 'CFT' };
const STATUS_LABEL = {
  NEW: 'New', PENDING: 'Pending', APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress', DONE: 'Done', ARCHIVED: 'Archived', CANCELLED: 'Cancelled',
};

function compLabel(code) { return COMPONENT_LABEL[code] || code; }
function money(n) {
  if (typeof n !== 'number') return String(n ?? '');
  return 'GBP ' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function numText(n) {
  return (n === null || n === undefined || n === '') ? '' : String(n);
}

/** Detect a touch/mobile context (coarse pointer), with a UA fallback. */
function isMobile() {
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* ignore */ }
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

let _jsPDFPromise = null;
/**
 * Load the self-contained UMD build of jsPDF by injecting a <script> tag (it attaches to the
 * global scope — not an ES module, so it can't be import()ed). Vendored at web/vendor/.
 */
function loadJsPDF() {
  if (_jsPDFPromise) return _jsPDFPromise;
  _jsPDFPromise = new Promise((resolve, reject) => {
    const existing = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (existing) { resolve(existing); return; }
    const s = document.createElement('script');
    // resolve the vendor path relative to this module, independent of the page URL
    s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    s.onload = () => {
      const jsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (jsPDF) resolve(jsPDF);
      else reject(new Error('jsPDF loaded but was not found on the global scope.'));
    };
    s.onerror = () => reject(new Error('Could not load the PDF library (vendor/jspdf.umd.min.js).'));
    document.head.appendChild(s);
  });
  return _jsPDFPromise;
}

/** Build a safe filename from the JIRA reference. */
function buildFilename(est) {
  const ref = String(est.jiraReference || 'request').replace(/[^a-z0-9._-]+/gi, '-');
  return `MDP-${ref}.pdf`;
}

/**
 * Render the request into a jsPDF document and return { doc, filename, blob }.
 * Portrait A4, points. No I/O or delivery here — pure build (easier to test/reuse).
 */
async function buildRequestDoc(est) {
  const jsPDF = await loadJsPDF();
  if (!jsPDF) throw new Error('PDF library could not be loaded.');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin;

  const t = est.totals || {};
  const generatedAt = new Date().toLocaleString('en-GB');

  // Keep a bottom margin; add a page when we'd overflow.
  const ensureSpace = (needed) => {
    if (y + needed > pageH - margin - 24) { // 24 reserved for footer
      doc.addPage();
      y = margin;
    }
  };

  const footerEachPage = () => {
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text('Powered by Forjé', margin, pageH - 18);
      doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 18, { align: 'right' });
      doc.text(`${est.jiraReference} — generated ${generatedAt}`, pageW / 2, pageH - 18, { align: 'center' });
    }
  };

  // Section heading helper. A little lead-in space above gives each section room to breathe.
  const heading = (text) => {
    ensureSpace(44);
    y += 10; // lead-in gap before the section title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BRAND);
    doc.text(text, margin, y);
    y += 9;
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(0.8);
    doc.line(margin, y, margin + contentW, y);
    y += 20;
    doc.setTextColor(...INK);
  };

  // key/value label row.
  const kv = (label, value) => {
    const v = (value === null || value === undefined || value === '') ? '—' : String(value);
    const lines = doc.splitTextToSize(v, contentW - 140);
    const rowH = Math.max(14, lines.length * 12);
    ensureSpace(rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(String(label), margin, y + 9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(lines, margin + 130, y + 9);
    y += rowH + 2;
  };

  // ---- Cover ----
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...BRAND);
  doc.text('Middleware Delivery Portal', margin, y + 10);
  y += 32;
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text('Estimate / Request Summary', margin, y + 6);
  y += 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(String(est.jiraReference || ''), margin, y);
  y += 24;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(String(est.summary || ''), contentW), margin, y);
  y += 30;

  // ---- Summary (two-column grid, no boxes/lines) ----
  // "Recorded by" is the creator's display name (role-agnostic — could be a Delivery Manager or
  // an Administrator), with the date it was created/received. Size is intentionally omitted.
  heading('Summary');
  const fmtDate = (s) => {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
    return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('en-GB');
  };
  const summaryPairs = [
    ['Customer', est.customerName],
    ['CFU', est.cfu],
    ['Component', compLabel(est.component)],
    ['Approver', est.approver],
    ['Status', STATUS_LABEL[est.status] || est.status],
    ['Recorded by', est.createdByName || '—'],
    ['Date received', fmtDate(est.createdAt)],
  ];
  if (est.externalRef) summaryPairs.push(['External Ref', est.externalRef]);
  if (est.ipCode) summaryPairs.push(['IP Code', est.ipCode]);
  if (est.ioReference) summaryPairs.push(['IO Reference', est.ioReference]);

  // Two-column grid: fields laid out left-then-right, label above value, no boxes/dividers.
  const colGap = 24;
  const gridColW = (contentW - colGap) / 2;
  const colX = [margin, margin + gridColW + colGap];
  const cellH = 40;
  for (let i = 0; i < summaryPairs.length; i += 2) {
    ensureSpace(cellH);
    for (let c = 0; c < 2; c++) {
      const pair = summaryPairs[i + c];
      if (!pair) break;
      const [label, value] = pair;
      const x = colX[c];
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(String(label).toUpperCase(), x, y + 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      const vLines = doc.splitTextToSize(String(value ?? '—'), gridColW);
      doc.text(vLines, x, y + 21);
    }
    y += cellH;
  }
  y += 6;

  // Line-Item Breakdown intentionally removed from the customer PDF (Isaac, 2026-10-28).

  // ---- Cost Summary ----  (PD + ATOM removed; Story Points, TCS Cost, FTE Cost retained)
  heading('Cost Summary');
  const summaryW = contentW; // right-align totals to the content edge
  const summaryRows = [
    ['Story Points', numText(t.totalUsp)],
    ['TCS Cost', money(t.totalUspCost)],
    ['FTE Cost', money(t.totalOverheadCost)],
  ];
  doc.setFontSize(10);
  for (const [label, value] of summaryRows) {
    ensureSpace(20);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK);
    doc.text(label, margin, y + 9);
    doc.text(value, margin + summaryW, y + 9, { align: 'right' });
    y += 20;
  }
  // Grand total — emphasised
  ensureSpace(30);
  y += 6;
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + summaryW, y);
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND);
  doc.text('Grand Total', margin, y + 10);
  doc.text(money(t.grandTotalCost), margin + summaryW, y + 10, { align: 'right' });
  y += 28;
  doc.setTextColor(...INK);

  // Assumptions, Exclusions and Menu Card Version intentionally removed (Isaac, 2026-10-28).

  // ---- Remarks / Comments (retained) ----
  if (est.remarks) {
    heading('Remarks');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(String(est.remarks), contentW);
    ensureSpace(wrapped.length * 13 + 2);
    doc.text(wrapped, margin, y + 9);
    y += wrapped.length * 13 + 4;
  }

  footerEachPage();

  const blob = doc.output('blob');
  return { doc, filename: buildFilename(est), blob };
}

/** Deliver a blob adaptively (share on mobile, download on desktop, jsPDF.save fallback). */
async function deliver(doc, blob, filename, title) {
  if (isMobile() && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return { delivered: 'share' };
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return { delivered: 'cancelled' };
      // fall through to download
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { delivered: 'download' };
  } catch {
    doc.save(filename);
    return { delivered: 'save' };
  }
}

/**
 * EXPORT: build + deliver the PDF. Returns delivery info + filename + byte size so the caller
 * can record a GeneratedDocument server-side (ESTIMATE_EXPORT).
 */
export async function exportRequestPdf(est) {
  const { doc, filename, blob } = await buildRequestDoc(est);
  const result = await deliver(doc, blob, filename, `Request ${est.jiraReference}`);
  return { ...result, filename, sizeBytes: blob.size };
}

/**
 * PREVIEW: build + open the PDF in a new tab (no server record, per design §6). Falls back to
 * the same adaptive delivery if the browser blocks the popup.
 */
export async function previewRequestPdf(est) {
  const { doc, filename, blob } = await buildRequestDoc(est);
  try {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) { // popup blocked — fall back to delivery
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return deliver(doc, blob, filename, `Request ${est.jiraReference}`);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { delivered: 'preview', filename };
  } catch {
    return deliver(doc, blob, filename, `Request ${est.jiraReference}`);
  }
}

/**
 * Bulk export: a landscape summary TABLE of many requests (Stage 9 part iii).
 * Generic — the caller supplies the title, column labels, and rows (string cells). Paginates
 * across pages, repeats the header, and delivers adaptively (download desktop / share mobile).
 * @param {object} opts { title, columns:string[], rows:string[][], filename }
 */
export async function exportRequestsTablePdf({ title, columns, rows, filename }) {
  const jsPDF = await loadJsPDF();
  if (!jsPDF) throw new Error('PDF library could not be loaded.');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 32;
  const contentW = pageW - margin * 2;
  const generatedAt = new Date().toLocaleString('en-GB');

  // Proportional column widths tuned for the request export (Summary widest; costs/counts narrow).
  // Falls back to equal widths if the column count doesn't match the known layout.
  const weightsByCount = {
    10: [1.4, 3.2, 1.8, 1.2, 1.1, 0.7, 1.5, 1.2, 0.7, 1.4], // the EXPORT_COLUMNS layout
  };
  const weights = weightsByCount[columns.length] || columns.map(() => 1);
  const wsum = weights.reduce((s, w) => s + w, 0);
  const colW = weights.map((w) => (w / wsum) * contentW);

  const headH = 18;
  let y = margin;

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...BRAND);
    doc.text(String(title || 'Requests'), margin, y + 4);
    y += 18;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${generatedAt} · ${rows.length} request${rows.length === 1 ? '' : 's'}`, margin, y);
    y += 12;
    drawColumnHeader();
  };

  const drawColumnHeader = () => {
    doc.setFillColor(...BRAND);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.rect(margin, y, contentW, headH, 'F');
    let x = margin;
    columns.forEach((label, i) => {
      doc.text(String(label), x + 4, y + 12, { maxWidth: colW[i] - 6 });
      x += colW[i];
    });
    y += headH;
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'normal');
  };

  header();

  doc.setFontSize(8);
  rows.forEach((cells, r) => {
    // Wrap each cell to its column width; the row height grows to the tallest cell.
    const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c ?? ''), colW[i] - 8));
    const lines = Math.max(1, ...wrapped.map((w) => w.length));
    const rowH = Math.max(14, lines * 9 + 5);

    if (y + rowH > pageH - margin - 16) {
      doc.addPage();
      y = margin;
      drawColumnHeader();
    }
    if (r % 2 === 1) {
      doc.setFillColor(240, 242, 245);
      doc.rect(margin, y, contentW, rowH, 'F');
    }
    doc.setTextColor(...INK);
    let x = margin;
    wrapped.forEach((w, i) => {
      doc.text(w, x + 4, y + 10);
      x += colW[i];
    });
    y += rowH;
  });

  // Footer credit on each page.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Powered by Forjé', margin, pageH - 14);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 14, { align: 'right' });
  }

  const blob = doc.output('blob');
  return deliver(doc, blob, filename || 'mdp-requests.pdf', 'MDP Requests');
}

/**
 * Dashboard summary PDF (Stage 9 part iii): a portrait document of several small labelled tables
 * (KPIs + by-dimension breakdowns), reflecting the current dashboard filter. Generic:
 * @param {object} opts { title, subtitle, sections:[{ heading, columns:string[], rows:string[][] }], filename }
 */
export async function exportSummaryTablesPdf({ title, subtitle, sections, filename }) {
  const jsPDF = await loadJsPDF();
  if (!jsPDF) throw new Error('PDF library could not be loaded.');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  const generatedAt = new Date().toLocaleString('en-GB');
  let y = margin;

  const ensure = (needed) => { if (y + needed > pageH - margin - 20) { doc.addPage(); y = margin; } };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...BRAND);
  doc.text(String(title || 'Dashboard summary'), margin, y + 6); y += 24;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  if (subtitle) { doc.text(String(subtitle), margin, y); y += 12; }
  doc.text(`Generated ${generatedAt}`, margin, y); y += 18;
  doc.setTextColor(...INK);

  for (const sec of sections || []) {
    ensure(40);
    y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...BRAND);
    doc.text(String(sec.heading), margin, y); y += 6;
    doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(margin, y, margin + contentW, y); y += 12;
    doc.setTextColor(...INK);

    const cols = sec.columns;
    const colW = cols.map((_, i) => (i === 0 ? contentW * 0.5 : (contentW * 0.5) / (cols.length - 1)));
    // header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...MUTED);
    let x = margin;
    cols.forEach((c, i) => { doc.text(String(c), i === 0 ? x : x + colW[i] - 4, y, { align: i === 0 ? 'left' : 'right' }); x += colW[i]; });
    y += 12; doc.setTextColor(...INK); doc.setFont('helvetica', 'normal');
    for (const row of sec.rows) {
      ensure(14);
      x = margin;
      row.forEach((cell, i) => { doc.text(String(cell ?? ''), i === 0 ? x : x + colW[i] - 4, y, { align: i === 0 ? 'left' : 'right' }); x += colW[i]; });
      y += 13;
    }
    y += 6;
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text('Powered by Forjé', margin, pageH - 16);
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 16, { align: 'right' });
  }

  const blob = doc.output('blob');
  return deliver(doc, blob, filename || 'mdp-dashboard-summary.pdf', 'MDP Dashboard Summary');
}
