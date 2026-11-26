"""VLOG Studio · collector waiting mode (read only).

Lets the app's 검색하기 button run a collection on this computer:
- listens on 127.0.0.1 only, so nothing outside this PC can reach it;
- answers only pages from VLOG Studio's own address (Origin) asked for by this PC's name (Host);
- runs one collection at a time, with the same limits as the command line;
- turns itself off after 30 minutes without a request.

It is started by the app through the vlogstudio-collector: link (see `install`) or by hand
with `python tools/collector/xhs_search.py serve`. Close the window to stop it.
"""

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import xhs_search as xs

PORT = 47831
ALLOWED_ORIGINS = frozenset({
    "https://krissallyteeth.github.io",
    # Local development and preview of the app (npm run dev / npm run preview)
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
})
IDLE_EXIT_S = 30 * 60
MAX_BODY = 4096
LOG_KEEP = 30


def check_request(origin, host, port):
    """None when the request may be answered, else why not."""
    if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
        return "host"
    if origin not in ALLOWED_ORIGINS:
        return "origin"
    return None


def parse_search(body):
    """Request body -> (keywords, details). ValueError with a short code when it is not acceptable."""
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("json") from None
    if not isinstance(data, dict) or not isinstance(data.get("keywords"), list):
        raise ValueError("keywords")
    raw = [k for k in data["keywords"] if isinstance(k, str) and k.strip()]
    if not raw or len(raw) > xs.MAX_KEYWORDS or len(raw) != len(data["keywords"]):
        raise ValueError("keywords")
    if any(len(" ".join(k.split())) > xs.MAX_KEYWORD_LEN for k in raw):
        raise ValueError("keywords")
    details = data.get("details", 8)
    if isinstance(details, bool) or not isinstance(details, int) or not 0 <= details <= xs.MAX_DETAILS:
        raise ValueError("details")
    return xs.clean_keywords(raw), details


class Busy(Exception):
    pass


class Collector:
    """Holds the one job that may run at a time."""

    def __init__(self, collect_fn, out_dir):
        self.collect_fn, self.out_dir = collect_fn, out_dir
        self.lock = threading.Lock()
        self.job, self.seq = None, 0
        self.last_seen = time.time()

    def busy(self):
        return bool(self.job and self.job["state"] == "running")

    def start(self, keywords, details):
        with self.lock:
            if self.busy():
                raise Busy()
            self.seq += 1
            self.job = {"id": self.seq, "state": "running", "phase": "starting", "keywords": keywords, "keyword": None,
                        "index": None, "total": len(keywords), "reason": None, "log": [], "file": None, "result": None,
                        "covers": None}
            job = self.job
        threading.Thread(target=self._run, args=(job, details), daemon=True).start()
        return job

    def _run(self, job, details):
        def log(msg):
            print(msg, flush=True)
            job["log"] = (job["log"] + [line for line in str(msg).splitlines() if line.strip()])[-LOG_KEEP:]

        def progress(phase, **info):
            job.update(phase=phase, **{k: v for k, v in info.items() if k in ("keyword", "index", "total")})

        covers = {}  # shown once by the app, never written to disk
        try:
            code, path = self.collect_fn(job["keywords"], details, self.out_dir, log=log, progress=progress, covers=covers)
            if path:
                job["result"] = json.loads(Path(path).read_text(encoding="utf-8"))
                job["file"] = Path(path).name
            job["reason"] = None if code == 0 else "refused" if code == 3 else ("nothing" if path else "login")
        except Exception as e:  # shown in the window; the app gets a short reason only
            log(f"[오류] {e}")
            job["reason"] = "error"
        finally:
            self.last_seen = time.time()
            job["covers"] = covers  # sent only once the job has ended
            job["state"] = "done" if job["reason"] is None else "failed"
            job["phase"] = job["state"]


class Handler(BaseHTTPRequestHandler):
    server_version = "vlog-studio-collector"

    def log_message(self, *_args):
        pass

    @property
    def app(self):
        return self.server.app

    def _guard(self):
        bad = check_request(self.headers.get("Origin"), self.headers.get("Host"), self.server.server_address[1])
        if bad:
            self._send(403, {"error": bad}, cors=False)
            return False
        self.app.last_seen = time.time()
        return True

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin"))
        self.send_header("Vary", "Origin")

    def _send(self, code, obj, cors=True):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if cors:
            self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._guard():
            return
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self._guard():
            return
        if self.path == "/status":
            return self._send(200, {"app": "vlog-studio-collector", "version": xs.VERSION, "busy": self.app.busy(),
                                    "maxKeywords": xs.MAX_KEYWORDS, "maxDetails": xs.MAX_DETAILS})
        if self.path == "/job":
            job = self.app.job
            if not job:
                return self._send(200, {"state": "none"})
            view = dict(job)
            if view["state"] == "running":
                view["covers"] = None
            return self._send(200, view)
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._guard():
            return
        if self.path != "/search":
            return self._send(404, {"error": "not found"})
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            return self._send(415, {"error": "json"})
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            size = -1
        if not 0 < size <= MAX_BODY:
            return self._send(413, {"error": "size"})
        try:
            keywords, details = parse_search(self.rfile.read(size))
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        try:
            job = self.app.start(keywords, details)
        except Busy:
            return self._send(409, {"error": "busy", "id": self.app.job["id"]})
        self._send(202, {"id": job["id"]})


class Server(ThreadingHTTPServer):
    allow_reuse_address = False  # on Windows reuse would let a second copy share the port
    daemon_threads = True

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(port=PORT, collect_fn=None, out_dir=None):
    httpd = Server(("127.0.0.1", port), Handler)
    httpd.app = Collector(collect_fn or xs.collect, out_dir or xs.DEFAULT_OUT)
    return httpd


def serve(port=PORT, idle_exit_s=IDLE_EXIT_S):
    try:
        httpd = make_server(port)
    except OSError:
        print("[대기] 수집기가 이미 켜져 있어요. 이 창은 닫아도 돼요.")
        time.sleep(3)
        return 0

    def idle_watch():
        while True:
            time.sleep(15)
            if not httpd.app.busy() and time.time() - httpd.app.last_seen > idle_exit_s:
                print("\n[대기] 30분 동안 요청이 없어 수집기를 끕니다.", flush=True)
                httpd.shutdown()
                return

    threading.Thread(target=idle_watch, daemon=True).start()
    print("[대기] VLOG Studio 수집기가 켜졌어요. 앱에서 '검색하기'를 누르면 이 창에 진행 상황이 나와요.")
    print("       이 PC 안에서만 받고, 30분 동안 요청이 없으면 저절로 꺼져요. 바로 끄려면 이 창을 닫으세요.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0
