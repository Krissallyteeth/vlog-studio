import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, confirmDialog, esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { fmt, signedPct, won, yuan } from '../../xhs/format.js';
import { METRIC } from '../../xhs/metrics.js';
import { BASELINE_SIZE, adTotals, buildBaseline, byContentType, criteria, judge, median, medians, ordered, relDiff, stage, validPosts } from '../../xhs/stats.js';
import { activeBaseline, addBaseline, getBaselines, getSettings, listIncome, listPosts, onXhsChange } from '../../xhs/store.js';
import { chartLegend, lineChart } from './charts.js';
import { relativeNote, xhsPage } from './shell.js';

const CHARTS = [
  { key: 'views' },
  { key: 'ctr' },
  { key: 'exit2s' },
  { key: 'retain5s' },
  { key: 'avgWatchRatio' },
  { key: 'completion' },
];
const CF = { good: 'cf-good', mid: 'cf-mid', bad: 'cf-bad' };

export async function renderDashboard({ isCurrent }) {
  const [posts, income, baseline, settings] = await Promise.all([listPosts(), listIncome(), activeBaseline(), getSettings()]);
  if (!isCurrent()) return null;
  const list = ordered(posts);
  const valid = validPosts(posts);
  const crit = criteria(posts, baseline, settings);
  const recent = crit.recent;
  const rViews = recent.length ? median(recent.map((p) => stage(p).views)) : null;
  const rCtr = recent.length ? median(recent.map((p) => stage(p).ctr)) : null;
  const impViews = relDiff(rViews, baseline?.medians.views, 1);
  const followersD1 = posts.reduce((s, p) => s + (stage(p).newFollowers ?? 0), 0);
  const withFans = list.filter((p) => typeof p.followers === 'number');
  const fanGrowth = withFans.length > 1 ? withFans.at(-1).followers - withFans[0].followers : null;
  const ads = adTotals(posts);
  const cash = income.reduce((s, x) => s + (x.cashKRW ?? 0), 0);
  const inKind = income.reduce((s, x) => s + (x.inKindKRW ?? 0), 0);

  const kpi = (label, value, sub = '', cls = '') => `<div class="kpi ${cls}"><p class="kpi-label">${esc(label)}</p><p class="kpi-value">${esc(value)}</p>${sub ? `<p class="text-[11px] opacity-75">${esc(sub)}</p>` : ''}</div>`;
  const empty = !posts.length;

  const root = xhsPage({
    nav: 'xhs',
    wide: true,
    title: t('dash.title'),
    sub: t('dash.sub'),
    actions: `<a href="#/ocr" class="btn btn-secondary btn-sm">${icon('scan', 'size-4')}${esc(t('nav.ocr'))}</a><a href="#/data/posts" class="btn btn-secondary btn-sm">${icon('table', 'size-4')}${esc(t('nav.data'))}</a>`,
    body: empty
      ? `<div class="empty card"><div class="empty-icon">${icon('chart', 'size-6')}</div><p class="font-semibold">${esc(t('dash.empty'))}</p><p class="mt-1 text-[14px] text-muted">${esc(t('dash.emptyHint'))}</p><a href="#/import" class="btn btn-primary mt-4">${icon('upload', 'size-4')}${esc(t('data.import'))}</a></div>`
      : `
      <div class="kpi-grid">
        ${kpi(t('dash.k.posts'), String(posts.length), t('dash.k.postsSub', { ad: crit.adMixedCount, unknown: crit.unknownCount }))}
        ${kpi(t('dash.k.valid'), String(valid.length))}
        ${kpi(t('dash.k.rViews'), rViews == null ? '–' : fmt('views', rViews), t('dash.k.recentSub'))}
        ${kpi(t('dash.k.rCtr'), rCtr == null ? '–' : fmt('ctr', rCtr), t('dash.k.recentSub'))}
        ${kpi(t('dash.k.imp'), impViews == null ? '–' : signedPct(impViews), t('dash.k.impSub', { v: baseline?.version ?? '–' }), impViews == null ? '' : impViews > 0.2 ? 'cf-good' : impViews < -0.2 ? 'cf-bad' : 'cf-mid')}
        ${kpi(t('dash.k.followers'), `+${followersD1}`, fanGrowth == null ? '' : t('dash.k.followersSub', { n: fanGrowth >= 0 ? `+${fanGrowth}` : fanGrowth }))}
        ${kpi(t('dash.k.ads'), yuan(ads.spend) || '0元', t('dash.k.adsSub', { credit: yuan(ads.credit) || '0元', n: ads.unconfirmed }))}
        ${kpi(t('dash.k.cash'), won(cash) || won(0), t('dash.k.cashSub', { v: won(inKind) || won(0) }))}
      </div>
      <div class="mt-2 flex flex-wrap items-center justify-between gap-2">${relativeNote()}${chartLegend()}</div>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          ${CHARTS.map((c) => `<section class="card"><h3 class="text-[14px] font-semibold">${esc(METRIC[c.key].zh)} <span class="font-normal text-muted">${esc(t(`m.${c.key}`))}${METRIC[c.key].dir < 0 ? ` · ${esc(t('dash.lowerBetter'))}` : ''}</span></h3><div class="mt-2" data-chart="${c.key}"></div></section>`).join('')}
          <section class="card"><h3 class="text-[14px] font-semibold">粉丝 <span class="font-normal text-muted">${esc(t('dash.fans'))}</span></h3><div class="mt-2" data-chart="followers"></div></section>
          <section class="card"><h3 class="text-[14px] font-semibold">涨粉丝 <span class="font-normal text-muted">${esc(t('dash.newFans'))}</span></h3><div class="mt-2" data-chart="newFollowers"></div></section>
        </div>
        <aside class="flex min-w-0 flex-col gap-4">
          <section class="card">
            <div class="flex items-center justify-between"><h3 class="text-[15px] font-semibold">${esc(t('dash.recent5'))}</h3><a class="link-btn text-[13px]" href="#/data/posts">${esc(t('dash.all'))}</a></div>
            <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th class="col-title">${esc(t('xg.title'))}</th>${['views', 'ctr', 'exit2s', 'retain5s', 'completion'].map((k) => `<th class="num">${esc(METRIC[k].zh)}</th>`).join('')}</tr></thead>
            <tbody>${list
              .slice(-5)
              .reverse()
              .map(
                (p) => `<tr class="cursor-pointer" data-goto="${esc(p.id)}"><td class="col-title"><span class="font-medium">${esc(p.title)}</span>${p.validity === '광고혼입' ? ` <span class="badge cf-mid">${esc(t('xg.admixed'))}</span>` : ''}<span class="block text-[11px] text-muted">${esc(p.date)}</span></td>${['views', 'ctr', 'exit2s', 'retain5s', 'completion']
                  .map((k) => `<td class="num ${CF[judge(k, stage(p)[k], baseline?.medians[k], p.validity)] ?? ''}">${esc(fmt(k, stage(p)[k]))}</td>`)
                  .join('')}</tr>`,
              )
              .join('')}</tbody></table></div>
            <p class="mt-2 text-[12px] text-muted">${esc(t('dash.clickRow'))}</p>
          </section>
          ${typesHtml(posts)}
          ${longTermHtml(posts, baseline, crit)}
        </aside>
      </div>`,
  });

  if (!empty) {
    const points = (key) => list.map((p) => ({ y: stage(p)[key], admixed: p.validity === '광고혼입', label: `#${p.no ?? ''}`, title: p.title, date: p.date }));
    for (const c of CHARTS) {
      lineChart($(`[data-chart="${c.key}"]`, root), { points: points(c.key), baseline: baseline?.medians[c.key] ?? null, baselineLabel: `V${baseline?.version ?? ''}`, format: (v) => fmt(c.key, v), title: METRIC[c.key].zh });
    }
    lineChart($('[data-chart="followers"]', root), { points: list.map((p) => ({ y: p.followers, admixed: p.validity === '광고혼입', label: `#${p.no ?? ''}`, title: p.title, date: p.date })), format: (v) => Math.round(v).toLocaleString('en-US'), title: '粉丝' });
    lineChart($('[data-chart="newFollowers"]', root), { points: points('newFollowers'), format: (v) => String(Math.round(v * 10) / 10), title: '涨粉丝' });
  }
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-goto]');
    if (row) navigate(`/data/posts/${encodeURIComponent(row.dataset.goto)}`);
  });
  const off = onXhsChange(() => navigate('/xhs', { replace: true }));
  window.scrollTo(0, 0);
  return { kind: 'xhs-dash', destroy: off };
}

