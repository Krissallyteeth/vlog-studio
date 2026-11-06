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
  let carrySection = ''; // a chart can continue at the top of the next screenshot
  for (const [img, lines] of linesPerImage.entries()) {
    let section = carrySection;
    let headingSeen = false;
    let belowTitle = false; // the phone status bar (time, battery "53") sits above the 订单详情 title
    let inNotes = false;
    let pendingName = null; // a chart name read as its own line ("娱乐"), waiting for its number line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line?.words?.length) continue;
      here = { img, box: boxOf([line]) };
      const text = squeeze(line.words.map((w) => w.text).join(''));
      const c = conf(line);
      // Confidence of the number words only: a blurry label next to a clear "26" should not fail it.
      const nums = line.words.filter((w) => /\d/.test(w.text));
      const nc = nums.length ? Math.min(...nums.map((w) => w.confidence ?? 0)) : c;
      if (/订单详情|详情|咨询/.test(text)) belowTitle = true;
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
      // The note title: below the 订单详情 title bar (the status bar "10:38 … 95 |" is not it), with Chinese text.
      if (belowTitle && /vlog|Vlog|VLOG|viog|\|/.test(text) && (text.match(/[\u4e00-\u9fff]/g) ?? []).length >= 2 && !/作者|发布|互动|订单|消耗|保障/.test(text) && text.length > 6 && !f.title && noteCountSeen() <= 1) {
        set('title', check(line.words.map((w) => w.text).join('').replace(/^[^A-Za-z一-鿿]+/, '').replace(/^[全:o\s]+/, ''), text, c, 'text'));
      }
      // Result vs estimate: "点赞收藏量 27 / 预估转化 16 ~ 71", "点赞收藏量 60 效果极好 / 预估转化 11 ~ 53",
      // "赞藏量 61 / 目标区间 16~63" (the label is often misread, the numbers around "/" are what count).
      // "… 19 / 预估转化 15~51", "… 60 效果极好 / …", "粉丝关注量 26 效果良好 / 预估转化 7~43"
      // The "/" is often read as "|", "l" or lost: up to 12 non-digits may sit between them.
      if ((m = /(\d+)[^\d]{0,12}?(?:预估转化|目标区间|估转化)(\d+)~(\d+)/.exec(text))) {
        // Left-most number = the result, the others = the estimate: each judged by its own words.
        const dw = [...nums].sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const cOf = (list) => (list.length ? Math.min(...list.map((w) => w.confidence ?? 0)) : nc);
        set('result', { ...judge(Number(m[1]), m[1], cOf(dw.slice(0, 1))), at: { img, box: here.box, word: dw[0]?.bbox } });
        set('estimate', judge([Number(m[2]), Number(m[3])], `${m[2]}~${m[3]}`, cOf(dw.slice(1))));
        const g = /^(点赞收藏量|粉丝关注量|关注量|阅读量|主页浏览量|新增关注)\d/.exec(text);
        if (g) set('goal', ok(/关注/.test(g[1]) ? '关注' : g[1], g[1], 100));
      } else if ((m = /^预估转化(\d+)~(\d+)个?/.exec(text))) set('estimate', judge([Number(m[1]), Number(m[2])], `${m[1]}~${m[2]}`, Math.max(c, 80)));
      // Order header and order info (the expanded "订单信息" / "金额信息" part).
      if ((m = /本订单共推广(\d+)篇笔记/.exec(text))) set('noteCount', ok(Number(m[1]), m[0], 100));
      if ((m = /订单编号:?([0-9a-f]{8}(?:-[0-9a-f]{1,4}){0,3})/i.exec(text))) set('orderNo', judge(m[1].toLowerCase(), m[1], Math.max(c, 80)));
      if ((m = /订单金额:?(\d+(?:\.\d+)?)元/.exec(text))) set('orderAmount', judge(Number(m[1]), m[0], nc));
      if ((m = /实付金额:?(\d+(?:\.\d+)?)元/.exec(text))) set('paid', judge(Number(m[1]), m[0], nc));
      if ((m = /支付方式:?(\S+)$/.exec(text))) set('payMethod', judge(m[1].replace(/^薯[币市]/, '薯币'), m[0], c));
      if ((m = /预计推广时长:?(\d+(?:\.\d+)?)(天|小时|h)/.exec(text))) set('duration', judge(m[2] === '天' ? Number(m[1]) * 24 : Number(m[1]), m[0], Math.max(c, 80)));
      if ((m = /目标人群:?(\S+)$/.exec(text))) set('targeting', judge(m[1], m[0], c));
      // The discount used on this order (优惠类型 满赠券 / 优惠金额 35元): platform money, not the user's.
      if ((m = /优惠金额:?(\d+(?:\.\d+)?)元/.exec(text))) set('discount', judge(Number(m[1]), m[0], nc));
      if ((m = /超额获赠(\d+)/.exec(text))) set('bonus', check(Number(m[1]), m[0], c, c < MIN_CONF ? 'confidence' : ''));
      if ((m = /投放成本在(\d+(?:\.\d+)?)元/.exec(text))) set('costPerResult', judge(Number(m[1]), m[0], Math.max(c, 80)));
      if ((m = /(?:效果)?高于(\d+(?:\.\d+)?)%同质订单/.exec(text))) set('beatPct', judge(Number(m[1]) / 100, `${m[1]}%`, Math.max(c, 70)));
      if (/已完成全部预算消耗/.test(text)) budgetUsedUp = true;
      if ((m = /推广目标:?[,，]?(点赞收藏量|粉丝关注量|关注量?|阅读量|主页浏览量?|私信开口)/.exec(text))) set('goal', ok(/关注/.test(m[1]) ? '关注' : m[1], m[1], c));
      if ((m = /(?:超(?:过|越)|领先)(\d+(?:\.\d+)?)%的同类(?:笔记|订单)/.exec(text))) set('beatPct', judge(Number(m[1]) / 100, `${m[1]}%`, Math.max(nc, 70)));
      // Spend: "当前已消耗金额 100/100 元"
      if ((m = /已消耗金额[^\d]*([\d./|lI]+)元/.exec(text))) spendTexts.push({ raw: m[1], c: nc, at: here });
      // Coupon: "满 100.0 元 赠 40.0 元", expiry on the line before
      if ((m = /满(\d+(?:\.\d+)?)元赠(\d+(?:\.\d+)?)元/.exec(text))) set('coupon', judge({ threshold: Number(m[1]), bonus: Number(m[2]) }, m[0], Math.max(nc, 70)));
      if ((m = /^(\d{4}-\d{2}-\d{2})\d{2}:\d{2}:\d{2},?快去/.exec(text))) set('couponExpires', judge(m[1], m[1], 80));
      // Metric grid: a label row followed by a row of numbers in the same order.
      const labels = AD_METRICS.map(([key, names]) => ({ key, at: Math.min(...names.map((n) => (text.indexOf(n) < 0 ? Infinity : text.indexOf(n)))) })).filter((x) => x.at !== Infinity).sort((a, b) => a.at - b.at);
      if (labels.length >= 2 && lines[i + 1]) {
        here = { img, box: boxOf([line, lines[i + 1]]) }; // label row + number row
        const nums = lines[i + 1].words.map((w) => ({ p: parseNumber(w.text), c: w.confidence, text: w.text, box: w.bbox })).filter((x) => x.p);
        // Each value keeps the box of its own word, so a doubtful number can be read again on its own.
        if (nums.length === labels.length) labels.forEach((l, j) => set(l.key, { ...judge(nums[j].p.value, nums[j].text, nums[j].c, nums[j].p.unit === 'pct' ? 'format' : ''), at: { img, box: here.box, word: nums[j].box } }));
        else labels.forEach((l) => set(l.key, { status: 'check', candidate: null, text: lines[i + 1].words.map((w) => w.text).join(' '), conf: 0, reason: 'layout' }));
      }
      // Audience sections
      // The page below the charts (assistant card, course banner, help link, buttons) is not audience data.
      if (/关注薯条|小助手|推广技巧|小课堂|开课|帮助中心|再次推广|订单管理|热力冲刺|抢流量/.test(text)) section = '';
      if (/订单详情|详情|咨询/.test(text)) belowTitle = true;
      if (/分布/.test(text) && /性别|年龄|城市|兴趣/.test(text)) headingSeen = true;
      // A chart carried over from the previous screenshot only continues below the title bar, with real shares.
      if (!headingSeen && section && (!belowTitle || !/\d[.%]|%/.test(text))) continue;
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
      } else if (section && section !== 'gender' && !/\d/.test(text) && /^[\u4e00-\u9fff]{1,6}$/.test(text) && !/分布|画像/.test(text)) {
        pendingName = line; // OCR split the row: the number comes on the next line
      } else if (section && /\d/.test(text)) {
        // Name and number on separate lines at the same height: put them back together.
        const ln = pendingName && sameRow(pendingName, line) && !hasLeftName(line) ? { words: [...pendingName.words, ...line.words] } : line;
        pendingName = null;
        if (ln !== line) here = { img, box: boxOf([ln]) };
        const row = audienceRow(ln, section);
        if (row) {
          const list = audience[section];
          let key = row.label || `#${Object.keys(list).length + 1}`;
          if (section === 'age') key = ageLabel(text) ?? AGE_LABELS[Object.keys(list).length] ?? key;
          const r = { ...row.result, at: here, carried: !headingSeen }; // carried: above any heading of this screenshot
          // The same section often appears on two screenshots: keep the clearer reading.
          if (!list[key] || (list[key].status !== 'ok' && (r.status === 'ok' || list[key].candidate == null))) list[key] = r;
        }
      }
    }
    carrySection = section === 'gender' ? '' : section;
  }
  // Interests are listed from the largest share down: of two that break the order, the less certain
  // reading is marked for a second look ("36" above "80.8").
  const ints = Object.entries(audience.interest);
  for (let i = 0; i + 1 < ints.length; i++) {
    const [ka, a] = ints[i];
    const [kb, b] = ints[i + 1];
    const va = a.value ?? a.candidate;
    const vb = b.value ?? b.candidate;
    if (va == null || vb == null || va >= vb) continue;
    const [k, r] = (a.status === 'ok' ? 1 : 0) + (a.conf ?? 0) / 1000 <= (b.status === 'ok' ? 1 : 0) + (b.conf ?? 0) / 1000 ? [ka, a] : [kb, b];
    audience.interest[k] = { ...r, status: 'check', candidate: r.value ?? r.candidate, value: undefined, reason: 'format' };
  }
  // Rows repeated at the top of the next screenshot (the overlap): an unnamed one with the same share
  // as a row already read is that row again.
  for (const sec of ['city', 'interest']) {
    const list = audience[sec];
    const entries = Object.entries(list);
    for (const [k, r] of entries) {
      const v = r.value ?? r.candidate;
      if (r.carried && !knownName(k, sec) && v != null && entries.some(([k2, x]) => k2 !== k && (x.value ?? x.candidate) === v)) delete list[k];
    }
  }
  // 城市分布 lists the top regions and ends with 其他 (everyone else): an unnamed last row is 其他.
  const cityKeys = Object.keys(audience.city);
  const lastCity = cityKeys.at(-1);
  if (cityKeys.length >= 3 && lastCity && !PROVINCES.includes(lastCity) && !cityKeys.includes('其他')) {
    audience.city = Object.fromEntries(Object.entries(audience.city).map(([k, v]) => [k === lastCity ? '其他' : k, v]));
  }
  for (const sec of ['age', 'city']) completeBySum(audience[sec], sec === 'age' ? AGE_LABELS.length : 0);
  // OCR sometimes outputs the first interest row before its heading, so it lands under 城市分布. When
  // the named regions already add up to 100%, an extra unnamed "region" is that interest row.
  const named = Object.entries(audience.city).filter(([k]) => PROVINCES.includes(k));
  const namedSum = named.reduce((a, [, r]) => a + (r.value ?? r.candidate ?? 0), 0);
  const strays = Object.entries(audience.city).filter(([k]) => !PROVINCES.includes(k));
  if (strays.length && named.length >= 3 && Math.abs(namedSum - 1) < 0.0035) {
    audience.city = Object.fromEntries(named);
    audience.interest = Object.fromEntries([...strays.map(([, r], i) => [`#${i + 1}`, { ...r, status: 'check', candidate: r.value ?? r.candidate, value: undefined, reason: 'text' }]), ...Object.entries(audience.interest)]);
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
  // The goal result is the report's own count: 点赞收藏 = likes + saves, 关注 = new followers.
  if (f.result && f.result.status !== 'ok') {
    const goal = String(f.goal?.value ?? '');
    const okv = (k) => (f[k]?.status === 'ok' ? f[k].value : null);
    const fromReport = /点赞|收藏/.test(goal) && okv('likes') != null && okv('favorites') != null ? okv('likes') + okv('favorites') : /关注/.test(goal) ? okv('follows') : null;
    if (fromReport != null && f.result.candidate === fromReport) confirm('result', 'report');
  }
  // No result read but the estimate and 超额获赠 are: result = top of the estimate + bonus.
  if (!f.result && Array.isArray(f.estimate?.value ?? f.estimate?.candidate) && (f.bonus?.value ?? f.bonus?.candidate) != null) {
    const est = f.estimate.value ?? f.estimate.candidate;
    const bonus = f.bonus.value ?? f.bonus.candidate;
    f.result = { status: 'check', candidate: est[1] + bonus, text: `${est[1]} + ${bonus}`, conf: 0, reason: 'derived', at: f.bonus.at };
    // …and the report's own count agreeing with it confirms both.
    const goal = String(f.goal?.value ?? '');
    const v = (k) => (f[k]?.status === 'ok' ? f[k].value : null);
    const count = /关注/.test(goal) ? v('follows') : /点赞|收藏/.test(goal) && v('likes') != null && v('favorites') != null ? v('likes') + v('favorites') : null;
    if (count === est[1] + bonus) {
      confirm('result', 'estimate+bonus');
      confirm('bonus', 'result');
    }
  }
  markMismatch(f);
  return { fields: f, audience, noteText: noteText.join(' ') };
}

