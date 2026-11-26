import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLECTOR_URL, cleanCovers, collectorStatus, followJob, parseKeywords, startCollect } from '../src/xhs/collector-client.js';
import { noteLink, parseEvidence } from '../src/xhs/search-evidence.js';

describe('noteLink', () => {
  const id = '64a1b2c3d4e5f6a7b8c9d0e1';
  it('opens the note with its access code', () => {
    const url = `https://www.xiaohongshu.com/explore/${id}?xsec_token=ABc%2B1_-=&xsec_source=pc_search`.replace('=&', '%3D&');
    expect(noteLink({ id, url })).toBe(url);
  });
  it('falls back to a title search when the link is missing, foreign or for another note', () => {
    const search = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent('가상 제목')}`;
    expect(noteLink({ id, title: '가상 제목', url: '' })).toBe(search);
    expect(noteLink({ id, title: '가상 제목', url: `https://www.xiaohongshu.com/explore/${id}` })).toBe(search);
    expect(noteLink({ id, title: '가상 제목', url: `https://evil.example/explore/${id}?xsec_token=a&xsec_source=pc_search` })).toBe(search);
    expect(noteLink({ id, title: '가상 제목', url: 'https://www.xiaohongshu.com/explore/ffffffffffffffff?xsec_token=a&xsec_source=pc_search' })).toBe(search);
    expect(noteLink({ id, title: '가상 제목', url: `javascript:alert(1)//https://www.xiaohongshu.com/explore/${id}` })).toBe(search);
  });
  it('keeps the link through parseEvidence', () => {
    const url = `https://www.xiaohongshu.com/explore/${id}?xsec_token=abc&xsec_source=pc_search`;
    const ev = parseEvidence({ schema: 'vlog-studio.xhs-search/1', keywords: [{ keyword: 'k', status: 'ok' }], notes: [{ id, keyword: 'k', url, approx: [] }] });
    expect(noteLink(ev.notes[0])).toBe(url);
  });
});

describe('cleanCovers', () => {
  it('keeps small image data URLs only', () => {
    const ok = 'data:image/webp;base64,UklGRg==';
    expect(cleanCovers({ '64a1b2c3d4e5f6a7': ok })).toEqual({ '64a1b2c3d4e5f6a7': ok });
    expect(
      cleanCovers({
        bad: ok, // id too short
        '64a1b2c3d4e5f6a8': 'https://evil.example/x.png',
        '64a1b2c3d4e5f6a9': 'data:image/svg+xml;base64,PHN2Zz4=',
        '64a1b2c3d4e5f6b0': 'data:image/webp;base64,"onerror="x',
        '64a1b2c3d4e5f6b1': `data:image/webp;base64,${'A'.repeat(200_001)}`,
      }),
    ).toEqual({});
    expect(cleanCovers(null)).toEqual({});
    expect(cleanCovers([ok])).toEqual({});
  });
});

describe('parseKeywords', () => {
  it('one per line, spaces inside a keyword kept', () => {
    expect(parseKeywords(' 海南  新家 \n\n小户型 收纳，租房改造\n海南 新家')).toEqual({ keywords: ['海南 新家', '小户型 收纳', '租房改造'], error: null });
  });
  it('limits', () => {
    expect(parseKeywords('  \n ').error).toBe('none');
    expect(parseKeywords('a\nb\nc\nd\ne\nf').error).toBe('many');
    expect(parseKeywords('x'.repeat(41)).error).toBe('long');
    expect(parseKeywords('x'.repeat(40)).error).toBe(null);
  });
});

describe('talking to the collector', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status, data) => Promise.resolve({ status, json: () => Promise.resolve(data) });

  it('status is null when the collector is off or something else answers', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('failed'))));
    expect(await collectorStatus()).toBe(null);
    vi.stubGlobal('fetch', vi.fn(() => reply(200, { app: 'other' })));
    expect(await collectorStatus()).toBe(null);
    vi.stubGlobal('fetch', vi.fn(() => reply(200, { app: 'vlog-studio-collector', busy: false })));
    expect((await collectorStatus()).busy).toBe(false);
  });

  it('only calls this computer', async () => {
    const fetch = vi.fn(() => reply(202, { id: 1 }));
    vi.stubGlobal('fetch', fetch);
    expect((await startCollect(['收纳'])).status).toBe(202);
    expect(fetch.mock.calls[0][0]).toBe(`${COLLECTOR_URL}/search`);
    expect(COLLECTOR_URL).toBe('http://127.0.0.1:47831');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ keywords: ['收纳'], details: 8 });
  });

  it('follows a job to the end, and gives up when the collector disappears', async () => {
    const jobs = [{ state: 'running', phase: 'keyword' }, { state: 'done', result: {} }];
    vi.stubGlobal('fetch', vi.fn(() => reply(200, jobs.shift())));
    const seen = [];
    expect((await followJob((j) => seen.push(j.state), { every: 0 })).state).toBe('done');
    expect(seen).toEqual(['running', 'done']);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('failed'))));
    expect(await followJob(() => {}, { every: 0, lostAfter: 2 })).toBe(null);
  });
});
