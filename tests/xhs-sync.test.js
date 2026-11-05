import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeXhsDB, getAll, getOutbox, setMetaValue } from '../src/xhs/db.js';
import { deletePost, listPosts, savePosts } from '../src/xhs/store.js';
import { xhsRound } from '../src/xhs/sync-xhs.js';

// Synthetic data only. A tiny in-memory stand-in for the Supabase table + push_xhs RPC.
function fakeServer() {
  const rows = new Map();
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const client = {
    rows,
    rpc(name, { rows: list }) {
      if (name !== 'push_xhs') throw new Error(name);
      for (const r of list) {
        const key = `${r.kind}:${r.id}`;
        const cur = rows.get(key);
        if (cur && !(r.updated_at > cur.updated_at)) continue; // newest edit wins
        rows.set(key, { kind: r.kind, id: r.id, data: r.deleted ? null : structuredClone(r.data), updated_at: r.updated_at, deleted: !!r.deleted, server_updated_at: new Date((clock += 1000)).toISOString() });
      }
      return Promise.resolve({ error: null });
    },
    from() {
      let since = null;
      let limit = Infinity;
      const q = {
        select: () => q,
        order: () => q,
        limit: (n) => ((limit = n), q),
        gt: (_col, v) => ((since = v), q),
        then(resolve) {
          const data = [...rows.values()].filter((r) => !since || r.server_updated_at > since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, limit);
          resolve({ data: structuredClone(data), error: null });
        },
      };
      return q;
    },
  };
  return client;
}

const user = { id: 'user-1' };
const post = (id, title, date, extra = {}) => ({ id, title, date, validity: '유효', d1: { exposure: 100, views: 10 }, ...extra });

async function freshDevice() {
  await closeXhsDB();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('vlog-studio-xhs');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  });
}

describe('xhs sync between devices', () => {
  let server;
  beforeEach(async () => {
    server = fakeServer();
    await freshDevice();
  });

  it('uploads posts, then another device receives them', async () => {
    await savePosts([post('a', 'Seoul day', '2026-01-02')]);
    await xhsRound(server, user);
    expect(server.rows.get('post:a').data.title).toBe('Seoul day');
    expect(await getOutbox()).toEqual([]);

    await freshDevice(); // "the phone"
    await xhsRound(server, user);
    expect((await listPosts()).map((p) => p.title)).toEqual(['Seoul day']);
  });

  it('never uploads device-only meta keys', async () => {
    await setMetaValue('settings', { contentTypes: ['x'] });
    await xhsRound(server, user);
    expect([...server.rows.keys()].some((k) => k.startsWith('meta:local:'))).toBe(false);
    expect(server.rows.has('meta:settings')).toBe(true);
  });

  it('merges the same Excel imported on two devices instead of duplicating', async () => {
    await savePosts([post('pc-1', 'Seoul  Day', '2026-01-02')]);
    await xhsRound(server, user);

    await freshDevice();
    await savePosts([post('phone-1', 'seoul day', '2026-01-02'), post('phone-2', 'Busan', '2026-01-03')]);
    await xhsRound(server, user);
    const ids = (await listPosts()).map((p) => p.id).sort();
    expect(ids).toEqual(['pc-1', 'phone-2']);
    expect([...server.rows.keys()].filter((k) => k.startsWith('post:')).sort()).toEqual(['post:pc-1', 'post:phone-2']);
  });

  it('newer edit wins and deletions travel to the other device', async () => {
    await savePosts([post('a', 'Old', '2026-01-02')]);
    await xhsRound(server, user);
    // Another device edits later.
    const r = server.rows.get('post:a');
    await server.rpc('push_xhs', { rows: [{ kind: 'post', id: 'a', data: { ...r.data, title: 'New' }, updated_at: r.updated_at + 1, deleted: false }] });
    await xhsRound(server, user);
    expect((await listPosts())[0].title).toBe('New');

    await new Promise((res) => setTimeout(res, 5)); // the delete happens later
    await deletePost('a');
    await xhsRound(server, user);
    expect(server.rows.get('post:a').deleted).toBe(true);
    expect(await getAll('posts')).toEqual([]);
  });
});
