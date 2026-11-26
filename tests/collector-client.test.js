import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLECTOR_URL, cleanCovers, collectorStatus, followJob, parseKeywords, startCollect } from '../src/xhs/collector-client.js';

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
