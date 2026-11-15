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
    """연쇄 해시(HMAC) 감사 기록. 한 줄이 한 건이고 각 건은 앞 건의 MAC 을 품는다.

    전원 차단 대비: 쓸 때마다 디스크에 내려 쓰고(fsync), 기동 때 끝이 잘린 줄은 <파일>.torn 으로 옮긴 뒤 마지막 온전한 건에서 잇는다.
    크기 관리: max_bytes 를 넘으면 <파일>.<시각> 으로 넘기고 새 파일을 '이어쓰기' 건으로 시작한다(연쇄는 끊기지 않는다)."""
    ROTATE = "이어쓰기"

    def __init__(self, path, crypto, max_bytes=8 * 1024 * 1024):
        self.path = path; self.c = crypto; self.lock = threading.Lock(); self.seq = 0; self.prev = GENESIS; self.max_bytes = max_bytes; self.torn = 0
        if os.path.exists(path): self._recover()

    def _recover(self):
        with open(self.path, "rb") as f: raw = f.read()
        cut = raw.rfind(b"\n") + 1
        if cut < len(raw):                                             # 줄바꿈 없이 끝남 = 쓰는 도중 끊김
            with open(self.path + ".torn", "ab") as f: f.write(raw[cut:] + b"\n")
            with open(self.path, "r+b") as f: f.truncate(cut)
            raw = raw[:cut]; self.torn = 1
        for line in reversed(raw.splitlines()):
            try:
                r = json.loads(line.decode("utf-8")); self.seq = int(r["seq"]); self.prev = r["mac"]; return
            except (ValueError, KeyError, TypeError):
                continue

    def _write(self, actor, kind, data):
        rec = {"seq": self.seq + 1, "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "actor": actor, "kind": kind, "data": data, "prev": self.prev}
        rec["mac"] = self.c.mac(_canon(rec))
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n"); f.flush(); os.fsync(f.fileno())
        self.seq = rec["seq"]; self.prev = rec["mac"]
        return rec

    def append(self, actor, kind, data):
        with self.lock:
            if self.max_bytes and os.path.exists(self.path) and os.path.getsize(self.path) >= self.max_bytes:
                old = f"{self.path}.{time.strftime('%Y%m%d_%H%M%S')}_{self.seq}"; os.replace(self.path, old)
                self._write("ems", self.ROTATE, {"from": os.path.basename(old), "last_seq": self.seq})
            return self._write(actor, kind, data)

    def tail(self, n=200, span=512 * 1024):
        """마지막 n건. 파일 끝 span 바이트만 읽는다(큰 파일에서도 빠르게)."""
        if not os.path.exists(self.path): return []
        n = max(1, min(int(n), 2000))
        with open(self.path, "rb") as f:
            f.seek(0, os.SEEK_END); size = f.tell(); f.seek(max(0, size - span)); chunk = f.read()
        lines = chunk.splitlines()
        if size > span: lines = lines[1:]                               # 첫 줄은 중간부터일 수 있다
        out = []
        for ln in lines[-n:]:
            try: out.append(json.loads(ln.decode("utf-8")))
            except ValueError: pass
        return out

    def verify(self):
        """현재 파일의 연쇄를 검증한다. 반환: (정상 여부, 설명)."""
        if not os.path.exists(self.path): return True, "기록 없음"
        with self.lock:
            with open(self.path, encoding="utf-8") as f: lines = f.readlines()           # 읽기만 잠금 안에서, 검산은 밖에서
        prev, n = GENESIS, 0
        for i, line in enumerate(lines, 1):
            if not line.strip(): continue
            try: r = json.loads(line)
            except ValueError: return False, f"{i}행: 형식 오류"
            if n == 0 and r.get("kind") == self.ROTATE and r.get("prev") != GENESIS: prev = r.get("prev")     # 넘긴 파일에서 이어짐(이 건 자체의 MAC 은 아래에서 검증)
            if r.get("prev") != prev: return False, f"{i}행: 연쇄 끊김(앞 줄 삭제·변경 의심)"
            if not self.c.check(_canon(r), r.get("mac", "")): return False, f"{i}행: MAC 불일치(변조 의심)"
            prev = r["mac"]; n += 1
        return True, f"{n}건 무결" + (" (기동 시 잘린 끝줄 1건 격리: .torn)" if self.torn else "")


LEGACY_DEV_KEY = b"dev-key-change-me-in-closed-net!!"


def load_or_create_key(state_dir, env="IFPS_AUDIT_KEY"):
    """감사 기록 HMAC 키. 우선순위: 환경변수(hex) → state/audit.key → 새로 생성(32바이트, 권한 600).
    키 파일 없이 기존 audit.log만 있으면(이전 판) 연쇄 검증을 위해 이전 개발 키를 쓰고 사유를 돌려준다. 반환: (키, 비고)."""
    if os.environ.get(env):
        return bytes.fromhex(os.environ[env]), "환경변수 키"
    kp = os.path.join(state_dir, "audit.key")
    if os.path.exists(kp):
        with open(kp, "rb") as f: return f.read(), ""
    if os.path.exists(os.path.join(state_dir, "audit.log")):
        return LEGACY_DEV_KEY, "이전 판 감사 기록 유지를 위해 개발 키 사용 — audit.log 보관 후 삭제하면 새 키 생성"
    key = os.urandom(32); fd = os.open(kp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f: f.write(key)
    return key, "새 감사 키 생성"


def crypto_gate(crypto, run_mode):
    """운용 모드에서 미검증 암호 모듈이면 기동을 거부한다. 반환: (허용, 사유)."""
    if run_mode == "운용" and not crypto.verified:
        return False, f"운용 모드 기동 거부: 암호 모듈 '{crypto.module}' 검증필 아님(KCMVP 검증필 모듈로 교체 필요)"
    return True, "허용"
