import { t } from '../../i18n/index.js';
import { fmt, yuan } from '../../xhs/format.js';
import { esc } from '../../ui/dom.js';

/*
 * Wording for the insight items of src/xhs/insights.js: numbers are formatted by what they are
 * (a metric's own format, 元 amounts), labels of groups are translated.
 */

const MONEY = ['cheap', 'dear', 'now', 'before'];
const LABEL = { multi: 'ins.multi', single: 'ins.single' };

export function insightText(prefix, item) {
  const v = { ...item.vars };
  const metric = item.metric ?? (item.key.match(/\.(\w+)$/) ?? [])[1];
  for (const k of ['now', 'base', 'top', 'bestV']) if (metric && typeof v[k] === 'number' && /^(weak|focus)\./.test(item.key)) v[k] = fmt(metric, v[k]);
  if (/^(ins\.)?(naturalCut|timing|multiVsSingle|contentType|trendUp|trendDown|adOnlyStrong|adCutUnclear|adTrendUp)$/.test(item.key) || /^(trend|adTrend)/.test(item.key)) {
    for (const k of MONEY) if (typeof v[k] === 'number') v[k] = yuan(v[k]);
  }
  for (const k of ['win', 'lose']) if (LABEL[v[k]]) v[k] = t(LABEL[v[k]]);
  let text = t(`${prefix}.${item.key}`, v);
  if (typeof item.vars.gain === 'number' && item.vars.gain > 0) text += ` ${t('pf.gain', { gain: item.vars.gain })}`;
  return text;
}

/**
 * Escaped text with the important parts marked: the sentence that says what to do (Korean
 * "…세요", Chinese "建议…") in the warm colour, numbers with their unit in bold.
 */
export function emph(text) {
  // A "." ends a sentence only before a space or the end, so 0.8 and 3.45元 stay whole.
  const sentences = String(text ?? '').split(/(?<=[。！？])\s*|(?<=[.!?])\s+/);
  return sentences
    .map((x) => {
      let h = esc(x).replace(/([+-]?\d[\d,.]*\s*(?:%|元|원|회|명|건|편|초|배|시간|s|秒|个)?)/g, '<b class="hl-n">$1</b>');
      if (/세요[.!]?$|세요\.?\s*$|^建议|建议|可以尝试|不妨/.test(x)) h = `<span class="hl">${h}</span>`;
      return h;
    })
    .join(' ');
}

const TONE = { good: 'cf-good', warn: 'cf-mid', info: 'bg-surface-2' };

/** A list of insight items as tinted rows (a "참고" badge on small samples). */
export function insightList(prefix, items, { empty = '' } = {}) {
  if (!items.length) return empty ? `<p class="mt-2 text-[14px] text-muted">${esc(empty)}</p>` : '';
  return `<ul class="mt-2 flex flex-col gap-1.5">${items
    .map((it) => `<li class="rounded-[12px] px-3 py-2 text-[14px] leading-relaxed ${TONE[it.tone] ?? 'bg-surface-2'}">${emph(insightText(prefix, it))}${it.ref ? ` <span class="badge bg-surface-2">${esc(t('ops.ref'))}</span>` : ''}${it.vars?.bestId && /^weak\./.test(it.key) ? ` <a class="link-btn text-[13px]" href="#/c/${encodeURIComponent(it.vars.bestId)}">${esc(it.vars.best)}</a>` : ''}</li>`)
    .join('')}</ul>`;
}
