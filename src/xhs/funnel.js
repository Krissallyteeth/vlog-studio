import { adInWindow } from './ad-report.js';
import { editingPlan } from './feedback.js';
import { METRIC } from './metrics.js';
import { median, relDiff, stage } from './stats.js';

/*
 * Funnel card for one post: 노출 → 클릭 → 시청(오프닝) → 시청(중후반) → 반응 → 팔로우.
 *
 * Each step is judged against my own reference posts at the same stage (D+1 with D+1, D+2 with
 * D+2) using the colour bands of the original sheet (counts ±20 %, rates ±10 %). The steps are
 * separate indicators, not one group of viewers moving down a funnel: search views, for example,
 * do not all pass through a cover click. The first weak steps from the top (at most two) are the
 * places to check first; steps below a weak one are shown "for reference". Nothing here claims a
 * cause. Missing values stay missing, never 0.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ratio = (a, b) => (isNum(a) && isNum(b) && b > 0 ? a / b : null);

/** Per-view rates this card adds to the stored metrics. */
export const RATES = {
  saveRate: (s) => ratio(s.favorites, s.views),
  shareRate: (s) => ratio(s.shares, s.views),
  followRate: (s) => ratio(s.newFollowers, s.views),
};
const BAND = { saveRate: 0.1, shareRate: 0.1, followRate: 0.1 };
const bandOf = (k) => METRIC[k]?.band ?? BAND[k];
const dirOf = (k) => METRIC[k]?.dir ?? 1;

export const STEPS = [
  { key: 'traffic', metrics: ['exposure'] },
  { key: 'click', metrics: ['ctr'] },
  { key: 'opening', metrics: ['exit2s', 'retain5s'] },
  { key: 'depth', metrics: ['avgWatchRatio', 'completion'] },
  { key: 'engage', metrics: ['interactionRate', 'saveRate', 'shareRate'] },
  { key: 'follow', metrics: ['followRate'] },
];
export const MAX_CHECKS = 2;

/** All values of a post at a stage, including the per-view rates. */
export function funnelValues(post, which = 'd1') {
  const s = stage(post, which);
  const out = { ...s };
  for (const [k, fn] of Object.entries(RATES)) out[k] = fn(s);
  return out;
}

/**
 * Reference medians at the same stage. D+1 uses the fixed baseline's stored medians (as every other
 * screen does) plus the rates from the same baseline posts; D+2 uses the baseline posts' D+2 values.
 */
export function funnelReference(posts, baseline, which = 'd1') {
  if (!baseline) return null;
  const ids = new Set(baseline.postIds ?? []);
  const group = posts.filter((p) => ids.has(p.id));
  const vals = (k) => group.map((p) => funnelValues(p, which)[k]).filter(isNum);
  const medians = {};
  const counts = {};
  for (const step of STEPS) {
    for (const k of step.metrics) {
      const list = vals(k);
      counts[k] = list.length;
      medians[k] = which === 'd1' && isNum(baseline.medians?.[k]) ? baseline.medians[k] : median(list);
    }
  }
  return { which, medians, counts, version: baseline.version };
}

function metricState(k, value, base) {
  const rel = relDiff(value, base, dirOf(k));
  if (!isNum(rel)) return { key: k, value: isNum(value) ? value : null, base: isNum(base) ? base : null, rel: null, state: 'missing' };
  const band = bandOf(k);
  return { key: k, value, base, rel, state: rel < -band ? 'weak' : rel > band ? 'good' : 'ok' };
}

function stepState(metrics) {
  const known = metrics.filter((m) => m.state !== 'missing');
  if (!known.length) return 'missing';
  if (known.some((m) => m.state === 'weak')) return 'weak';
  if (known.some((m) => m.state === 'good')) return 'good';
  return 'ok';
}

/** The checks for a weak step, reusing the editing actions of the existing feedback. */
function checksFor(step, post) {
  if (step.key === 'traffic') return { actions: ['traffic'], check: 'traffic' };
  if (step.key === 'follow') return { actions: ['follow'], check: 'follow' };
  if (step.key === 'opening') return editingPlan('retain5s', post);
  if (step.key === 'click') return editingPlan('ctr', post);
  if (step.key === 'engage') return editingPlan('interactionRate', post);
  const weak = step.metrics.find((m) => m.state === 'weak');
  return editingPlan(weak?.key === 'completion' ? 'completion' : 'avgWatchRatio', post);
}

/**
 * The funnel of one post at one stage.
 * status: 'baseline' (no reference) | 'metrics' (no values) | 'mixed' (ads in the window or not a
 * valid record: shown, not judged) | 'checks' | 'steady' | 'partial'.
 */
export function postFunnel(post, posts, baseline, which = 'd1') {
  const ref = funnelReference(posts, baseline, which);
  const values = funnelValues(post, which);
  const hasValues = STEPS.some((s) => s.metrics.some((k) => isNum(values[k])));
  const ads = adInWindow(post, which);
  const mixed = post.validity !== '유효' || ads.any;
  const steps = STEPS.map((s) => {
    const metrics = s.metrics.map((k) => metricState(k, values[k], ref?.medians?.[k]));
    return { key: s.key, metrics, state: stepState(metrics) };
  });
  // Search viewers can open a note without the cover click: say how many came that way.
  const meta = post[`${which}Meta`];
  const searchShare = isNum(meta?.sources?.search) ? meta.sources.search : null;
  const base = { which, steps, ref, values, mixed, ads, searchShare, checks: [], missing: [] };
  if (!ref) return { ...base, status: 'baseline' };
  if (!hasValues) return { ...base, status: 'metrics' };
  if (mixed) {
    for (const s of steps) s.reference = true;
    return { ...base, status: 'mixed' };
  }

  const checks = [];
  let firstWeak = -1;
  steps.forEach((s, i) => {
    if (s.state !== 'weak') return;
    if (firstWeak < 0) firstWeak = i;
    if (checks.length < MAX_CHECKS) checks.push({ step: s.key, evidence: 'metric', metrics: s.metrics.filter((m) => m.state === 'weak'), ...checksFor(s, post) });
  });
  steps.forEach((s, i) => {
    s.bottleneck = checks.some((c) => c.step === s.key);
    // Below the first weak step the sample of viewers is already smaller: read it for reference only.
    s.reference = firstWeak >= 0 && i > firstWeak && !s.bottleneck;
  });
  // A recorded opening segment that lost most viewers locates a check even when the averages look fine.
  const seg = meta?.segments?.find((x) => x.from === '00:00' && isNum(x.loss) && x.loss >= 0.5);
  if (seg && !checks.some((c) => c.step === 'opening') && checks.length < MAX_CHECKS) {
    checks.push({ step: 'opening', evidence: 'segment', loss: seg.loss, to: seg.to, ...editingPlan('retain5s', post) });
  }
  const missing = steps.filter((s) => s.state === 'missing').map((s) => s.key);
  return { ...base, checks, missing, status: checks.length ? 'checks' : missing.length ? 'partial' : 'steady' };
}
