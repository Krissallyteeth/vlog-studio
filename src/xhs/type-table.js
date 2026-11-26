import { median, stage, validPosts } from './stats.js';

/*
 * Which kind of content brings followers. Counted by the main type only (each post once), on valid
 * D+1 records (no ads before the cut). Secondary tags overlap, so they are only compared as
 * "with the tag vs without", always for reference. Sponsored posts are a flag, not a type.
 */

export const REF_UNDER = 3; // fewer posts than this: "for reference"
export const SIDE_MIN = 2; // a with/without comparison needs this many posts on each side
/** Names used for sponsored content when it was a type; moved to the sponsored flag on request. */
export const SPONSOR_TYPES = ['협찬 콘텐츠', '협찬', '赞助', '合作', 'Sponsored'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const followRate = (p) => {
  const s = stage(p);
  return isNum(s.newFollowers) && isNum(s.views) && s.views > 0 ? s.newFollowers / s.views : null;
};
const med = (list, fn) => median(list.map(fn).filter(isNum));

function summary(list) {
  return {
    n: list.length,
    views: med(list, (p) => stage(p).views),
    ctr: med(list, (p) => stage(p).ctr),
    followRate: med(list, followRate),
    followRateN: list.filter((p) => isNum(followRate(p))).length,
    newFollowers: med(list, (p) => stage(p).newFollowers),
    sponsored: list.filter((p) => p.sponsored).length,
  };
}

/** One row per main type. `sponsored`: 'include' (default) or 'exclude'. */
export function typeTable(posts, { sponsored = 'include' } = {}) {
  const valid = validPosts(posts).filter((p) => sponsored !== 'exclude' || !p.sponsored);
  const groups = new Map();
  for (const p of valid) {
    const type = p.contentType || '';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(p);
  }
  const rows = [...groups].map(([type, list]) => ({ type, ...summary(list), reference: list.length < REF_UNDER }));
  rows.sort((a, b) => (b.followRate ?? -1) - (a.followRate ?? -1) || b.n - a.n);
  return { rows, total: valid.length, sponsoredTotal: validPosts(posts).filter((p) => p.sponsored).length };
}

/** For each secondary tag in use: posts that have it (as main or secondary) vs posts that do not. */
export function subTagCompare(posts, { sponsored = 'include' } = {}) {
  const valid = validPosts(posts).filter((p) => sponsored !== 'exclude' || !p.sponsored);
  const tags = [...new Set(valid.flatMap((p) => p.subTypes ?? []))];
  return tags
    .map((tag) => {
      const has = (p) => p.contentType === tag || (p.subTypes ?? []).includes(tag);
      const withTag = summary(valid.filter(has));
      const without = summary(valid.filter((p) => !has(p)));
      return { tag, with: withTag, without, comparable: withTag.followRateN >= SIDE_MIN && without.followRateN >= SIDE_MIN };
    })
    .sort((a, b) => b.with.n - a.with.n);
}

/** Posts whose main type is a sponsor name: candidates to move to the sponsored flag. */
export const sponsorTypePosts = (posts) => posts.filter((p) => SPONSOR_TYPES.includes(p.contentType));

/** The change for one post moved off a sponsor type: flag it, set the chosen main type. */
export function moveToSponsored(post, mainType = '') {
  const contentType = SPONSOR_TYPES.includes(mainType) ? '' : mainType;
  return { ...post, sponsored: true, contentType, subTypes: (post.subTypes ?? []).filter((x) => x !== contentType) };
}
