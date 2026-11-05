import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { adEffect, orderEfficiency } from '../../xhs/analysis.js';
import { fmt, won, yuan } from '../../xhs/format.js';
import { adTotals, ordered } from '../../xhs/stats.js';
import { activeBaseline, getSettings, listIncome, listPosts, onXhsChange, savePosts, saveSettings } from '../../xhs/store.js';
import { adComments, adOrders, adSummary, goalRows, periodRows, postRows, stageRows } from '../../xhs/ad-report.js';
import { adSheet } from './post.js';
import { xhsPage } from './shell.js';

// ── 광고 및 수익 관리 ─────────────────────────────────
const pct = (v) => (v == null ? '' : `${Math.round(v * 100)}%`);
const cost = (v) => (v == null ? '–' : yuan(v));
const n0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString());

function commentText(c) {
  const v = c.vars;
  const y = (x) => (x == null ? t('adr.na') : yuan(x));
  const vars = { ...v };
  for (const k of ['spend', 'perRead', 'perLikeFav', 'perFollow', 'cost', 'early', 'late', 'strong', 'weak', 'spendPrev', 'perReadPrev']) if (k in v) vars[k] = y(v[k]);
  for (const k of ['diff']) if (k in v) vars[k] = pct(Math.abs(v[k] ?? 0));
  for (const k of ['spendKRW', 'cash', 'inKind']) if (k in v) vars[k] = won(v[k]) || won(0);
  return t(`adr.c.${c.key}`, vars);
}

