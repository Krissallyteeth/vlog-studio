/*
 * One "결론" per dashboard card: the bottom line of what the card lists, as { key, vars } items
 * to be worded by i18n. Pure and rule-based; the same numbers the cards show.
 */

const MIN = 2;

/** Ad advice card: is the advice worth following, and what to do with the posts waiting now. */
export function adConclusion(rec) {
  const out = [];
  const { followed, against } = rec;
  const nFollowed = followed.measured ?? followed.n;
  const nAgainst = against.measured ?? against.n;
  if (nFollowed >= MIN && nAgainst >= MIN && followed.cost != null && against.cost != null) {
    // Few cases, or both sides dearer than usual (prices rising): said with that caveat.
    if (followed.cost <= against.cost * 0.9) out.push({ key: 'followWins', vars: { a: followed.cost, b: against.cost }, ref: Math.min(nFollowed, nAgainst) < 3, dear: followed.good < nFollowed / 2 });
    else if (against.cost <= followed.cost * 0.9) out.push({ key: 'ruleWeak', vars: { a: followed.cost, b: against.cost } });
    else out.push({ key: 'noDiff', vars: { a: followed.cost, b: against.cost } });
  } else if (nAgainst >= 3 && against.good <= nAgainst / 3) {
    // Not enough followed advice to compare, but running against it has mostly cost more.
    out.push({ key: 'againstCostly', vars: { n: nAgainst, bad: nAgainst - against.good } });
  }
  if (nFollowed < MIN) out.push({ key: 'fewFollowed', vars: { n: nFollowed } });
  const pend = rec.pending.slice(-3);
  for (const r of pend) {
    const a = r.tl.d2 ?? r.tl.d1;
    if (!a) continue;
    if (a.verdict === 'skip') out.push({ key: 'nowSkip', vars: { title: r.post.title } });
    else if (a.verdict === 'go') out.push({ key: 'nowGo', vars: { title: r.post.title, cost: a.expect?.cost ?? null } });
    else if (a.verdict === 'hold') out.push({ key: 'nowHold', vars: { title: r.post.title } });
  }
  return out;
}

const RANK = { win: 0, mixed: 1, same: 2, need: 3 };

/** Experiment card: per experiment item, the strongest thing that can be said. */
export function expConclusion(expRes, experiments = []) {
  const byId = new Map();
  for (const r of expRes) {
    const v = r.verdict;
    let item;
    if (!v) {
      const short = r.groups.filter((g) => g.n < MIN).map((g) => ({ opt: g.opt, need: MIN - g.n }));
      item = { kind: 'need', vars: { name: r.name, short } };
    } else if (v.clear && !v.mixed && !v.ref) item = { kind: 'win', metric: r.metric, vars: { name: r.name, best: v.best, worst: v.worst, pct: Math.round(v.rel * 100) } };
    else if (v.clear) item = { kind: 'mixed', metric: r.metric, vars: { name: r.name, best: v.best, pct: Math.round(v.rel * 100), why: v.mixed ? 'mixed' : 'ref' } };
    else item = { kind: 'same', metric: r.metric, vars: { name: r.name } };
    const cur = byId.get(r.id);
    if (!cur || RANK[item.kind] < RANK[cur.kind]) byId.set(r.id, item);
  }
  for (const [id] of byId) {
    const winners = new Set(expRes.filter((r) => r.id === id && r.verdict?.clear).map((r) => r.verdict.best));
    if (winners.size > 1) byId.set(id, { kind: 'mixed', vars: { name: expRes.find((r) => r.id === id).name, why: 'conflict' } });
  }
  const order = (experiments ?? []).map((e) => e.id);
  return [...byId.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([, x]) => x);
}

/** Ops brief: the one or two things to do first, taken from the brief's own items. */
export function opsConclusion(brief) {
  const out = [];
  const weak = brief.find((x) => /^weak\./.test(x.key));
  if (weak) out.push({ key: 'fix', metric: weak.metric });
  const vr = brief.find((x) => x.key === 'ch.mixVr');
  if (vr) out.push({ key: 'vr' });
  const cut = brief.find((x) => x.key === 'adOnlyStrong');
  const goal = brief.find((x) => x.key === 'adGoal');
  if (cut || goal) out.push({ key: cut && goal ? 'adBoth' : cut ? 'adCut' : 'adGoal', vars: { cut: cut?.vars.cut } });
  if (!weak && brief.some((x) => x.key === 'recentUp')) out.push({ key: 'keep' });
  if (brief.some((x) => x.key === 'gap')) out.push({ key: 'post' });
  return out.slice(0, 3);
}
