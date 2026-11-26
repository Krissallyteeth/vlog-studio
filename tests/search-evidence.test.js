import { describe, expect, it } from 'vitest';
import { SEARCH_SCHEMA, analyzeEvidence, buildBrief, checkAnswer, frequentTerms, hashtagsIn, longestShared, normalizeSearchPick, parseEvidence, tagKey, titleTraits } from '../src/xhs/search-evidence.js';
import { normalizePost } from '../src/xhs/store.js';

// Fictional search results only.
const note = (i, likes, extra = {}) => ({
  id: `aaaaaaaa${String(i).padStart(4, '0')}`,
  keyword: '收纳',
  rank: i,
  type: 'video',
  title: `普通标题${i}`,
  desc: null,
  tags: null,
  likes,
  collects: null,
  comments: null,
  shares: null,
  approx: [],
  author: { nickname: '测试', followers: null },
  detail: false,
  ...extra,
});

const file = (notes, keywords = [{ keyword: '收纳', status: 'ok', related: ['收纳技巧', '小户型收纳'] }]) => ({
  schema: SEARCH_SCHEMA,
  collectedAt: '2026-01-02T10:00:00+08:00',
  keywords,
  notes,
});

const sample = () =>
  file([
    note(1, 100, { title: '小户型收纳技巧🔥5个方法', tags: ['收纳技巧', '小户型'], desc: '今天分享我家的收纳方法，真的很实用。', detail: true, collects: 50 }),
    note(2, 20, { tags: ['收纳技巧'], detail: true }),
    note(3, 10, { tags: ['家居'], detail: true }),
    note(4, 12),
    note(5, 8),
    note(6, 11),
    note(7, 90, { title: '小户型收纳技巧！租房也能做', tags: ['小户型'], detail: true }),
    note(8, null),
  ]);

describe('parseEvidence', () => {
  it('rejects other files', () => {
    expect(() => parseEvidence({ schema: 'x', notes: [] })).toThrow('schema');
    expect(() => parseEvidence(null)).toThrow('schema');
  });

  it('keeps unknown values as null and drops broken or duplicate notes', () => {
    const ev = parseEvidence(file([note(1, null), note(1, 5), { id: 'bad id', keyword: '收纳' }, note(2, -3)]));
    expect(ev.notes).toHaveLength(2);
    expect(ev.notes[0].likes).toBeNull();
    expect(ev.notes[1].likes).toBeNull(); // negative is not a count
    expect(ev.notes[0].tags).toBeNull(); // not read ≠ no tags
  });
});

describe('analyzeEvidence', () => {
  it('finds notes far above the keyword median and keeps unscored notes out', () => {
    const an = analyzeEvidence(parseEvidence(sample()));
    const k = an.keywords[0];
    expect(k.scored).toBe(7);
    expect(k.unscored).toBe(1);
    expect(k.median).toBe(12);
    expect(k.hot.map((n) => n.likes)).toEqual([100, 90]);
    expect(k.patterns.hot.n).toBe(2);
    expect(k.patterns.hot.emoji).toBe(0.5);
    expect(k.terms.map((x) => x.term)).toEqual(['小户型收纳技巧']);
  });

  it('gives no median or candidates with fewer than 5 scored notes', () => {
    const an = analyzeEvidence(parseEvidence(file([note(1, 100), note(2, 1), note(3, 1), note(4, 1)])));
    expect(an.keywords[0].median).toBeNull();
    expect(an.keywords[0].hot).toEqual([]);
    expect(an.keywords[0].patterns).toBeNull();
  });

  it('counts hashtags only on notes whose tags were read', () => {
    const an = analyzeEvidence(parseEvidence(sample()));
    expect(an.tagNotes).toBe(4);
    const top = an.tags.find((x) => x.tag === '收纳技巧');
    expect(top.count).toBe(2);
    expect(top.medianLikes).toBe(60);
    expect(an.related).toEqual(['收纳技巧', '小户型收纳']);
  });
});

