import { ackOutbox, applyRemoteXhs, getAll, getMetaValue, getOutbox, putMany, queueAllXhs, setMetaValue } from './db.js';
import { notifyChanged } from './store.js';

/*
 * Syncs 小红书 records (posts, income, settings/baselines — not screenshots) with the
 * "xhs_records" table, using the same rules as projects: this device stays the source of truth,
 * local changes go up from the outbox, newer edits win (by updatedAt), deletions travel too.
 *
 * First sync on a device: the server is read first and posts / income that exist on both sides
 * under different ids (the same Excel imported on two devices) are merged by date + title, so
 * nothing is duplicated.
 */

const STORE = { post: 'posts', income: 'income', meta: 'meta' };
const PAGE = 500;
const OVERLAP_MS = 5000;

const naturalKey = {
  post: (p) => `${p.date}|${String(p.title ?? '').replace(/\s+/g, '').toLowerCase()}`,
  income: (x) => `${x.date}|${x.brand}|${x.content}`,
};
const stamp = (kind, rec) => (kind === 'meta' ? rec?.updatedAt ?? 0 : rec?.updatedAt ?? 0);

async function pull(client, since) {
  const out = [];
  let cursor = since;
  for (;;) {
    let q = client.from('xhs_records').select('kind,id,data,updated_at,deleted,server_updated_at').order('server_updated_at').limit(PAGE);
    if (cursor) q = q.gt('server_updated_at', cursor);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) break;
    cursor = data.at(-1).server_updated_at;
  }
  return out;
}

async function push(client) {
  const outbox = await getOutbox();
  if (!outbox.length) return 0;
  const recs = {};
  for (const s of Object.values(STORE)) recs[s] = new Map((await getAll(s)).map((x) => [s === 'meta' ? x.key : x.id, x]));
  const rows = [];
  for (const e of outbox) {
    if (e.deleted) {
      rows.push({ kind: e.kind, id: e.id, data: null, updated_at: e.at, deleted: true });
      continue;
    }
    const rec = recs[STORE[e.kind]].get(e.id);
    if (!rec) continue;
    rows.push({ kind: e.kind, id: e.id, data: e.kind === 'meta' ? { value: rec.value } : rec, updated_at: Math.max(stamp(e.kind, rec), 1), deleted: false });
  }
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await client.rpc('push_xhs', { rows: rows.slice(i, i + 50) });
    if (error) throw error;
  }
  await ackOutbox(outbox);
  return rows.length;
}

/** Applies server rows; returns true when something on this device changed. */
async function apply(rows) {
  if (!rows.length) return false;
  const pending = new Set((await getOutbox()).map((e) => e.key));
  const local = {};
  for (const s of Object.values(STORE)) local[s] = new Map((await getAll(s)).map((x) => [s === 'meta' ? x.key : x.id, x]));
  const put = {};
  const remove = {};
  let requeue = [];
  for (const r of rows) {
    const store = STORE[r.kind];
    if (!store || pending.has(`${r.kind}:${r.id}`)) continue;
    const mine = local[store].get(r.id);
    const mineAt = stamp(r.kind, mine);
    const theirs = Number(r.updated_at) || 0;
    if (mine && mineAt > theirs) {
      requeue.push({ store, rec: mine });
      continue;
    }
    if (r.deleted) {
      if (mine) (remove[store] ??= []).push(r.id);
      continue;
    }
    if (mine && mineAt === theirs) continue;
    const rec = r.kind === 'meta' ? { key: r.id, value: r.data?.value, updatedAt: theirs } : { ...r.data, id: r.id };
    (put[store] ??= []).push(rec);
  }
  await applyRemoteXhs({ put, remove });
  for (const { store, rec } of requeue) await putMany(store, [rec]); // ours is newer: upload again
  return Object.keys(put).length > 0 || Object.keys(remove).length > 0;
}

/** First sync on this device: merge records that exist on both sides under different ids. */
async function reconcile(rows) {
  const remote = { post: new Map(), income: new Map() };
  for (const r of rows) if (!r.deleted && naturalKey[r.kind]) remote[r.kind].set(naturalKey[r.kind](r.data ?? {}), r);
  const put = {};
  const remove = {};
  for (const kind of ['post', 'income']) {
    const store = STORE[kind];
    for (const mine of await getAll(store)) {
      const twin = remote[kind].get(naturalKey[kind](mine));
      if (!twin || twin.id === mine.id) continue;
      // Same record under two ids: keep the server's id, and the newer content.
      const newer = (mine.updatedAt ?? 0) > (Number(twin.updated_at) || 0) ? { ...mine, id: twin.id } : { ...twin.data, id: twin.id };
      (remove[store] ??= []).push(mine.id);
      (put[store] ??= []).push(newer);
    }
  }
  await applyRemoteXhs({ put, remove });
}

/** One sync round for 小红书 data. Called by the main sync engine while signed in. */
export async function xhsRound(client, user) {
  const marker = await getMetaValue('local:syncUser');
  const cursorKey = `local:pulledAt:${user.id}`;
  let changed = false;
  if (marker !== user.id) {
    // First sync for this account on this device: read everything, merge twins, then upload ours.
    const all = await pull(client, null);
    await reconcile(all);
    changed = await apply(all);
    await queueAllXhs();
    await push(client);
    if (all.length) await setMetaValue(cursorKey, all.at(-1).server_updated_at);
    await setMetaValue('local:syncUser', user.id);
    if (changed || all.length) notifyChanged();
    return;
  }
  await push(client);
  const last = await getMetaValue(cursorKey);
  const rows = await pull(client, last ? new Date(Date.parse(last) - OVERLAP_MS).toISOString() : null);
  if (rows.length) {
    changed = await apply(rows);
    await setMetaValue(cursorKey, rows.at(-1).server_updated_at);
    if ((await getOutbox()).length) await push(client);
  }
  if (changed) notifyChanged();
}
