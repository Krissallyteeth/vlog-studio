import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';

/*
 * Small single-series line chart (one measure per chart — never two y-axes).
 *  - series colour: reference palette slot 1 (blue), stepped for dark mode via CSS variables
 *  - natural posts: filled dots; ad-mixed posts: hollow rings (shape, not colour alone)
 *  - fixed median: dashed grey reference line, direct-labelled
 *  - optional second series `y2` (the natural part of a count, ad traffic taken out): dashed, same axis
 *  - hover/focus: crosshair snaps to the nearest post, tooltip lists title, value, vs baseline
 */

export function lineChart(host, { points, baseline = null, baselineLabel = '', format, height = 190, title = '' }) {
  host.classList.add('chart-host');
  host._chart = { points, baseline, baselineLabel, format, height, title };
  if (!host._observer && typeof ResizeObserver !== 'undefined') {
    host._observer = new ResizeObserver(() => draw(host));
    host._observer.observe(host);
  }
  draw(host);
}

function draw(host) {
  const { points, baseline, baselineLabel, format, height, title } = host._chart;
  const W = Math.max(260, host.clientWidth || 600);
  const H = height;
  const pad = { l: 46, r: 14, t: 14, b: 24 };
  const vals = points.flatMap((p) => [p.y, p.y2]).filter((v) => typeof v === 'number');
  if (!vals.length) {
    host.innerHTML = `<p class="py-3 text-center text-[13px] text-muted sm:py-10">${esc(t('chart.noData'))}</p>`;
    return;
  }
  let lo = Math.min(...vals, baseline ?? Infinity);
  let hi = Math.max(...vals, baseline ?? -Infinity);
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const span = hi - lo;
  lo = Math.max(lo > 0 ? 0 : lo, lo - span * 0.1);
  hi += span * 0.1;
  const x = (i) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = [lo, (lo + hi) / 2, hi];
  const path = [];
  let pen = false;
  points.forEach((p, i) => {
    if (typeof p.y !== 'number') {
      pen = false;
      return;
    }
    path.push(`${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`);
    pen = true;
  });
  // The natural part: only drawn where an ad took some away (elsewhere it is the line itself).
  const path2 = [];
  let pen2 = false;
  points.forEach((p, i) => {
    const v = typeof p.y2 === 'number' ? p.y2 : typeof p.y === 'number' && !p.admixed ? p.y : null;
    if (v == null) {
      pen2 = false;
      return;
    }
    path2.push(`${pen2 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    pen2 = true;
  });
  const hasY2 = points.some((p) => typeof p.y2 === 'number');
  const every = Math.ceil(points.length / Math.max(2, Math.floor((W - pad.l) / 70)));
  host.innerHTML = `
    <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">
      ${ticks.map((v) => `<line class="chart-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`).join('')}
      ${points.map((p, i) => (i % every === 0 || i === points.length - 1 ? `<text class="chart-tick" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '')).join('')}
      ${typeof baseline === 'number' ? `<line class="chart-base" x1="${pad.l}" x2="${W - pad.r}" y1="${y(baseline)}" y2="${y(baseline)}"/><text class="chart-base-label" x="${W - pad.r}" y="${y(baseline) - 5}" text-anchor="end">${esc(baselineLabel)} ${esc(format(baseline))}</text>` : ''}
      <path class="chart-line" d="${path.join('')}"/>
      ${hasY2 ? `<path class="chart-line-2" d="${path2.join('')}"/>${points.map((p, i) => (typeof p.y2 === 'number' ? `<rect class="chart-dot-2" x="${x(i) - 3.5}" y="${y(p.y2) - 3.5}" width="7" height="7"/>` : '')).join('')}` : ''}
      ${points
        .map((p, i) =>
          typeof p.y === 'number'
            ? p.admixed
              ? `<circle class="chart-dot-ad" cx="${x(i)}" cy="${y(p.y)}" r="4.5"/>`
              : `<circle class="chart-dot" cx="${x(i)}" cy="${y(p.y)}" r="4"/>`
            : '',
        )
        .join('')}
      <line class="chart-cross" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
      <rect class="chart-hit" x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" tabindex="0"/>
    </svg>
    <div class="chart-tip" hidden></div>`;
  const svg = host.querySelector('svg');
  const tip = host.querySelector('.chart-tip');
  const cross = host.querySelector('.chart-cross');
  const show = (i) => {
    const p = points[i];
    if (!p) return;
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = typeof p.y === 'number' ? format(p.y) : '–';
    const name = document.createElement('span');
    name.textContent = p.title;
    const meta = document.createElement('span');
    meta.className = 'text-muted';
    meta.textContent = [p.date, p.admixed ? t('xg.admixed') : '', typeof baseline === 'number' && typeof p.y === 'number' && baseline !== 0 ? `${t('chart.vsBase')} ${((p.y / baseline - 1) * 100).toFixed(0)}%` : ''].filter(Boolean).join(' · ');
    tip.append(strong, name, meta);
    if (typeof p.y2 === 'number') {
      const nat = document.createElement('span');
      nat.className = 'block text-[11px]';
      nat.textContent = t('chart.split', { natural: format(p.y2), ad: format(Math.max(0, p.y - p.y2)) });
      tip.append(nat);
    }
    if (p.note) {
      const note = document.createElement('span');
      note.className = 'block text-[11px]';
      note.textContent = p.note;
      tip.append(note);
    }
    const left = Math.min(Math.max(0, x(i) - 90), W - 190);
    tip.style.left = `${left}px`;
  };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    return best;
  };
  let focusIdx = points.length - 1;
  svg.addEventListener('pointermove', (e) => show((focusIdx = nearest(e.clientX))));
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  });
  const hit = host.querySelector('.chart-hit');
  hit.addEventListener('focus', () => show(focusIdx));
  hit.addEventListener('blur', () => (tip.hidden = true));
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show((focusIdx = Math.max(0, focusIdx - 1)));
    if (e.key === 'ArrowRight') show((focusIdx = Math.min(points.length - 1, focusIdx + 1)));
  });
}

/** Legend shared by the charts: shape-coded, text in text colours. */
export const chartLegend = () => `<div class="chart-legend"><span><i class="lg-dot"></i>${esc(t('chart.natural'))}</span><span><i class="lg-ring"></i>${esc(t('chart.adMixed'))}</span><span><i class="lg-nat"></i>${esc(t('chart.naturalEst'))}</span><span><i class="lg-base"></i>${esc(t('chart.baseline'))}</span></div>`;
