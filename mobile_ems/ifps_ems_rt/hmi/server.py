# -*- coding: utf-8 -*-
"""HMI 웹 서버(표준 라이브러리 http.server). 외부 CDN·글꼴을 쓰지 않아 폐쇄망 노트북에서 그대로 동작한다.

권한  viewer(로그인 없음): 조회   operator: 지령·경보 확인·자동 제어 전환   engineer: + 레지스터 쓰기·고장 주입
기본 접속 주소는 127.0.0.1(노트북 자신)이다. 다른 단말에서 보려면 runtime.json의 hmi.bind를 바꾼다.
"""
import json, mimetypes, os, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from .. import modbus as mb
from .engine import ROLES

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_BODY = 64 * 1024


def make_handler(eng):
    class H(BaseHTTPRequestHandler):
        server_version = "IFPS-EMS-HMI"; sys_version = ""

        def log_message(self, fmt, *a):            # 접속 기록은 감사 기록에만(지령 계열) 남긴다
            pass

        # ── 응답
        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False, default=_jdefault).encode("utf-8")
            elif isinstance(body, str): body = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store"); self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY"); self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
            for k, v in (extra or {}).items(): self.send_header(k, v)
            self.end_headers(); self.wfile.write(body)

        def _err(self, code, why):
            self._send(code, {"ok": False, "why": why})

        def _sess(self, need=None):
            s = eng.session(self.headers.get("X-EMS-Token"))
            if need is None: return s or {"role": "viewer", "name": "조회"}
            if s is None or ROLES[s["role"]] < ROLES[need]:
                self._err(403, f"권한 필요: {need}"); return None
            return s

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY: raise ValueError("요청 본문이 너무 큼")
            raw = self.rfile.read(n) if n else b"{}"
            return json.loads(raw.decode("utf-8") or "{}")

        # ── GET
        def do_GET(self):
            u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}; p = u.path
            try:
                if p == "/api/snapshot":
                    s = self._sess(); d = eng.snapshot(); d["me"] = {"role": s["role"], "name": s["name"]}; return self._send(200, d)
                if p == "/api/trend": return self._send(200, {"cols": ["t", "load", "pv", "dg", "fc", "ess", "soc", "h2", "reserve"], "rows": eng.trend_since(float(q.get("since", 0)))})
                if p == "/api/trace": return self._send(200, {"rows": eng.trace_since(int(q.get("since", 0)), int(q.get("limit", 500))), "on": eng.trace_on})
                if p == "/api/points": return self._send(200, {"rows": eng.points()})
                if p == "/api/journal": return self._send(200, {"rows": eng.alarms.journal(int(q.get("n", 300)))})
                if p == "/api/audit": return self._send(200, {"rows": eng.rt.audit.tail(int(q.get("n", 200)))[::-1]})
                if p == "/api/audit/verify": return self._send(200, eng.audit_verify())
                if p == "/api/info": return self._send(200, eng.runtime_info())
                if p == "/api/mb/read":
                    if self._sess("operator") is None: return
                    return self._send(200, eng.mb_read(q))
                if p == "/api/export/trend.csv":
                    rows = eng.trend_since(0); cols = "time,load_kw,pv_kw,dg_kw,fc_kw,ess_kw,soc_pct,h2_nm3,reserve_margin_kw\n"
                    body = cols + "".join(time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(r[0] / 1000)) + "," + ",".join(str(x) for x in r[1:]) + "\n" for r in rows)
                    return self._send(200, "﻿" + body, "text/csv; charset=utf-8", {"Content-Disposition": "attachment; filename=ems_trend.csv"})
                return self._static(p)
            except mb.ModbusError as e:
                return self._send(200, {"ok": False, "why": f"통신 오류: {e}"})
            except (KeyError, ValueError, TypeError) as e:
                return self._err(400, f"요청 오류: {e}")
            except Exception as e:
                traceback.print_exc(); return self._err(500, f"{type(e).__name__}: {e}")

        def _static(self, p):
            if p in ("/", ""): p = "/index.html"
            fp = os.path.normpath(os.path.join(STATIC, p.lstrip("/")))
            if not fp.startswith(STATIC) or not os.path.isfile(fp): return self._err(404, "없음")
            ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript",): ctype += "; charset=utf-8"
            with open(fp, "rb") as f: self._send(200, f.read(), ctype)

        # ── POST
        def do_POST(self):
            p = urlparse(self.path).path
            try:
                b = self._body()
                if p == "/api/login": return self._send(200, eng.login(b.get("pin", ""), (b.get("name") or "운용자")[:24]))
                if p == "/api/logout": return self._send(200, eng.logout(self.headers.get("X-EMS-Token")))
                if p == "/api/select":
                    s = self._sess("operator")
                    if s: self._send(200, eng.select(b["dev"], b["cmd"], s["name"], b.get("tag"), b.get("value")))
                    return
                if p == "/api/operate":
                    s = self._sess("operator")
                    if s: self._send(200, eng.operate(b["sid"], s["name"]))
                    return
                if p == "/api/cancel":
                    s = self._sess("operator")
                    if s: self._send(200, eng.cancel(b.get("sid", ""), s["name"]))
                    return
                if p == "/api/auto":
                    s = self._sess("operator")
                    if s: self._send(200, eng.set_auto(b.get("on", True), s["name"]))
                    return
                if p == "/api/control_now":
                    s = self._sess("operator")
                    if s: self._send(200, eng.control_now(s["name"]))
                    return
                if p == "/api/ack":
                    s = self._sess("operator")
                    if s:
                        ids = b.get("ids", "all"); n = eng.alarms.ack(ids if ids == "all" else [int(i) for i in ids], s["name"])
                        eng.rt.note("경보", f"경보 확인 {n}건", actor=s["name"]); self._send(200, {"ok": True, "n": n})
                    return
                if p == "/api/trace":
                    eng.trace_on = bool(b.get("on", True)); return self._send(200, {"ok": True, "on": eng.trace_on})
                if p == "/api/trace/clear":
                    with eng.trace_lock: eng.trace.clear()
                    return self._send(200, {"ok": True})
                if p == "/api/mb/write":
                    s = self._sess("engineer")
                    if s: self._send(200, eng.mb_write(b, s["name"]))
                    return
                if p == "/api/sim":
                    s = self._sess("engineer")
                    if s: self._send(200, eng.sim_action(b, s["name"]))
                    return
                return self._err(404, "없음")
            except mb.ModbusError as e:
                return self._send(200, {"ok": False, "why": f"통신 오류: {e}"})
            except (KeyError, ValueError, TypeError) as e:
                return self._err(400, f"요청 오류: {e}")
            except Exception as e:
                traceback.print_exc(); return self._err(500, f"{type(e).__name__}: {e}")

    return H


def _jdefault(o):
    try:
        import numpy as np
        if isinstance(o, np.generic): return o.item()
        if isinstance(o, np.ndarray): return o.tolist()
    except ImportError:
        pass
    if isinstance(o, (set, tuple)): return list(o)
    return str(o)


def serve(eng, bind=None, port=None):
    bind = bind or eng.hcfg["bind"]; port = int(port or eng.hcfg["port"])
    httpd = ThreadingHTTPServer((bind, port), make_handler(eng)); httpd.daemon_threads = True
    th = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True); th.start()
    return httpd
