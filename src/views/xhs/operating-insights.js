import { t } from '../../i18n/index.js';
import { esc } from '../../ui/dom.js';
import { fmt, yuan } from '../../xhs/format.js';
import { operatingInsights, reachCheck, REGION_METRICS, SHOOT_REGIONS } from '../../xhs/operating-insights.js';

const label = (key) => esc(t('oi.' + key));
const line = (key, vars) => '<p class="mt-1 text-[13px] leading-relaxed">' + esc(t('oi.' + key, vars)) + '</p>';
const note = (key, vars) => '<p class="mt-1 text-[12px] leading-relaxed text-muted">' + esc(t('oi.' + key, vars)) + '</p>';
const section = (key, content) => '<div class="mt-3 border-t border-line pt-3 min-w-0"><h4 class="text-[14px] font-semibold">' + label(key) + '</h4>' + content + '</div>';
const dec = (num) => num.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function regionOptions(selected) {
  return ['', ...SHOOT_REGIONS].map((region) =>
    '<option value="' + region + '"' + (region === selected ? ' selected' : '') + '>' + label('region.' + (region || 'unset')) + '</option>').join('');
}

function regionBlock({ regions, untagged, min }) {
  const { cn, kr } = regions;
  const counts = note('regionCounts', { cn: cn.n, kr: kr.n, missing: untagged });
  if (cn.n < min || kr.n < min) return counts + line('regionNeed') + note('regionHow');
  const both = (k) => cn.metrics[k].n >= min && kr.metrics[k].n >= min;
  const coverGap = both('ctr') && kr.metrics.ctr.value < cn.metrics.ctr.value * 0.9;
  const engagement = both('interactionRate') && kr.metrics.interactionRate.value > cn.metrics.interactionRate.value;
  const action = coverGap && engagement ? line('regionCover') : '';
  const rows = REGION_METRICS.map((k) => {
    const a = cn.metrics[k];
    const b = kr.metrics[k];
    const show = (s) => s.n >= min ? fmt(k, s.value) + ' (' + t('xp.n', { n: s.n }) + ')' + (s.n < 3 ? ' · ' + t('ops.ref') : '') : '–';
    return '<tr><th scope="row" class="py-1 pr-2 text-left font-normal">' + esc(t('m.' + k)) + '</th><td class="py-1 pr-2">' + esc(show(a)) + '</td><td class="py-1">' + esc(show(b)) + '</td></tr>';
  }).join('');
  return counts + '<table class="mt-2 w-full text-[12px] tabular-nums"><thead><tr><th scope="col" class="text-left">' + esc(t('crit.metric')) + '</th><th scope="col" class="text-left">' + label('region.cn') + '</th><th scope="col" class="text-left">' + label('region.kr') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' + action + note('regionLimits') + (untagged ? note('regionHow') : '');
}

const showShare = (value) => fmt('ctr', value) || '–';
const showWatch = (value) => fmt('avgWatch', value) || '–';
function channelBlock({ channels, latestChannel, min }) {
  const { share, watch, reaction } = channels;
  const summary = [
    [share, 'share', showShare],
    [watch, 'watch', showWatch],
    [reaction, 'reaction', showShare],
  ].map(([sample, key, format]) => sample.n >= min ? line(key, { n: sample.n, home: format(sample.home), video: format(sample.video) }) + (sample.n < 3 ? note('channelSmall') : '') : note(key + 'Need', { n: sample.n })).join('');
  if (!latestChannel) return summary + line('channelMore');
  const { post, home, video } = latestChannel;
  const count = (key) => {
    if (![home[key], video[key]].some(Number.isFinite)) return '';
    return note('channelCount', { name: t('m.' + key), home: fmt(key, home[key]) || '–', video: fmt(key, video[key]) || '–' });
  };
  const latest = '<p class="mt-2 text-[13px]"><a class="link-btn" href="#/c/' + encodeURIComponent(post.id) + '">' + esc(post.title || t('xg.untitled')) + '</a></p>'
    + line('channelLatest', { home: showShare(home.share), video: showShare(video.share), ctr: showShare(home.ctr), homeWatch: showWatch(home.watch), videoWatch: showWatch(video.watch) })
    + count('exposure') + count('views');
  const practices = video.share > home.share ? line('tryVideo') + line('tryHome') : line('tryHome') + line('tryVideo');
  return summary + latest + practices + note('channelLimits');
}

function reachContent(check) {
  if (!check) return line('reachNeed');
  const { status, values, base } = check;
  if (!values) return line('reach.' + status);
  const rows = ['views', 'exposure', 'ctr'].map((k) => t('oi.reachMetric', { name: t('m.' + k), now: fmt(k, values[k]), base: fmt(k, base[k]) }));
  return note('reachFacts', { metrics: rows.join(' · ') }) + line('reach.' + status)
    + (check.openingWeak && ['distribution', 'both', 'cover'].includes(status) ? note('earlyAlso') : '')
    + note('reachLimits');
}

export function postReachHtml(post, baseline) {
  return '<div id="reach-insight" class="mt-2 rounded-[12px] border border-line p-3"><h3 class="text-[14px] font-semibold">' + label('reachTitle') + '</h3>' + reachContent(reachCheck(post, baseline)) + '</div>';
}

function adsBlock({ ads, min }) {
  const { follow, likeFav, early, late } = ads;
  let result = follow.n >= min && Number.isFinite(follow.cost)
    ? line('adCost', { cost: yuan(follow.cost), n: follow.n })
    : line('adNeed');
  if (follow.n >= min && likeFav.n >= min) result += line('adGoals', { f: dec(follow.per100), l: dec(likeFav.per100), nf: follow.n, nl: likeFav.n });
  if ([early, late].every((group) => group.n >= min && Number.isFinite(group.cost))) {
    result += line('adTiming', { early: yuan(early.cost), late: yuan(late.cost), ne: early.n, nl: late.n });
  }
  return result + line('adSteps') + note('adLimits');
}

export function operatingInsightsHtml(posts, baseline) {
  const data = operatingInsights(posts, baseline);
  const latest = data.latest;
  const link = latest ? '<p class="mt-1 text-[13px]"><a class="link-btn" href="#/c/' + encodeURIComponent(latest.post.id) + '">' + esc(latest.post.title || t('xg.untitled')) + '</a></p>' : '';
  return '<div id="operating-insights" class="mt-3"><h4 class="text-[15px] font-semibold">' + label('title') + '</h4>'
    + section('regionTitle', regionBlock(data))
    + section('channelTitle', channelBlock(data))
    + section('reachTitle', link + reachContent(latest))
    + section('adTitle', adsBlock(data)) + '</div>';
}
