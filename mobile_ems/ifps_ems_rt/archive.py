# -*- coding: utf-8 -*-
"""운영 기록 보관소(archive.db): 검침 누적값·운전 실적·상황 기록·점검 기록을 한 파일(SQLite)에 쌓고, 시간·일·월·년 단위로 찾아본다.

  meter    저장 주기(기본 15분)마다 한 줄: 구간 전력량(kWh), 구간 최대(kW), 평균 상태(충전율·전압·주파수 등), 누적 검침값(cum_*).
  events   상황 기록: 사건(운용·지령·보안…)과 경보의 발생·해제. 글자로 찾을 수 있다.
  inspect  점검 기록: 절연저항·접지저항처럼 사람이 재서 넣는 값과 점검 의견.
보관: retain_years(1~5년, 기본 4년 — 전기안전관리법 시행규칙의 점검 기록 보존 기간)보다 오래된 줄을 지운다.
용량: 파일이 max_mb 를 넘으면 가장 오래된 달부터 지우고 빈 공간을 돌려받는다. 15분 주기 5년이면 약 17만 5천 줄(수십 MB)이다.
저장 주기를 법령이 직접 정한 조항은 확인하지 못했다. 전력 검침의 관행(15분 수요 시한)을 기본으로 하고 설정(1·5·15·30·60분)으로 바꿀 수 있게 했다.
"""
import os, sqlite3, threading, time
from datetime import datetime, timedelta

