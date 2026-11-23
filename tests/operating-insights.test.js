import { describe, expect, it } from 'vitest';
import { operatingInsights, reachCheck } from '../src/xhs/operating-insights.js';
import { normalizePost } from '../src/xhs/store.js';

const baseline = { medians: { views: 400, exposure: 2_000, ctr: 0.15, retain5s: 0.6, exit2s: 0.2 } };
const post = (id = 'A', d1 = {}, extra = {}) => normalizePost({
  id,
  date: '2026-01-10',
  validity: '유효',
  d1: { ...baseline.medians, ...d1 },
  ...extra,
});

describe('operating insights', () => {
  it.each([
    [{ exposure: 3000, ctr: 0.08, views: 220 }, 'cover'],
    [{ exposure: 900, ctr: 0.17, views: 180 }, 'distribution'],
    [{ exposure: 900, ctr: 0.08, views: 180 }, 'both'],
    [{ retain5s: 0.4 }, 'opening'],
    [{ views: 80 }, 'unclear'],
    [{ ctr: null }, 'missing'],
  ])('distinguishes weak exposure, clicking and opening before suggesting a change (%j)', (inputs, status) => {
    expect(reachCheck(post('A', inputs), baseline).status).toBe(status);
  });

  it('excludes a same-day ad even when the post and order labels suggest an organic D+1', () => {
    const mixed = post('A', { views: 1000 }, { shootRegion: 'cn', ads: [{ stage: 'D+1', start: '2026-01-10T21:30' }] });
    const valid = post('B', { views: 430 }, { shootRegion: 'cn', ads: [{ stage: 'D+1', start: '2026-01-11T13:00' }] });
    const unset = post('C');
    const missing = post('D', { views: null }, { shootRegion: 'kr' });
    const data = operatingInsights([mixed, valid, unset, missing], baseline);
    expect(reachCheck(mixed, baseline).status).toBe('mixed');
    expect(data.regions.cn.metrics.views).toEqual({ n: 1, value: 430 });
    expect(data.regions.kr.n).toBe(0);
    expect(data.untagged).toBe(1);
  });

  it('pairs the same D+1 posts per metric rather than comparing unmatched channels', () => {
    const mk = (id, home, video) => post(id, {}, { d1Meta: { channels: { home, videoRec: video } } });
    const cases = [
      mk('A', { avgWatch: 12, shareViews: 0.4, interactionRate: 0.1 }, { avgWatch: 5, shareViews: 0.5, interactionRate: 0 }),
      mk('B', { avgWatch: 50, shareViews: 0.7, interactionRate: 0.2 }, { shareViews: 0.2 }),
      mk('C', {}, { avgWatch: 2, shareViews: 0.9 }),
    ];
    const { channels } = operatingInsights(cases, baseline);
    expect(channels.watch).toEqual({ n: 1, home: 12, video: 5 });
    expect(channels.share).toMatchObject({ n: 2, home: 0.55, video: 0.35 });
    expect(channels.reaction).toEqual({ n: 1, home: 0.1, video: 0 });
  });

  it('counts a shared ad order once and keeps reported zero followers in paid totals', () => {
    const ads = (extra) => [{ spend: 30, orderSpend: 60, goal: '关注', stage: 'D+2', order: { follows: 20 }, ...extra }];
    const cases = [
      post('A', {}, { ads: ads({ groupKey: 'shared' }) }),
      post('B', {}, { ads: ads({ groupKey: 'shared' }) }),
      post('C', {}, { ads: ads({ order: { follows: 0 } }) }),
      post('D', {}, { ads: ads({ order: {} }) }),
    ];
    const { follow, late } = operatingInsights(cases, baseline).ads;
    expect(follow).toEqual({ n: 2, per100: 100 / 6, cost: 6 });
    expect(late).toEqual({ n: 1, per100: 0, cost: null });
  });
});
