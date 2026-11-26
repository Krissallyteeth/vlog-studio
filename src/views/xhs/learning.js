import { t } from '../../i18n/index.js';
import { esc, toast } from '../../ui/dom.js';
import { getMetaValue, setMetaValue } from '../../xhs/db.js';
import { AREAS, learnModel, signature } from '../../xhs/learning.js';
import { nowCst } from './ad-quote.js';
import { notifyChanged } from '../../xhs/store.js';

/*
 * "학습 현황" card on the dashboard and the loader every screen uses. The user's locks and a short
 * log of what changed are kept in the synced meta record "learning" ({ locked, last, log }).
 * Keys: lr.*
 */

const KEY = 'learning';
const LOG_MAX = 30;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export async function loadLearning() {
  const v = await getMetaValue(KEY);
  return v && typeof v === 'object' ? { locked: v.locked ?? {}, last: v.last ?? null, log: Array.isArray(v.log) ? v.log : [] } : { locked: {}, last: null, log: [] };
}

/** The model for a screen (locks applied). */
export async function screenModel(posts, baseline) {
  return learnModel(posts, baseline, await loadLearning());
}

/**
 * Dashboard: compare with what was learned last time and log what changed. Writes only when
 * something changed (a write redraws the dashboard once; the second pass finds nothing new).
 */
export async function updateLearningLog(model, state) {
  const now = signature(model);
  if (!state.last) {
    await setMetaValue(KEY, { ...state, last: now });
    return state.log;
  }
  const changes = AREAS.filter((a) => (now[a] ?? '') !== (state.last[a] ?? '')).map((a) => ({ at: nowCst(), area: a, from: state.last[a] ?? '', to: now[a] ?? '' }));
  if (!changes.length) return state.log;
  const log = [...changes, ...state.log].slice(0, LOG_MAX);
  await setMetaValue(KEY, { ...state, last: now, log });
  return log;
}

const stepNames = (list) => list.map((s) => t(`fn.step.${s}`)).join(' > ');
/** A logged value in words: step order, check verdicts, or the estimate ratio. */
function sigText(area, v) {
  if (!v) return t('lr.none');
  if (area === 'funnel') return stepNames(v.split('>'));
  if (area === 'edit') return v.split(',').map((x) => { const [k, verdict] = x.split(':'); return `${t(`fn.step.${k}`)} ${t(`lr.edit.v.${verdict}`)}`; }).join(', ');
  return `×${v}`;
}

function areaBody(area, m) {
  if (area === 'funnel') {
    const named = m.steps.filter((s) => isNum(s.rho)).sort((a, b) => b.weight - a.weight);
    return m.status === 'active'
      ? t('lr.funnel.active', { order: stepNames(m.order), n: m.n })
      : t('lr.funnel.learning', { n: m.n, need: m.need }) + (named.length ? ` ${t('lr.funnel.sofar', { order: stepNames(named.map((s) => s.step)) })}` : '');
  }
  if (area === 'edit') {
    const parts = Object.entries(m.steps).map(([step, s]) => t('lr.edit.step', { step: t(`fn.step.${step}`), m: s.improved, n: s.n, verdict: t(`lr.edit.v.${s.verdict}`) }));
    return parts.length ? parts.join(' · ') : t('lr.edit.none');
  }
  return m.status === 'active'
    ? t('lr.ads.active', { r: Math.round(m.ratio * 100), n: m.n }) + (m.recency ? ` ${t('lr.ads.recency', { n: m.orders })}` : '')
    : t('lr.ads.learning', { n: m.n, need: m.need }) + (m.recency ? ` ${t('lr.ads.recency', { n: m.orders })}` : '');
}

export function learningCardHtml(model, log) {
  const rows = AREAS.map((a) => {
    const m = model[a];
    const status = m.locked ? 'locked' : m.status;
    const badge = `<span class="badge ${status === 'active' ? 'cf-good' : status === 'locked' ? 'bg-surface-2' : 'cf-mid'}">${esc(t(`lr.status.${status}`, { n: m.n, need: m.need }))}</span>`;
    return `<li class="rounded-[10px] bg-surface-2 p-3 text-[13px]"><div class="flex flex-wrap items-center justify-between gap-2"><b>${esc(t(`lr.area.${a}`))}</b><span class="flex items-center gap-2">${badge}<button type="button" class="link-btn text-[12px]" data-lr-lock="${a}">${esc(t(m.locked ? 'lr.unlock' : 'lr.lock'))}</button></span></div>
      <p class="mt-1 text-[12px] text-muted">${esc(t(`lr.what.${a}`))}</p><p class="mt-1 leading-relaxed">${esc(areaBody(a, m))}</p></li>`;
  }).join('');
  const recent = log.slice(0, 5).map((x) => `<li>${esc(x.at.slice(0, 16).replace('T', ' '))} · ${esc(t(`lr.area.${x.area}`))}: ${esc(sigText(x.area, x.from))} → ${esc(sigText(x.area, x.to))}</li>`).join('');
  return `<section class="card" id="learning-card"><h3 class="text-[15px] font-semibold">${esc(t('lr.title'))}</h3>
    <p class="mt-1 text-[12px] text-muted">${esc(t('lr.sub'))}</p>
    <ul class="mt-2 flex flex-col gap-2">${rows}</ul>
    ${recent ? `<h4 class="mt-3 text-[13px] font-semibold">${esc(t('lr.log'))}</h4><ul class="mt-1 flex flex-col gap-0.5 text-[12px] text-muted">${recent}</ul>` : ''}
    <p class="mt-2 text-[11px] text-muted">${esc(t('lr.note'))}</p></section>`;
}

/** Lock / unlock an area (the original rules are used while locked). */
export function bindLearning(root) {
  root.addEventListener('click', async (e) => {
    const area = e.target.closest('[data-lr-lock]')?.dataset.lrLock;
    if (!area) return;
    const state = await loadLearning();
    const locked = { ...state.locked, [area]: !state.locked[area] };
    await setMetaValue(KEY, { ...state, locked });
    notifyChanged(); // screens redraw with the original rules (or the learned ones again)
    toast(t(locked[area] ? 'lr.locked' : 'lr.unlocked', { area: t(`lr.area.${area}`) }));
  });
}
