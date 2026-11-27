# -*- coding: utf-8 -*-
"""주둔지 서버 전달: 보관한 기록을 구간별 묶음(zip)으로 만들고, 넘긴 이력을 남긴다.

현장 TPCS 는 인터넷에 붙지 못한다. 그래서 ESS 안전 운영정보(1분)와 검침·상황·점검·장치별 자료를 묶음 파일로 만들어
① 주둔지 서버가 같은 망에 있으면 HTTP 로 올리고(archive.server_url)  ② 아니면 보조 기억 매체로 옮긴 뒤 '전달 완료'를 사람이 적는다.
묶음마다 구간·줄 수·SHA-256 을 이력(표 xfer)에 적어, 어느 구간이 아직 넘어가지 않았는지 알 수 있다.

묶음 안: manifest.json(구간·줄 수·파일별 SHA-256) · ess_safety.csv(1분) · meter.csv(검침) · events.csv · inspect.csv · device_<장치>.csv
"""
import csv, hashlib, io, json, os, struct, time, urllib.error, urllib.request, zipfile
from datetime import datetime
from . import archive

SCHEMA = """CREATE TABLE IF NOT EXISTS xfer (id INTEGER PRIMARY KEY AUTOINCREMENT, made REAL NOT NULL, t0 REAL NOT NULL, t1 REAL NOT NULL, file TEXT, bytes INTEGER, sha256 TEXT, rows INTEGER,
 status TEXT NOT NULL, method TEXT, target TEXT, sent REAL, who TEXT, note TEXT);"""
STATUS = ("대기", "전달 완료", "전송 실패")
MAX_SPAN_DAYS = 92                # 묶음 하나에 담는 최대 기간(ESS 1분 자료가 13만 줄쯤 된다)
BOM = "﻿"
NAN = float("nan")


def _csv(head, rows):
    out = io.StringIO(); w = csv.writer(out); w.writerow(head); w.writerows(rows); return (BOM + out.getvalue()).encode("utf-8")


def _stamp(ts):
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")


def _ess_files(files, spec, ess):
    """ESS 안전 운영정보(1분)와 항목 목록. 반환: 줄 수"""
    items = spec[max(spec)][1]; keys = [i["key"] for i in items]; rows = []
    for ts, cid, data in ess:
        v = dict(zip((i["key"] for i in spec[cid][1]), struct.unpack(f"<{len(data) // 4}f", data))); rows.append([_stamp(ts)] + [round(v.get(k, 0.0), 3) for k in keys])
    files["ess_safety.csv"] = _csv(["time"] + keys, rows)
    files["ess_items.csv"] = _csv(["key", "group", "label", "unit", "tag", "collected"], [[i["key"], i["group"], i["label"], i["unit"], i["tag"], 1 if i["tag"] else 0] for i in items])
    return len(rows)


def _dev_files(files, spec, dev):
    """장치마다 한 파일(신호별 평균·최소·최대). 반환: 줄 수"""
    by = {}; n = 0
    for ts, cid, data in dev: by.setdefault(spec[cid][0], []).append((ts, cid, data))
    for name, rs in by.items():
        sig = spec[max(c for c in spec if spec[c][0] == name)][1]; tags = [s["tag"] for s in sig]; rows = []
        for ts, cid, data in rs:
            x = struct.unpack(f"<{len(data) // 4}f", data); v = {s["tag"]: x[3 * i:3 * i + 3] for i, s in enumerate(spec[cid][1])}
            rows.append([_stamp(ts)] + [("" if c != c else round(c, 3)) for t in tags for c in v.get(t, (NAN,) * 3)])
        files[f"device_{name}.csv"] = _csv(["time"] + [f"{t}.{k}" for t in tags for k in ("avg", "min", "max")], rows); n += len(rows)
    return n


