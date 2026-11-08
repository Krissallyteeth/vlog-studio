import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { fmt } from '../../xhs/format.js';
import { METRIC } from '../../xhs/metrics.js';
import { emph } from './insight-text.js';
import { channelFindings } from '../../xhs/channels.js';

/*
 * What a post's D+1 / D+2 screenshots showed besides the metrics (src/xhs/ocr-note.js): the data's
 * time window, the platform's own peer comparison, traffic sources and audience.
 */

const SRC = ['home', 'videoRec', 'search', 'followPage', 'other'];
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const top = (o, n) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n);

/** Hours between publishing and the data cut ("발행 후 약 4.6시간"). */
export function windowHours(meta, post) {
  const pub = meta?.publishedAt || (post?.date && post?.time ? `${post.date}T${post.time}` : '');
  if (!meta?.snapshotAt || !pub) return null;
  const h = (Date.parse(`${meta.snapshotAt}:00Z`) - Date.parse(`${pub}:00Z`)) / 3600000;
  return h > 0 && h < 24 * 7 ? Math.round(h * 10) / 10 : null;
}

// Channel table columns: field, how it is shown, how it is typed in the OCR review.
const CH_COLS = [
  ['shareViews', (v) => pct(v), 'pct'],
  ['conv', (v) => pct(v), 'pct'],
  ['avgWatch', (v) => t('nm.ch.sec', { v }), 'num'],
  ['interactionRate', (v) => pct(v), 'pct'],
  ['likes', (v) => String(v), 'num'],
  ['comments', (v) => String(v), 'num'],
  ['favs', (v) => String(v), 'num'],
];

