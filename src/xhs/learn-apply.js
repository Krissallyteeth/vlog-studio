/*
 * How a learned model is used by the screens (no imports, so funnel.js and ad-sim.js can use it
 * without a circular import). The model itself is built in learning.js.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** True when an area may change what the app says. */
export const applies = (model, area) => !!model && model[area]?.status === 'active' && !model[area]?.locked;

/** Estimate range adjusted by how my results usually ran against the platform (null when not learned). */
export function calibrate(model, range) {
  if (!applies(model, 'ads') || !isNum(model.ads.ratio) || !Array.isArray(range)) return null;
  return [Math.round(range[0] * model.ads.ratio), Math.round(range[1] * model.ads.ratio)];
}

/** Weighted median: recent items count more (half the weight every `half` items back). */
export function recentMedian(values, half = 5) {
  const list = values.filter(isNum);
  if (!list.length) return null;
  const w = list.map((_, i) => 0.5 ** ((list.length - 1 - i) / half)); // values in time order: last = newest
  const pairs = list.map((v, i) => [v, w[i]]).sort((a, b) => a[0] - b[0]);
  const total = w.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const [v, wt] of pairs) {
    acc += wt;
    if (acc >= total / 2) return v;
  }
  return pairs.at(-1)[0];
}
