import { listProjects, getProject } from '../../data/repo.js';
import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, confirmDialog, esc, openSheet, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { adEffect, analysePost, orderEfficiency } from '../../xhs/analysis.js';
import { fmt, signedPct, yuan } from '../../xhs/format.js';
import { METRICS, METRIC, VALIDITY } from '../../xhs/metrics.js';
import { judge, ordered, stage } from '../../xhs/stats.js';
import { activeBaseline, deletePost, getPost, getSettings, listPosts, normalizeAd, normalizeStage, onXhsChange, savePosts } from '../../xhs/store.js';
import { AD_METRICS } from '../../xhs/ocr-ad-parse.js';
import { memoDuplicateOf } from '../../xhs/ad-orders.js';
import { postFocus } from '../../xhs/insights.js';
import { insightList } from './insight-text.js';
import { relativeNote, xhsPage } from './shell.js';

const CF = { good: 'cf-good', mid: 'cf-mid', bad: 'cf-bad' };

// ── 콘텐츠 목록 ───────────────────────────────────────
export async function renderContents({ isCurrent }) {
  const [posts, baseline, projects] = await Promise.all([listPosts(), activeBaseline(), listProjects()]);
  if (!isCurrent()) return null;
  const list = ordered(posts).reverse();
  const projectName = (id) => projects.find((p) => p.id === id)?.name ?? '';
  const keys = ['views', 'ctr', 'retain5s', 'completion'];
  const root = xhsPage({
    nav: 'contents',
    title: t('cont.title'),
    sub: t('cont.sub'),
    actions: `<a href="#/data/posts" class="btn btn-secondary btn-sm">${icon('table', 'size-4')}${esc(t('nav.data'))}</a>`,
    body: list.length
      ? `<ul class="flex flex-col gap-2.5">${list
          .map(
            (p) => `<li><a class="card block" href="#/c/${encodeURIComponent(p.id)}">
          <div class="flex items-center justify-between gap-2 text-[12px] text-muted"><span class="tabular-nums">${esc(p.date)} ${esc(p.time)} · No.${p.no ?? ''}${p.contentType ? ` · ${esc(p.contentType)}` : ''}</span><span class="badge ${p.validity === '유효' ? 'cf-good' : 'cf-mid'}">${esc(p.validity)}</span></div>
          <p class="mt-1 text-[16px] font-semibold">${esc(p.title || t('xg.untitled'))}</p>
          ${p.projectId ? `<p class="text-[12px] text-muted">${icon('idea', 'size-3.5 inline')} ${esc(projectName(p.projectId))}</p>` : ''}
          <div class="mt-2 grid grid-cols-4 gap-1.5 text-[12px]">${keys.map((k) => `<div class="rounded-[8px] px-2 py-1 ${CF[judge(k, stage(p)[k], baseline?.medians[k], p.validity)] ?? 'bg-surface-2'}"><p class="opacity-75">${esc(METRIC[k].zh)}</p><p class="font-semibold tabular-nums">${esc(fmt(k, stage(p)[k]) || '–')}</p></div>`).join('')}</div>
        </a></li>`,
          )
          .join('')}</ul><div class="mt-3">${relativeNote()}</div>`
      : `<div class="empty card"><div class="empty-icon">${icon('list', 'size-6')}</div><p class="font-semibold">${esc(t('dash.empty'))}</p><a href="#/import" class="btn btn-primary mt-4">${esc(t('data.import'))}</a></div>`,
  });
  window.scrollTo(0, 0);
  return { kind: 'xhs-contents', root };
}

