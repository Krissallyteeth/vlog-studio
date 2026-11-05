import { t } from '../i18n/index.js';

const filled = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : Boolean(v));
const ratio = (count, enough) => Math.min(1, count / enough);

export function shotStats(place) {
  const total = place.shots.length;
  const done = place.shots.filter((s) => s.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function allShotStats(project) {
  const shots = project.places.flatMap((p) => p.shots);
  const done = shots.filter((s) => s.done).length;
  return { done, total: shots.length, pct: shots.length ? Math.round((done / shots.length) * 100) : 0 };
}

export function logHasContent(log) {
  return ['expectWhy', 'expectWhat', 'experience', 'happened', 'feeling', 'good', 'bad', 'surprise', 'memo'].some((k) =>
    filled(log[k]),
  );
}

/** Per-section completion (0–1). Nothing is mandatory; a few answers already count as "done". */
export function sectionProgress(p) {
  const { plan, story } = p;
  const planCount = [plan.theme, plan.direction, plan.highlights, plan.curiosity, plan.persona, plan.resonance, plan.values]
    .filter(filled).length;
  const storyCount = [story.expectation, story.discovery, story.experience, story.twist || story.noTwist, story.feeling,
    story.finalLine, story.emotion, story.hook, story.ending].filter(filled).length;
  const shots = allShotStats(p);
  return {
    plan: ratio(planCount, 4),
    route: p.places.length ? 1 : 0,
    shots: shots.total ? shots.done / shots.total : 0,
    field: p.logs.some(logHasContent) ? 1 : 0,
    story: ratio(storyCount, 4),
    edit: p.scenes.length ? 1 : 0,
  };
}

export function projectProgress(p) {
  const values = Object.values(sectionProgress(p));
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100);
}

export const totalSeconds = (scenes) => scenes.reduce((sum, s) => sum + (Number.isFinite(s.seconds) ? s.seconds : 0), 0);

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Human length in the UI language: "1분 30초" / "1m 30s" / "1分30秒". */
export function formatDurationText(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return t('dur.s', { s: r });
  return r ? t('dur.ms', { m, s: r }) : t('dur.m', { m });
}
