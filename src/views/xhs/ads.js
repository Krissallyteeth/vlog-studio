import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { adEffect, orderEfficiency } from '../../xhs/analysis.js';
import { fmt, won, yuan } from '../../xhs/format.js';
import { adTotals } from '../../xhs/stats.js';
import { savePosts, saveSettings } from '../../xhs/store.js';
import { adComments, adOrders, adSummary, goalRows, historyEntries, NOTE_FIELDS, periodRows, postRows, stageRows } from '../../xhs/ad-report.js';
import { adSheet } from './post.js';
import { insightList } from './insight-text.js';
import { adInsights } from '../../xhs/insights.js';
import { xhsPage } from './shell.js';

// ── 광고 및 수익 관리 ─────────────────────────────────
const pct = (v) => (v == null ? '' : `${Math.round(v * 100)}%`);
const cost = (v) => (v == null ? '–' : yuan(v));
const n0 = (v) => (v == null ? '–' : Math.round(v).toLocaleString());

function commentText(c) {
  const v = c.vars;
  const y = (x) => (x == null ? t('adr.na') : yuan(x));
  const vars = { ...v };
  for (const k of ['spend', 'credit', 'perRead', 'perLikeFav', 'perFollow', 'cost', 'early', 'late', 'strong', 'weak', 'spendPrev', 'perReadPrev']) if (k in v) vars[k] = y(v[k]);
  for (const k of ['diff']) if (k in v) vars[k] = pct(Math.abs(v[k] ?? 0));
  for (const k of ['spendKRW', 'cash', 'inKind']) if (k in v) vars[k] = won(v[k]) || won(0);
  return t(`adr.c.${c.key}`, vars);
}

const loadPrefs = () => {
  try {
    return { unit: 'month', ...JSON.parse(localStorage.getItem('xhs-ads-prefs') || '{}') };
  } catch {
    return { unit: 'month' };
  }
};

/** The old ad page: records now live in Data → ③ 광고기록, analysis on the dashboard. */
export async function renderAds() {
  navigate('/data/ads', { replace: true });
  return null;
}

/**
 * Ad & income analysis for the dashboard: totals, comments, month/year, per post, D+n and goal.
 * `rerender` redraws the host screen (after the month/year switch).
 */
