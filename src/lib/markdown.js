import { SHOT_TYPES, STATUSES, VALUES, labelOf, typeLabels } from './constants.js';
import { formatDate, formatRange, formatTimestamp } from './dates.js';
import { formatDuration, shotStats, totalSeconds, logHasContent } from './progress.js';
import { t } from '../i18n/index.js';

const has = (v) => typeof v === 'string' && v.trim() !== '';
/** Multi-line answers are indented so they stay inside their list item. */
const text = (v) => v.trim().replace(/\n+/g, '\n  ');
const line = (label, v) => (has(v) ? `- **${label}**: ${text(v)}` : null);
const block = (lines) => lines.filter(Boolean).join('\n');
const EMPTY = () => `_(${t('md.empty')})_`;

export function logPlaceName(project, log) {
  const place = project.places.find((p) => p.id === log.placeId);
  return place?.name || log.placeName || t('md.noPlace');
}

export function sceneLinkLabel(project, link) {
  const [kind, ref] = (link || '').split(':');
  if (kind === 'place') return project.places.find((p) => p.id === ref)?.name ?? '';
  if (kind === 'log') {
    const log = project.logs.find((l) => l.id === ref);
    return log ? `${t('field.title')} · ${logPlaceName(project, log)}` : '';
  }
  return '';
}

/** The whole project as Markdown in the UI language, laid out for pasting into an AI chat. */
export function projectToMarkdown(p, { now = Date.now() } = {}) {
  const out = [];
  const { plan, story } = p;

  out.push(`# ${p.name}`, '');
  out.push(block([
    `- **${t('project.dates')}**: ${formatRange(p.startDate, p.endDate)}`,
    line(t('md.location'), p.location),
    typeLabels(p).length ? `- **${t('project.types')}**: ${typeLabels(p).join(', ')}` : null,
    `- **${t('md.status')}**: ${labelOf(STATUSES, p.status)}`,
    `- **${t('md.target')}**: ${formatDuration(p.target.min)} ~ ${formatDuration(p.target.max)}`,
  ]), '');

  out.push(`## 1. ${t('plan.title')}`, '');
  const values = plan.values.map((v) => VALUES.find((x) => x.id === v)).filter(Boolean);
  const planBlock = block([
    line(t('plan.theme'), plan.theme),
    line(t('md.direction'), plan.direction),
    plan.highlights.some((h) => has(h.text))
      ? `- **${t('plan.highlights')}**\n${plan.highlights.filter((h) => has(h.text)).map((h) => `  - ${text(h.text)}`).join('\n')}`
      : null,
    line(t('plan.curiosity'), plan.curiosity),
    line(t('plan.persona'), plan.persona),
    line(t('plan.resonance'), plan.resonance),
    values.length ? `- **${t('plan.values')}**: ${values.map((v) => `${v.name} (${v.desc})`).join(', ')}` : null,
    line(t('md.valueNote'), plan.valueNote),
  ]);
  out.push(planBlock || EMPTY(), '');

  out.push(`## 2. ${t('md.routeAndShots')}`, '');
  if (!p.places.length) out.push(EMPTY(), '');
  p.places.forEach((pl, i) => {
    const when = [formatDate(pl.date), pl.time].filter(Boolean).join(' ');
    out.push(`### ${i + 1}. ${pl.name || t('place.unnamed')}${when ? ` (${when})` : ''}`, '');
    const info = block([
      line(t('place.purpose'), pl.purpose),
      line(t('place.expectation'), pl.expectation),
      line(t('place.shotIdea'), pl.shotIdea),
      line(t('place.memo'), pl.memo),
    ]);
    if (info) out.push(info, '');
    if (pl.shots.length) {
      const st = shotStats(pl);
      out.push(`**${t('shots.title')}** (${t('md.doneOf', { done: st.done, total: st.total })})`, '');
      pl.shots.forEach((s) => {
        const type = SHOT_TYPES.find((x) => x.id === s.type);
        const memo = has(s.memo) ? ` — ${text(s.memo)}` : '';
        out.push(`- [${s.done ? 'x' : ' '}] ${type.name}: ${has(s.desc) ? text(s.desc) : t('md.noDesc')}${memo}`);
      });
      out.push('');
    }
  });

  out.push(`## 3. ${t('field.title')}`, '');
  const logs = [...p.logs].filter(logHasContent).sort((a, b) => a.createdAt - b.createdAt);
  if (!logs.length) out.push(EMPTY(), '');
  logs.forEach((l) => {
    out.push(`### ${logPlaceName(p, l)}${l.unplanned ? ` (${t('log.unplanned')})` : ''} · ${formatTimestamp(l.createdAt)}`, '');
    out.push(block(['expectWhy', 'expectWhat', 'experience', 'happened', 'feeling', 'good', 'bad', 'surprise', 'memo'].map((k) => line(t(`log.f.${k}`), l[k]))), '');
  });

  out.push(`## 4. ${t('md.story')}`, '');
  out.push(block([
    line(t('story.before'), plan.direction) ?? `- **${t('story.before')}**: (${t('md.notWritten')})`,
    line(t('story.after'), story.finalLine) ?? `- **${t('story.after')}**: (${t('md.notWritten')})`,
  ]), '');
  const flowKeys = ['expectation', 'discovery', 'experience', 'twist', 'feeling'];
  out.push(`### ${t('story.flow')}: ${flowKeys.map((k) => t(`story.${k}`)).join(' → ')}`, '');
  const flow = block(flowKeys.map((k) =>
    k === 'twist' && story.noTwist
      ? `- **${t('story.twist')}**: ${t('md.noTwist')}`
      : line(`${t(`story.${k}`)} (${t(`story.${k}.desc`)})`, story[k]),
  ));
  out.push(flow || EMPTY(), '');
  const extra = block(['emotion', 'hook', 'ending', 'editNote'].map((k) => line(t(`story.${k}`), story[k])));
  if (extra) out.push(extra, '');

  out.push(`## 5. ${t('md.scenes')}`, '');
  const total = totalSeconds(p.scenes);
  out.push(t('md.total', { total: formatDuration(total), min: formatDuration(p.target.min), max: formatDuration(p.target.max) }), '');
  if (!p.scenes.length) out.push(EMPTY(), '');
  p.scenes.forEach((s, i) => {
    const link = sceneLinkLabel(p, s.link);
    out.push(`### ${i + 1}. ${s.title || t('scene.unnamed')} (${t('dur.s', { s: s.seconds })})${s.highlight ? ` ★ ${t('scene.highlight')}` : ''}`, '');
    const body = block([
      link ? `- **${t('md.link')}**: ${link}` : null,
      line(t('scene.content'), s.content),
      line(t('scene.subtitle'), s.subtitle),
      line(t('scene.voiceover'), s.voiceover),
      line(t('scene.memo'), s.memo),
    ]);
    if (body) out.push(body, '');
  });

  out.push('---', '');
  out.push(`> ${t('md.exported', { when: formatTimestamp(now) })}`);
  out.push(`> ${t('md.aiTip')}`);
  out.push(`> ${t('md.aiTip2')}`, '');
  return out.join('\n');
}
