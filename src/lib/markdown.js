import { SHOT_TYPES, STATUSES, VALUES, labelOf, typeLabels } from './constants.js';
import { formatDate, formatRange, formatTimestamp } from './dates.js';
import { formatDuration, shotStats, totalSeconds, logHasContent } from './progress.js';

const has = (v) => typeof v === 'string' && v.trim() !== '';
/** Multi-line answers are indented so they stay inside their list item. */
const text = (v) => v.trim().replace(/\n+/g, '\n  ');
const line = (label, v) => (has(v) ? `- **${label}**: ${text(v)}` : null);
const block = (lines) => lines.filter(Boolean).join('\n');
const EMPTY = '_(작성한 내용 없음)_';

export function logPlaceName(project, log) {
  const place = project.places.find((p) => p.id === log.placeId);
  return place?.name || log.placeName || '장소 미지정';
}

export function sceneLinkLabel(project, link) {
  const [kind, ref] = (link || '').split(':');
  if (kind === 'place') return project.places.find((p) => p.id === ref)?.name ?? '';
  if (kind === 'log') {
    const log = project.logs.find((l) => l.id === ref);
    return log ? `현장 기록 · ${logPlaceName(project, log)}` : '';
  }
  return '';
}

export function projectToMarkdown(p, { now = Date.now() } = {}) {
  const out = [];
  const { plan, story } = p;

  out.push(`# ${p.name}`, '');
  out.push(block([
    `- **촬영 날짜**: ${formatRange(p.startDate, p.endDate)}`,
    line('장소', p.location),
    typeLabels(p).length ? `- **영상 유형**: ${typeLabels(p).join(', ')}` : null,
    `- **진행 상태**: ${labelOf(STATUSES, p.status)}`,
    `- **목표 영상 길이**: ${formatDuration(p.target.min)} ~ ${formatDuration(p.target.max)}`,
  ]), '');

  out.push('## 1. 촬영 전 기획 / 前期策划', '');
  const values = plan.values.map((v) => VALUES.find((x) => x.id === v)).filter(Boolean);
  const planBlock = block([
    line('주제 / 主题', plan.theme),
    line('촬영 전 중심 이야기 방향 / 主线方向', plan.direction),
    plan.highlights.some((h) => has(h.text))
      ? `- **핵심 볼거리 / 核心看点**\n${plan.highlights.filter((h) => has(h.text)).map((h) => `  - ${text(h.text)}`).join('\n')}`
      : null,
    line('시청자의 궁금증 / 观众好奇点', plan.curiosity),
    line('캐릭터 / 人设', plan.persona),
    line('공감 / 共鸣', plan.resonance),
    values.length ? `- **전달 가치 / 价值**: ${values.map((v) => `${v.zh}(${v.ko})`).join(', ')}` : null,
    line('가치 메모', plan.valueNote),
  ]);
  out.push(planBlock || EMPTY, '');

  out.push('## 2. 실제 동선 / 行程 · 촬영 체크리스트 / 必拍镜头', '');
  if (!p.places.length) out.push(EMPTY, '');
  p.places.forEach((pl, i) => {
    const when = [formatDate(pl.date), pl.time].filter(Boolean).join(' ');
    out.push(`### ${i + 1}. ${pl.name || '이름 없는 장소'}${when ? ` (${when})` : ''}`, '');
    const info = block([
      line('방문 목적', pl.purpose),
      line('기대하는 경험', pl.expectation),
      line('촬영 아이디어', pl.shotIdea),
      line('메모', pl.memo),
    ]);
    if (info) out.push(info, '');
    if (pl.shots.length) {
      const st = shotStats(pl);
      out.push(`**촬영 체크리스트** (${st.done}/${st.total} 완료)`, '');
      pl.shots.forEach((s) => {
        const type = SHOT_TYPES.find((t) => t.id === s.type);
        const memo = has(s.memo) ? ` — ${text(s.memo)}` : '';
        out.push(`- [${s.done ? 'x' : ' '}] ${type.zh}(${type.ko}): ${has(s.desc) ? text(s.desc) : '설명 없음'}${memo}`);
      });
      out.push('');
    }
  });

  out.push('## 3. 현장 기록 / 现场记录', '');
  const logs = [...p.logs].filter(logHasContent).sort((a, b) => a.createdAt - b.createdAt);
  if (!logs.length) out.push(EMPTY, '');
  logs.forEach((l) => {
    out.push(`### ${logPlaceName(p, l)}${l.unplanned ? ' (계획 외 / 意外)' : ''} · ${formatTimestamp(l.createdAt)}`, '');
    out.push(block([
      line('期待 · 왜 왔나', l.expectWhy),
      line('期待 · 무엇을 기대했나', l.expectWhat),
      line('体验 · 실제로 한 것', l.experience),
      line('体验 · 있었던 일', l.happened),
      line('真实感受 · 감정', l.feeling),
      line('真实感受 · 좋았던 점', l.good),
      line('真实感受 · 아쉬웠던 점', l.bad),
      line('意外发现 · 예상 밖의 발견', l.surprise),
      line('现场备注 · 메모', l.memo),
    ]), '');
  });

  out.push('## 4. 촬영 후 이야기 / 故事感', '');
  out.push(block([
    line('촬영 전 主线方向', plan.direction) ?? '- **촬영 전 主线方向**: (작성 안 함)',
    line('촬영 후 最终主线', story.finalLine) ?? '- **촬영 후 最终主线**: (작성 안 함)',
  ]), '');
  out.push('### 감정 흐름: 期待 → 发现 → 体验 → 转折 → 感受', '');
  const flow = block([
    line('期待 (처음의 기대)', story.expectation),
    line('发现 (새로운 발견)', story.discovery),
    line('体验 (실제 경험)', story.experience),
    story.noTwist ? '- **转折**: 이번엔 뚜렷한 반전 없음 (억지로 만들지 않음)' : line('转折 (예상과 달랐던 점)', story.twist),
    line('感受 (남은 감정)', story.feeling),
  ]);
  out.push(flow || EMPTY, '');
  const extra = block([
    line('核心情绪 · 주요 감정', story.emotion),
    line('开头 Hook · 오프닝', story.hook),
    line('结尾 · 마무리', story.ending),
    line('剪辑备注 · 편집 메모', story.editNote),
  ]);
  if (extra) out.push(extra, '');

  out.push('## 5. 편집 장면 구성 / 剪辑', '');
  const total = totalSeconds(p.scenes);
  out.push(`예상 총 길이 **${formatDuration(total)}** (목표 ${formatDuration(p.target.min)} ~ ${formatDuration(p.target.max)})`, '');
  if (!p.scenes.length) out.push(EMPTY, '');
  p.scenes.forEach((s, i) => {
    const link = sceneLinkLabel(p, s.link);
    out.push(`### ${i + 1}. ${s.title || '이름 없는 장면'} (${s.seconds}초)${s.highlight ? ' ★ 하이라이트' : ''}`, '');
    const body = block([
      link ? `- **연결**: ${link}` : null,
      line('영상 내용', s.content),
      line('자막 아이디어', s.subtitle),
      line('독백 아이디어', s.voiceover),
      line('편집 메모', s.memo),
    ]);
    if (body) out.push(body, '');
  });

  out.push('---', '');
  out.push(`> Vlog Studio에서 ${formatTimestamp(now)}에 내보냄.`);
  out.push('> 이 기록을 AI에 붙여 넣고 "이 기록을 바탕으로 小红书 Vlog 대본(자막·독백 포함)을 만들어줘"라고 요청해 보세요.');
  out.push('> 실제로 경험하지 않은 감정이나 사건은 추가하지 말고, 기록된 내용만 사용해 달라고 덧붙이면 좋아요.', '');
  return out.join('\n');
}
