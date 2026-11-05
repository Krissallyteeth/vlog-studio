import { METRICS, METRIC, computeStage } from './metrics.js';
import { criteria, judge, ordered, validSeq } from './stats.js';

/*
 * Export in the original workbook layout ("XHS배포기록" header on row 7, data from row 8, same
 * column letters), plus the recomputed 성과기준, 수익기록 (in won) and 기준 sheets, and an ad sheet.
 * Values are written as values; calculated columns hold the app's current results.
 */

const FILL = { good: 'FFDCFCE7', mid: 'FFFEF3C7', bad: 'FFFEE2E2' };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function postsTable(posts) {
  const seq = validSeq(posts);
  const cols = [
    ['B', 'No.', (p) => p.no],
    ['C', '粉丝', (p) => p.followers],
    ['D', '배포내용', (p) => p.title],
    ['E', '배포일자', (p) => p.date],
    ['F', '배포시간', (p) => p.time],
    ['G', '推广判断', (p) => p.adDecisionD1],
  ];
  for (const stage of ['d1', 'd2']) {
    for (const m of METRICS) cols.push([m[stage], `${m.excelName ?? m.zh}${stage === 'd2' ? (m.key === 'newFollowers' ? '' : '2') : ''}`.replace(/^涨粉丝$/, stage === 'd2' ? '粉丝增长2' : '涨粉丝'), (p) => computeStage(p[stage], p.d1.duration)[m.key], m]);
    if (stage === 'd1') {
      cols.push(['Z', '예상 팔로워 증가수', (p) => p.expectedFollowersD1]);
      cols.push(['AA', '推广判断3', (p) => p.adAux]);
    } else {
      cols.push(['AT', '推广判断2', (p) => p.adDecisionD2]);
      cols.push(['AU', '예상 팔로워 증가수2', (p) => p.expectedFollowersD2]);
    }
  }
  cols.push(['AV', '备注', (p) => p.memo], ['AW', 'D+1 유효성', (p) => p.validity], ['AX', '유효순번', (p) => seq.get(p.id) ?? null]);
  return cols;
}

