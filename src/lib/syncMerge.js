import { migrateProject } from './schema.js';

/**
 * Decides how rows pulled from the server change this device. Last write wins, per project,
 * by the project's own `updatedAt` (deletions carry the time they happened).
 *
 * rows:    [{ id, data, updated_at, deleted }] from the server
 * local:   Map id -> updatedAt of projects on this device
 * pending: Set of ids with unsent local changes (those are uploaded next, never overwritten here)
 *
 * Returns { put: [project], remove: [id], requeue: [id] } — requeue = this device has the newer copy.
 */
export function planPull(rows, local, pending) {
  const put = [];
  const remove = [];
  const requeue = [];
  for (const row of rows) {
    if (!row?.id || pending.has(row.id)) continue;
    const mine = local.get(row.id);
    const theirs = Number(row.updated_at) || 0;
    if (row.deleted) {
      if (mine === undefined) continue;
      if (mine > theirs) requeue.push(row.id);
      else remove.push(row.id);
      continue;
    }
    if (mine !== undefined && mine > theirs) {
      requeue.push(row.id);
      continue;
    }
    if (mine !== undefined && mine === theirs) continue;
    try {
      const p = migrateProject(row.data, row.data?.schemaVersion ?? 1);
      if (p.id === row.id) put.push(p);
    } catch {
      /* a broken row on the server never breaks this device */
    }
  }
  return { put, remove, requeue };
}

/** Outbox entries -> rows for the server. Missing local projects that are not deletions are dropped. */
export function buildPush(outbox, projectsById) {
  const rows = [];
  for (const entry of outbox) {
    if (entry.deleted) {
      rows.push({ id: entry.id, data: null, updated_at: entry.at, deleted: true });
      continue;
    }
    const p = projectsById.get(entry.id);
    if (p) rows.push({ id: p.id, data: p, updated_at: p.updatedAt, deleted: false });
  }
  return rows;
}
