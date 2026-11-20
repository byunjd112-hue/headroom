# -*- coding: utf-8 -*-
"""기록 보관소를 화면부에 잇는다: 감시 주기마다 적산 · 상황 기록 옮겨 적기 · 가상 장치 모드의 시연용 과거 자료 · 조회/보고서 요청 처리.

보관소가 열리지 않거나 쓰기에 실패해도 감시·제어는 멈추지 않는다(오류는 화면의 보관 상태에 적는다).
"""
import collections, math, os, queue, random, sqlite3, threading, time
from urllib.parse import quote
from .. import archive, archdev, archxfer
from . import archapi, report

Store = collections.namedtuple("Store", "arch dev xfer url")          # 보관소 한 벌: 검침·상황(arch), 장치별·ESS 안전(dev), 서버 전달(xfer), 주둔지 서버 주소
SEED_DAYS = 400            # 가상 장치 모드 첫 기동 때 넣는 시연용 과거 자료(년·월 단위 조회를 볼 수 있게)


def open_store(path, cfg=None, pts=None, items=None, read_only=False):
    arch = archive.Archive(path, cfg, read_only=read_only); dev = archdev.DevLog(arch, pts, items)
    return Store(arch, dev, archxfer.Transfer(arch, dev, arch.cfg["outbox"] or os.path.join(os.path.dirname(os.path.abspath(path)), "outbox")), arch.cfg["server_url"])


class ArchWatch:
    def __init__(self, eng):
        self.store = None; self.err = ""; self.t_sync = 0.0; self.dropped = 0; self.q = queue.Queue(maxsize=900); self.th = None
        cfg = archive.settings(eng.cfg.get("archive"))
        if not cfg["enabled"]: return
        try:
            st = open_store(os.path.join(eng.rt.state_dir, "archive.db"), cfg, eng.rt.pts, archdev.load_items(os.path.join(os.path.dirname(eng.cfg_path), "ess_safety.csv")))
            self.store = st; self.th = threading.Thread(target=self._work, name="archive", daemon=True); self.th.start()
            if eng.sim and st.arch.info()["rows"] == 0: threading.Thread(target=self._seed, args=(st, eng.rt.site), name="arch-seed", daemon=True).start()     # 몇 초 걸리므로 기동을 붙잡지 않게 따로 돌린다
        except (sqlite3.Error, OSError) as e:
            self.err = f"{type(e).__name__}: {e}"

    def _seed(self, st, site):
        """가상 장치 모드 첫 기동: 시연용 과거 자료를 넣는다(실패해도 운전에는 영향 없음)."""
        try:
            rows = demo_rows(site, st.arch.cfg["interval_min"]); st.arch.seed(rows); st.dev.seed(rows); demo_inspects(st.arch)
        except (sqlite3.Error, ValueError) as e:
            self.err = f"시연 자료 넣기 실패: {type(e).__name__}: {e}"

    def step(self, eng, k):
        """감시 주기에서 불린다. 값만 줄에 넣고 바로 돌아간다 — 보관소 쓰기가 늦어도 감시·제어 주기를 붙잡지 않는다."""
        if self.store is None: return
        try: self.q.put_nowait((time.time(), time.monotonic(), archive.instant(k, eng.rt.val), dict(eng.rt.val), eng))
        except queue.Full: self.dropped += 1; self.err = f"보관소 쓰기가 밀려 {self.dropped}건을 건너뜀"

    def _work(self):
        st = self.store
        while True:
            item = self.q.get()
            if item is None: return
            now, mono, inst, val, eng = item
            st.arch.tick(inst, now, mono); st.dev.tick(val, now)
            if mono - self.t_sync >= 2.0: self.t_sync = mono; st.arch.sync(eng.rt.events, eng.alarms.hist)

    def flush(self, timeout=5.0):
        """줄에 남은 값을 다 적을 때까지 기다린다(보고서·시험용)."""
        t0 = time.monotonic()
        while self.store is not None and not self.q.empty() and time.monotonic() - t0 < timeout: time.sleep(0.02)

    def close(self):
        st = self.store
        if st is None: return
        self.q.put(None); self.th.join(timeout=5.0); self.store = None; st.dev.close(); st.arch.close()


