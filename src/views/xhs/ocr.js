import { compressImage } from '../../data/media.js';
import { uid } from '../../lib/ids.js';
import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, confirmDialog, esc, openSheet, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { deleteOne, getAll, putMany } from '../../xhs/db.js';
import { fmt, parseInput, toEditText } from '../../xhs/format.js';
import { INPUT_METRICS, METRIC } from '../../xhs/metrics.js';
import { extractMetrics, mergeResults } from '../../xhs/ocr-parse.js';
import { ordered } from '../../xhs/stats.js';
import { listPosts, normalizePost, savePosts } from '../../xhs/store.js';
import { xhsPage } from './shell.js';

/*
 * Screenshot → numbers: upload → recognise → review against the image → edit → confirm → save.
 * Nothing is written until the user confirms. Uncertain numbers are never filled in.
 */

const KEEP_KEY = 'xhs-ocr-keep';
const SHOT_MAX_SIDE = 1600; // enough to read the numbers again later
const SHOT_QUALITY = 0.8;

export async function renderOcr([postId], { isCurrent }) {
  const [posts, shots] = await Promise.all([listPosts(), getAll('shots')]);
  if (!isCurrent()) return null;
  const list = ordered(posts).reverse();
  let keep = (() => {
    try {
      return localStorage.getItem(KEEP_KEY) !== '0';
    } catch {
      return true;
    }
  })();
  const state = { postId: postId && posts.some((p) => p.id === postId) ? postId : list[0]?.id ?? 'new', stage: 'd1', images: [], merged: null, choice: {} };
  const post = () => posts.find((p) => p.id === state.postId) ?? null;
  // Default stage: D+2 once D+1 is filled in.
  if (post() && Object.values(post().d1).some((v) => v != null)) state.stage = 'd2';
  const usedBytes = shots.reduce((s, x) => s + (x.blob?.size ?? 0), 0);

  const root = xhsPage({
    nav: 'more',
    wide: true,
    back: postId ? `#/c/${encodeURIComponent(postId)}` : '#/more',
    title: t('ocr.title'),
    sub: t('ocr.sub'),
    body: `
      <section class="card">
        <div class="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label class="field"><span class="field-label">${esc(t('ocr.post'))}</span>
            <select class="input" id="ocr-post"><option value="new" ${state.postId === 'new' ? 'selected' : ''}>${esc(t('ocr.newPost'))}</option>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === state.postId ? 'selected' : ''}>${esc(`${p.date} · ${p.title}`)}</option>`).join('')}</select></label>
          <div class="field"><span class="field-label">${esc(t('ocr.stage'))}</span>
            <div class="segmented segmented-2" role="radiogroup"><button type="button" class="seg" data-stage="d1">D+1</button><button type="button" class="seg" data-stage="d2">D+2</button></div></div>
        </div>
        <div id="ocr-new" class="mt-3 hidden grid gap-3 sm:grid-cols-3">
          <label class="field"><span class="field-label">배포내용</span><input class="input" id="ocr-new-title" /></label>
          <label class="field"><span class="field-label">배포일자</span><input class="input" type="date" id="ocr-new-date" /></label>
          <label class="field"><span class="field-label">배포시간</span><input class="input" type="time" id="ocr-new-time" value="19:20" /></label>
        </div>
        <div class="drop-target mt-3 rounded-[14px] border-2 border-dashed border-line p-4 text-center" id="ocr-drop">
          <div class="drop-overlay" aria-hidden="true">${icon('upload', 'size-6')}<span>${esc(t('ocr.dropHere'))}</span></div>
          <p class="text-[14px]">${esc(t('ocr.pickHint'))}</p>
          <label class="btn btn-primary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('ocr.pick'))}<input type="file" id="ocr-files" accept="image/*" multiple class="sr-only" /></label>
        </div>
        <div id="ocr-thumbs" class="mt-3 flex flex-wrap gap-2"></div>
        <label class="mt-3 flex items-start gap-2 text-[13px]"><input type="checkbox" id="ocr-keep" ${keep ? 'checked' : ''} class="mt-0.5" /><span>${esc(t('ocr.keep'))}<span class="block text-muted">${esc(t('ocr.keepPolicy', { n: shots.length, mb: (usedBytes / 1048576).toFixed(1) }))}</span></span></label>
        <button type="button" class="btn btn-primary mt-3 w-full sm:w-auto" id="ocr-run" disabled>${icon('scan', 'size-5')}${esc(t('ocr.run'))}</button>
        <p class="mt-2 text-[12px] text-muted">${esc(t('ocr.privacy'))}</p>
      </section>
      <div id="ocr-result" class="mt-4"></div>
      ${savedShotsHtml(shots, posts, postId)}`,
  });

  const thumbs = $('#ocr-thumbs', root);
  const result = $('#ocr-result', root);
  const drawStage = () => root.querySelectorAll('[data-stage]').forEach((b) => b.classList.toggle('is-active', b.dataset.stage === state.stage));
  const drawNew = () => $('#ocr-new', root).classList.toggle('hidden', state.postId !== 'new');
  drawStage();
  drawNew();

  function drawThumbs() {
    thumbs.innerHTML = state.images
      .map((im, i) => `<figure class="ocr-thumb"><button type="button" data-view-img="${i}"><img src="${im.url}" alt="" /></button>
        <figcaption>${esc(im.status === 'done' ? t('ocr.found', { n: Object.keys(im.result.values).length }) : im.status === 'error' ? t('ocr.error') : im.status === 'run' ? `${Math.round((im.progress ?? 0) * 100)}%` : t('ocr.ready'))}</figcaption>
        <button type="button" class="ocr-x" data-rm-img="${i}" aria-label="${esc(t('common.delete'))}">${icon('x', 'size-4')}</button></figure>`)
      .join('');
    $('#ocr-run', root).disabled = !state.images.length || state.images.some((im) => im.status === 'run');
  }

  function addFiles(files) {
    for (const f of [...files].filter((x) => x.type.startsWith('image/'))) state.images.push({ file: f, url: URL.createObjectURL(f), status: 'ready' });
    drawThumbs();
  }

  async function run() {
    const { recognize } = await import('../../xhs/ocr-engine.js');
    result.innerHTML = `<p class="card text-[14px]">${esc(t('ocr.loading'))}</p>`;
    for (const im of state.images) {
      if (im.status === 'done') continue;
      im.status = 'run';
      im.progress = 0;
      drawThumbs();
      try {
        const out = await recognize(im.file, (m) => {
          if (m.status === 'recognizing text') {
            im.progress = m.progress;
            const cap = thumbs.querySelectorAll('figcaption')[state.images.indexOf(im)];
            if (cap) cap.textContent = `${Math.round(m.progress * 100)}%`;
          } else if (/load/.test(m.status)) result.innerHTML = `<p class="card text-[14px]">${esc(t('ocr.loading'))} (${esc(m.status)} ${Math.round((m.progress ?? 0) * 100)}%)</p>`;
        });
        im.text = out.text;
        im.result = extractMetrics(out.lines);
        im.status = 'done';
      } catch (err) {
        console.error(err);
        im.status = 'error';
        im.error = err?.message ?? String(err);
      }
      drawThumbs();
    }
    state.merged = mergeResults(state.images.filter((im) => im.status === 'done').map((im) => im.result));
    state.choice = {};
    for (const [key, m] of Object.entries(state.merged)) if (m.status === 'ok') state.choice[key] = m.value;
    drawResult();
  }

  function drawResult() {
    const p = post();
    const existing = p ? p[state.stage] : {};
    const errors = state.images.filter((im) => im.status === 'error');
    const rows = INPUT_METRICS.filter((m) => !(state.stage === 'd2' && m.computedD2)).map((m) => {
      const r = state.merged?.[m.key];
      const chosen = state.choice[m.key];
      const old = existing?.[m.key] ?? null;
      const status = !r ? 'missing' : r.status === 'conflict' && chosen === undefined ? 'conflict' : r.status === 'check' && chosen === undefined ? 'check' : 'ok';
      const options = r?.options ?? r?.from ?? [];
      const diff = chosen != null && old != null && Math.abs(chosen - old) > 1e-9;
      return `<tr class="${status === 'check' || status === 'conflict' ? 'cf-mid' : status === 'missing' ? '' : diff ? 'cf-bad' : ''}">
        <td><b>${esc(m.zh)}</b> <span class="text-[12px] text-muted">${esc(t(`m.${m.key}`))}</span></td>
        <td>${options.map((o) => `<button type="button" class="ocr-cand ${chosen === (o.value ?? o.candidate) ? 'is-on' : ''}" data-cand="${m.key}" data-v="${o.value ?? o.candidate}" title="${esc(t('ocr.fromImage', { n: o.image + 1, conf: Math.round(o.conf ?? 0) }))}">${esc(o.text)} <span class="text-[10px] text-muted">#${o.image + 1}${o.reason ? ` · ${esc(t(`ocr.why.${o.reason}`))}` : ''}</span></button>`).join(' ') || '<span class="text-muted">–</span>'}</td>
        <td><input class="input !h-9 !w-28 text-right tabular-nums" data-val="${m.key}" value="${esc(chosen == null ? '' : toEditText(m.key, chosen))}" placeholder="${status === 'missing' ? '' : esc(t('ocr.needCheck'))}" />${m.kind === 'pct' ? ' %' : ''}</td>
        <td class="num">${esc(fmt(m.key, old))}</td>
        <td>${esc(t(`ocr.st.${status === 'ok' && diff ? 'diff' : status}`))}</td></tr>`;
    });
    result.innerHTML = `
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section class="card">
          <h2 class="text-[16px] font-semibold">${esc(t('ocr.results', { stage: state.stage === 'd1' ? 'D+1' : 'D+2' }))}</h2>
          <p class="mt-1 text-[12px] text-muted">${esc(t('ocr.legend'))}</p>
          ${errors.length ? `<p class="form-error mt-2">${esc(t('ocr.failed', { n: errors.length, msg: errors[0].error }))}</p>` : ''}
          <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('crit.metric'))}</th><th>${esc(t('ocr.recognised'))}</th><th>${esc(t('ocr.toSave'))}</th><th class="num">${esc(t('ocr.inApp'))}</th><th>${esc(t('imp.th.status'))}</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
          <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="btn btn-primary" id="ocr-save">${esc(t('ocr.save'))}</button><button type="button" class="btn btn-secondary" id="ocr-text">${esc(t('ocr.showText'))}</button></div>
        </section>
        <aside class="card xl:sticky xl:top-4 self-start"><h3 class="text-[14px] font-semibold">${esc(t('ocr.original'))}</h3>
          <div class="mt-2 flex max-h-[75vh] flex-col gap-2 overflow-y-auto">${state.images.map((im, i) => `<figure><img src="${im.url}" alt="" class="w-full rounded-[10px] border border-line" /><figcaption class="text-[11px] text-muted">#${i + 1} ${esc(im.file.name)}</figcaption></figure>`).join('')}</div></aside>
      </div>`;
  }

  async function save() {
    // Read the edit boxes: they are the final values.
    const values = {};
    let bad = 0;
    result.querySelectorAll('[data-val]').forEach((inp) => {
      const v = parseInput(inp.dataset.val, inp.value);
      if (v === undefined) bad++;
      else if (v !== null) values[inp.dataset.val] = v;
    });
    if (bad) return toast(t('ocr.badInput', { n: bad }), { tone: 'error' });
    const pending = Object.keys(state.merged ?? {}).filter((k) => !(k in values) && ['check', 'conflict'].includes(state.merged[k].status));
    let target = post();
    if (state.postId === 'new') {
      const title = $('#ocr-new-title', root).value.trim();
      if (!title) return toast(t('ocr.needTitle'), { tone: 'error' });
      target = normalizePost({ title, date: $('#ocr-new-date', root).value, time: $('#ocr-new-time', root).value, validity: '미확인', no: Math.max(0, ...posts.map((p) => p.no ?? 0)) + 1 });
    }
    const changes = Object.entries(values).map(([k, v]) => ({ k, before: target[state.stage][k], after: v })).filter((c) => c.before !== c.after);
    const ok = await openSheet({
      title: t('ocr.confirmTitle', { title: target.title, stage: state.stage === 'd1' ? 'D+1' : 'D+2' }),
      body: `<div class="table-scroll max-h-[50vh]"><table class="xtable"><thead><tr><th>${esc(t('crit.metric'))}</th><th class="num">${esc(t('grid.before'))}</th><th class="num">${esc(t('grid.after'))}</th></tr></thead><tbody>${changes.map((c) => `<tr><td>${esc(METRIC[c.k].zh)}</td><td class="num text-muted">${esc(fmt(c.k, c.before) || '∅')}</td><td class="num font-semibold">${esc(fmt(c.k, c.after))}</td></tr>`).join('') || `<tr><td colspan="3" class="text-muted">${esc(t('ocr.noChange'))}</td></tr>`}</tbody></table></div>
        ${pending.length ? `<p class="mt-2 text-[13px] cf-mid rounded-[8px] px-2 py-1">${esc(t('ocr.pendingLeft', { list: pending.map((k) => METRIC[k].zh).join(', ') }))}</p>` : ''}
        <p class="mt-2 text-[12px] text-muted">${esc(keep ? t('ocr.willKeep', { n: state.images.length }) : t('ocr.wontKeep'))}</p>
        <div class="mt-3 grid grid-cols-[1fr_2fr] gap-2"><button type="button" class="btn btn-secondary" data-v="">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-v="1">${esc(t('ocr.saveConfirm'))}</button></div>`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(b.dataset.v === '1');
        });
      },
    });
    if (!ok) return;
    const updated = { ...target, [state.stage]: { ...target[state.stage], ...values } };
    if (keep) {
      const records = [];
      for (const im of state.images) {
        const blob = await compressImage(im.file, { maxSide: SHOT_MAX_SIDE, quality: SHOT_QUALITY }).catch(() => null);
        if (!blob) continue;
        records.push({ id: uid(), postId: updated.id, stage: state.stage, name: im.file.name, blob, createdAt: Date.now(), text: im.text ?? '', extracted: im.result?.values ? Object.fromEntries(Object.entries(im.result.values).map(([k, v]) => [k, v.value ?? null])) : {} });
      }
      await putMany('shots', records);
      updated.screenshots = [...(updated.screenshots ?? []), ...records.map((r) => r.id)];
    }
    await savePosts([updated]);
    toast(t('ocr.saved', { n: changes.length }));
    navigate(`/c/${encodeURIComponent(updated.id)}`);
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'ocr-files') {
      addFiles(e.target.files);
      e.target.value = '';
    }
    if (e.target.id === 'ocr-post') {
      state.postId = e.target.value;
      drawNew();
      if (state.merged) drawResult();
    }
    if (e.target.id === 'ocr-keep') {
      keep = e.target.checked;
      try {
        localStorage.setItem(KEEP_KEY, keep ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
  });
  root.addEventListener('input', (e) => {
    const k = e.target.dataset?.val;
    if (!k) return;
    const v = parseInput(k, e.target.value);
    if (v === undefined) return;
    if (v === null) delete state.choice[k];
    else state.choice[k] = v;
  });
  root.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-stage]');
    if (st) {
      state.stage = st.dataset.stage;
      drawStage();
      if (state.merged) drawResult();
      return;
    }
    const cand = e.target.closest('[data-cand]');
    if (cand) {
      state.choice[cand.dataset.cand] = Number(cand.dataset.v);
      return drawResult();
    }
    const rm = e.target.closest('[data-rm-img]');
    if (rm) {
      state.images.splice(Number(rm.dataset.rmImg), 1);
      return drawThumbs();
    }
    const view = e.target.closest('[data-view-img]');
    if (view) return openSheet({ title: t('ocr.original'), body: `<img src="${state.images[Number(view.dataset.viewImg)].url}" class="photo-full" alt="" />` });
    if (e.target.closest('#ocr-run')) return run();
    if (e.target.closest('#ocr-save')) return save();
    if (e.target.closest('#ocr-text')) {
      return openSheet({ title: t('ocr.showText'), body: `<pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap text-[12px]">${esc(state.images.map((im, i) => `#${i + 1}\n${im.text ?? ''}`).join('\n\n'))}</pre>` });
    }
    const viewShot = e.target.closest('[data-shot]');
    if (viewShot) {
      const s = (await getAll('shots')).find((x) => x.id === viewShot.dataset.shot);
      if (s?.blob) openSheet({ title: s.name, body: `<img src="${URL.createObjectURL(s.blob)}" class="photo-full" alt="" />` });
      return;
    }
    const delShot = e.target.closest('[data-del-shot]');
    if (delShot) {
      if (!(await confirmDialog({ title: t('ocr.delShot'), message: t('ocr.delShotBody'), confirmText: t('common.delete'), danger: true }))) return;
      const id = delShot.dataset.delShot;
      await deleteOne('shots', id);
      const owner = posts.find((p) => p.screenshots.includes(id));
      if (owner) await savePosts([{ ...owner, screenshots: owner.screenshots.filter((x) => x !== id) }]);
      navigate(location.hash.slice(1), { replace: true });
    }
  });
  const drop = $('#ocr-drop', root);
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragging');
    addFiles(e.dataTransfer.files);
  });
  const onPaste = (e) => e.clipboardData?.files?.length && addFiles(e.clipboardData.files);
  window.addEventListener('paste', onPaste);
  return { kind: 'xhs-ocr', destroy: () => window.removeEventListener('paste', onPaste) };
}

function savedShotsHtml(shots, posts, postId) {
  const mine = postId ? shots.filter((s) => s.postId === postId) : shots;
  if (!mine.length) return '';
  const title = (id) => posts.find((p) => p.id === id)?.title ?? '?';
  return `<section class="card mt-4"><h2 class="text-[16px] font-semibold">${esc(t('ocr.saved.title'))}</h2>
    <ul class="mt-2 flex flex-col gap-1.5 text-[13px]">${mine
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => `<li class="flex items-center gap-2"><button type="button" class="link-btn" data-shot="${esc(s.id)}">${esc(s.name || s.id)}</button><span class="text-muted">${esc(title(s.postId))} · ${s.stage === 'd2' ? 'D+2' : 'D+1'} · ${((s.blob?.size ?? 0) / 1024).toFixed(0)}KB</span><button type="button" class="link-btn text-danger ml-auto" data-del-shot="${esc(s.id)}">${esc(t('common.delete'))}</button></li>`)
      .join('')}</ul></section>`;
}
