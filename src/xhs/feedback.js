import { adInWindow } from './ad-report.js';
import { METRIC } from './metrics.js';
import { relDiff, stage } from './stats.js';

// A metric identifies a place to inspect, not a proven cause or a guaranteed remedy.
export const FEEDBACK_METRICS = ['ctr', 'exit2s', 'retain5s', 'avgWatchRatio', 'completion', 'interactionRate'];
const numeric = (v) => typeof v === 'number' && Number.isFinite(v);
const groupOf = (metric) => ['exit2s', 'retain5s'].includes(metric) ? 'opening' : metric;

export function editingPlan(metric, post) {
  const group = groupOf(metric);
  if (group === 'opening') {
    const intro = post?.experiments?.intro;
    const kind = intro === '있음' ? 'introPresent' : intro === '없음' ? 'introAbsent' : 'introUnknown';
    return { actions: [kind, 'opening'], check: 'opening' };
  }
  return { actions: [group], check: group };
}

export function postFeedback(post, baseline) {
  const d = stage(post);
  const comparisons = FEEDBACK_METRICS.map((metric) => ({ metric, value: d[metric], base: baseline?.medians?.[metric], rel: relDiff(d[metric], baseline?.medians?.[metric], METRIC[metric].dir) }));
  const ready = comparisons.filter((r) => numeric(r.rel));
  if (post.validity !== '유효' || adInWindow(post, 'd1').any) return { status: 'validity', cards: [], missing: [] };
  if (!baseline) return { status: 'baseline', cards: [], missing: [] };
  if (!ready.length) return { status: 'metrics', cards: [], missing: FEEDBACK_METRICS };
  const cards = [];
  const seen = new Set();
  for (const row of ready) {
    if (row.rel >= -METRIC[row.metric].band || seen.has(groupOf(row.metric))) continue;
    seen.add(groupOf(row.metric));
    cards.push({ ...row, ...editingPlan(row.metric, post), evidence: 'metric' });
    if (cards.length === 2) break;
  }
  // A recorded segment can locate a check even when its aggregate metric is not weak.
  const opening = post.d1Meta?.segments?.find((s) => s.from === '00:00' && numeric(s.loss) && s.loss >= 0.5);
  if (opening && !seen.has('opening') && cards.length < 2) cards.push({ metric: 'retain5s', evidence: 'segment', loss: opening.loss, to: opening.to, ...editingPlan('retain5s', post) });
  const missing = comparisons.filter((r) => !numeric(r.rel)).map((r) => r.metric);
  return { status: cards.length ? 'checks' : missing.length ? 'partial' : 'steady', cards, missing };
}
