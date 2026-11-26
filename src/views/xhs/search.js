import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { confirmDialog, copyText, esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { getMetaValue, setMetaValue } from '../../xhs/db.js';
import { MAX_KEYWORDS, MAX_KEYWORD_LEN, cleanCovers, collectorStatus, followJob, launchCollector, parseKeywords, startCollect, waitForCollector } from '../../xhs/collector-client.js';
import { HOT_RATIO, MIN_NOTES, analyzeEvidence, buildBrief, noteLink, parseEvidence } from '../../xhs/search-evidence.js';
import { xhsPage } from './shell.js';

/*
 * 검색 근거 추천: import the collector's file, see which notes took off and what they share,
 * copy a brief for Claude, check the answer, keep the chosen title and tags on a post.
 * Evidence files stay on this device ("local:" meta keys are never synced).
 */

const KEY = 'local:searchEvidence';
const KEEP = 5;
const draft = { sel: 0, keywords: '' };
// The collection started with 검색하기. Kept outside the view so it survives re-renders.
const run = { busy: false, key: '', vars: {}, tone: '', log: [] };
// Covers of the set just collected. Memory only: never saved, gone after a reload.
let liveCovers = { id: null, map: {} };
const TOP_COVERS = 10;

const n0 = (v) => (v == null ? `<span class="text-muted">${esc(t('se.notCollected'))}</span>` : esc(Number(v).toLocaleString()));
const pctTxt = (v) => (v == null ? t('se.notCollected') : `${Math.round(v * 100)}%`);

async function loadSets() {
  const list = (await getMetaValue(KEY)) ?? [];
  return Array.isArray(list) ? list : [];
}

/** Keeps a collector file on this device (newest first, same file once). Throws for anything else. */
async function storeSet(data) {
  const parsed = parseEvidence(data);
  const rest = (await loadSets()).filter((s) => parseEvidence(s).id !== parsed.id);
  await setMetaValue(KEY, [data, ...rest].slice(0, KEEP));
  draft.sel = 0;
  return parsed;
}

function runStateHtml() {
  if (!run.key) return '';
  const tone = run.tone === 'bad' ? 'cf-bad' : run.tone === 'good' ? 'cf-good' : 'cf-mid';
  const log = run.log.length
    ? `<details class="mt-2 text-[12px] text-muted"><summary class="cursor-pointer">${esc(t('se.run.log'))}</summary><pre class="mt-1 whitespace-pre-wrap">${esc(run.log.join('\n'))}</pre></details>`
    : '';
  return `<p class="mt-3 rounded-lg ${tone} p-2.5 text-[13px]" role="status">${esc(t(run.key, run.vars))}</p>${log}`;
}

function setRun(key, vars = {}, tone = '') {
  Object.assign(run, { key, vars, tone });
  const box = document.getElementById('se-run-state');
  if (box) box.innerHTML = runStateHtml();
  const go = document.getElementById('se-run-go');
  if (go) go.disabled = run.busy;
}

const PHASE_KEY = { starting: 'se.run.starting', login: 'se.run.login', keyword: 'se.run.keyword', saving: 'se.run.saving' };

function showJob(job) {
  run.log = (job.log ?? []).slice(-12);
  if (job.state === 'running') setRun(PHASE_KEY[job.phase] ?? 'se.run.starting', { i: (job.index ?? 0) + 1, n: job.total ?? 0, kw: job.keyword ?? '' });
}

async function runCollect() {
  if (run.busy) return;
  const { keywords, error } = parseKeywords(draft.keywords);
  if (error) return toast(t(`se.run.${error}`, { max: MAX_KEYWORDS, len: MAX_KEYWORD_LEN }), { tone: 'error' });
  run.busy = true;
  run.log = [];
  try {
    setRun('se.run.checking');
    let status = await collectorStatus();
    if (!status) {
      setRun('se.run.launching');
      launchCollector();
      status = await waitForCollector();
    }
    if (!status) return setRun('se.run.off', {}, 'bad');
    const start = await startCollect(keywords);
    if (start.status !== 202 && start.status !== 409) return setRun('se.run.refused', {}, 'bad');
    if (start.status === 409) setRun('se.run.attached');
    const job = await followJob(showJob);
    if (!job) return setRun('se.run.lost', {}, 'bad');
    if (job.state !== 'done' || !job.result) return setRun(`se.run.fail.${job.reason ?? 'error'}`, {}, 'bad');
    const parsed = await storeSet(job.result);
    liveCovers = { id: parsed.id, map: cleanCovers(job.covers) };
    setRun('se.run.done', { k: parsed.keywords.length, n: parsed.notes.length }, 'good');
    if (location.hash.startsWith('#/search')) navigate('/search');
  } catch {
    setRun('se.run.fail.error', {}, 'bad');
  } finally {
    run.busy = false;
    setRun(run.key, run.vars, run.tone);
  }
}

function coverImg(url, title, cls) {
  return url ? `<img src="${esc(url)}" alt="${esc(title || t('se.noTitle'))}" loading="lazy" class="${cls} rounded-md border border-line object-cover bg-[var(--color-line)]" />` : '';
}

function topCovers(k, ev, covers) {
  const notes = ev.notes
    .filter((n) => n.keyword === k.keyword && covers[n.id])
    .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1))
    .slice(0, TOP_COVERS);
  if (!notes.length) return '';
  return `<h4 class="mt-3 text-[14px] font-semibold">${esc(t('se.topCovers'))}</h4>
    <div class="mt-2 flex gap-2 overflow-x-auto pb-1">${notes
      .map(
        (n) => `<a class="w-24 shrink-0 text-[12px]" href="${esc(noteLink(n))}" target="_blank" rel="noopener noreferrer">
          ${coverImg(covers[n.id], n.title, 'h-32 w-24')}
          <span class="mt-1 block truncate">${esc(n.title || t('se.noTitle'))}</span>
          <span class="block text-muted tabular-nums">${esc(t('se.likes'))} ${n0(n.likes)}</span></a>`,
      )
      .join('')}</div>`;
}