// ── 게시물 상세: 기획 → 배포 → 통계 → 광고 → 분석 ─────────
export async function renderPost([id], { isCurrent }) {
  const [post, posts, baseline, settings, projects] = await Promise.all([getPost(id), listPosts(), activeBaseline(), getSettings(), listProjects()]);
  if (!isCurrent()) return null;
  if (!post) {
    toast(t('post.notFound'));
    navigate('/contents', { replace: true });
    return null;
  }
  const project = post.projectId ? await getProject(post.projectId) : null;
  const report = analysePost(post, posts, baseline);
  // The funnel step to fix first, against my own records; plus what this post's ads showed.
  const focus = postFocus(post, posts, baseline);
  const eff = adEffect(post);
  const d1 = stage(post, 'd1');
  const d2 = stage(post, 'd2');
  const shown = METRICS.filter((m) => m.key !== 'duration' || true);
  const types = [...new Set([...settings.contentTypes, post.contentType].filter(Boolean))];

  const metricRows = shown
    .map((m) => {
      const j = judge(m.key, d1[m.key], baseline?.medians[m.key], post.validity);
      return `<tr><td><b>${esc(m.zh)}</b> <span class="text-[12px] text-muted">${esc(t(`m.${m.key}`))}</span>${m.computed ? ' <span class="text-muted" title="ƒ">ƒ</span>' : ''}</td>
        <td class="num ${CF[j] ?? ''}">${esc(fmt(m.key, d1[m.key]))}</td><td class="num">${esc(fmt(m.key, baseline?.medians[m.key]))}</td><td class="num">${esc(fmt(m.key, d2[m.key]))}</td></tr>`;
    })
    .join('');

  const reportHtml = () => {
    const line = (r) => `${METRIC[r.key].zh} ${signedPct(r.vsBase)}`;
    const parts = [];
    if (report.reserved) parts.push(`<p class="notice notice-strong">${icon('info', 'size-5 mt-0.5')}<span><b>${esc(t('ana.reserved'))}</b> ${esc(t('ana.reservedWhy'))}</span></p>`);
    if (report.better.length && report.worse.length) parts.push(`<p class="text-[15px] leading-relaxed">${esc(t('ana.summaryMixed', { good: METRIC[report.better[0].key].zh, goodPct: signedPct(report.better[0].vsBase).replace('+', ''), bad: METRIC[report.worse[0].key].zh, badPct: signedPct(report.worse[0].vsBase).replace('-', '') }))}</p>`);
    else if (report.better.length) parts.push(`<p class="text-[15px] leading-relaxed">${esc(t('ana.summaryGood', { list: report.better.slice(0, 3).map(line).join(', ') }))}</p>`);
    else if (report.worse.length) parts.push(`<p class="text-[15px] leading-relaxed">${esc(t('ana.summaryBad', { list: report.worse.slice(0, 3).map(line).join(', ') }))}</p>`);
    else parts.push(`<p class="text-[15px] leading-relaxed">${esc(t('ana.summaryFlat'))}</p>`);
    parts.push(`<div class="table-scroll mt-3"><table class="xtable"><thead><tr><th>${esc(t('crit.metric'))}</th><th class="num" data-m="key">${esc(t('ana.this'))}</th><th class="num" data-m="inline">${esc(t('ana.vsBase'))}</th><th class="num" data-m="inline">${esc(t('ana.vsPrev'))}</th><th class="num">${esc(t('ana.vsRecent'))}</th></tr></thead><tbody>
      ${report.rows.map((r) => `<tr><td>${esc(METRIC[r.key].zh)}</td><td class="num">${esc(fmt(r.key, r.value))}</td><td class="num ${r.state === 'better' ? 'cf-good' : r.state === 'worse' ? 'cf-bad' : r.state ? 'cf-mid' : ''}">${esc(r.baseZero ? t('crit.zeroBase') : signedPct(r.vsBase))}</td><td class="num">${esc(signedPct(r.vsPrev))}</td><td class="num">${esc(report.recentCount >= 5 ? signedPct(r.vsRecent) : t('ana.na'))}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="mt-1 text-[12px] text-muted">${esc(t('ana.tableNote', { prev: report.prev?.title ?? '–' }))}</p>`);
    parts.push(`<div class="mt-3 grid gap-3 md:grid-cols-2">
      <div><h4 class="text-[13px] font-semibold">${esc(t('ana.better'))}</h4><p class="text-[14px]">${esc(report.better.map(line).join(', ') || t('ana.none'))}</p></div>
      <div><h4 class="text-[13px] font-semibold">${esc(t('ana.worse'))}</h4><p class="text-[14px]">${esc(report.worse.map(line).join(', ') || t('ana.none'))}</p></div></div>`);
    parts.push(`<h4 class="mt-3 text-[13px] font-semibold">${esc(t('ana.next'))}</h4><ul class="list-disc pl-5 text-[14px]">${(report.advice.length ? report.advice : ['keep']).map((a) => `<li>${esc(t(`ana.adv.${a}`))}</li>`).join('')}</ul>`);
    parts.push(`<h4 class="mt-3 text-[13px] font-semibold">${esc(t('ana.adOpinion'))}</h4><p class="text-[14px]">${esc(t(`ana.ad.${report.adOpinion}`))} <span class="text-[12px] text-muted">${esc(t('ana.adNote'))}</span></p>`);
    if (report.caveats.length) parts.push(`<h4 class="mt-3 text-[13px] font-semibold">${esc(t('ana.caveats'))}</h4><ul class="list-disc pl-5 text-[13px] text-muted">${report.caveats.map((c) => `<li>${esc(t(`ana.cav.${c.key}`, c.vars))}</li>`).join('')}</ul>`);
    return parts.join('');
  };

  // A memo already covered by an order report on this post (written before the screenshots): offer to remove it.
  const dupHtml = (a, i) => {
    const order = memoDuplicateOf(post, a);
    if (!order) return '';
    return `<div class="mt-2 notice flex flex-wrap items-center gap-2 text-[12px]"><span class="flex-1">${esc(t('ads.dupMemo', { stage: order.stage || '?', start: (order.start || '').replace('T', ' '), spend: a.spend }))}</span><button type="button" class="btn btn-secondary btn-sm" data-drop-memo="${i}">${esc(t('ads.dupDrop'))}</button></div>`;
  };

  const adsHtml = () => `
    ${post.ads.length ? `<ul class="flex flex-col gap-2">${post.ads.map((a, i) => `<li class="rounded-[12px] bg-surface-2 p-3 text-[13px]">
      <div class="flex items-start justify-between gap-2"><div><b>${esc(a.stage || '–')}</b> · ${esc(a.executed ? t('ads.executed') : t('ads.notExecuted'))} · ${esc(yuan(a.spend) || '–')}${a.credit ? ` + ${esc(t('ads.credit'))} ${esc(yuan(a.credit))}` : ''}${a.needsReview ? ` <span class="badge cf-mid">${esc(t('ads.review'))}</span>` : ''}</div>
      <button type="button" class="link-btn" data-edit-ad="${i}">${esc(t('ads.edit'))}</button></div>
      <p class="mt-1 text-muted">${esc([a.goal, a.hours ? t('ads.hoursN', { n: a.hours }) : '', a.start, a.result, a.memo].filter(Boolean).join(' · '))}</p>
      ${a.sourceText ? `<p class="mt-1 text-[12px] text-muted">${esc(t('ads.from', { text: a.sourceText }))}</p>` : ''}
      ${dupHtml(a, i)}
      ${orderHtml(a)}</li>`).join('')}</ul>` : `<p class="text-[14px] text-muted">${esc(t('ads.none'))}</p>`}
    <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="btn btn-secondary btn-sm" data-edit-ad="new">${icon('plus', 'size-4')}${esc(t('ads.add'))}</button><a class="btn btn-secondary btn-sm" href="#/ocr-ad/${encodeURIComponent(post.id)}">${icon('scan', 'size-4')}${esc(t('oad.fromShots'))}</a></div>
    ${eff.unknownStage ? `<p class="mt-2 text-[12px] cf-mid rounded-[8px] px-2 py-1">${esc(t('ads.unknownStage', { n: eff.unknownStage }))}</p>` : ''}
    ${eff.spend ? `<div class="mt-3 kpi-grid"><div class="kpi"><p class="kpi-label">${esc(t('ads.spend'))}</p><p class="kpi-value">${esc(yuan(eff.spend))}</p></div><div class="kpi"><p class="kpi-label">${esc(t('ads.betweenSpend'))}</p><p class="kpi-value">${esc(yuan(eff.betweenSpend) || '0元')}</p></div><div class="kpi"><p class="kpi-label">${esc(t('ads.viewsDelta'))}</p><p class="kpi-value">${eff.viewsDelta ?? '–'}</p></div><div class="kpi"><p class="kpi-label">${esc(t('ads.perView'))}</p><p class="kpi-value">${eff.perView == null ? '–' : yuan(eff.perView)}</p></div><div class="kpi"><p class="kpi-label">${esc(t('ads.perFollower'))}</p><p class="kpi-value">${eff.perFollower == null ? '–' : yuan(eff.perFollower)}</p></div></div>
      <p class="mt-2 text-[12px] text-muted">${esc(t('ads.effectNote'))}</p>` : ''}`;

  const root = xhsPage({
    nav: 'contents',
    back: '#/contents',
    title: post.title || t('xg.untitled'),
    sub: `${post.date} ${post.time} · No.${post.no ?? ''}`,
    actions: `<a href="#/data/posts/${encodeURIComponent(post.id)}" class="btn btn-secondary btn-sm">${icon('table', 'size-4')}${esc(t('post.inTable'))}</a>`,
    body: `
      <section class="card"><h2 class="section-step">1 · ${esc(t('post.s.plan'))}</h2>
        <label class="field mt-2"><span class="field-label">${esc(t('post.linkProject'))}</span>
          <select class="input" id="p-project"><option value="">${esc(t('post.noProject'))}</option>${projects.map((pr) => `<option value="${esc(pr.id)}" ${pr.id === post.projectId ? 'selected' : ''}>${esc(pr.name)} · ${esc(pr.startDate)}</option>`).join('')}</select></label>
        ${project ? `<dl class="mt-3 grid gap-1 text-[14px]"><div><dt class="text-[12px] text-muted">${esc(t('plan.theme'))}</dt><dd>${esc(project.plan.theme || '–')}</dd></div><div><dt class="text-[12px] text-muted">${esc(t('plan.direction'))}</dt><dd>${esc(project.plan.direction || '–')}</dd></div><div><dt class="text-[12px] text-muted">${esc(t('story.after'))}</dt><dd>${esc(project.story.finalLine || '–')}</dd></div></dl>
          <a class="btn btn-ghost btn-sm mt-2 -ml-3" href="#/p/${encodeURIComponent(project.id)}">${esc(t('post.openProject'))} ${icon('chevronRight', 'size-4')}</a>` : ''}
      </section>
      <section class="card mt-3"><h2 class="section-step">2 · ${esc(t('post.s.publish'))}</h2>
        <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label class="field"><span class="field-label">${esc(t('xg.type'))}</span><select class="input" id="p-type"><option value="">${esc(t('data.noType'))}</option>${types.map((x) => `<option ${x === post.contentType ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <label class="field"><span class="field-label">D+1 유효성</span><select class="input" id="p-validity">${VALIDITY.map((v) => `<option ${v === post.validity ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <div class="field"><span class="field-label">粉丝</span><p class="tabular-nums">${post.followers ?? '–'}</p></div>
          <div class="field"><span class="field-label">推广判断</span><p>${esc([post.adDecisionD1, post.adAux, post.adDecisionD2].filter(Boolean).join(' / ') || '–')}</p></div>
        </div>
        ${post.memo ? `<p class="mt-2 whitespace-pre-wrap text-[14px]"><span class="text-[12px] text-muted">备注</span><br>${esc(post.memo)}</p>` : ''}
        ${post.source ? `<p class="mt-2 text-[12px] text-muted">${esc(t('post.source', { file: post.source.file, sheet: post.source.sheet, row: post.source.row }))}</p>` : ''}
      </section>
      <section class="card mt-3"><h2 class="section-step">3 · ${esc(t('post.s.stats'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('crit.metric'))}</th><th class="num" data-m="key">D+1</th><th class="num" data-m="inline">${esc(t('crit.fixed'))} V${baseline?.version ?? ''}</th><th class="num" data-m="inline">D+2</th></tr></thead><tbody>${metricRows}</tbody></table></div>
        <div class="mt-2">${relativeNote()}</div>
        ${post.screenshots.length ? `<p class="mt-2 text-[13px]"><a class="link-btn" href="#/ocr/${encodeURIComponent(post.id)}">${esc(t('post.shots', { n: post.screenshots.length }))}</a></p>` : ''}
        <a class="btn btn-secondary btn-sm mt-3" href="#/ocr/${encodeURIComponent(post.id)}">${icon('scan', 'size-4')}${esc(t('post.fromShot'))}</a>
      </section>
      <section class="card mt-3"><h2 class="section-step">4 · ${esc(t('post.s.ads'))}</h2><div class="mt-2" id="p-ads">${adsHtml()}</div></section>
      <section class="card mt-3"><h2 class="section-step">5 · ${esc(t('post.s.analysis'))}</h2>
        <div class="mt-2 rounded-[12px] border border-line p-3"><h3 class="text-[14px] font-semibold">${esc(t('pf.title'))}</h3>${insightList('pf', focus.items)}</div>
        <div class="mt-3">${reportHtml()}</div></section>
      <button type="button" class="btn btn-ghost text-danger mt-4" id="p-delete">${icon('trash', 'size-4')}${esc(t('post.delete'))}</button>`,
  });

  const save = async (patch, msg = t('common.saved')) => {
    await savePosts([{ ...post, ...patch }]);
    toast(msg);
  };
  root.addEventListener('change', (e) => {
    if (e.target.id === 'p-project') save({ projectId: e.target.value });
    if (e.target.id === 'p-type') save({ contentType: e.target.value });
    if (e.target.id === 'p-validity') save({ validity: e.target.value });
  });
  root.addEventListener('click', async (e) => {
    const drop = e.target.closest('[data-drop-memo]');
    if (drop) {
      const i = Number(drop.dataset.dropMemo);
      const memo = post.ads[i];
      if (!memo || !memoDuplicateOf(post, memo)) return;
      const ok = await confirmDialog({ title: t('ads.dupDrop'), message: t('ads.dupDropBody', { text: memo.sourceText || memo.stage }), confirmText: t('common.delete'), danger: true });
      if (!ok) return;
      return save({ ads: post.ads.filter((_, k) => k !== i) });
    }
    const ad = e.target.closest('[data-edit-ad]');
    if (ad) {
      const idx = ad.dataset.editAd === 'new' ? -1 : Number(ad.dataset.editAd);
      const res = await adSheet(idx < 0 ? normalizeAd({ executed: true }) : post.ads[idx]);
      if (!res) return;
      const ads = [...post.ads];
      if (res === 'delete') ads.splice(idx, 1);
      else if (idx < 0) ads.push(res);
      else ads[idx] = res;
      return save({ ads });
    }
    if (e.target.closest('#p-delete')) {
      const ok = await confirmDialog({ title: t('post.deleteTitle'), message: t('post.deleteBody', { name: post.title }), confirmText: t('common.delete'), danger: true });
      if (!ok) return;
      await deletePost(post.id);
      toast(t('post.deleted'));
      navigate('/contents', { replace: true });
    }
  });
  const off = onXhsChange(() => navigate(`/c/${encodeURIComponent(id)}`, { replace: true }));
  window.scrollTo(0, 0);
  return { kind: 'xhs-post', destroy: off };
}

/** Ad record form. Resolves with the edited ad, 'delete', or null. */
export function adSheet(ad) {
  const hours = [6, 12, 24];
  return openSheet({
    title: t('ads.formTitle'),
    body: `<form class="flex max-h-[70vh] flex-col gap-3 overflow-y-auto" id="ad-form">
      <div class="grid grid-cols-2 gap-3">
        <label class="field"><span class="field-label">${esc(t('ads.stage'))}</span><input class="input" name="stage" list="ad-stages" value="${esc(ad.stage)}" placeholder="${esc(t('ads.stageAutoPh'))}" /><datalist id="ad-stages">${['D', 'D+1', 'D+2', 'D+3', 'D+4', 'D+5', 'D+6', 'D+7'].map((x) => `<option>${x}</option>`).join('')}</datalist></label>
        <label class="field"><span class="field-label">${esc(t('ads.executedQ'))}</span><select class="input" name="executed"><option value="1" ${ad.executed ? 'selected' : ''}>${esc(t('ads.executed'))}</option><option value="0" ${ad.executed ? '' : 'selected'}>${esc(t('ads.notExecuted'))}</option></select></label>
        <label class="field"><span class="field-label">${esc(t('ads.start'))}</span><input class="input" type="datetime-local" name="start" value="${esc(ad.start)}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.end'))}</span><input class="input" type="datetime-local" name="end" value="${esc(ad.end)}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.hours'))}</span><select class="input" name="hoursPreset">${hours.map((h) => `<option value="${h}" ${ad.hours === h ? 'selected' : ''}>${h}h</option>`).join('')}<option value="" ${hours.includes(ad.hours) ? '' : 'selected'}>${esc(t('ads.custom'))}</option></select></label>
        <label class="field"><span class="field-label">${esc(t('ads.hoursCustom'))}</span><input class="input" inputmode="decimal" name="hours" value="${ad.hours != null && !hours.includes(ad.hours) ? ad.hours : ''}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.goal'))}</span><input class="input" name="goal" list="ad-goals" value="${esc(ad.goal)}" /><datalist id="ad-goals"><option>关注</option><option>阅读</option><option>点赞收藏</option></datalist></label>
        <label class="field"><span class="field-label">${esc(t('ads.spendYuan'))}</span><input class="input" inputmode="decimal" name="spend" value="${ad.spend ?? ''}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.creditYuan'))}</span><input class="input" inputmode="decimal" name="credit" value="${ad.credit ?? ''}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.budget'))}</span><input class="input" inputmode="decimal" name="budget" value="${ad.budget ?? ''}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.expected'))}</span><input class="input" inputmode="numeric" name="expectedFollowers" value="${ad.expectedFollowers ?? ''}" /></label>
        <label class="field"><span class="field-label">${esc(t('ads.actual'))}</span><input class="input" inputmode="numeric" name="actualFollowers" value="${ad.actualFollowers ?? ''}" /></label>
      </div>
      <fieldset class="rounded-[12px] border border-line p-3"><legend class="px-1 text-[13px] font-semibold">${esc(t('ads.orderReport'))}</legend>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">${AD_METRICS.map(([k, names]) => `<label class="field"><span class="field-label">${esc(names[0])}</span><input class="input" inputmode="numeric" name="order.${k}" value="${ad.order?.[k] ?? ''}" /></label>`).join('')}</div>
      </fieldset>
      <label class="field"><span class="field-label">${esc(t('ads.result'))}</span><input class="input" name="result" value="${esc(ad.result)}" /></label>
      <label class="field"><span class="field-label">${esc(t('ads.memo'))}</span><textarea class="textarea" rows="2" name="memo">${esc(ad.memo)}</textarea></label>
      ${ad.sourceText ? `<p class="text-[12px] text-muted">${esc(t('ads.from', { text: ad.sourceText }))}</p>` : ''}
      <div class="grid grid-cols-3 gap-2"><button type="button" class="btn btn-ghost text-danger" data-v="delete">${esc(t('common.delete'))}</button><button type="button" class="btn btn-secondary" data-v="">${esc(t('common.cancel'))}</button><button type="submit" class="btn btn-primary">${esc(t('common.save'))}</button></div>
    </form>`,
    onMount(el, close) {
      const form = el.querySelector('#ad-form');
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (b) close(b.dataset.v || null);
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(form));
        const n = (v) => (String(v).trim() === '' ? null : Number(v));
        const order = Object.fromEntries(AD_METRICS.map(([k]) => [k, n(f[`order.${k}`] ?? '')]));
        close(normalizeAd({ ...ad, ...f, stage: normalizeStage(f.stage), executed: f.executed === '1', hours: n(f.hours) ?? n(f.hoursPreset), spend: n(f.spend), budget: n(f.budget), credit: n(f.credit), expectedFollowers: n(f.expectedFollowers), actualFollowers: n(f.actualFollowers), order, needsReview: false }));
      });
    },
  });
}

/** The 薯条 report numbers of an ad, its cost per result, and the audience summary. */
export function orderHtml(a) {
  const e = orderEfficiency(a);
  if (!e.hasReport) return '';
  const o = a.order;
  const cell = (label, v) => `<div><p class="text-[11px] text-muted">${esc(label)}</p><p class="font-semibold tabular-nums">${v ?? '–'}</p></div>`;
  const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '?');
  const aud = a.audience;
  return `<div class="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">${AD_METRICS.map(([k, names]) => cell(names[0], o[k])).join('')}</div>
    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]"><span>${esc(t('ads.perRead'))} <b>${esc(e.perRead == null ? '–' : yuan(e.perRead))}</b></span><span>${esc(t('ads.perLikeFav'))} <b>${esc(e.perLikeFav == null ? '–' : yuan(e.perLikeFav))}</b></span><span>${esc(t('ads.perFollow'))} <b>${esc(e.perFollow == null ? '–' : yuan(e.perFollow))}</b></span>${a.goalResult != null ? `<span>${esc(t('ads.goalResult', { goal: a.goal || '', v: a.goalResult, lo: a.estimate?.[0] ?? '?', hi: a.estimate?.[1] ?? '?' }))}</span>` : ''}${a.beatPct != null ? `<span>${esc(t('ads.beat', { v: Math.round(a.beatPct * 100) }))}</span>` : ''}${a.coupon ? `<span>${esc(t('ads.coupon', { a: a.coupon.threshold, b: a.coupon.bonus, until: a.coupon.expires || '' }))}</span>` : ''}</div>
    ${aud?.gender?.male != null ? `<p class="mt-1 text-[12px] text-muted">${esc(t('ads.audience'))}: ♂ ${pct(aud.gender.male)} · ♀ ${pct(aud.gender.female)}${aud.age ? ` · ${Object.entries(aud.age).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}` : ''}</p>` : ''}`;
}