export function adAnalysisSection({ posts, income, settings, baseline }, rerender) {
  const prefs = loadPrefs();
  const totals = adTotals(posts);
  const orders = adOrders(posts);
  const sum = adSummary(orders);
  const comments = adComments(orders, { posts, baseline, income, cnyKrw: settings.cnyKrw });
  const periods = periodRows(orders, prefs.unit, income, settings.cnyKrw);
  const insights = adInsights(posts);
  // Comments the insights already cover (and phrase per goal) are not repeated.
  const has = (k) => insights.some((x) => x.key === k);
  const covered = [...(has('goalForFollowers') ? ['followsFromLikeFav'] : []), ...(has('naturalCut') ? ['boost'] : []), ...(has('timing') ? ['stage'] : [])];
  const shown = comments.filter((c) => !covered.some((k) => c.key.startsWith(k)));
  const toneCls = { good: 'cf-good', warn: 'cf-mid', info: 'bg-surface-2' };
  const costHead = `<th class="num" data-m="inline">${esc(t('ads.perRead'))}</th><th class="num">${esc(t('ads.perLikeFav'))}</th><th class="num">${esc(t('ads.perFollow'))}</th>`;
  const costCells = (r) => `<td class="num">${esc(cost(r.perRead))}</td><td class="num">${esc(cost(r.perLikeFav))}</td><td class="num">${esc(cost(r.perFollow))}</td>`;
  const groupTable = (title, label, list, name) =>
    list.length
      ? `<section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(title)}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(label)}</th><th class="num" data-m="inline">${esc(t('adr.orders'))}</th><th class="num" data-m="key">${esc(t('ads.spendYuan'))}</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th>${costHead}</tr></thead>
        <tbody>${list.map((r) => `<tr><td>${esc(name(r))}</td><td class="num">${r.count}</td><td class="num">${esc(yuan(r.spend))}</td><td class="num">${n0(r.reads)}</td><td class="num">${n0(r.likeFav)}</td><td class="num">${n0(r.follows)}</td>${costCells(r)}</tr>`).join('')}</tbody></table></div></section>`
      : '';

  const html = `
      <div class="kpi-grid">
        <div class="kpi"><p class="kpi-label">${esc(t('ads.spendTotal'))}</p><p class="kpi-value">${esc(yuan(totals.spend) || '0元')}</p><p class="text-[11px] opacity-75">${esc(t('adr.ordersN', { n: totals.count }))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('adr.credit'))}</p><p class="kpi-value">${esc(yuan(totals.credit) || '0元')}</p><p class="text-[11px] opacity-75">${esc(t('adr.creditSub'))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.perRead'))}</p><p class="kpi-value">${esc(cost(sum.perRead))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.perLikeFav'))}</p><p class="kpi-value">${esc(cost(sum.perLikeFav))}</p><p class="text-[11px] opacity-75">${esc(t('adr.goalOrders', { goal: '点赞收藏', n: sum.likeFavOrders }))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.perFollow'))}</p><p class="kpi-value">${esc(cost(sum.perFollow))}</p><p class="text-[11px] opacity-75">${esc(t('adr.goalOrders', { goal: '关注', n: sum.followOrders }))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('inc.cash'))}</p><p class="kpi-value">${esc(won(income.reduce((a, x) => a + (x.cashKRW ?? 0), 0)) || won(0))}</p></div>
        <div class="kpi ${totals.unconfirmed ? 'cf-mid' : ''}"><p class="kpi-label">${esc(t('ads.toReview'))}</p><p class="kpi-value">${totals.unconfirmed}</p></div>
      </div>
      <p class="mt-2 text-[12px] text-muted">${esc(t('adr.costNote'))}</p>

      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('ins.title'))}</h2>
        ${insightList('ins', insights, { empty: t('ops.none') })}
        <p class="mt-2 text-[12px] text-muted">${esc(t('ins.note'))}</p></section>

      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('adr.comments'))}</h2>
        ${shown.length ? `<ul class="mt-2 flex flex-col gap-1.5">${shown.map((c) => `<li class="rounded-[12px] px-3 py-2 text-[14px] leading-relaxed ${toneCls[c.tone]}">${esc(commentText(c))}</li>`).join('')}</ul>` : `<p class="mt-2 text-[14px] text-muted">${esc(t('ads.none'))}</p>`}
        <p class="mt-2 text-[12px] text-muted">${esc(t('adr.commentsNote'))}</p></section>

      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-[16px] font-semibold">${esc(t('adr.byPeriod'))}</h2>
          <div class="segmented segmented-2 !w-auto"><button type="button" class="seg px-3 ${prefs.unit === 'month' ? 'is-active' : ''}" data-unit="month">${esc(t('adr.month'))}</button><button type="button" class="seg px-3 ${prefs.unit === 'year' ? 'is-active' : ''}" data-unit="year">${esc(t('adr.year'))}</button></div></div>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t(prefs.unit === 'year' ? 'adr.year' : 'adr.month'))}</th><th class="num" data-m="inline">${esc(t('adr.orders'))}</th><th class="num" data-m="key">${esc(t('ads.spendYuan'))}</th><th class="num">${esc(t('adr.creditCol'))}</th><th class="num">曝光量</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th>${costHead}<th class="num">${esc(t('adr.spendKRW'))}</th><th class="num">${esc(t('inc.cash'))}</th><th class="num">${esc(t('inc.inKind'))}</th><th class="num">${esc(t('adr.net'))}</th></tr></thead>
        <tbody>${periods.map((r) => `<tr><td>${esc(r.period)}${r.estimatedDates ? ` <span class="badge cf-mid" title="${esc(t('adr.estDate'))}">${esc(t('adr.estShort'))}</span>` : ''}</td><td class="num">${r.count}</td><td class="num">${esc(yuan(r.spend))}</td><td class="num">${esc(r.credit ? yuan(r.credit) : '')}</td><td class="num">${n0(r.exposure)}</td><td class="num">${n0(r.reads)}</td><td class="num">${n0(r.likeFav)}</td><td class="num">${n0(r.follows)}</td>${costCells(r)}<td class="num">${esc(r.spendKRW == null ? '–' : won(r.spendKRW))}</td><td class="num">${esc(won(r.cash) || '–')}</td><td class="num">${esc(won(r.inKind) || '–')}</td><td class="num ${r.net == null ? '' : r.net >= 0 ? 'cf-good' : 'cf-bad'}">${esc(r.net == null ? '–' : won(r.net))}</td></tr>`).join('') || `<tr><td colspan="16" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-[13px]"><label for="adr-rate">${esc(t('adr.rate'))}</label><input id="adr-rate" class="input !h-9 !w-28 tabular-nums" inputmode="decimal" value="${settings.cnyKrw ?? ''}" placeholder="${esc(t('adr.ratePh'))}" /><span class="text-muted">${esc(t('adr.rateHelp'))}</span></div>
        <p class="mt-1 text-[12px] text-muted">${esc(t('adr.netNote'))}</p>
      </section>

      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('adr.byPost'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th class="col-title">${esc(t('xg.title'))}</th><th data-m="inline">${esc(t('ads.stage'))}</th><th class="num" data-m="key">${esc(t('ads.spendYuan'))}</th><th class="num" data-m="inline">${esc(t('adr.adReads'))}</th><th class="num" data-m="inline">${esc(t('ads.perRead'))}</th><th class="num">${esc(t('adr.adLikeFav'))}</th><th class="num">${esc(t('adr.adFollows'))}</th><th data-m="inline">${esc(t('adr.reportCol'))}</th><th class="num">D+1 ${esc(t('m.views'))}</th><th class="num">D+2 ${esc(t('m.views'))}</th><th class="num">${esc(t('ads.betweenSpend'))}</th></tr></thead>
        <tbody>${postRows(posts).map((r) => {
          const e = adEffect(r.post);
          const rep = r.missingReports ? `<span class="badge cf-mid" title="${esc(t('adr.needShotHelp'))}">${esc(t('adr.reportN', { n: r.reports, total: r.count }))}</span>` : `<span class="badge cf-good">${esc(t('adr.reportAll'))}</span>`;
          return `<tr><td class="col-title"><a class="link-btn" href="#/c/${encodeURIComponent(r.post.id)}">${esc(r.post.title)}</a><span class="block text-[11px] text-muted">${esc(r.post.date)}</span></td><td>${esc(r.stages.join(', '))}</td><td class="num">${esc(yuan(r.spend))}${r.estimatedShare ? ` <span class="badge cf-mid" title="${esc(t('adr.shareHelp'))}">${esc(t('adr.estShort'))}</span>` : ''}</td><td class="num">${r.reads ?? ''}</td><td class="num">${esc(r.perRead == null ? '' : yuan(r.perRead))}</td><td class="num">${r.likeFav ?? ''}</td><td class="num">${r.follows ?? ''}</td><td>${rep}</td><td class="num">${esc(fmt('views', r.d1Views))}</td><td class="num">${esc(fmt('views', r.d2Views))}</td><td class="num">${esc(e.betweenSpend && !r.reports ? yuan(e.betweenSpend) : '')}</td></tr>`;
        }).join('') || `<tr><td colspan="11" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('adr.byPostNote'))}</p></section>

      ${groupTable(t('adr.byStage'), t('ads.stage'), stageRows(orders), (r) => (r.bucket === '?' ? t('adr.stageUnknown') : r.bucket))}
      ${groupTable(t('adr.byGoal'), t('ads.goal'), goalRows(orders), (r) => r.goal || t('adr.goalUnknown'))}`;
  const bind = (root) => {
    root.addEventListener('click', (e) => {
      const u = e.target.closest('[data-unit]');
    if (u) {
      try {
        localStorage.setItem('xhs-ads-prefs', JSON.stringify({ ...prefs, unit: u.dataset.unit }));
      } catch {
        /* ignore */
      }
      return rerender();
    }
    });
    root.addEventListener('change', async (e) => {
    if (e.target.id !== 'adr-rate') return;
    const raw = e.target.value.trim().replace(',', '.');
    const v = raw ? Number(raw) : null;
    if (raw && !(v > 0)) return toast(t('ocr.badInput', { n: 1 }), { tone: 'error' });
    await saveSettings({ ...settings, cnyKrw: v });
    toast(t('common.saved'));
    });
  };
  return { html, bind };
}

/** Order-level ad history for Data → ③ 광고기록: one row per order, multi-note orders folded. */
export function adRecordsSection({ posts }) {
  const history = historyEntries(posts);
  const costHead = `<th class="num" data-m="inline">${esc(t('ads.perRead'))}</th><th class="num">${esc(t('ads.perLikeFav'))}</th><th class="num">${esc(t('ads.perFollow'))}</th>`;
  const html = `
      <div class="mb-3 flex flex-wrap items-center gap-2"><a class="btn btn-primary btn-sm" href="#/ocr-ad">${icon('scan', 'size-4')}${esc(t('oad.fromShots'))}</a><a class="btn btn-secondary btn-sm" href="#/xhs" data-scroll-to="ad-analysis">${icon('chart', 'size-4')}${esc(t('adr.toAnalysis'))}</a></div>
      <section class="card">
        <h2 class="text-[16px] font-semibold">${esc(t('ads.history'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th class="col-title">${esc(t('xg.title'))}</th><th>${esc(t('adr.start'))}</th><th data-m="inline">${esc(t('ads.stage'))}</th><th data-m="inline">${esc(t('ads.goal'))}</th><th class="num" data-m="key">${esc(t('ads.spendYuan'))}</th><th class="num">${esc(t('adr.creditCol'))}</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th>${costHead}<th>${esc(t('adr.orderNo'))}</th><th data-m="inline"></th></tr></thead>
        <tbody>${history
          .map((h) => {
            const a = h.ad;
            const e = orderEfficiency(a);
            const metrics = `<td class="num">${a.order.reads ?? ''}</td><td class="num">${e.likeFav ?? ''}</td><td class="num">${a.order.follows ?? ''}</td><td class="num">${esc(e.perRead == null ? '' : yuan(e.perRead))}</td><td class="num">${esc(e.perLikeFav == null ? '' : yuan(e.perLikeFav))}</td><td class="num">${esc(e.perFollow == null ? '' : yuan(e.perFollow))}</td><td class="text-[12px] text-muted">${esc(a.orderNo ? a.orderNo.slice(0, 8) : '')}</td>`;
            const startCell = `<td class="tabular-nums">${esc((a.start || '').replace('T', ' '))}</td>`;
            if (!h.multi) {
              const { p, i } = h.items[0];
              return `<tr class="${a.needsReview ? 'cf-mid' : ''}"><td class="col-title"><a class="link-btn" href="#/c/${encodeURIComponent(p.id)}">${esc(p.title)}</a><span class="block text-[11px] text-muted">${esc(p.date)}${a.sourceText ? ` · ${esc(t('ads.from', { text: a.sourceText }))}` : ''}</span></td>
            ${startCell}<td>${esc(a.stage)}${a.executed ? '' : ` (${esc(t('ads.notExecuted'))})`}</td><td>${esc(a.goal)}</td><td class="num">${esc(yuan(a.spend))}</td><td class="num">${esc(a.credit ? yuan(a.credit) : '')}</td>
            ${metrics}<td><button type="button" class="link-btn" data-ad="${esc(p.id)}" data-i="${i}">${esc(t('ads.edit'))}</button></td></tr>`;
            }
            // A multi-note order: one row with the order's numbers, its notes folded below.
            const notes = h.items
              .map(({ p, a: x, i }) => `<tr class="hist-note" data-parent="${esc(h.key)}" hidden><td class="col-title pl-5"><a class="link-btn" href="#/c/${encodeURIComponent(p.id)}">${esc(p.title)}</a><span class="block text-[11px] text-muted">${esc(p.date)}</span></td><td></td><td>${esc(x.stage)}</td><td></td><td class="num">${esc(yuan(x.spend))}${x.allocation === 'equal' ? ` <span class="badge cf-mid" title="${esc(t('adr.shareHelp'))}">${esc(t('adr.estShort'))}</span>` : ''}</td><td class="num">${esc(x.credit ? yuan(x.credit) : '')}</td><td colspan="7" class="text-[12px] text-muted">${esc(t('adr.noteOfOrder'))}</td><td><button type="button" class="link-btn" data-ad="${esc(p.id)}" data-i="${i}">${esc(t('ads.edit'))}</button></td></tr>`)
              .join('');
            return `<tr class="${a.needsReview ? 'cf-mid' : ''}"><td class="col-title"><b>${esc(t('adr.groupTitle', { n: h.ad.noteCount || h.items.length }))}</b><span class="block text-[11px] text-muted">${esc(h.items.map((x) => x.p.title).join(' · '))}</span><button type="button" class="link-btn text-[12px]" data-toggle="${esc(h.key)}" aria-expanded="false">${esc(t('adr.showNotes', { n: h.items.length }))}</button>${h.outside ? `<span class="mt-1 block text-[11px] text-muted" title="${esc(t('oad.laterHelp', { n: h.outside }))}">${esc(t('oad.laterN', { n: h.outside }))}</span>` : ''}</td>
            ${startCell}<td class="text-muted">${esc(t('adr.perNote'))}</td><td>${esc(a.goal)}</td><td class="num">${esc(yuan(h.spend))}</td><td class="num">${esc(h.credit ? yuan(h.credit) : '')}</td>
            ${metrics}<td><button type="button" class="link-btn" data-group="${esc(h.key)}">${esc(t('ads.edit'))}</button></td></tr>${notes}`;
          })
          .join('') || `<tr><td colspan="15" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('adr.historyNote'))}</p>
      </section>`;
  const bind = (root) => {
    root.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-scroll-to]');
    if (go) {
      try {
        sessionStorage.setItem('xhs-scroll', go.dataset.scrollTo);
      } catch {
        /* ignore */
      }
      return;
    }
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const open = tg.getAttribute('aria-expanded') !== 'true';
      tg.setAttribute('aria-expanded', String(open));
      for (const r of root.querySelectorAll('tr[data-parent]')) if (r.dataset.parent === tg.dataset.toggle) r.hidden = !open;
      return;
    }
    const g = e.target.closest('[data-group]');
    if (g) {
      // Editing a multi-note order changes the order's own fields on every note; each note keeps its share.
      const h = history.find((x) => x.key === g.dataset.group);
      if (!h) return;
      const res = await adSheet(h.ad);
      if (!res) return;
      const gk = h.ad.groupKey;
      const linked = posts.filter((x) => x.ads.some((a) => a.groupKey === gk));
      if (res === 'delete') await savePosts(linked.map((x) => ({ ...x, ads: x.ads.filter((a) => a.groupKey !== gk) })));
      else {
        const shared = Object.fromEntries(Object.entries(res).filter(([k]) => !NOTE_FIELDS.includes(k)));
        await savePosts(linked.map((x) => ({ ...x, ads: x.ads.map((a) => (a.groupKey === gk ? { ...a, ...shared, groupKey: gk } : a)) })));
      }
      return toast(t('common.saved'));
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
  };
  return { html, bind };
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
      ${item('#/import', 'upload', t('data.import'), t('more.import'))}
      ${item('#/xhs/backup', 'archive', t('more.xhsBackup'), t('more.xhsBackupHint'))}
      ${item('#/new', 'plus', t('nav.new'), t('more.newProject'))}
      ${item('#/settings', 'archive', t('nav.settings'), t('more.settings'))}
    </div>`,
  });
  return { kind: 'more' };
}
