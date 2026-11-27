# -*- coding: utf-8 -*-
"""주둔지 서버 쪽 수신기(참조 구현): 현장 TPCS 가 올린 기록 묶음을 받아 검사하고 폴더에 둔다.

  python -m ifps_ems_rt.archrecv <받을 폴더> [--bind 0.0.0.0] [--port 8092]
받으면 manifest 와 파일별 SHA-256 을 맞춰 본 뒤 저장하고, 받은 묶음 전체의 SHA-256 을 돌려준다(보낸 쪽이 이것으로 전달 완료를 적는다).
받은 이력은 폴더의 received.csv 에 한 줄씩 쌓인다. 접근 통제와 암호화(망 분리·TLS 종단)는 주둔지 망의 몫이다 — 이 수신기는 형식 검사만 한다.
"""
import argparse, csv, hashlib, json, os, re, sys, threading, time, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from . import archxfer

MAX_BODY = 256 * 1024 * 1024


def make_handler(folder):
    lock = threading.Lock()

    class H(BaseHTTPRequestHandler):
        server_version = "IFPS-TPCS-ARCHRECV"; sys_version = ""; timeout = 60

        def log_message(self, format, *args):       # pylint: disable=redefined-builtin
            pass

        def _send(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8"); self.send_response(code); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def do_POST(self):
            try:
                n = int(self.headers.get("Content-Length") or 0); name = self.headers.get("X-TPCS-File") or ""
                if not 0 < n <= MAX_BODY: return self._send(413, {"ok": False, "why": "본문 길이 오류"})
                if not re.fullmatch(r"TPCS_bundle_\d{12}-\d{12}\.zip", name): return self._send(400, {"ok": False, "why": "파일 이름 형식 오류"})
                body = self.rfile.read(n); sha = hashlib.sha256(body).hexdigest()
                if sha != (self.headers.get("X-TPCS-SHA256") or sha): return self._send(400, {"ok": False, "why": "SHA-256 불일치(전송 중 손상)"})
                man = archxfer.verify(body)
                with lock:
                    with open(os.path.join(folder, name), "wb") as f: f.write(body)
                    with open(os.path.join(folder, "received.csv"), "a", encoding="utf-8-sig", newline="") as f:
                        csv.writer(f).writerow([time.strftime("%Y-%m-%d %H:%M:%S"), self.client_address[0], name, n, sha, man.get("site", ""), man.get("from", ""), man.get("to", ""), man.get("rows", "")])
                return self._send(200, {"ok": True, "sha256": sha, "rows": man.get("rows")})
            except (ValueError, KeyError, OSError, zipfile.BadZipFile) as e:
                return self._send(400, {"ok": False, "why": f"{type(e).__name__}: {e}"})
    return H


def serve(folder, bind="127.0.0.1", port=8092):
    os.makedirs(folder, exist_ok=True); httpd = ThreadingHTTPServer((bind, port), make_handler(folder)); httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True).start(); return httpd


def main(argv=None):
    ap = argparse.ArgumentParser(description="주둔지 서버 수신기(기록 묶음 받기)"); ap.add_argument("folder"); ap.add_argument("--bind", default="127.0.0.1"); ap.add_argument("--port", type=int, default=8092)
    a = ap.parse_args(argv); httpd = serve(a.folder, a.bind, a.port); print(f"수신 대기: http://{a.bind}:{httpd.server_address[1]}/  → {os.path.abspath(a.folder)}\n끝내려면 Ctrl+C"); sys.stdout.flush()
    try: threading.Event().wait()
    except KeyboardInterrupt: pass
    finally: httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
