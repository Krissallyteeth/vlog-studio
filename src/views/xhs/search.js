import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, confirmDialog, copyText, esc, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { getMetaValue, setMetaValue } from '../../xhs/db.js';
import { HOT_RATIO, MIN_NOTES, analyzeEvidence, buildBrief, checkAnswer, parseEvidence, tagKey } from '../../xhs/search-evidence.js';
import { listPosts, savePosts } from '../../xhs/store.js';
import { xhsPage } from './shell.js';

/*
 * 검색 근거 추천: import the collector's file, see which notes took off and what they share,
 * copy a brief for Claude, check the answer, keep the chosen title and tags on a post.
 * Evidence files stay on this device ("local:" meta keys are never synced).
 */

const KEY = 'local:searchEvidence';
const KEEP = 5;
const draft = { sel: 0, topic: '', hook: '', answer: '', check: null };

const n0 = (v) => (v == null ? `<span class="text-muted">${esc(t('se.notCollected'))}</span>` : esc(Number(v).toLocaleString()));
const pctTxt = (v) => (v == null ? t('se.notCollected') : `${Math.round(v * 100)}%`);

async function loadSets() {
  const list = (await getMetaValue(KEY)) ?? [];
  return Array.isArray(list) ? list : [];
}

function keywordCard(k, ev) {
  const status = k.status === 'ok' ? '' : `<p class="notice mt-2 text-[13px]">${icon('info', 'size-4 mt-0.5')}<span>${esc(t(`se.status.${k.status}`))}</span></p>`;
  const few = k.median == null && k.status === 'ok' ? `<p class="mt-2 text-[13px] text-muted">${esc(t('se.few', { n: k.scored, min: MIN_NOTES }))}</p>` : '';
  const hot = k.hot.length
    ? `<ol class="mt-2 flex flex-col gap-2">${k.hot
        .map(
          (n) => `<li class="rounded-lg border border-line p-2.5 text-[14px]">
            <a class="font-semibold underline-offset-2 hover:underline" href="${esc(`https://www.xiaohongshu.com/explore/${n.id}`)}" target="_blank" rel="noopener noreferrer">${esc(n.title || t('se.noTitle'))}</a>
            <p class="mt-1 text-[13px] text-muted tabular-nums">${esc(t('se.likes'))} ${n0(n.likes)}${n.approx.includes('likes') ? esc(t('se.approx')) : ''} · <b>${esc(t('se.times', { x: n.ratio.toFixed(1) }))}</b> · ${esc(t('se.collects'))} ${n0(n.collects)} · ${esc(t('se.comments'))} ${n0(n.comments)}</p>
            ${n.tags?.length ? `<p class="mt-1 text-[12px] text-muted">${n.tags.map((x) => `#${esc(x)}`).join(' ')}</p>` : ''}
          </li>`,
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
    ${k.hot.length ? `<h4 class="mt-3 text-[14px] font-semibold">${esc(t('se.hotTitle', { r: HOT_RATIO }))}</h4>` : ''}${hot}${patterns}${terms}
  </section>`;
}

function evidenceView(ev, an) {
  const tags = an.tags.length
    ? `<div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('se.tag'))}</th><th class="num">${esc(t('se.tagNotes'))}</th><th class="num">${esc(t('se.medianLikes'))}</th></tr></thead><tbody>${an.tags
        .map((x) => `<tr><td>#${esc(x.tag)}</td><td class="num">${x.count}</td><td class="num">${n0(x.medianLikes)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : `<p class="mt-2 text-[13px] text-muted">${esc(t('se.noTags'))}</p>`;
  const related = an.related.length ? an.related.map((x) => `<span class="pill pill-muted">${esc(x)}</span>`).join(' ') : `<span class="text-muted">${esc(t(an.relatedCollected ? 'se.none' : 'se.notCollected'))}</span>`;
  return `
    ${an.keywords.map((k) => keywordCard(k, ev)).join('')}
    <section class="card mt-3"><h3 class="text-[16px] font-semibold">${esc(t('se.tagsTitle'))}</h3>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.tagsSub', { n: an.tagNotes }))}</p>${tags}</section>
    <section class="card mt-3"><h3 class="text-[16px] font-semibold">${esc(t('se.related'))}</h3><p class="mt-2 flex flex-wrap gap-1.5 text-[13px]">${related}</p></section>`;
}

function checkView(res) {
  if (!res) return '';
  const tagRow = res.tags.length
    ? res.tags.map((x) => `<span class="pill ${x.known === false ? 'cf-bad' : x.known ? 'cf-good' : 'pill-muted'}">#${esc(x.tag)}${x.known === false ? ` · ${esc(t('se.tagUnknown'))}` : ''}</span>`).join(' ')
    : `<span class="text-muted">${esc(t('se.noAnswerTags'))}</span>`;
  const similar = res.similar.length
    ? `<ul class="mt-2 flex flex-col gap-1.5 text-[13px]">${res.similar.map((s) => `<li class="rounded-lg cf-mid p-2"><b>${esc(s.line)}</b><br />${esc(t('se.similarTo', { title: s.title || t('se.noTitle'), part: t(s.part === 'title' ? 'se.partTitle' : 'se.partDesc') }))}</li>`).join('')}</ul>`
    : `<p class="mt-2 text-[13px] text-muted">${esc(t('se.noSimilar'))}</p>`;
  return `<div class="mt-3"><h4 class="text-[14px] font-semibold">${esc(t('se.checkTags'))}</h4>
      ${res.tagsCollected ? '' : `<p class="text-[12px] text-muted">${esc(t('se.tagsNotCollected'))}</p>`}
      <p class="mt-1 flex flex-wrap gap-1.5 text-[13px]">${tagRow}</p>
      <h4 class="mt-3 text-[14px] font-semibold">${esc(t('se.checkSimilar'))}</h4>${similar}</div>`;
}

export async function renderSearch({ isCurrent }) {
  const [sets, posts] = await Promise.all([loadSets(), listPosts()]);
  if (!isCurrent()) return null;
  if (draft.sel >= sets.length) draft.sel = 0;
  const raw = sets[draft.sel];
  const ev = raw ? parseEvidence(raw) : null;
  const an = ev ? analyzeEvidence(ev) : null;
  const recent = [...posts].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt).slice(0, 40);

  const picker = sets.length
    ? `<label class="field mt-3"><span class="field-label">${esc(t('se.pickSet'))}</span><select class="input" id="se-set">${sets
        .map((s, i) => `<option value="${i}" ${i === draft.sel ? 'selected' : ''}>${esc(`${(s.collectedAt || '').slice(0, 16).replace('T', ' ')} · ${(s.keywords || []).map((k) => k.keyword).join(', ')}`)}</option>`)
        .join('')}</select></label>
       <button type="button" class="btn btn-ghost text-danger mt-1" data-x="remove">${icon('trash', 'size-4')}${esc(t('se.removeSet'))}</button>`
    : '';

  const body = `
    <section class="notice notice-strong">${icon('info', 'size-5 mt-0.5')}<div class="text-[14px] leading-relaxed"><b>${esc(t('se.howTitle'))}</b>
      <ol class="mt-1 list-decimal pl-5 text-muted"><li>${esc(t('se.how1'))}</li><li>${esc(t('se.how2'))}</li><li>${esc(t('se.how3'))}</li><li>${esc(t('se.how4'))}</li></ol>
      <p class="mt-1 text-[12px] text-muted">${esc(t('se.privacy'))}</p></div></section>
    <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('se.step1'))}</h2>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.step1Hint'))}</p>
      <label class="btn btn-primary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('se.import'))}<input type="file" id="se-file" accept="application/json,.json" class="sr-only" /></label>
      ${picker}
    </section>
    ${ev ? `<h2 class="mt-5 text-[17px] font-semibold">${esc(t('se.step2'))}</h2><p class="mt-1 text-[13px] text-muted">${esc(t('se.step2Hint', { r: HOT_RATIO }))}</p>${evidenceView(ev, an)}
    <section class="card mt-5"><h2 class="text-[16px] font-semibold">${esc(t('se.step3'))}</h2>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.step3Hint'))}</p>
      <label class="field mt-3"><span class="field-label">${esc(t('se.topic'))}</span><textarea class="textarea" rows="2" id="se-topic" placeholder="${esc(t('se.topicPh'))}">${esc(draft.topic)}</textarea></label>
      <label class="field mt-2"><span class="field-label">${esc(t('se.hook'))}</span><textarea class="textarea" rows="2" id="se-hook" placeholder="${esc(t('se.hookPh'))}">${esc(draft.hook)}</textarea></label>
      <button type="button" class="btn btn-primary mt-3" data-x="copy">${icon('copy', 'size-5')}${esc(t('se.copy'))}</button>
    </section>
    <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('se.step4'))}</h2>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.step4Hint'))}</p>
      <textarea class="textarea mt-3" rows="8" id="se-answer" placeholder="${esc(t('se.answerPh'))}">${esc(draft.answer)}</textarea>
      <button type="button" class="btn btn-secondary mt-2" data-x="check">${icon('check', 'size-5')}${esc(t('se.check'))}</button>
      <div id="se-check">${checkView(draft.check)}</div>
    </section>
    <section class="card mt-3"><h2 class="text-[16px] font-semibold">${esc(t('se.step5'))}</h2>
      <p class="mt-1 text-[13px] text-muted">${esc(t('se.step5Hint'))}</p>
      <label class="field mt-3"><span class="field-label">${esc(t('se.post'))}</span><select class="input" id="se-post"><option value="">${esc(t('se.postPick'))}</option>${recent
        .map((p) => `<option value="${esc(p.id)}">${esc(`${p.date || '----'} · ${p.title || t('se.noTitle')}`)}${p.searchPick ? ' ✓' : ''}</option>`)
        .join('')}</select></label>
      <label class="field mt-2"><span class="field-label">${esc(t('se.pickTitle'))}</span><input class="input" id="se-title" /></label>
      <label class="field mt-2"><span class="field-label">${esc(t('se.pickTags'))}</span><input class="input" id="se-tags" placeholder="#收纳技巧 #小户型" /></label>
      <button type="button" class="btn btn-primary mt-3" data-x="save">${icon('check', 'size-5')}${esc(t('se.save'))}</button>
    </section>` : ''}`;

  const root = xhsPage({ nav: 'more', back: '#/more', title: t('se.title'), sub: t('se.sub'), body });

  const fillTags = () => {
    if (draft.check && !$('#se-tags', root).value.trim()) $('#se-tags', root).value = draft.check.tags.filter((x) => x.known !== false).map((x) => `#${x.tag}`).join(' ');
  };
  fillTags();

  root.addEventListener('input', (e) => {
    if (e.target.id === 'se-topic') draft.topic = e.target.value;
    if (e.target.id === 'se-hook') draft.hook = e.target.value;
    if (e.target.id === 'se-answer') draft.answer = e.target.value;
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id === 'se-set') {
      draft.sel = Number(e.target.value) || 0;
      draft.check = null;
      return navigate('/search');
    }
    if (e.target.id === 'se-file' && e.target.files?.[0]) {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        const parsed = parseEvidence(data);
        const rest = sets.filter((s) => parseEvidence(s).id !== parsed.id);
        await setMetaValue(KEY, [data, ...rest].slice(0, KEEP));
        draft.sel = 0;
        draft.check = null;
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
    if (x === 'remove' && raw) {
      if (!(await confirmDialog({ title: t('se.removeSet'), message: t('se.removeHint'), danger: true }))) return;
      await setMetaValue(KEY, sets.filter((_, i) => i !== draft.sel));
      draft.sel = 0;
      draft.check = null;
      return navigate('/search');
    }
    if (x === 'copy' && ev) {
      const ok = await copyText(buildBrief(ev, an, { topic: draft.topic, hook: draft.hook }));
      toast(t(ok ? 'se.copied' : 'se.copyFail'));
    }
    if (x === 'check' && ev) {
      draft.check = checkAnswer(draft.answer, ev);
      $('#se-check', root).innerHTML = checkView(draft.check);
      fillTags();
    }
    if (x === 'save' && ev) {
      const post = posts.find((p) => p.id === $('#se-post', root).value);
      const title = $('#se-title', root).value.trim();
      const tags = [...new Set(($('#se-tags', root).value.match(/#?[^\s#]+/g) ?? []).map(tagKey).filter(Boolean))];
      if (!post) return toast(t('se.needPost'), { tone: 'error' });
      if (!title && !tags.length) return toast(t('se.needPick'), { tone: 'error' });
      const known = new Set(ev.notes.flatMap((n) => n.tags ?? []).map(tagKey));
      const unknownTags = ev.notes.some((n) => Array.isArray(n.tags)) ? tags.filter((tg) => !known.has(tg)) : [];
      await savePosts([{ ...post, searchPick: { title, tags, keywords: ev.keywords.map((k) => k.keyword), evidenceAt: ev.collectedAt, unknownTags, savedAt: Date.now() } }]);
      toast(t('se.saved'));
    }
  });
  return { kind: 'search' };
}