/** 此渠道详细数据 per channel; with `edit`, each value is an input (data-ch="home.avgWatch"). */
function channelTable(meta, edit) {
  const ch = meta.channels ?? {};
  const keys = ['home', 'videoRec'].filter((k) => ch[k] || (edit && meta.sources?.[k] != null));
  if (!keys.length) return '';
  const cell = (k, [f, show, kind]) => {
    const v = ch[k]?.[f];
    const derived = ch[k]?.derived?.includes(f);
    if (edit) return `<td class="num ${derived ? 'cf-mid' : ''}" ${derived ? `title="${esc(t('nm.ch.derived'))}"` : ''}><input class="input !h-8 !w-16 text-right tabular-nums" inputmode="decimal" data-ch="${k}.${f}" data-kind="${kind}" value="${v == null ? '' : kind === 'pct' ? Math.round(v * 1000) / 10 : v}" /></td>`;
    return `<td class="num">${v == null ? '–' : esc(show(v))}</td>`;
  };
  return `<p class="mt-3 text-[13px] font-semibold">${esc(t('nm.ch.title'))}</p>
    <div class="table-scroll mt-1"><table class="xtable"><thead><tr><th>${esc(t('nm.ch.channel'))}</th>${CH_COLS.map(([f]) => `<th class="num">${esc(t(`nm.ch.${f}`))}</th>`).join('')}</tr></thead>
    <tbody>${keys.map((k) => `<tr><td>${esc(t(`nm.src.${k}`))}</td>${CH_COLS.map((c) => cell(k, c)).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="mt-1 text-[12px] text-muted">${esc(t(edit ? 'nm.ch.edit' : 'nm.ch.note'))}</p>`;
}

const TONE = { good: 'cf-good', warn: 'cf-mid', info: 'bg-surface-2' };

export function noteMetaHtml(meta, post, stageLabel = 'D+1', { posts = [], edit = false } = {}) {
  if (!meta) return '';
  const parts = [];
  const h = windowHours(meta, post);
  if (meta.snapshotAt) parts.push(`<p class="text-[13px]">${esc(t('nm.window', { stage: stageLabel, at: meta.snapshotAt.replace('T', ' '), h: h ?? '?' }))}${meta.snapshotDerived ? ` <span class="text-muted">${esc(t('nm.derived'))}</span>` : ''}</p>`);
  const peer = Object.entries(meta.peer ?? {}).filter(([k, v]) => METRIC[k] && v.median != null);
  if (peer.length) {
    parts.push(`<div class="table-scroll mt-2"><table class="xtable"><thead><tr><th>${esc(t('nm.peerMetric'))}</th><th class="num" data-m="key">${esc(t('nm.this'))}</th><th class="num" data-m="inline">${esc(t('nm.peerMedian'))}</th><th class="num" data-m="inline">${esc(t('nm.peerRank'))}</th></tr></thead><tbody>${peer
      .map(([k, v]) => `<tr><td>${esc(METRIC[k].zh)}</td><td class="num">${esc(fmt(k, v.value))}</td><td class="num">${esc(fmt(k, v.median))}</td><td class="num ${v.beat >= 0.6 ? 'cf-good' : v.beat <= 0.4 ? 'cf-mid' : ''}">${v.beat == null ? '–' : esc(t('nm.top', { p: Math.max(1, Math.round((1 - v.beat) * 100)) }))}</td></tr>`)
      .join('')}</tbody></table></div><p class="mt-1 text-[12px] text-muted">${esc(t('nm.peerNote'))}</p>`);
  }
  const ai = meta.ai ?? {};
  // The platform's own diagnosis per metric: its suggestion stands out.
  const aiRows = Object.entries(ai.metrics ?? {}).filter(([k]) => METRIC[k]);
  if (aiRows.length) {
    parts.push(`<p class="mt-3 text-[13px] font-semibold">${esc(t('nm.ai'))}</p>${aiRows
      .map(([k, v]) => `<div class="ai-box"><p class="font-semibold">${esc(METRIC[k].zh)}${meta.peer?.[k]?.beat != null ? ` <span class="badge ${meta.peer[k].beat >= 0.6 ? 'cf-good' : meta.peer[k].beat <= 0.4 ? 'cf-mid' : 'bg-surface-2'}">${esc(t('nm.top', { p: Math.max(1, Math.round((1 - meta.peer[k].beat) * 100)) }))}</span>` : ''}</p>${v.now ? `<p class="text-muted">${esc(v.now)}</p>` : ''}${v.why ? `<p class="mt-1">${esc(v.why)}</p>` : ''}${v.tip ? `<p class="mt-1">${emph(v.tip)}</p>` : ''}</div>`)
      .join('')}`);
  }
  const segs = (meta.segments ?? []).filter((x) => x.loss != null);
  if (segs.length)
    parts.push(`<p class="mt-3 text-[13px] font-semibold">${esc(t('nm.segments'))}</p><ul class="mt-1 flex flex-col gap-1 text-[13px]">${segs
      .map((x) => {
        const a = ai.segments?.[x.from];
        const row = `<span class="tabular-nums">${esc(x.from)}–${esc(x.to)}</span><b class="tabular-nums">${esc(t('nm.lost', { p: Math.round(x.loss * 100) }))}</b><span class="min-w-0 truncate">${esc(x.title)}</span>`;
        const tone = x.loss >= 0.3 ? 'cf-bad' : x.loss >= 0.1 ? 'cf-mid' : 'bg-surface-2';
        return a ? `<li class="rounded-[8px] px-2 py-1 ${tone}"><details><summary class="flex cursor-pointer gap-2">${row}</summary>${a.analysis ? `<p class="mt-1">${esc(a.analysis)}</p>` : ''}${a.tip ? `<p class="mt-1">${emph(a.tip)}</p>` : ''}</details></li>` : `<li class="flex gap-2 rounded-[8px] px-2 py-1 ${tone}">${row}</li>`;
      })
      .join('')}</ul>`);
  for (const k of ['traffic', 'audience']) if (ai[k]?.text) parts.push(`<div class="ai-box"><p class="font-semibold">${esc(t(`nm.ai.${k}`))}: ${esc(ai[k].title ?? '')}</p><p class="mt-1">${emph(ai[k].text)}</p></div>`);
  const table = channelTable(meta, edit);
  if (table) {
    parts.push(table);
    const finds = channelFindings({ ...post, id: post?.id ?? '', [`${stageLabel === 'D+2' ? 'd2' : 'd1'}Meta`]: meta }, posts, stageLabel === 'D+2' ? 'd2' : 'd1');
    if (finds.length) parts.push(`<ul class="mt-2 flex flex-col gap-1.5">${finds.map((x) => `<li class="rounded-[10px] px-3 py-2 text-[13px] leading-relaxed ${TONE[x.tone]}">${emph(t(`ch.${x.key}`, x.vars))}${x.ref ? ` <span class="badge bg-surface-2">${esc(t('ops.ref'))}</span>` : ''}</li>`).join('')}</ul>`);
  }
  const src = SRC.filter((k) => meta.sources?.[k] != null);
  if (src.length) parts.push(`<p class="mt-2 text-[13px]"><b>${esc(t('nm.sources'))}</b> ${src.map((k) => `${esc(t(`nm.src.${k}`))} ${pct(meta.sources[k])}`).join(' · ')}</p>`);
  const a = meta.audience ?? {};
  const aud = [
    a.gender?.female != null ? `${t('nm.female')} ${pct(a.gender.female)}` : '',
    top(a.age, 2).map(([k, v]) => `${k} ${pct(v)}`).join(', '),
    top(a.city, 3).map(([k, v]) => `${k} ${pct(v)}`).join(', '),
    top(a.interest, 3).map(([k, v]) => `${k} ${pct(v)}`).join(', '),
  ].filter(Boolean);
  if (aud.length) parts.push(`<p class="mt-1 text-[13px]"><b>${esc(t('nm.audience'))}</b> ${esc(aud.join(' · '))}</p>`);
  return parts.length ? `<div class="mt-3 rounded-[12px] border border-line p-3"><h3 class="text-[14px] font-semibold">${esc(t('nm.title', { stage: stageLabel }))}</h3>${parts.join('')}</div>` : '';
}
