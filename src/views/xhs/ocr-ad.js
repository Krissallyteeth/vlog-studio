import { compressImage } from '../../data/media.js';
import { uid } from '../../lib/ids.js';
import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, esc, openSheet, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { putMany } from '../../xhs/db.js';
import { AD_FIELDS, AD_METRICS, parseAdOrder } from '../../xhs/ocr-ad-parse.js';
import { ordered } from '../../xhs/stats.js';
import { listPosts, normalizeAd, normalizeStage, savePosts, stageFromDates } from '../../xhs/store.js';
import { xhsPage } from './shell.js';

/*
 * 薯条 order screenshots → ad records. Several orders can be uploaded at once: screenshots are
 * split into orders (a new order starts at a screenshot showing the order header / publish time),
 * each order is matched to a post by publish time and title, and nothing is saved before review.
 */

const NUMERIC = new Set(['spend', 'budget', 'result', 'beatPct', ...AD_METRICS.map(([k]) => k)]);

/** Best matching post: same publish date (±1 day) first, then title overlap. */
export function matchPost(posts, publishedAt, title) {
  const day = (s) => (s ? Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 86400000 : null);
  const d = day(publishedAt);
  const chars = new Set(String(title ?? '').replace(/[\s|｜]/g, ''));
  let best = null;
  for (const p of posts) {
    const pd = day(p.date);
    const dateScore = d != null && pd != null ? Math.max(0, 2 - Math.abs(pd - d)) : 0; // 2 same day, 1 = ±1 day
    const overlap = [...new Set(p.title.replace(/\s/g, ''))].filter((c) => chars.has(c)).length;
    const score = dateScore * 10 + overlap;
    if (score > 0 && (!best || score > best.score)) best = { post: p, score, sameDay: dateScore === 2 };
  }
  return best;
}

