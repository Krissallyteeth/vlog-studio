"""Pure parsing helpers for the 小红书 search collector (no browser, no network).

Everything here turns page state into the evidence file VLOG Studio imports.
Rules: a value that is not on the page stays None (never 0); counts shown as
"1.2万" are kept with approx=True; times are China Standard Time (UTC+8).
"""

import re
from urllib.parse import quote
from datetime import datetime, timedelta, timezone

SCHEMA = "vlog-studio.xhs-search/1"
CST = timezone(timedelta(hours=8))

TEXT_LIMIT = 600
# Labels of the search page's own filter menu: not search phrases.
FILTER_LABELS = frozenset(
    "排序依据 综合 最新 最热 最多点赞 最多评论 最多收藏 笔记类型 不限 视频 图文 发布时间 一天内 一周内 半年内 "
    "搜索范围 已看过 未看过 已关注 位置距离 同城 附近".split()
)
TAG_RE = re.compile(r"#([^\s#\[\]]{1,30})(?:\[[^\]]*\])?#?")


def now_cst():
    return datetime.now(CST).isoformat(timespec="seconds")


def ms_to_cst(ms):
    if not isinstance(ms, (int, float)) or ms <= 0:
        return None
    return datetime.fromtimestamp(ms / 1000, CST).isoformat(timespec="seconds")


def parse_count(value):
    """'1234' -> (1234, False); '1.2万' / '10万+' -> (12000 / 100000, True); unknown -> (None, False)."""
    if isinstance(value, bool):
        return None, False
    if isinstance(value, (int, float)):
        return (int(value), False) if value >= 0 else (None, False)
    if not isinstance(value, str):
        return None, False
    s = value.strip().replace(",", "")
    if re.fullmatch(r"\d+", s):
        return int(s), False
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([亿万wW千kK])\+?", s)
    if m:
        unit = 100_000_000 if m.group(2) == "亿" else 10000 if m.group(2) in "万wW" else 1000
        return int(round(float(m.group(1)) * unit)), True
    m = re.fullmatch(r"(\d+)\+", s)
    if m:
        return int(m.group(1)), True
    return None, False  # e.g. the placeholder "赞" shown instead of a number


def _pick(d, *keys):
    for k in keys:
        if isinstance(d, dict) and d.get(k) not in (None, ""):
            return d.get(k)
    return None


def _text(v, limit=TEXT_LIMIT):
    return v.strip()[:limit] if isinstance(v, str) and v.strip() else None


def _counts(info):
    out, approx = {}, []
    for name, keys in (
        ("likes", ("likedCount", "liked_count")),
        ("collects", ("collectedCount", "collected_count")),
        ("comments", ("commentCount", "comment_count")),
        ("shares", ("sharedCount", "shared_count", "shareCount", "share_count")),
    ):
        value, is_approx = parse_count(_pick(info or {}, *keys))
        out[name] = value
        if is_approx:
            approx.append(name)
    out["approx"] = approx
    return out


def feed_items(state_feeds):
    """Accepts __INITIAL_STATE__.search.feeds (a ref with value/_value) or a plain list."""
    if isinstance(state_feeds, dict):
        state_feeds = state_feeds.get("value", state_feeds.get("_value"))
    return state_feeds if isinstance(state_feeds, list) else []


def note_from_card(item, keyword, rank):
    """One search result card (camelCase page state or snake_case API item). None if not a note."""
    if not isinstance(item, dict):
        return None
    model = _pick(item, "modelType", "model_type")
    card = _pick(item, "noteCard", "note_card")
    if (model and model != "note") or not isinstance(card, dict):
        return None
    note_id = _pick(item, "id")
    if not isinstance(note_id, str) or not re.fullmatch(r"[0-9a-zA-Z]{8,40}", note_id):
        return None
    user = card.get("user") or {}
    video = card.get("video") or {}
    duration = (video.get("capa") or {}).get("duration") if isinstance(video, dict) else None
    note = {
        "id": note_id,
        "keyword": keyword,
        "rank": rank,
        "type": "video" if card.get("type") == "video" else ("normal" if card.get("type") else None),
        "title": _text(_pick(card, "displayTitle", "display_title", "title"), 200),
        "desc": None,
        "tags": None,
        "publishedAt": None,
        "ipLocation": None,
        "duration": duration if isinstance(duration, (int, float)) and duration > 0 else None,
        "author": {"nickname": _text(_pick(user, "nickname", "nickName", "nick_name"), 60), "followers": None},
        "url": note_url(note_id, _pick(item, "xsecToken", "xsec_token")),
        "detail": False,
    }
    note.update(_counts(_pick(card, "interactInfo", "interact_info")))
    # Kept apart for opening note pages here; the file has it only inside "url" (as every shared link does).
    note["_token"] = _pick(item, "xsecToken", "xsec_token")
    # The cover is shown once in the app right after collecting; it is never written to the file either.
    note["_cover_url"] = cover_url(card)
    return note


