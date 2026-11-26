"""VLOG Studio · 小红书 search collector (read only).

Opens a normal Chrome window with its own profile, lets you log in by scanning the
QR code yourself, then for each keyword opens the search page and the top notes and
reads what the page already loaded (window.__INITIAL_STATE__). It never posts,
likes, comments or follows, and it does not hide that it is automated.

Usage (see README.md):
    python tools/collector/xhs_search.py login
    python tools/collector/xhs_search.py search "海南 新家" "租房改造" --details 8
    python tools/collector/xhs_search.py serve      # waiting mode for the app's 검색하기 button
    python tools/collector/xhs_search.py install    # Windows: let the app start `serve` with a link
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
MAX_KEYWORD_LEN = 40
COVER_WIDTH = 240  # px; the app shows covers small
COVER_QUALITY = 0.6  # WebP quality, about 5-15 KB per cover
COVER_MAX_BYTES = 5_000_000
COMPRESS_JS = """async ([b64, type, maxW, q]) => {
  const blob = await (await fetch(`data:${type};base64,${b64}`)).blob();
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxW / bmp.width);
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * s)), Math.max(1, Math.round(bmp.height * s)));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: q })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return 'data:image/webp;base64,' + btoa(bin);
}"""
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


def wait_login(page, timeout_s=300, log=print, progress=lambda *a, **k: None):
    page.goto(HOME, wait_until="domcontentloaded", timeout=60000)
    time.sleep(3)
    user = current_user(page)
    if user:
        return user
    progress("login")
    log("\n[로그인] 열린 Chrome 창에서 '登录'을 누르고, 小红书 앱으로 QR 코드를 스캔하세요. (최대 5분 대기)")
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


def fetch_covers(ctx, notes, covers):
    """Downloads each note's cover, shrinks it in a blank tab, keeps it in `covers` (memory only)."""
    import base64

    todo = [n for n in notes if n.get("_cover_url") and n["id"] not in covers]
    if not todo:
        return
    tab = ctx.new_page()
    try:
        for n in todo:
            try:
                resp = ctx.request.get(n["_cover_url"], headers={"Referer": "https://www.xiaohongshu.com/"}, timeout=15000)
                body = resp.body() if resp.ok else b""
                kind = (resp.headers.get("content-type") or "").split(";")[0].strip()
                if not body or len(body) > COVER_MAX_BYTES or not kind.startswith("image/"):
                    continue
                covers[n["id"]] = tab.evaluate(COMPRESS_JS, [base64.b64encode(body).decode(), kind, COVER_WIDTH, COVER_QUALITY])
            except Exception:
                continue  # no cover for this note
    finally:
        tab.close()


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


def clean_keywords(keywords):
    out = []
    for k in keywords:
        k = " ".join(str(k).split())[:MAX_KEYWORD_LEN]
        if k and k not in out:
            out.append(k)
    return out[:MAX_KEYWORDS]


