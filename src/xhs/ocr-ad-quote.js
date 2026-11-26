/*
 * 薯条 purchase screen (before paying): what the platform says an order would bring.
 *
 * Read from the screen, as OCR lines (spaces between Chinese characters are ignored):
 *  - 预计提升转化数 7-31          the estimate for the chosen amount (the sticky bar, on every screen)
 *  - 预计提升粉丝关注量 / 7 ~ 31 / (含赠0~3) / ¥80 ¥90   one card per amount (price, list price)
 *  - 实付现金 60 · 推广总金额 60元 · 总计 60元             real money paid
 *  - 已赠5元流量 · 满60赠5元流量                        bonus traffic (credit, 元)
 *  - 推广多久 24小时                                   duration
 * Every value is checked against the others where it can be; a value that is not on the screen
 * stays null. "¥" is often read as "Y".
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const flat = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[～〜]/g, '~').replace(/[－—–]/g, '-');

export const QUOTE_GOALS = { 粉丝关注量: '关注', 点赞收藏量: '点赞收藏量', 笔记阅读量: '阅读', 主页浏览量: '主页浏览' };
const GOAL_RE = new RegExp(`预计提升(${Object.keys(QUOTE_GOALS).join('|')})`);

/** "7~31" / "7-31" → [7, 31] (low ≤ high), else null. */
export function rangeOf(s) {
  const m = /(\d{1,6})[~-](\d{1,6})/.exec(flat(s));
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo <= hi ? [lo, hi] : null;
}

/** Option cards from word positions: a range and the prices under it in the same column. */
function cardsFrom(lines) {
  const words = lines.flatMap((l, li) => (l.words ?? []).map((w) => ({ ...w, li, t: flat(w.text), cx: (w.bbox.x0 + w.bbox.x1) / 2 })));
  const ranges = [];
  // A range can be one word ("7~31") or three ("20", "~", "90").
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let m = /^(\d{1,5})~(\d{1,5})$/.exec(w.t);
    if (m) ranges.push({ li: w.li, x0: w.bbox.x0, x1: w.bbox.x1, r: [Number(m[1]), Number(m[2])] });
    else if (/^\d{1,5}$/.test(w.t) && words[i + 1]?.t === '~' && /^\d{1,5}$/.test(words[i + 2]?.t ?? '') && words[i + 2].li === w.li) {
      ranges.push({ li: w.li, x0: w.bbox.x0, x1: words[i + 2].bbox.x1, r: [Number(w.t), Number(words[i + 2].t)] });
      i += 2;
    }
  }
  const goalLines = new Set(lines.map((l, i) => (GOAL_RE.test(flat(l.text)) ? i : -1)).filter((i) => i >= 0));
  const cards = [];
  for (const r of ranges) {
    // Only ranges right under a "预计提升…" line are cards (not "含赠0~3" or the sticky bar).
    if (![...goalLines].some((g) => g < r.li && r.li - g <= 2) || r.r[0] > r.r[1]) continue;
    const col = (w) => w.cx >= r.x0 - 40 && w.cx <= r.x0 + 300;
    const prices = words.filter((w) => w.li > r.li && w.li <= r.li + 3 && col(w) && /^[¥Y]\d{2,5}$/.test(w.t)).map((w) => Number(w.t.slice(1)));
    const bonus = words.filter((w) => w.li > r.li && w.li <= r.li + 2 && col(w) && /\d~\d/.test(w.t)).map((w) => rangeOf(w.t)).find(Boolean) ?? null;
    cards.push({ estimate: r.r, price: prices[0] ?? null, listPrice: prices[1] ?? null, bonus });
  }
  return cards;
}

/** Reads one or more screenshots of the same purchase screen. */
export function parseAdQuote(images) {
  const lines = images.flatMap((im) => im.lines ?? []);
  const texts = lines.map((l) => flat(l.text));
  const all = texts.join('\n');
  const out = { goal: '', estimate: null, bonusEstimate: null, pay: null, total: null, credit: null, hours: null, options: [] };

  const goal = GOAL_RE.exec(all);
  if (goal) out.goal = QUOTE_GOALS[goal[1]];
  const bar = /预计提升转化数(\d{1,6}[~-]\d{1,6})/.exec(all);
  if (bar) out.estimate = rangeOf(bar[1]);

  for (const im of images) {
    for (const c of cardsFrom(im.lines ?? [])) {
      if (!out.options.some((o) => o.estimate[0] === c.estimate[0] && o.estimate[1] === c.estimate[1] && o.price === c.price)) out.options.push(c);
    }
  }
  // "实付现金(元)" with the amount on the same or the next lines (the button sits in between).
  texts.forEach((t, i) => {
    if (!/实付现金/.test(t) || out.pay != null) return;
    for (const s of [t, ...texts.slice(i + 1, i + 4)]) {
      // The amount starts its line ("60已赠5元流量", "60" + misread badge text).
      const m = /^(\d{2,5})(?![\d.])/.exec(s.replace(/^.*实付现金\(?元?\)?/, ''));
      if (m) {
        out.pay = Number(m[1]);
        break;
      }
    }
  });
  const total = /推广总金额(\d{1,5}(?:\.\d+)?)元/.exec(all) ?? /总计(\d{1,5}(?:\.\d+)?)元/.exec(all);
  if (total) out.total = Number(total[1]);
  const credit = /已赠(\d{1,4}(?:\.\d+)?)元流量/.exec(all) ?? /满\d+赠(\d{1,4}(?:\.\d+)?)元流量/.exec(all);
  if (credit) out.credit = Number(credit[1]);
  const hours = /推广多久\D{0,3}(\d{1,3})(小时|天)/.exec(all);
  if (hours) out.hours = hours[2] === '天' ? Number(hours[1]) * 24 : Number(hours[1]);

  // Cross-checks: the chosen card has the bar's range; its price is what is paid.
  const chosen = out.estimate && out.options.find((o) => o.estimate[0] === out.estimate[0] && o.estimate[1] === out.estimate[1]);
  if (chosen) {
    out.bonusEstimate = chosen.bonus;
    if (out.pay == null && isNum(chosen.price)) out.pay = chosen.price;
  }
  if (out.pay == null && isNum(out.total)) out.pay = out.total;
  if (!out.estimate && out.options.length === 1) out.estimate = out.options[0].estimate;
  out.checks = {
    payMatchesTotal: isNum(out.pay) && isNum(out.total) ? out.pay === out.total : null,
    payMatchesCard: chosen && isNum(chosen.price) && isNum(out.pay) ? chosen.price === out.pay : null,
  };
  out.found = ['goal', 'estimate', 'pay', 'credit', 'hours'].filter((k) => out[k] != null && out[k] !== '').length;
  return out;
}
