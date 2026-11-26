import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { fmt, signedPct } from '../../xhs/format.js';
import { RATES, postFunnel } from '../../xhs/funnel.js';
import { editingPlanHtml } from './feedback.js';

/* Funnel card on the post detail (section 5). Text keys: fn.* (ko · en · zh). */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const STATE_CLASS = { good: 'cf-good', ok: 'cf-mid', weak: 'cf-bad' };

const val = (k, v) => (!isNum(v) ? '' : k in RATES ? `${(v * 100).toFixed(2)}%` : fmt(k, v));
const name = (k) => (k in RATES ? t(`fn.m.${k}`) : t(`m.${k}`));

function bar(m) {
  if (!isNum(m?.rel)) return '<div class="fn-track" aria-hidden="true"></div>';
  const w = Math.max(3, Math.min(100, 50 * (1 + m.rel)));
  return `<div class="fn-track" aria-hidden="true"><span class="fn-fill ${STATE_CLASS[m.state] ?? ''}" style="width:${w.toFixed(1)}%"></span><span class="fn-mid"></span></div>`;
}

function stepRow(s, i) {
  const main = s.metrics.find((m) => isNum(m.value)) ?? s.metrics[0];
  const badge = s.state === 'missing' ? `<span class="badge bg-surface-2">${esc(t('fn.state.missing'))}</span>` : `<span class="badge ${STATE_CLASS[s.state]}">${esc(t(`fn.state.${s.state}`))}</span>`;
  const extra = [
    s.bottleneck ? `<span class="badge cf-bad">${esc(t('fn.bottleneck'))}</span>` : '',
    s.reference ? `<span class="badge bg-surface-2">${esc(t('ops.ref'))}</span>` : '',
  ].join(' ');
  const lines = s.metrics
    .map((m) => `<li><span class="text-muted">${esc(name(m.key))}</span> <b class="tabular-nums">${m.value == null ? esc(t('fn.notCollected')) : esc(val(m.key, m.value))}</b> <span class="text-muted tabular-nums">/ ${esc(t('fn.median'))} ${esc(val(m.key, m.base) || '–')}${isNum(m.rel) ? ` · ${esc(signedPct(m.rel))}` : ''}</span></li>`)
    .join('');
  return `<li class="fn-step ${s.reference ? 'opacity-70' : ''}">
    <div class="flex flex-wrap items-center gap-2"><span class="fn-no">0${i + 1}</span><b class="text-[14px]">${esc(t(`fn.step.${s.key}`))}</b>${badge}${extra}</div>
    ${bar(main)}
    <ul class="mt-1 flex flex-col gap-0.5 text-[12px]">${lines}</ul></li>`;
}

function checkHtml(c, post, which) {
  const facts = c.evidence === 'segment'
    ? t('fb.segment', { to: c.to, loss: Math.round(c.loss * 100) })
    : c.metrics.map((m) => t('fn.fact', { m: name(m.key), now: val(m.key, m.value), base: val(m.key, m.base) })).join(' · ');
  const peer = c.metrics?.map((m) => post[`${which}Meta`]?.peer?.[m.key]).find((p) => p && isNum(p.value) && isNum(p.median));
  const peerKey = c.metrics?.find((m) => post[`${which}Meta`]?.peer?.[m.key])?.key;
  const peerText = peer ? `<p class="mt-1 text-[12px] text-muted">${esc(t('fb.peer', { m: name(peerKey), now: fmt(peerKey, peer.value), base: fmt(peerKey, peer.median) }))}</p>` : '';
  return `<li class="rounded-[10px] bg-surface-2 p-3"><p class="text-[13px] font-semibold">${esc(t(`fn.step.${c.step}`))} · ${esc(t(`fn.why.${c.step}`))}</p>
    <p class="mt-1 text-[13px]"><b>${esc(t('fb.evidence'))}</b> ${esc(facts)}</p>${peerText}${editingPlanHtml(c)}</li>`;
}

export function funnelHtml(post, posts, baseline, which = 'd1') {
  const f = postFunnel(post, posts, baseline, which);
  const label = which === 'd1' ? 'D+1' : 'D+2';
  const toggle = `<div class="segmented !w-auto" role="radiogroup">${['d1', 'd2'].map((w) => `<button type="button" class="seg px-3 ${w === which ? 'is-active' : ''}" data-funnel="${w}">${w === 'd1' ? 'D+1' : 'D+2'}</button>`).join('')}</div>`;
  let head = '';
  if (f.status === 'baseline') head = t('fn.status.baseline');
  else if (f.status === 'metrics') head = t('fn.status.metrics', { stage: label });
  else if (f.status === 'mixed') head = t(f.ads.any ? 'fn.status.ads' : 'fn.status.validity', { stage: label });
  else if (f.status === 'checks') head = t('fn.status.checks', { list: f.checks.map((c) => t(`fn.step.${c.step}`)).join(' · ') });
  else head = t(`fn.status.${f.status}`);
  const steps = f.status === 'baseline' ? '' : `<ol class="mt-3 flex flex-col gap-3">${f.steps.map(stepRow).join('')}</ol>`;
  const search = isNum(f.searchShare) ? `<p class="mt-2 text-[12px] text-muted">${esc(t('fn.search', { p: (f.searchShare * 100).toFixed(1) }))}</p>` : '';
  const checks = f.checks.length ? `<h4 class="mt-4 text-[14px] font-semibold">${esc(t('fn.checksTitle'))}</h4><ul class="mt-2 flex flex-col gap-3">${f.checks.map((c) => checkHtml(c, post, which)).join('')}</ul>` : '';
  const missing = f.missing.length ? `<p class="mt-2 text-[12px] text-muted">${esc(t('fn.missing', { list: f.missing.map((k) => t(`fn.step.${k}`)).join(', ') }))}</p>` : '';
  const refNote = f.ref ? `<p class="mt-2 text-[12px] text-muted">${esc(t(which === 'd1' ? 'fn.refD1' : 'fn.refD2', { v: f.ref.version ?? '', n: Math.max(0, ...Object.values(f.ref.counts)) }))}</p>` : '';
  return `<div id="funnel-card" class="mt-2 rounded-[12px] border border-line p-3">
    <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-[15px] font-semibold">${esc(t('fn.title'))}</h3>${toggle}</div>
    <p class="mt-2 text-[14px] leading-relaxed">${esc(head)}</p>
    ${steps}${search}${checks}${missing}${refNote}
    <p class="mt-2 text-[12px] text-muted">${esc(t('fn.note'))}</p></div>`;
}

/** D+1 / D+2 switch inside the card (redraws only the card). */
export function bindFunnel(root, post, posts, baseline) {
  root.addEventListener('click', (e) => {
    const w = e.target.closest('[data-funnel]')?.dataset.funnel;
    if (!w) return;
    const card = root.querySelector('#funnel-card');
    if (card) card.outerHTML = funnelHtml(post, posts, baseline, w);
  });
}
