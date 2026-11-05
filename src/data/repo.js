import {
  deleteProjectRecord,
  getAllProjects,
  getMeta,
  getProjectRecord,
  putProject,
  putProjects,
  replaceAllProjects,
  setMeta,
} from './db.js';
import { buildBackup, cloneProject, createProject, migrateProject } from '../lib/schema.js';
import { now } from '../lib/ids.js';

const load = (raw) => migrateProject(raw, raw.schemaVersion ?? 1);

// The sync engine subscribes here to upload soon after any local change.
const changeListeners = new Set();
export function onLocalChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
const changed = () => changeListeners.forEach((fn) => fn());

export async function listProjects() {
  return (await getAllProjects()).map(load);
}

export async function getProject(id) {
  const raw = await getProjectRecord(id);
  return raw ? load(raw) : null;
}

/** Persists the project; `touch` bumps updatedAt (sorting by shoot date ignores it). */
export async function saveProject(project, { touch = true } = {}) {
  if (touch) project.updatedAt = now();
  await putProject(project);
  changed();
  return project;
}

export async function createNewProject(input) {
  const project = createProject(input, now());
  await putProject(project);
  changed();
  return project;
}

export async function duplicateProject(id) {
  const src = await getProject(id);
  if (!src) throw new Error('원본 프로젝트를 찾을 수 없어요.');
  const copy = cloneProject(src, now());
  await putProject(copy);
  changed();
  return copy;
}

export async function deleteProject(id) {
  await deleteProjectRecord(id, now());
  changed();
}

export async function exportBackup() {
  const backup = buildBackup(await listProjects());
  await setMeta('lastBackupAt', Date.now());
  return backup;
}

/** mode "merge": add / overwrite by id. mode "replace": wipe everything first. */
export async function importProjects(projects, mode) {
  // A restore should win over copies on other devices, so restored projects count as edited now.
  const t = now();
  projects.forEach((p) => (p.updatedAt = t));
  if (mode === 'replace') await replaceAllProjects(projects, t);
  else await putProjects(projects, t);
  changed();
  return projects.length;
}

export const getLastBackupAt = () => getMeta('lastBackupAt');
