import { adviceRecord } from './ad-advice.js';
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
 *  - advice: for each signal of the D+1/D+2 ad advice (views, click rate, growth, cost on similar
 *            posts), how often its direction matched the ad's result (good / bad cost per
 *            follower) → a weight on that signal (1 = original, 0.25–1.75).
 *  - factors: type, shooting region, posting time, weekday, sponsorship and my experiments —
 *            which ones go with the biggest differences in views and follow rate (medians,
 *            groups of 3+ posts) → shown as what to plan around.
 */

export const AREAS = ['funnel', 'edit', 'ads', 'advice', 'factors'];
export const NEED = { funnel: 8, edit: 3, ads: 3, advice: 5, factors: 10 };
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
export function learnModel(posts, baseline, state = {}, { experiments = [] } = {}) {
  const locked = state?.locked ?? {};
  const m = { funnel: learnFunnel(posts), edit: learnEdit(posts, baseline), ads: learnAds(posts), advice: learnAdvice(posts, baseline), factors: learnFactors(posts, { experiments }), locked };
  for (const a of AREAS) m[a].locked = locked[a] === true;
  return m;
}

/** Short facts per area, compared between visits to say what changed. */
export function signature(model) {
  return {
    funnel: model.funnel.status === 'active' ? model.funnel.order.join('>') : '',
    edit: Object.entries(model.edit.steps).filter(([, s]) => s.verdict !== 'few').map(([k, s]) => `${k}:${s.verdict}`).sort().join(','),
    ads: model.ads.status === 'active' ? String(Math.round(model.ads.ratio * 10) / 10) : '',
    advice: model.advice.status === 'active' ? Object.entries(model.advice.weights).sort().map(([k, v]) => `${k}:${Math.round(v * 4) / 4}`).join(',') : '',
    factors: model.factors.status === 'active' ? model.factors.results.slice(0, 2).map((r) => `${r.factor}/${r.outcome}/${r.best.level}`).join(',') : '',
  };
}

/* ── advice ─────────────────────────────────────────────────────────────────────────────── */
const SIGNAL = { viewsHigh: ['views', 1], viewsLow: ['views', -1], ctrWeak: ['ctr', -1], growing: ['growth', 1], stalling: ['growth', -1] };
const ADVICE_SHRINK = 5;

/** The direction each reason of an advice pointed: [signal, +1 | -1], or null. */
export function reasonSignal(reason) {
  if (SIGNAL[reason.key]) return SIGNAL[reason.key];
  if (reason.key === 'expect' && isNum(reason.vars?.cost) && isNum(reason.vars?.all)) {
    if (reason.vars.cost <= reason.vars.all * 0.9) return ['cost', 1];
    if (reason.vars.cost >= reason.vars.all * 1.3) return ['cost', -1];
  }
  return null;
}

export function learnAdvice(posts, baseline) {
  const rows = adviceRecord(posts, baseline).rows.filter((r) => r.tl.advice && ['good', 'bad'].includes(r.tl.final.outcome));
  const signals = {};
  for (const r of rows) {
    for (const reason of r.tl.advice.reasons ?? []) {
      const sig = reasonSignal(reason);
      if (!sig) continue;
      const [name, dir] = sig;
      const x = (signals[name] ??= { n: 0, right: 0 });
      x.n += 1;
      if ((dir > 0) === (r.tl.final.outcome === 'good')) x.right += 1;
    }
  }
  const weights = {};
  for (const [name, x] of Object.entries(signals)) {
    const acc = x.right / x.n;
    x.weight = Math.round(Math.min(1.75, Math.max(0.25, 1 + (x.n / (x.n + ADVICE_SHRINK)) * (2 * acc - 1))) * 100) / 100;
    weights[name] = x.weight;
  }
  return { area: 'advice', n: rows.length, need: NEED.advice, status: rows.length >= NEED.advice ? 'active' : 'learning', signals, weights };
}

/* ── factors ────────────────────────────────────────────────────────────────────────────── */
export const FACTOR_MIN = 3; // posts per group
const FACTOR_SHRINK = 10;

/** Posting time of day from "HH:MM". */
export const timeSlot = (time) => {
  const h = /^(\d{2}):/.exec(time ?? '')?.[1];
  if (h == null) return null;
  const n = Number(h);
  return n >= 6 && n < 11 ? 'morning' : n >= 11 && n < 17 ? 'day' : n >= 17 && n < 21 ? 'evening' : 'night';
};
const weekdayOf = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? new Date(`${date}T12:00:00Z`).getUTCDay() : null);

export function learnFactors(posts, { experiments = [] } = {}) {
  const valid = ordered(posts).filter((p) => isValid(p) && isNum(funnelValues(p, 'd1').views));
  const factors = [
    { key: 'type', of: (p) => p.contentType || null },
    { key: 'region', of: (p) => p.shootRegion || null },
    { key: 'time', of: (p) => timeSlot(p.time) },
    { key: 'weekday', of: (p) => weekdayOf(p.date) },
    { key: 'sponsored', of: (p) => (p.sponsored ? 'yes' : 'no') },
    ...experiments.map((ex) => ({ key: `exp:${ex.id}`, name: ex.name, of: (p) => p.experiments?.[ex.id] || null })),
  ];
  const results = [];
  for (const f of factors) {
    for (const outcome of ['followRate', 'views']) {
      const groups = new Map();
      for (const p of valid) {
        const level = f.of(p);
        const v = funnelValues(p, 'd1')[outcome];
        if (level == null || !isNum(v)) continue;
        if (!groups.has(level)) groups.set(level, []);
        groups.get(level).push(v);
      }
      const big = [...groups].filter(([, xs]) => xs.length >= FACTOR_MIN).map(([level, xs]) => ({ level, n: xs.length, median: median(xs) }));
      if (big.length < 2) continue;
      big.sort((a, b) => b.median - a.median);
      const all = median(big.flatMap((g) => groups.get(g.level)));
      if (!isNum(all) || all <= 0) continue;
      const used = big.reduce((a, g) => a + g.n, 0);
      const effect = (big[0].median - big.at(-1).median) / all;
      results.push({ factor: f.key, name: f.name ?? null, outcome, best: big[0], worst: big.at(-1), groups: big, effect, score: (used / (used + FACTOR_SHRINK)) * effect });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return { area: 'factors', n: valid.length, need: NEED.factors, status: valid.length >= NEED.factors && results.length ? 'active' : 'learning', results };
}