function keywordCard(k, ev, covers) {
  const status = k.status === 'ok' ? '' : `<p class="notice mt-2 text-[13px]">${icon('info', 'size-4 mt-0.5')}<span>${esc(t(`se.status.${k.status}`))}</span></p>`;
  const few = k.median == null && k.status === 'ok' ? `<p class="mt-2 text-[13px] text-muted">${esc(t('se.few', { n: k.scored, min: MIN_NOTES }))}</p>` : '';
  const hot = k.hot.length
    ? `<ol class="mt-2 flex flex-col gap-2">${k.hot
        .map(
          (n) => `<li class="flex gap-2.5 rounded-lg border border-line p-2.5 text-[14px]">${covers?.[n.id] ? coverImg(covers[n.id], n.title, 'h-20 w-16 shrink-0') : ''}<div class="min-w-0">
            <a class="font-semibold underline-offset-2 hover:underline" href="${esc(noteLink(n))}" target="_blank" rel="noopener noreferrer">${esc(n.title || t('se.noTitle'))}</a>
            <p class="mt-1 text-[13px] text-muted tabular-nums">${esc(t('se.likes'))} ${n0(n.likes)}${n.approx.includes('likes') ? esc(t('se.approx')) : ''} · <b>${esc(t('se.times', { x: n.ratio.toFixed(1) }))}</b> · ${esc(t('se.collects'))} ${n0(n.collects)} · ${esc(t('se.comments'))} ${n0(n.comments)}</p>
            ${n.tags?.length ? `<p class="mt-1 text-[12px] text-muted">${n.tags.map((x) => `#${esc(x)}`).join(' ')}</p>` : ''}
          </div></li>`,
        )
        .join('')}</ol>`
    : k.median != null
      ? `<p class="mt-2 text-[13px] text-muted">${esc(t('se.noHot', { r: HOT_RATIO }))}</p>`
      : '';
  const p = k.patterns;
  const patterns = p
    ? `<div class="table-scroll mt-3"><table class="xtable"><thead><tr><th></th><th class="num">${esc(t('se.hotCol', { n: p.hot.n }))}</th><th class="num">${esc(t('se.restCol', { n: p.rest.n }))}</th></tr></thead><tbody>
        <tr><td>${esc(t('se.len'))}</td><td class="num">${esc(String(p.hot.length ?? '-'))}</td><td class="num">${esc(String(p.rest.length ?? '-'))}</td></tr>
        <tr><td>${esc(t('se.digits'))}</td><td class="num">${esc(pctTxt(p.hot.digits))}</td><td class="num">${esc(pctTxt(p.rest.digits))}</td></tr>
        <tr><td>${esc(t('se.emoji'))}</td><td class="num">${esc(pctTxt(p.hot.emoji))}</td><td class="num">${esc(pctTxt(p.rest.emoji))}</td></tr>
        <tr><td>${esc(t('se.question'))}</td><td class="num">${esc(pctTxt(p.hot.question))}</td><td class="num">${esc(pctTxt(p.rest.question))}</td></tr>
      </tbody></table></div><p class="mt-1 text-[12px] text-muted">${esc(t('se.patternNote'))}</p>`
    : '';
  const terms = k.terms.length ? `<p class="mt-2 text-[13px]"><b>${esc(t('se.terms'))}</b> ${k.terms.map((x) => `<span class="pill pill-muted">${esc(x.term)} ${x.count}</span>`).join(' ')}</p>` : '';
  return `<section class="card mt-3">
    <h3 class="text-[16px] font-semibold">${icon('search', 'size-4 inline -mt-0.5')} ${esc(k.keyword)}</h3>
    <p class="mt-1 text-[13px] text-muted tabular-nums">${esc(t('se.kwSummary', { n: k.count, unscored: k.unscored }))} · ${esc(t('se.medianLikes'))} ${n0(k.median)}</p>
    ${status}${few}
    ${k.hot.length ? `<h4 class="mt-3 text-[14px] font-semibold">${esc(t('se.hotTitle', { r: HOT_RATIO }))}</h4>` : ''}${hot}${covers ? topCovers(k, ev, covers) : ''}${patterns}${terms}
  </section>`;
}

function evidenceView(ev, an, covers) {
  const tags = an.tags.length
    ? `<div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('se.tag'))}</th><th class="num">${esc(t('se.tagNotes'))}</th><th class="num">${esc(t('se.medianLikes'))}</th></tr></thead><tbody>${an.tags
        .map((x) => `<tr><td>#${esc(x.tag)}</td><td class="num">${x.count}</td><td class="num">${n0(x.medianLikes)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : `<p class="mt-2 text-[13px] text-muted">${esc(t('se.noTags'))}</p>`;
  const related = an.related.length ? an.related.map((x) => `<span class="pill pill-muted">${esc(x)}</span>`).join(' ') : `<span class="text-muted">${esc(t(an.relatedCollected ? 'se.none' : 'se.notCollected'))}</span>`;
  return `
    ${covers ? `<p class="mt-3 text-[12px] text-muted">${esc(t('se.coverNote'))}</p>` : ''}
    ${an.keywords.map((k) => keywordCard(k, ev, covers)).join('')}
    <section class="card mt-3"><h3 class="text-[16px] font-semibold">${esc(t('se.tagsTitle'))}</h3>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.tagsSub', { n: an.tagNotes }))}</p>${tags}</section>
    <section class="card mt-3"><h3 class="text-[16px] font-semibold">${esc(t('se.related'))}</h3><p class="mt-2 flex flex-wrap gap-1.5 text-[13px]">${related}</p></section>`;
}

export async function renderSearch({ isCurrent }) {
  const sets = await loadSets();
  if (!isCurrent()) return null;
  if (draft.sel >= sets.length) draft.sel = 0;
  const raw = sets[draft.sel];
  const ev = raw ? parseEvidence(raw) : null;
  const an = ev ? analyzeEvidence(ev) : null;
  const covers = ev && liveCovers.id === ev.id && Object.keys(liveCovers.map).length ? liveCovers.map : null;

  const picker = sets.length
    ? `<label class="field mt-3"><span class="field-label">${esc(t('se.pickSet'))}</span><select class="input" id="se-set">${sets
        .map((s, i) => `<option value="${i}" ${i === draft.sel ? 'selected' : ''}>${esc(`${(s.collectedAt || '').slice(0, 16).replace('T', ' ')} · ${(s.keywords || []).map((k) => k.keyword).join(', ')}`)}</option>`)
        .join('')}</select></label>
       <button type="button" class="btn btn-ghost text-danger mt-1" data-x="remove">${icon('trash', 'size-4')}${esc(t('se.removeSet'))}</button>`
    : '';

  const body = `
    <section class="card"><h2 class="text-[16px] font-semibold">${esc(t('se.run.title'))}</h2>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.run.hint', { max: MAX_KEYWORDS }))}</p>
      <textarea class="textarea mt-3" rows="2" id="se-keywords" placeholder="${esc(t('se.run.ph'))}">${esc(draft.keywords)}</textarea>
      <button type="button" class="btn btn-primary mt-2" id="se-run-go" data-x="run" ${run.busy ? 'disabled' : ''}>${icon('search', 'size-5')}${esc(t('se.run.go'))}</button>
      <div id="se-run-state">${runStateHtml()}</div>
      <p class="mt-2 text-[12px] text-muted">${esc(t('se.run.setup'))}</p>
    </section>
    <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('se.step1'))}</h2>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.step1Hint'))}</p>
      <label class="btn btn-primary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('se.import'))}<input type="file" id="se-file" accept="application/json,.json" class="sr-only" /></label>
      ${picker}
    </section>
    ${ev ? `<h2 class="mt-5 text-[17px] font-semibold">${esc(t('se.step2'))}</h2><p class="mt-1 text-[13px] text-muted">${esc(t('se.step2Hint', { r: HOT_RATIO }))}</p>${evidenceView(ev, an, covers)}
    <button type="button" class="btn btn-primary mt-5" data-x="copy">${icon('copy', 'size-5')}${esc(t('se.copy'))}</button>` : ''}`;

  const root = xhsPage({ nav: 'more', back: '#/more', title: t('se.title'), sub: t('se.sub'), body });

  root.addEventListener('input', (e) => {
    if (e.target.id === 'se-keywords') draft.keywords = e.target.value;
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id === 'se-set') {
      draft.sel = Number(e.target.value) || 0;
      return navigate('/search');
    }
    if (e.target.id === 'se-file' && e.target.files?.[0]) {
      try {
        const parsed = await storeSet(JSON.parse(await e.target.files[0].text()));
        toast(t('se.imported', { n: parsed.notes.length, k: parsed.keywords.length }));
        return navigate('/search');
      } catch {
        toast(t('se.badFile'), { tone: 'error' });
      }
    }
  });
  root.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    if (x === 'run') return runCollect();
    if (x === 'remove' && raw) {
      if (!(await confirmDialog({ title: t('se.removeSet'), message: t('se.removeHint'), danger: true }))) return;
      await setMetaValue(KEY, sets.filter((_, i) => i !== draft.sel));
      draft.sel = 0;
      return navigate('/search');
    }
    if (x === 'copy' && ev) {
      const ok = await copyText(buildBrief(ev, an));
      toast(t(ok ? 'se.copied' : 'se.copyFail'));
    }
  });
  return { kind: 'search' };
}