export async function renderOcrAd([postId], { isCurrent }) {
  const posts = ordered(await listPosts()).reverse();
  if (!isCurrent()) return null;
  const state = { images: [], orders: [] };
  const root = xhsPage({
    nav: 'more',
    wide: true,
    back: '#/ads',
    title: t('oad.title'),
    sub: t('oad.sub'),
    body: `
      <div class="segmented segmented-2 mb-3"><a class="seg" href="#/ocr">${esc(t('oad.tabStats'))}</a><a class="seg is-active" href="#/ocr-ad">${esc(t('oad.tabAd'))}</a></div>
      <section class="card">
        <div class="drop-target rounded-[14px] border-2 border-dashed border-line p-4 text-center" id="oad-drop">
          <div class="drop-overlay" aria-hidden="true">${icon('upload', 'size-6')}<span>${esc(t('ocr.dropHere'))}</span></div>
          <p class="text-[14px]">${esc(t('oad.pickHint'))}</p>
          <label class="btn btn-primary mt-3 cursor-pointer">${icon('upload', 'size-5')}${esc(t('ocr.pick'))}<input type="file" id="oad-files" accept="image/*" multiple class="sr-only" /></label>
        </div>
        <div id="oad-thumbs" class="mt-3 flex flex-wrap gap-2"></div>
        <button type="button" class="btn btn-primary mt-3" id="oad-run" disabled>${icon('scan', 'size-5')}${esc(t('ocr.run'))}</button>
        <p class="mt-2 text-[12px] text-muted">${esc(t('oad.help'))}</p>
      </section>
      <div id="oad-result" class="mt-4 flex flex-col gap-4"></div>`,
  });
  const thumbs = $('#oad-thumbs', root);
  const result = $('#oad-result', root);

  function drawThumbs() {
    thumbs.innerHTML = state.images.map((im, i) => `<figure class="ocr-thumb"><img src="${im.url}" alt="" /><figcaption>${esc(im.status === 'run' ? `${Math.round((im.progress ?? 0) * 100)}%` : im.status === 'done' ? '✓' : im.status === 'error' ? t('ocr.error') : `#${i + 1}`)}</figcaption><button type="button" class="ocr-x" data-rm="${i}">${icon('x', 'size-4')}</button></figure>`).join('');
    $('#oad-run', root).disabled = !state.images.length || state.images.some((im) => im.status === 'run');
  }
  const add = (files) => {
    // Keep the order the user picked; within one batch, sort by file name (screenshots are numbered by time).
    const list = [...files].filter((f) => f.type.startsWith('image/')).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const f of list) state.images.push({ file: f, url: URL.createObjectURL(f), status: 'ready' });
    drawThumbs();
  };

  async function run() {
    const { recognize } = await import('../../xhs/ocr-engine.js');
    result.innerHTML = `<p class="card text-[14px]">${esc(t('ocr.loading'))}</p>`;
    for (const im of state.images) {
      if (im.status === 'done') continue;
      im.status = 'run';
      drawThumbs();
      try {
        const out = await recognize(im.file, (m) => {
          if (m.status === 'recognizing text') {
            im.progress = m.progress;
            const cap = thumbs.querySelectorAll('figcaption')[state.images.indexOf(im)];
            if (cap) cap.textContent = `${Math.round(m.progress * 100)}%`;
          }
        });
        im.lines = out.lines;
        im.text = out.text.replace(/\s+/g, '');
        im.status = 'done';
      } catch (err) {
        im.status = 'error';
        im.error = err?.message ?? String(err);
      }
      drawThumbs();
    }
    // Split into orders: a screenshot with the order header (publish time / "本订单共推广") starts one.
    const groups = [];
    for (const im of state.images.filter((x) => x.status === 'done')) {
      const starts = /本订单共推广|发布时间|推广完成|推广中/.test(im.text);
      if (starts || !groups.length) groups.push([]);
      groups.at(-1).push(im);
    }
    state.orders = groups.map((imgs) => {
      const parsed = parseAdOrder(imgs.map((im) => im.lines));
      const f = parsed.fields;
      const match = matchPost(posts, f.publishedAt?.value ?? f.publishedAt?.candidate, f.title?.value ?? f.title?.candidate);
      const values = {};
      for (const [k, v] of Object.entries(f)) if (v.status === 'ok') values[k] = v.value;
      return { imgs, parsed, values, postId: postId || match?.post.id || '', match, stage: '', save: true };
    });
    drawOrders();
  }

  const show = (k, v) => {
    if (v == null) return '';
    if (k === 'beatPct') return `${Math.round(v * 100)}`;
    if (k === 'estimate') return `${v[0]}~${v[1]}`;
    if (k === 'coupon') return `${v.threshold}/${v.bonus}`;
    if (k === 'startedAt' || k === 'publishedAt') return String(v).replace('T', ' ');
    return String(v);
  };
  const parseField = (k, s) => {
    const x = String(s).trim();
    if (!x) return null;
    if (k === 'beatPct') return Number(x) / 100;
    if (k === 'estimate') {
      const m = /^(\d+)\s*[~-]\s*(\d+)$/.exec(x);
      return m ? [Number(m[1]), Number(m[2])] : undefined;
    }
    if (k === 'coupon') {
      const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(x);
      return m ? { threshold: Number(m[1]), bonus: Number(m[2]) } : undefined;
    }
    if (NUMERIC.has(k)) return Number.isFinite(Number(x)) ? Number(x) : undefined;
    if (k === 'startedAt' || k === 'publishedAt') {
      const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(x);
      return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}` : undefined;
    }
    return x;
  };
  /** D+n of an order: typed value wins, otherwise publish date of the chosen post vs ad start time. */
  const autoStage = (o) => {
    const p = posts.find((x) => x.id === o.postId);
    return stageFromDates(p?.date, o.values.startedAt);
  };

  function stageNote(o) {
    if (o.stage) return t('oad.stageTyped');
    const auto = autoStage(o);
    return auto ? t('oad.stageAuto', { stage: auto }) : t('oad.stageNeedStart');
  }
  const refreshStage = (oi) => {
    const o = state.orders[oi];
    const inp = result.querySelector(`[data-stage="${oi}"]`);
    if (inp) inp.placeholder = autoStage(o) || 'D+n';
    const note = result.querySelector(`[data-stage-note="${oi}"]`);
    if (note) note.textContent = stageNote(o);
  };

  function drawOrders() {
    if (!state.orders.length) {
      result.innerHTML = `<p class="card text-[14px] text-muted">${esc(t('oad.none'))}</p>`;
      return;
    }
    result.innerHTML =
      state.orders
        .map((o, oi) => {
          const f = o.parsed.fields;
          const row = (k) => {
            const r = f[k];
            const label = AD_METRICS.find(([key]) => key === k)?.[1][0] ?? t(`oad.f.${k}`);
            const cand = r ? r.value ?? r.candidate ?? r.options?.[0]?.value : null;
            const st = !r ? 'missing' : k in o.values ? 'ok' : r.status === 'conflict' ? 'conflict' : 'check';
            return `<tr class="${st === 'check' || st === 'conflict' ? 'cf-mid' : ''}"><td>${esc(label)}</td><td class="text-[12px] text-muted">${esc(r?.text ?? '')}${r?.reason ? ` · ${esc(t(`ocr.why.${r.reason}`) )}` : ''}</td>
              <td>${cand != null && !(k in o.values) ? `<button type="button" class="ocr-cand" data-use="${oi}:${k}">${esc(show(k, cand))}</button>` : ''}</td>
              <td><input class="input !h-9 !w-36 tabular-nums" data-o="${oi}" data-k="${k}" value="${esc(show(k, o.values[k]))}" placeholder="${st === 'missing' ? '' : esc(t('ocr.needCheck'))}" />${k === 'beatPct' ? ' %' : ''}</td><td>${esc(t(`ocr.st.${st}`))}</td></tr>`;
          };
          const aud = o.parsed.audience;
          const audRows = Object.entries(aud).flatMap(([sec, list]) => Object.entries(list).map(([label, r]) => ({ sec, label, r })));
          return `<section class="card">
            <div class="flex flex-wrap items-start justify-between gap-2"><h2 class="text-[16px] font-semibold">${esc(t('oad.order', { n: oi + 1 }))} <span class="text-[13px] font-normal text-muted">${esc(t('oad.images', { n: o.imgs.length }))}</span></h2>
              <label class="flex items-center gap-2 text-[13px]"><input type="checkbox" data-save="${oi}" ${o.save ? 'checked' : ''} /> ${esc(t('oad.include'))}</label></div>
            <div class="mt-2 grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label class="field"><span class="field-label">${esc(t('ocr.post'))}</span><select class="input" data-post="${oi}"><option value="">${esc(t('oad.choosePost'))}</option>${posts.map((p) => `<option value="${esc(p.id)}" ${p.id === o.postId ? 'selected' : ''}>${esc(`${p.date} · ${p.title}`)}</option>`).join('')}</select>
                <span class="text-[12px] text-muted">${esc(o.match ? t(o.match.sameDay ? 'oad.matched' : 'oad.matchedNear', { title: o.match.post.title, date: o.match.post.date }) : t('oad.noMatch'))} · ${esc(t('oad.read', { title: f.title?.value ?? f.title?.candidate ?? '?', at: (f.publishedAt?.value ?? f.publishedAt?.candidate ?? '?').replace('T', ' ') }))}</span></label>
              <label class="field"><span class="field-label">${esc(t('ads.stage'))}</span><input class="input" data-stage="${oi}" list="oad-stages" value="${esc(o.stage)}" placeholder="${esc(autoStage(o) || 'D+n')}" /><span class="text-[12px] text-muted" data-stage-note="${oi}">${esc(stageNote(o))}</span></label>
            </div>
            <div class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div class="table-scroll"><table class="xtable"><thead><tr><th>${esc(t('crit.metric'))}</th><th>${esc(t('oad.readText'))}</th><th>${esc(t('ocr.recognised'))}</th><th>${esc(t('ocr.toSave'))}</th><th>${esc(t('imp.th.status'))}</th></tr></thead><tbody>${AD_FIELDS.map(row).join('')}</tbody></table></div>
              <div class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">${o.imgs.map((im) => `<img src="${im.url}" alt="" class="w-full rounded-[10px] border border-line" />`).join('')}</div>
            </div>
            ${audRows.length ? `<details class="mt-3"><summary class="link-btn cursor-pointer">${esc(t('oad.audience', { n: audRows.length }))}</summary>
              <div class="table-scroll mt-2"><table class="xtable"><thead><tr><th></th><th>${esc(t('oad.label'))}</th><th>${esc(t('ocr.toSave'))} (%)</th></tr></thead><tbody>${audRows.map(({ sec, label, r }) => `<tr class="${r.status === 'ok' ? '' : 'cf-mid'}"><td>${esc(t(`oad.sec.${sec}`))}</td><td>${esc(label)}</td><td><input class="input !h-8 !w-24" data-aud="${oi}|${sec}|${esc(label)}" value="${r.status === 'ok' ? Math.round(r.value * 1000) / 10 : ''}" placeholder="${r.candidate != null ? Math.round(r.candidate * 1000) / 10 : '?'}" /></td></tr>`).join('')}</tbody></table></div>
              <p class="mt-1 text-[12px] text-muted">${esc(t('oad.audHelp'))}</p></details>` : ''}
          </section>`;
        })
        .join('') +
      `<datalist id="oad-stages">${['D', 'D+1', 'D+2', 'D+3', 'D+4', 'D+5', 'D+6', 'D+7'].map((x) => `<option>${x}</option>`).join('')}</datalist>
       <div><button type="button" class="btn btn-primary" id="oad-save">${esc(t('oad.save'))}</button></div>`;
  }

  async function save() {
    const chosen = state.orders.filter((o) => o.save);
    // Read every edit box.
    for (const inp of result.querySelectorAll('[data-k]')) {
      const o = state.orders[Number(inp.dataset.o)];
      const v = parseField(inp.dataset.k, inp.value);
      if (v === undefined) return toast(t('ocr.badInput', { n: 1 }), { tone: 'error' });
      if (v === null) delete o.values[inp.dataset.k];
      else o.values[inp.dataset.k] = v;
    }
    const problems = chosen.filter((o) => !o.postId || !(normalizeStage(o.stage) || autoStage(o)) || o.values.spend == null);
    if (problems.length) return toast(t('oad.missingRequired', { n: problems.length }), { tone: 'error' });
    const list = chosen.map((o) => {
      const v = o.values;
      const audience = { gender: {}, age: {}, city: {}, interest: {} };
      for (const inp of result.querySelectorAll(`[data-aud^="${state.orders.indexOf(o)}|"]`)) {
        const [, sec, label] = inp.dataset.aud.split('|');
        const n = Number(inp.value);
        if (inp.value.trim() && Number.isFinite(n)) audience[sec][label] = n / 100;
      }
      return {
        o,
        ad: normalizeAd({
          stage: normalizeStage(o.stage) || autoStage(o),
          start: v.startedAt ?? '',
          executed: true,
          spend: v.spend,
          budget: v.budget,
          goal: v.goal ?? '',
          status: v.status ?? '',
          goalResult: v.result,
          estimate: v.estimate,
          beatPct: v.beatPct,
          coupon: v.coupon ? { ...v.coupon, expires: v.couponExpires ?? '' } : null,
          order: Object.fromEntries(AD_METRICS.map(([k]) => [k, v[k] ?? null])),
          audience,
          noteTitle: v.title ?? '',
          notePublishedAt: v.publishedAt ?? '',
        }),
      };
    });
    const ok = await openSheet({
      title: t('oad.confirmTitle', { n: list.length }),
      body: `<ul class="flex flex-col gap-1.5 text-[14px]">${list.map(({ o, ad }) => `<li><b>${esc(posts.find((p) => p.id === o.postId)?.title ?? '')}</b> · ${esc(ad.stage)} · ${ad.spend}元 · ${esc(AD_METRICS.map(([k, n]) => `${n[0]} ${ad.order[k] ?? '–'}`).join(', '))}</li>`).join('')}</ul>
        <p class="mt-2 text-[12px] text-muted">${esc(t('oad.confirmNote'))}</p>
        <div class="mt-3 grid grid-cols-[1fr_2fr] gap-2"><button type="button" class="btn btn-secondary" data-v="">${esc(t('common.cancel'))}</button><button type="button" class="btn btn-primary" data-v="1">${esc(t('oad.save'))}</button></div>`,
      onMount(el, close) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (b) close(b.dataset.v === '1');
        });
      },
    });
    if (!ok) return;
    const fresh = await listPosts();
    const byId = new Map(fresh.map((p) => [p.id, p]));
    for (const { o, ad } of list) {
      const shots = [];
      for (const im of o.imgs) {
        const blob = await compressImage(im.file, { maxSide: 1600, quality: 0.8 }).catch(() => null);
        if (blob) shots.push({ id: uid(), postId: o.postId, stage: 'ad', name: im.file.name, blob, createdAt: Date.now(), text: im.text ?? '' });
      }
      await putMany('shots', shots);
      ad.screenshots = shots.map((x) => x.id);
      const p = byId.get(o.postId);
      // Same order captured again (same stage, spend and report numbers): replace instead of duplicating.
      const same = p.ads.findIndex((a) => a.stage === ad.stage && a.spend === ad.spend && a.order?.exposure === ad.order.exposure);
      if (same >= 0) p.ads[same] = { ...ad, id: p.ads[same].id };
      else p.ads.push(ad);
    }
    await savePosts([...new Set(list.map(({ o }) => byId.get(o.postId)))]);
    toast(t('oad.saved', { n: list.length }));
    navigate('/ads');
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'oad-files') {
      add(e.target.files);
      e.target.value = '';
    }
    if (e.target.dataset.post) {
      state.orders[Number(e.target.dataset.post)].postId = e.target.value;
      refreshStage(Number(e.target.dataset.post));
    }
    if (e.target.dataset.save) state.orders[Number(e.target.dataset.save)].save = e.target.checked;
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.stage) {
      state.orders[Number(e.target.dataset.stage)].stage = e.target.value;
      refreshStage(Number(e.target.dataset.stage));
    }
    if (e.target.dataset.k === 'startedAt') {
      const o = state.orders[Number(e.target.dataset.o)];
      const v = parseField('startedAt', e.target.value);
      if (v) o.values.startedAt = v;
      else delete o.values.startedAt;
      refreshStage(Number(e.target.dataset.o));
    }
  });
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      state.images.splice(Number(rm.dataset.rm), 1);
      return drawThumbs();
    }
    const use = e.target.closest('[data-use]');
    if (use) {
      const [oi, k] = use.dataset.use.split(':');
      const o = state.orders[Number(oi)];
      const r = o.parsed.fields[k];
      o.values[k] = r.value ?? r.candidate ?? r.options?.[0]?.value;
      // keep typed edits in other boxes
      for (const inp of result.querySelectorAll(`[data-o="${oi}"]`)) {
        const v = parseField(inp.dataset.k, inp.value);
        if (v != null && inp.dataset.k !== k) o.values[inp.dataset.k] = v;
      }
      return drawOrders();
    }
    if (e.target.closest('#oad-run')) return run();
    if (e.target.closest('#oad-save')) return save();
  });
  const drop = $('#oad-drop', root);
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragging');
    add(e.dataTransfer.files);
  });
  return { kind: 'xhs-ocr-ad' };
}
