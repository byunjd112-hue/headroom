# -*- coding: utf-8 -*-
"""감사 기록(연쇄 HMAC)과 암호 모듈 사용 판정.

AuditLog는 줄마다 앞 줄의 MAC을 포함해 기록하므로 중간 줄을 고치거나 지우면 verify()가 찾아낸다.
CryptoProvider는 표준 라이브러리 hmac-sha256을 쓴다. 운용 모드는 검증필 암호모듈(verified=True)이 아니면 기동을 거부한다.
"""
import hashlib, hmac, json, os, threading, time

GENESIS = "0" * 64


class CryptoProvider:
    def __init__(self, key, module="python-hmac-sha256", verified=False):
        if isinstance(key, str): key = key.encode("utf-8")
        if len(key) < 16: raise ValueError("키 길이 16바이트 미만")
        self._key = key; self.module = module; self.verified = verified

    def mac(self, data):
        if isinstance(data, str): data = data.encode("utf-8")
        return hmac.new(self._key, data, hashlib.sha256).hexdigest()

    def check(self, data, tag):
        return hmac.compare_digest(self.mac(data), tag)


def _canon(rec):
    return json.dumps({k: rec[k] for k in ("seq", "ts", "actor", "kind", "data", "prev")}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class AuditLog:
    def __init__(self, path, crypto):
        self.path = path; self.c = crypto; self.lock = threading.Lock(); self.seq = 0; self.prev = GENESIS
        if os.path.exists(path):
            last = None
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if line.strip(): last = line
            if last:
                try:
                    r = json.loads(last); self.seq = r["seq"]; self.prev = r["mac"]
                except (ValueError, KeyError):
                    pass

    def append(self, actor, kind, data):
        with self.lock:
            rec = {"seq": self.seq + 1, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "actor": actor, "kind": kind, "data": data, "prev": self.prev}
            rec["mac"] = self.c.mac(_canon(rec))
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            self.seq = rec["seq"]; self.prev = rec["mac"]
            return rec

    def tail(self, n=200):
        if not os.path.exists(self.path): return []
        with open(self.path, encoding="utf-8") as f: lines = f.readlines()[-n:]
        out = []
        for ln in lines:
            try: out.append(json.loads(ln))
            except ValueError: pass
        return out

    def verify(self):
        """반환: (정상 여부, 설명)."""
        if not os.path.exists(self.path): return True, "기록 없음"
        prev, n = GENESIS, 0
        with self.lock, open(self.path, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if not line.strip(): continue
                try: r = json.loads(line)
                except ValueError: return False, f"{i}행: 형식 오류"
                if r.get("prev") != prev: return False, f"{i}행: 연쇄 끊김(앞 줄 삭제·변경 의심)"
                if not self.c.check(_canon(r), r.get("mac", "")): return False, f"{i}행: MAC 불일치(변조 의심)"
                prev = r["mac"]; n += 1
        return True, f"{n}건 무결"


def crypto_gate(crypto, run_mode):
    """운용 모드에서 미검증 암호 모듈이면 기동을 거부한다. 반환: (허용, 사유)."""
    if run_mode == "운용" and not crypto.verified:
        return False, f"운용 모드 기동 거부: 암호 모듈 '{crypto.module}' 검증필 아님(KCMVP 검증필 모듈로 교체 필요)"
    return True, "허용"