// Names the 薯条 audience report uses: provinces (城市分布) and interest groups (观众兴趣分布).
const PROVINCES = ['北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门', '其他'];
const INTERESTS = ['体育运动', '运动健身', '美妆护肤', '时尚穿搭', '母婴育儿', '家居家装', '科技数码', '游戏动漫', '知识教育', '影视综艺', '生活记录', '娱乐', '美食', '情感', '影视', '时尚', '旅游', '宠物', '美妆', '护肤', '穿搭', '运动', '健身', '音乐', '游戏', '科技', '数码', '教育', '学习', '母婴', '家居', '家装', '汽车', '体育', '摄影', '读书', '二次元', '动漫', '搞笑', '职场', '财经', '健康', '婚嫁', '出行', '人文', '艺术', '手工', '绘画', '舞蹈', '明星', '综艺', '潮流', '户外', '露营', '咖啡', '探店', '美甲', '减肥', '亲子', '留学', '校园', '文化', '资讯', '新闻', '萌宠', '家居生活'];
const WEAK = new Set(['人', '他', '其', '国', '本', '和', '的', '一', '大', '小', '上', '下']);

/**
 * The goal result and the report's own count must agree (关注: result = 新增关注; 点赞收藏:
 * result = 点赞 + 收藏). When they do not, one of them is misread ("26" read as "20"), so none of
 * them is trusted: all are marked "mismatch" for a second reading. A result confirmed another way
 * (cost × result = spend, result − estimate top = bonus) keeps its value; only the counts are marked.
 */
