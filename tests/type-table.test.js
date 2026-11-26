import { afterEach, describe, expect, it } from 'vitest';
import { applyLang } from '../src/i18n/index.js';
import { isYes, mergeInto, splitTypes } from '../src/xhs/excel-import.js';
import { normalizePost } from '../src/xhs/store.js';
import { moveToSponsored, sponsorTypePosts, subTagCompare, typeTable } from '../src/xhs/type-table.js';
import { typeTableHtml } from '../src/views/xhs/type-table.js';

// Fictional numbers only.
afterEach(() => applyLang('ko'));

let n = 0;
const mk = (type, views, followers, extra = {}) => normalizePost({ id: `p${++n}`, date: `2026-01-${String(n).padStart(2, '0')}`, validity: '유효', contentType: type, d1: { views, ctr: 0.1, newFollowers: followers }, ...extra });

describe('normalizePost', () => {
  it('keeps secondary tags apart from the main type and the sponsored flag as a boolean', () => {
    const p = normalizePost({ contentType: '여행', subTypes: ['일상', '여행', ' 일상 ', ''], sponsored: 'yes' });
    expect(p.subTypes).toEqual(['일상']);
    expect(p.sponsored).toBe(false);
    expect(normalizePost({ sponsored: true }).sponsored).toBe(true);
  });
});

describe('typeTable', () => {
  const posts = [mk('인테리어', 100, 3), mk('인테리어', 200, 4), mk('인테리어', 100, 2, { sponsored: true }), mk('여행', 400, 2), mk('여행', 300, 1), mk('여행', 100, null), mk('위스키', 100, 1), mk('여행', 900, 9, { validity: '광고혼입' })];

  it('counts each valid post once by main type, with medians and a reference mark under 3 posts', () => {
    const { rows, total } = typeTable(posts);
    expect(total).toBe(7);
    const by = Object.fromEntries(rows.map((r) => [r.type, r]));
    expect(by['인테리어']).toMatchObject({ n: 3, views: 100, followRate: 0.02, newFollowers: 3, sponsored: 1, reference: false });
    expect(by['여행']).toMatchObject({ n: 3, followRate: (0.005 + 1 / 300) / 2, followRateN: 2 }); // blank followers is not 0
    expect(by['위스키'].reference).toBe(true);
    expect(rows[0].type).toBe('인테리어'); // highest follow rate first
  });

  it('can leave sponsored posts out', () => {
    const by = Object.fromEntries(typeTable(posts, { sponsored: 'exclude' }).rows.map((r) => [r.type, r]));
    expect(by['인테리어'].n).toBe(2);
  });
});

describe('subTagCompare', () => {
  it('compares posts with and without a tag only with 2+ on each side', () => {
    const posts = [mk('여행', 100, 1, { subTypes: ['일상'] }), mk('일상', 100, 3), mk('여행', 100, 2), mk('여행', 100, 4), mk('위스키', 100, 1, { subTypes: ['일상'] })];
    const [x] = subTagCompare(posts);
    expect(x).toMatchObject({ tag: '일상', comparable: true });
    expect(x.with.n).toBe(3);
    expect(x.without.n).toBe(2);
    expect(subTagCompare([mk('여행', 100, 1, { subTypes: ['일상'] }), mk('여행', 100, 1)])[0].comparable).toBe(false);
  });
});

describe('moving the sponsored type', () => {
  it('flags the post and sets the chosen main type, nothing else', () => {
    const p = mk('협찬 콘텐츠', 100, 1, { subTypes: ['위스키', '일상'], memo: 'keep' });
    expect(sponsorTypePosts([p, mk('여행', 1, 1)])).toHaveLength(1);
    const moved = normalizePost(moveToSponsored(p, '위스키'));
    expect(moved).toMatchObject({ sponsored: true, contentType: '위스키', subTypes: ['일상'], memo: 'keep' });
    expect(moveToSponsored(p, '협찬 콘텐츠').contentType).toBe('');
  });
});

describe('Excel app columns', () => {
  it('reads tags and the flag written by the export, and keeps app values when merging', () => {
    expect(splitTypes('일상, 위스키，여행')).toEqual(['일상', '위스키', '여행']);
    expect(splitTypes(null)).toEqual([]);
    expect([isYes('Y'), isYes('o'), isYes(''), isYes('N')]).toEqual([true, true, false, false]);
    const existing = mk('여행', 1, 1, { subTypes: ['일상'], sponsored: true });
    const merged = mergeInto(existing, normalizePost({ title: 'x', d1: {}, d2: {} }));
    expect(merged).toMatchObject({ subTypes: ['일상'], sponsored: true, contentType: '여행' });
  });
});

describe('card text', () => {
  it.each(['ko', 'en', 'zh'])('renders without raw keys in %s', (lang) => {
    applyLang(lang);
    const html = typeTableHtml([mk('협찬 콘텐츠', 100, 1), mk('여행', 100, 1, { subTypes: ['일상'] })]);
    expect(html).not.toMatch(/\btt\.[a-z]/);
    expect(html).toContain('data-tt-move');
  });
});

describe('sponsored switch message', () => {
  it('says when there is nothing to leave out', () => {
    applyLang('ko');
    expect(typeTableHtml([mk('여행', 100, 1)])).toContain('협찬으로 체크된 유효 글이 없어서');
    expect(typeTableHtml([mk('여행', 100, 1, { sponsored: true })])).toContain('협찬 글 1편이 들어가 있어요');
  });
});