export async function buildWorkbook({ posts, income, baseline, settings, docs }) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vlog Studio';
  const list = ordered(posts);

  // XHS배포기록
  const ws = wb.addWorksheet('XHS배포기록');
  ws.getCell('B2').value = 'XHS D+1,D+2 포스팅 데이터 수집 (Vlog Studio에서 내보냄)';
  ws.getCell('H5').value = 'D+1';
  ws.getCell('AB5').value = 'D+2';
  const cols = postsTable(list);
  const extraKeys = [...new Set(list.flatMap((p) => Object.keys(p.extra ?? {})))];
  const extraStart = 51; // after AX
  cols.forEach(([col, header]) => {
    ws.getCell(`${col}7`).value = header;
    ws.getCell(`${col}7`).font = { bold: true };
  });
  ws.getCell('AY7').value = '유형(앱)';
  extraKeys.forEach((k, i) => (ws.getCell(7, extraStart + 1 + i).value = k));
  list.forEach((p, i) => {
    const r = 8 + i;
    for (const [col, , get, m] of cols) {
      const cell = ws.getCell(`${col}${r}`);
      let v = get(p);
      if (col === 'E' && v) v = new Date(`${v}T00:00:00Z`);
      cell.value = v === '' ? null : v ?? null;
      if (col === 'E') cell.numFmt = 'yyyy-mm-dd';
      if (m?.kind === 'pct') cell.numFmt = '0.0%';
      if (m && col === m.d1) {
        const j = judge(m.key, v, baseline?.medians[m.key], p.validity);
        if (j) cell.fill = fill(FILL[j]);
      }
    }
    ws.getCell(`AY${r}`).value = p.contentType || null;
    extraKeys.forEach((k, j) => (ws.getCell(r, extraStart + 1 + j).value = p.extra?.[k] ?? null));
    const aw = ws.getCell(`AW${r}`);
    aw.fill = fill(p.validity === '유효' ? FILL.good : FILL.mid);
  });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 7 }];

  // 성과기준
  const c = criteria(posts, baseline, settings);
  const cs = wb.addWorksheet('성과기준');
  cs.addRow(['小红书 | 오가닉 성과 기준 및 추세 (Vlog Studio 계산값)']);
  cs.addRow([`유효 D+1 ${c.validCount} · 광고혼입 ${c.adMixedCount} · 핵심 지표 악화 ${c.coreDown} · 기준선 Version ${baseline?.version ?? '-'}`]);
  cs.addRow([]);
  cs.addRow(['D+1 지표', '좋은 방향', '고정 중앙값', '초기 5편', '최근 유효 5편', '최근 유효 10편', '개선율', '추세', '핵심/보조', '유효 데이터 수']);
  const trendKo = { up: '개선', down: '악화', flat: '유지', sample: '표본 확인' };
  for (const r of c.rows) {
    const row = cs.addRow([METRIC[r.key].zh, r.dir < 0 ? '↓' : '↑', r.fixed, r.early, r.recent, r.recent10, r.improvement, trendKo[r.trend], r.core ? '핵심' : '보조', r.validCount]);
    if (METRIC[r.key].kind === 'pct') [3, 4, 5, 6].forEach((i) => (row.getCell(i).numFmt = '0.0%'));
    row.getCell(7).numFmt = '+0.0%;-0.0%;0.0%';
  }

  // 수익기록 (won)
  const is = wb.addWorksheet('수익기록');
  is.addRow(['No.', '플랫폼', '협업 브랜드', '협업 유형', '콘텐츠 내용', '제공 제품·서비스', '현물 협찬 가치(원)', '현금 광고 수익(원)', '배포일자', '비고']);
  for (const x of income) is.addRow([x.no, x.platform, x.brand, x.collabType, x.content, x.product, x.inKindKRW, x.cashKRW, x.date, x.note]);

  // 광고기록
  const as = wb.addWorksheet('광고기록');
  as.addRow(['게시물', '단계', '집행', '시작', '종료', '기간(h)', '목표', '지출(元)', '증정 크레딧(元)', '예상 팔로워', '실제 팔로워', '결과', '메모', '원본 메모', '주문 번호', '묶음 노트 수', '주문 전체 지출(元)', '배분', '曝光量', '阅读量', '点赞量', '收藏量', '评论量', '新增关注', '主页浏览', '私信开口', '목표 결과', '예상 범위', '목표 1건당 비용(元)']);
  for (const p of list) {
    for (const a of p.ads) {
      const o = a.order ?? {};
      as.addRow([p.title, a.stage, a.executed ? 'Y' : 'N', a.start, a.end, a.hours, a.goal, a.spend, a.credit, a.expectedFollowers, a.actualFollowers, a.result, a.memo, a.sourceText, a.orderNo, a.noteCount > 1 ? a.noteCount : null, a.orderSpend, a.allocation === 'equal' ? '균등 배분(추정)' : '', o.exposure, o.reads, o.likes, o.favorites, o.comments, o.follows, o.profileViews, o.dmOpens, a.goalResult, a.estimate ? `${a.estimate[0]}~${a.estimate[1]}` : '', a.costPerResult]);
    }
  }

  // 기준
  const rs = wb.addWorksheet('기준');
  rs.addRow(['[현재 적용 중] 앱 메모']);
  rs.addRow([settings.currentRules || '']);
  for (const r of docs.rules ?? []) {
    rs.addRow([]);
    rs.addRow([`[과거 참고용] ${r.title}`]);
    rs.addRow([r.text]);
  }
  return wb;
}

/** CSV of the posts table (UTF-8 with BOM so Excel opens Chinese/Korean correctly). */
export function postsCsv(posts) {
  const list = ordered(posts);
  const cols = postsTable(list);
  const q = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [[...cols.map(([, h]) => h), '유형(앱)'].map(q).join(',')];
  for (const p of list) lines.push([...cols.map(([, , get]) => get(p)), p.contentType].map(q).join(','));
  return `﻿${lines.join('\n')}\n`;
}
