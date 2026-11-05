import { afterEach, describe, expect, it } from 'vitest';
import en from '../src/i18n/en.js';
import { applyLang, detectLang, t } from '../src/i18n/index.js';
import ko from '../src/i18n/ko.js';
import zh from '../src/i18n/zh.js';
import { STATUSES, labelOf } from '../src/lib/constants.js';
import { formatRelative } from '../src/lib/dates.js';
import { projectToMarkdown } from '../src/lib/markdown.js';
import { createProject, normalizePlace, normalizeShot } from '../src/lib/schema.js';

afterEach(() => applyLang('ko'));

describe('language detection', () => {
  it('follows the device language and falls back to English', () => {
    expect(detectLang(['zh-CN'])).toBe('zh');
    expect(detectLang(['zh-TW', 'en'])).toBe('zh');
    expect(detectLang(['ko-KR'])).toBe('ko');
    expect(detectLang(['en-GB'])).toBe('en');
    expect(detectLang(['ja-JP', 'ko'])).toBe('ko'); // first supported language in the list wins
    expect(detectLang(['ja-JP', 'fr'])).toBe('en');
    expect(detectLang([])).toBe('en');
  });
});

describe('dictionaries', () => {
  it('have exactly the same keys and placeholders in every language', () => {
    const keys = Object.keys(ko).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    expect(Object.keys(zh).sort()).toEqual(keys);
    const ph = (v) => (typeof v === 'string' ? [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : 'list');
    for (const k of keys) {
      expect(ph(en[k]), `en ${k}`).toEqual(ph(ko[k]));
      expect(ph(zh[k]), `zh ${k}`).toEqual(ph(ko[k]));
    }
  });

  it('switches every label, including the fixed lists', () => {
    applyLang('en');
    expect(t('tab.route')).toBe('Route');
    expect(labelOf(STATUSES, 'shooting')).toBe('Shooting');
    expect(t('home.found', { n: 2, total: 5 })).toBe('2 found · 5 total');
    applyLang('zh');
    expect(labelOf(STATUSES, 'shooting')).toBe('拍摄中');
    expect(formatRelative(Date.now())).toMatch(/^今天 \d\d:\d\d$/);
  });
});

describe('markdown export follows the UI language', () => {
  const sample = () => {
    const p = createProject({ name: 'Jeonju', startDate: '2026-11-05' });
    const place = normalizePlace({ name: 'Hanok Village' });
    place.shots.push(normalizeShot({ type: 'reaction', desc: 'first bite', done: true }));
    p.places.push(place);
    return p;
  };

  it('in English and Chinese, with no Korean left', () => {
    applyLang('en');
    const md = projectToMarkdown(sample());
    expect(md).toContain('## 1. Pre-shoot plan');
    expect(md).toContain('- [x] Reaction shot: first bite');
    expect(md).not.toMatch(/[가-힣]/);
    applyLang('zh');
    const mdZh = projectToMarkdown(sample());
    expect(mdZh).toContain('## 1. 前期策划');
    expect(mdZh).toContain('- [x] 反应镜头: first bite');
    expect(mdZh).not.toMatch(/[가-힣]/);
  });
});
