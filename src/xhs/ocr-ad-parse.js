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
  let here = null; // where the current line is: { img, box } — shown next to the value for checking
  const set = (key, r) => {
    if (!r) return;
    if (here && !r.at) r = { ...r, at: here };
    const prev = f[key];
    if (!prev) f[key] = r;
    else if (prev.status === 'ok' && r.status === 'ok' && prev.value !== r.value && typeof prev.value !== 'object') f[key] = { status: 'conflict', options: [prev, r] };
    else if (prev.status !== 'ok' && r.status === 'ok') f[key] = r;
  };
  const audience = { gender: {}, age: {}, city: {}, interest: {} };
  const spendTexts = [];
  let budgetUsedUp = false;
  const noteCountSeen = () => f.noteCount?.value ?? 1;
  const noteText = []; // text under the thumbnails of a multi-note order (titles, often garbled)
  for (const [img, lines] of linesPerImage.entries()) {
    let section = '';
    let inNotes = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line?.words?.length) continue;
      here = { img, box: boxOf([line]) };
      const text = squeeze(line.words.map((w) => w.text).join(''));
      const c = conf(line);
      let m;
      if (/展开详情|收起详情|已消耗金额|订单信息/.test(text)) inNotes = false;
      if (inNotes) noteText.push(line.words.map((w) => w.text).join(''));
      if (/本订单共推广/.test(text)) inNotes = true;
      // Status / title / publish time
      if (/推广完成|推广结束/.test(text)) set('status', ok('done', text, 100));
      else if (/推广中/.test(text)) set('status', ok('running', text, 100));
      if ((m = /(?:发|布|时)[布时间问]*:?(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})(?::\d{2})?/.exec(text)) && !/下单|创建|投放|开始|推广时间|订单时间/.test(text)) set('publishedAt', judge(`${m[1]}T${m[2]}`, m[0], Math.max(c, 80)));
      // Label unreadable: the note header is the only place with a date-time that has seconds.
      else if ((m = /(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}):\d{2}/.exec(text)) && !/下单|创建|投放|开始|订单|快去/.test(text)) set('publishedAt', check(`${m[1]}T${m[2]}`, m[0], c, 'text'));
      // Order / delivery start time (shown in 订单管理 and the expanded order details).
      if ((m = /(?:下单时间|创建时间|投放时间|开始时间|推广时间|订单时间):?(\d{4}-\d{2}-\d{2})(\d{2}:\d{2})/.exec(text))) set('startedAt', judge(`${m[1]}T${m[2]}`, m[0], Math.max(c, 80)));
      if (/vlog|Vlog|VLOG|viog|\|/.test(text) && !/作者|发布|互动|订单|消耗|保障/.test(text) && text.length > 6 && !f.title && noteCountSeen() <= 1) {
        set('title', check(line.words.map((w) => w.text).join('').replace(/^[^A-Za-z一-鿿]+/, '').replace(/^[全:o\s]+/, ''), text, c, 'text'));
      }
      // Result vs estimate: "点赞收藏量 27 / 预估转化 16 ~ 71", "点赞收藏量 60 效果极好 / 预估转化 11 ~ 53",
      // "赞藏量 61 / 目标区间 16~63" (the label is often misread, the numbers around "/" are what count).
      if ((m = /(\d+)(?:效果[极很]?[好佳一般差]+)?\/(?:预估转化|目标区间)(\d+)~(\d+)/.exec(text))) {
        set('result', judge(Number(m[1]), m[1], c));
        set('estimate', judge([Number(m[2]), Number(m[3])], `${m[2]}~${m[3]}`, c));
        const g = /^(点赞收藏量|关注量|阅读量|主页浏览量|新增关注)\d/.exec(text);
        if (g) set('goal', ok(g[1], g[1], 100));
      } else if ((m = /^预估转化(\d+)~(\d+)个?/.exec(text))) set('estimate', judge([Number(m[1]), Number(m[2])], `${m[1]}~${m[2]}`, Math.max(c, 80)));
      // Order header and order info (the expanded "订单信息" / "金额信息" part).
      if ((m = /本订单共推广(\d+)篇笔记/.exec(text))) set('noteCount', ok(Number(m[1]), m[0], 100));
      if ((m = /订单编号:?([0-9a-f]{8}(?:-[0-9a-f]{1,4}){0,3})/i.exec(text))) set('orderNo', judge(m[1].toLowerCase(), m[1], Math.max(c, 80)));
      if ((m = /订单金额:?(\d+(?:\.\d+)?)元/.exec(text))) set('orderAmount', judge(Number(m[1]), m[0], c));
      if ((m = /实付金额:?(\d+(?:\.\d+)?)元/.exec(text))) set('paid', judge(Number(m[1]), m[0], c));
      if ((m = /支付方式:?(\S+)$/.exec(text))) set('payMethod', judge(m[1].replace(/^薯[币市]/, '薯币'), m[0], c));
      if ((m = /预计推广时长:?(\d+(?:\.\d+)?)(天|小时|h)/.exec(text))) set('duration', judge(m[2] === '天' ? Number(m[1]) * 24 : Number(m[1]), m[0], Math.max(c, 80)));
      if ((m = /目标人群:?(\S+)$/.exec(text))) set('targeting', judge(m[1], m[0], c));
      if ((m = /超额获赠(\d+)/.exec(text))) set('bonus', check(Number(m[1]), m[0], c, c < MIN_CONF ? 'confidence' : ''));
      if ((m = /投放成本在(\d+(?:\.\d+)?)元/.exec(text))) set('costPerResult', judge(Number(m[1]), m[0], Math.max(c, 80)));
      if ((m = /(?:效果)?高于(\d+(?:\.\d+)?)%同质订单/.exec(text))) set('beatPct', judge(Number(m[1]) / 100, `${m[1]}%`, Math.max(c, 70)));
      if (/已完成全部预算消耗/.test(text)) budgetUsedUp = true;
      if ((m = /推广目标:?(点赞收藏量|关注|阅读量|主页浏览|私信开口)/.exec(text))) set('goal', ok(m[1], m[1], c));
      if ((m = /(?:互动率)?超(?:过|越)(\d+(?:\.\d+)?)%的同类笔记/.exec(text))) set('beatPct', judge(Number(m[1]) / 100, `${m[1]}%`, Math.max(c, 70)));
      // Spend: "当前已消耗金额 100/100 元"
      if ((m = /已消耗金额[^\d]*([\d./|lI]+)元/.exec(text))) spendTexts.push({ raw: m[1], c, at: here });
      // Coupon: "满 100.0 元 赠 40.0 元", expiry on the line before
      if ((m = /满(\d+(?:\.\d+)?)元赠(\d+(?:\.\d+)?)元/.exec(text))) set('coupon', judge({ threshold: Number(m[1]), bonus: Number(m[2]) }, m[0], Math.max(c, 70)));
      if ((m = /^(\d{4}-\d{2}-\d{2})\d{2}:\d{2}:\d{2},?快去/.exec(text))) set('couponExpires', judge(m[1], m[1], 80));
      // Metric grid: a label row followed by a row of numbers in the same order.
      const labels = AD_METRICS.map(([key, names]) => ({ key, at: Math.min(...names.map((n) => (text.indexOf(n) < 0 ? Infinity : text.indexOf(n)))) })).filter((x) => x.at !== Infinity).sort((a, b) => a.at - b.at);
      if (labels.length >= 2 && lines[i + 1]) {
        here = { img, box: boxOf([line, lines[i + 1]]) }; // label row + number row
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
        if (g && !(audience.gender.male?.status === 'ok')) {
          // Shares are always shown with one decimal; "172%" is "17.2%" with the dot lost.
          const male = pctOf(g[1]);
          const female = pctOf(g[2]);
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
        if (section === 'age') key = ageLabel(text) ?? AGE_LABELS[Object.keys(list).length] ?? key;
        const guess = bad && /^\d{2,3}$/.test(m[2]) ? pctOf(m[2]) : null;
        const r = bad ? check(guess != null && guess <= 1 ? guess : null, text, c, 'format') : judge(pct, `${m[2]}%`, c);
        // The same section often appears on two screenshots: keep the clearer reading.
        if (!list[key] || (list[key].status !== 'ok' && (r.status === 'ok' || list[key].candidate == null))) list[key] = r;
      }
    }
  }
  // Spend "50/50 元": the slash is often read as "1" ("50150") or as "/1" ("50/150").
  here = null;
  for (const { raw, c, at } of spendTexts) {
    here = at;
    const sp = splitSpent(raw);
    if (!sp) continue;
    let { spend, budget, sure } = sp;
    const cand = (k) => f[k]?.value ?? f[k]?.candidate;
    // 订单金额 and 实付金额 read separately and agreeing count as a confirmed amount.
    const amount = f.orderAmount?.value ?? f.paid?.value ?? (cand('orderAmount') != null && cand('orderAmount') === cand('paid') ? cand('orderAmount') : undefined);
    if (sure && budgetUsedUp && spend !== budget && String(budget) === `1${spend}`) {
      budget = spend; // "已完成全部预算消耗": spent == budget, the extra "1" was the slash
      sure = false;
    }
    if (amount != null && spend === amount && budget === amount) {
      // Confirmed by 订单金额 / 实付金额 on the same order.
      set('spend', { ...ok(spend, raw, c), confirmedBy: 'orderAmount' });
      set('budget', { ...ok(budget, raw, c), confirmedBy: 'orderAmount' });
      // Four readings of the same amount (consumed / budget / 订单金额 / 实付金额) confirm each other.
      for (const k of ['orderAmount', 'paid']) if (f[k]?.status === 'check' && f[k].candidate === spend) f[k] = { ...ok(spend, f[k].text, f[k].conf), at: f[k].at, confirmedBy: 'spend' };
      continue;
    }
    set('spend', sure ? judge(spend, raw, c) : check(spend, raw, c, 'format'));
    set('budget', sure ? judge(budget, raw, c) : check(budget, raw, c, 'format'));
  }
  // Values that confirm each other: cost per result × result ≈ spend; result − top of the estimate = bonus.
  const val = (k) => f[k]?.value ?? f[k]?.candidate;
  const confirm = (k, why) => {
    if (f[k] && f[k].status === 'check' && f[k].candidate != null) f[k] = { ...ok(f[k].candidate, f[k].text, f[k].conf), at: f[k].at, confirmedBy: why };
  };
  if (val('result') != null && val('spend') != null && val('costPerResult') != null && Math.abs(val('spend') / val('result') - val('costPerResult')) < 0.01) {
    confirm('result', 'costPerResult');
    confirm('spend', 'costPerResult');
    if (budgetUsedUp && val('budget') === val('spend')) confirm('budget', 'spend'); // "已完成全部预算消耗"
  }
  // "59 效果极好" read as "598": top of the estimate + bonus = the result, and the reading starts with it.
  if (val('bonus') != null && val('result') != null && Array.isArray(val('estimate'))) {
    const expected = val('estimate')[1] + val('bonus');
    const read = String(val('result'));
    if (read !== String(expected) && read.length > String(expected).length && read.startsWith(String(expected)) && f.result.status !== 'ok') {
      f.result = { ...check(expected, f.result.text, f.result.conf, 'format'), at: f.result.at };
    }
  }
  if (val('bonus') != null && val('result') != null && Array.isArray(val('estimate')) && val('result') - val('estimate')[1] === val('bonus')) {
    confirm('result', 'bonus');
    confirm('bonus', 'result');
  }
  if (f.paid?.status === 'check' && f.orderAmount?.status === 'ok' && f.paid.candidate === f.orderAmount.value) confirm('paid', 'orderAmount');
  return { fields: f, audience, noteText: noteText.join(' ') };
}