export function markMismatch(f) {
  const v = (k) => f[k]?.value ?? f[k]?.candidate ?? null;
  const goal = String(f.goal?.value ?? '');
  const R = v('result');
  if (R == null) return [];
  const parts = /关注/.test(goal) ? ['follows'] : /点赞|收藏/.test(goal) ? ['likes', 'favorites'] : [];
  if (!parts.length || parts.some((k) => v(k) == null)) return [];
  const total = parts.reduce((a, k) => a + v(k), 0);
  if (total === R) return [];
  const resultSure = ['bonus', 'costPerResult'].includes(f.result?.confirmedBy);
  const keys = resultSure ? parts : ['result', ...parts];
  for (const k of keys) f[k] = { ...f[k], status: 'check', value: undefined, candidate: v(k), reason: 'mismatch' };
  return keys;
}

/** True when an audience label is one of the known names of its chart. */
export const knownName = (name, section) => (section === 'city' ? PROVINCES : section === 'interest' ? INTERESTS : []).includes(name);

/** Closest known name for a garbled label ("炽乐" → 娱乐, "川" → 四川); '' when nothing fits. */
export const nameOf = (raw, section) => nameGuess(raw, section).name;

/** { name, sure }: on a tie the more common name (earlier in the list) is offered, not trusted. */
export function nameGuess(raw, section) {
  const vocab = section === 'city' ? PROVINCES : section === 'interest' ? INTERESTS : null;
  const t = String(raw ?? '').replace(/[^\u4e00-\u9fff]/g, '');
  if (!vocab || !t) return { name: '', sure: false };
  const exact = [...vocab].sort((a, b) => b.length - a.length).find((v) => t.includes(v)); // "体育运动" before "运动"
  if (exact) return { name: exact, sure: true };
  let best = '';
  let bestScore = 0;
  let tie = false;
  for (const v of vocab) {
    const hits = [...new Set(v)].filter((ch) => t.includes(ch) && !WEAK.has(ch));
    if (!hits.length) continue;
    // A matching character in the same place counts a little more ("影饮" → 影视, not 摄影).
    // …and a name mostly covered by the reading beats a longer one ("影饮" → 影视, not 影视综艺).
    const score = hits.length + hits.filter((ch) => t.indexOf(ch) === v.indexOf(ch)).length * 0.5 + (hits.length / v.length) * 0.1;
    if (score > bestScore) [best, bestScore, tie] = [v, score, false];
    else if (score === bestScore) tie = true;
  }
  return { name: bestScore ? best : '', sure: bestScore > 0 && !tie };
}

