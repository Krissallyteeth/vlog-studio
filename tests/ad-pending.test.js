import { describe, expect, it } from 'vitest';
import { adInWindow } from '../src/xhs/ad-report.js';
import { adTotals } from '../src/xhs/stats.js';
import { memoAds, placeOrder } from '../src/xhs/ad-orders.js';
import { normalizeAd, normalizePost } from '../src/xhs/store.js';

// Synthetic post and order (made-up numbers).
describe('an ad told on the D+2 screenshots, results to come', () => {
  const post = () => normalizePost({ id: 'p', date: '2026-11-21', validity: '유효', d1: { views: 300 }, d2: { views: 700 }, ads: [normalizeAd({ stage: 'D+1', executed: true, pending: true })] });

  it('makes D+2 count as "with ads" right away, and is a record the order can replace', () => {
    const p = post();
    expect(p.ads[0].pending).toBe(true);
    expect(adInWindow(p, 'd2').any).toBe(true);
    expect(adInWindow(p, 'd1').any).toBe(false);
    expect(memoAds(p)).toHaveLength(1);
  });

  it('is replaced by the order screenshot: one ad, its real spend, no longer pending', () => {
    const p = post();
    const order = normalizeAd({ stage: 'D+1', executed: true, start: '2026-11-22T10:00', spend: 60, orderNo: 'abc', order: { reads: 120, follows: 9 } });
    placeOrder([p], [{ postId: 'p', ad: order }]);
    expect(p.ads).toHaveLength(1);
    expect(p.ads[0]).toMatchObject({ spend: 60, orderNo: 'abc', pending: false });
    expect(adTotals([p]).spend).toBe(60);
  });
});