describe('titles and terms', () => {
  it('reads simple title traits', () => {
    expect(titleTraits('3个方法🔥真的吗？')).toEqual({ length: 9, digits: true, emoji: true, question: true, exclaim: false });
  });
  it('keeps the longer repeated word and skips the keyword', () => {
    const terms = frequentTerms(['收纳技巧大全', '我的收纳技巧'], ['收纳']).map((x) => x.term);
    expect(terms).toEqual(['收纳技巧']);
  });
});

describe('brief and answer check', () => {
  it('writes a brief with note references, hot marks and "not collected" labels', () => {
    const ev = parseEvidence(sample());
    const brief = buildBrief(ev, analyzeEvidence(ev), { topic: '小户型租房收纳' });
    expect(brief).toContain('[내 주제] 小户型租房收纳');
    expect(brief).toMatch(/N1 \[爆款 후보\] "小户型收纳技巧🔥5个方法"/);
    expect(brief).toContain('#收纳技巧 (2 / 60)');
    expect(brief).toContain('수집 미수집'); // collects unknown is not written as 0
  });

  it('copies everything steps 1 and 2 show: every note of every keyword, no empty topic line', () => {
    const many = (kw, n) => Array.from({ length: n }, (_, i) => ({ ...note(i + 1, 10 + i), id: `${kw === 'a' ? 'aa' : 'bb'}${String(i).padStart(10, '0')}`, keyword: kw }));
    const ev = parseEvidence(file([...many('a', 25), ...many('b', 25)], [{ keyword: 'a', status: 'ok', related: null }, { keyword: 'b', status: 'empty', related: null }]));
    const brief = buildBrief(ev, analyzeEvidence(ev));
    expect(brief).toContain('[노트 · a] 25개');
    expect(brief).toContain('[노트 · b] 25개');
    expect(brief).toContain('N50 ');
    expect(brief).toContain('(小红书가 결과 0개라고 답함)');
    expect(brief).toContain('좋아요 미수집 0개');
    expect(brief).not.toContain('[내 주제]');
  });

  it('finds hashtags in both spellings', () => {
    expect(hashtagsIn('#收纳技巧 #小户型[话题]# 文字#家居')).toEqual(['收纳技巧', '小户型', '家居']);
    expect(tagKey('#Home Tour[话题]#')).toBe('hometour');
  });

  it('marks hashtags that are not in the evidence and lines copied from a note', () => {
    const ev = parseEvidence(sample());
    const res = checkAnswer('新标题：我家十平米的改造日记\n今天分享我家的收纳方法，真的很实用\n#收纳技巧 #爆改出租屋', ev);
    expect(res.unknownTags).toEqual(['爆改出租屋']);
    expect(res.tags.find((x) => x.tag === '收纳技巧').known).toBe(true);
    expect(res.similar).toHaveLength(1);
    expect(res.similar[0].part).toBe('desc');
  });

  it('cannot judge hashtags when no tags were collected', () => {
    const ev = parseEvidence(file([note(1, 5)]));
    const res = checkAnswer('#收纳', ev);
    expect(res.tagsCollected).toBe(false);
    expect(res.tags[0].known).toBeNull();
    expect(res.unknownTags).toEqual([]);
  });

  it('measures the longest shared text', () => {
    expect(longestShared('abcdef', 'zzcdez')).toBe(3);
  });
});

describe('saved pick on a post', () => {
  it('is kept on the post and empty picks are dropped', () => {
    const p = normalizePost({ title: 't', searchPick: { title: '新标题', tags: ['#收纳技巧', '收纳技巧', ' '], keywords: ['收纳'], savedAt: 5 } });
    expect(p.searchPick).toEqual({ title: '新标题', tags: ['收纳技巧'], keywords: ['收纳'], evidenceAt: '', unknownTags: [], savedAt: 5 });
    expect(normalizePost({ searchPick: { title: '', tags: [] } }).searchPick).toBeNull();
    expect(normalizeSearchPick(null)).toBeNull();
  });
});