/**
 * One row of an audience bar chart: the name is at the far left, the share at the far right, and
 * the bar in between often reads as junk — so words are picked by position, and the confidence of
 * the name and number words only is used (the bar's junk would otherwise fail every row).
 */
function audienceRow(line, section) {
  const ws = line.words.filter((w) => w.bbox && String(w.text).trim());
  if (!ws.length) return null;
  const right = Math.max(...ws.map((w) => w.bbox.x1));
  // The share sits at the right edge. OCR sometimes glues the bar to it ("(2.4\"" from x=264 to the
  // edge), so the word is found by where it ends, not where it starts.
  const valueWord = [...ws].reverse().find((w) => /\d/.test(w.text) && (w.bbox.x0 > right * 0.6 || w.bbox.x1 > right * 0.95));
  if (!valueWord) return null;
  const glued = valueWord.bbox.x0 <= right * 0.6;
  // The name: the leftmost run of Chinese words, up to where the bar starts (a gap or non-Chinese junk).
  const labelWords = [];
  for (const w of [...ws].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    if (w === valueWord || w.bbox.x0 > right * 0.2) break; // the bar starts at about 16–22% of the width
    // A heading read on the same line as the first row ("观众兴趣分布 娱乐 … 92.4%"): skip its words.
    if (/分布|画像|观众|兴趣|城市|年龄|性别/.test(w.text)) continue;
    const prev = labelWords.at(-1);
    if (prev && w.bbox.x0 - prev.bbox.x1 > 24) break;
    if (!/[\u4e00-\u9fff]/.test(w.text) && !(section === 'age' && /\d/.test(w.text))) {
      if (labelWords.length) break;
      continue;
    }
    labelWords.push(w);
  }
  const rawLabel = labelWords.map((w) => w.text).join('');
  let digits = String(valueWord.text).replace(/[^\d.%]/g, '');
  // "11.1%" read as "11196": the % sign became "96".
  if (!digits.includes('%') && /^\d{3,}96$/.test(digits)) digits = digits.slice(0, -2);
  // The number right before "%" ("418%6" → 418), else the last number in the word ("(2.4\"" → 2.4).
  const num = (/(\d+(?:\.\d+)?)%/.exec(digits) ?? /(\d+(?:\.\d+)?)\D*$/.exec(digits))?.[1] ?? '';
  if (!num) return null;
  const c = Math.min(valueWord.confidence ?? 0, ...labelWords.map((w) => w.confidence ?? 100));
  const hasDot = num.includes('.');
  const value = hasDot ? Number(num) / 100 : pctOf(num);
  const guess = section === 'age' ? { name: '', sure: true } : nameGuess(rawLabel, section);
  const label = guess.name;
  const ok1 = !glued && hasDot && value <= 1 && (section === 'age' || (label && guess.sure)) && c >= MIN_CONF;
  const result = value > 1 || !Number.isFinite(value) ? check(null, line.words.map((w) => w.text).join(' '), c, 'format') : ok1 ? ok(value, `${num}%`, c) : check(value, `${num}%`, c, !hasDot || glued ? 'format' : section !== 'age' && !(label && guess.sure) ? 'text' : 'confidence');
  // Only a sure name becomes the key; a guess (a tie, "汽南" → 海南/河南/湖南) is kept beside it and
  // the row is read again from the image.
  if (section !== 'age' && !(label && guess.sure)) result.guessName = label || rawLabel.replace(/[^\u4e00-\u9fff]/g, '');
  return { label: section === 'age' ? '' : label && guess.sure ? label : '', result };
}

