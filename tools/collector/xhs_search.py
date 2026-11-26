"""VLOG Studio · 小红书 search collector (read only).

Opens a normal Chrome window with its own profile, lets you log in by scanning the
QR code yourself, then for each keyword opens the search page and the top notes and
reads what the page already loaded (window.__INITIAL_STATE__). It never posts,
likes, comments or follows, and it does not hide that it is automated.

Usage (see README.md):
    python tools/collector/xhs_search.py login
    python tools/collector/xhs_search.py search "海南 新家" "租房改造" --details 8
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import xhs_parse as xp  # noqa: E402

VERSION = "1"
HOME = "https://www.xiaohongshu.com/explore"
PROFILE_DIR = Path.home() / ".vlog-studio-collector" / "chrome-profile"
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = REPO_ROOT / "private-data" / "xhs-search"
MAX_KEYWORDS = 5
MAX_DETAILS = 10
RESULT_WAIT_S = 30

STATE_FEEDS_JS = """() => {
  const f = window.__INITIAL_STATE__?.search?.feeds;
  const v = f ? (f.value !== undefined ? f.value : f._value) : null;
  return v ? JSON.stringify(v) : '';
}"""
STATE_DETAIL_JS = """() => {
  const m = window.__INITIAL_STATE__?.note?.noteDetailMap;
  return m ? JSON.stringify(m) : '';
}"""
CURRENT_USER_JS = """() => {
  const u = window.__INITIAL_STATE__?.user;
  const ref = u && u.userInfo;
  const info = ref && (ref.value !== undefined ? ref.value : ref._value !== undefined ? ref._value : ref);
  if (!info || info.guest || !(info.nickname || info.userId || info.user_id)) return '';
  return JSON.stringify({ nickname: info.nickname || '' });
}"""


class Blocked(Exception):
    """The site asked for a login or a security check: stop and keep what we have."""

    def __init__(self, reason, notes=None):
        super().__init__(reason)
        self.notes = notes or []


def pause(a=4.0, b=8.0):
    time.sleep(random.uniform(a, b))


def check_blocked(page):
    path = urlparse(page.url).path
    if path.startswith("/website-login"):
        raise Blocked("captcha" if "captcha" in path else "login")


def eval_json(page, js):
    try:
        raw = page.evaluate(js)
        return json.loads(raw) if raw else None
    except Exception:
        return None


def open_browser(p):
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        PROFILE_DIR.chmod(0o700)
        PROFILE_DIR.parent.chmod(0o700)
    except OSError:
        pass
    opts = dict(user_data_dir=str(PROFILE_DIR), headless=False, viewport={"width": 1280, "height": 860}, locale="zh-CN")
    try:
        return p.chromium.launch_persistent_context(channel="chrome", **opts)
    except Exception:
        # No Google Chrome installed: Playwright's own Chromium (python -m playwright install chromium).
        return p.chromium.launch_persistent_context(**opts)


def current_user(page):
    return eval_json(page, CURRENT_USER_JS)


def wait_login(page, timeout_s=300):
    page.goto(HOME, wait_until="domcontentloaded", timeout=60000)
    time.sleep(3)
    user = current_user(page)
    if user:
        return user
    print("\n[로그인] 열린 Chrome 창에서 '登录'을 누르고, 小红书 앱으로 QR 코드를 스캔하세요. (최대 5분 대기)")
    end = time.time() + timeout_s
    while time.time() < end:
        time.sleep(3)
        try:
            if urlparse(page.url).path.startswith("/website-login"):
                continue
            user = current_user(page)
            if user:
                return user
        except Exception:
            pass
    return None


def wait_results(page, captured):
    """Waits until the results are on the page or the site has answered. Returns the items (possibly empty)."""
    end = time.time() + RESULT_WAIT_S
    while time.time() < end:
        page.wait_for_timeout(1500)  # unlike time.sleep, lets response events through
        check_blocked(page)
        items = xp.feed_items(eval_json(page, STATE_FEEDS_JS)) or captured["api"]
        if items:
            return items
        if captured["answered"] or captured["problems"]:
            return []
    return []


def search_keyword(page, keyword, details):
    entry = {"keyword": keyword, "searchedAt": xp.now_cst(), "status": "ok", "error": None, "related": None, "noteIds": []}
    captured = {"api": [], "related": [], "answered": False, "problems": []}

    def on_response(resp):
        try:
            path = urlparse(resp.url).path
            if "/api/sns/web/" not in path or "search" not in path:
                return
            if path.endswith("/search/notes"):
                if resp.request.method == "OPTIONS":
                    return
                try:
                    data = resp.json()
                except Exception:
                    data = None
                found, problem = xp.search_result(resp.status, data)
                if problem:
                    captured["problems"].append(problem)
                else:
                    captured["answered"] = True
                    captured["api"].extend(found)
            elif not xp.is_filter_path(path):
                captured["related"].extend(xp.related_words(resp.json(), keyword))
        except Exception:
            pass

    page.on("response", on_response)
    try:
        page.goto(f"https://www.xiaohongshu.com/search_result?keyword={quote(keyword)}&source=web_search_result_notes", wait_until="domcontentloaded", timeout=60000)
        check_blocked(page)
        items = wait_results(page, captured)
        if not items and not captured["answered"] and not captured["problems"]:
            # Nothing came back at all (slow load): reload once. Never after an answer or an error.
            pause()
            page.reload(wait_until="domcontentloaded", timeout=60000)
            check_blocked(page)
            items = wait_results(page, captured)
        # Hot-query cards inside the results are real search phrases too.
        related = list(dict.fromkeys(captured["related"] + xp.related_words([i for i in items if isinstance(i, dict) and i.get("modelType") not in (None, "note")], keyword)))
        entry["related"] = related or None
        notes = []
        for item in items:
            n = xp.note_from_card(item, keyword, len(notes) + 1)
            if n:
                notes.append(n)
        if not notes:
            entry["status"], entry["error"] = xp.no_notes_status(len(items), captured["answered"], captured["problems"])
            return entry, []
        entry["noteIds"] = [n["id"] for n in notes]
        for n in notes[:details]:
            if not n.get("_token"):
                continue
            pause()
            try:
                page.goto(f"https://www.xiaohongshu.com/explore/{n['id']}?xsec_token={quote(n['_token'])}&xsec_source=pc_search", wait_until="domcontentloaded", timeout=60000)
                time.sleep(2)
                check_blocked(page)
                xp.merge_detail(n, xp.detail_from_state(eval_json(page, STATE_DETAIL_JS), n["id"]))
            except Blocked as b:
                b.notes = notes  # the search results and details read so far are kept
                raise
            except Exception:
                continue  # this note keeps its search-card values (detail: false)
        return entry, notes
    finally:
        page.remove_listener("response", on_response)


def write_file(out_dir, keywords, notes):
    out_dir.mkdir(parents=True, exist_ok=True)
    data = xp.evidence_file(keywords, notes, tool_version=VERSION)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    stem = "xhs-search_" + data["collectedAt"][:19].replace(":", "").replace("T", "_")
    n = 1
    while True:
        path = out_dir / (f"{stem}.json" if n == 1 else f"{stem}-{n}.json")
        try:
            with path.open("x", encoding="utf-8") as f:  # "x": never overwrite an earlier result
                f.write(text)
            return path
        except FileExistsError:
            n += 1


def cmd_login(_args):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = open_browser(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        user = wait_login(page)
        print(f"[로그인] 완료: {user.get('nickname') or '(닉네임 없음)'}" if user else "[로그인] 확인하지 못했어요. 다시 실행해 주세요.")
        ctx.close()
        return 0 if user else 1


def cmd_logout(_args):
    import shutil

    if PROFILE_DIR.exists():
        shutil.rmtree(PROFILE_DIR)
    print(f"[로그아웃] 로그인 정보(브라우저 프로필)를 지웠어요: {PROFILE_DIR}")
    return 0


def cmd_search(args):
    from playwright.sync_api import sync_playwright

    keywords = [k.strip() for k in args.keywords if k.strip()][:MAX_KEYWORDS]
    if not keywords:
        print("검색어를 1개 이상 넣어 주세요.")
        return 2
    details = max(0, min(args.details, MAX_DETAILS))
    out_dir = Path(args.out).expanduser() if args.out else DEFAULT_OUT
    entries, all_notes = [], []
    with sync_playwright() as p:
        ctx = open_browser(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            if not wait_login(page):
                print("[로그인] 로그인하지 않으면 검색 결과를 읽을 수 없어요.")
                return 1
            for i, kw in enumerate(keywords):
                if i:
                    pause(6, 12)
                print(f"[검색] {kw} …")
                try:
                    entry, notes = search_keyword(page, kw, details)
                except Blocked as b:
                    entries.append({"keyword": kw, "searchedAt": xp.now_cst(), "status": "blocked", "error": str(b), "related": None, "noteIds": [n["id"] for n in b.notes]})
                    all_notes.extend(b.notes)
                    print("[중단] 小红书가 로그인 또는 보안 확인을 요청했어요. 지금까지 읽은 것만 저장합니다. 잠시 뒤 다시 시도하세요.")
                    break
                except Exception as e:  # keep the other keywords
                    entry, notes = {"keyword": kw, "searchedAt": xp.now_cst(), "status": "error", "error": str(e)[:200], "related": None, "noteIds": []}, []
                entries.append(entry)
                all_notes.extend(notes)
                print(f"        노트 {len(notes)}개 (상세 {sum(1 for n in notes if n['detail'])}개)")
                if entry["status"] == "empty":
                    print("        小红书가 결과 0개라고 답했어요.")
                elif entry["status"] == "error":
                    print(f"        결과를 읽지 못했어요(0개라는 뜻이 아니에요): {entry['error']}")
        finally:
            ctx.close()
    path = write_file(out_dir, entries, all_notes)
    if not all_notes:
        print(f"\n[저장] {path}\n읽은 노트가 없어요. 이 파일은 앱에 넣지 말고, 시간을 두고 다시 시도하세요.")
        return 1
    print(f"\n[저장] {path}\nVLOG Studio → 더보기 → 검색 근거 추천 → '수집 파일 가져오기'에서 이 파일을 고르세요.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="VLOG Studio 小红书 검색 수집기 (읽기 전용)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login", help="QR 코드로 로그인 (한 번만)")
    sub.add_parser("logout", help="이 수집기의 로그인 정보 지우기")
    s = sub.add_parser("search", help="검색어별 상위 노트 읽기")
    s.add_argument("keywords", nargs="+", help=f"검색어 (최대 {MAX_KEYWORDS}개)")
    s.add_argument("--details", type=int, default=8, help=f"검색어마다 본문·태그를 읽을 노트 수 (기본 8, 최대 {MAX_DETAILS})")
    s.add_argument("--out", help="저장 폴더 (기본: 저장소의 private-data/xhs-search)")
    args = ap.parse_args(argv)
    return {"login": cmd_login, "logout": cmd_logout, "search": cmd_search}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
