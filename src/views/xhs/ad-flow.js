import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { fmt, yuan } from '../../xhs/format.js';

/*
 * A post's ad story (src/xhs/ad-advice.js): D+1 advice → D+2 advice → what was done → how it went.
 */

const VERDICT = { go: 'cf-good', hold: 'cf-mid', skip: 'cf-bad', unknown: 'bg-surface-2' };

function reasonText(r) {
  const v = { ...r.vars };
  if (r.key === 'ctrWeak') {
    v.v = fmt('ctr', v.v);
    v.base = fmt('ctr', v.base);
  }
  if (r.key === 'expect') {
    v.cost = yuan(v.cost);
    v.all = v.all == null ? '–' : yuan(v.all);
  }
  return t(`adv.r.${r.key}`, v);
}

export const verdictBadge = (a) => (a ? `<span class="badge ${VERDICT[a.verdict]}">${esc(t(`adv.v.${a.verdict}`))}</span>` : `<span class="badge bg-surface-2">${esc(t('adv.noData'))}</span>`);

function step(label, a) {
  return `<li class="rounded-[10px] bg-surface-2 p-2"><div class="flex flex-wrap items-center gap-2 text-[13px]"><b>${esc(label)}</b>${verdictBadge(a)}${a?.decideOn ? `<span class="text-[12px] text-muted">${esc(a.decideOn)}</span>` : ''}</div>${a?.reasons?.length ? `<ul class="mt-1 list-disc pl-5 text-[12px] text-muted">${a.reasons.map((r) => `<li>${esc(reasonText(r))}</li>`).join('')}</ul>` : ''}</li>`;
}

/** The flow for one post: two advice steps, the decision taken, the final word. */
export function adFlowHtml(tl) {
  const done = tl.ad
    ? t('adv.did', { stage: tl.ad.stage || '?', spend: yuan(tl.ad.spend) || '–', per: tl.ad.perFollow == null ? '–' : yuan(tl.ad.perFollow), usual: tl.ad.usual == null ? '–' : yuan(tl.ad.usual) })
    : t(tl.final.key === 'notRun' ? 'adv.didNot' : 'adv.notYet');
  const finalKey = `adv.f.${tl.final.key}${tl.ad ? `.${tl.final.outcome}` : tl.final.key === 'notRun' && tl.d2?.verdict === 'go' ? '.missed' : ''}`;
  const tone = tl.final.outcome === 'good' ? 'cf-good' : tl.final.outcome === 'bad' ? 'cf-bad' : 'bg-surface-2';
  return `<div class="mt-2 rounded-[12px] border border-line p-3"><h3 class="text-[14px] font-semibold">${esc(t('adv.title'))}</h3>
    <ol class="mt-2 flex flex-col gap-1.5">${step(t('adv.d1'), tl.d1)}${step(t('adv.d2'), tl.d2)}
      <li class="rounded-[10px] bg-surface-2 p-2 text-[13px]"><b>${esc(t('adv.decision'))}</b> ${esc(done)}</li>
      <li class="rounded-[10px] p-2 text-[13px] ${tone}"><b>${esc(t('adv.final'))}</b> ${esc(t(finalKey))}</li></ol>
    <p class="mt-1 text-[12px] text-muted">${esc(t('adv.note'))}</p></div>`;
}
