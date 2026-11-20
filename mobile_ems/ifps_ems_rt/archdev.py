# -*- coding: utf-8 -*-
"""장치별 자료와 ESS 안전 운영정보 보관(archive.db 안의 표 dev · ess · cols).

  dev   장치(대응표의 이름 앞머리: DG · FC · ESS · PV · GDG · ELZ · H2 · BUS …)마다 저장 주기에 한 줄. 신호별 평균·최소·최대.
  ess   ESS 안전 운영정보. 1분마다 한 줄(그 순간의 값). 항목은 config/ess_safety.csv 가 정한다.
  cols  위 두 표의 열 구성(신호·항목 목록). 대응표나 항목 파일이 바뀌면 새 구성이 생기고, 옛 줄은 옛 구성으로 읽는다.
값은 32비트 실수 묶음(BLOB)으로 넣어 용량을 줄인다. 신호 80개 · 15분 주기면 한 해 약 60 MB, ESS 30항목 · 1분 주기면 한 해 약 70 MB 다.

ESS 안전 운영정보: 전기안전공사 ESS 통합관리시스템은 운영 환경·배터리·PCS 운영정보를 1분마다 받는다(보도 기준 75개 항목).
군 시설은 인터넷으로 보낼 수 없으므로 같은 주기로 여기에 쌓아 두고 주둔지 서버로 묶어 넘긴다(archxfer.py).
공사의 정식 항목 명세는 확보하지 못했다. 항목 파일은 공개된 분류에 맞춘 초안이며, 연계 명세서를 받으면 그 열 순서대로 고친다.
대응표에 신호가 없는 항목(tag 가 빈 칸)은 공사 전송 규칙과 같이 0 으로 적고 '미수집'으로 표시한다.
"""
import csv, json, os, sqlite3, struct, time
from datetime import datetime

SCHEMA = """
CREATE TABLE IF NOT EXISTS cols (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT NOT NULL, spec TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dev (ts INTEGER NOT NULL, cid INTEGER NOT NULL, n INTEGER, data BLOB, PRIMARY KEY (ts, cid)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ess (ts INTEGER PRIMARY KEY, cid INTEGER NOT NULL, data BLOB);
"""
TABLES = ("dev", "ess")
NAMES = {"DG": "디젤발전기", "FC": "연료전지", "ESS": "ESS", "PV": "태양광", "GDG": "주둔지 발전기", "ELZ": "수전해", "H2": "수소 저장", "BUS": "모선", "LOAD": "부하", "GRID": "수전(상전)", "ENV": "기상·환경",
         "CB": "차단기", "FLT": "고장 신호", "LDS": "부하 차단"}
