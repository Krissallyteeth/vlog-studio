/*
 * The 小红书 "笔记分析详情" screens besides the metric cards: which lines may be read as the post's
 * own metrics, and the extra facts they show — title, publish time, when the data was cut, the
 * platform's peer median and rank (同类中位数 · 超过同类笔记), traffic sources and the audience.
 * Pure: OCR lines in, plain values out.
 */

import { nameGuess } from './ocr-ad-parse.js';

const p100 = (s) => Number((Number(s) / 100).toPrecision(10));
const squeeze = (s) => String(s ?? '').replace(/\s+/g, '');
const lineText = (l) => squeeze((l?.words ?? []).map((w) => w.text).join(''));
const midY = (l) => {
  const ws = (l?.words ?? []).filter((w) => w.bbox);
  return ws.length ? (Math.min(...ws.map((w) => w.bbox.y0)) + Math.max(...ws.map((w) => w.bbox.y1))) / 2 : 0;
};

/** A comment screen ("评论 2 · 赞和收藏 23 … 留下你的想法吧"): its numbers are not the note's metrics. */
export const isCommentScreen = (lines) => {
  const all = lines.map(lineText).join('');
  return /留下你的想法|赞和收藏\d/.test(all) || (/作者/.test(all) && /回复/.test(all) && /评论\d/.test(all));
};

/**
 * Lines that may be read as the post's own metrics: none from a comment screen, and nothing from
 * a traffic channel's detail block ("此渠道详细数据": 首页推荐 only — 127 views, not 283).
 */
export function metricLines(lines) {
  if (isCommentScreen(lines)) return [];
  const cut = lines.find((l) => /此渠道详细数据|渠道详细/.test(lineText(l)));
  const cutY = cut ? midY(cut) - 5 : Infinity;
  return lines.filter((l) => midY(l) < cutY);
}

// Popup headings of the diagnosis cards → the metric they rank.
const DIAG = { 流量转化: 'ctr', 开头吸引力: 'retain5s', 互动表现: 'interactionRate', 内容深度: 'avgWatch' };
const LABEL = { 封面点击率: 'ctr', '5秒完播率': 'retain5s', 互动率: 'interactionRate', 平均观看时长: 'avgWatch' };
const SOURCES = { 首页推荐: 'home', 视频推荐: 'videoRec', 搜索: 'search', 关注页面: 'followPage', 其他来源: 'other' };
const AGES = ['<18', '18-24', '25-34', '35-44', '>44'];
// City rows: only names known here are kept (a misread name such as "每仆" for 海外 is left out).
const CITIES = new Set('海外 北京 上海 广州 深圳 成都 杭州 重庆 武汉 西安 南京 天津 苏州 长沙 郑州 青岛 海口 三亚 香港 澳门 台北 厦门 昆明 贵阳 沈阳 大连 哈尔滨 济南 合肥 福州 南宁 宁波 东莞 佛山 无锡 长春 石家庄 太原 南昌 兰州 乌鲁木齐 呼和浩特 银川 西宁 拉萨 珠海 温州 泉州 烟台 徐州 常州 绍兴 嘉兴 金华 台州 惠州 中山 江门 湛江 汕头 洛阳 襄阳 宜昌 桂林 柳州 遵义 绵阳 三亚 儋州 万宁 文昌 琼海'.split(' '));

const num = (s) => {
  const m = /(\d+(?:\.\d+)?)\s*(%|秒|s)?/.exec(s);
  if (!m) return null;
  return m[2] === '%' ? Number((p100(m[1])).toPrecision(10)) : Number(m[1]);
};