export async function renderAds({ isCurrent }) {
  const [posts, income, settings, baseline] = await Promise.all([listPosts(), listIncome(), getSettings(), activeBaseline()]);
  if (!isCurrent()) return null;
  const prefs = (() => {
    try {
      return { unit: 'month', ...JSON.parse(localStorage.getItem('xhs-ads-prefs') || '{}') };
    } catch {
      return { unit: 'month' };
    }
  })();
  const totals = adTotals(posts);
  const orders = adOrders(posts);
  const sum = adSummary(orders);
  const comments = adComments(orders, { posts, baseline, income, cnyKrw: settings.cnyKrw });
  const periods = periodRows(orders, prefs.unit, income, settings.cnyKrw);
  const rows = ordered(posts).flatMap((p) => p.ads.map((a, i) => ({ p, a, i }))).reverse();
  const toneCls = { good: 'cf-good', warn: 'cf-mid', info: 'bg-surface-2' };
  const costHead = `<th class="num">${esc(t('ads.perRead'))}</th><th class="num">${esc(t('ads.perLikeFav'))}</th><th class="num">${esc(t('ads.perFollow'))}</th>`;
  const costCells = (r) => `<td class="num">${esc(cost(r.perRead))}</td><td class="num">${esc(cost(r.perLikeFav))}</td><td class="num">${esc(cost(r.perFollow))}</td>`;
  const groupTable = (title, label, list, name) =>
    list.length
      ? `<section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(title)}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(label)}</th><th class="num">${esc(t('adr.orders'))}</th><th class="num">${esc(t('ads.spendYuan'))}</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th>${costHead}</tr></thead>
        <tbody>${list.map((r) => `<tr><td>${esc(name(r))}</td><td class="num">${r.count}</td><td class="num">${esc(yuan(r.spend))}</td><td class="num">${n0(r.reads)}</td><td class="num">${n0(r.likeFav)}</td><td class="num">${n0(r.follows)}</td>${costCells(r)}</tr>`).join('')}</tbody></table></div></section>`
      : '';

  const root = xhsPage({
    nav: 'more',
    wide: true,
    back: '#/more',
    title: t('ads.title'),
    sub: t('ads.sub'),
    actions: `<a class="btn btn-primary btn-sm" href="#/ocr-ad">${icon('scan', 'size-4')}${esc(t('oad.fromShots'))}</a>`,
    body: `
      <div class="kpi-grid">
        <div class="kpi"><p class="kpi-label">${esc(t('ads.spendTotal'))}</p><p class="kpi-value">${esc(yuan(totals.spend) || '0元')}</p><p class="text-[11px] opacity-75">${esc(t('adr.ordersN', { n: totals.count }))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.perRead'))}</p><p class="kpi-value">${esc(cost(sum.perRead))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.perLikeFav'))}</p><p class="kpi-value">${esc(cost(sum.perLikeFav))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.perFollow'))}</p><p class="kpi-value">${esc(cost(sum.perFollow))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('inc.cash'))}</p><p class="kpi-value">${esc(won(income.reduce((a, x) => a + (x.cashKRW ?? 0), 0)) || won(0))}</p></div>
        <div class="kpi ${totals.unconfirmed ? 'cf-mid' : ''}"><p class="kpi-label">${esc(t('ads.toReview'))}</p><p class="kpi-value">${totals.unconfirmed}</p></div>
      </div>
      <p class="mt-2 text-[12px] text-muted">${esc(t('adr.costNote'))}</p>

      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('adr.comments'))}</h2>
        ${comments.length ? `<ul class="mt-2 flex flex-col gap-1.5">${comments.map((c) => `<li class="rounded-[12px] px-3 py-2 text-[14px] leading-relaxed ${toneCls[c.tone]}">${esc(commentText(c))}</li>`).join('')}</ul>` : `<p class="mt-2 text-[14px] text-muted">${esc(t('ads.none'))}</p>`}
        <p class="mt-2 text-[12px] text-muted">${esc(t('adr.commentsNote'))}</p></section>

      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-[16px] font-semibold">${esc(t('adr.byPeriod'))}</h2>
          <div class="segmented segmented-2 !w-auto"><button type="button" class="seg px-3 ${prefs.unit === 'month' ? 'is-active' : ''}" data-unit="month">${esc(t('adr.month'))}</button><button type="button" class="seg px-3 ${prefs.unit === 'year' ? 'is-active' : ''}" data-unit="year">${esc(t('adr.year'))}</button></div></div>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t(prefs.unit === 'year' ? 'adr.year' : 'adr.month'))}</th><th class="num">${esc(t('adr.orders'))}</th><th class="num">${esc(t('ads.spendYuan'))}</th><th class="num">曝光量</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th>${costHead}<th class="num">${esc(t('adr.spendKRW'))}</th><th class="num">${esc(t('inc.cash'))}</th><th class="num">${esc(t('inc.inKind'))}</th><th class="num">${esc(t('adr.net'))}</th></tr></thead>
        <tbody>${periods.map((r) => `<tr><td>${esc(r.period)}${r.estimatedDates ? ` <span class="badge cf-mid" title="${esc(t('adr.estDate'))}">${esc(t('adr.estShort'))}</span>` : ''}</td><td class="num">${r.count}</td><td class="num">${esc(yuan(r.spend))}</td><td class="num">${n0(r.exposure)}</td><td class="num">${n0(r.reads)}</td><td class="num">${n0(r.likeFav)}</td><td class="num">${n0(r.follows)}</td>${costCells(r)}<td class="num">${esc(r.spendKRW == null ? '–' : won(r.spendKRW))}</td><td class="num">${esc(won(r.cash) || '–')}</td><td class="num">${esc(won(r.inKind) || '–')}</td><td class="num ${r.net == null ? '' : r.net >= 0 ? 'cf-good' : 'cf-bad'}">${esc(r.net == null ? '–' : won(r.net))}</td></tr>`).join('') || `<tr><td colspan="15" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-[13px]"><label for="adr-rate">${esc(t('adr.rate'))}</label><input id="adr-rate" class="input !h-9 !w-28 tabular-nums" inputmode="decimal" value="${settings.cnyKrw ?? ''}" placeholder="${esc(t('adr.ratePh'))}" /><span class="text-muted">${esc(t('adr.rateHelp'))}</span></div>
        <p class="mt-1 text-[12px] text-muted">${esc(t('adr.netNote'))}</p>
      </section>

      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('adr.byPost'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th class="col-title">${esc(t('xg.title'))}</th><th class="num">${esc(t('adr.orders'))}</th><th>${esc(t('ads.stage'))}</th><th class="num">${esc(t('ads.spendYuan'))}</th><th class="num">D+1 ${esc(t('m.views'))}</th><th class="num">D+2 ${esc(t('m.views'))}</th><th class="num">${esc(t('ads.betweenSpend'))}</th><th class="num">${esc(t('ads.perView'))}</th></tr></thead>
        <tbody>${postRows(posts).map((r) => {
          const e = adEffect(r.post);
          return `<tr><td class="col-title"><a class="link-btn" href="#/c/${encodeURIComponent(r.post.id)}">${esc(r.post.title)}</a><span class="block text-[11px] text-muted">${esc(r.post.date)}</span></td><td class="num">${r.count}</td><td>${esc(r.stages.join(', '))}</td><td class="num">${esc(yuan(r.spend))}${r.estimatedShare ? ` <span class="badge cf-mid" title="${esc(t('adr.shareHelp'))}">${esc(t('adr.estShort'))}</span>` : ''}</td><td class="num">${esc(fmt('views', r.d1Views))}</td><td class="num">${esc(fmt('views', r.d2Views))}</td><td class="num">${esc(e.betweenSpend ? yuan(e.betweenSpend) : '')}</td><td class="num">${esc(e.perView == null ? '' : yuan(e.perView))}</td></tr>`;
        }).join('') || `<tr><td colspan="8" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('ads.effectNote'))}</p></section>

      ${groupTable(t('adr.byStage'), t('ads.stage'), stageRows(orders), (r) => (r.bucket === '?' ? t('adr.stageUnknown') : r.bucket))}
      ${groupTable(t('adr.byGoal'), t('ads.goal'), goalRows(orders), (r) => r.goal || t('adr.goalUnknown'))}

      <section class="card mt-3">
        <h2 class="text-[16px] font-semibold">${esc(t('ads.history'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th class="col-title">${esc(t('xg.title'))}</th><th>${esc(t('adr.start'))}</th><th>${esc(t('ads.stage'))}</th><th>${esc(t('ads.goal'))}</th><th class="num">${esc(t('ads.spendYuan'))}</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th>${costHead}<th>${esc(t('adr.orderNo'))}</th><th></th></tr></thead>
        <tbody>${rows
          .map(({ p, a, i }) => {
            const e = orderEfficiency(a);
            return `<tr class="${a.needsReview ? 'cf-mid' : ''}"><td class="col-title"><a class="link-btn" href="#/c/${encodeURIComponent(p.id)}">${esc(p.title)}</a><span class="block text-[11px] text-muted">${esc(p.date)}${a.sourceText ? ` · ${esc(t('ads.from', { text: a.sourceText }))}` : ''}${a.noteCount > 1 ? ` · ${esc(t('adr.multiShort', { n: a.noteCount, total: a.orderSpend ?? '?' }))}` : ''}</span></td>
            <td class="tabular-nums">${esc((a.start || '').replace('T', ' '))}</td><td>${esc(a.stage)}${a.executed ? '' : ` (${esc(t('ads.notExecuted'))})`}</td><td>${esc(a.goal)}</td><td class="num">${esc(yuan(a.spend))}${a.allocation === 'equal' ? ` <span class="badge cf-mid">${esc(t('adr.estShort'))}</span>` : ''}</td>
            <td class="num">${a.order.reads ?? ''}</td><td class="num">${e.likeFav ?? ''}</td><td class="num">${a.order.follows ?? ''}</td><td class="num">${esc(e.perRead == null ? '' : yuan(e.perRead))}</td><td class="num">${esc(e.perLikeFav == null ? '' : yuan(e.perLikeFav))}</td><td class="num">${esc(e.perFollow == null ? '' : yuan(e.perFollow))}</td><td class="text-[12px] text-muted">${esc(a.orderNo ? a.orderNo.slice(0, 8) : '')}</td>
            <td><button type="button" class="link-btn" data-ad="${esc(p.id)}" data-i="${i}">${esc(t('ads.edit'))}</button></td></tr>`;
          })
          .join('') || `<tr><td colspan="14" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
      </section>
      <section class="card mt-3">
        <div class="flex items-center justify-between"><h2 class="text-[16px] font-semibold">${esc(t('data.tab.income'))}</h2><a class="link-btn text-[13px]" href="#/data/income">${esc(t('ads.editIncome'))}</a></div>
        <ul class="mt-2 flex flex-col gap-1.5 text-[14px]">${income.map((x) => `<li><b>${esc(x.brand)}</b> · ${esc(x.collabType)} · ${esc(x.date)} — ${esc(t('inc.inKind'))} ${esc(won(x.inKindKRW) || '–')}, ${esc(t('inc.cash'))} ${esc(won(x.cashKRW) || '–')}</li>`).join('') || `<li class="text-muted">–</li>`}</ul>
        <p class="mt-2 text-[12px] text-muted">${esc(t('ads.currencyNote'))}</p>
      </section>`,
  });
  root.addEventListener('click', async (e) => {
    const u = e.target.closest('[data-unit]');
    if (u) {
      try {
        localStorage.setItem('xhs-ads-prefs', JSON.stringify({ ...prefs, unit: u.dataset.unit }));
      } catch {
        /* ignore */
      }
      return navigate('/ads', { replace: true });
    }
    const b = e.target.closest('[data-ad]');
    if (!b) return;
    const p = posts.find((x) => x.id === b.dataset.ad);
    const i = Number(b.dataset.i);
    const ad = p.ads[i];
    const res = await adSheet(ad);
    if (!res) return;
    if (res === 'delete' && ad.groupKey) {
      // A multi-note order lives on each of its posts: delete it everywhere.
      const linked = posts.filter((x) => x.ads.some((a) => a.groupKey === ad.groupKey));
      await savePosts(linked.map((x) => ({ ...x, ads: x.ads.filter((a) => a.groupKey !== ad.groupKey) })));
      return toast(t('common.saved'));
    }
    const ads = [...p.ads];
    if (res === 'delete') ads.splice(i, 1);
    else ads[i] = res;
    await savePosts([{ ...p, ads }]);
    toast(t('common.saved'));
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id !== 'adr-rate') return;
    const raw = e.target.value.trim().replace(',', '.');
    const v = raw ? Number(raw) : null;
    if (raw && !(v > 0)) return toast(t('ocr.badInput', { n: 1 }), { tone: 'error' });
    await saveSettings({ ...settings, cnyKrw: v });
    toast(t('common.saved'));
  });
  const off = onXhsChange(() => navigate('/ads', { replace: true }));
  return { kind: 'xhs-ads', destroy: off };
}

// ── 더보기 ─────────────────────────────────────────────
export async function renderMore({ isCurrent }) {
  if (!isCurrent()) return null;
  const item = (href, ic, label, hint) => `<a href="${href}" class="card flex items-center gap-3">${icon(ic, 'size-6')}<span class="flex-1"><b class="block">${esc(label)}</b><span class="text-[13px] text-muted">${esc(hint)}</span></span>${icon('chevronRight', 'size-5 text-muted')}</a>`;
  xhsPage({
    nav: 'more',
    title: t('nav.more'),
    body: `<div class="flex flex-col gap-2.5">
      ${item('#/ocr', 'scan', t('nav.ocr'), t('more.ocr'))}
      ${item('#/ads', 'coin', t('ads.title'), t('more.ads'))}
      ${item('#/import', 'upload', t('data.import'), t('more.import'))}
      ${item('#/xhs/backup', 'archive', t('more.xhsBackup'), t('more.xhsBackupHint'))}
      ${item('#/new', 'plus', t('nav.new'), t('more.newProject'))}
      ${item('#/settings', 'archive', t('nav.settings'), t('more.settings'))}
    </div>`,
  });
  return { kind: 'more' };
}