/** Bounding box around some OCR lines (image pixels). */
function boxOf(lines) {
  const ws = lines.flatMap((l) => l?.words ?? []).filter((w) => w.bbox);
  if (!ws.length) return null;
  return { x0: Math.min(...ws.map((w) => w.bbox.x0)), y0: Math.min(...ws.map((w) => w.bbox.y0)), x1: Math.max(...ws.map((w) => w.bbox.x1)), y1: Math.max(...ws.map((w) => w.bbox.y1)) };
}

/** Age bucket from the start of an OCR line ("18X下", "s1~20" …); null when unclear. */
function ageLabel(text) {
  if (/^18(以|X|U|下)/.test(text)) return '18以下';
  if (/^18~/.test(text)) return '18~23';
  if (/^2\d~(30|3\d)/.test(text)) return '24~30';
  if (/^[3s]1~[24]0/.test(text)) return '31~40';
  if (/^41~/.test(text)) return '41~50';
  if (/^50(以|上)/.test(text)) return '50以上';
  return null;
}

/** "17.2" → 0.172; "172" (dot lost) → 0.172; "31" → 0.031 — shares are shown with one decimal. */
function pctOf(s) {
  if (/\./.test(s)) return Number(s) / 100;
  return Number(s) / 1000;
}

/** Field list shown in the review table (order matters). */
/** Fields shown on the review screen (the others are still read and saved, just not asked about). */
export const AD_REVIEW_FIELDS = ['publishedAt', 'startedAt', 'paid', 'spend', 'goal', ...AD_METRICS.map(([k]) => k), 'result', 'estimate', 'bonus', 'costPerResult', 'beatPct', 'noteCount'];
export const AD_FIELDS = ['startedAt', 'orderNo', 'noteCount', 'spend', 'budget', 'orderAmount', 'paid', 'goal', 'status', ...AD_METRICS.map(([k]) => k), 'result', 'estimate', 'bonus', 'costPerResult', 'beatPct', 'duration', 'targeting', 'payMethod', 'coupon', 'couponExpires', 'title', 'publishedAt'];
