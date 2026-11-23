# -*- coding: utf-8 -*-
"""사용자 인증: PIN 확인 · 잠금, 로그인 세션, 운용 모드의 보안 점검.Engine(hmi/engine.py)의 한 부분이다 — 기능별로 파일을 나눈 것이며 메서드는 Engine 의 것으로 쓴다.
"""
import secrets, time
from .engdefs import pin_verify


class AuthMixin:
    """Engine 에 섞어 쓰는 묶음(자체 상태는 없다 — self 는 Engine 이다)."""

    # ── 인증
    LOCK_N, LOCK_S = 5, 300

    def _pin_ok(self, pin, role):
        h = self.hcfg.get(f"pin_{role}_hash")
        if h: return pin_verify(str(pin), h)
        return secrets.compare_digest(str(pin), str(self.hcfg.get(f"pin_{role}", "")))

    def security_check(self):
        """기동 전 보안 점검. 반환: (치명 목록, 경고 목록). 운용 모드에서 치명 항목이 있으면 기동 거부."""
        bad, warn = [], []
        op = self.cfg.get("run_mode", "개발") == "운용"
        for r in ("operator", "engineer"):
            if not self.hcfg.get(f"pin_{r}_hash"):
                (bad if op else warn).append(f"{r} PIN이 평문 설정(hmi.pin_{r}) — python -m ifps_ems_rt.hmi.pin 으로 해시 생성 후 pin_{r}_hash 사용")
            if str(self.hcfg.get(f"pin_{r}", "")) in ("1111", "2222", "0000", "1234"):
                (bad if op else warn).append(f"{r} 기본 PIN 사용 중")
        if str(self.hcfg.get("bind", "127.0.0.1")) not in ("127.0.0.1", "localhost", "::1"):
            if op and not self.hcfg.get("allow_remote"): bad.append(f"원격 접속 주소({self.hcfg['bind']})는 운용 모드에서 hmi.allow_remote=true와 TLS 종단(역방향 프록시)이 있어야 함")
            else: warn.append(f"제어화면이 {self.hcfg['bind']}에 열림 — HTTP 평문, 폐쇄망 내부 단말에서만 사용")
        if self.rt.key_note: warn.append("감사 키: " + self.rt.key_note)
        if self.sim and op: bad.append("운용 모드에서 가상 장치(--sim) 사용 불가")
        return bad, warn

    def login(self, pin, name="운용자", src="local"):
        now = time.monotonic(); f = self.fail.get(src, [0, 0])
        if f[1] > now:
            return {"ok": False, "why": f"로그인 잠금 — {int(f[1] - now)}초 후 다시 시도"}
        role = "engineer" if self._pin_ok(pin, "engineer") else "operator" if self._pin_ok(pin, "operator") else None
        if role is None:
            f[0] += 1
            if f[0] >= self.LOCK_N: f = [0, now + self.LOCK_S]; self.rt.note("보안", f"로그인 {self.LOCK_N}회 실패 — {src} {self.LOCK_S}초 잠금", actor=name); self.alarms.event(2, "EMS", f"로그인 반복 실패 — {src} 잠금")
            else: self.rt.note("보안", f"로그인 실패(PIN 불일치) {f[0]}/{self.LOCK_N}", actor=name)
            self.fail[src] = f; return {"ok": False, "why": "PIN 불일치"}
        self.fail.pop(src, None)
        tok = secrets.token_urlsafe(24); self.tokens[tok] = {"role": role, "name": name, "exp": time.monotonic() + 60 * float(self.hcfg["session_min"])}
        self.rt.note("보안", f"로그인 ({role})", actor=name); return {"ok": True, "token": tok, "role": role, "name": name}

    def logout(self, tok):
        s = self.tokens.pop(tok, None)
        if s: self.rt.note("보안", "로그아웃", actor=s["name"])
        return {"ok": True}

    def session(self, tok):
        s = self.tokens.get(tok or "")
        if s is None: return None
        if time.monotonic() > s["exp"]: self.tokens.pop(tok, None); return None
        s["exp"] = time.monotonic() + 60 * float(self.hcfg["session_min"]); return s

    def purge(self):
        """만료된 세션·선택·잠금 기록을 지운다(감시 주기에서 호출)."""
        now = time.monotonic()
        for d in (self.tokens, self.selects):
            for k in [k for k, v in list(d.items()) if now > v["exp"]]: d.pop(k, None)
        for k in [k for k, f in list(self.fail.items()) if f[1] and now > f[1] + 3600]: self.fail.pop(k, None)
