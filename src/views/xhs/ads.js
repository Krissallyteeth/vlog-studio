import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { adEffect, orderEfficiency } from '../../xhs/analysis.js';
import { fmt, won, yuan } from '../../xhs/format.js';
import { adTotals, ordered, stage } from '../../xhs/stats.js';
import { listIncome, listPosts, onXhsChange, savePosts } from '../../xhs/store.js';
import { adSheet } from './post.js';
import { xhsPage } from './shell.js';

// ── 광고 및 수익 관리 ─────────────────────────────────
export async function renderAds({ isCurrent }) {
  const [posts, income] = await Promise.all([listPosts(), listIncome()]);
  if (!isCurrent()) return null;
  const totals = adTotals(posts);
  const cash = income.reduce((s, x) => s + (x.cashKRW ?? 0), 0);
  const inKind = income.reduce((s, x) => s + (x.inKindKRW ?? 0), 0);
  const rows = ordered(posts).flatMap((p) => p.ads.map((a, i) => ({ p, a, i })));
  const root = xhsPage({
    nav: 'more',
    wide: true,
    back: '#/more',
    title: t('ads.title'),
    sub: t('ads.sub'),
    body: `
      <div class="kpi-grid">
        <div class="kpi"><p class="kpi-label">${esc(t('ads.count'))}</p><p class="kpi-value">${totals.count}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.spendTotal'))}</p><p class="kpi-value">${esc(yuan(totals.spend) || '0元')}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('ads.creditTotal'))}</p><p class="kpi-value">${esc(yuan(totals.credit) || '0元')}</p></div>
        <div class="kpi ${totals.unconfirmed ? 'cf-mid' : ''}"><p class="kpi-label">${esc(t('ads.toReview'))}</p><p class="kpi-value">${totals.unconfirmed}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('inc.cash'))}</p><p class="kpi-value">${esc(won(cash) || won(0))}</p></div>
        <div class="kpi"><p class="kpi-label">${esc(t('inc.inKind'))}</p><p class="kpi-value">${esc(won(inKind) || won(0))}</p></div>
      </div>
      <p class="mt-2 text-[12px] text-muted">${esc(t('ads.currencyNote'))}</p>
      <section class="card mt-3">
        <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-[16px] font-semibold">${esc(t('ads.history'))}</h2><a class="btn btn-primary btn-sm" href="#/ocr-ad">${icon('scan', 'size-4')}${esc(t('oad.fromShots'))}</a></div>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('xg.title'))}</th><th>${esc(t('ads.stage'))}</th><th>${esc(t('ads.goal'))}</th><th class="num">${esc(t('ads.hours'))}</th><th class="num">${esc(t('ads.spendYuan'))}</th><th class="num">${esc(t('ads.creditYuan'))}</th><th class="num">阅读量</th><th class="num">点赞+收藏</th><th class="num">新增关注</th><th class="num">${esc(t('ads.perRead'))}</th><th class="num">${esc(t('ads.perLikeFav'))}</th><th class="num">${esc(t('ads.perFollow'))}</th><th>${esc(t('ads.result'))}</th><th></th></tr></thead>
        <tbody>${rows
          .map(({ p, a, i }) => {
            const e = orderEfficiency(a);
            return `<tr class="${a.needsReview ? 'cf-mid' : ''}"><td><a class="link-btn" href="#/c/${encodeURIComponent(p.id)}">${esc(p.title)}</a><span class="block text-[11px] text-muted">${esc(p.date)}${a.sourceText ? ` · ${esc(t('ads.from', { text: a.sourceText }))}` : ''}</span></td>
            <td>${esc(a.stage)}${a.executed ? '' : ` (${esc(t('ads.notExecuted'))})`}</td><td>${esc(a.goal)}</td><td class="num">${a.hours ?? ''}</td><td class="num">${esc(yuan(a.spend))}</td><td class="num">${esc(yuan(a.credit))}</td>
            <td class="num">${a.order.reads ?? ''}</td><td class="num">${e.likeFav ?? ''}</td><td class="num">${a.order.follows ?? ''}</td><td class="num">${esc(e.perRead == null ? '' : yuan(e.perRead))}</td><td class="num">${esc(e.perLikeFav == null ? '' : yuan(e.perLikeFav))}</td><td class="num">${esc(e.perFollow == null ? '' : yuan(e.perFollow))}</td><td>${esc(a.result)}</td>
            <td><button type="button" class="link-btn" data-ad="${esc(p.id)}" data-i="${i}">${esc(t('ads.edit'))}</button></td></tr>`;
          })
          .join('') || `<tr><td colspan="12" class="text-muted">${esc(t('ads.none'))}</td></tr>`}</tbody></table></div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('ads.effectNote'))}</p>
      </section>
      <section class="card mt-3">
        <div class="flex items-center justify-between"><h2 class="text-[16px] font-semibold">${esc(t('data.tab.income'))}</h2><a class="link-btn text-[13px]" href="#/data/income">${esc(t('ads.editIncome'))}</a></div>
        <ul class="mt-2 flex flex-col gap-1.5 text-[14px]">${income.map((x) => `<li><b>${esc(x.brand)}</b> · ${esc(x.collabType)} · ${esc(x.date)} — ${esc(t('inc.inKind'))} ${esc(won(x.inKindKRW) || '–')}, ${esc(t('inc.cash'))} ${esc(won(x.cashKRW) || '–')}</li>`).join('') || `<li class="text-muted">–</li>`}</ul>
      </section>
      <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('ads.byPost'))}</h2>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('xg.title'))}</th><th class="num">D+1 ${esc(t('m.views'))}</th><th class="num">D+2 ${esc(t('m.views'))}</th><th class="num">D+1 涨粉丝</th><th class="num">D+2 涨粉丝</th><th class="num">${esc(t('ads.betweenSpend'))}</th><th class="num">${esc(t('ads.perView'))}</th><th class="num">${esc(t('ads.spendYuan'))}</th></tr></thead>
        <tbody>${ordered(posts).map((p) => `<tr><td>${esc(p.title)}</td><td class="num">${esc(fmt('views', stage(p).views))}</td><td class="num">${esc(fmt('views', stage(p, 'd2').views))}</td><td class="num">${stage(p).newFollowers ?? ''}</td><td class="num">${stage(p, 'd2').newFollowers ?? ''}</td><td class="num">${esc(yuan(adEffect(p).betweenSpend))}</td><td class="num">${esc(adEffect(p).perView == null ? '' : yuan(adEffect(p).perView))}</td><td class="num">${esc(yuan(adEffect(p).spend))}</td></tr>`).join('')}</tbody></table></div></section>`,
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ad]');
    if (!b) return;
    const p = posts.find((x) => x.id === b.dataset.ad);
    const i = Number(b.dataset.i);
    const res = await adSheet(p.ads[i]);
    if (!res) return;
    const ads = [...p.ads];
    if (res === 'delete') ads.splice(i, 1);
    else ads[i] = res;
    await savePosts([{ ...p, ads }]);
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