def cover_url(card):
    """Address of the card's cover picture (the small preview first). None if there is none."""
    cover = card.get("cover") if isinstance(card, dict) else None
    if not isinstance(cover, dict):
        return None
    candidates = [cover.get(k) for k in ("urlPre", "url_pre")]
    for info in cover.get("infoList") or cover.get("info_list") or []:
        if isinstance(info, dict) and info.get("imageScene", info.get("image_scene")) in ("WB_PRV", "WB_DFT"):
            candidates.append(info.get("url"))
    candidates += [cover.get(k) for k in ("urlDefault", "url_default", "url")]
    for url in candidates:
        if is_image_url(url):
            return re.sub(r"^http://", "https://", url)  # fetch over https
    return None


def is_image_url(url):
    """Only 小红书's own picture servers (their addresses often start with http://)."""
    if not isinstance(url, str) or len(url) > 2000:
        return False
    m = re.match(r"https?://([a-z0-9.-]+)/", url)
    return bool(m) and (m.group(1).endswith(".xhscdn.com") or m.group(1).endswith(".xiaohongshu.com"))


def note_url(note_id, token):
    """The note page. 小红书 refuses it without the xsec_token every shared link carries."""
    base = f"https://www.xiaohongshu.com/explore/{note_id}"
    return f"{base}?xsec_token={quote(token, safe='')}&xsec_source=pc_search" if isinstance(token, str) and token else base


def tags_from_desc(desc):
    return [m.group(1) for m in TAG_RE.finditer(desc or "")]


def merge_detail(note, detail):
    """Adds what only the note page has (text, tags, time, full counts)."""
    if not isinstance(detail, dict):
        return note
    desc = _text(detail.get("desc"))
    tags, topics = [], []
    for t in detail.get("tagList") or detail.get("tag_list") or []:
        name = t.get("name") if isinstance(t, dict) else None
        if isinstance(name, str) and name.strip():
            tags.append(name.strip()[:30])
            tid = t.get("id")
            if isinstance(tid, str) and re.fullmatch(r"[0-9a-zA-Z]{8,40}", tid):
                topics.append({"id": tid, "name": name.strip()[:30]})
    note["_topics"] = topics  # topic page ids, used during this run only
    for t in tags_from_desc(detail.get("desc")):
        if t not in tags:
            tags.append(t)
    note["desc"] = desc
    note["tags"] = tags
    note["title"] = _text(detail.get("title"), 200) or note["title"]
    note["publishedAt"] = ms_to_cst(detail.get("time"))
    note["ipLocation"] = _text(detail.get("ipLocation"), 30)
    if detail.get("type") in ("video", "normal"):
        note["type"] = detail["type"]
    video = detail.get("video") or {}
    duration = (video.get("capa") or {}).get("duration") if isinstance(video, dict) else None
    if isinstance(duration, (int, float)) and duration > 0:
        note["duration"] = duration
    counts = _counts(detail.get("interactInfo") or detail.get("interact_info"))
    card_approx = set(note.get("approx", []))
    approx = set(counts["approx"])
    for k in ("likes", "collects", "comments", "shares"):
        if counts[k] is not None:
            note[k] = counts[k]
        elif k in card_approx:
            approx.add(k)  # the page had no value: keep the card's approximate one
    note["approx"] = sorted(approx)
    note["detail"] = True
    return note


def detail_from_state(note_detail_map, note_id):
    entry = (note_detail_map or {}).get(note_id) if isinstance(note_detail_map, dict) else None
    return entry.get("note") if isinstance(entry, dict) else None


def is_filter_path(path):
    """True for the filter-menu endpoint (its texts are menu labels, not related searches)."""
    return any("filter" in part for part in path.lower().split("/"))


def search_result(http_status, data):
    """Result API answer -> (items, problem). items is None when the answer is not usable (unknown, not zero)."""
    if http_status != 200:
        return None, f"HTTP {http_status}"
    if not isinstance(data, dict):
        return None, "unreadable response"
    if data.get("success") is False or data.get("code") not in (None, 0):
        return None, f"code {data.get('code')}"
    body = data.get("data")
    if not isinstance(body, dict):
        return None, "no data"
    items = body.get("items")
    if items is None:
        # Items left out counts as zero only when the answer also says there are no more pages.
        return ([], None) if body.get("has_more") is False else (None, "no items")
    return (items, None) if isinstance(items, list) else (None, "no items")


def no_notes_status(item_count, answered, problems):
    """Status and reason when no note was read. 'empty' only if the site really answered with zero results."""
    if item_count:
        return "error", f"{item_count} result items but no readable note"
    if problems:
        return "error", "search API: " + ", ".join(dict.fromkeys(problems))
    if answered:
        return "empty", None
    return "error", "search results did not load"


