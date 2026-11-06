/**
 * Tiny dependency-free chart/stat helpers (Stage 9) — hand-rolled inline SVG + HTML, themed via
 * the app's design tokens (so they follow light/dark). No Chart.js (npm is blocked).
 *
 * Accessibility: charts are NOT colour-only — every bar carries a visible value label, and the
 * SVG has role="img" + an aria-label summary. For the fullest a11y the caller should also render
 * the same data as text/table (the dashboards do).
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** A stat card: big number + label (+ optional sub-text). */
export function statCard(label, value, sub) {
  return `
    <div class="stat-card">
      <span class="stat-value">${esc(value)}</span>
      <span class="stat-label">${esc(label)}</span>
      ${sub ? `<span class="stat-sub">${esc(sub)}</span>` : ''}
    </div>`;
}

/**
 * A KPI summary card (dashboard headline) — label, big value, and optional sub-rows shown subtly
 * within the card. MDP-toned subtle gradient (styled in CSS). Sub-items: [{label, value}].
 * @param {object} opts { label, value, sub?: Array<{label,value}>, accent?: boolean }
 */
export function summaryCard({ label, value, sub = [], accent = false }) {
  const subRows = sub.length
    ? `<div class="summary-sub">${sub.map((s) =>
        `<span class="summary-sub-row">`
        + `<span class="summary-sub-label">${esc(s.label)}</span>`
        + `<span class="summary-sub-value">${esc(s.value)}`
        + (s.pct !== undefined && s.pct !== null ? ` <span class="summary-sub-pct">${esc(s.pct)}%</span>` : '')
        + `</span></span>`,
      ).join('')}</div>`
    : '';
  return `
    <div class="summary-card${accent ? ' summary-card-accent' : ''}">
      <span class="summary-label">${esc(label)}</span>
      <span class="summary-value">${esc(value)}</span>
      ${subRows}
    </div>`;
}

/**
 * Horizontal bar chart as inline SVG.
 * @param {Array<{label:string, value:number, display?:string}>} data
 * @param {object} [opts] { max?, ariaTitle?, unit? }
 * Each row: a label, a proportional bar, and a value label (always visible — not colour-only).
 */
export function barChart(data, opts = {}) {
  const rows = Array.isArray(data) ? data : [];
  const max = opts.max ?? Math.max(1, ...rows.map((d) => Number(d.value) || 0));
  const rowH = 30;
  const gap = 10;
  const labelW = 120;
  const valueW = 90;
  const chartW = 520;
  const barAreaW = chartW - labelW - valueW;
  const height = Math.max(rowH, rows.length * (rowH + gap));
  const ariaTitle = opts.ariaTitle || 'Bar chart';

  // Build a plain-text summary for screen readers.
  const summary = rows.map((d) => `${d.label}: ${d.display ?? d.value}`).join(', ');

  const bars = rows.map((d, i) => {
    const v = Number(d.value) || 0;
    const w = max > 0 ? Math.round((v / max) * barAreaW) : 0;
    const y = i * (rowH + gap);
    const display = esc(d.display ?? String(v));
    return `
      <g>
        <text x="0" y="${y + rowH / 2}" dominant-baseline="middle" class="chart-axis-label">${esc(d.label)}</text>
        <rect x="${labelW}" y="${y}" width="${Math.max(w, 2)}" height="${rowH}" rx="4" class="chart-bar"></rect>
        <text x="${labelW + Math.max(w, 2) + 8}" y="${y + rowH / 2}" dominant-baseline="middle" class="chart-value-label">${display}</text>
      </g>`;
  }).join('');

  if (!rows.length) {
    return '<p class="muted">No data to chart.</p>';
  }

  return `
    <svg class="bar-chart" viewBox="0 0 ${chartW} ${height}" width="100%" height="${height}"
         role="img" aria-label="${esc(ariaTitle)}: ${esc(summary)}">
      ${bars}
    </svg>`;
}

// Categorical palette (matches the --chart-N tokens in tokens.css).
const CHART_COLOURS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)',
  'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)',
];

