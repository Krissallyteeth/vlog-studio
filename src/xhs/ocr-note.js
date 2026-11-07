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
      if (!out.title && /笔记分析详情/.test(texts[i - 1] ?? '') && (tx.match(/[一-鿿]/g) ?? []).length >= 4 && !/笔记状态|数据|概览/.test(tx)) {
        out.title = tx.replace(/[[\]【】()（）《》@©®]/g, '').replace(/\|+/g, ' | ').replace(/\s+/g, ' ').trim();
      }
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
          if (vals.length >= 3) out.peer[diag] ??= { value: num(vals[0]), median: num(vals[1]), beat: num(vals[2]) };
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
  // The platform cuts D+1 data at midnight after the publish day (shown the next morning at 9).
  if (!out.snapshotAt && out.publishedAt) {
    out.snapshotAt = `${new Date(Date.parse(`${out.publishedAt.slice(0, 10)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)}T00:00`;
    out.snapshotDerived = true;
  }
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
