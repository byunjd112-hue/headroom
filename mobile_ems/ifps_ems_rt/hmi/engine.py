# -*- coding: utf-8 -*-
"""HMI 실행 엔진. 실행기(Runtime)를 스레드로 돌리고 제어화면·디버그 도구가 쓸 상태를 모은다.

스레드 구성
  수집 스레드   scan_s 주기로 Runtime.scan → 경보 판정 → 추세 기록 → 상태 저장
  지령 스레드   지령 대기열을 하나씩 처리(자동 제어, 운용자 지령). 지령 응답 대기가 수집 주기를 막지 않는다
  가상 장치     --sim일 때만. 부하·PV 변화를 만들어 가상 장치에 넣는다
장치 소켓은 modbus.Client의 잠금으로 보호되므로 수집·지령·레지스터 탐색이 같은 연결을 섞어 써도 프레임이 섞이지 않는다.
"""
import collections, copy, json, math, os, queue, random, secrets, tempfile, threading, time
from datetime import datetime, timezone
from ifps_ems import __version__ as CORE_VERSION
from ifps_ems.solar import clear_pv_kw
from ifps_ems.config import SUP
from .. import __version__ as RT_VERSION
from .. import modbus as mb, pointmap as pm
from ..runtime import Runtime
from ..simplant import Plant

PRIO_TXT = {1: "긴급", 2: "높음", 3: "보통", 4: "낮음"}
FEEDERS = ("PV", "DG", "FC", "ESS", "G1", "TIE", "L1", "L2", "L3")
FEEDER_TXT = {"PV": "태양광", "DG": "디젤", "FC": "연료전지", "ESS": "ESS", "G1": "복합전력", "TIE": "모선 연계", "L1": "1등급 부하", "L2": "2등급 부하", "L3": "3등급 부하"}
ANSI = {0: "", 27: "27 저전압", 32: "32 역전력", 50: "50 순시 과전류", 51: "51 한시 과전류", 59: "59 과전압", 64: "64 지락", 81: "81 주파수 이상", 87: "87 차동"}
ROLES = {"viewer": 0, "operator": 1, "engineer": 2}
FLAG_TXT = {0: "정상", 1: "급변", 2: "고착", 3: "갱신 지연", 5: "범위 밖"}


def pin_hash(pin, iters=200_000):
    """PIN 저장 형식: pbkdf2_sha256$반복$솔트hex$해시hex"""
    import hashlib
    salt = secrets.token_bytes(16); dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


def pin_verify(pin, stored):
    import hashlib
    try:
        alg, iters, salt, h = stored.split("$")
        if alg != "pbkdf2_sha256": return False
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), int(iters))
        return secrets.compare_digest(dk.hex(), h)
    except (ValueError, TypeError):
        return False


def wall_iso(ts=None):
    return datetime.fromtimestamp(time.time() if ts is None else ts).strftime("%Y-%m-%d %H:%M:%S")