def demo_rows(site, interval_min, days=SEED_DAYS, now=None):
    """시연용 과거 자료(합성). 부하는 하루 두 봉우리, 태양광은 낮 종 모양 × 날씨, 모자라는 만큼 ESS → 연료전지 → 디젤 순으로 채운다."""
    rnd = random.Random(20260101)                     # nosec B311 — 시연용 합성 자료(보안과 무관)
    step = 60 * interval_min; end = int((time.time() if now is None else now) // step) * step; t = end - days * 86400; rows = []; soc = 60.0; sky = 0.7
    pv_cap = site.pv_kwp * site.pv_pr; base = 1.25 * site.base_load_kw; ess_kw = site.ess_kw; ess_kwh = site.ess_kwh
    while t < end:
        lt = time.localtime(t); hr = lt.tm_hour + lt.tm_min / 60.0
        if hr < step / 3600.0: sky = min(1.0, max(0.15, rnd.gauss(0.7, 0.25)))
        season = 0.75 + 0.25 * math.cos((lt.tm_yday - 172) / 365.0 * 2 * math.pi)
        load = base * (0.62 + 0.25 * math.exp(-((hr - 10) / 3.0) ** 2) + 0.38 * math.exp(-((hr - 19.5) / 2.4) ** 2)) * (1.12 - 0.12 * season) * rnd.uniform(0.94, 1.06)
        pv = max(0.0, pv_cap * season * sky * math.sin(math.pi * (hr - 6.2) / 12.6)) if 6.2 < hr < 18.8 else 0.0
        net = load - pv; ess = max(-ess_kw, min(ess_kw, net)); room = (soc - 100 * site.soc_min) if ess > 0 else (soc - 100 * site.soc_max)
        ess = max(min(ess, room / 100.0 * ess_kwh * 3600.0 / step), 0.0) if ess > 0 else min(max(ess, room / 100.0 * ess_kwh * 3600.0 / step), 0.0)
        soc -= ess * step / 3600.0 / ess_kwh * 100.0; rest = net - ess; fc = min(max(rest, 0.0), site.fc_kw); dg = max(rest - fc, 0.0)
        rows.append((t, {"load": load, "pv": pv if rest >= 0 else pv + rest, "dg": dg, "fc": fc, "ess_chg": max(-ess, 0.0), "ess_dis": max(ess, 0.0), "soc": round(soc, 1),
                         "va": round(rnd.gauss(380.0, 1.6), 1), "vb": round(rnd.gauss(380.0, 1.6), 1), "hz": round(rnd.gauss(60.0, 0.03), 2), "temp": round(12 + 13 * math.cos((lt.tm_yday - 205) / 365 * 2 * math.pi) + 4 * math.sin(math.pi * (hr - 9) / 12), 1)}))
        t += step
    return rows


def demo_inspects(arch):
    now = time.time()
    for days, item, value, unit in ((330, "절연저항(모선 A)", "520", "MΩ"), (330, "접지저항", "3.8", "Ω"), (150, "절연저항(모선 A)", "495", "MΩ"), (150, "누설전류", "0.4", "mA"), (20, "접지저항", "4.1", "Ω")):
        arch.add_inspect(item, value, unit, "시연용 예시 값(실제 점검 결과가 아님)", "시연", now - days * 86400)


def http_get(hd, eng, st, p, q):
    """조회·보고서 GET. hd: 요청 처리기(_send·_err·_sess 사용). eng 가 없으면(별도 뷰어) 현재 현황 없이 기록만으로 보고서를 만든다."""
    if st is None: return hd._err(503, "기록 보관소를 쓰지 않거나 열지 못했습니다(runtime.json 의 archive)")     # pylint: disable=protected-access
    if p in ("/api/report.docx", "/api/archive/bundle"):
        if eng is not None and hd._sess("operator") is None: return None           # pylint: disable=protected-access — 보고서는 시나리오 검증까지 도는 무거운 작업, 묶음은 전체 기록
        if p.endswith("bundle"):
            d = st.xfer.get(q["id"])
            if not d["exists"]: return hd._err(404, "묶음 파일이 없습니다")          # pylint: disable=protected-access
            with open(os.path.join(st.xfer.outbox, d["file"]), "rb") as f: return hd._send(200, f.read(), "application/zip", {"Content-Disposition": "attachment; filename=" + d["file"]})     # pylint: disable=protected-access
        name, body = report.build(eng, st, q)
        return hd._send(200, body, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", {"Content-Disposition": "attachment; filename*=UTF-8''" + quote(name)})     # pylint: disable=protected-access
    r = archapi.get(st, p, q)
    if r is None: return hd._err(404, "없음")                                       # pylint: disable=protected-access
    return hd._send(200, r[0], r[1] or "application/json; charset=utf-8", r[2])     # pylint: disable=protected-access


def http_post(st, p, b, who, site=""):
    """점검 기록 넣기 · 전달 묶음 만들기 · 서버로 보내기 · 전달 완료 적기."""
    if st is None: raise ValueError("기록 보관소를 쓰지 않습니다")
    if p == "/api/archive/inspect":
        ts = time.mktime(time.strptime(b["at"], "%Y-%m-%d %H:%M")) if b.get("at") else None
        if ts is not None and ts > time.time() + 86400: raise ValueError("점검 일시가 앞날입니다")
        st.arch.add_inspect(b.get("item"), b.get("value"), b.get("unit"), b.get("note"), who, ts); return {"ok": True}
    if p == "/api/archive/xfer/make":
        if b.get("from") and b.get("to"): t0 = time.mktime(time.strptime(b["from"], "%Y-%m-%d")); t1 = min(time.mktime(time.strptime(b["to"], "%Y-%m-%d")) + 86400, time.time())
        else: t0, t1 = st.xfer.next_span()
        return {"ok": True, "row": st.xfer.make(t0, t1, who, site)}
    if p == "/api/archive/xfer/send": r = st.xfer.send(b["id"], st.url, who); return {"ok": r["status"] == archxfer.STATUS[1], "row": r, "why": r["note"]}
    if p == "/api/archive/xfer/mark": return {"ok": True, "row": st.xfer.mark(b["id"], who, b.get("note", ""))}
    raise KeyError(p)
