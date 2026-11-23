import { adInWindow, adOrders, goalType } from './ad-report.js';
import { METRIC } from './metrics.js';
import { isValid, median, ordered, relDiff, stage } from './stats.js';
import { stageDay } from './store.js';

export const SHOOT_REGIONS = ['cn', 'kr', 'other'];
export const REGION_METRICS = ['exposure', 'views', 'ctr', 'retain5s', 'interactionRate'];
const FEED_KEYS = ['home', 'videoRec'];
const MIN = 2;
const numeric = Number.isFinite;

function organicD1(post) {
  if (!isValid(post) || adInWindow(post).any) return false;
  return !(post.ads ?? []).some((ad) => ad.executed !== false && !ad.start && !ad.stage);
}

const pct = (x) => numeric(x) && x >= 0 && x <= 1 ? x : null;
const metric = (d, key) => METRIC[key].kind === 'pct' ? pct(d[key]) : numeric(d[key]) && d[key] >= 0 ? d[key] : null;

function channelPair(post) {
  const meta = post.d1Meta;
  if (!meta) return null;
  const [home, video] = FEED_KEYS.map((key) => {
    const ch = meta.channels?.[key];
    return {
      share: pct(ch?.shareViews ?? meta.sources?.[key]),
      exposure: metric(ch ?? {}, 'exposure'),
      views: metric(ch ?? {}, 'views'),
      watch: numeric(ch?.avgWatch) && ch.avgWatch >= 0 ? ch.avgWatch : null,
      ctr: pct(ch?.conv),
      reaction: pct(ch?.interactionRate),
    };
  });
  return { home, video };
}

const sample = (posts, read) => {
  const xs = posts.map(read).filter(numeric);
  return { n: xs.length, value: median(xs) };
};

const pairSample = (pairs, field) => {
  const valid = pairs.filter(({ home, video }) => numeric(home[field]) && numeric(video[field]));
  return { n: valid.length, home: median(valid.map((x) => x.home[field])), video: median(valid.map((x) => x.video[field])) };
};

/** Classify the observed gap with exposure and conversion measured in the same D+1 window. */
export function reachCheck(post, baseline) {
  if (!organicD1(post)) return { status: 'mixed' };
  const d = stage(post);
  const values = Object.fromEntries(['views', 'exposure', 'ctr', 'retain5s', 'exit2s'].map((k) => [k, metric(d, k)]));
  const base = baseline?.medians;
  const rel = (k) => relDiff(values[k], metric(base ?? {}, k), METRIC[k].dir);
  const viewDiff = rel('views');
  const exposureDiff = rel('exposure');
  const ctrDiff = rel('ctr');
  if (![viewDiff, exposureDiff, ctrDiff].every(numeric)) return { status: 'missing' };
  const weak = (k, value) => value < -METRIC[k].band;
  const lowReach = weak('exposure', exposureDiff);
  const lowCtr = weak('ctr', ctrDiff);
  const openingWeak = ['retain5s', 'exit2s'].some((k) => {
    const delta = rel(k);
    return numeric(delta) && weak(k, delta);
  });
  const lowViews = weak('views', viewDiff);
  const status = lowReach && lowCtr ? 'both' : lowReach ? 'distribution' : lowCtr ? 'cover' : openingWeak ? 'opening' : lowViews ? 'unclear' : 'steady';
  return { status, values, base, openingWeak };
}

export function operatingInsights(posts, baseline) {
  const valid = ordered(posts).filter(organicD1).filter((p) => numeric(stage(p).views));
  const regions = Object.fromEntries(['cn', 'kr'].map((region) => {
    const group = valid.filter((p) => p.shootRegion === region);
    return [region, { n: group.length, metrics: Object.fromEntries(REGION_METRICS.map((key) => [key, sample(group, (p) => metric(stage(p), key))])) }];
  }));

  const pairs = valid.map(channelPair).filter(Boolean);
  const channels = Object.fromEntries(['share', 'watch', 'reaction'].map((field) => [field, pairSample(pairs, field)]));
  const latestChannel = valid.slice().reverse().find((p) => {
    const pair = channelPair(p);
    return numeric(pair?.home.share) && numeric(pair?.video.share);
  });
  const latest = valid.at(-1);
  const check = latest ? reachCheck(latest, baseline) : null;
  const orders = adOrders(posts).filter((o) => !o.ad.pending && numeric(o.spend) && o.spend > 0 && numeric(o.metrics.follows) && o.metrics.follows >= 0);
  const summarise = (group) => {
    const spend = group.reduce((total, o) => total + o.spend, 0);
    const followers = group.reduce((total, o) => total + o.metrics.follows, 0);
    return { n: group.length, per100: spend > 0 ? 100 * followers / spend : null, cost: followers > 0 ? spend / followers : null };
  };
  const follow = orders.filter((o) => goalType(o.goal) === 'follow');
  const timing = follow.filter((o) => !o.multi && !o.ad.groupKey && !o.ad.outsideNotes && stageDay(o.stages[0]) != null);
  const early = timing.filter((o) => stageDay(o.stages[0]) <= 1);
  const late = timing.filter((o) => stageDay(o.stages[0]) >= 2);
  return {
    regions,
    untagged: valid.filter((p) => !p.shootRegion).length,
    channels,
    latestChannel: latestChannel ? { post: latestChannel, ...channelPair(latestChannel) } : null,
    latest: latest ? { post: latest, ...check } : null,
    ads: { follow: summarise(follow), likeFav: summarise(orders.filter((o) => goalType(o.goal) === 'likeFav')), early: summarise(early), late: summarise(late) },
    min: MIN,
  };
}
