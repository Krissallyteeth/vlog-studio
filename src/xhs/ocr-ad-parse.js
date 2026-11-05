import { parseNumber } from './ocr-parse.js';

/*
 * 薯条 (promotion order) detail screenshots → an ad record. Pure: works on OCR lines.
 * Rules as for post statistics: anything uncertain becomes { status: 'check', candidate } and
 * is never filled in silently.
 */

export const AD_METRICS = [
  ['exposure', ['曝光量']],
  ['reads', ['阅读量', '观看量']],
  ['likes', ['点赞量']],
  ['favorites', ['收藏量']],
  ['comments', ['评论量']],
  ['follows', ['新增关注', '涨粉']],
  ['profileViews', ['主页浏览']],
  ['dmOpens', ['私信开口']],
];
export const AD_GOALS = ['点赞收藏量', '关注', '阅读量', '主页浏览', '私信开口'];
const AGE_LABELS = ['18以下', '18~23', '24~30', '31~40', '41~50', '50以上'];
const MIN_CONF = 80;

const squeeze = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[：]/g, ':').replace(/[～〜]/g, '~').replace(/[（]/g, '(').replace(/[）]/g, ')');
const conf = (line) => Math.min(...line.words.map((w) => w.confidence ?? 0));
const tidy = (v) => (typeof v === 'number' ? Number(v.toPrecision(10)) : v);
const ok = (value, text, c) => ({ status: 'ok', value: tidy(value), text, conf: c });
const check = (candidate, text, c, reason) => ({ status: 'check', candidate: tidy(candidate), text, conf: c, reason });
const judge = (value, text, c, reason = '') => (reason || c < MIN_CONF ? check(value, text, c, reason || 'confidence') : ok(value, text, c));

/** "100/100" read as "1001100" (the slash became "1"): split where both sides make sense. */
export function splitSpent(raw) {
  const s = raw.replace(/[^\d./|lI]/g, '');
  const m = /^(\d+(?:\.\d+)?)[/|lI](\d+(?:\.\d+)?)$/.exec(s);
  if (m) return { spend: Number(m[1]), budget: Number(m[2]), sure: true };
  const digits = s.replace(/[^\d]/g, '');
  const options = [];
  for (let i = 1; i < digits.length - 1; i++) {
    if (digits[i] !== '1') continue;
    const a = Number(digits.slice(0, i));
    const b = Number(digits.slice(i + 1));
    if (a > 0 && b > 0 && a <= b) options.push({ spend: a, budget: b, gap: Math.abs(String(a).length - String(b).length) });
  }
  options.sort((x, y) => x.gap - y.gap || y.spend - x.spend);
  return options[0] ? { spend: options[0].spend, budget: options[0].budget, sure: false } : null;
}