/**
 * Shares of one chart add up to 100%. All read → confirmed together. One unsure → it is what
 * is left, when that agrees with the digits read ("11%" with 11.1% missing).
 */
export function completeBySum(list, expectedCount = 0) {
  const entries = Object.entries(list);
  if (entries.length < 2 || (expectedCount && entries.length !== expectedCount)) return;
  const val = (r) => r.value ?? r.candidate;
  const unsure = entries.filter(([, r]) => r.status !== 'ok');
  const total = entries.reduce((a, [, r]) => a + (val(r) ?? 0), 0);
  if (entries.every(([, r]) => val(r) != null) && Math.abs(total - 1) < 0.0035) {
    for (const [k, r] of unsure) list[k] = { ...ok(val(r), r.text, r.conf), at: r.at, guessName: r.guessName, carried: r.carried, confirmedBy: 'sum' };
    return;
  }
  // Readings that lost their dot ("11%", "247%") are the doubtful ones; the others count toward the sum.
  // Try each of them as "what is left" (the shortest reading first: "11%" is the ambiguous kind);
  // accept when its digits agree and the others, as read, make up the rest.
  const lost = entries.filter(([, r]) => r.status !== 'ok' && r.reason === 'format').sort((a, b) => String(a[1].text).length - String(b[1].text).length);
  const digitsOf = (r) => String(r.text ?? '').replace(/[^\d]/g, '');
  if (lost.length && lost.length <= 2 && entries.every(([, r]) => val(r) != null || r.reason === 'format')) {
    for (const [k, r] of lost) {
      const others = entries.filter(([key]) => key !== k);
      if (others.some(([, x]) => val(x) == null)) continue;
      const left = Math.round((1 - others.reduce((a, [, x]) => a + val(x), 0)) * 1000) / 1000;
      const read = digitsOf(r);
      const want = String(Math.round(left * 1000));
      // Each other dot-less reading must be its own digits with the dot restored (e.g. "319" = 31.9%).
      const othersFit = others.every(([, x]) => x.reason !== 'format' || String(Math.round(val(x) * 1000)) === digitsOf(x));
      if (((left > 0 && read.length >= 2 && want.startsWith(read.slice(0, 2))) || (left === 0 && /^0+$/.test(read))) && othersFit) {
        list[k] = { ...ok(left, r.text, r.conf), at: r.at, guessName: r.guessName, confirmedBy: 'sum' };
        for (const [key, x] of others) if (x.status !== 'ok') list[key] = { ...ok(val(x), x.text, x.conf), at: x.at, guessName: x.guessName, carried: x.carried, confirmedBy: 'sum' };
        return;
      }
    }
  }
  if (unsure.length === 1) {
    const [k, r] = unsure[0];
    const rest = entries.filter(([key]) => key !== k).reduce((a, [, x]) => a + x.value, 0);
    const left = Math.round((1 - rest) * 1000) / 1000;
    const read = String(r.text ?? '').replace(/[^\d]/g, '');
    const want = String(Math.round(left * 1000));
    if (left > 0 && read && want.startsWith(read.slice(0, 2)) && (read.length <= want.length || read.startsWith(want))) list[k] = { ...ok(left, r.text, r.conf), at: r.at, guessName: r.guessName, confirmedBy: 'sum' };
  }
}

/** Two OCR lines on the same row of a chart (their vertical centres within a line height). */
function sameRow(a, b) {
  const A = boxOf([a]);
  const B = boxOf([b]);
  if (!A || !B) return false;
  return Math.abs((A.y0 + A.y1) / 2 - (B.y0 + B.y1) / 2) < Math.max(A.y1 - A.y0, B.y1 - B.y0) * 1.2 && A.x1 < B.x0;
}
/** True when a line starts with Chinese text at the far left (it carries its own name). */
function hasLeftName(line) {
  const ws = line.words.filter((w) => w.bbox);
  if (!ws.length) return false;
  const right = Math.max(...ws.map((w) => w.bbox.x1));
  return ws.some((w) => /[\u4e00-\u9fff]/.test(w.text) && w.bbox.x0 < right * 0.3);
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