/** Date of "昨天 19:21" etc. against the day the data was cut (the screenshots are taken that morning). */
function postTime(text, day) {
  const m = /^(昨天|今天|前天|(\d{1,2})-(\d{1,2}))(\d{1,2}):(\d{2})/.exec(text);
  if (!m || !day) return null;
  const base = Date.parse(`${day}T00:00:00Z`);
  let date;
  if (m[2]) date = `${day.slice(0, 4)}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  else date = new Date(base - { 今天: 0, 昨天: 1, 前天: 2 }[m[1]] * 86400000).toISOString().slice(0, 10);
  return `${date}T${m[4].padStart(2, '0')}:${m[5]}`;
}

/**
 * linesPerImage → { title, snapshotAt, publishedAt, peer: { metric: { median, beat } }, sources: { home: 0.658 … },
 * audience: { gender, age, city, interest } }. Anything not read is left out (never guessed).
 */
export function noteExtras(linesPerImage, { year = new Date().getFullYear() } = {}) {
  const out = { peer: {}, sources: {}, audience: { gender: {}, age: {}, city: {}, interest: {} } };
  // "数据更新至 11-07 00:00": its date is the day the screenshots were taken (to place "昨天"). The
  // metric cards' own cut is often too faint to read; the audience one ("观众画像 … 07:00") is not
  // the metrics' cut.
  let day = '';
  const titleReads = [];
  for (const lines of linesPerImage) {
    for (const l of lines) {
      const tx = lineText(l);
      const m = /数据更新至(\d{1,2})-(\d{1,2})(\d{1,2}):(\d{2})/.exec(tx);
      if (!m) continue;
      day = day || `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      const at = `${day.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${m[3].padStart(2, '0')}:${m[4]}`;
      if (!/观众画像/.test(tx) && (!out.snapshotAt || at < out.snapshotAt)) out.snapshotAt = at;
    }
  }
  for (const lines of linesPerImage) {
    const texts = lines.map(lineText);
    const comments = isCommentScreen(lines);
    let diag = '';
    let section = '';
    let afterTags = false;
    texts.forEach((tx, i) => {
      // Title: the line right below "笔记分析详情" (or the author's post on the comment screen).
      if (/笔记分析详情/.test(texts[i - 1] ?? '') && (tx.match(/[一-鿿]/g) ?? []).length >= 4 && !/笔记状态|数据|概览/.test(tx)) titleReads.push(tx);
      if (comments && /作者/.test(texts[i - 1] ?? '') && (tx.match(/[一-鿿]/g) ?? []).length >= 4) titleReads.push(tx);
      // Publish time: the first time stamp after the hashtags of the author's post.
      if (comments && /^#/.test(tx)) afterTags = true;
      if (comments && afterTags && !out.publishedAt) {
        const t = postTime(tx, day);
        if (t) out.publishedAt = t;
      }
      // Peer comparison: a popup ("流量转化" … 封面点击率 9.9% · 同类中位数 9.2% · 超过同类笔记 55%)
      // or the diagnosis line ("5秒完播率 42.9% 同类中位数 43.6% 超过 48% 同类").
      const head = Object.keys(DIAG).find((k) => tx.startsWith(k));
      if (head) diag = DIAG[head];
      if (/同类中位数/.test(tx)) {
        const inline = /^(封面点击率|5秒完播率|互动率|平均观看时长)([\d.]+(?:%|秒)?)同类中位数([\d.]+(?:%|秒)?)超过(\d+)%/.exec(tx);
        if (inline) out.peer[LABEL[inline[1]]] ??= { value: num(inline[2]), median: num(inline[3]), beat: p100(inline[4]) };
        else if (diag) {
          const vals = (lines[i + 1]?.words ?? []).map((w) => w.text).join(' ').match(/\d+(?:\.\d+)?\s*(?:%|秒)?/g) ?? [];
          // 平均观看时长 is in seconds ("22.5秒" can be read as "22.5%").
          const sec = (v) => (diag === 'avgWatch' ? Number(String(v).replace(/[^\d.]/g, '')) : num(v));
          if (vals.length >= 3) out.peer[diag] ??= { value: sec(vals[0]), median: sec(vals[1]), beat: num(vals[2]) };
        }
      }
      // Traffic sources ("首页推荐 65.8%").
      for (const [name, key] of Object.entries(SOURCES)) {
        const m = new RegExp(`${name}(\\d+(?:\\.\\d+)?)%`).exec(tx);
        if (m) out.sources[key] ??= p100(m[1]);
      }
      // Audience sections.
      const sec = /性别分布/.test(tx) ? 'gender' : /年龄分布/.test(tx) ? 'age' : /城市分布/.test(tx) ? 'city' : /城市等级/.test(tx) ? 'tier' : /兴趣分布/.test(tx) ? 'interest' : '';
      if (sec) section = sec;
      const pct = /(\d+(?:\.\d+)?)%$/.exec(tx);
      if (section === 'gender') {
        const g = /男性(\d+(?:\.\d+)?)%.*女性(\d+(?:\.\d+)?)%/.exec(tx);
        if (g) out.audience.gender = { male: p100(g[1]), female: p100(g[2]) };
      } else if (section === 'age' && pct) {
        const a = AGES.find((x) => tx.startsWith(x));
        if (a) out.audience.age[a] ??= p100(pct[1]);
      } else if ((section === 'city' || section === 'interest') && pct) {
        // The name: the words at the left edge only (the bar after it reads as junk characters);
        // interests are matched to the known names, a doubtful one is left out.
        const right = Math.max(...lines[i].words.map((w) => w.bbox?.x1 ?? 0));
        const raw = lines[i].words.filter((w) => w.bbox && w.bbox.x1 < right * 0.26 && (w.confidence ?? 100) >= 50).map((w) => w.text).join('').replace(/[^一-鿿]/g, '');
        const g = section === 'interest' ? nameGuess(raw, 'interest') : null;
        const name = g ? (g.sure ? g.name : '') : CITIES.has(raw) ? raw : '';
        if (name) out.audience[section][name] ??= p100(pct[1]);
      }
    });
  }
  // 内容分析: the segments the platform marks (00:00-00:15 开头节奏慢… · 流失72%) and the video length
  // (the retention chart's last time mark, 02:24).
  const titles = new Map();
  const runs = [];
  let lastMark = 0;
  for (const lines of linesPerImage) {
    const run = [];
    for (const l of lines) {
      const tx = lineText(l);
      const seg = /^(\d{2}:\d{2})-(\d{2}:\d{2})(.*)$/.exec(tx);
      if (seg) titles.set(seg[1], { from: seg[1], to: seg[2], title: cjkTitle(seg[3]) });
      for (const m of tx.matchAll(/流失(\d{1,3})%/g)) run.push(Number(m[1]) / 100);
      const marks = [...tx.matchAll(/(\d{2}):(\d{2})(?!-)/g)].filter((m) => !/\d{2}:\d{2}-/.test(tx)).map((m) => Number(m[1]) * 60 + Number(m[2]));
      if (marks.length >= 3) lastMark = Math.max(lastMark, ...marks);
    }
    if (run.length) runs.push(run);
  }
  const losses = mergeRuns(runs);
  const segs = [...titles.values()].sort((a, b) => a.from.localeCompare(b.from));
  if (segs.length) out.segments = segs.map((x, i) => ({ ...x, loss: segs.length === losses.length ? losses[i] : null }));
  if (lastMark) out.duration = lastMark;
  // Title: the screens agree on the real characters; what only one reading has (a flag emoji read
  // as "加", a stray "2") is dropped.
  const clean = titleReads.map((x) => x.replace(/[[\]【】()（）《》@©®"“”]/g, '').replace(/^[^A-Za-z一-鿿]+/, ''));
  let title = clean[0] ?? '';
  for (const c of clean.slice(1)) {
    const common = lcs(title, c);
    if (common.length >= Math.min(title.length, c.length) * 0.7) title = common;
  }
  if (title) out.title = title.replace(/\s*\|+\s*/g, ' | ').replace(/\s+/g, ' ').trim();
  // Interests are listed from the largest share down: a share smaller than one listed below it was misread.
  const ints = Object.entries(out.audience.interest);
  out.audience.interest = Object.fromEntries(ints.filter(([, v], i) => !ints.slice(i + 1).some(([, w]) => w > v)));
  out.ai = aiTexts(linesPerImage);
  // 此渠道详细数据: which channel a block is for is not readable (the picker is faint), but its
  // "占总观看" equals that channel's share in the source list.
  // Search is not collected (the user's choice); home and video feed are.
  const channels = {};
  const blocks = channelBlocks(linesPerImage);
  const place = (b, key) => {
    const { rateRaw, shareRaw, conf, sameCount, ...rest } = b;
    if (isNum(out.sources[key])) rest.shareViews = out.sources[key];
    channels[key] = { ...rest, ...channels[key] };
  };
  const unplaced = [];
  for (const b of blocks) {
    const key = Object.entries(out.sources).find(([k, v]) => k !== 'search' && shareCandidates(b).some((c) => Math.abs(v - c) < 0.0015))?.[0];
    if (key) place(b, key);
    else if (!shareCandidates(b).some((c) => Math.abs((out.sources.search ?? -1) - c) < 0.0015)) unplaced.push(b);
  }
  // A block whose share could not be read: the video feed has no cover (exposure = views, a note
  // says so), the home feed has a click rate.
  for (const b of unplaced) {
    const vr = b.sameCount || (isNum(b.exposure) && b.exposure === b.views);
    const key = vr ? 'videoRec' : isNum(b.conv) ? 'home' : null;
    if (key && !channels[key]) place(b, key);
  }
  if (Object.keys(channels).length) out.channels = channels;
  // The platform cuts D+1 data at midnight after the publish day (shown the next morning at 9).
  if (!out.snapshotAt && out.publishedAt) {
    out.snapshotAt = `${new Date(Date.parse(`${out.publishedAt.slice(0, 10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)}T00:00`;
    out.snapshotDerived = true;
  }
  return out;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The detail blocks under "此渠道详细数据": 转化率 · 互动率 · 曝光数/观看数 · 占总曝光/占总观看 ·
 * 平均观看时长/点赞 · 评论/收藏. The last two are a label row over a value row in two columns; a value
 * not under its label (a smeared read) is left out.
 */
export function channelBlocks(linesPerImage) {
  const blocks = [];
  for (const lines of linesPerImage) {
    let b = null;
    lines.forEach((l, i) => {
      const tx = lineText(l);
      if (/此渠道详细数据|渠道详细/.test(tx)) {
        if (b) blocks.push(b);
        b = {};
        return;
      }
      if (!b) return;
      if (/搜索热词|观众画像|性别分布/.test(tx)) {
        blocks.push(b);
        b = null;
        return;
      }
      let m;
      if (/曝光数和观看数相等/.test(tx)) b.sameCount = true;
      if ((m = /转化率(\d+(?:\.\d+)?)%/.exec(tx))) b.conv ??= p100(m[1]);
      if ((m = /互动率(\d+(?:\.\d+)?)%/.exec(tx)) && b.interactionRate == null) {
        b.interactionRate = p100(m[1]);
        b.rateRaw = m[1];
      }
      if ((m = /曝光数(\d+)观看数(\d+)/.exec(tx))) {
        b.exposure ??= Number(m[1]);
        b.views ??= Number(m[2]);
      }
      if ((m = /占总曝光(\d+(?:\.\d+)?)%占总观看(\d+(?:\.\d+)?)%/.exec(tx))) {
        b.shareExposure ??= p100(m[1]);
        b.shareViews ??= p100(m[2]);
        b.shareRaw ??= m[2];
      }
      const pair = /平均观看时长.*点赞/.test(tx) ? ['avgWatch', 'likes', '点赞'] : /评论.*收藏/.test(tx) ? ['comments', 'favs', '收藏'] : null;
      if (pair && lines[i + 1]) {
        const lw = l.words.filter((w) => w.bbox);
        const leftX = lw[0]?.bbox.x0;
        const rightX = lw.find((w) => w.text.includes(pair[2][0]))?.bbox.x0;
        if (!isNum(leftX) || !isNum(rightX)) return;
        for (const w of lines[i + 1].words.filter((x) => x.bbox)) {
          const v = /^(\d+(?:\.\d+)?)/.exec(w.text.replace(/[^\d.]/g, ''));
          if (!v) continue;
          // 平均观看时长 is in seconds even when "秒" is read as "%".
          const f = Math.abs(w.bbox.x0 - leftX) < 60 ? pair[0] : Math.abs(w.bbox.x0 - rightX) < 60 ? pair[1] : null;
          if (!f || b[f] != null) continue;
          b[f] = Number(v[1]);
          (b.conf ??= {})[f] = w.confidence ?? 100;
        }
      }
    });
    if (b) blocks.push(b);
  }
  return blocks
    .map((b) => (isNum(b.exposure) && isNum(b.views) && b.exposure > 0 && b.conv == null && b.views < b.exposure ? { ...b, conv: Number((b.views / b.exposure).toPrecision(4)) } : b))
    .map(checkReactions)
    .filter((b) => Object.keys(b).length);
}

/**
 * 互动数 = 点赞 + 评论 + 收藏 (checked on the screens: 9% of 189 views = 12+1+4). With the rate and
 * the views, the total is known; one missing count is filled from it, and one doubtful read
 * (low confidence) that breaks the sum is corrected. Fields filled this way are listed in `derived`.
 */
function checkReactions(b) {
  const F = ['likes', 'comments', 'favs'];
  if (!isNum(b.interactionRate) || !isNum(b.views) || !b.rateRaw) return b;
  const decimals = (b.rateRaw.split('.')[1] ?? '').length;
  const half = 0.5 * 10 ** -decimals;
  const lo = Math.ceil(((Number(b.rateRaw) - half) * b.views) / 100 - 1e-9);
  const hi = Math.floor(((Number(b.rateRaw) + half) * b.views) / 100 + 1e-9);
  if (lo !== hi || lo < 0) return b; // the total is not pinned to one number
  const total = lo;
  const missing = F.filter((f) => !isNum(b[f]));
  const sumOf = (fs) => fs.reduce((s, f) => s + b[f], 0);
  const valueFor = (f) => total - sumOf(F.filter((x) => x !== f));
  let fix = null;
  if (missing.length === 1) fix = missing[0];
  else if (!missing.length && sumOf(F) !== total) {
    // The least sure read whose correction gives a possible count (not below 0).
    fix = F.filter((f) => (b.conf?.[f] ?? 100) < 85 && valueFor(f) >= 0).sort((x, y) => b.conf[x] - b.conf[y])[0] ?? null;
  }
  if (!fix) return b;
  const v = valueFor(fix);
  return v >= 0 ? { ...b, [fix]: v, derived: [...(b.derived ?? []), fix] } : b;
}

/** Shares a misread point could stand for ("531%" → 53.1%, 5.31%): the read itself first. */
function shareCandidates(b) {
  const out = isNum(b.shareViews) ? [b.shareViews] : [];
  const d = String(b.shareRaw ?? '').replace(/\D/g, '');
  if (!b.shareRaw?.includes('.')) for (let i = 1; i < d.length; i++) out.push(p100(`${d.slice(0, i)}.${d.slice(i)}`));
  return out;
}

/** The platform's segment headline, or '' when it was read as noise (mostly not Chinese). */
function cjkTitle(s) {
  const t = String(s).replace(/ai$/i, '').slice(0, 40);
  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk >= Math.max(4, t.length * 0.7) ? t : '';
}

/** Loss chips read on several scrolled screenshots ([72,6,5,2] and [5,2,3,3]) joined on their overlap. */
export function mergeRuns(runs) {
  let out = [];
  for (const r of runs) {
    if (!out.length || r.length > out.length && r.slice(0, out.length).join() === out.join()) {
      if (r.length >= out.length) out = [...r];
      continue;
    }
    // The longest tail of what we have that is a head of this run.
    let k = Math.min(out.length, r.length);
    while (k > 0 && out.slice(-k).join() !== r.slice(0, k).join()) k--;
    if (k > 0) out = [...out, ...r.slice(k)];
    else if (r.join().includes(out.join())) out = [...r];
  }
  return out;
}

/** Longest common subsequence of two strings (characters in order). */
function lcs(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0;
  let j = 0;
  let out = '';
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out += a[i];
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

const AI_END = /该结果于|小时后可重新|评论总结|数据更新至|^@?(首页推荐|视频推荐|搜索|关注页面|其他来源)\d|性别分布/;
/**
 * The platform's own written analysis (marked "ai" in the app), kept as read:
 *  metrics: { ctr: { now, why, tip } … } from the diagnosis popups (现状 · 原因分析 · 建议),
 *  segments: { '00:00': { analysis, tip } } from 内容分析, traffic / audience: { title, text }.
 */
export function aiTexts(linesPerImage) {
  const ai = { metrics: {}, segments: {} };
  for (const lines of linesPerImage) {
    const tx = lines.map(lineText);
    let metric = '';
    let seg = '';
    let part = '';
    let buf = [];
    const flush = () => {
      const text = buf.join('').replace(/ai$/i, '').trim();
      buf = [];
      if (!text || !part) return;
      // The same text can be cut off on one screenshot and whole on the next: keep the longer.
      const keep = (obj, k) => {
        if (!obj[k] || text.length > obj[k].length) obj[k] = text;
      };
      if (metric && ['now', 'why', 'tip'].includes(part)) keep((ai.metrics[metric] ??= {}), part);
      else if (seg && ['analysis', 'tip'].includes(part)) keep((ai.segments[seg] ??= {}), part);
      else if (part === 'traffic' || part === 'audience') {
        if (!ai[part] || text.length > ai[part].text.length) ai[part] = { title: ai[`_${part}`] ?? '', text };
      }
    };
    tx.forEach((t, i) => {
      const head = Object.keys(DIAG).find((k) => t.startsWith(k) && t.length <= k.length + 4);
      if (head) {
        flush();
        metric = DIAG[head];
        part = '';
      }
      const sm = /^(\d{2}:\d{2})-\d{2}:\d{2}/.exec(t);
      if (sm) {
        flush();
        seg = sm[1];
        metric = '';
        part = '';
        return;
      }
      if (AI_END.test(t)) {
        flush();
        part = '';
        return;
      }
      const label = t.replace(/ai$/i, '');
      if (label === '现状') return void (flush(), (part = 'now'));
      if (label === '原因分析') return void (flush(), (part = 'why'));
      if (label === '建议') return void (flush(), (part = 'tip'));
      if (label === '内容分析' && seg) return void (flush(), (part = 'analysis'));
      if (label === '优化建议' && seg) return void (flush(), (part = 'tip'));
      // The traffic / audience summaries: a headline marked "ai" right under the section title.
      if (/ai$/i.test(t) && (/观看来源/.test(tx[i - 1] ?? '') || /观众画像/.test(tx[i - 1] ?? ''))) {
        flush();
        part = /观看来源/.test(tx[i - 1]) ? 'traffic' : 'audience';
        ai[`_${part}`] = t.replace(/ai$/i, '');
        metric = '';
        seg = '';
        return;
      }
      if (part) buf.push(t);
    });
    flush();
  }
  delete ai._traffic;
  delete ai._audience;
  return ai;
}
