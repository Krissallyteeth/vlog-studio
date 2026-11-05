/*
 * 小红书 post metrics, mapped 1:1 to the original "XHS배포기록" sheet (header row 7).
 * Values are stored as plain numbers: counts, seconds, and ratios (0.175 = 17.5%). A missing
 * value is null, never 0 — 0 means the platform really showed 0.
 */

/** kind: count | pct | sec. dir: 1 = higher is better, -1 = lower is better.
 *  band: colour band vs the fixed baseline (0.2 = ±20%), null = not colour-judged.
 *  computed: derived by the app (the Excel sheet used a formula). */
export const METRICS = [
  { key: 'exposure', zh: '曝光量', kind: 'count', dir: 1, band: 0.2, d1: 'H', d2: 'AB', group: 'traffic' },
  { key: 'views', zh: '观看数', kind: 'count', dir: 1, band: 0.2, d1: 'I', d2: 'AC', group: 'traffic' },
  { key: 'ctr', zh: '封面点击率', kind: 'pct', dir: 1, band: 0.1, d1: 'J', d2: 'AD', group: 'traffic' },
  { key: 'exit2s', zh: '2秒退出率', kind: 'pct', dir: -1, band: 0.1, d1: 'K', d2: 'AE', group: 'hook', aliases: ['2秒推出率'] },
  { key: 'retain5s', zh: '5秒完播率', kind: 'pct', dir: 1, band: 0.1, d1: 'L', d2: 'AF', group: 'hook' },
  { key: 'interactionRate', zh: '互动率', kind: 'pct', dir: 1, band: 0.1, d1: 'M', d2: 'AG', group: 'engage' },
  { key: 'likes', zh: '点赞数', kind: 'count', dir: 1, band: null, d1: 'N', d2: 'AH', group: 'engage' },
  { key: 'comments', zh: '评论数', kind: 'count', dir: 1, band: null, d1: 'O', d2: 'AI', group: 'engage' },
  { key: 'danmaku', zh: '弹幕数', kind: 'count', dir: 1, band: null, d1: 'P', d2: 'AJ', group: 'engage' },
  { key: 'favorites', zh: '收藏数', kind: 'count', dir: 1, band: null, d1: 'Q', d2: 'AK', group: 'engage' },
  { key: 'shares', zh: '分享数', kind: 'count', dir: 1, band: null, d1: 'R', d2: 'AL', group: 'engage' },
  { key: 'newFollowers', zh: '涨粉丝', kind: 'count', dir: 1, band: null, d1: 'S', d2: 'AM', group: 'engage', aliases: ['粉丝增长'] },
  { key: 'totalInteraction', zh: '总互动率', excelName: '총 인터렉션', kind: 'pct', dir: 1, band: 0.1, d1: 'T', d2: 'AN', group: 'engage', computed: true },
  { key: 'duration', zh: '视频时长', kind: 'sec', dir: 0, band: null, d1: 'U', d2: 'AO', group: 'depth', computedD2: true },
  { key: 'avgWatch', zh: '平均观看时长', kind: 'sec', dir: 1, band: null, d1: 'V', d2: 'AP', group: 'depth' },
  { key: 'avgWatchRatio', zh: '平均观看时长%', kind: 'pct', dir: 1, band: 0.1, d1: 'W', d2: 'AQ', group: 'depth', computed: true },
  { key: 'plays60s', zh: '60秒播放数', kind: 'count', dir: 1, band: null, d1: 'X', d2: 'AR', group: 'depth' },
  { key: 'completion', zh: '全片完播率', kind: 'pct', dir: 1, band: 0.1, d1: 'Y', d2: 'AS', group: 'depth' },
];

export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));
/** Metrics a user (or OCR) enters; computed ones are derived. */
export const INPUT_METRICS = METRICS.filter((m) => !m.computed);
/** Metric groups as in the sheet's row 6. */
export const GROUPS = { traffic: '流量转化', hook: '开头吸引力', engage: '互动表现', depth: '内容深度' };

/**
 * Formulas of the original sheet, reproduced exactly:
 *  T  = SUM(点赞,评论,收藏,分享,涨粉丝) / 观看数   (弹幕 is not included)
 *  W  = 平均观看时长 / 视频时长
 *  AO = D+1 视频时长 (D+2 duration is the same video)
 */
export function computeStage(stage, d1Duration) {
  const s = stage ?? {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const parts = ['likes', 'comments', 'favorites', 'shares', 'newFollowers'].map((k) => num(s[k]));
  const views = num(s.views);
  // Excel SUM treats blanks as 0; the result is only blank when 观看数 is missing/0 (IFERROR).
  // Difference from the sheet, on purpose: when all five inputs are blank the result is blank
  // (Excel's SUM would show 0%), so "not entered" is never shown as a real 0.
  const totalInteraction = views && parts.some((p) => p !== null) ? parts.reduce((a, b) => a + (b ?? 0), 0) / views : null;
  const duration = num(s.duration) ?? num(d1Duration);
  const avgWatch = num(s.avgWatch);
  const avgWatchRatio = avgWatch !== null && duration ? avgWatch / duration : null;
  return { ...s, totalInteraction, duration, avgWatchRatio };
}

/** Rows of the "성과기준" sheet: which metrics are judged, direction, core/secondary. */
export const CRITERIA_ROWS = [
  { key: 'exposure', area: 'traffic', core: false },
  { key: 'views', area: 'traffic', core: true },
  { key: 'ctr', area: 'cover', core: true },
  { key: 'exit2s', area: 'hook', core: true },
  { key: 'retain5s', area: 'hook', core: true },
  { key: 'interactionRate', area: 'engage', core: false },
  { key: 'totalInteraction', area: 'engage', core: false },
  { key: 'avgWatchRatio', area: 'watch', core: false },
  { key: 'completion', area: 'watch', core: false },
  { key: 'newFollowers', area: 'convert', core: false },
];

export const VALIDITY = ['유효', '광고혼입', '미확인'];
export const DEFAULT_CONTENT_TYPES = ['여행', '일상', '집꾸미기 / 인테리어', '위스키', '음식 / 카페', '협찬 콘텐츠', '기타'];