function typesHtml(posts) {
  const groups = byContentType(posts);
  if (!groups.length) return '';
  const keys = ['views', 'ctr', 'retain5s', 'completion'];
  return `<section class="card"><h3 class="text-[15px] font-semibold">${esc(t('dash.types'))}</h3>
    <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('xg.type'))}</th><th class="num">n</th>${keys.map((k) => `<th class="num">${esc(METRIC[k].zh)}</th>`).join('')}<th class="num">涨粉丝</th></tr></thead>
    <tbody>${groups.map((g) => `<tr><td>${esc(g.type || t('data.noType'))}${g.reliable ? '' : ` <span class="badge cf-mid" title="${esc(t('dash.lowN'))}">${esc(t('dash.lowNShort'))}</span>`}</td><td class="num">${g.count}</td>${keys.map((k) => `<td class="num">${esc(fmt(k, g.medians[k]))}</td>`).join('')}<td class="num">${g.followers}</td></tr>`).join('')}</tbody></table></div>
    <p class="mt-2 text-[12px] text-muted">${esc(t('dash.typesNote'))}</p></section>`;
}

/** Long-term view: fixed baseline vs recent 5 / recent 10 / all valid posts (shown from 20 posts). */
function longTermHtml(posts, baseline, crit) {
  const valid = validPosts(posts);
  const keys = ['views', 'ctr', 'exit2s', 'retain5s', 'completion'];
  if (valid.length < 20) {
    return `<section class="card"><h3 class="text-[15px] font-semibold">${esc(t('dash.long'))}</h3><p class="mt-1 text-[13px] text-muted">${esc(t('dash.longWait', { n: valid.length, left: 20 - valid.length }))}</p>
      <a class="btn btn-secondary btn-sm mt-3" href="#/xhs/baseline">${esc(t('crit.propose'))}</a></section>`;
  }
  const all = medians(valid);
  const r10 = medians(valid.slice(-10));
  const r5 = medians(valid.slice(-5));
  const col = (m, k) => `<td class="num">${esc(fmt(k, m[k]))}</td>`;
  return `<section class="card"><h3 class="text-[15px] font-semibold">${esc(t('dash.long'))}</h3>
    <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th></th>${keys.map((k) => `<th class="num">${esc(METRIC[k].zh)}</th>`).join('')}</tr></thead><tbody>
      <tr><td>${esc(t('dash.l.fixed', { v: baseline?.version ?? '' }))}</td>${keys.map((k) => col(baseline?.medians ?? {}, k)).join('')}</tr>
      <tr><td>${esc(t('dash.l.all', { n: valid.length }))}</td>${keys.map((k) => col(all, k)).join('')}</tr>
      <tr><td>${esc(t('crit.recent10'))}</td>${keys.map((k) => col(r10, k)).join('')}</tr>
      <tr><td>${esc(t('crit.recent5'))}</td>${keys.map((k) => col(r5, k)).join('')}</tr>
    </tbody></table></div><p class="mt-2 text-[12px] text-muted">${esc(t('dash.longNote'))}</p>
    <a class="btn btn-secondary btn-sm mt-3" href="#/xhs/baseline">${esc(t('crit.propose'))}</a></section>`;
}

