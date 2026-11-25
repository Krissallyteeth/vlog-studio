"""Pure parsing helpers for the 小红书 search collector (no browser, no network).

Everything here turns page state into the evidence file VLOG Studio imports.
Rules: a value that is not on the page stays None (never 0); counts shown as
"1.2万" are kept with approx=True; times are China Standard Time (UTC+8).
"""

import re
from datetime import datetime, timedelta, timezone

SCHEMA = "vlog-studio.xhs-search/1"
CST = timezone(timedelta(hours=8))

TEXT_LIMIT = 600
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
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([万wW千kK])\+?", s)
    if m:
        unit = 10000 if m.group(2) in "万wW" else 1000
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
        "url": f"https://www.xiaohongshu.com/explore/{note_id}",
        "detail": False,
    }
    note.update(_counts(_pick(card, "interactInfo", "interact_info")))
    # The token opens the note page in this session only; it is never written to the file.
    note["_token"] = _pick(item, "xsecToken", "xsec_token")
    return note


def tags_from_desc(desc):
    return [m.group(1) for m in TAG_RE.finditer(desc or "")]


def merge_detail(note, detail):
    """Adds what only the note page has (text, tags, time, full counts)."""
    if not isinstance(detail, dict):
        return note
    desc = _text(detail.get("desc"))
    tags = []
    for t in detail.get("tagList") or detail.get("tag_list") or []:
        name = t.get("name") if isinstance(t, dict) else None
        if isinstance(name, str) and name.strip():
            tags.append(name.strip()[:30])
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


def related_words(obj, keyword, limit=30):
    """Short search phrases found in suggestion / hot-query payloads. Structure is not fixed, so look for text fields."""
    found = []

    def walk(x, depth=0):
        if depth > 6 or len(found) >= limit:
            return
        if isinstance(x, dict):
            for k in ("text", "query", "word", "name", "search_word", "searchWord"):
                v = x.get(k)
                if isinstance(v, str) and 2 <= len(v.strip()) <= 30 and v.strip() != keyword and v.strip() not in found:
                    found.append(v.strip())
            for v in x.values():
                walk(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                walk(v, depth + 1)

    walk(obj)
    return found[:limit]


def public_note(note):
    return {k: v for k, v in note.items() if not k.startswith("_")}


def evidence_file(keywords, notes, collected_at=None, tool_version="1"):
    return {
        "schema": SCHEMA,
        "collectedAt": collected_at or now_cst(),
        "timezone": "Asia/Shanghai",
        "tool": {"name": "vlog-studio-collector", "version": tool_version},
        "keywords": keywords,
        "notes": [public_note(n) for n in notes],
    }
