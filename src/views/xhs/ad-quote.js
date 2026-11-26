import { t } from '../../i18n/index.js';
import { $, esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { quoteOutcome } from '../../xhs/ad-sim.js';
import { parseAdQuote } from '../../xhs/ocr-ad-quote.js';
import { activeBaseline, getPost, listPosts, onXhsChange, savePosts } from '../../xhs/store.js';
import { decisionCardHtml } from './ad-sim.js';

/*
 * 薯条 purchase screen ("预计提升转化数 7-31") on the D+1 / D+2 upload screen: its own upload slot,
 * read on this device, confirmed by the user, kept on the post (adQuotes). Screenshots are not
 * stored. Keys: aq.*
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const range = (r) => (Array.isArray(r) ? `${r[0]}~${r[1]}` : '–');
/** Now in China Standard Time, "2026-11-26T16:58:00+08:00". */
export const nowCst = (ms = Date.now()) => `${new Date(ms + 8 * 3600000).toISOString().slice(0, 19)}+08:00`;
const stageLabel = (s) => (s === 'd2' ? 'D+2' : 'D+1');

export function quoteCardHtml() {
  return `<section class="card mt-3" id="aq-card"><h2 class="text-[16px] font-semibold">${icon('coin', 'size-5 inline -mt-0.5')} ${esc(t('aq.title'))}</h2>
    <p class="mt-1 text-[13px] text-muted">${esc(t('aq.help'))}</p>
    <label class="btn btn-secondary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('aq.pick'))}<input type="file" id="aq-files" accept="image/*" multiple class="sr-only" /></label>
    <div id="aq-out" class="mt-3"></div><div id="aq-decision"></div></section>`;
}

function numInput(id, v, label) {
  return `<label class="field"><span class="field-label">${esc(label)}</span><input class="input tabular-nums" inputmode="numeric" id="${id}" value="${isNum(v) ? v : ''}" placeholder="${esc(t('aq.empty'))}" /></label>`;
}

function formHtml(q, post, stage) {
  const opts = q.options.length ? `<p class="mt-2 text-[12px] text-muted">${esc(t('aq.options'))} ${q.options.map((o) => `${range(o.estimate)} · ${isNum(o.price) ? `¥${o.price}` : '–'}`).join(' / ')}</p>` : '';
  const warn = q.checks?.payMatchesTotal === false || q.checks?.payMatchesCard === false ? `<p class="mt-2 rounded-[8px] cf-mid px-2 py-1 text-[12px]">${esc(t('aq.mismatch'))}</p>` : '';
  return `<div class="rounded-[12px] border border-line p-3">
    <p class="text-[13px]"><b>${esc(post.title || t('xg.untitled'))}</b> · ${esc(stageLabel(stage))}</p>
    <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
      ${numInput('aq-lo', q.estimate?.[0], t('aq.lo'))}${numInput('aq-hi', q.estimate?.[1], t('aq.hi'))}
      ${numInput('aq-pay', q.pay, t('aq.pay'))}${numInput('aq-credit', q.credit, t('aq.credit'))}
      ${numInput('aq-hours', q.hours, t('aq.hours'))}
      <label class="field"><span class="field-label">${esc(t('aq.goal'))}</span><select class="input" id="aq-goal">${['关注', '点赞收藏量', '阅读', '主页浏览', ''].map((g) => `<option value="${esc(g)}" ${g === q.goal ? 'selected' : ''}>${esc(g || t('aq.unknown'))}</option>`).join('')}</select></label>
    </div>
    ${q.bonusEstimate ? `<p class="mt-2 text-[12px] text-muted">${esc(t('aq.bonus', { r: range(q.bonusEstimate) }))}</p>` : ''}${opts}${warn}
    <div class="mt-3"><p class="field-label">${esc(t('aq.decision'))}</p><div class="segmented !w-auto mt-1" role="radiogroup">${['', 'bought', 'skipped'].map((d) => `<button type="button" class="seg px-3 ${d === '' ? 'is-active' : ''}" data-aq-decision="${d}">${esc(t(`aq.d.${d || 'undecided'}`))}</button>`).join('')}</div></div>
    <p class="mt-2 text-[12px] text-muted">${esc(t('aq.check'))}</p>
    <button type="button" class="btn btn-primary mt-3" id="aq-save">${icon('check', 'size-5')}${esc(t('aq.save'))}</button></div>`;
}

/** `ctx()` returns { post, stage } from the upload screen (stage 'd1' | 'd2'). */
export function bindQuote(root, ctx) {
  let parsed = null;
  let decision = '';
  const out = () => $('#aq-out', root);
  // Once this post has an estimate for the chosen stage: the "if this post gets an ad" card right here,
  // with whatever is saved (D+1 numbers or not), redrawn when the post, the stage or the data change.
  const drawDecision = async () => {
    const box = $('#aq-decision', root);
    if (!box) return;
    const { post, stage } = ctx();
    const [posts, baseline] = await Promise.all([listPosts(), activeBaseline()]);
    const fresh = post && posts.find((p) => p.id === post.id);
    const has = fresh?.adQuotes?.some((q) => q.stage === stageLabel(stage));
    box.innerHTML = has ? decisionCardHtml(fresh, posts, baseline) : '';
  };
  drawDecision();
  const off = onXhsChange(() => (root.isConnected ? drawDecision() : off()));
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-stage]')) setTimeout(drawDecision);
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'ocr-post') setTimeout(drawDecision);
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'aq-files' || !e.target.files?.length) return;
    const files = [...e.target.files];
    e.target.value = '';
    const { post, stage } = ctx();
    if (!post) return (out().innerHTML = `<p class="text-[13px] cf-mid rounded-[8px] px-2 py-1">${esc(t('aq.needPost'))}</p>`);
    out().innerHTML = `<p class="text-[13px]">${esc(t('aq.reading', { n: files.length }))}</p>`;
    try {
      const { recognize } = await import('../../xhs/ocr-engine.js');
      const images = [];
      for (const f of files) images.push(await recognize(f, () => {}));
      parsed = parseAdQuote(images);
      decision = '';
      out().innerHTML = parsed.estimate || parsed.options.length ? formHtml(parsed, post, stage) : `<p class="text-[13px] cf-mid rounded-[8px] px-2 py-1">${esc(t('aq.notFound'))}</p>`;
    } catch (err) {
      console.error(err);
      out().innerHTML = `<p class="text-[13px] cf-bad rounded-[8px] px-2 py-1">${esc(t('aq.error'))}</p>`;
    }
  });
  root.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-aq-decision]');
    if (d) {
      decision = d.dataset.aqDecision;
      root.querySelectorAll('[data-aq-decision]').forEach((b) => b.classList.toggle('is-active', b === d));
      return;
    }
    if (e.target.closest('#aq-save') && parsed) {
      const { post, stage } = ctx();
      if (!post) return;
      const val = (id) => {
        const v = String($(`#${id}`, root)?.value ?? '').replace(/[,元¥\s]/g, '');
        return v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
      };
      const lo = val('aq-lo');
      const hi = val('aq-hi');
      if (lo == null || hi == null || lo > hi) return toast(t('aq.needRange'), { tone: 'error' });
      const quote = { stage: stageLabel(stage), capturedAt: nowCst(), goal: $('#aq-goal', root).value, estimate: [lo, hi], bonusEstimate: parsed.bonusEstimate, pay: val('aq-pay'), credit: val('aq-credit'), hours: val('aq-hours'), options: parsed.options, decision };
      const fresh = (await getPost(post.id)) ?? post; // the screen's copy may be older than a quote saved a moment ago
      await savePosts([{ ...fresh, adQuotes: [...(fresh.adQuotes ?? []), quote] }]);
      parsed = null;
      out().innerHTML = `<p class="text-[13px] cf-good rounded-[8px] px-2 py-1">${esc(t('aq.saved', { stage: stageLabel(stage) }))}</p>`;
    }
  });
}

