/*
 * 小红书 search evidence: the JSON file from tools/collector/xhs_search.py, read and summarised
 * by rules only (no AI). The summary and a copy-ready brief go to the user's own Claude chat;
 * the answer pasted back is checked against the evidence (unknown hashtags, copied sentences).
 *
 * A value the page did not show stays null ("not collected"), never 0. Scores use 点赞 (likes),
 * the one count every search card has; 收藏/评论 are shown when the note page was read.
 */

export const SEARCH_SCHEMA = 'vlog-studio.xhs-search/1';
export const HOT_RATIO = 3; // a note with ≥3× the keyword's median likes is a 爆款 candidate
export const MIN_NOTES = 5; // fewer notes than this: no median, no candidates
const MIN_SIDE = 2; // pattern comparison only with ≥2 notes on each side

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const ID_RE = /^[0-9a-zA-Z]{8,40}$/;
const NOTE_URL_RE = /^https:\/\/www\.xiaohongshu\.com\/explore\/([0-9a-zA-Z]{8,40})\?xsec_token=[A-Za-z0-9%._~-]{1,400}&xsec_source=[a-z_]{1,30}$/;

/**
 * Where a note opens. 小红书 shows "page not available" for a bare note address, so the link
 * with the note's xsec_token is used; older files without it fall back to searching the title.
 */