UNITS = {"hour": "%Y-%m-%d %H:00", "day": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y", "raw": "%Y-%m-%d %H:%M"}
ESS_STEP = 60                      # ESS 안전 운영정보 저장 주기(초) — 통합관리시스템의 전송 주기와 같다
NAN = float("nan")


def load_items(path):
    """ESS 안전 운영정보 항목 파일. 없으면 빈 목록(기록하지 않음)."""
    if not os.path.isfile(path): return []
    with open(path, encoding="utf-8-sig") as f:
        return [{k: (r.get(k) or "").strip() for k in ("key", "group", "label", "unit", "tag")} for r in csv.DictReader(f) if (r.get("key") or "").strip() and not r["key"].startswith("#")]


def groups(pts):
    """대응표의 읽기 신호를 이름 앞머리로 묶는다: {장치: [{tag, unit}]}"""
    out = {}
    for p in pts:
        if p["rw"] == "r": out.setdefault(p["tag"].split(".")[0], []).append({"tag": p["tag"], "unit": p["unit"]})
    return out


class DevLog:
    """Archive 하나에 붙어 장치별 자료와 ESS 안전 운영정보를 쓰고 읽는다."""
    def __init__(self, arch, pts=None, items=None):
        self.a = arch; self.items = items or []; self.groups = groups(pts or []); self.cid = {}; self.acc = None; self.slot = None; self.ess_slot = None; self.ess_cid = None
        if arch.ro: return
        arch.tables += [t for t in TABLES if t not in arch.tables]
        with arch.lock:
            arch.db.executescript(SCHEMA)
            for dev, sig in self.groups.items(): self.cid[dev] = self._cols("dev", dev, sig)
            if self.items: self.ess_cid = self._cols("ess", "ESS", self.items)
            arch.db.commit()

    def _cols(self, kind, name, spec):
        txt = json.dumps(spec, ensure_ascii=False, sort_keys=True); r = self.a.db.execute("SELECT id, spec FROM cols WHERE kind=? AND name=? ORDER BY id DESC LIMIT 1", (kind, name)).fetchone()
        if r is not None and r[1] == txt: return r[0]
        return self.a.db.execute("INSERT INTO cols (kind, name, spec) VALUES (?,?,?)", (kind, name, txt)).lastrowid

    # ── 쓰기
    def tick(self, val, now=None):
        a = self.a
        if a.ro or not a.cfg["enabled"]: return
        now = time.time() if now is None else now
        try:
            with a.lock:
                slot = a._slot(now)                                             # pylint: disable=protected-access — 같은 꾸러미의 짝 모듈
                if self.slot is not None and slot != self.slot: self._flush()
                if self.slot != slot: self.slot = slot; self.acc = {}
                for sig in self.groups.values():
                    for s in sig:
                        v = val.get(s["tag"])
                        if v is None: continue
                        c = self.acc.get(s["tag"])
                        if c is None: self.acc[s["tag"]] = [v, v, v, 1]
                        else: c[0] += v; c[1] = min(c[1], v); c[2] = max(c[2], v); c[3] += 1
                es = int(now // ESS_STEP) * ESS_STEP
                if self.ess_cid is not None and es != self.ess_slot:
                    self.ess_slot = es; data = struct.pack(f"<{len(self.items)}f", *[float(val.get(i["tag"]) or 0.0) if i["tag"] else 0.0 for i in self.items])
                    a.db.execute("INSERT OR REPLACE INTO ess (ts, cid, data) VALUES (?,?,?)", (es, self.ess_cid, data)); a.db.commit()
        except (sqlite3.Error, struct.error, TypeError, ValueError) as e:
            a.err = f"{type(e).__name__}: {e}"

    def _flush(self):
        for dev, sig in self.groups.items():
            out = []; n = 0
            for s in sig:
                c = self.acc.get(s["tag"])
                if c is None: out += [NAN, NAN, NAN]
                else: out += [c[0] / c[3], c[1], c[2]]; n = max(n, c[3])
            if n: self.a.db.execute("INSERT OR REPLACE INTO dev (ts, cid, n, data) VALUES (?,?,?,?)", (self.slot, self.cid[dev], n, struct.pack(f"<{len(out)}f", *out)))
        self.a.db.commit()

    def close(self):
        try:
            with self.a.lock:
                if not self.a.ro and self.acc: self._flush()
        except sqlite3.Error as e: self.a.err = str(e)

    def seed(self, rows, ess_days=3):
        """시연용 과거 자료. rows 는 Archive.seed 와 같은 [(ts, {…})]. 장치별 자료는 전 기간, ESS 1분 자료는 최근 며칠만 넣는다."""
        pick = {"DG.kw": "dg", "FC.kw": "fc", "PV.kw": "pv", "ESS.soc": "soc", "LOAD.kw": "load", "BUS.a_v": "va", "BUS.b_v": "vb", "BUS.hz": "hz", "ENV.temp": "temp"}; out = []; ess = []
        last = rows[-1][0] if rows else 0
        for ts, v in rows:
            val = {t: v.get(k) for t, k in pick.items()}; val["ESS.kw"] = (v.get("ess_dis") or 0.0) - (v.get("ess_chg") or 0.0); val["ESS.status"] = 1.0; val["ENV.rh"] = 45.0
            for dev, sig in self.groups.items():
                d = [x for s in sig for x in ([val[s["tag"]]] * 3 if val.get(s["tag"]) is not None else [NAN] * 3)]
                if any(x == x for x in d): out.append((self.a._slot(ts), self.cid[dev], 1, struct.pack(f"<{len(d)}f", *d)))          # pylint: disable=protected-access
            if self.ess_cid is not None and ts > last - ess_days * 86400:
                data = struct.pack(f"<{len(self.items)}f", *[float(val.get(i["tag"]) or 0.0) if i["tag"] else 0.0 for i in self.items]); step = 60 * self.a.cfg["interval_min"]
                ess += [(m, self.ess_cid, data) for m in range(int(ts), int(ts) + step, ESS_STEP)]
        with self.a.lock:
            self.a.db.executemany("INSERT OR IGNORE INTO dev (ts, cid, n, data) VALUES (?,?,?,?)", out); self.a.db.executemany("INSERT OR IGNORE INTO ess (ts, cid, data) VALUES (?,?,?)", ess)
            self.a._set_meta("demo_until", last); self.a.db.commit()                                                                  # pylint: disable=protected-access

    # ── 읽기
    def _has(self, table):
        return self.a.db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None

    def _spec(self, kind):
        return {r[0]: (r[1], json.loads(r[2])) for r in self.a.db.execute("SELECT id, name, spec FROM cols WHERE kind=?", (kind,))} if self._has("cols") else {}

    def devices(self):
        """기록이 있는 장치 목록: [{dev, name, signals, rows, first, last}]"""
        with self.a.lock:
            spec = self._spec("dev"); out = {}
            if not spec: return []
            for cid, n, a, b in self.a.db.execute("SELECT cid, COUNT(*), MIN(ts), MAX(ts) FROM dev GROUP BY cid"):
                dev, sig = spec[cid]; o = out.setdefault(dev, {"dev": dev, "name": NAMES.get(dev, dev), "signals": sig, "rows": 0, "first": a, "last": b})
                o["rows"] += n; o["first"] = min(o["first"], a); o["last"] = max(o["last"], b); o["signals"] = sig
        f = lambda t: datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M")
        return [dict(o, first=f(o["first"]), last=f(o["last"])) for o in sorted(out.values(), key=lambda o: list(NAMES).index(o["dev"]) if o["dev"] in NAMES else 99)]

    def dev_series(self, dev, unit, t0, t1):
        """장치 한 대의 신호별 평균·최소·최대를 단위로 묶는다. 반환: {signals: [{tag, unit}], rows: [{k, n, v: {tag: [평균, 최소, 최대]}}]}"""
        if unit not in UNITS: raise ValueError("단위는 raw·hour·day·month·year 중 하나")
        with self.a.lock:
            spec = {c: s for c, (d, s) in self._spec("dev").items() if d == dev}
            if not spec: return {"signals": [], "rows": []}
            q = ",".join("?" * len(spec)); raw = self.a.db.execute(f"SELECT ts, cid, n, data FROM dev WHERE cid IN ({q}) AND ts >= ? AND ts < ? ORDER BY ts", list(spec) + [t0, t1]).fetchall()      # nosec B608 — 물음표만 이어 붙인다
        sig = spec[max(spec)]; acc = {}; fmt = UNITS[unit]
        for ts, cid, n, data in raw:
            vals = struct.unpack(f"<{len(data) // 4}f", data); g = acc.setdefault(time.strftime(fmt, time.localtime(ts)), {"n": 0, "v": {}}); g["n"] += 1
            for i, s in enumerate(spec[cid]):
                av, lo, hi = vals[3 * i:3 * i + 3]
                if av != av: continue
                c = g["v"].get(s["tag"])
                if c is None: g["v"][s["tag"]] = [av * n, lo, hi, n]
                else: c[0] += av * n; c[1] = min(c[1], lo); c[2] = max(c[2], hi); c[3] += n
        rows = [{"k": k, "n": g["n"], "v": {t: [round(c[0] / c[3], 3), round(c[1], 3), round(c[2], 3)] for t, c in g["v"].items()}} for k, g in sorted(acc.items())]
        return {"signals": sig, "rows": rows[-3000:]}

    def ess_series(self, unit, t0, t1):
        """ESS 안전 운영정보. raw 는 1분 줄 그대로(최대 하루치 1,440줄), 그 밖에는 단위로 묶어 평균·최소·최대와 기록률."""
        if unit not in UNITS: raise ValueError("단위는 raw·hour·day·month·year 중 하나")
        with self.a.lock:
            spec = self._spec("ess")
            if not spec: return {"items": [], "rows": [], "expected": 0, "recorded": 0, "rate": None}
            raw = self.a.db.execute("SELECT ts, cid, data FROM ess WHERE ts >= ? AND ts < ? ORDER BY ts LIMIT ?", (t0, t1, 1440 if unit == "raw" else 3000000)).fetchall()
            span = self.a.db.execute("SELECT MIN(ts), MAX(ts) FROM ess").fetchone()
        items = spec[max(spec)][1]; keys = [i["key"] for i in items]; acc = {}; fmt = UNITS[unit]
        for ts, cid, data in raw:
            vals = dict(zip((i["key"] for i in spec[cid][1]), struct.unpack(f"<{len(data) // 4}f", data))); k = time.strftime(fmt, time.localtime(ts)); g = acc.get(k)
            if g is None: acc[k] = {"n": 1, "v": {x: [vals.get(x, 0.0)] * 3 for x in keys}}; continue
            g["n"] += 1
            for x in keys:
                v = vals.get(x, 0.0); c = g["v"][x]; c[0] += v; c[1] = min(c[1], v); c[2] = max(c[2], v)
        rows = [{"k": k, "n": g["n"], "v": {x: [round(c[0] / g["n"], 3), round(c[1], 3), round(c[2], 3)] for x, c in g["v"].items()}} for k, g in sorted(acc.items())]
        lo = max(t0, span[0] or t0); hi = min(t1, (span[1] or t0) + ESS_STEP); exp = max(0, int((hi - lo) // ESS_STEP)) if span[0] is not None else 0; rec = sum(r["n"] for r in rows)
        return {"items": items, "rows": rows, "expected": exp, "recorded": rec, "rate": round(100.0 * rec / exp, 2) if exp and unit != "raw" else None}

    def info(self):
        with self.a.lock:
            if not self._has("ess"): return {"dev_rows": 0, "ess_rows": 0, "ess_items": 0, "ess_mapped": 0, "ess_first": None, "ess_last": None}
            d = self.a.db.execute("SELECT COUNT(*) FROM dev").fetchone()[0]; e = self.a.db.execute("SELECT COUNT(*), MIN(ts), MAX(ts) FROM ess").fetchone(); spec = self._spec("ess")
        items = spec[max(spec)][1] if spec else self.items; f = lambda t: None if t is None else datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M")
        return {"dev_rows": d, "ess_rows": e[0], "ess_first": f(e[1]), "ess_last": f(e[2]), "ess_items": len(items), "ess_mapped": sum(1 for i in items if i["tag"]), "ess_step_s": ESS_STEP}
