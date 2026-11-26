"""Run: python -m unittest discover -s tools/collector  (fictional data only)."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import xhs_parse as xp
import xhs_search as xs


def card(**over):
    base = {
        "id": "64a1b2c3d4e5f6a7b8c9d0e1",
        "modelType": "note",
        "xsecToken": "TOKEN-ONLY-FOR-SESSION",
        "noteCard": {
            "type": "video",
            "displayTitle": "가상 제목 收纳",
            "user": {"nickname": "测试用户"},
            "interactInfo": {"likedCount": "1.2万", "collectedCount": "", "commentCount": "35"},
            "video": {"capa": {"duration": 61}},
        },
    }
    base.update(over)
    return base


class ParseCount(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(xp.parse_count("1234"), (1234, False))
        self.assertEqual(xp.parse_count("1,234"), (1234, False))
        self.assertEqual(xp.parse_count("1.2万"), (12000, True))
        self.assertEqual(xp.parse_count("10万+"), (100000, True))
        self.assertEqual(xp.parse_count("3.5w"), (35000, True))
        self.assertEqual(xp.parse_count(0), (0, False))
        # Not shown means unknown, never 0
        self.assertEqual(xp.parse_count(""), (None, False))
        self.assertEqual(xp.parse_count("赞"), (None, False))
        self.assertEqual(xp.parse_count(None), (None, False))
        self.assertEqual(xp.parse_count(True), (None, False))


class Cards(unittest.TestCase):
    def test_card(self):
        n = xp.note_from_card(card(), "收纳", 1)
        self.assertEqual(n["likes"], 12000)
        self.assertIsNone(n["collects"])
        self.assertEqual(n["comments"], 35)
        self.assertEqual(n["approx"], ["likes"])
        self.assertEqual(n["type"], "video")
        self.assertEqual(n["duration"], 61)
        self.assertIsNone(n["tags"])
        self.assertFalse(n["detail"])

    def test_snake_case_api_item(self):
        item = {"id": "64a1b2c3d4e5f6a7b8c9d0e2", "model_type": "note", "xsec_token": "x",
                "note_card": {"type": "normal", "display_title": "t", "interact_info": {"liked_count": "7"}}}
        n = xp.note_from_card(item, "k", 2)
        self.assertEqual((n["likes"], n["type"], n["title"]), (7, "normal", "t"))

    def test_non_notes_skipped(self):
        self.assertIsNone(xp.note_from_card({"id": "abc", "modelType": "hot_query"}, "k", 1))
        self.assertIsNone(xp.note_from_card(card(id="bad id!"), "k", 1))

    def test_token_not_written(self):
        n = xp.note_from_card(card(), "k", 1)
        data = xp.evidence_file([], [n], collected_at="2026-01-01T10:00:00+08:00")
        self.assertNotIn("_token", data["notes"][0])
        self.assertNotIn("TOKEN-ONLY-FOR-SESSION", str(data))
        self.assertEqual(data["schema"], xp.SCHEMA)


class Detail(unittest.TestCase):
    def test_merge(self):
        n = xp.note_from_card(card(), "k", 1)
        detail = {
            "title": "가상 제목 收纳",
            "desc": "本文 #收纳技巧[话题]# #小户型[话题]#",
            "tagList": [{"name": "收纳技巧", "type": "topic"}],
            "time": 1767225600000,  # 2026-01-01 08:00 +08:00
            "ipLocation": "海南",
            "interactInfo": {"likedCount": "12034", "collectedCount": "800", "commentCount": "40", "shareCount": "10"},
        }
        xp.merge_detail(n, detail)
        self.assertEqual(n["tags"], ["收纳技巧", "小户型"])
        self.assertEqual(n["likes"], 12034)
        self.assertEqual(n["collects"], 800)
        self.assertEqual(n["approx"], [])
        self.assertEqual(n["publishedAt"], "2026-01-01T08:00:00+08:00")
        self.assertTrue(n["detail"])

    def test_missing_detail_keeps_card(self):
        n = xp.note_from_card(card(), "k", 1)
        xp.merge_detail(n, None)
        self.assertFalse(n["detail"])
        self.assertEqual(n["likes"], 12000)

    def test_detail_without_counts_keeps_card_approx(self):
        n = xp.note_from_card(card(), "k", 1)
        xp.merge_detail(n, {"desc": "x"})
        self.assertEqual(n["likes"], 12000)
        self.assertEqual(n["approx"], ["likes"])


class Related(unittest.TestCase):
    def test_words(self):
        payload = {"data": {"sug_items": [{"text": "收纳 小户型"}, {"text": "收纳"}, {"query": "租房改造"}, {"text": "x" * 40}]}}
        self.assertEqual(xp.related_words(payload, "收纳"), ["收纳 小户型", "租房改造"])

    def test_filter_menu_is_not_a_related_search(self):
        payload = {"data": {"filters": [{"name": "排序依据", "filter_tags": [{"name": "综合"}, {"name": "最新"}]}], "sug": [{"text": "海南新房"}]}}
        self.assertEqual(xp.related_words(payload, "海南 新家"), ["海南新房"])
        self.assertTrue(xp.is_filter_path("/api/sns/web/v1/search/filter"))
        self.assertTrue(xp.is_filter_path("/api/sns/web/v1/search/filters"))
        self.assertFalse(xp.is_filter_path("/api/sns/web/v1/search/recommend"))


class ResultStatus(unittest.TestCase):
    def test_search_result(self):
        self.assertEqual(xp.search_result(200, {"code": 0, "success": True, "data": {"items": [1]}}), ([1], None))
        self.assertEqual(xp.search_result(200, {"code": 0, "data": {"items": []}}), ([], None))
        self.assertEqual(xp.search_result(200, {"code": 0, "data": {"has_more": False}}), ([], None))
        # Not a usable answer: unknown, never zero
        self.assertEqual(xp.search_result(461, {}), (None, "HTTP 461"))
        self.assertEqual(xp.search_result(200, {"code": -100, "success": False}), (None, "code -100"))
        self.assertIsNone(xp.search_result(200, None)[0])
        self.assertIsNone(xp.search_result(200, {"code": 0, "data": {}})[0])

    def test_no_notes_status(self):
        self.assertEqual(xp.no_notes_status(0, True, []), ("empty", None))
        self.assertEqual(xp.no_notes_status(0, False, [])[0], "error")
        self.assertEqual(xp.no_notes_status(0, True, ["HTTP 461"])[0], "error")
        self.assertEqual(xp.no_notes_status(3, True, [])[0], "error")


class WriteFile(unittest.TestCase):
    def test_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(xp, "now_cst", return_value="2026-01-01T10:00:05+08:00"):
            paths = [xs.write_file(Path(d), [{"keyword": str(i)}], []) for i in range(3)]
            self.assertEqual(
                [p.name for p in paths],
                ["xhs-search_2026-01-01_100005.json", "xhs-search_2026-01-01_100005-2.json", "xhs-search_2026-01-01_100005-3.json"],
            )
            self.assertEqual([json.loads(p.read_text(encoding="utf-8"))["keywords"][0]["keyword"] for p in paths], ["0", "1", "2"])


class FakePage:
    """Stands in for a Playwright page: `loads` is one callable per page load."""

    def __init__(self, *loads):
        self.url = "https://www.xiaohongshu.com/search_result"
        self.loads, self.n, self.handler, self.feeds = loads, 0, None, None

    def on(self, _name, fn):
        self.handler = fn

    def remove_listener(self, *_a):
        pass

    def goto(self, *_a, **_k):
        self.loads[min(self.n, len(self.loads) - 1)](self)
        self.n += 1

    reload = goto

    def wait_for_timeout(self, _ms):
        pass

    def evaluate(self, js):
        return json.dumps(self.feeds) if js == xs.STATE_FEEDS_JS and self.feeds else ""

    def respond(self, path, data, status=200):
        self.handler(mock.Mock(url="https://edith.xiaohongshu.com" + path, status=status, json=lambda: data, request=mock.Mock(method="POST")))


NOTES = "/api/sns/web/v1/search/notes"


class SearchKeyword(unittest.TestCase):
    def run_search(self, page):
        with mock.patch.object(xs, "pause"), mock.patch.object(xs, "RESULT_WAIT_S", 0.05):
            return xs.search_keyword(page, "收纳", 0)

    def test_nothing_loaded_reloads_once_and_is_not_zero(self):
        page = FakePage(lambda p: p.respond("/api/sns/web/v1/search/filter", {"data": [{"name": "가상 메뉴"}]}))
        entry, notes = self.run_search(page)
        self.assertEqual((entry["status"], notes, page.n), ("error", [], 2))
        self.assertIsNone(entry["related"])

    def test_reload_recovers(self):
        page = FakePage(lambda p: None, lambda p: setattr(p, "feeds", [card()]))
        entry, notes = self.run_search(page)
        self.assertEqual((entry["status"], entry["error"], len(notes), page.n), ("ok", None, 1, 2))

    def test_real_zero_is_empty_without_reload(self):
        page = FakePage(lambda p: p.respond(NOTES, {"code": 0, "data": {"items": []}}))
        entry, _ = self.run_search(page)
        self.assertEqual((entry["status"], page.n), ("empty", 1))

    def test_api_refusal_is_error_without_reload(self):
        page = FakePage(lambda p: p.respond(NOTES, {}, status=461))
        entry, _ = self.run_search(page)
        self.assertEqual((entry["status"], entry["error"], page.n), ("error", "search API: HTTP 461", 1))


if __name__ == "__main__":
    unittest.main()
