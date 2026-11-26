import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { yuan } from '../../xhs/format.js';
import { MIN_ORDERS, followHistory, simulate } from '../../xhs/ad-sim.js';

/* Promotion simulator card (Data → 광고기록, post detail 4 · 광고). Keys: sim.* */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const y = (v) => (isNum(v) ? yuan(v) : '–');
const range = (r) => (r ? `${y(r.min)} ~ ${y(r.median)} ~ ${y(r.max)}` : '–');

function resultHtml(history, spend, credit) {
  const r = simulate(history, { spend, credit });
  if (!r) return `<p class="mt-3 text-[13px] text-muted">${esc(t(history.rate ? 'sim.enter' : 'sim.noHistory'))}</p>`;
  const f = r.followers;
  const kpi = (label, value, sub = '') => `<div class="kpi"><p class="kpi-label">${esc(label)}</p><p class="kpi-value tabular-nums">${esc(value)}</p>${sub ? `<p class="text-[11px] opacity-75">${esc(sub)}</p>` : ''}</div>`;
  return `<div class="kpi-grid mt-3">
      ${kpi(t('sim.total'), y(r.total), t('sim.totalSub'))}
      ${kpi(t('sim.followers'), t('sim.people', { n: f.median }), t('sim.rangePeople', { min: f.min, max: f.max }))}
      ${kpi(t('sim.realCost'), y(r.realCost.median), t('sim.rangeCost', { best: y(r.realCost.best), worst: y(r.realCost.worst) }))}
      ${kpi(t('sim.creditShare'), `${Math.round(r.creditShare * 100)}%`, r.perTotal != null ? t('sim.perTotal', { v: y(r.perTotal) }) : '')}
    </div>`;
}

export function adSimHtml(posts) {
  const h = followHistory(posts);
  const spend = isNum(h.spend) ? Math.round(h.spend) : '';
  const hist = h.n
    ? `<p class="mt-1 text-[13px] leading-relaxed">${esc(t('sim.history', { n: h.n, cost: range(h.cost) }))}${h.zeroFollow ? ` ${esc(t('sim.zero', { n: h.zeroFollow }))}` : ''}${h.reference ? ` <span class="badge bg-surface-2" title="${esc(t('sim.refHelp', { n: MIN_ORDERS }))}">${esc(t('ops.ref'))}</span>` : ''}</p>`
    : '';
  return `<section class="card mt-3" id="ad-sim"><h2 class="text-[16px] font-semibold">${esc(t('sim.title'))}</h2>${hist}
    ${h.n ? `<div class="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
      <label class="field"><span class="field-label">${esc(t('sim.spend'))}</span><input class="input tabular-nums" inputmode="decimal" id="sim-spend" value="${spend}" placeholder="0" /></label>
      <label class="field"><span class="field-label">${esc(t('sim.credit'))}</span><input class="input tabular-nums" inputmode="decimal" id="sim-credit" value="" placeholder="0" /></label></div>` : ''}
    <div id="sim-out">${resultHtml(h, spend === '' ? null : spend, 0)}</div>
    <p class="mt-2 text-[12px] text-muted">${esc(t('sim.note'))}</p></section>`;
}

/** Recalculates while typing. */
export function bindAdSim(root, posts) {
  const h = followHistory(posts);
  const read = (id) => {
    const v = Number(String(root.querySelector(id)?.value ?? '').replace(/[,元¥\s]/g, ''));
    return Number.isFinite(v) ? v : null;
  };
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'sim-spend' && e.target.id !== 'sim-credit') return;
    const out = root.querySelector('#sim-out');
    if (out) out.innerHTML = resultHtml(h, read('#sim-spend'), read('#sim-credit') ?? 0);
  });
}