export function noteLink(n) {
  const m = typeof n?.url === 'string' ? n.url.match(NOTE_URL_RE) : null;
  if (m && m[1] === n.id) return n.url;
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(n?.title || n?.keyword || '')}`;
}

export function median(list) {
  const v = list.filter((x) => num(x) != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Hashtag key used to compare spellings: no '#', no spaces, lower case. */
export const tagKey = (s) => String(s ?? '').replace(/^#+|#+$/g, '').replace(/\[[^\]]*\]$/, '').replace(/\s+/g, '').toLowerCase();

function normNote(raw) {
  if (!raw || typeof raw !== 'object' || !ID_RE.test(raw.id ?? '')) return null;
  const approx = Array.isArray(raw.approx) ? raw.approx.filter((x) => ['likes', 'collects', 'comments', 'shares'].includes(x)) : [];
  return {
    id: raw.id,
    url: str(raw.url, 600),
    keyword: str(raw.keyword, 60),
    rank: num(raw.rank),
    type: raw.type === 'video' || raw.type === 'normal' ? raw.type : '',
    title: str(raw.title, 200),
    desc: typeof raw.desc === 'string' ? str(raw.desc) : null,
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map((x) => str(x, 30)).filter(Boolean))].slice(0, 30) : null,
    likes: num(raw.likes),
    collects: num(raw.collects),
    comments: num(raw.comments),
    shares: num(raw.shares),
    approx,
    publishedAt: str(raw.publishedAt, 40),
    duration: num(raw.duration),
    author: str(raw.author?.nickname, 60),
    followers: num(raw.author?.followers),
    detail: raw.detail === true,
    // Which result lists the note was in: 综合 (this account's default) and/or 最多点赞·半年内. Older files: 综合 only.
    lists: Array.isArray(raw.lists) && raw.lists.some((x) => x === 'general' || x === 'popular') ? raw.lists.filter((x) => x === 'general' || x === 'popular') : ['general'],
    rankPopular: num(raw.rankPopular),
  };
}

export const inBoth = (n) => n.lists.includes('general') && n.lists.includes('popular');

/** Reads and validates an evidence file. Throws Error('schema') for anything else. */
export function parseEvidence(data) {
  if (!data || typeof data !== 'object' || data.schema !== SEARCH_SCHEMA || !Array.isArray(data.notes)) throw new Error('schema');
  const keywords = (Array.isArray(data.keywords) ? data.keywords : [])
    .map((k) => ({
      keyword: str(k?.keyword, 60),
      status: ['ok', 'empty', 'blocked', 'error'].includes(k?.status) ? k.status : 'error',
      related: Array.isArray(k?.related) ? [...new Set(k.related.map((x) => str(x, 30)).filter(Boolean))].slice(0, 60) : null,
      // The search box's suggestions, in 小红书's order (null = not collected).
      suggest: Array.isArray(k?.suggest) ? [...new Set(k.suggest.map((x) => str(x, 30)).filter(Boolean))].slice(0, 20) : null,
      // The second list (最多点赞·半年内); null = not collected.
      popular: k?.popular && typeof k.popular === 'object' ? { status: ['ok', 'empty', 'error'].includes(k.popular.status) ? k.popular.status : 'error', count: num(k.popular.count) } : null,
      searchedAt: str(k?.searchedAt, 40),
    }))
    .filter((k) => k.keyword)
    .slice(0, 10);
  const seen = new Set();
  const notes = [];
  for (const raw of data.notes.slice(0, 500)) {
    const n = normNote(raw);
    if (!n || seen.has(`${n.keyword}|${n.id}`)) continue;
    seen.add(`${n.keyword}|${n.id}`);
    notes.push(n);
  }
  const collectedAt = str(data.collectedAt, 40);
  // View counts of topic (话题) pages: how much people look at a tag, unlike how many creators used it.
  const topics = Array.isArray(data.topics)
    ? data.topics
        .map((x) => ({ name: str(x?.name, 30), views: num(x?.views), approx: x?.approx === true }))
        .filter((x) => x.name)
        .slice(0, 30)
    : null;
  return { id: `${collectedAt}|${keywords.map((k) => k.keyword).join(',')}`, collectedAt, keywords, notes, topics };
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;
export function titleTraits(title) {
  const t = String(title ?? '');
  return {
    length: [...t].length,
    digits: /\d/.test(t),
    emoji: EMOJI_RE.test(t),
    question: /[?？吗呢]/.test(t),
    exclaim: /[!！]/.test(t),
  };
}

const share = (list, key) => (list.length ? list.filter((x) => x[key]).length / list.length : null);
function traitsSummary(notes) {
  const tr = notes.map((n) => titleTraits(n.title));
  return { n: notes.length, length: median(tr.map((x) => x.length)), digits: share(tr, 'digits'), emoji: share(tr, 'emoji'), question: share(tr, 'question'), exclaim: share(tr, 'exclaim') };
}

/** Chinese phrases (2–8 characters, longest form kept) that appear in at least two of the given titles. */
export function frequentTerms(titles, exclude = [], limit = 10) {
  const skip = exclude.map((x) => String(x).replace(/\s+/g, ''));
  const counts = new Map();
  for (const title of titles) {
    const runs = String(title ?? '').match(/[一-鿿]+/g) ?? [];
    const grams = new Set();
    for (const r of runs) for (let n = 2; n <= 8; n++) for (let i = 0; i + n <= r.length; i++) grams.add(r.slice(i, i + n));
    for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let list = [...counts].filter(([g, c]) => c >= 2 && !skip.some((k) => k.includes(g)));
  // Keep "收纳技巧" and drop "收纳"/"技巧" when they never appear on their own more often.
  list = list.filter(([g, c]) => !list.some(([h, d]) => h !== g && h.includes(g) && d >= c));
  return list.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([term, count]) => ({ term, count }));
}

/** Per keyword: median likes, 爆款 candidates, title patterns; across keywords: hashtags, related searches. */
export function analyzeEvidence(ev) {
  const keywords = ev.keywords.map((k) => {
    const all = ev.notes.filter((n) => n.keyword === k.keyword);
    // Median and 爆款 candidates stay on the 综合 list, the one a searcher sees first.
    const notes = all.filter((n) => n.lists.includes('general'));
    const both = all.filter(inBoth).sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));
    const scored = notes.filter((n) => n.likes != null);
    const med = scored.length >= MIN_NOTES ? median(scored.map((n) => n.likes)) : null;
    const hot = med ? scored.filter((n) => n.likes >= HOT_RATIO * Math.max(med, 1)).sort((a, b) => b.likes - a.likes).map((n) => ({ ...n, ratio: n.likes / Math.max(med, 1) })) : [];
    const hotIds = new Set(hot.map((n) => n.id));
    const rest = scored.filter((n) => !hotIds.has(n.id));
    return {
      keyword: k.keyword,
      status: k.status,
      related: k.related,
      suggest: k.suggest,
      popular: k.popular,
      popularCount: all.filter((n) => n.lists.includes('popular')).length,
      both,
      count: notes.length,
      scored: scored.length,
      unscored: notes.length - scored.length,
      median: med,
      hot,
      patterns: hot.length >= MIN_SIDE && rest.length >= MIN_SIDE ? { hot: traitsSummary(hot), rest: traitsSummary(rest) } : null,
      terms: frequentTerms(hot.map((n) => n.title), [k.keyword]),
    };
  });
  const withTags = ev.notes.filter((n) => Array.isArray(n.tags));
  const tagMap = new Map();
  for (const n of withTags) {
    for (const tag of n.tags) {
      const key = tagKey(tag);
      if (!key) continue;
      const e = tagMap.get(key) ?? { tag, notes: [], keywords: new Set() };
      e.notes.push(n);
      e.keywords.add(n.keyword);
      tagMap.set(key, e);
    }
  }
  const views = new Map((ev.topics ?? []).map((x) => [tagKey(x.name), x]));
  const all = [...tagMap.entries()].map(([key, e]) => ({
    tag: e.tag,
    count: e.notes.length,
    medianLikes: median(e.notes.map((n) => n.likes)),
    keywords: [...e.keywords],
    views: views.get(key)?.views ?? null,
    viewsApprox: views.get(key)?.approx ?? false,
  }));
  const byViews = (a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.medianLikes ?? -1) - (a.medianLikes ?? -1);
  // A tag on one note says more about that note than about what people look for: kept apart.
  const tags = all.filter((x) => x.count >= 2).sort((a, b) => b.count - a.count || byViews(a, b)).slice(0, 25);
  const singleTags = all.filter((x) => x.count === 1).sort(byViews).slice(0, 60);
  const related = [...new Set(ev.keywords.flatMap((k) => k.related ?? []))].slice(0, 60);
  return {
    keywords,
    tags,
    singleTags,
    tagNotes: withTags.length,
    topicsCollected: (ev.topics ?? []).some((x) => x.views != null),
    related,
    relatedCollected: ev.keywords.some((k) => k.related != null),
  };
}

const fmt = (v) => (v == null ? '미수집' : String(v));
const pct = (v) => (v == null ? '미수집' : `${Math.round(v * 100)}%`);

/**
 * The brief for the user's Claude chat: everything steps 1 and 2 of the screen show, plus the rules.
 * Every note gets a reference (N1, N2 …) so each suggestion can name its evidence; all notes are
 * listed, grouped by keyword like the screen. Instructions are in Korean; the content asked for is Chinese.
 */
const TRAIT_KO = { digits: '숫자가 들어간 제목', emoji: '이모지가 들어간 제목', question: '질문형 제목', exclaim: '느낌표 제목', long: '{len}자보다 긴 제목' };
const pct1 = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '미수집');

/**
 * `myTitles`: title patterns learned from my own posts (learning.js "titles"), added as a section so
 * the suggestions also fit what worked on my account.
 */
export function buildBrief(ev, an, { topic = '', hook = '', myTitles = null } = {}) {
  const hotIds = new Set(an.keywords.flatMap((k) => k.hot.map((n) => n.id)));
  const ratio = new Map(an.keywords.flatMap((k) => k.hot.map((n) => [`${k.keyword}|${n.id}`, n.ratio])));
  const groups = an.keywords.map((k) => ({
    k,
    notes: ev.notes
      .filter((n) => n.keyword === k.keyword)
      .sort((a, b) => Number(inBoth(b)) - Number(inBoth(a)) || Number(hotIds.has(b.id)) - Number(hotIds.has(a.id)) || (b.likes ?? -1) - (a.likes ?? -1)),
  }));
  const ref = new Map();
  for (const g of groups) for (const n of g.notes) if (!ref.has(n.id)) ref.set(n.id, `N${ref.size + 1}`);
  const statusText = { ok: '', empty: ' (小红书가 결과 0개라고 답함)', blocked: ' (보안 확인으로 중단)', error: ' (읽지 못함, 0개 아님)' };
  const lines = [];
  lines.push('너는 小红书 콘텐츠 기획 도우미야. 아래 [근거 자료]는 小红书 검색 결과를 실제로 수집한 것이야.');
  lines.push('규칙:');
  lines.push('1. 근거 자료 밖의 소문·일반론으로 추측하지 말고, 자료에서 보이는 패턴만 근거로 써.');
  lines.push('2. 해시태그는 [해시태그] 목록(2개 이상 노트·1개 노트 모두)에 있는 것만 써. 목록에 없는 태그가 꼭 필요하면 "(자료에 없음)"이라고 따로 표시해.');
  lines.push('   사람들이 많이 찾는 말은 [사람들이 찾는 말]과 话题 조회수를 우선 근거로 써. 사용 노트 수는 작성자들이 붙인 횟수일 뿐이야.');
  lines.push('6. [종합]은 수집한 계정 기준이라 개인화가 섞일 수 있어. [종합]과 [좋아요순·반년] 두 목록에 모두 나온 노트를 가장 강한 근거로 써.');
  lines.push('3. 제목마다 참고한 노트 번호(N1 등)와 이유를 한 줄로 적어.');
  lines.push('4. 다른 노트의 문장을 그대로 베끼지 마. 내 주제와 경험에 맞게 새로 써.');
  lines.push('5. 결과물(제목·본문·해시태그)은 중국어 간체로, 설명은 한국어로 써.');
  if (myTitles?.length) lines.push('7. [내 계정 제목 패턴]은 내 글의 D+1 클릭률에서 나온 관찰이야. 검색 근거와 부딪치지 않는 선에서 반영하고, 반영했으면 그렇다고 적어.');
  lines.push('');
  lines.push('요청: 제목 후보 10개(각 20자 안팎), 본문 1개(300~500자, 첫 줄에 Hook), 해시태그 8~10개, 표지 문구 후보 3개.');
  if (topic.trim()) lines.push(`[내 주제] ${topic.trim()}`);
  if (hook.trim()) lines.push(`[내 Hook·핵심 장면] ${hook.trim()}`);
  if (myTitles?.length) {
    lines.push('');
    lines.push('[내 계정 제목 패턴] (내 유효 글 D+1 표지 클릭률 중앙값, 각 3편 이상 묶음)');
    for (const x of myTitles.slice(0, 3)) lines.push(`- ${TRAIT_KO[x.key].replace('{len}', x.vars?.len ?? '')}: ${pct1(x.with.ctr)}(${x.with.n}편) vs 아닌 제목 ${pct1(x.without.ctr)}(${x.without.n}편)`);
  }
  lines.push('');
  lines.push(`[근거 자료] 수집 ${ev.collectedAt || '시각 미상'} (중국 표준시), 검색어 ${an.keywords.map((k) => `${k.keyword}${statusText[k.status] ?? ''}`).join(', ')}`);
  lines.push(`爆款 후보 = 같은 검색어 안에서 좋아요가 중앙값의 ${HOT_RATIO}배 이상인 노트 (노트 ${MIN_NOTES}개 미만이면 계산 안 함)`);
  for (const { k } of groups) {
    lines.push('');
    lines.push(`- 검색어 "${k.keyword}"${statusText[k.status] ?? ''}: [종합] 노트 ${k.count}개 (좋아요 미수집 ${k.unscored}개), 좋아요 중앙값 ${fmt(k.median)}`);
    lines.push(`  [좋아요순·반년] ${k.popular == null ? '(미수집)' : k.popular.status === 'error' ? '(읽지 못함)' : `노트 ${k.popularCount}개`}, 두 목록 모두: ${k.both.length ? k.both.map((n) => ref.get(n.id)).join(', ') : '없음'}`);
    if (k.median == null && k.status === 'ok') lines.push(`  좋아요를 읽은 노트가 ${k.scored}개라 중앙값과 爆款 후보는 계산하지 않음`);
    if (k.hot.length) lines.push(`  爆款 후보: ${k.hot.map((n) => `${ref.get(n.id)}(중앙값의 ${n.ratio.toFixed(1)}배)`).join(', ')}`);
    else if (k.median != null) lines.push(`  爆款 후보: 없음 (중앙값의 ${HOT_RATIO}배를 넘는 노트 없음)`);
    if (k.patterns) lines.push(`  제목 패턴 爆款 ${k.patterns.hot.n}편 vs 나머지 ${k.patterns.rest.n}편: 길이(중앙값) ${fmt(k.patterns.hot.length)} vs ${fmt(k.patterns.rest.length)}자, 숫자 포함 ${pct(k.patterns.hot.digits)} vs ${pct(k.patterns.rest.digits)}, 이모지 ${pct(k.patterns.hot.emoji)} vs ${pct(k.patterns.rest.emoji)}, 질문형 ${pct(k.patterns.hot.question)} vs ${pct(k.patterns.rest.question)} (관찰일 뿐 원인은 아님)`);
    if (k.terms.length) lines.push(`  爆款 제목에 반복된 말: ${k.terms.map((x) => `${x.term}(${x.count})`).join(', ')}`);
  }
  lines.push('');
  lines.push('[사람들이 찾는 말]');
  for (const { k } of groups) lines.push(`- 검색창 자동완성 "${k.keyword}" (小红书가 보여 준 순서): ${k.suggest == null ? '(미수집)' : k.suggest.length ? k.suggest.join(', ') : '(없음)'}`);
  lines.push(`- 연관 검색어: ${an.related.length ? an.related.join(', ') : an.relatedCollected ? '(없음)' : '(미수집)'}`);
  const tagText = (x) => `#${x.tag} (${x.count} / ${fmt(x.medianLikes)}${x.views != null ? ` / 조회 ${x.views}${x.viewsApprox ? '(약)' : ''}` : ''})`;
  lines.push('');
  lines.push(`[해시태그] 태그를 읽은 노트 ${an.tagNotes}개 기준. 괄호는 사용 노트 수 / 그 노트들의 좋아요 중앙값${an.topicsCollected ? ' / 话题 조회수' : ''}`);
  lines.push(`- 2개 이상 노트에서 쓰임: ${an.tags.length ? an.tags.map(tagText).join(', ') : an.tagNotes ? '(없음)' : '(태그 미수집)'}`);
  if (an.singleTags.length) lines.push(`- 1개 노트에서만 쓰임(그 노트 성과와 구분 어려움): ${an.singleTags.map(tagText).join(', ')}`);
  const listed = new Set();
  for (const { k, notes } of groups) {
    lines.push('');
    lines.push(`[노트 · ${k.keyword}] ${notes.length}개, 두 목록 모두 → 爆款 후보 → 좋아요 순`);
    for (const n of notes) {
      if (listed.has(n.id)) {
        lines.push(`${ref.get(n.id)} (위 검색어에 같은 노트)`);
        continue;
      }
      listed.add(n.id);
      const r = ratio.get(`${k.keyword}|${n.id}`);
      const counts = `좋아요 ${fmt(n.likes)}${n.approx.includes('likes') ? '(약)' : ''}${r ? ` (중앙값의 ${r.toFixed(1)}배)` : ''} · 수집 ${fmt(n.collects)} · 댓글 ${fmt(n.comments)} · 공유 ${fmt(n.shares)}`;
      const where = [n.lists.includes('general') && n.rank ? `종합 ${n.rank}위` : n.lists.includes('general') ? '종합' : '', n.lists.includes('popular') ? `좋아요순·반년 ${n.rankPopular ?? ''}위`.replace(' 위', '') : ''].filter(Boolean).join(' · ');
      lines.push(`${ref.get(n.id)}${inBoth(n) ? ' [두 목록 모두]' : ''}${hotIds.has(n.id) ? ' [爆款 후보]' : ''} [${where}] "${n.title || '(제목 없음)'}" — ${counts}${n.type === 'video' ? ' · 영상' : n.type ? ' · 이미지' : ''}${n.publishedAt ? ` · 발행 ${n.publishedAt.slice(0, 10)}` : ''}`);
      if (n.tags?.length) lines.push(`   태그: ${n.tags.map((x) => `#${x}`).join(' ')}`);
      if (n.desc) lines.push(`   본문 앞부분: ${n.desc.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  return lines.join('\n');
}

const HASH_RE = /#([^\s#[\]，,。、；;：:！!？?()（）"'「」]{1,30})(?:\[[^\]]*\])?#?/g;
/** Hashtags written in a text (#收纳 / #收纳[话题]#). */
export const hashtagsIn = (text) => [...new Set([...String(text ?? '').matchAll(HASH_RE)].map((m) => m[1]))];

function bigrams(s) {
  const t = String(s ?? '').replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return (2 * both) / (a.size + b.size);
}
/** Length of the longest piece of text two strings share (spaces ignored). */
export function longestShared(a, b) {
  const x = String(a ?? '').replace(/\s+/g, '');
  const y = String(b ?? '').replace(/\s+/g, '');
  let best = 0;
  let prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

export const SIMILAR_DICE = 0.6;
export const SIMILAR_RUN = 12;

/** Checks a pasted answer: hashtags not in the evidence, lines too close to a collected note. */
export function checkAnswer(text, ev) {
  const known = new Set(ev.notes.flatMap((n) => n.tags ?? []).map(tagKey));
  const tagsCollected = ev.notes.some((n) => Array.isArray(n.tags));
  const tags = hashtagsIn(text).map((tag) => ({ tag, known: tagsCollected ? known.has(tagKey(tag)) : null }));
  const sources = ev.notes.flatMap((n) => [
    { id: n.id, title: n.title, part: 'title', text: n.title },
    ...(n.desc ? n.desc.split(/[\n。！？!?]+/).filter((s) => s.trim().length >= 8).map((s) => ({ id: n.id, title: n.title, part: 'desc', text: s.trim() })) : []),
  ]).filter((s) => s.text);
  const sourceGrams = sources.map((s) => bigrams(s.text));
  const similar = [];
  for (const raw of String(text ?? '').split(/\n+/)) {
    const line = raw.replace(HASH_RE, '').trim();
    if ([...line.replace(/\s+/g, '')].length < 8) continue;
    const g = bigrams(line);
    let hit = null;
    sources.forEach((s, i) => {
      const d = dice(g, sourceGrams[i]);
      const run = d >= 0.3 || line.length >= SIMILAR_RUN ? longestShared(line, s.text) : 0;
      if ((d >= SIMILAR_DICE || run >= SIMILAR_RUN) && (!hit || d > hit.score)) hit = { line, id: s.id, title: s.title, part: s.part, score: d, run };
    });
    if (hit) similar.push(hit);
  }
  return { tags, tagsCollected, unknownTags: tags.filter((x) => x.known === false).map((x) => x.tag), similar };
}

/** What a post keeps from this screen: the chosen title and tags, and which search they came from. */
export function normalizeSearchPick(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title, 200);
  const tags = Array.isArray(raw.tags) ? [...new Set(raw.tags.map((x) => tagKey(x)).filter(Boolean))].slice(0, 20) : [];
  if (!title && !tags.length) return null;
  return {
    title,
    tags,
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map((x) => str(x, 60)).filter(Boolean).slice(0, 10) : [],
    evidenceAt: str(raw.evidenceAt, 40),
    unknownTags: Array.isArray(raw.unknownTags) ? raw.unknownTags.map((x) => tagKey(x)).filter(Boolean).slice(0, 20) : [],
    savedAt: num(raw.savedAt),
  };
}
