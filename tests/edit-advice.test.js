import { describe, expect, it } from 'vitest';
import { analysePost } from '../src/xhs/analysis.js';
import { postFocus } from '../src/xhs/insights.js';
import { noteMetaHtml } from '../src/views/xhs/note-meta.js';

const baseline = { medians: { exit2s: 0.2, retain5s: 0.7, exposure: 200, views: 100 } };
const makePost = (intro) => ({ id: 'synthetic', validity: '유효', experiments: intro ? { intro } : {}, d1: { exit2s: 0.4, retain5s: 0.3, exposure: 80, views: 30 }, d1Meta: { ai: { metrics: { retain5s: { tip: 'UNVERIFIED_SUGGESTION' } }, audience: { text: 'UNVERIFIED_SUGGESTION' } } } });
describe('editing advice evidence', () => {
  it.each([['있음', 'hookIntro'], ['없음', 'hookNoIntro'], [undefined, 'hook']])('uses recorded intro status %s', (intro, expected) => {
    expect(analysePost(makePost(intro), [], baseline).advice).toEqual([expected]);
  });
  it('does not promote platform prose into recommendations or displayed analysis', () => {
    const post = makePost('없음');
    expect(postFocus(post, [], baseline).items.some(x => x.key === 'aiTip')).toBe(false);
    expect(noteMetaHtml(post.d1Meta, post)).not.toContain('UNVERIFIED_SUGGESTION');
    expect(post.d1Meta.ai.audience.text).toBe('UNVERIFIED_SUGGESTION');
  });
});