function polarToXY(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
/** SVG path for a donut segment (outer arc + inner arc) from startAngle to endAngle (degrees). */
function donutSegmentPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const [ox1, oy1] = polarToXY(cx, cy, rOuter, startAngle);
  const [ox2, oy2] = polarToXY(cx, cy, rOuter, endAngle);
  const [ix2, iy2] = polarToXY(cx, cy, rInner, endAngle);
  const [ix1, iy1] = polarToXY(cx, cy, rInner, startAngle);
  return [
    `M ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)}`,
    `L ${ix2.toFixed(2)} ${iy2.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/**
 * Donut chart (proportions of a whole) as inline SVG + a compact legend.
 * @param {Array<{label:string, value:number, display?:string}>} data  non-zero slices are drawn
 * @param {object} [opts] { ariaTitle?, centreLabel? }
 * Accessible: role="img" + aria summary; the legend carries label + value + % as text
 * (so meaning never relies on colour alone).
 */
export function donut(data, opts = {}) {
  const rows = (Array.isArray(data) ? data : []).filter((d) => (Number(d.value) || 0) > 0);
  const total = rows.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const ariaTitle = opts.ariaTitle || 'Donut chart';
  if (!rows.length || total <= 0) return '<p class="muted">No data to chart.</p>';

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 80;
  const rInner = 48;

  const rMid = (rOuter + rInner) / 2;
  const ringW = rOuter - rInner;
  let angle = 0;
  const segs = [];
  const legend = [];
  rows.forEach((d, i) => {
    const v = Number(d.value) || 0;
    const frac = v / total;
    const sweep = frac * 360;
    const colour = CHART_COLOURS[i % CHART_COLOURS.length];
    // A single 100% slice can't be drawn as one SVG arc (start == end is ambiguous), so render
    // it as a stroked circle — a clean full ring. Partial slices use the arc path.
    if (sweep >= 359.999) {
      segs.push(`<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${colour}" stroke-width="${ringW}"></circle>`);
    } else {
      segs.push(`<path d="${donutSegmentPath(cx, cy, rOuter, rInner, angle, angle + sweep)}" fill="${colour}"></path>`);
    }
    const pct = Math.round(frac * 100);
    legend.push(
      `<li class="donut-legend-item">`
      + `<span class="donut-swatch" style="background:${colour}"></span>`
      + `<span class="donut-legend-label">${esc(d.label)}</span>`
      + `<span class="donut-legend-value">${esc(d.display ?? String(v))} <span class="donut-legend-pct">${pct}%</span></span>`
      + `</li>`,
    );
    angle += sweep;
  });

  const summary = rows.map((d) => `${d.label}: ${d.display ?? d.value} (${Math.round((Number(d.value) || 0) / total * 100)}%)`).join(', ');
  const centre = opts.centreLabel
    ? `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="donut-centre">${esc(opts.centreLabel)}</text>`
    : '';

  return `
    <div class="donut-wrap">
      <svg class="donut-chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"
           role="img" aria-label="${esc(ariaTitle)}: ${esc(summary)}">
        ${segs.join('')}
        ${centre}
      </svg>
      <ul class="donut-legend">${legend.join('')}</ul>
    </div>`;
}

/**
 * Line / trend chart (time series) as inline SVG.
 * @param {Array<{label:string, value:number, display?:string}>} data  ordered left→right
 * @param {object} [opts] { ariaTitle? }
 * Accessible: role="img" + aria summary listing each point.
 */
export function lineChart(data, opts = {}) {
  const rows = Array.isArray(data) ? data : [];
  const ariaTitle = opts.ariaTitle || 'Trend chart';
  if (!rows.length) return '<p class="muted">No data to chart.</p>';

  const w = 560;
  const h = 200;
  const padL = 36;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const max = Math.max(1, ...rows.map((d) => Number(d.value) || 0));
  const n = rows.length;
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - ((Number(v) || 0) / max) * plotH;

  const pts = rows.map((d, i) => [xAt(i), yAt(d.value)]);
  const linePath = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // Baseline + a couple of gridlines for readability.
  const baseline = `<line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" class="line-axis" />`;

  // x labels: show all if few, otherwise thin to ~6.
  const step = Math.ceil(n / 6);
  const xLabels = rows.map((d, i) => {
    if (n > 7 && i % step !== 0 && i !== n - 1) return '';
    return `<text x="${xAt(i).toFixed(1)}" y="${h - 12}" text-anchor="middle" class="line-x-label">${esc(d.label)}</text>`;
  }).join('');

  const dots = pts.map(([x, y], i) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="line-dot"><title>${esc(rows[i].label)}: ${esc(rows[i].display ?? rows[i].value)}</title></circle>`,
  ).join('');

  // Value labels above each point (no y-axis, so the numbers must be on the points themselves).
  // Nudge below the point instead when it's near the top, so labels don't clip off the chart.
  const valueLabels = pts.map(([x, y], i) => {
    const below = y < padT + 14;
    const ly = below ? y + 14 : y - 7;
    return `<text x="${x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" class="line-value-label">${esc(rows[i].display ?? String(rows[i].value))}</text>`;
  }).join('');

  const summary = rows.map((d) => `${d.label}: ${d.display ?? d.value}`).join(', ');

  return `
    <svg class="line-chart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}"
         role="img" aria-label="${esc(ariaTitle)}: ${esc(summary)}">
      ${baseline}
      <path d="${areaPath}" class="line-area" />
      <path d="${linePath}" class="line-path" fill="none" />
      ${dots}
      ${valueLabels}
      ${xLabels}
    </svg>`;
}