/** linesPerImage: [[{ words: [{ text, confidence, bbox }] }]] — one array of lines per screenshot. */
export function parseAdOrder(linesPerImage) {
  const f = {}; // field → result
  const set = (key, r) => {
    if (!r) return;
    const prev = f[key];
    if (!prev) f[key] = r;
    else if (prev.status === 'ok' && r.status === 'ok' && prev.value !== r.value && typeof prev.value !== 'object') f[key] = { status: 'conflict', options: [prev, r] };
    else if (prev.status !== 'ok' && r.status === 'ok') f[key] = r;
  };
  const audience = { gender: {}, age: {}, city: {}, interest: {} };
  for (const lines of linesPerImage) {
    let section = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line?.words?.length) continue;
      const text = squeeze(line.words.map((w) => w.text).join(''));
      const c = conf(line);
      let m;
      // Status / title / publish time
      if (/推广完成|推广结束/.test(text)) set('status', ok('done', text, 100));
      else if (/推广中/.test(text)) set('status', ok('running', text, 100));
      if ((m = /发布时间:?(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})(?::\d{2})?/.exec(text))) set('publishedAt', judge(`${m[1]}T${m[2]}`, m[0], Math.max(c, 80)));
      if (/vlog|Vlog|VLOG|\|/.test(text) && !/作者|发布|互动/.test(text) && text.length > 6 && !f.title) {
        set('title', check(line.words.map((w) => w.text).join('').replace(/^[^A-Za-z一-鿿]+/, '').replace(/^[全:o\s]+/, ''), text, c, 'text'));
      }
      // Result vs estimate: "点赞收藏量 27 / 预估转化 16 ~ 71"
      if ((m = /^(点赞收藏量|关注量|阅读量|主页浏览量|新增关注)(\d+)\/预估转化(\d+)~(\d+)/.exec(text))) {
        set('goal', ok(m[1].replace(/量$/, '量'), m[1], 100));
        set('result', judge(Number(m[2]), m[2], c));
        set('estimate', judge([Number(m[3]), Number(m[4])], `${m[3]}~${m[4]}`, c));
      }
      if ((m = /推广目标:?(点赞收藏量|关注|阅读量|主页浏览|私信开口)/.exec(text))) set('goal', ok(m[1], m[1], c));
      if ((m = /(?:互动率)?超(?:过|越)(\d+(?:\.\d+)?)%的同类笔记/.exec(text))) set('beatPct', judge(Number(m[1]) / 100, `${m[1]}%`, Math.max(c, 70)));
      // Spend: "当前已消耗金额 100/100 元"
      if ((m = /已消耗金额[^\d]*([\d./|lI]+)元/.exec(text))) {
        const sp = splitSpent(m[1]);
        if (sp) {
          set('spend', sp.sure ? judge(sp.spend, m[1], c) : check(sp.spend, m[1], c, 'format'));
          set('budget', sp.sure ? judge(sp.budget, m[1], c) : check(sp.budget, m[1], c, 'format'));
        }
      }
      // Coupon: "满 100.0 元 赠 40.0 元", expiry on the line before
      if ((m = /满(\d+(?:\.\d+)?)元赠(\d+(?:\.\d+)?)元/.exec(text))) set('coupon', judge({ threshold: Number(m[1]), bonus: Number(m[2]) }, m[0], Math.max(c, 70)));
      if ((m = /^(\d{4}-\d{2}-\d{2})\d{2}:\d{2}:\d{2},?快去/.exec(text))) set('couponExpires', judge(m[1], m[1], 80));
      // Metric grid: a label row followed by a row of numbers in the same order.
      const labels = AD_METRICS.map(([key, names]) => ({ key, at: Math.min(...names.map((n) => (text.indexOf(n) < 0 ? Infinity : text.indexOf(n)))) })).filter((x) => x.at !== Infinity).sort((a, b) => a.at - b.at);
      if (labels.length >= 2 && lines[i + 1]) {
        const nums = lines[i + 1].words.map((w) => ({ p: parseNumber(w.text), c: w.confidence, text: w.text })).filter((x) => x.p);
        if (nums.length === labels.length) labels.forEach((l, j) => set(l.key, judge(nums[j].p.value, nums[j].text, nums[j].c, nums[j].p.unit === 'pct' ? 'format' : '')));
        else labels.forEach((l) => set(l.key, { status: 'check', candidate: null, text: lines[i + 1].words.map((w) => w.text).join(' '), conf: 0, reason: 'layout' }));
      }
      // Audience sections
      if (/性别分布/.test(text)) section = 'gender';
      else if (/年龄分布/.test(text)) section = 'age';
      else if (/城市分布/.test(text)) section = 'city';
      else if (/兴趣分布/.test(text)) section = 'interest';
      if (section === 'gender') {
        const g = /男性(\d+(?:\.\d+)?)%.*女性(\d+(?:\.\d+)?)%/.exec(text);
        if (g) {
          const male = Number(g[1]) / 100;
          const female = Number(g[2]) / 100;
          const sumOk = Math.abs(male + female - 1) < 0.011;
          // Two shares that add up to exactly 100% confirm each other.
          audience.gender = sumOk ? { male: ok(male, `${g[1]}%`, c), female: ok(female, `${g[2]}%`, c) } : { male: check(male, `${g[1]}%`, c, 'sum'), female: check(female, `${g[2]}%`, c, 'sum') };
        }
      } else if (section && (m = /^(.*?)(\d+(?:\.\d+)?)["%]?$/.exec(text)) && /%|"/.test(text)) {
        const pct = Number(m[2]) / 100;
        const label = m[1].replace(/[|()\[\]@®国图本和ED(EER)]+$/g, '').replace(/[A-Za-z|()\[\]@®。.]+/g, '');
        const bad = pct > 1 || !/\./.test(m[2]);
        const list = audience[section];
        let key = label || `#${Object.keys(list).length + 1}`;
        if (section === 'age') key = AGE_LABELS[Object.keys(list).length] ?? key;
        if (!list[key]) list[key] = bad ? check(null, text, c, 'format') : judge(pct, `${m[2]}%`, c);
      }
    }
  }
  return { fields: f, audience };
}

/** Field list shown in the review table (order matters). */
export const AD_FIELDS = ['spend', 'budget', 'goal', 'status', ...AD_METRICS.map(([k]) => k), 'result', 'estimate', 'beatPct', 'coupon', 'couponExpires', 'title', 'publishedAt'];