/** The post's purchase-screen readings with what happened (post detail, 4 · 광고). */
export function quotesHtml(post, posts) {
  if (!post.adQuotes?.length) return '';
  const items = post.adQuotes.map((q) => {
    const o = quoteOutcome(post, q, posts);
    const head = t('aq.line', { stage: q.stage || '–', goal: q.goal || t('aq.unknown'), r: range(q.estimate), pay: isNum(q.pay) ? q.pay : '–', credit: isNum(q.credit) ? q.credit : 0 });
    const result = o.bought
      ? isNum(o.actual)
        ? t(`aq.result.${o.where}`, { n: o.actual, r: range(q.estimate) })
        : t('aq.result.wait')
      : t(q.decision === 'skipped' ? 'aq.result.skipped' : 'aq.result.none');
    const sim = o.sim ? t('aq.sim', { r: range(o.sim.range), m: o.sim.median, n: o.sim.basedOn }) : t('aq.simNone');
    const tone = o.where === 'above' ? 'cf-good' : o.where === 'below' ? 'cf-mid' : 'bg-surface-2';
    return `<li class="rounded-[10px] ${tone} p-2.5 text-[13px]"><div class="flex items-start justify-between gap-2"><b>${esc(head)}</b><button type="button" class="link-btn text-[12px]" data-aq-del="${esc(q.id)}">${esc(t('common.delete'))}</button></div>
      <p class="mt-1">${esc(result)}</p><p class="mt-1 text-[12px] text-muted">${esc(sim)} · ${esc(q.capturedAt.slice(0, 16).replace('T', ' '))}</p></li>`;
  });
  return `<div class="mt-3"><p class="text-[13px] font-semibold">${esc(t('aq.listTitle'))}</p><ul class="mt-1 flex flex-col gap-2">${items.join('')}</ul></div>`;
}

export function bindQuotes(root, post) {
  root.addEventListener('click', async (e) => {
    const id = e.target.closest('[data-aq-del]')?.dataset.aqDel;
    if (!id) return;
    await savePosts([{ ...post, adQuotes: post.adQuotes.filter((q) => q.id !== id) }]);
  });
}