def sd_notify(msg):
    """systemd 알림(Type=notify, WatchdogSec). NOTIFY_SOCKET이 없으면(Windows·수동 실행) 아무것도 하지 않는다."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr or not hasattr(__import__("socket"), "AF_UNIX"): return
    import socket
    if addr.startswith("@"): addr = "\0" + addr[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as so: so.sendto(msg.encode(), addr)
    except OSError:
        pass


# ───────────────────────────────── 경보 관리 (ISA-18.2 형식: 발생·복귀·확인)
class AlarmManager:
    def __init__(self):
        self.items = {}; self.hist = collections.deque(maxlen=2000); self.n = 0; self.lock = threading.Lock()

    def _new(self, key, prio, src, text, state):
        self.n += 1
        a = {"id": self.n, "key": key, "prio": prio, "src": src, "text": text, "state": state, "acked": False,
             "t_on": time.time(), "t_off": None if state == "ACT" else time.time(), "ack_by": None}
        self.items[key] = a; self.hist.appendleft({"t": a["t_on"], "ev": "발생", "prio": prio, "src": src, "text": text})
        return a

    def set(self, key, cond, prio, src, text):
        with self.lock:
            a = self.items.get(key)
            if cond:
                if a is None: self._new(key, prio, src, text, "ACT")
                elif a["state"] == "RTN":
                    a.update(state="ACT", acked=False, t_on=time.time(), t_off=None, text=text, prio=prio)
                    self.hist.appendleft({"t": time.time(), "ev": "재발생", "prio": prio, "src": src, "text": text})
                else: a["text"] = text
            elif a is not None and a["state"] == "ACT":
                a["state"] = "RTN"; a["t_off"] = time.time()
                self.hist.appendleft({"t": time.time(), "ev": "복귀", "prio": a["prio"], "src": a["src"], "text": a["text"]})
                if a["acked"]: del self.items[key]

    def event(self, prio, src, text):
        """한 번 생기고 끝나는 사건 경보(지령 실패 등). 확인하면 사라진다."""
        with self.lock:
            for a in self.items.values():                                # 같은 내용의 미확인 사건은 횟수만 올린다(주기마다 반복되는 차단 사유가 목록을 채우지 않게)
                if a["key"].startswith("evt.") and not a["acked"] and a["src"] == src and a.get("base", a["text"]) == text:
                    a["count"] = a.get("count", 1) + 1; a["base"] = text; a["text"] = f"{text} (×{a['count']})"; a["t_on"] = a["t_off"] = time.time(); return
            self._new(f"evt.{self.n + 1}", prio, src, text, "RTN")

    def ack(self, ids, who):
        with self.lock:
            n = 0
            for k, a in list(self.items.items()):
                if ids == "all" or a["id"] in ids:
                    if not a["acked"]:
                        a["acked"] = True; a["ack_by"] = who; n += 1
                        self.hist.appendleft({"t": time.time(), "ev": "확인", "prio": a["prio"], "src": a["src"], "text": a["text"] + f" (확인: {who})"})
                    if a["state"] == "RTN": del self.items[k]
            return n

    def snapshot(self):
        with self.lock:
            lst = sorted(self.items.values(), key=lambda a: (a["acked"], a["state"] != "ACT", a["prio"], -a["t_on"]))
            cnt = {p: {"act": 0, "unack": 0} for p in (1, 2, 3, 4)}
            for a in lst:
                if a["state"] == "ACT": cnt[a["prio"]]["act"] += 1
                if not a["acked"]: cnt[a["prio"]]["unack"] += 1
            return [dict(a) for a in lst], cnt

    def journal(self, n=300):
        with self.lock:
            return list(self.hist)[:n]


# ───────────────────────────────── 가상 장치 구동(현장 부하·PV 변화 모사)
class SimDriver:
    def __init__(self, plant, site):
        self.p = plant; self.site = site; self.hold = {}; self.cloud = 0.9; self.run = True; self.t_last = time.time()
        self.scn = ""; self.extra_load = 0.0; self.err = ""

    def step(self):
        now = datetime.now(); hr = now.hour + now.minute / 60 + now.second / 3600; doy = now.timetuple().tm_yday
        self.cloud += 0.02 * (0.85 - self.cloud) + random.gauss(0, 0.015); self.cloud = min(1.02, max(0.15, self.cloud))
        day = 1 / (1 + math.exp(-(hr - 7.5) * 2)) * 1 / (1 + math.exp((hr - 18.5) * 2))
        p1 = 28 + random.gauss(0, 0.4)
        p2 = 22 + 18 * day + random.gauss(0, 0.8)
        p3 = 9 + 16 * day * (0.6 + 0.4 * math.sin(math.pi * max(0.0, min(1.0, (hr - 7) / 12)))) + random.gauss(0, 0.8) + self.extra_load
        clear = float(clear_pv_kw(self.site, doy, hr)); pv = max(0.0, clear * self.cloud * (1 + random.gauss(0, 0.01)))
        if "PV.status" in self.p.by_tag:                                    # 인버터 분리 → 0, 출력 제한 적용
            pv = 0.0 if self.p.get("PV.status") < .5 else min(pv, self.p.get("PV.lim_set") or 400.0)
        temp = 16 + 7 * math.sin(2 * math.pi * (hr - 9) / 24) + random.gauss(0, 0.05)
        vals = {"LOAD.p1_kw": p1, "LOAD.p2_kw": p2, "LOAD.p3_kw": max(0.0, p3), "PV.kw": pv, "ENV.temp": temp,
                "ENV.press": 1012.5 + random.gauss(0, 0.05), "ENV.rh": 55 + random.gauss(0, 0.3)}
        cbo = lambda f: (self.p.get(f"CB.{f}") > 0.5 and self.p.get(f"CB.{f}") < 1.5) if f"CB.{f}" in self.p.by_tag else True
        for tag, f in (("LOAD.p1_kw", "L1"), ("LOAD.p2_kw", "L2"), ("LOAD.p3_kw", "L3"), ("PV.kw", "PV")):
            if not cbo(f): vals[tag] = 0.0; self.hold.pop(tag, None)                      # 차단기 개방·트립 → 급전 없음
        for k, v in vals.items():
            if k in self.hold: v = self.hold[k]
            if k in self.p.by_tag: self.p.set(k, v)
        tot = sum(vals[k] if not cbo(f) else self.hold.get(k, vals[k]) for k, f in (("LOAD.p1_kw", "L1"), ("LOAD.p2_kw", "L2"), ("LOAD.p3_kw", "L3")))
        self.p.set("LOAD.kw", self.hold.get("LOAD.kw", tot))
        dg_on = self.p.get("DG.status") > 0.5                                  # 디젤 연료 소비
        if dg_on and "DG.fuel_l" not in self.hold:
            self.p.set("DG.fuel_l", max(0.0, self.p.get("DG.fuel_l") - 90 * 0.28 / 3600))
        if "ELZ.h2_rate" in self.p.by_tag and "H2.nm3" not in self.hold and self.p.get("ELZ.status") > .5:
            self.p.set("H2.nm3", min(1000.0, self.p.get("H2.nm3") + self.p.get("ELZ.h2_rate") / 3600))
        fc_kw = self.p.get("FC.kw")
        if fc_kw > 0 and "H2.nm3" not in self.hold:
            self.p.set("H2.nm3", max(0.0, self.p.get("H2.nm3") - fc_kw * 0.75 / 3600))

    def loop(self):
        while self.run:
            try: self.step()
            except Exception as e:                      # 가상 장치 구동 실패는 기록만 하고 계속(시험용 기능)
                self.err = f"{type(e).__name__}: {e}"
            time.sleep(1.0)

    def trip(self, f, code):
        """급전선 고장: 보호 IED가 차단기를 트립(2)하고 보호 요소 코드를 남긴 상태를 모사."""
        self.p.set(f"CB.{f}", 2); self.p.set(f"FLT.{f}", code)

    def scenario(self, name):
        self.scn = name
        if name == "load_surge": self.extra_load = 60.0
        elif name == "cloud": self.hold["PV.kw"] = max(0.0, self.p.get("PV.kw") * 0.3)
        elif name == "night": self.hold["PV.kw"] = 0.0
        elif name == "soc_low": self.p.set("ESS.soc", 22.0)
        elif name == "soc_critical": self.p.set("ESS.soc", 17.0)
        elif name == "h2_low": self.p.set("H2.nm3", 130.0)
        elif name in ("fault_l3", "fault_dg", "fault_ess"):
            f, code = {"fault_l3": ("L3", 51), "fault_dg": ("DG", 87), "fault_ess": ("ESS", 64)}[name]; self.trip(f, code)
        elif name == "tie_open": self.p.set("CB.TIE", 0)
        elif name == "normal":
            self.hold.clear(); self.extra_load = 0.0; self.scn = ""
            for f in FEEDERS:
                if f"CB.{f}" in self.p.by_tag: self.p.set(f"CB.{f}", 1); self.p.set(f"FLT.{f}", 0)
            self.p.muted.clear(); self.p.no_ack.clear(); self.p.down.clear()
            for d in ("DG", "FC", "ELZ", "PV"):
                if f"{d}.mode" in self.p.by_tag: self.p.set(f"{d}.mode", 0)
        else: raise ValueError(f"시나리오 없음: {name}")


# ───────────────────────────────── 엔진
class Engine:
    def __init__(self, cfg_path, sim=False, plan_dir=None, days_since_deploy=30):
        self.cfg_path = os.path.abspath(cfg_path)
        with open(self.cfg_path, encoding="utf-8") as f: cfg = json.load(f)
        self.hcfg = {"bind": "127.0.0.1", "port": 8080, "pin_operator": "1111", "pin_engineer": "2222", "session_min": 30, "sbo_s": 10.0}
        self.hcfg.update(cfg.get("hmi", {}))
        base = os.path.dirname(self.cfg_path); self.sim = sim; self.plant = None; self.simdrv = None
        run_path = self.cfg_path
        if sim:
            pts = pm.load(os.path.join(base, cfg["pointmap"]), cfg["devices"])
            units = {n: d["unit"] for n, d in cfg["devices"].items()}
            self.plant = Plant(pts, units); pa, pb = self.plant.start(self.hcfg.get("sim_ports", [0, 0]))
            c2 = copy.deepcopy(cfg); c2["allow"] = ["127.0.0.0/8"]
            for n in c2["devices"]: c2["devices"][n]["paths"] = [["127.0.0.1", pa], ["127.0.0.1", pb]]
            c2["pointmap"] = os.path.join(base, cfg["pointmap"]); c2["state_dir"] = os.path.join(base, cfg.get("state_dir", "state") + "_sim")
            fd, run_path = tempfile.mkstemp(prefix="ems_sim_", suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as f: json.dump(c2, f, ensure_ascii=False)
            self.sim_ports = (pa, pb)
        self.rt = Runtime(run_path); self.cfg = self.rt.cfg
        if sim:
            self.simdrv = SimDriver(self.plant, self.rt.site)
        self.plan_note = "규칙 운전(충전율 문턱값)"
        if plan_dir:
            from ..planlink import PlanPolicy
            # 실측 이력이 8일 미만이면: 가상 장치 시연은 합성 자료로 계획하고, 실장치는 이력이 쌓일 때까지 규칙 운전한다
            self.rt.policy = PlanPolicy(self.rt.site, os.path.join(self.rt.state_dir, "history.csv"), plan_dir, days_since_deploy,
                                        demo_csv=os.path.join(plan_dir, "sample_site_data.csv") if sim else None); self.plan_note = "예측 기반 운전계획(동적계획법)"
        self._tag_dev = {p["tag"]: p["device"] for p in self.rt.pts}
        self.lock = threading.RLock(); self.alarms = AlarmManager(); self.jobs = queue.Queue(); self.busy = None
        self.auto = bool(self.cfg.get("auto", True)); self.running = False
        self.trend = collections.deque(maxlen=4 * 3600); self.scan_ms = collections.deque(maxlen=600)
        self.trace = collections.deque(maxlen=3000); self.trace_n = 0; self.trace_on = True; self.trace_lock = threading.Lock()
        self.tokens = {}; self.selects = {}; self.last_decision = None; self._ev_i = 0; self.t_start = time.time(); self.fc_set_written = None
        self.ack_info = {}; self.fail = {}                                      # 로그인 실패 {출처: [횟수, 잠금 해제 시각]}
        self.plan_dir = plan_dir; self._fc_busy = False; self.fc_cache = None; self.fc_lock = threading.Lock()
        self.energy = self._energy_zero(); self._t_en = None
        for n, lk in self.rt.links.items():
            for k, cl in lk.cl.items():
                cl.tag = (n, k); cl.trace = self._tracer(cl)
        self.rt.note("기동", f"HMI 엔진 기동 (EMS RT v{RT_VERSION}, 핵심 v{CORE_VERSION}, {'가상 장치' if sim else '실장치'} 모드)")

    # ── 프레임 추적
    def _tracer(self, cl):
        def tr(direction, data, rtt):
            if not self.trace_on: return
            with self.trace_lock:
                self.trace_n += 1
                rec = {"i": self.trace_n, "t": time.time(), "dev": cl.tag[0], "path": cl.tag[1], "dir": direction, "host": f"{cl.host}:{cl.port}", "unit": cl.unit,
                       "rtt": None if rtt is None else round(rtt * 1000, 2)}
                if isinstance(data, (bytes, bytearray)):
                    rec["hex"] = data.hex(" "); rec["n"] = len(data); rec["fc"] = data[7] if len(data) > 7 else None
                else:
                    rec["txt"] = str(data); rec["n"] = 0; rec["fc"] = None
                self.trace.append(rec)
        return tr

    # ── 기동·정지
    def start(self):
        self.running = True
        threading.Thread(target=self._scan_loop, name="scan", daemon=True).start()
        threading.Thread(target=self._exec_loop, name="exec", daemon=True).start()
        threading.Thread(target=self._sup_loop, name="sup", daemon=True).start()
        self.forecast()                                                          # 예측·정밀도 사전 계산(백그라운드)
        if self.simdrv:
            self.simdrv.step(); threading.Thread(target=self.simdrv.loop, name="sim", daemon=True).start()

    def stop(self):
        self.running = False
        if self.simdrv: self.simdrv.run = False
        time.sleep(0.3)
        try: self.rt.save()
        finally:
            self.rt.close()
            if self.plant: self.plant.stop()

    # ── 수집 주기
    def _scan_loop(self):
        period = float(self.cfg.get("scan_s", 1.0)); nxt = time.monotonic(); k = 0
        while self.running:
            a = time.monotonic()
            try:
                with self.lock:
                    self.rt.scan(); self._post_scan()
            except Exception as e:                                               # 어떤 실패든 수집은 이어 간다
                self.rt.note("오류", f"수집 주기 예외: {type(e).__name__}: {e}")
            dt = time.monotonic() - a; k += 1
            self.scan_ms.append(dt * 1000); self.rt.max_scan_s = max(self.rt.max_scan_s, dt)
            if dt > period:
                self.rt.n_over += 1; self.rt.note("주기", f"주기 초과 {dt:.2f}초")
            stuck = self.rt.wd.check(self.rt.now())
            self.alarms.set("wd", bool(stuck), 1, "EMS", "프로세스 정지 감지: " + ", ".join(stuck) if stuck else "프로세스 정지")
            if k == 1: sd_notify("READY=1")
            if not stuck: sd_notify("WATCHDOG=1")                                   # 수집·제어가 모두 살아 있을 때만 systemd 감시 신호
            if self.auto and self.busy is None and self.jobs.empty() and self.rt.now() - self.rt.t_ctl >= float(self.cfg.get("ctrl_s", 60.0)):
                self.jobs.put({"kind": "auto", "who": "EMS"})
            if k % 10 == 0:
                try: self.rt.save()
                except OSError: pass
            nxt += period; slp = nxt - time.monotonic()
            if slp < -5 * period: nxt = time.monotonic(); slp = 0
            time.sleep(max(0.0, slp))

    @staticmethod
    def _energy_zero():
        return {"day": datetime.now().strftime("%Y-%m-%d"), "pv": 0.0, "dg": 0.0, "fc": 0.0, "load": 0.0, "ess_chg": 0.0, "ess_dis": 0.0,
                "fuel_l": 0.0, "h2_nm3": 0.0, "peak_load": 0.0, "peak_pv": 0.0, "hours": [[0.0] * 6 for _ in range(24)]}

    def _integrate(self, k):
        """전력량 적산(사다리꼴 대신 1초 직사각형). 자정에 초기화. hours: 시간대별 [PV, DG, FC, ESS방전, 부하, ESS충전] kWh."""
        now = time.monotonic(); day = datetime.now().strftime("%Y-%m-%d"); e = self.energy       # 간격은 단조 시계(벽시계 조정에 영향받지 않게)
        if e["day"] != day: self.energy = e = self._energy_zero()
        if self._t_en is not None:
            h = min(max(now - self._t_en, 0.0), 5.0) / 3600.0; s = self.rt.site; hr = datetime.now().hour
            parts = [max(k["pv"], 0), max(k["dg"], 0), max(k["fc"], 0), max(k["ess"], 0), max(k["load"], 0), max(-k["ess"], 0)]
            for i, key in enumerate(("pv", "dg", "fc", "ess_dis", "load", "ess_chg")):
                e[key] += parts[i] * h; e["hours"][hr][i] += parts[i] * h
            e["fuel_l"] += parts[1] * h * s.dg_l_per_kwh; e["h2_nm3"] += parts[2] * h * s.fc_nm3_per_kwh
            e["peak_load"] = max(e["peak_load"], k["load"]); e["peak_pv"] = max(e["peak_pv"], k["pv"])
        self._t_en = now

    # ── 예측·정밀도(백테스트). 무거우므로 10분마다 백그라운드 갱신
    def forecast(self, force=False):
        with self.fc_lock:
            c = self.fc_cache
            if c is None or force or time.time() - c["_t"] > (600 if c.get("ok") else 20):       # 실패는 20초 뒤 다시 시도
                if not self._fc_busy:
                    self._fc_busy = True; threading.Thread(target=self._compute_forecast, daemon=True).start()
            return c or {"ok": False, "why": "예측 계산 중…"}

    def _compute_forecast(self):
        try:
            import numpy as np
            from ifps_ems import dataio
            from ifps_ems.forecast import LoadForecaster, PVForecaster, BUCKET, bucket_of
            site = self.rt.site; hist = os.path.join(self.rt.state_dir, "history.csv"); src = "현장 실측 이력(history.csv)"
            rows = sum(1 for _ in open(hist, encoding="utf-8")) - 1 if os.path.exists(hist) else 0
            md = self.plan_dir or os.path.join(os.path.dirname(self.cfg_path), "..", "results")
            if rows < 8 * 96:
                hist = os.path.join(md, "sample_site_data.csv"); src = "합성 현장 자료(실측 8일 미만)"
                if not os.path.exists(hist):
                    if not self.sim: raise ValueError(f"실측 이력이 {rows}줄(8일 = 768줄 필요)입니다. 이력이 쌓이면 자동으로 예측을 시작합니다")
                    self._make_demo_data(md, site)                    # 시연 모드: 합성 자료와 모델이 없으면 만들어 쓴다
            d = dataio.load_csv(hist, site); n = d["n"]
            fl, fp = LoadForecaster(site), PVForecaster(site); tl = dataio.load_model(os.path.join(md, "model_load.npz"), fl); tp = dataio.load_model(os.path.join(md, "model_pv.npz"), fp)
            o = n - 1; l50, llo, lhi, _ = fl.predict(d, o); p50, plo, phi, _ = fp.predict(d, o)
            # 백테스트: 마지막 7일, 6시간 간격 발행
            el = {b: [] for b in range(len(BUCKET))}; ep = {b: [] for b in range(len(BUCKET))}; cl = []; cp = []; mean_l = float(np.mean(d["load"][-7 * 96:]))
            day_l, day_p, pts = [], [], []
            for oo in range(n - 7 * 96 - 1, n - 97, 24):
                a, alo, ahi, _ = fl.predict(d, oo); b, blo, bhi, _ = fp.predict(d, oo)
                yl = d["load"][oo + 1:oo + 97]; yp = d["pv"][oo + 1:oo + 97]; day_m = d["clear"][oo + 1:oo + 97] > 0.05 * site.pv_kwp
                for h in range(96):
                    bb = bucket_of(h + 1); el[bb].append(abs(a[h] - yl[h]) / mean_l)
                    if day_m[h]: ep[bb].append(abs(b[h] - yp[h]) / site.pv_kwp); cp.append(blo[h] <= yp[h] <= bhi[h])
                    cl.append(alo[h] <= yl[h] <= ahi[h])
                day_l.append(abs(a.sum() - yl.sum()) / yl.sum()); day_p.append(abs(b.sum() - yp.sum()) / max(yp.sum(), 1))
                pts += [[float(a[h]), float(yl[h])] for h in range(0, 96, 8)]
            mk = lambda e: [round(float(np.mean(e[b])) * 100, 2) if e[b] else None for b in range(len(BUCKET))]
            ts = d["ts"]; dates = sorted(set(t[:10] for t in ts))[-14:]; daily = []
            for dd in dates:
                m = np.array([t.startswith(dd) for t in ts])
                daily.append({"d": dd, "load": round(float(d["load"][m].sum() * 0.25), 1), "pv": round(float(d["pv"][m].sum() * 0.25), 1),
                              "clear": round(float(d["clear"][m].sum() * 0.25), 1), "peak": round(float(d["load"][m].max()), 1)})
            r = lambda a: [round(float(x), 2) for x in a]
            out = {"ok": True, "source": src, "trained": {"load": tl, "pv": tp}, "issued": ts[-1], "hist_ts": ts[-96:], "load_act": r(d["load"][-96:]), "pv_act": r(d["pv"][-96:]),
                   "clear_hist": r(d["clear"][-96:]), "load": r(l50), "load_lo": r(llo), "load_hi": r(lhi), "pv": r(p50), "pv_lo": r(plo), "pv_hi": r(phi),
                   "acc": {"load_nmae": round(float(np.mean(sum(el.values(), []))) * 100, 2), "pv_nmae": round(float(np.mean(sum(ep.values(), []))) * 100, 2),
                           "load_cov": round(float(np.mean(cl)) * 100, 1), "pv_cov": round(float(np.mean(cp)) * 100, 1) if cp else None,
                           "load_day": round(float(np.mean(day_l)) * 100, 2), "pv_day": round(float(np.mean(day_p)) * 100, 2),
                           "buckets": list(BUCKET), "load_by_h": mk(el), "pv_by_h": mk(ep), "n_issue": len(day_l), "scatter": pts[:400], "limit": 15.0},
                   "daily": daily, "_t": time.time(), "calc_s": None}
            with self.fc_lock: self.fc_cache = out
        except Exception as e:
            with self.fc_lock: self.fc_cache = {"ok": False, "why": str(e) if isinstance(e, ValueError) else f"예측 계산 실패: {type(e).__name__}: {e}", "_t": time.time()}
        finally:
            self._fc_busy = False

    def _make_demo_data(self, md, site):
        """시연용 합성 현장 자료(120일)와 예측 모델을 만든다. 실행 파일(run_sim)을 거치지 않고 기동했거나 results 폴더가 비었을 때."""
        from ifps_ems import dataio
        from ifps_ems.forecast import LoadForecaster, PVForecaster
        os.makedirs(md, exist_ok=True); csvp = os.path.join(md, "sample_site_data.csv"); tmp = csvp + ".tmp"
        dataio.gen_sample(site, tmp); os.replace(tmp, csvp); d = dataio.load_csv(csvp, site)
        for name, cls in (("model_load.npz", LoadForecaster), ("model_pv.npz", PVForecaster)):
            if not os.path.exists(os.path.join(md, name)): dataio.save_model(os.path.join(md, name), cls(site).fit(d))
        self.rt.note("예측", f"시연용 합성 현장 자료와 예측 모델 생성: {md}")

    def _sup_loop(self):
        """통신 감시 주기(0.5초): 수집 주기(1초)와 별도로 두절·경로 저하를 판정한다. 감지 한도 = 두절 판정 2.0초 + 0.5초."""
        per = float(self.cfg.get("sup_s", 0.5))
        while self.running:
            time.sleep(per)
            try:
                with self.lock:
                    rt = self.rt; ch = rt.lm.check(rt.now())
                    for n, st in ch.items():
                        rt.note("통신", f"{n} 통신 {st}")
                        if n in rt.dev: rt.dev[n].online = rt.controllable(n)
                        self.alarms.set(f"link.{n}", st == "두절", 1, n, f"{n} 통신 두절 — 지령 차단, 직전 유효값 유지")
                    self.purge()
            except Exception as e:
                self.rt.note("오류", f"감시 주기 예외: {type(e).__name__}: {e}")

    def _post_scan(self):
        k = self.kpi(); self._integrate(k)
        self.trend.append([round(time.time() * 1000), round(k["load"], 2), round(k["pv"], 2), round(k["dg"], 2), round(k["fc"], 2), round(k["ess"], 2),
                           round(k["soc"], 2), round(k["h2"], 1), round(k["reserve_margin"], 1)])
        self._alarms_comm(); self._alarms_process(k); self._alarms_grid(); self._alarms_events()

    def _alarms_comm(self):
        """통신·품질 경보."""
        rt = self.rt; A = self.alarms
        for n, st in rt.lm.state.items():
            A.set(f"link.{n}", st == "두절", 1, n, f"{n} 통신 두절 — 지령 차단, 직전 유효값 유지")
            dead = [p for p, a in rt.links[n].alive.items() if not a]
            A.set(f"deg.{n}", st == "경로 저하", 3, n, f"{n} 통신 경로 저하 — 경로 {','.join(dead) or '?'} 무응답")
            A.set(f"hb.{n}", rt.hb_stop.get(n, False) and st != "두절", 1, n, f"{n} 생존 계수(hb) {SUP['stale_s']:.0f}초 이상 정지 — 장치 제어기 이상, 지령 차단")
        for tag, f in rt.flag.items():
            dev = tag.split(".")[0]
            A.set(f"q5.{tag}", f == 5, 3, dev, f"{tag} 측정값 범위 밖 — 직전 유효값 유지")
            src = self._tag_dev.get(tag, dev)                                 # 그 점을 읽어 오는 장치(예: PV.kw 는 계측 게이트웨이)
            lost = rt.lm.state.get(src) in ("두절", "재조회 대기")           # 장치 두절이면 '통신 두절' 경보 하나로 충분하다(점마다 올리지 않는다)
            A.set(f"q3.{tag}", f == 3 and not lost, 3, dev, f"{tag} 값 갱신 지연(>{SUP['stale_s']:.0f}초)")
        A.set("audit", bool(rt.audit_err), 2, "EMS", f"감사 기록 쓰기 실패 — 저장 공간·권한 확인 ({rt.audit_err})")

    def _alarms_process(self, k):
        """공정 경보: 충전율·수소·연료·예비력·운전 모드."""
        rt = self.rt; v = rt.val; g = lambda k, d=0.0: v.get(k, d); s = rt.site; A = self.alarms
        soc = g("ESS.soc", 60.0)
        A.set("soc.ll", soc < s.soc_min * 100 + 4, 1, "ESS", f"ESS 충전율 매우 낮음 {soc:.1f}% — 디젤 강제 기동 영역")
        A.set("soc.lo", s.soc_min * 100 + 4 <= soc < 25, 2, "ESS", f"ESS 충전율 낮음 {soc:.1f}%")
        A.set("soc.hi", soc > s.soc_max * 100 - 1, 4, "ESS", f"ESS 충전율 상한 근접 {soc:.1f}% — PV 출력 제한 가능")
        h2 = g("H2.nm3", s.h2_nm3)
        A.set("h2.lo", h2 < s.h2_nm3 * s.h2_min * 1.5, 2, "FC", f"수소 잔량 낮음 {h2:.0f}Nm³")
        if "DG.fuel_l" in v: A.set("fuel.lo", g("DG.fuel_l") < 300, 3, "DG", f"디젤 연료 낮음 {g('DG.fuel_l'):.0f}L")
        A.set("reserve", k["reserve_need"], 3, "EMS", f"N-1 순동 예비력 부족 {k['reserve_margin']:.0f}kW — 연료전지 병렬 필요")
        for n, d in rt.dev.items():
            A.set(f"man.{n}", d.manual, 4, n, f"{n} 현장 수동 모드 — EMS 지령 차단")
        A.set("auto.off", not self.auto, 4, "EMS", "자동 제어 해제 — 운용자 수동 지령 운전")

    def _alarms_grid(self):
        """차단기·모선 경보(보호 IED 게이트웨이)."""
        v = self.rt.val; A = self.alarms
        for f in FEEDERS:
            c = v.get(f"CB.{f}")
            if c is None: continue
            code = int(round(v.get(f"FLT.{f}", 0)))
            A.set(f"cb.trip.{f}", c > 1.5, 1 if f in ("L1", "DG", "ESS", "G1", "TIE") else 2, f"CB-{f}", f"CB-{f} {FEEDER_TXT[f]} 차단기 트립 — {ANSI.get(code, f'보호요소 {code}')}")
            A.set(f"cb.open.{f}", c < 0.5, 3 if f == "TIE" else 4, f"CB-{f}", f"CB-{f} {FEEDER_TXT[f]} 차단기 개방")
        if "BUS.a_v" in v:
            A.set("bus.a", v["BUS.a_v"] < 300, 1, "BUS-A", "모선 A 무전압(정전)"); A.set("bus.b", v.get("BUS.b_v", 440) < 300, 1, "BUS-B", "모선 B 무전압(정전)")

    def _alarms_events(self):
        """사건(지령 실패·차단, 주기 초과, 내부 오류)을 경보로 옮긴다."""
        rt = self.rt; A = self.alarms
        if rt.lm.state.get("FC") != "정상" or rt.hb_stop.get("FC"): self.fc_set_written = None      # 통신 복구·제어기 재기동 뒤에는 설정값을 다시 쓴다
        evs = [e for e in list(rt.events) if e["id"] > self._ev_i]             # 번호 기준: 다른 스레드가 덧붙이거나 앞부분을 잘라도 빠뜨리지 않는다
        for e in evs:
            t = e["text"]
            if e["kind"] == "지령" and ("무응답" in t or "실패" in t or "미변화" in t): A.event(2, t.split()[0], t)
            elif e["kind"] == "지령" and "차단" in t: A.event(3, t.split()[0], t)
            elif e["kind"] == "주기": A.event(4, "EMS", t)
            elif e["kind"] == "오류": A.event(2, "EMS", t)
        if evs: self._ev_i = evs[-1]["id"]

    # ── 지령 처리
    def _exec_loop(self):
        while self.running:
            try: job = self.jobs.get(timeout=0.5)
            except queue.Empty:
                self.rt.wd.kick("제어", self.rt.now()); continue
            self.busy = job
            try:
                if job["kind"] == "auto": self._auto_control(job.get("who", "EMS"))
                elif job["kind"] == "cmd": self._do_cmd(job)
            except Exception as e:
                self.rt.note("오류", f"지령 처리 예외: {type(e).__name__}: {e}")
            finally:
                self.busy = None; self.rt.wd.kick("제어", self.rt.now())

    def _send(self, dev, cmd, who):
        n0 = len(self.rt.cmd.log); ok, dt = self.rt.cmd.send(dev, cmd)
        for e in self.rt.cmd.log[n0:]:
            e["wall"] = wall_iso(); e["who"] = who; self.rt.note("지령", e["text"], actor=who)
        if len(self.rt.cmd.log) > 2000: del self.rt.cmd.log[:1000]
        return ok, dt

    def _auto_control(self, who):
        rt = self.rt; rt.t_ctl = rt.now(); t0 = time.monotonic()
        want = rt.decide(); note = getattr(rt.policy, "note", "") if rt.policy else "규칙 운전"
        want["ELZ"] = bool(want["_policy"][2]) and not want.get("DG")      # 수전해: 계획이 고르고 디젤 운전 중이 아닐 때만
        done = []
        for n in ("DG", "FC", "ELZ"):
            if n not in rt.dev: continue
            if want[n] != rt.dev[n].on:
                ok, dt = self._send(n, "start" if want[n] else "stop", who); done.append({"dev": n, "on": want[n], "ok": ok, "dt": round(dt, 2)})
        self._fc_setpoint(want, who)
        self.last_decision = {"t": wall_iso(), "want": {k: bool(v) for k, v in want.items() if not k.startswith("_")}, "reserve": bool(want.get("_reserve")),
                              "policy": note or "규칙 운전", "action": list(want["_policy"]), "done": done, "ms": round((time.monotonic() - t0) * 1000)}

    def _fc_setpoint(self, want, who):
        """연료전지 출력 설정: 예비력만으로 병렬했으면 대기(0 kW), 계획이 골랐으면 정격."""
        rt = self.rt; fcl = rt.links.get("FC"); on = bool(rt.dev.get("FC") and rt.dev["FC"].on)
        if not on: self.fc_set_written = None                                    # 정지했다가 다시 기동하면 설정값을 다시 쓴다
        if fcl is None or "FC.kw_set" not in fcl.by_tag or not on: return
        sp = 0.0 if (want.get("_reserve") and not bool(want["_policy"][1])) else rt.site.fc_kw
        if self.fc_set_written != sp and fcl.write("FC.kw_set", sp):
            self.fc_set_written = sp; rt.note("지령", f"FC 출력 설정 {sp:.0f}kW ({'순동 예비 대기' if sp == 0 else '정격 운전'})", actor=who)

    def _do_cmd(self, job):
        dev, cmd, who = job["dev"], job["cmd"], job["who"]
        if cmd == "set":
            tag, val = job["tag"], job["value"]
            ok = self.rt.controllable(dev) and self.rt.links[dev].write(tag, val)                 # 선택 뒤 실행까지 사이에 통신이 끊겼으면 보내지 않는다
            self.rt.cmd.log.append({"t": 0, "dev": dev, "cmd": f"set {tag}={val}", "ok": ok, "text": f"{tag} 설정 {val} {'완료' if ok else '실패'}", "wall": wall_iso(), "who": who})
            self.rt.note("지령", f"{tag} 설정 {val} {'완료' if ok else '실패'}", actor=who)
            if tag == "FC.kw_set" and ok: self.fc_set_written = val
            return
        self._send(dev, cmd, who)

    # ── 선택-실행(SBO) 지령: 선택 후 sbo_s초 안에 실행해야 한다
    def select(self, dev, cmd, who, tag=None, value=None):
        rt = self.rt
        if dev not in rt.links: return {"ok": False, "why": "정의되지 않은 장치"}
        if cmd == "set":
            p = rt.links[dev].by_tag.get(tag)
            if p is None or p["rw"] != "w": return {"ok": False, "why": f"쓰기 점 아님: {tag}"}
            if not (str(tag).endswith("_set") or str(tag).startswith("LDS.")): return {"ok": False, "why": f"설정 대상 아님: {tag} (기동·정지는 지령으로, 순번·지령 레지스터는 직접 쓸 수 없음)"}
            try: value = float(value)
            except (TypeError, ValueError): return {"ok": False, "why": "설정값 오류"}
            if not math.isfinite(value): return {"ok": False, "why": "설정값 오류(유한한 수가 아님)"}
            if (p["lo"] is not None and value < p["lo"]) or (p["hi"] is not None and value > p["hi"]): return {"ok": False, "why": f"설정 범위 {p['lo']}~{p['hi']} 밖"}
            if not rt.controllable(dev): return {"ok": False, "why": "통신 두절" if not rt.lm.controllable(dev) else "장치 생존 계수(hb) 정지"}
            why = ""
        else:
            if dev not in rt.dev: return {"ok": False, "why": "지령 대상 아님(감시 전용 장치)"}
            why = rt.cmd.check(dev, cmd)
        if why: return {"ok": False, "why": why}
        sid = secrets.token_hex(8); self.selects[sid] = {"dev": dev, "cmd": cmd, "who": who, "tag": tag, "value": value, "exp": time.monotonic() + float(self.hcfg["sbo_s"])}
        rt.note("선택", f"{dev} {cmd}{' ' + str(tag) + '=' + str(value) if cmd == 'set' else ''} 선택(SBO)", actor=who)
        return {"ok": True, "sid": sid, "exp_s": float(self.hcfg["sbo_s"])}

    def operate(self, sid, who):
        s = self.selects.pop(sid, None)
        if s is None: return {"ok": False, "why": "선택 없음 또는 이미 사용"}
        if time.monotonic() > s["exp"]: return {"ok": False, "why": "선택 시간 초과 — 다시 선택"}
        if s["who"] != who: return {"ok": False, "why": "선택한 운용자와 다름"}
        self.jobs.put({"kind": "cmd", **s}); return {"ok": True, "queued": self.jobs.qsize()}

    def cancel(self, sid, who):
        s = self.selects.pop(sid, None)
        if s: self.rt.note("선택", f"{s['dev']} {s['cmd']} 선택 취소", actor=who)
        return {"ok": True}

    def set_auto(self, on, who):
        self.auto = bool(on); self.rt.note("운전", f"자동 제어 {'설정' if on else '해제'}", actor=who); return {"ok": True, "auto": self.auto}

    def control_now(self, who):
        self.jobs.put({"kind": "auto", "who": who}); self.rt.note("운전", "제어 주기 즉시 실행 요청", actor=who); return {"ok": True}

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

    # ── 상태
    def kpi(self):
        rt = self.rt; v = rt.val; g = lambda k, d=0.0: v.get(k, d); s = rt.site
        on = lambda n: rt.dev[n].on if n in rt.dev else g(f"{n}.status") > 0.5
        load, pv, dg, fc, ess = g("LOAD.kw"), g("PV.kw"), g("DG.kw"), g("FC.kw"), g("ESS.kw"); elz = g("ELZ.kw")
        online = [s.ess_kw] * int(g("ESS.status", 1) > 0.5) + [float(self.cfg.get("g1_kw", 100.0))] + [s.dg_kw] * int(on("DG")) + [s.fc_kw] * int(on("FC"))
        l12 = g("LOAD.p1_kw") + g("LOAD.p2_kw"); margin = (sum(online) - max(online)) - l12 if online else -l12
        soc = g("ESS.soc", 0.0); h2 = g("H2.nm3", 0.0); fuel = g("DG.fuel_l", 0.0)
        ess_h = ((soc / 100 - s.soc_min) * s.ess_kwh / ess) if ess > 1 else None
        return {"load": load, "pv": pv, "dg": dg, "fc": fc, "ess": ess, "soc": soc, "h2": h2, "fuel": fuel, "l1": g("LOAD.p1_kw"), "l2": g("LOAD.p2_kw"), "l3": g("LOAD.p3_kw"),
                "gen": pv + dg + fc + max(ess, 0.0), "renew": (min(pv, load) / load * 100) if load > 1 else 0.0, "reserve_margin": margin, "reserve_need": margin < 0,
                "online_kw": online, "ess_h": ess_h, "h2_h": h2 / (s.fc_kw * s.fc_nm3_per_kwh) if s.fc_kw else None, "fuel_h": fuel / (s.dg_kw * s.dg_l_per_kwh) if s.dg_kw else None,
                "temp": g("ENV.temp"), "press": g("ENV.press"), "rh": g("ENV.rh"), "elz": elz, "g1_kw": float(self.cfg.get("g1_kw", 100.0))}

    def _snap_values(self, now):
        rt = self.rt
        return {p["tag"]: {"v": rt.val.get(p["tag"]), "f": rt.flag.get(p["tag"], 3 if p["tag"] not in rt.val else 0),
                           "age": round(now - rt.t_upd[p["tag"]], 1) if p["tag"] in rt.t_upd else None} for p in rt.pts if p["rw"] == "r"}

    def _snap_device(self, n, lk, now):
        rt = self.rt; d = rt.dev.get(n)
        paths = {k: {"alive": lk.alive.get(k, False), "host": f"{cl.host}:{cl.port}", "unit": cl.unit, "ok": cl.n_ok, "err": cl.n_err,
                     "rtt": None if cl.last_rtt is None else round(cl.last_rtt * 1000, 2), "last_err": cl.last_err, "age": round(now - rt.lm.last[n][k], 1)} for k, cl in lk.cl.items()}
        return {"link": rt.lm.state[n], "since": round(now - rt.lm.since[n], 1), "ctl": n in rt.dev, "paths": paths,
                "on": (d.on if d else (rt.val.get(f"{n}.status") or 0) > 0.5), "manual": d.manual if d else False, "online": rt.controllable(n), "hb_stop": rt.hb_stop.get(n, False),
                "seq_ack": rt.val.get(f"{n}.seq_ack"), "hb": rt.val.get(f"{n}.hb")}

    def snapshot(self):
        rt = self.rt; now = rt.now()
        with self.lock:
            vals = self._snap_values(now); devs = {n: self._snap_device(n, lk, now) for n, lk in rt.links.items()}; sm = list(self.scan_ms)
        alarms, cnt = self.alarms.snapshot()
        st = sorted(sm); top = max(5.0, (st[-1] if st else 1.0) * 1.1); nb = 24
        hist = [0] * nb
        for x in sm: hist[min(nb - 1, int(x / top * nb))] += 1
        return {"t": time.time(), "wall": wall_iso(), "utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "uptime": round(time.time() - self.t_start),
                "site": rt.site.name, "mode": rt.mode, "run_mode": self.cfg.get("run_mode", "개발"), "sim": self.sim, "auto": self.auto,
                "policy": (getattr(self.rt.policy, "note", "") or self.plan_note) if self.rt.policy else self.plan_note, "version": {"rt": RT_VERSION, "core": CORE_VERSION}, "values": vals, "devices": devs, "kpi": self.kpi(),
                "alarms": alarms[:200], "alarm_cnt": cnt, "cmdlog": rt.cmd.log[-60:][::-1], "events": rt.events[-150:][::-1],
                "decision": self.last_decision, "busy": (self.busy or {}).get("kind"), "queue": self.jobs.qsize(),
                "next_ctrl_s": max(0.0, round(float(self.cfg.get("ctrl_s", 60.0)) - (now - rt.t_ctl), 1)), "ctrl_s": float(self.cfg.get("ctrl_s", 60.0)),
                "stats": {"n_scan": rt.n_scan, "n_over": rt.n_over, "max_ms": round(rt.max_scan_s * 1000, 1), "last_ms": round(sm[-1], 1) if sm else None,
                          "avg_ms": round(sum(sm) / len(sm), 1) if sm else None, "p95_ms": round(st[int(len(st) * 0.95) - 1], 1) if len(st) > 20 else None,
                          "scan_s": float(self.cfg.get("scan_s", 1.0)), "wd": {k: (None if t is None else round(now - t, 1)) for k, t in rt.wd.last.items()},
                          "trace_n": self.trace_n, "audit_seq": rt.audit.seq, "hist": hist, "hist_top": round(top, 1)},
                "sim_state": self.sim_state() if self.sim else None, "energy": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.energy.items() if k != "hours"}}

    def sim_state(self):
        p = self.plant
        return {"muted": sorted(p.muted), "noack": sorted(p.no_ack), "down": sorted(p.down), "hold": dict(self.simdrv.hold), "scenario": self.simdrv.scn,
                "ports": list(self.sim_ports), "manual": [d for d in ("DG", "FC", "ELZ", "PV") if f"{d}.mode" in p.by_tag and p.get(f"{d}.mode") > 0.5]}

    def trend_since(self, since_ms=0):
        return [r for r in list(self.trend) if r[0] > since_ms]

    def trace_since(self, since=0, limit=500):
        with self.trace_lock:
            out = [r for r in self.trace if r["i"] > since]
        return out[-limit:]

    def points(self):
        rt = self.rt; now = rt.now(); out = []
        with self.lock:
            for p in rt.pts:
                t = p["tag"]
                out.append({**p, "v": rt.val.get(t), "f": rt.flag.get(t), "ftxt": FLAG_TXT.get(rt.flag.get(t), "-") if p["rw"] == "r" else "지령",
                            "age": round(now - rt.t_upd[t], 1) if t in rt.t_upd else None})
        return out

    # ── 디버그: 레지스터 탐색기
    def _client(self, q):
        if q.get("host"):
            return mb.Client(q["host"], int(q.get("port", 502)), int(q.get("unit", 1)), float(self.cfg.get("timeout_s", 0.5)), self.cfg["allow"]), True
        lk = self.rt.links[q["dev"]]; return lk.cl[q.get("path", "A")], False

    def mb_read(self, q):
        fc = int(q.get("fc", 3)); addr = int(q.get("addr", 0)); n = int(q.get("count", 10))
        cl, tmp = self._client(q)
        if tmp: cl.tag = ("직접", f"{cl.host}"); cl.trace = self._tracer(cl)
        t0 = time.monotonic()
        try:
            regs = cl.read_bits(addr, n, fc) if fc in (1, 2) else cl.read(addr, n, fc)
            rtt = round((time.monotonic() - t0) * 1000, 2)
        finally:
            if tmp: cl.close()
        tags = {}
        if not tmp:
            for p in self.rt.pts:
                if p["device"] == q["dev"] and p["fc"] == fc: tags[p["addr"]] = p["tag"]
        return {"ok": True, "fc": fc, "addr": addr, "regs": regs, "tags": {str(k): v for k, v in tags.items()}, "rtt": rtt}

    def mb_write(self, q, who):
        fc = int(q.get("fc", 6)); addr = int(q["addr"]); vals = [int(x) for x in q["values"]]
        if not vals or fc not in (5, 6, 16): raise ValueError("쓰기 값 없음 또는 기능 코드 오류(5/6/16)")
        if not 0 <= addr <= 0xFFFF or any(not 0 <= v <= 0xFFFF for v in vals): raise ValueError("주소·값은 0~65535")
        cl, tmp = self._client(q)
        if tmp: cl.tag = ("직접", f"{cl.host}"); cl.trace = self._tracer(cl)
        try:
            if fc == 5: cl.write_coil(addr, bool(vals[0]))
            elif fc == 6: cl.write(addr, vals[:1])
            else: cl.write(addr, vals, fc=16)
        finally:
            if tmp: cl.close()
        tgt = q.get("host") or f"{q['dev']}/{q.get('path', 'A')}"
        self.rt.note("엔지니어링", f"레지스터 쓰기 {tgt} fc{fc} @{addr} = {vals}", actor=who)
        return {"ok": True}

    # ── 디버그: 가상 장치 고장 주입
    SIM_HOLD = ("LOAD.p1_kw", "LOAD.p2_kw", "LOAD.p3_kw", "PV.kw", "LOAD.kw", "ENV.temp", "ENV.press", "ENV.rh", "DG.fuel_l", "H2.nm3")

    def _sim_set(self, q):
        tag = q["tag"]; val = float(q["value"]); p = self.plant
        if tag not in p.by_tag: raise ValueError(f"점 없음: {tag}")
        if q.get("hold", True) and tag in self.SIM_HOLD: self.simdrv.hold[tag] = val
        p.set(tag, val)

    def _sim_feeder(self, q):
        f = q["target"]
        if f not in FEEDERS: raise ValueError(f"급전선 없음: {f}")
        if q["action"] == "fault": self.simdrv.trip(f, int(q.get("code", 51)))
        else: self.plant.set(f"CB.{f}", 1 if q.get("on", True) else 0); self.plant.set(f"FLT.{f}", 0)

    def sim_action(self, q, who):
        if not self.sim: raise ValueError("가상 장치 모드가 아님")
        a = q["action"]; p = self.plant; tgt = q.get("target"); on = q.get("on", True)
        flags = {"mute": p.muted, "noack": p.no_ack, "down": p.down}
        if a in flags: (flags[a].add if on else flags[a].discard)(tgt)
        elif a == "manual": p.set(f"{tgt}.mode", 1 if on else 0)
        elif a == "set": self._sim_set(q)
        elif a == "release": self.simdrv.hold.pop(q["tag"], None)
        elif a == "scenario": self.simdrv.scenario(q["name"])
        elif a in ("fault", "cb"): self._sim_feeder(q)
        else: raise ValueError(f"동작 없음: {a}")
        self.rt.note("시뮬레이터", f"고장 주입 {a} {tgt or q.get('tag') or q.get('name') or ''} {q.get('on', '')}".strip(), actor=who)
        return {"ok": True, "sim": self.sim_state()}

    # ── 작전지 배치(운용자 편집): state/layout.json. 장비 대수·막사 수량·위치·연결 급전선
    LAYOUT_KINDS = {"DG", "ESS", "PV", "FC", "DIST", "EMS", "FSU", "L1", "L2", "L3", "BARRACK"}
    LAYOUT_BINDS = {"", "G1", "ESS", "PV", "FC", "DIST", "EMS", "L1", "L2", "L3"}

    def layout(self):
        pth = os.path.join(self.rt.state_dir, "layout.json")
        if os.path.exists(pth):
            try:
                with open(pth, encoding="utf-8") as f: return json.load(f)
            except (OSError, ValueError):
                pass
        return {"rev": 0, "items": None}                                       # None → 화면 기본 배치

    def save_layout(self, lay, who):
        items = lay.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 120: raise ValueError("배치 항목 수 오류(1~120)")
        clean, uids = [], set()
        for it in items:
            k, b = str(it.get("kind", "")), str(it.get("bind", ""))
            if k not in self.LAYOUT_KINDS: raise ValueError(f"장비 종류 오류: {k}")
            if b not in self.LAYOUT_BINDS: raise ValueError(f"연결 급전선 오류: {b}")
            x, y = float(it["x"]), float(it["y"])
            if not (0 <= x <= 1600 and 0 <= y <= 900): raise ValueError("배치 좌표 범위 밖")
            uid = str(it.get("uid", ""))[:24] or f"u{len(clean)}"
            if uid in uids: raise ValueError(f"중복 식별자 {uid}")
            uids.add(uid); clean.append({"uid": uid, "kind": k, "bind": b, "name": str(it.get("name", ""))[:24], "x": round(x, 1), "y": round(y, 1)})
        old = self.layout(); rev = int(old.get("rev", 0)) + 1
        out = {"rev": rev, "items": clean, "by": who, "t": wall_iso()}
        pth = os.path.join(self.rt.state_dir, "layout.json"); tmp = pth + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, indent=1)
        os.replace(tmp, pth)
        cnt = {}
        for it in clean: cnt[it["kind"]] = cnt.get(it["kind"], 0) + 1
        self.rt.note("배치", f"작전지 배치 변경 rev{rev}: " + ", ".join(f"{k}×{v}" for k, v in sorted(cnt.items())), actor=who)
        return {"ok": True, "rev": rev}

    def reset_layout(self, who):
        pth = os.path.join(self.rt.state_dir, "layout.json")
        if os.path.exists(pth): os.replace(pth, pth + ".bak")
        self.rt.note("배치", "작전지 배치 기본값 복원(이전 배치는 layout.json.bak)", actor=who); return {"ok": True}

    def photos(self):
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
        ls = lambda d: sorted(f for f in os.listdir(os.path.join(base, d)) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))) if os.path.isdir(os.path.join(base, d)) else []
        meta = {}
        mp = os.path.join(base, "sprites", "sprites.json")
        if os.path.exists(mp):
            with open(mp, encoding="utf-8") as f: meta = json.load(f)
        return {"files": ls("photos"), "sprites": ls("sprites"), "sprite_meta": meta}

    def energy_hours(self):
        return {"day": self.energy["day"], "cols": ["pv", "dg", "fc", "ess_dis", "load", "ess_chg"], "hours": [[round(x, 3) for x in r] for r in self.energy["hours"]]}

    def audit_verify(self):
        ok, msg = self.rt.audit.verify(); return {"ok": ok, "msg": msg, "seq": self.rt.audit.seq}

    def runtime_info(self):
        c = copy.deepcopy(self.cfg); c.pop("hmi", None)
        return {"config": c, "site": self.rt.site.to_dict(), "cfg_path": self.cfg_path, "state_dir": self.rt.state_dir, "sim": self.sim,
                "version": {"rt": RT_VERSION, "core": CORE_VERSION}, "crypto": {"module": self.rt.audit.c.module, "verified": self.rt.audit.c.verified},
                "sup": SUP, "policy": self.plan_note}
