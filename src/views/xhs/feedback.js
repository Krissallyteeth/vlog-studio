import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { fmt } from '../../xhs/format.js';
import { postFeedback } from '../../xhs/feedback.js';

export function editingPlanHtml(plan) {
  return `<p class="mt-2 text-[12px] font-semibold">${esc(t('fb.action'))}</p><ol class="list-decimal pl-5 text-[13px] leading-relaxed">${plan.actions.map((key) => `<li>${esc(t(`fb.do.${key}`))}</li>`).join('')}</ol><p class="mt-2 text-[13px]"><b>${esc(t('fb.verify'))}</b> ${esc(t(`fb.check.${plan.check}`))}</p>`;
}

export function feedbackHtml(post, baseline) {
  const result = postFeedback(post, baseline);
  const body = result.cards.length ? result.cards.map((card) => {
    const m = t(`m.${card.metric}`);
    const evidence = card.evidence === 'segment' ? t('fb.segment', { to: card.to, loss: Math.round(card.loss * 100) }) : t('fb.metric', { m, now: fmt(card.metric, card.value), base: fmt(card.metric, card.base) });
    const peerKey = card.metric === 'avgWatchRatio' ? null : card.metric;
    const peer = peerKey && post.d1Meta?.peer?.[peerKey];
    const peerText = peer && Number.isFinite(peer.value) && Number.isFinite(peer.median) ? `<p class="mt-1 text-[12px] text-muted">${esc(t('fb.peer', { m, now: fmt(peerKey, peer.value), base: fmt(peerKey, peer.median) }))}</p>` : '';
    return `<li class="rounded-[10px] bg-surface-2 p-3"><p class="text-[13px]"><b>${esc(t('fb.evidence'))}</b> ${esc(evidence)}</p>${peerText}${editingPlanHtml(card)}</li>`;
  }).join('') : `<li class="text-[13px] leading-relaxed">${esc(t(`fb.status.${result.status}`))}</li>`;
  const missing = result.missing.length ? `<p class="mt-2 text-[12px] text-muted">${esc(t('fb.missing', { list: result.missing.map((k) => t(`m.${k}`)).join(', ') }))}</p>` : '';
  return `<div id="editing-feedback" class="mt-2 rounded-[12px] border border-line p-3"><h3 class="text-[14px] font-semibold">${esc(t('fb.title'))}</h3><ul class="mt-2 flex flex-col gap-3">${body}</ul>${missing}<p class="mt-2 text-[12px] text-muted">${esc(t('fb.note'))}</p></div>`;
}
