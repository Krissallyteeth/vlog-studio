"""Waiting mode: who may call it, what it accepts, one job at a time (fake collection, no browser)."""

import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import xhs_parse as xp
import xhs_server as srv

APP = "https://krissallyteeth.github.io"


class Checks(unittest.TestCase):
    def test_check_request(self):
        self.assertIsNone(srv.check_request(APP, "127.0.0.1:47831", 47831))
        self.assertIsNone(srv.check_request("http://localhost:5173", "localhost:47831", 47831))
        self.assertEqual(srv.check_request("https://evil.example", "127.0.0.1:47831", 47831), "origin")
        self.assertEqual(srv.check_request(None, "127.0.0.1:47831", 47831), "origin")
        self.assertEqual(srv.check_request("https://krissallyteeth.github.io.evil.example", "127.0.0.1:47831", 47831), "origin")
        # A name that only resolves to this PC (DNS rebinding) is refused
        self.assertEqual(srv.check_request(APP, "rebind.example:47831", 47831), "host")

    def test_parse_search(self):
        body = lambda o: json.dumps(o).encode()
        self.assertEqual(srv.parse_search(body({"keywords": [" 海南  新家 ", "收纳"], "details": 3})), (["海南 新家", "收纳"], 3))
        self.assertEqual(srv.parse_search(body({"keywords": ["收纳"]}))[1], 8)
        for bad in ({"keywords": []}, {"keywords": ["a"] * 6}, {"keywords": ["x" * 41]}, {"keywords": [1]}, {"keywords": ["a", " "]},
                    {"keywords": "收纳"}, {"keywords": ["a"], "details": 11}, {"keywords": ["a"], "details": True}, []):
            with self.assertRaises(ValueError, msg=bad):
                srv.parse_search(body(bad))
        with self.assertRaises(ValueError):
            srv.parse_search(b"\xff")


class Live(unittest.TestCase):
    """A real server on a free port; the collection itself is faked."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.gate = threading.Event()
        self.result_code = 0

        def fake_collect(keywords, details, out_dir, log, progress, covers):
            progress("keyword", index=0, keyword=keywords[0], total=len(keywords))
            log("[검색] fake")
            covers["64a1b2c3d4e5f6a7b8c9d0e1"] = "data:image/webp;base64,AAAA"
            self.gate.wait(5)
            data = xp.evidence_file([{"keyword": k, "status": "ok"} for k in keywords], [], collected_at="2026-01-01T10:00:00+08:00")
            path = Path(out_dir) / "r.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            return self.result_code, path

        self.httpd = srv.make_server(0, fake_collect, self.tmp.name)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.gate.set()
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def req(self, path, method="GET", body=None, origin=APP, headers=None):
        h = {"Origin": origin} if origin else {}
        if body is not None:
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, headers=h,
                                   data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(r, timeout=5) as res:
                return res.status, dict(res.headers), json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), json.loads(e.read() or b"{}")

    def wait_job(self, state):
        for _ in range(100):
            job = self.req("/job")[2]
            if job["state"] == state:
                return job
            time.sleep(0.05)
        self.fail(f"job never reached {state}: {job}")

    def test_status_and_cors(self):
        code, headers, data = self.req("/status")
        self.assertEqual((code, data["app"], data["busy"]), (200, "vlog-studio-collector", False))
        self.assertEqual(headers["Access-Control-Allow-Origin"], APP)

    def test_other_sites_refused(self):
        for origin in ("https://evil.example", None):
            code, headers, _ = self.req("/status", origin=origin)
            self.assertEqual(code, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.req("/search", "POST", {"keywords": ["a"]}, origin="https://evil.example")[0], 403)

    def test_preflight_allows_private_network(self):
        code, headers, _ = self.req("/search", "OPTIONS", headers={"Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"})
        self.assertEqual((code, headers.get("Access-Control-Allow-Private-Network")), (204, "true"))

    def test_search_runs_one_at_a_time_and_returns_the_result(self):
        code, _, data = self.req("/search", "POST", {"keywords": ["收纳", "海南"], "details": 2})
        self.assertEqual(code, 202)
        job = self.wait_job("running")
        self.assertEqual((job["phase"], job["keyword"], job["total"]), ("keyword", "收纳", 2))
        self.assertIsNone(job["covers"])  # not resent on every poll while running
        self.assertEqual(self.req("/search", "POST", {"keywords": ["x"]})[0], 409)
        self.gate.set()
        job = self.wait_job("done")
        self.assertEqual((job["reason"], job["file"]), (None, "r.json"))
        self.assertEqual([k["keyword"] for k in job["result"]["keywords"]], ["收纳", "海南"])
        self.assertIn("[검색] fake", job["log"])
        self.assertEqual(job["covers"], {"64a1b2c3d4e5f6a7b8c9d0e1": "data:image/webp;base64,AAAA"})
        # Covers go to the app only: the saved file has none
        saved = (Path(self.tmp.name) / "r.json").read_text(encoding="utf-8")
        self.assertNotIn("base64", saved)
        self.assertEqual(self.req("/search", "POST", {"keywords": ["x"]})[0], 202)

    def test_failed_run_reports_reason(self):
        self.result_code = 1
        self.gate.set()
        self.req("/search", "POST", {"keywords": ["a"]})
        self.assertEqual(self.wait_job("failed")["reason"], "nothing")

    def test_refused_run_reports_refused(self):
        self.result_code = 3
        self.gate.set()
        self.req("/search", "POST", {"keywords": ["a"]})
        self.assertEqual(self.wait_job("failed")["reason"], "refused")

    def test_bad_requests(self):
        self.assertEqual(self.req("/search", "POST", {"keywords": ["a"] * 6})[0], 400)
        self.assertEqual(self.req("/nope")[0], 404)
        code = self.req("/search", "POST", None, headers={"Content-Type": "text/plain", "Content-Length": "2"})[0]
        self.assertIn(code, (413, 415))

    def test_second_copy_cannot_share_the_port(self):
        with self.assertRaises(OSError):
            srv.make_server(self.port)


class Sealed(unittest.TestCase):
    def test_nothing_that_opens_xhs_runs_while_sealed(self):
        import xhs_search

        self.assertTrue(xhs_search.SEALED)
        for cmd in (["login"], ["serve"], ["install"], ["search", "收纳"]):
            self.assertEqual(xhs_search.main(cmd), 4, cmd)


if __name__ == "__main__":
    unittest.main()