def related_words(obj, keyword, limit=30):
    """Short search phrases found in suggestion / hot-query payloads. Structure is not fixed, so look for text fields."""
    found = []

    def walk(x, depth=0):
        if depth > 6 or len(found) >= limit:
            return
        if isinstance(x, dict):
            for k in ("text", "query", "word", "name", "search_word", "searchWord"):
                v = x.get(k)
                word = v.strip() if isinstance(v, str) else ""
                if 2 <= len(word) <= 30 and word != keyword and word not in FILTER_LABELS and word not in found:
                    found.append(word)
            for v in x.values():
                walk(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                walk(v, depth + 1)

    walk(obj)
    return found[:limit]


REFUSED_RE = re.compile(r"net::ERR_(HTTP_RESPONSE_CODE_FAILURE|CONNECTION_CLOSED|CONNECTION_RESET|CONNECTION_REFUSED|EMPTY_RESPONSE)")


def refused_reason(error_text):
    """The short net:: code when a page load failed because 小红书 refused or cut the connection
    (what it does while it limits an account or network), else None."""
    m = REFUSED_RE.search(str(error_text or ""))
    return m.group(1) if m else None


def merge_lists(general, popular):
    """Both result lists of one keyword as one note list. Each note says which lists it was in
    ("general" = 综合, the account's own default; "popular" = 最多点赞 within half a year) and its place there."""
    out, by_id = [], {}
    for i, n in enumerate(general):
        n["lists"], n["rankPopular"] = ["general"], None
        n["rank"] = i + 1
        by_id[n["id"]] = n
        out.append(n)
    for i, n in enumerate(popular):
        if n["id"] in by_id:
            by_id[n["id"]]["lists"].append("popular")
            by_id[n["id"]]["rankPopular"] = i + 1
            continue
        n["lists"], n["rankPopular"], n["rank"] = ["popular"], i + 1, None
        by_id[n["id"]] = n
        out.append(n)
    return out


def detail_order(notes):
    """Which notes get their page opened first: in both lists, then the popular list, then the rest."""
    def key(n):
        lists = n.get("lists") or ["general"]
        both = "general" in lists and "popular" in lists
        return (0 if both else 1 if "popular" in lists else 2, n.get("rankPopular") or n.get("rank") or 999)

    return sorted(notes, key=key)


def is_popular_request(post_data):
    """True when a result request asked for 最多点赞 within half a year."""
    s = post_data or ""
    return "popularity_descending" in s and "半年内" in s


def full_keyword_suggestions(batches, keyword):
    """The search box answers after every keystroke. Keep the answer for the whole keyword
    (its request names the keyword); if none names it, the last answer. Only words that contain
    the keyword count, so other page requests answered meanwhile do not slip in."""
    k = "".join(keyword.split())
    batches = [(q, [w for w in words if k in "".join(w.split())]) for q, words in batches]
    batches = [(q, words) for q, words in batches if words]
    if not batches:
        return []
    full = [words for query, words in batches if f"={keyword}" in query or query.endswith(keyword)]
    return list(dict.fromkeys(full[-1] if full else batches[-1][1]))


def pick_topics(notes, limit):
    """Topics to look up: those on the most notes first (only ones whose page id is known)."""
    seen = {}
    for n in notes:
        for t in n.get("_topics") or []:
            e = seen.setdefault(t["name"], {"id": t["id"], "name": t["name"], "count": 0})
            e["count"] += 1
    return sorted(seen.values(), key=lambda e: -e["count"])[:limit]


VIEW_KEYS = ("view_num", "viewNum", "view_count", "viewCount", "browse_num", "browseNum", "page_view", "pageView", "views")
VIEW_TEXT_RE = re.compile(r"(\d+(?:\.\d+)?\s*[亿万wW千kK]?\+?)\s*次?\s*浏览")


def topic_views(payloads, text):
    """A topic page's view count from its data (known field names) or its visible text ("1.2亿浏览").
    Returns (views, approx) or (None, False) when the page did not show one."""
    found = []

    def walk(x, depth=0):
        if depth > 8 or found:
            return
        if isinstance(x, dict):
            for k in VIEW_KEYS:
                if k in x:
                    v, approx = parse_count(x[k])
                    if v is not None:
                        found.append((v, approx))
                        return
            for v in x.values():
                walk(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                walk(v, depth + 1)

    for p in payloads:
        walk(p)
        if found:
            return found[0]
    m = VIEW_TEXT_RE.search(text or "")
    if m:
        return parse_count(m.group(1).replace(" ", ""))
    return None, False


def public_note(note):
    return {k: v for k, v in note.items() if not k.startswith("_")}


def evidence_file(keywords, notes, collected_at=None, tool_version="1", topics=None):
    data = {
        "schema": SCHEMA,
        "collectedAt": collected_at or now_cst(),
        "timezone": "Asia/Shanghai",
        "tool": {"name": "vlog-studio-collector", "version": tool_version},
        "keywords": keywords,
        "notes": [public_note(n) for n in notes],
    }
    if topics is not None:
        data["topics"] = topics  # [{"name", "views", "approx"}]; views None = page did not show it
    return data