// ── Baseline review: new versions only on explicit approval ──
export async function renderBaseline({ isCurrent }) {
  const [posts, baselines, active] = await Promise.all([listPosts(), getBaselines(), activeBaseline()]);
  if (!isCurrent()) return null;
  const valid = validPosts(posts);
  const size = Math.min(BASELINE_SIZE, valid.length);
  const candidatePosts = valid.slice(-size);
  const candidate = size ? { ...buildBaseline(candidatePosts, { size }), postIds: candidatePosts.map((p) => p.id) } : null;
  const keys = ['exposure', 'views', 'ctr', 'exit2s', 'retain5s', 'interactionRate', 'avgWatchRatio', 'completion'];
  const root = xhsPage({
    nav: 'xhs',
    back: '#/data/criteria',
    title: t('base.title'),
    sub: t('base.sub'),
    body: `
      <section class="card"><p class="text-[14px] leading-relaxed">${esc(t('base.explain'))}</p></section>
      <section class="card mt-3">
        <h3 class="text-[15px] font-semibold">${esc(t('base.compare', { n: size }))}</h3>
        <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('crit.metric'))}</th><th class="num">${esc(t('base.active', { v: active?.version ?? '–' }))}</th><th class="num">${esc(t('base.candidate'))}</th><th class="num">${esc(t('base.diff'))}</th></tr></thead>
        <tbody>${keys.map((k) => {
          const d = relDiff(candidate?.medians[k], active?.medians[k], METRIC[k].dir);
          return `<tr><td>${esc(METRIC[k].zh)} <span class="text-muted text-[12px]">${esc(t(`m.${k}`))}</span></td><td class="num">${esc(fmt(k, active?.medians[k]))}</td><td class="num">${esc(fmt(k, candidate?.medians[k]))}</td><td class="num">${esc(signedPct(d))}</td></tr>`;
        }).join('')}</tbody></table></div>
        <p class="mt-2 text-[12px] text-muted">${esc(t('base.posts', { list: candidatePosts.map((p) => p.title).join(', ') }))}</p>
        <label class="field mt-3"><span class="field-label">${esc(t('base.note'))}</span><input class="input" id="base-note" placeholder="${esc(t('base.notePh'))}" /></label>
        <button type="button" class="btn btn-primary mt-3" id="base-approve" ${candidate && valid.length >= BASELINE_SIZE ? '' : 'disabled'}>${esc(t('base.approve'))}</button>
        ${valid.length < BASELINE_SIZE ? `<p class="mt-2 text-[12px] text-muted">${esc(t('base.needMore', { n: BASELINE_SIZE }))}</p>` : ''}
      </section>
      <section class="card mt-3"><h3 class="text-[15px] font-semibold">${esc(t('crit.versions'))}</h3>
        <ul class="mt-2 text-[13px]">${baselines.map((b) => `<li>Version ${b.version} · ${esc(t('crit.basedOn', { n: b.size }))}${b.version === active?.version ? ` <span class="badge cf-good">${esc(t('crit.active'))}</span>` : ''}${b.note && b.note !== 'initial-11' ? ` · ${esc(b.note)}` : ''}</li>`).join('')}</ul></section>`,
  });
  $('#base-approve', root).addEventListener('click', async () => {
    const ok = await confirmDialog({ title: t('base.confirmTitle'), message: t('base.confirmBody'), confirmText: t('base.approve') });
    if (!ok) return;
    await addBaseline({ ...candidate, note: $('#base-note', root).value.trim() || t('base.defaultNote', { n: size }), createdAt: Date.now() });
    toast(t('base.done'));
    navigate('/data/criteria', { replace: true });
  });
  return { kind: 'xhs-baseline' };
}