class Transfer:
    def __init__(self, arch, devlog, outbox):
        self.a = arch; self.d = devlog; self.outbox = outbox
        if not arch.ro:
            with arch.lock: arch.db.executescript(SCHEMA); arch.db.commit()
            # 전달 이력(xfer)은 보관 기간 정리 대상에 넣지 않는다 — 어느 구간을 넘겼는지는 끝까지 남긴다(줄 수가 적다)

    # ── 묶음 내용
    def _files(self, t0, t1):
        a = self.a; files = {}; n = 0
        with a.lock:
            m = a.db.execute(f"SELECT {', '.join(archive.COLS)} FROM meter WHERE ts >= ? AND ts < ? ORDER BY ts", (t0, t1)).fetchall()                # nosec B608 — 열 이름은 고정 목록
            ev = a.db.execute("SELECT ts, kind, prio, src, text, actor FROM events WHERE ts >= ? AND ts < ? ORDER BY ts", (t0, t1)).fetchall()
            ins = a.db.execute("SELECT ts, item, value, unit, note, who FROM inspect WHERE ts >= ? AND ts < ? ORDER BY ts", (t0, t1)).fetchall()
            spec_e = self.d._spec("ess"); spec_d = self.d._spec("dev")                                                                                # pylint: disable=protected-access
            ess = a.db.execute("SELECT ts, cid, data FROM ess WHERE ts >= ? AND ts < ? ORDER BY ts", (t0, t1)).fetchall() if spec_e else []
            dev = a.db.execute("SELECT ts, cid, data FROM dev WHERE ts >= ? AND ts < ? ORDER BY ts", (t0, t1)).fetchall() if spec_d else []
        files["meter.csv"] = _csv(["time"] + archive.COLS[1:], [[_stamp(r[0])] + list(r[1:]) for r in m]); n += len(m)
        files["events.csv"] = _csv(["time", "kind", "prio", "src", "text", "actor"], [[_stamp(r[0])] + list(r[1:]) for r in ev]); n += len(ev)
        files["inspect.csv"] = _csv(["time", "item", "value", "unit", "note", "who"], [[_stamp(r[0])] + list(r[1:]) for r in ins]); n += len(ins)
        if spec_e: n += _ess_files(files, spec_e, ess)
        return files, n + _dev_files(files, spec_d, dev)

    def make(self, t0, t1, who, site=""):
        """구간 [t0, t1) 의 묶음을 만들어 보낼 곳(outbox)에 두고 이력에 '대기'로 적는다."""
        if self.a.ro: raise ValueError("읽기 전용 보관소에서는 묶음을 만들 수 없습니다")
        if not t1 > t0: raise ValueError("구간이 비었습니다")
        if t1 - t0 > MAX_SPAN_DAYS * 86400: raise ValueError(f"묶음 하나는 {MAX_SPAN_DAYS}일까지입니다. 구간을 나누십시오")
        files, n = self._files(t0, t1)
        if not n: raise ValueError("이 구간에는 넘길 기록이 없습니다")
        man = {"format": "ifps-ems-archive-bundle/1", "site": site, "made": _stamp(time.time()), "from": _stamp(t0), "to": _stamp(t1), "rows": n, "by": who,
               "files": {k: {"bytes": len(v), "sha256": hashlib.sha256(v).hexdigest()} for k, v in files.items()}}
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(man, ensure_ascii=False, indent=1))
            for k, v in files.items(): z.writestr(k, v)
        body = buf.getvalue(); os.makedirs(self.outbox, exist_ok=True)
        name = f"EMS_bundle_{datetime.fromtimestamp(t0):%Y%m%d%H%M}-{datetime.fromtimestamp(t1):%Y%m%d%H%M}.zip"; tmp = os.path.join(self.outbox, name + ".tmp")
        with open(tmp, "wb") as f: f.write(body)
        os.replace(tmp, os.path.join(self.outbox, name))
        with self.a.lock:
            i = self.a.db.execute("INSERT INTO xfer (made, t0, t1, file, bytes, sha256, rows, status, who) VALUES (?,?,?,?,?,?,?,?,?)", (time.time(), t0, t1, name, len(body), hashlib.sha256(body).hexdigest(), n, STATUS[0], str(who)[:24])).lastrowid
            self.a.db.commit()
        return self.get(i)

    def get(self, i):
        with self.a.lock:
            r = self.a.db.execute("SELECT * FROM xfer WHERE id=?", (int(i),)).fetchone()
        if r is None: raise ValueError("그런 전달 묶음이 없습니다")
        d = dict(r); d.update(made_t=_stamp(d["made"]), from_t=_stamp(d["t0"])[:16], to_t=_stamp(d["t1"])[:16], sent_t=_stamp(d["sent"]) if d["sent"] else "", exists=os.path.isfile(os.path.join(self.outbox, d["file"] or "")))
        return d

    def _done(self, i, status, method, target, who, note):
        with self.a.lock:
            self.a.db.execute("UPDATE xfer SET status=?, method=?, target=?, sent=?, who=?, note=? WHERE id=?", (status, method, str(target)[:200], time.time(), str(who)[:24], str(note or "")[:300], int(i))); self.a.db.commit()
        return self.get(i)

    def mark(self, i, who, note=""):
        """보조 기억 매체 등으로 옮긴 뒤 사람이 '전달 완료'로 적는다."""
        self.get(i); return self._done(i, STATUS[1], "수동", "보조 기억 매체", who, note)

    def send(self, i, url, who, timeout=20):
        """주둔지 서버에 묶음을 올린다(HTTP POST). 서버가 돌려준 SHA-256 이 같아야 '전달 완료'."""
        if not url: raise ValueError("주둔지 서버 주소가 없습니다(runtime.json 의 archive.server_url)")
        d = self.get(i); path = os.path.join(self.outbox, d["file"])
        if not d["exists"]: raise ValueError("묶음 파일이 없습니다. 다시 만드십시오")
        with open(path, "rb") as f: body = f.read()
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/zip", "X-TPCS-File": d["file"], "X-TPCS-SHA256": d["sha256"]})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r: ans = json.loads(r.read(4096).decode("utf-8") or "{}")          # nosec B310 — 주소는 설정 파일의 http(s) 주소만(settings 에서 검사)
        except (urllib.error.URLError, OSError, ValueError) as e:
            return self._done(i, STATUS[2], "서버", url, who, f"{type(e).__name__}: {e}")
        if ans.get("sha256") != d["sha256"]: return self._done(i, STATUS[2], "서버", url, who, "서버가 돌려준 SHA-256 이 다릅니다")
        return self._done(i, STATUS[1], "서버", url, who, "서버 수신 확인(SHA-256 일치)")

    def history(self, limit=200):
        with self.a.lock:
            if self.a.db.execute("SELECT 1 FROM sqlite_master WHERE name='xfer'").fetchone() is None: return {"rows": [], "covered_to": None, "covered_ts": None, "pending": 0, "data_from": None, "data_from_ts": None, "data_to": None, "wait_days": 0.0, "max_span_days": MAX_SPAN_DAYS}
            ids = [r[0] for r in self.a.db.execute("SELECT id FROM xfer ORDER BY id DESC LIMIT ?", (limit,))]
            done = self.a.db.execute("SELECT MAX(t1) FROM xfer WHERE status=?", (STATUS[1],)).fetchone()[0]; pend = self.a.db.execute("SELECT COUNT(*) FROM xfer WHERE status<>?", (STATUS[1],)).fetchone()[0]
            first, last = self.a.db.execute("SELECT MIN(ts), MAX(ts) FROM meter").fetchone()
        return {"rows": [self.get(i) for i in ids], "covered_to": _stamp(done)[:16] if done else None, "covered_ts": done, "pending": pend, "data_from": _stamp(first)[:16] if first else None, "data_from_ts": first,
                "data_to": _stamp(last)[:16] if last else None, "wait_days": round((last - (done or first)) / 86400.0, 1) if last else 0.0, "max_span_days": MAX_SPAN_DAYS}

    def next_span(self, now=None):
        """아직 넘기지 않은 다음 구간: 마지막 전달 완료 구간의 끝(없으면 기록의 처음)부터 지난 정시까지, 길면 MAX_SPAN_DAYS 로 자른다."""
        h = self.history(1); a = h.get("covered_ts") or h.get("data_from_ts")
        if a is None: raise ValueError("넘길 기록이 없습니다")
        b = int((time.time() if now is None else now) // 3600) * 3600; b = min(b, a + MAX_SPAN_DAYS * 86400)
        if b <= a: raise ValueError("새로 넘길 기록이 아직 없습니다(한 시간 단위로 묶습니다)")
        return a, b


def verify(body):
    """받는 쪽 검사: 묶음(zip)의 manifest 와 파일별 SHA-256 을 맞춰 본다. 반환: manifest"""
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        man = json.loads(z.read("manifest.json").decode("utf-8"))
        for k, m in man["files"].items():
            if hashlib.sha256(z.read(k)).hexdigest() != m["sha256"]: raise ValueError(f"{k}: SHA-256 불일치")
    return man
