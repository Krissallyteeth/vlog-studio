import { estimateAccuracy, followOrders } from './ad-sim.js';
import { postFunnel, funnelValues } from './funnel.js';
import { METRIC } from './metrics.js';
import { isValid, median, ordered } from './stats.js';
import { applies } from './learn-apply.js';

export { applies, calibrate, recentMedian } from './learn-apply.js';

/*
 * Learning from my own records: suggestion → what happened → small, visible adjustment.
 *
 * Nothing is stored or sent anywhere: every model is recomputed from the records, so it moves as
 * data grows and goes back the moment the data or the switch says so. Each area needs a minimum
 * number of cases ("learning n/need") before it changes anything, pulls only part of the way
 * towards my data while cases are few (shrinkage), and can be locked to the original rules.
 * Observations, not causes.
 *
 *  - funnel: which funnel step goes together most with the follow rate on my account
 *            (rank correlation over valid D+1 posts) → order of the funnel checks.
 *  - edit:   after a check was suggested on a post, did the next post's same step get better?
 *            → shown next to each check; checks that rarely helped go last.
 *  - ads:    how far actual results run from the platform's estimates (actual ÷ middle of the
 *            estimate) → an adjusted estimate; recent orders count more in the simulator.
 */

export const AREAS = ['funnel', 'edit', 'ads'];
export const NEED = { funnel: 8, edit: 3, ads: 3 };
const SHRINK = { funnel: 10 }; // weight of my data = n / (n + SHRINK)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The metric that stands for each funnel step (the follow step is the outcome itself). */
export const STEP_METRIC = { traffic: 'exposure', click: 'ctr', opening: 'retain5s', depth: 'avgWatchRatio', engage: 'interactionRate' };

function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
/** Spearman rank correlation, null with fewer than 3 pairs or no spread. */
export function spearman(pairs) {
  if (pairs.length < 3) return null;
  const a = ranks(pairs.map((p) => p[0]));
  const b = ranks(pairs.map((p) => p[1]));
  const n = pairs.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export function learnFunnel(posts) {
  const valid = ordered(posts).filter((p) => isValid(p) && !(p.ads ?? []).some((a) => a.executed !== false && /^(D|D\+1)$/.test(a.stage)));
  const rows = valid.map((p) => funnelValues(p, 'd1')).filter((v) => isNum(v.followRate));
  const steps = Object.entries(STEP_METRIC).map(([step, key]) => {
    const dir = METRIC[key]?.dir ?? 1;
    const pairs = rows.filter((v) => isNum(v[key])).map((v) => [dir * v[key], v.followRate]);
    const rho = spearman(pairs);
    const n = pairs.length;
    // Pulled towards 0 ("no difference between steps") while cases are few.
    const weight = isNum(rho) ? (n / (n + SHRINK.funnel)) * rho : null;
    return { step, key, n, rho, weight };
  });
  const n = Math.min(...steps.map((s) => s.n));
  const order = steps.filter((s) => isNum(s.weight)).sort((a, b) => b.weight - a.weight).map((s) => s.step);
  return { area: 'funnel', n: rows.length, need: NEED.funnel, status: rows.length >= NEED.funnel && n >= NEED.funnel ? 'active' : 'learning', steps, order };
}

/** After each funnel check (base rules, D+1), the next valid post's same step: better or not. */
export function learnEdit(posts, baseline) {
  const list = ordered(posts).filter(isValid);
  const steps = {};
  if (baseline) {
    list.forEach((p, i) => {
      const f = postFunnel(p, posts, baseline, 'd1');
      for (const c of f.checks ?? []) {
        const key = STEP_METRIC[c.step] ?? (c.step === 'follow' ? 'followRate' : null);
        if (!key) continue;
        const now = funnelValues(p, 'd1')[key];
        const next = list.slice(i + 1).find((q) => isNum(funnelValues(q, 'd1')[key]));
        if (!isNum(now) || !next) continue;
        const dir = METRIC[key]?.dir ?? 1;
        const s = (steps[c.step] ??= { n: 0, improved: 0 });
        s.n += 1;
        if (dir * funnelValues(next, 'd1')[key] > dir * now) s.improved += 1;
      }
    });
  }
  for (const s of Object.values(steps)) s.verdict = s.n < NEED.edit ? 'few' : s.improved / s.n >= 2 / 3 ? 'helps' : s.improved / s.n <= 1 / 3 ? 'unclear' : 'mixed';
  const n = Object.values(steps).reduce((a, s) => a + s.n, 0);
  return { area: 'edit', n, need: NEED.edit, status: Object.values(steps).some((s) => s.n >= NEED.edit) ? 'active' : 'learning', steps };
}

export function learnAds(posts) {
  const acc = estimateAccuracy(posts);
  const ratios = acc.rows.map((r) => r.platform?.ratio).filter(isNum);
  const orders = followOrders(posts).length;
  return {
    area: 'ads',
    n: ratios.length,
    need: NEED.ads,
    status: ratios.length >= NEED.ads ? 'active' : 'learning',
    ratio: ratios.length ? Math.round(median(ratios) * 100) / 100 : null,
    orders,
    recency: orders >= NEED.ads,
  };
}

/** Everything learned, with the user's locks ({ locked: { funnel: true } }). */
export function learnModel(posts, baseline, state = {}) {
  const locked = state?.locked ?? {};
  const m = { funnel: learnFunnel(posts), edit: learnEdit(posts, baseline), ads: learnAds(posts), locked };
  for (const a of AREAS) m[a].locked = locked[a] === true;
  return m;
}

/** Short facts per area, compared between visits to say what changed. */
export function signature(model) {
  return {
    funnel: model.funnel.status === 'active' ? model.funnel.order.join('>') : '',
    edit: Object.entries(model.edit.steps).filter(([, s]) => s.verdict !== 'few').map(([k, s]) => `${k}:${s.verdict}`).sort().join(','),
    ads: model.ads.status === 'active' ? String(Math.round(model.ads.ratio * 10) / 10) : '',
  };
}
