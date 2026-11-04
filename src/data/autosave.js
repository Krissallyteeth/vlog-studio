import { saveProject } from './repo.js';

// Debounced, per-project saver. Writes for one project are chained so they land in order,
// and anything pending is flushed on navigation, tab hide and page close.

const pending = new Map(); // projectId -> { project, timer }
const chains = new Map(); // projectId -> Promise of the latest write
const listeners = new Set();
let status = 'idle';

function emit(next, error) {
  status = next;
  listeners.forEach((fn) => fn(next, error));
}

export function onSaveStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function write(project) {
  emit('saving');
  const prev = chains.get(project.id) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => saveProject(project));
  chains.set(project.id, next);
  return next.then(
    () => {
      if (chains.get(project.id) === next) chains.delete(project.id);
      if (!pending.size && !chains.size) emit('saved');
      return project;
    },
    (err) => {
      if (chains.get(project.id) === next) chains.delete(project.id);
      emit('error', err);
      throw err;
    },
  );
}

function flush(id) {
  const entry = pending.get(id);
  if (!entry) return chains.get(id) ?? Promise.resolve();
  clearTimeout(entry.timer);
  pending.delete(id);
  return write(entry.project);
}

export function scheduleSave(project, delay = 600) {
  const entry = pending.get(project.id);
  if (entry) clearTimeout(entry.timer);
  const timer = setTimeout(() => flush(project.id).catch(() => {}), delay);
  pending.set(project.id, { project, timer });
  emit('pending');
}

export function saveNow(project) {
  const entry = pending.get(project.id);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(project.id);
  }
  return write(project);
}

export async function flushAll() {
  await Promise.all([...pending.keys()].map(flush));
  await Promise.all([...chains.values()]);
}

export const hasPendingSaves = () => pending.size > 0 || chains.size > 0;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll().catch(() => {});
  });
  window.addEventListener('pagehide', () => flushAll().catch(() => {}));
}