def collect(keywords, details, out_dir, log=print, progress=lambda *a, **k: None, covers=None):
    """One collection run. Returns (exit_code, saved_path or None).
    With a dict as `covers`, also fills it with {note id: small WebP data URL}; covers never go into the file."""
    from playwright.sync_api import sync_playwright

    keywords = clean_keywords(keywords)
    if not keywords:
        log("검색어를 1개 이상 넣어 주세요.")
        return 2, None
    details = max(0, min(details, MAX_DETAILS))
    entries, all_notes = [], []
    progress("starting", total=len(keywords))
    with sync_playwright() as p:
        ctx = open_browser(p)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            if not wait_login(page, log=log, progress=progress):
                log("[로그인] 로그인하지 않으면 검색 결과를 읽을 수 없어요.")
                return 1, None
            for i, kw in enumerate(keywords):
                if i:
                    pause(6, 12)
                progress("keyword", index=i, keyword=kw, total=len(keywords))
                log(f"[검색] {kw} …")
                try:
                    entry, notes = search_keyword(page, kw, details)
                except Blocked as b:
                    entries.append({"keyword": kw, "searchedAt": xp.now_cst(), "status": "blocked", "error": str(b), "related": None, "noteIds": [n["id"] for n in b.notes]})
                    all_notes.extend(b.notes)
                    log("[중단] 小红书가 로그인 또는 보안 확인을 요청했어요. 지금까지 읽은 것만 저장합니다. 잠시 뒤 다시 시도하세요.")
                    break
                except Exception as e:  # keep the other keywords
                    entry, notes = {"keyword": kw, "searchedAt": xp.now_cst(), "status": "error", "error": str(e)[:200], "related": None, "noteIds": []}, []
                entries.append(entry)
                all_notes.extend(notes)
                if covers is not None and notes:
                    fetch_covers(ctx, notes, covers)
                log(f"        노트 {len(notes)}개 (상세 {sum(1 for n in notes if n['detail'])}개)")
                if covers is not None and notes:
                    log(f"        표지 {sum(1 for n in notes if n['id'] in covers)}개 (주소 있음 {sum(1 for n in notes if n.get('_cover_url'))}개)")
                if entry["status"] == "empty":
                    log("        小红书가 결과 0개라고 답했어요.")
                elif entry["status"] == "error":
                    log(f"        결과를 읽지 못했어요(0개라는 뜻이 아니에요): {entry['error']}")
        finally:
            ctx.close()
    progress("saving")
    path = write_file(out_dir, entries, all_notes)
    if not all_notes:
        log(f"\n[저장] {path}\n읽은 노트가 없어요. 이 파일은 앱에 넣지 말고, 시간을 두고 다시 시도하세요.")
        return 1, path
    log(f"\n[저장] {path}\nVLOG Studio → 더보기 → 검색 근거 추천 → '수집 파일 가져오기'에서 이 파일을 고르세요.")
    return 0, path


def cmd_search(args):
    out_dir = Path(args.out).expanduser() if args.out else DEFAULT_OUT
    return collect(args.keywords, args.details, out_dir)[0]


def cmd_serve(_args):
    import xhs_server

    return xhs_server.serve()


LINK_KEY = r"Software\Classes\vlogstudio-collector"


def link_command():
    # The link's own text is never passed on: the collector only ever starts its waiting mode.
    return f'"{sys.executable}" "{Path(__file__).resolve()}" serve'


def cmd_install(_args):
    if sys.platform != "win32":
        print("[설치] 링크로 켜기는 Windows에서만 지원해요. 대신 'serve' 명령으로 켜 두세요.")
        return 1
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, LINK_KEY) as k:
        winreg.SetValueEx(k, None, 0, winreg.REG_SZ, "URL:VLOG Studio collector")
        winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, LINK_KEY + r"\shell\open\command") as k:
        winreg.SetValueEx(k, None, 0, winreg.REG_SZ, link_command())
    print("[설치] 완료. 이제 VLOG Studio의 '검색하기'를 누르면 수집기가 켜져요.")
    print("        처음 한 번 Chrome이 열지 물으면 '항상 허용'에 체크하고 '열기'를 누르세요.")
    return 0


def cmd_uninstall(_args):
    if sys.platform != "win32":
        return 0
    import winreg

    def delete(path):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as k:
                while True:
                    try:
                        sub = winreg.EnumKey(k, 0)
                    except OSError:
                        break
                    delete(path + "\\" + sub)
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
        except FileNotFoundError:
            pass

    delete(LINK_KEY)
    print("[제거] 링크로 켜기를 지웠어요. 로그인 정보까지 지우려면 'logout'을 실행하세요.")
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
    sub.add_parser("serve", help="앱의 '검색하기'를 기다리는 대기 모드 (이 PC 안에서만)")
    sub.add_parser("install", help="Windows: 앱에서 링크로 대기 모드를 켤 수 있게 등록")
    sub.add_parser("uninstall", help="Windows: 링크로 켜기 등록 지우기")
    args = ap.parse_args(argv)
    cmds = {"login": cmd_login, "logout": cmd_logout, "search": cmd_search, "serve": cmd_serve, "install": cmd_install, "uninstall": cmd_uninstall}
    return cmds[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
