# -*- coding: utf-8 -*-
"""기록 조회기: TPCS 를 켜지 않고 기록 보관소(archive.db)만 읽어 브라우저로 보여 준다(읽기 전용).

  python -m ifps_ems_rt.archview [archive.db 경로] [--port 8091] [--no-browser]
경로를 비우면 config/state/archive.db → config/state_sim/archive.db 순으로 찾는다. 노트북 자신(127.0.0.1)에서만 열린다.
"""
import argparse, mimetypes, os, sys, threading, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from .hmi import archwatch

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hmi", "static")
FILES = {"/": "viewer.html", "/viewer.html": "viewer.html", "/archive.js": "archive.js", "/viewer.js": "viewer.js", "/style.css": "style.css"}


def make_handler(st):
    class H(BaseHTTPRequestHandler):
        server_version = "IFPS-TPCS-ARCHVIEW"; sys_version = ""; timeout = 15

        def log_message(self, format, *args):       # pylint: disable=redefined-builtin
            pass

        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            import json                                         # pylint: disable=import-outside-toplevel
            if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            elif isinstance(body, str): body = body.encode("utf-8")
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff"); self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:")
            for k, v in (extra or {}).items(): self.send_header(k, v)
            self.end_headers(); self.wfile.write(body)

        def _err(self, code, why):
            self._send(code, {"ok": False, "why": why})

        def do_GET(self):
            u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}; p = u.path
            try:
                if p in FILES:
                    with open(os.path.join(STATIC, FILES[p]), "rb") as f: body = f.read()
                    return self._send(200, body, (mimetypes.guess_type(FILES[p])[0] or "text/plain") + "; charset=utf-8")
                if p.startswith("/api/archive/") or p == "/api/report.docx": return archwatch.http_get(self, None, st, p, q)
                return self._err(404, "없음")
            except (KeyError, ValueError, TypeError) as e:
                return self._err(400, f"요청 오류: {e}")

        def do_POST(self):
            self._err(403, "기록 조회기는 읽기 전용입니다")
    return H


def find(path):
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")
    for c in ([path] if path else [os.path.join(base, "state", "archive.db"), os.path.join(base, "state_sim", "archive.db")]):
        if os.path.isfile(c): return c
    raise SystemExit("기록 보관소 파일을 찾지 못했습니다. 경로를 적어 주십시오: python -m ifps_ems_rt.archview <archive.db>")


def serve(path, port=8091):
    st = archwatch.open_store(path, read_only=True); arch = st.arch; httpd = ThreadingHTTPServer(("127.0.0.1", port), make_handler(st)); httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start(); return httpd, arch


def main(argv=None):
    ap = argparse.ArgumentParser(description="TPCS 기록 조회기(읽기 전용)"); ap.add_argument("db", nargs="?", default=""); ap.add_argument("--port", type=int, default=8091); ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv); path = find(a.db); httpd, arch = serve(path, a.port); url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"기록 조회기: {url}\n보관소: {path}\n끝내려면 Ctrl+C"); sys.stdout.flush()
    if not a.no_browser: webbrowser.open(url)
    try: threading.Event().wait()
    except KeyboardInterrupt: pass
    finally: httpd.shutdown(); arch.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