DEFAULTS = {"enabled": True, "interval_min": 15, "retain_years": 4, "max_mb": 2048, "server_url": "", "outbox": ""}
INTERVALS = (1, 5, 15, 30, 60)
LEGAL_YEARS = 4                                   # 점검 기록 보존 기간(전기안전관리법 시행규칙 제36조). 이보다 짧게 잡으면 화면에서 알린다
ENERGY = ("load", "pv", "dg", "fc", "gdg", "grid_in", "grid_out", "ess_chg", "ess_dis", "elz")      # 구간 전력량(kWh)
PEAK = ("load", "grid", "pv")                                                                         # 구간 최대(kW)
STATE = ("soc", "h2", "fuel", "va", "vb", "hz", "temp")                                               # 구간 평균
CUM = ("load", "pv", "gen", "grid_in", "grid_out")                                                    # 누적 검침값(kWh) — gen = 디젤+연료전지+주둔지 발전기
COLS = ["ts", "src", "n"] + [f"{k}_kwh" for k in ENERGY] + [f"{k}_max" for k in PEAK] + list(STATE) + [f"cum_{k}" for k in CUM]
UNITS = {"raw": "%Y-%m-%d %H:%M", "hour": "%Y-%m-%d %H:00", "day": "%Y-%m-%d", "month": "%Y-%m", "year": "%Y"}
SCHEMA = f"""
CREATE TABLE IF NOT EXISTS meter (ts INTEGER PRIMARY KEY, src INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, {", ".join(c + " REAL" for c in COLS[3:])});
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, kind TEXT, prio INTEGER, src TEXT, text TEXT, actor TEXT);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS inspect (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, item TEXT, value TEXT, unit TEXT, note TEXT, who TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def settings(cfg):
    """설정을 채우고 범위를 맞춘다(틀린 값은 기본값)."""
    c = dict(DEFAULTS, **(cfg or {}))
    if c["interval_min"] not in INTERVALS: c["interval_min"] = DEFAULTS["interval_min"]
    c["retain_years"] = min(5, max(1, int(c["retain_years"]))) if isinstance(c["retain_years"], (int, float)) and not isinstance(c["retain_years"], bool) else DEFAULTS["retain_years"]
    c["max_mb"] = min(8192, max(16, float(c["max_mb"]))) if isinstance(c["max_mb"], (int, float)) and not isinstance(c["max_mb"], bool) else DEFAULTS["max_mb"]
    c["server_url"] = c["server_url"] if isinstance(c["server_url"], str) and c["server_url"].startswith(("http://", "https://")) else ""
    c["outbox"] = c["outbox"] if isinstance(c["outbox"], str) else ""
    return c


def instant(k, val):
    """화면부의 순시값(kpi)과 측정값에서 보관소가 쓰는 값만 뽑는다."""
    g = lambda t: val.get(t); grid = k.get("grid") or 0.0; ess = k.get("ess") or 0.0
    return {"load": max(k.get("load") or 0.0, 0.0), "pv": max(k.get("pv") or 0.0, 0.0), "dg": max(k.get("dg") or 0.0, 0.0), "fc": max(k.get("fc") or 0.0, 0.0), "gdg": max(k.get("gdg") or 0.0, 0.0),
            "grid_in": max(grid, 0.0), "grid_out": max(-grid, 0.0), "ess_chg": max(-ess, 0.0), "ess_dis": max(ess, 0.0), "elz": max(k.get("elz") or 0.0, 0.0), "grid": max(grid, 0.0),
            "soc": k.get("soc"), "h2": k.get("h2"), "fuel": k.get("fuel"), "va": g("BUS.a_v"), "vb": g("BUS.b_v"), "hz": g("BUS.hz"), "temp": k.get("temp")}


class Archive:
    def __init__(self, path, cfg=None, read_only=False):
        self.path = path; self.cfg = settings(cfg); self.ro = read_only; self.lock = threading.RLock(); self.err = ""
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False) if read_only else sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        if not read_only:
            self.db.executescript("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA auto_vacuum=INCREMENTAL;" + SCHEMA); self.db.commit()
        self.tables = ["meter", "events", "inspect"]; self.t_mono = None; self.slot = None; self.acc = None; self.ev_id = 0; self.al_t = time.time(); self.t_purge = 0.0
        self.cum = {k: float(self._meta("cum_" + k, 0.0)) for k in CUM}

    # ── 작은 도우미
    def _meta(self, key, default=None):
        r = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return default if r is None else r[0]

    def _set_meta(self, key, value):
        self.db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, str(value)))

    def _slot(self, now):
        step = 60 * self.cfg["interval_min"]; return int(now // step) * step

    @staticmethod
    def _zero():
        return {"n": 0, "e": dict.fromkeys(ENERGY, 0.0), "mx": dict.fromkeys(PEAK, 0.0), "st": dict.fromkeys(STATE, 0.0), "ns": dict.fromkeys(STATE, 0)}

    # ── 쓰기(운전 중 1초마다 불린다. 실패는 기록만 하고 넘어간다 — 감시·제어 주기를 멈추지 않는다)
    def tick(self, inst, now=None, mono=None):
        if self.ro or not self.cfg["enabled"]: return
        now = time.time() if now is None else now; mono = time.monotonic() if mono is None else mono
        try:
            with self.lock:
                slot = self._slot(now)
                if self.slot is not None and slot != self.slot and self.acc["n"]: self._flush()
                if self.slot != slot: self.slot = slot; self.acc = self._zero()
                h = 0.0 if self.t_mono is None else min(max(mono - self.t_mono, 0.0), 5.0) / 3600.0; self.t_mono = mono; a = self.acc; a["n"] += 1
                for k in ENERGY: a["e"][k] += (inst.get(k) or 0.0) * h
                for k in PEAK: a["mx"][k] = max(a["mx"][k], inst.get(k) or 0.0)
                for k in STATE:
                    if inst.get(k) is not None: a["st"][k] += inst[k]; a["ns"][k] += 1
                if now - self.t_purge > 6 * 3600: self.t_purge = now; self.purge(now)
        except sqlite3.Error as e:
            self.err = f"{type(e).__name__}: {e}"

    def _flush(self):
        a = self.acc; e = a["e"]
        add = {"load": e["load"], "pv": e["pv"], "gen": e["dg"] + e["fc"] + e["gdg"], "grid_in": e["grid_in"], "grid_out": e["grid_out"]}
        for k in CUM: self.cum[k] += add[k]; self._set_meta("cum_" + k, repr(self.cum[k]))
        row = [self.slot, 0, a["n"]] + [round(e[k], 4) for k in ENERGY] + [round(a["mx"][k], 2) for k in PEAK] \
            + [round(a["st"][k] / a["ns"][k], 2) if a["ns"][k] else None for k in STATE] + [round(self.cum[k], 3) for k in CUM]
        self.db.execute(f"INSERT OR REPLACE INTO meter ({', '.join(COLS)}) VALUES ({', '.join('?' * len(COLS))})", row); self.db.commit(); self.err = ""

    def close(self):
        with self.lock:
            try:
                if not self.ro and self.acc and self.acc["n"]: self._flush()
            except sqlite3.Error as e: self.err = str(e)
            self.db.close()

    def sync(self, events, alarm_hist):
        """실행기의 사건 목록과 경보 이력에서 새로 생긴 것만 옮겨 적는다."""
        if self.ro or not self.cfg["enabled"]: return
        try:
            with self.lock:
                new = [e for e in events[-200:] if e["id"] > self.ev_id]; al = sorted((a for a in list(alarm_hist)[:200] if a["t"] > self.al_t), key=lambda a: a["t"])
                if not new and not al: return
                for e in new:
                    ts = datetime.strptime(e["wall"], "%Y-%m-%d %H:%M:%S").timestamp() if e.get("wall") else time.time()
                    self.db.execute("INSERT INTO events (ts, kind, prio, src, text, actor) VALUES (?,?,?,?,?,?)", (ts, e["kind"], None, "", e["text"], e.get("actor", "")))
                for a in al:
                    self.db.execute("INSERT INTO events (ts, kind, prio, src, text, actor) VALUES (?,?,?,?,?,?)", (a["t"], "경보·" + a["ev"], a.get("prio"), a.get("src", ""), a["text"], a.get("by", "")))
                if new: self.ev_id = new[-1]["id"]
                if al: self.al_t = al[-1]["t"]
                self.db.commit()
        except (sqlite3.Error, ValueError, KeyError) as e:
            self.err = f"{type(e).__name__}: {e}"

    def add_inspect(self, item, value, unit, note, who, ts=None):
        if self.ro: raise ValueError("읽기 전용 보관소입니다")
        item = str(item or "").strip()[:60]
        if not item: raise ValueError("점검 항목 이름을 넣으십시오")
        with self.lock:
            self.db.execute("INSERT INTO inspect (ts, item, value, unit, note, who) VALUES (?,?,?,?,?,?)", (ts or time.time(), item, str(value or "")[:40], str(unit or "")[:16], str(note or "")[:300], str(who or "")[:24])); self.db.commit()

    def seed(self, rows):
        """시연용 과거 자료를 넣는다(src = 1 로 표시). rows: [(ts, {load, pv, …kW 평균})]. 이미 있는 구간은 건드리지 않는다."""
        step_h = self.cfg["interval_min"] / 60.0; cum = dict.fromkeys(CUM, 0.0); out = []
        for ts, v in rows:
            e = {k: max(v.get(k) or 0.0, 0.0) * step_h for k in ENERGY}
            for k, x in (("load", e["load"]), ("pv", e["pv"]), ("gen", e["dg"] + e["fc"] + e["gdg"]), ("grid_in", e["grid_in"]), ("grid_out", e["grid_out"])): cum[k] += x
            out.append([self._slot(ts), 1, 1] + [round(e[k], 4) for k in ENERGY] + [round(v.get(k) or 0.0, 2) for k in PEAK] + [v.get(k) for k in STATE] + [round(cum[k], 3) for k in CUM])
        with self.lock:
            self.db.executemany(f"INSERT OR IGNORE INTO meter ({', '.join(COLS)}) VALUES ({', '.join('?' * len(COLS))})", out)
            if not any(self.cum.values()):
                self.cum = cum
                for k in CUM: self._set_meta("cum_" + k, repr(cum[k]))
            self.db.commit()
        return len(out)

    # ── 보관 기간·용량 관리
    def size_mb(self):
        return sum(os.path.getsize(self.path + s) for s in ("", "-wal") if os.path.exists(self.path + s)) / 1048576.0

    def purge(self, now=None):
        """보관 기간이 지난 줄을 지우고, 파일이 한도를 넘으면 가장 오래된 달부터 지운다. 반환: 지운 줄 수"""
        now = time.time() if now is None else now; cut = (datetime.fromtimestamp(now) - timedelta(days=365.25 * self.cfg["retain_years"])).timestamp(); n = 0
        with self.lock:
            for t in self.tables: n += self.db.execute(f"DELETE FROM {t} WHERE ts < ?", (cut,)).rowcount       # nosec B608 — 표 이름은 고정 목록
            self.db.commit()
            for _ in range(80):
                if self.size_mb() <= self.cfg["max_mb"]: break
                old = self.db.execute("SELECT MIN(ts) FROM meter").fetchone()[0]
                if old is None: break
                edge = old + 30 * 86400
                for t in self.tables: n += self.db.execute(f"DELETE FROM {t} WHERE ts < ?", (edge,)).rowcount   # nosec B608 — 표 이름은 고정 목록
                self.db.commit(); self.db.execute("PRAGMA incremental_vacuum"); self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)"); self.db.commit()
            if n: self.db.execute("PRAGMA incremental_vacuum"); self.db.commit()
        return n

    # ── 읽기
    def info(self):
        with self.lock:
            m = self.db.execute("SELECT COUNT(*), MIN(ts), MAX(ts), SUM(src) FROM meter").fetchone(); ev = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]; ins = self.db.execute("SELECT COUNT(*) FROM inspect").fetchone()[0]
        f = lambda t: None if t is None else datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M"); per_year = 365.25 * 24 * 60 / self.cfg["interval_min"]
        return {"ok": True, "enabled": self.cfg["enabled"], "interval_min": self.cfg["interval_min"], "retain_years": self.cfg["retain_years"], "max_mb": self.cfg["max_mb"], "legal_years": LEGAL_YEARS,
                "size_mb": round(self.size_mb(), 2), "rows": m[0], "demo_rows": int(m[3] or 0), "first": f(m[1]), "last": f(m[2]), "events": ev, "inspects": ins, "read_only": self.ro,
                "rows_at_full": int(per_year * self.cfg["retain_years"]), "err": self.err, "cum": {k: round(v, 1) for k, v in self.cum.items()}, "intervals": list(INTERVALS), "file": os.path.basename(self.path)}

    def series(self, unit, t0, t1):
        """t0 이상 t1 미만의 검침 기록을 단위(raw·hour·day·month·year)로 묶는다. 전력량은 합, 최대는 최대, 상태는 평균, 누적 검침값은 그 묶음의 마지막 값."""
        if unit not in UNITS: raise ValueError("단위는 raw·hour·day·month·year 중 하나")
        key = f"strftime('{UNITS[unit]}', ts, 'unixepoch', 'localtime')"
        sel = [f"{key} AS k", "MIN(ts) AS ts", "COUNT(*) AS n", "SUM(src) AS demo"] + [f"ROUND(SUM({c}_kwh), 3) AS {c}_kwh" for c in ENERGY] + [f"MAX({c}_max) AS {c}_max" for c in PEAK] \
            + [f"ROUND(AVG({c}), 2) AS {c}" for c in STATE] + [f"ROUND(MIN({c}), 1) AS {c}_min" for c in ("va", "vb", "hz")] + [f"ROUND(MAX({c}), 1) AS {c}_hi" for c in ("va", "vb", "hz")] + [f"MAX(cum_{c}) AS cum_{c}" for c in CUM]
        with self.lock:
            rows = self.db.execute(f"SELECT {', '.join(sel)} FROM meter WHERE ts >= ? AND ts < ? GROUP BY k ORDER BY k LIMIT 3000", (t0, t1)).fetchall()      # nosec B608 — 열 이름·형식은 고정 목록
        return [dict(r) for r in rows]

    def events(self, t0, t1, q="", kind="", limit=500):
        sql = "SELECT id, ts, kind, prio, src, text, actor FROM events WHERE ts >= ? AND ts < ?"; arg = [t0, t1]
        if q: sql += " AND (text LIKE ? OR src LIKE ? OR actor LIKE ?)"; arg += ["%" + q + "%"] * 3
        if kind: sql += " AND kind LIKE ?"; arg.append(kind + "%")
        with self.lock:
            rows = self.db.execute(sql + " ORDER BY ts DESC LIMIT ?", arg + [max(1, min(int(limit), 5000))]).fetchall()
        return [dict(r, t=datetime.fromtimestamp(r["ts"]).strftime("%Y-%m-%d %H:%M:%S")) for r in rows]

    def inspects(self, t0, t1, limit=500):
        with self.lock:
            rows = self.db.execute("SELECT id, ts, item, value, unit, note, who FROM inspect WHERE ts >= ? AND ts < ? ORDER BY ts DESC LIMIT ?", (t0, t1, limit)).fetchall()
        return [dict(r, t=datetime.fromtimestamp(r["ts"]).strftime("%Y-%m-%d %H:%M")) for r in rows]
