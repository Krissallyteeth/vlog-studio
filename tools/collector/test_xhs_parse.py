"""Run: python -m unittest discover -s tools/collector  (fictional data only)."""

import unittest

import xhs_parse as xp


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


if __name__ == "__main__":
    unittest.main()
