import { compressImage } from '../../data/media.js';
import { uid } from '../../lib/ids.js';
import { t } from '../../i18n/index.js';
import { navigate } from '../../router.js';
import { $, copyText, esc, openSheet, toast } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { putMany } from '../../xhs/db.js';
import { AD_METRICS, AD_REVIEW_FIELDS, completeBySum, knownName, nameGuess, parseAdOrder } from '../../xhs/ocr-ad-parse.js';
import { ordered } from '../../xhs/stats.js';
import { memoAds, memoToReplace, orderAds, placeOrder, rememberTitle, splitMoney } from '../../xhs/ad-orders.js';
import { listPosts, savePosts, stageFromDates } from '../../xhs/store.js';
import { xhsPage } from './shell.js';

/*
 * 薯条 order screenshots → ad records. Several orders can be uploaded at once: screenshots are
 * split into orders (a new order starts at a screenshot showing the order header / publish time),
 * each order is matched to a post by publish time and title, and nothing is saved before review.
 */

const NUMERIC = new Set(['spend', 'budget', 'result', 'beatPct', 'orderAmount', 'paid', 'bonus', 'costPerResult', 'duration', 'noteCount', ...AD_METRICS.map(([k]) => k)]);

/** Two-character pieces of a title (CJK / letters / digits only): robust against OCR noise. */
const pieces = (s) => {
  const t = String(s ?? '').toLowerCase().replace(/v[il1]og/g, 'vlog').replace(/[^\p{L}\p{N}]+/gu, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};
const COMMON = new Set(['vl', 'lo', 'og', '的一', '一天']);
/** How well an OCR'd title fits a post (its workbook title or a title remembered from earlier screenshots). */
export function titleScore(post, text) {
  const got = pieces(text);
  let best = 0;
  for (const name of [post.title, ...(post.adTitles ?? [])]) {
    const n = [...pieces(name)].filter((x) => got.has(x) && !COMMON.has(x)).length;
    best = Math.max(best, n);
  }
  return best;
}

/**
 * Best matching post: same publish date (±1 day) first, then title overlap. Without a publish
 * time, the post published last before the ad started (an ad promotes a note already out).
 */
export function matchPost(posts, publishedAt, title, startedAt = '') {
  const day = (s) => (s ? Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 86400000 : null);
  const d = day(publishedAt);
  const sd = d == null ? day(startedAt) : null;
  const before = sd == null ? [] : posts.filter((p) => p.date && day(p.date) <= sd).sort((a, b) => b.date.localeCompare(a.date));
  const latest = before[0];
  const chars = new Set(String(title ?? '').replace(/[\s|｜]/g, ''));
  let best = null;
  for (const p of posts) {
    const pd = day(p.date);
    let dateScore = d != null && pd != null ? Math.max(0, 2 - Math.abs(pd - d)) : 0; // 2 same day, 1 = ±1 day
    if (sd != null && p === latest) dateScore = sd - pd <= 7 ? 2 : 1;
    if (sd != null && pd != null && pd > sd) dateScore = -10; // published after the ad started: not it
    const overlap = [...new Set(p.title.replace(/\s/g, ''))].filter((c) => chars.has(c)).length;
    const score = dateScore * 10 + overlap + titleScore(p, title) * 2;
    if (score > 0 && (!best || score > best.score)) best = { post: p, score, sameDay: dateScore === 2 && d != null, byStart: sd != null && p === latest };
  }
  return best;
}

/** Posts that may be the notes of a multi-note order: title pieces found in the thumbnails' text. */
export function suggestPosts(posts, text, startedAt) {
  return posts
    .filter((p) => !startedAt || !p.date || p.date <= startedAt.slice(0, 10))
    .map((p) => ({ post: p, score: titleScore(p, text) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

/** A clicked recognition candidate is also copied, so it can be pasted elsewhere. */
async function copyCandidate(text) {
  if (!text) return;
  toast((await copyText(text)) ? t('ocr.candCopied', { v: text }) : t('ocr.candUsed', { v: text }));
}

/**
 * Second look at audience rows whose name (or share) was not read: the name part of the row is cut
 * out, the coloured bar removed (only dark grey text is kept), enlarged and read again as a single
 * line. Mutates parsed.audience; returns how many rows were fixed.
 */
export async function refineAudience(parsed, sources) {
  const jobs = [];
  for (const sec of ['city', 'interest']) {
    for (const [key, r] of Object.entries(parsed.audience[sec] ?? {})) {
      if (r.at?.box && (!knownName(key, sec) || r.status !== 'ok')) jobs.push({ sec, key, r });
    }
  }
  if (!jobs.length || typeof document === 'undefined') return 0;
  const { recognizeLine } = await import('../../xhs/ocr-engine.js');
  const bitmaps = new Map();
  const bitmapOf = async (i) => {
    if (!bitmaps.has(i)) {
      const src = sources[i];
      const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
      bitmaps.set(i, await createImageBitmap(blob));
    }
    return bitmaps.get(i);
  };
  /** Crop → 2× → keep only dark, neutral pixels (text) as black on white. */
  const clean = (bmp, x0, y0, x1, y1, scale = 2) => {
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const c = document.createElement('canvas');
    c.width = w * scale;
    c.height = h * scale;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, x0, y0, w, h, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    const a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const mx = Math.max(a[i], a[i + 1], a[i + 2]);
      const mn = Math.min(a[i], a[i + 1], a[i + 2]);
      const ink = mx < 150 && mx - mn < 45; // dark grey/black text; the red bar and grey track are not
      a[i] = a[i + 1] = a[i + 2] = ink ? 0 : 255;
    }
    g.putImageData(d, 0, 0);
    return c;
  };
  let fixed = 0;
  for (const job of jobs) {
    const { sec, r } = job;
    const bmp = await bitmapOf(r.at.img).catch(() => null);
    if (!bmp) continue;
    const W = bmp.width;
    const pad = 8;
    const y0 = Math.max(0, r.at.box.y0 - pad);
    const y1 = Math.min(bmp.height, r.at.box.y1 + pad);
    // A known name read with certainty is kept; a guessed one (a tie, reason "text") is read again.
    let name = knownName(job.key, sec) && r.reason !== 'text' ? job.key : '';
    // A few tries at different sizes (small text reads differently at each).
    for (const scale of [2, 1, 3]) {
      if (name) break;
      // Always from the left edge of the card: the row may have been read without its name.
      const read = await recognizeLine(clean(bmp, Math.min(Math.max(0, r.at.box.x0 - pad), W * 0.04), y0, W * 0.25, y1, scale)).catch(() => null);
      const g = read ? nameGuess(read.text, sec) : { name: '' };
      if (g.name && g.sure) name = g.name;
    }
    const nameSure = !!name;
    // Re-reading did not help: keep the first reading's guess, unconfirmed.
    if (!name) name = knownName(job.key, sec) ? job.key : knownName(r.guessName, sec) ? r.guessName : '';
    let value = r.status === 'ok' ? r.value : null;
    if (value == null) {
      const read = await recognizeLine(clean(bmp, W * 0.75, y0, W, y1)).catch(() => null);
      const m = /(\d{1,3}\.\d)\s*%?/.exec(read?.text ?? '');
      if (m && Number(m[1]) <= 100) value = Math.round(Number(m[1]) * 10) / 1000;
      else if (r.candidate != null && nameSure && r.reason === 'text') value = r.candidate; // only the name was unsure
    }
    if (!name || value == null) continue;
    value = Math.round(value * 1000) / 1000;
    if (nameSure) fixed++;
    const list = parsed.audience[sec];
    // Confirmed only when the name was read for certain; a kept guess stays "to check" (with its value).
    const updated = nameSure ? { ...r, status: 'ok', value, candidate: undefined, reason: undefined, confirmedBy: 'reread' } : { ...r, status: 'check', value: undefined, candidate: value, reason: 'text' };
    const entries = Object.entries(list).map(([k, v]) => (k === job.key ? [name, updated] : [k, v]));
    // The same row read on two screenshots: keep one.
    parsed.audience[sec] = Object.fromEntries(entries.filter(([k], i) => entries.findIndex(([k2]) => k2 === k) === i));
  }
  // Charts show at most 6 regions (top 5 + 其他) and 8 interests: once those are named, rows still
  // without a name are page noise (a banner, a button) and are dropped.
  for (const [sec, max] of [['city', 6], ['interest', 8]]) {
    const list = parsed.audience[sec] ?? {};
    const named = Object.keys(list).filter((k) => knownName(k, sec));
    if (named.length >= max) parsed.audience[sec] = Object.fromEntries(Object.entries(list).filter(([k]) => knownName(k, sec)));
  }
  completeBySum(parsed.audience.city);
  return fixed;
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
        <p class="mt-2 text-[12px] text-muted">${esc(t('oad.help'))} <span class="tabular-nums">· v${esc(__APP_VERSION__)}</span></p>
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
        const out = await recognize(
          im.file,
          (m) => {
            if (m.status === 'recognizing text') {
              im.progress = m.progress;
              const cap = thumbs.querySelectorAll('figcaption')[state.images.indexOf(im)];
              if (cap) cap.textContent = `${Math.round(m.progress * 100)}%`;
            }
          },
          { gray: true },
        );
        // Image size: to show the part of the screenshot each value was read from.
        const bmp = await createImageBitmap(im.file).catch(() => null);
        if (bmp) [im.w, im.h] = [bmp.width, bmp.height];
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
    const parsedGroups = [];
    for (const imgs of groups) {
      const parsed = parseAdOrder(imgs.map((im) => im.lines));
      await refineAudience(parsed, imgs.map((im) => im.file)).catch(() => 0);
      parsedGroups.push(parsed);
    }
    state.orders = groups.map((imgs, gi) => {
      const parsed = parsedGroups[gi];
      const f = parsed.fields;
      const match = matchPost(posts, f.publishedAt?.value ?? f.publishedAt?.candidate, f.title?.value ?? f.title?.candidate, f.startedAt?.value ?? f.startedAt?.candidate);
      const values = {};
      for (const [k, v] of Object.entries(f)) if (v.status === 'ok') values[k] = v.value;
      const n = Math.min(Math.max(f.noteCount?.value ?? 1, 1), 20);
      // One note: match by publish time + title. Several: suggest, never pick silently.
      const postIds = n === 1 ? [postId || match?.post.id || ''] : Array(n).fill('');
      const suggestions = n > 1 ? suggestPosts(posts, parsed.noteText, values.startedAt) : [];
      return { imgs, parsed, values, postIds, match: n === 1 ? match : null, suggestions, stage: '', save: true };
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
  const autoStage = (o, id = o.postIds[0]) => {
    const p = posts.find((x) => x.id === id);
    // One note: the publish time shown in the screenshot beats the workbook date.
    const published = o.postIds.length === 1 && o.values.publishedAt ? o.values.publishedAt : p?.date;
    return stageFromDates(published, o.values.startedAt);
  };
  /** Single-note order: date check, real money vs platform credit, and which memo record it replaces. */
  const singleExtras = (o, oi) => {
    const post = posts.find((x) => x.id === o.postIds[0]);
    const out = [];
    const pub = (o.values.publishedAt ?? '').slice(0, 10);
    if (post && pub && post.date && pub !== post.date) out.push(`<p class="notice mt-2 text-[13px]">${esc(t('oad.dateDiff', { shot: pub, book: post.date }))}</p>`);
    const { money, credit } = splitMoney(o.values);
    if (credit) out.push(`<p class="mt-2 text-[13px]">${esc(t('oad.moneySplit', { consumed: o.values.spend, money, credit }))}</p>`);
    const memos = memoAds(post);
    if (memos.length) {
      const probe = orderAds({ values: o.values, postIds: o.postIds, posts, stage: o.stage })[0]?.ad;
      const chosen = o.replace === undefined ? memoToReplace(post, probe)?.id ?? '' : o.replace;
      out.push(`<label class="field mt-2"><span class="field-label">${esc(t('oad.replaceMemo'))}</span><select class="input" data-replace="${oi}">
        ${memos.map((a) => `<option value="${esc(a.id)}" ${a.id === chosen ? 'selected' : ''}>${esc(t('oad.memoOption', { stage: a.stage || '?', spend: a.spend ?? '?', text: a.sourceText || a.memo || '' }))}</option>`).join('')}
        <option value="" ${chosen === '' ? 'selected' : ''}>${esc(t('oad.keepBoth'))}</option></select>
        <span class="text-[12px] text-muted">${esc(t('oad.replaceHelp'))}</span></label>`);
    }
    return out.join('');
  };
  /** Copies what was typed into the boxes of an order before it is redrawn. */
  const keepEdits = (oi) => {
    const o = state.orders[oi];
    for (const inp of result.querySelectorAll(`[data-o="${oi}"]`)) {
      const v = parseField(inp.dataset.k, inp.value);
      if (v != null) o.values[inp.dataset.k] = v;
    }
  };
  const savedOrder = (o) => o.values.orderNo && posts.some((p) => p.ads.some((a) => a.orderNo === o.values.orderNo));

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

  const labelOf = (k) => AD_METRICS.find(([key]) => key === k)?.[1][0] ?? t(`oad.f.${k}`);
  /** The strip of the screenshot a value was read from (full width, so the label is visible too). */
  const crop = (o, at) => {
    const im = o.imgs[at?.img];
    if (!at?.box || !im?.w) return '';
    const pad = 16;
    const y0 = Math.max(0, at.box.y0 - pad);
    const y1 = Math.min(im.h, at.box.y1 + pad);
    const h = Math.max(1, y1 - y0);
    const pos = im.h - h > 0 ? (y0 / (im.h - h)) * 100 : 0;
    return `<div class="ocr-crop" role="img" aria-label="${esc(t('oad.cropAlt'))}" style="aspect-ratio:${im.w}/${h};background-image:url('${im.url}');background-position:0 ${pos}%"></div>`;
  };
  const input = (o, oi, k, extra = '') => `<span class="flex min-w-0 items-center gap-1"><input class="input !h-10 min-w-0 flex-1 tabular-nums" data-o="${oi}" data-k="${k}" value="${esc(show(k, o.values[k]))}" ${extra} />${k === 'beatPct' ? '%' : ''}</span>`;
  /** Values to check first (with the screenshot strip), then the confirmed ones, then the missing ones. */
  function fieldsHtml(o, oi) {
    const f = o.parsed.fields;
    const keys = AD_REVIEW_FIELDS.filter((k) => !(k === 'noteCount' && o.postIds.length === 1 && f.noteCount?.status === 'ok'));
    const toCheck = keys.filter((k) => f[k] && !(k in o.values));
    const done = keys.filter((k) => k in o.values);
    const missing = keys.filter((k) => !f[k] && !(k in o.values));
    const checkItem = (k) => {
      const r = f[k];
      const cands = r.status === 'conflict' ? r.options.map((x) => x.value) : [r.candidate];
      return `<div class="rounded-[14px] border border-line p-3 cf-mid">
        <div class="flex items-baseline justify-between gap-2"><b class="text-[14px]">${esc(labelOf(k))}</b><span class="text-[12px] opacity-75">${esc(r.reason ? t(`ocr.why.${r.reason}`) : t('ocr.st.conflict'))}</span></div>
        ${crop(o, r.at ?? r.options?.[0]?.at)}
        <div class="mt-2 flex flex-wrap items-center gap-2">${cands.filter((c) => c != null).map((c) => `<button type="button" class="ocr-cand !mb-0 !px-2.5 !py-1.5 !text-[14px]" data-use="${oi}:${k}" title="${esc(t('ocr.candTitle'))}">${esc(show(k, c))}</button>`).join('')}${input(o, oi, k, `placeholder="${esc(t('ocr.needCheck'))}"`)}</div>
      </div>`;
    };
    const okItem = (k) => `<label class="flex min-w-0 flex-col gap-0.5 ${k === 'startedAt' || k === 'publishedAt' ? 'col-span-2 sm:col-span-1' : ''}"><span class="truncate text-[11px] text-muted">${esc(labelOf(k))}</span>${input(o, oi, k)}</label>`;
    return `<div class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div class="flex min-w-0 flex-col gap-3">
        ${toCheck.length ? `<div><p class="text-[14px] font-semibold">${esc(t('oad.needCheckN', { n: toCheck.length }))}</p><div class="mt-2 grid gap-2 lg:grid-cols-2">${toCheck.map(checkItem).join('')}</div></div>` : `<p class="rounded-[12px] cf-good px-3 py-2 text-[14px]">${esc(t('oad.allOk'))}</p>`}
        <div><p class="text-[14px] font-semibold">${esc(t('oad.okValues', { n: done.length }))}</p><div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">${done.map(okItem).join('')}</div></div>
        ${missing.length ? `<details><summary class="link-btn cursor-pointer text-[13px]">${esc(t('oad.missingN', { n: missing.length }))}</summary><div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">${missing.map(okItem).join('')}</div></details>` : ''}
        <details class="xl:hidden"><summary class="link-btn cursor-pointer text-[13px]">${esc(t('oad.originals', { n: o.imgs.length }))}</summary><div class="mt-2 flex flex-col gap-2">${o.imgs.map((im) => `<img src="${im.url}" alt="" class="w-full rounded-[10px] border border-line" />`).join('')}</div></details>
      </div>
      <div class="sticky top-4 hidden max-h-[85vh] flex-col gap-2 self-start overflow-y-auto xl:flex">${o.imgs.map((im) => `<img src="${im.url}" alt="" class="w-full rounded-[10px] border border-line" />`).join('')}</div>
    </div>`;
  }

  function drawOrders() {
    if (!state.orders.length) {
      result.innerHTML = `<p class="card text-[14px] text-muted">${esc(t('oad.none'))}</p>`;
      return;
    }
    result.innerHTML =
      state.orders
        .map((o, oi) => {
          const f = o.parsed.fields;
          const aud = o.parsed.audience;
          const audRows = Object.entries(aud).flatMap(([sec, list]) => Object.entries(list).map(([label, r]) => ({ sec, label, r })));
          return `<section class="card">
            <div class="flex flex-wrap items-start justify-between gap-2"><h2 class="text-[16px] font-semibold">${esc(t('oad.order', { n: oi + 1 }))} <span class="text-[13px] font-normal text-muted">${esc(t('oad.images', { n: o.imgs.length }))}</span></h2>
              <label class="flex items-center gap-2 text-[13px]"><input type="checkbox" data-save="${oi}" ${o.save ? 'checked' : ''} /> ${esc(t('oad.include'))}</label></div>
            ${savedOrder(o) ? `<p class="notice mt-2 text-[13px]">${esc(t('oad.alreadySaved', { no: o.values.orderNo }))}</p>` : ''}
            ${
              o.postIds.length > 1
                ? `<div class="mt-2"><p class="text-[14px] font-semibold">${esc(t('oad.multi', { n: o.postIds.length }))}</p>
                <p class="text-[12px] text-muted">${esc(t('oad.multiHelp'))}</p>
                <div class="mt-2 grid gap-2 sm:grid-cols-2">${o.postIds.map((id, k) => `<label class="field"><span class="field-label">${esc(t('oad.noteN', { n: k + 1 }))}${id && autoStage(o, id) ? ` · ${esc(autoStage(o, id))}` : ''}</span><select class="input" data-post="${oi}" data-slot="${k}"><option value="">${esc(t('oad.choosePost'))}</option>${posts.map((p) => `<option value="${esc(p.id)}" ${p.id === id ? 'selected' : ''}>${esc(`${p.date} · ${p.title}`)}</option>`).join('')}</select></label>`).join('')}</div>
                ${o.suggestions.length ? `<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]"><span class="text-muted">${esc(t('oad.suggest'))}</span>${o.suggestions.map((x) => `<button type="button" class="chip" data-suggest="${oi}" data-id="${esc(x.post.id)}" ${o.postIds.includes(x.post.id) ? 'disabled' : ''}>${esc(`${x.post.date} · ${x.post.title}`)}</button>`).join('')}</div>` : ''}
                <p class="mt-1 text-[12px] text-muted">${esc(t('oad.readNotes', { text: o.parsed.noteText || '?' }))}</p>
                <p class="mt-1 text-[12px] text-muted">${esc(t(o.values.startedAt ? 'oad.multiStage' : 'oad.stageNeedStart'))}</p></div>`
                : `<div class="mt-2 grid gap-3 sm:grid-cols-[2fr_1fr]">
              <label class="field"><span class="field-label">${esc(t('ocr.post'))}</span><select class="input" data-post="${oi}" data-slot="0"><option value="">${esc(t('oad.choosePost'))}</option>${posts.map((p) => `<option value="${esc(p.id)}" ${p.id === o.postIds[0] ? 'selected' : ''}>${esc(`${p.date} · ${p.title}`)}</option>`).join('')}</select>
                <span class="text-[12px] text-muted">${esc(o.match ? t(o.match.byStart ? 'oad.matchedStart' : o.match.sameDay ? 'oad.matched' : 'oad.matchedNear', { title: o.match.post.title, date: o.match.post.date }) : t('oad.noMatch'))} · ${esc(t('oad.read', { title: f.title?.value ?? f.title?.candidate ?? '?', at: (f.publishedAt?.value ?? f.publishedAt?.candidate ?? '?').replace('T', ' ') }))}</span></label>
              <label class="field"><span class="field-label">${esc(t('ads.stage'))}</span><input class="input" data-stage="${oi}" list="oad-stages" value="${esc(o.stage)}" placeholder="${esc(autoStage(o) || 'D+n')}" /><span class="text-[12px] text-muted" data-stage-note="${oi}">${esc(stageNote(o))}</span></label>
            </div>${singleExtras(o, oi)}`
            }
            ${fieldsHtml(o, oi)}
            ${audRows.length ? `<details class="mt-3"><summary class="link-btn cursor-pointer">${esc(t(audRows.some(({ sec, label, r }) => r.status !== 'ok' || (sec !== 'gender' && sec !== 'age' && !knownName(label, sec))) ? 'oad.audienceCheck' : 'oad.audienceOk', { n: audRows.length, k: audRows.filter(({ sec, label, r }) => r.status !== 'ok' || (sec !== 'gender' && sec !== 'age' && !knownName(label, sec))).length }))}</summary>
              <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">${audRows.map(({ sec, label, r }) => {
                const unnamed = sec !== 'gender' && sec !== 'age' && (label.startsWith('#') || r.reason === 'text');
                return `<div class="flex flex-col gap-0.5 rounded-[10px] px-2 py-1.5 ${r.status === 'ok' && !unnamed ? 'bg-surface-2' : 'cf-mid'}"><span class="text-[11px] opacity-75">${esc(t(`oad.sec.${sec}`))}${unnamed ? '' : ` · ${esc(label)}`}</span>
                  ${unnamed ? `<input class="input !h-8 min-w-0" data-aud-name="${oi}|${sec}|${esc(label)}" value="${label.startsWith('#') ? '' : esc(label)}" placeholder="${esc(t('oad.audName'))}" />` : ''}
                  <span class="flex items-center gap-1"><input class="input !h-8 min-w-0 flex-1 tabular-nums" inputmode="decimal" data-aud="${oi}|${sec}|${esc(label)}" value="${r.status === 'ok' ? Math.round(r.value * 1000) / 10 : ''}" placeholder="${r.candidate != null ? Math.round(r.candidate * 1000) / 10 : '?'}" />%</span>
                  ${r.status !== 'ok' || unnamed ? crop(o, r.at) : ''}</div>`;
              }).join('')}</div>
              <p class="mt-1 text-[12px] text-muted">${esc(t('oad.audHelp'))}</p></details>` : ''}
          </section>`;
        })
        .join('') +
      `<datalist id="oad-stages">${['D', 'D+1', 'D+2', 'D+3', 'D+4', 'D+5', 'D+6', 'D+7'].map((x) => `<option>${x}</option>`).join('')}</datalist>
       <div class="flex flex-wrap items-center gap-2"><button type="button" class="btn btn-primary" id="oad-save">${esc(t('oad.save'))}</button>
         <button type="button" class="btn btn-ghost btn-sm" id="oad-dump">${esc(t('oad.dump'))}</button></div>
       <p class="text-[12px] text-muted">${esc(t('oad.dumpHelp'))}</p>`;
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
    const problems = chosen.filter((o) => o.postIds.some((id) => !id) || new Set(o.postIds).size !== o.postIds.length || o.values.spend == null);
    if (problems.length) return toast(t('oad.missingRequired', { n: problems.length }), { tone: 'error' });
    const list = chosen.map((o) => {
      const audience = { gender: {}, age: {}, city: {}, interest: {} };
      for (const inp of result.querySelectorAll(`[data-aud^="${state.orders.indexOf(o)}|"]`)) {
        const [, sec, label] = inp.dataset.aud.split('|');
        const n = Number(inp.value);
        // A name typed for an unreadable label replaces "#3" etc.
        const named = result.querySelector(`[data-aud-name="${CSS.escape(inp.dataset.aud)}"]`)?.value.trim();
        if (inp.value.trim() && Number.isFinite(n)) audience[sec][named || label] = n / 100;
      }
      return { o, entries: orderAds({ values: o.values, postIds: o.postIds, posts, stage: o.stage, audience, replace: o.replace }) };
    });
    const titleOf = (id) => posts.find((p) => p.id === id)?.title ?? '';
    const ok = await openSheet({
      title: t('oad.confirmTitle', { n: list.length }),
      body: `<ul class="flex flex-col gap-2 text-[14px]">${list
        .map(({ o, entries }) => {
          const ad = entries[0].ad;
          const total = ad.orderSpend ?? ad.spend;
          const credit = entries.reduce((a, x) => a + (x.ad.credit ?? 0), 0);
          const post = posts.find((p) => p.id === entries[0].postId);
          const memo = entries.length === 1 && (o.replace === undefined ? memoToReplace(post, ad) : memoAds(post).find((a) => a.id === o.replace));
          return `<li><b>${esc(entries.map((x) => `${titleOf(x.postId)} (${x.ad.stage || '?'})`).join(' + '))}</b> · ${esc(t('oad.realSpend', { v: total }))}${credit ? ` · ${esc(t('oad.creditPart', { v: Math.round(credit * 100) / 100 }))}` : ''}${entries.length > 1 ? ` · ${esc(t('oad.splitNote', { n: entries.length, each: ad.spend }))}` : ''}${savedOrder(o) || memo ? ` · ${esc(t('oad.replaces'))}${memo ? ` (${esc(memo.sourceText || memo.stage)})` : ''}` : ''}<br/><span class="text-[12px] text-muted">${esc(AD_METRICS.map(([k, n]) => `${n[0]} ${ad.order[k] ?? '–'}`).join(', '))}</span></li>`;
        })
        .join('')}</ul>
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
    const changed = new Set();
    for (const { o, entries } of list) {
      const shots = [];
      for (const im of o.imgs) {
        const blob = await compressImage(im.file, { maxSide: 1600, quality: 0.8 }).catch(() => null);
        if (blob) shots.push({ id: uid(), postId: o.postIds[0], stage: 'ad', name: im.file.name, blob, createdAt: Date.now(), text: im.text ?? '' });
      }
      await putMany('shots', shots);
      for (const x of entries) x.ad.screenshots = shots.map((sh) => sh.id);
      for (const p of placeOrder(fresh, entries)) changed.add(p);
      // Single-note order: remember the title it had in the screenshot for next time.
      // An unconfirmed reading is fine here: it is only used to recognise the post next time.
      const title = o.values.title ?? o.parsed.fields.title?.candidate;
      const p = o.postIds.length === 1 && fresh.find((x) => x.id === o.postIds[0]);
      if (p && title && rememberTitle(p, title)) changed.add(p);
    }
    await savePosts([...changed]);
    toast(t('oad.saved', { n: list.length }));
    navigate('/ads');
  }

  root.addEventListener('change', (e) => {
    if (e.target.id === 'oad-files') {
      add(e.target.files);
      e.target.value = '';
    }
    if (e.target.dataset.post) {
      const o = state.orders[Number(e.target.dataset.post)];
      o.postIds[Number(e.target.dataset.slot ?? 0)] = e.target.value;
      o.replace = undefined;
      keepEdits(Number(e.target.dataset.post));
      drawOrders();
    }
    if (e.target.dataset.save) state.orders[Number(e.target.dataset.save)].save = e.target.checked;
    if (e.target.dataset.replace != null) state.orders[Number(e.target.dataset.replace)].replace = e.target.value;
    if (e.target.dataset.k === 'noteCount') {
      // Corrected number of notes: one post choice per note.
      const oi = Number(e.target.dataset.o);
      const o = state.orders[oi];
      const n = Math.min(Math.max(Math.round(Number(e.target.value)) || 1, 1), 20);
      keepEdits(oi);
      o.values.noteCount = n;
      o.postIds = Array.from({ length: n }, (_, k) => o.postIds[k] ?? '');
      if (n > 1 && !o.suggestions.length) o.suggestions = suggestPosts(posts, o.parsed.noteText, o.values.startedAt);
      drawOrders();
    }
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
    const sug = e.target.closest('[data-suggest]');
    if (sug) {
      const o = state.orders[Number(sug.dataset.suggest)];
      const free = o.postIds.indexOf('');
      if (free >= 0) o.postIds[free] = sug.dataset.id;
      keepEdits(Number(sug.dataset.suggest));
      return drawOrders();
    }
    const use = e.target.closest('[data-use]');
    if (use) {
      const [oi, k] = use.dataset.use.split(':');
      const o = state.orders[Number(oi)];
      const r = o.parsed.fields[k];
      o.values[k] = r.value ?? r.candidate ?? r.options?.[0]?.value;
      copyCandidate(use.textContent.trim());
      // keep typed edits in other boxes
      for (const inp of result.querySelectorAll(`[data-o="${oi}"]`)) {
        const v = parseField(inp.dataset.k, inp.value);
        if (v != null && inp.dataset.k !== k) o.values[inp.dataset.k] = v;
      }
      return drawOrders();
    }
    if (e.target.closest('#oad-run')) return run();
    if (e.target.closest('#oad-save')) return save();
    if (e.target.closest('#oad-dump')) {
      // What OCR read (text, position, confidence) — no images — to paste into a support chat.
      const dump = state.images
        .filter((im) => im.lines)
        .map((im, i) => `#${i + 1} ${im.w ?? '?'}x${im.h ?? '?'}\n` + im.lines.map((l) => l.words.map((w) => `${w.text}@${Math.round(w.bbox.x0)},${Math.round(w.bbox.y0)},${Math.round(w.bbox.x1)},${Math.round(w.bbox.y1)}:${Math.round(w.confidence)}`).join(' ')).join('\n'))
        .join('\n\n');
      return copyText(`vlog-studio ocr v${__APP_VERSION__}\n${dump}`).then((ok) => toast(t(ok ? 'oad.dumpDone' : 'menu.copyFailed')));
    }
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
