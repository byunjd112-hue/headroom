# -*- coding: utf-8 -*-
"""HMI 실행 엔진. 실행기(Runtime)를 스레드로 돌리고 제어화면·디버그 도구가 쓸 상태를 모은다.

스레드 구성
  수집 스레드   scan_s 주기로 Runtime.scan → 경보 판정 → 추세 기록 → 상태 저장
  지령 스레드   지령 대기열을 하나씩 처리(자동 제어, 운용자 지령). 지령 응답 대기가 수집 주기를 막지 않는다
  가상 장치     --sim일 때만. 부하·PV 변화를 만들어 가상 장치에 넣는다
장치 소켓은 modbus.Client의 잠금으로 보호되므로 수집·지령·레지스터 탐색이 같은 연결을 섞어 써도 프레임이 섞이지 않는다.


모듈 구성(기능별로 나눔): 이 파일은 뼈대(기동 · 정지, 수집 · 감시 주기)만 가진다.
  eng_alarms 경보 판정 · eng_command 지령 · 자동 제어 · eng_auth 인증 · eng_view 화면 자료 · eng_forecast 예측 · 학습 · eng_tools 엔지니어 도구
  engdefs 공용 상수 · alarmmgr 경보 관리자 · simdriver 가상 장치 구동기
"""
import collections, copy, json, os, queue, tempfile, threading, time
from datetime import datetime
from ifps_ems import __version__ as CORE_VERSION
from .. import hybrid, __version__ as RT_VERSION
from .. import pointmap as pm
from ..runtime import Runtime
from ..simplant import Plant
from .cfgedit import ConfigEditor
from . import archwatch, ringwatch, autodev, weatherwatch, loadctl, busctl, initcheck
from .skywatch import SkyWatch
from .eng_forecast import ForecastMixin
from .eng_alarms import AlarmsMixin
from .eng_command import CommandMixin
from .eng_auth import AuthMixin
from .eng_view import ViewMixin
from .eng_tools import ToolsMixin
from .alarmmgr import AlarmManager
from .simdriver import SimDriver
from .engdefs import sd_notify


class Engine(ForecastMixin, AlarmsMixin, CommandMixin, AuthMixin, ViewMixin, ToolsMixin):

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
            self.plant = Plant(pts, units); self.plant.slow["GDG"] = 5.0; self.plant.set_hybrid(hybrid.settings(cfg.get("hybrid"))["code"]); self.plant.hy_kwh = hybrid.settings(cfg.get("hybrid"))["ess_kwh"]; pa, pb = self.plant.start(self.hcfg.get("sim_ports", [0, 0]))
            c2 = copy.deepcopy(cfg); c2["allow"] = ["127.0.0.0/8"]
            for n in c2["devices"]: c2["devices"][n]["paths"] = [["127.0.0.1", pa], ["127.0.0.1", pb]]
            c2["pointmap"] = os.path.join(base, cfg["pointmap"]); c2["state_dir"] = os.path.join(base, cfg.get("state_dir", "state") + "_sim")
            fd, run_path = tempfile.mkstemp(prefix="ems_sim_", suffix=".json")
            with os.fdopen(fd, "w", encoding="utf-8") as f: json.dump(c2, f, ensure_ascii=False)
            self.sim_ports = (pa, pb)
        self.rt = Runtime(run_path); self.cfg = self.rt.cfg
        if sim:
            self.rt.fleet.keep = False; self.rt.seen.clear()                # 가상 장치는 켤 때마다 처음 구성으로 시작한다(인식 목록을 이어 가지 않는다)
            self.simdrv = SimDriver(self.plant, self.rt.site)
        self.plan_note = "규칙 운전(충전율 문턱값)"
        if plan_dir:
            from ..planlink import PlanPolicy
            # 실측 이력이 8일 미만이면: 가상 장치 시연은 합성 자료로 계획하고, 실장치는 이력이 쌓일 때까지 규칙 운전한다
            self.rt.policy = PlanPolicy(self.rt.site, os.path.join(self.rt.state_dir, "history.csv"), plan_dir, days_since_deploy,
                                        demo_csv=os.path.join(plan_dir, "sample_site_data.csv") if sim else None); self.plan_note = "예측 기반 운전계획(동적계획법)"; self.rt.policy.background = True
        self.fuel_cfg = dict({"dg_tank_l": 1000.0, "warn_pct": 50.0, "warn_h": 8.0, "repeat_min": 30.0}, **(self.cfg.get("fuel") or {})); self._fuel_t = {}
        self.ai_cfg = dict({"enabled": True, "retrain_h": 24.0, "sim_retrain_h": 2.0, "first_min": 3.0}, **(self.cfg.get("ai") or {}))
        self.skyw = SkyWatch(self)                                                      # 하늘 카메라(구름량 → 태양광 예측 입력)
        self.archw = archwatch.ArchWatch(self); self.ringw = ringwatch.RingWatch(self); self.loadw = loadctl.LoadBook(self); self.busw = busctl.BusBook(self); self.initw = initcheck.InitCheck(self); self.wxw = weatherwatch.WeatherWatch(self); self.rt.policy and setattr(self.rt.policy, "pv_adjust", self.wxw.adjust)       # 기록 보관소(검침 누적값·상황 기록·점검 기록) · 환망 감시(구간분전함·분전반)
        self.ai_busy = False; self.ai_last = None; self.ai_next = time.time() + 60.0 * float(self.ai_cfg["first_min"])
        self._tag_dev = {p["tag"]: p["device"] for p in self.rt.pts}
        self.cfged = ConfigEditor(self.cfg_path, note=self.rt.note)                      # 설정 편집기(원본 설정 파일 대상, 재기동 후 적용)
        self.lock = threading.RLock(); self.alarms = AlarmManager(); self.jobs = queue.Queue(); self.busy = None
        self.auto = bool(self.cfg.get("auto", True)); self.running = False
        if sim: self.rt.shedder.mine.clear(); self.rt.shedder.why.clear()                # 가상 장치는 켤 때마다 처음 상태로 시작한다
        elif self.rt.ops_auto is not None: self.auto = bool(self.rt.ops_auto)             # 운용자가 끈 자동 제어는 재기동해도 꺼진 채로 둔다
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
        threading.Thread(target=self._ai_loop, name="ai", daemon=True).start()   # 지속 학습(별도 프로세스로 학습, 검증 통과 시 적용)
        if self.simdrv:
            self.simdrv.step(); threading.Thread(target=self.simdrv.loop, name="sim", daemon=True).start()

    def stop(self):
        self.running = False
        if self.simdrv: self.simdrv.run = False
        self.halted = True; getattr(self.rt.policy, "cancel", lambda: None)(); time.sleep(0.3)      # 뒤에서 돌던 운전계획 계산을 멈춘다(예측 계산은 running 을 보고 멈춘다)
        try: self.rt.save()
        finally:
            self.archw.close(); self.rt.close()
            if self.plant: self.plant.stop()

    # ── 수집 주기
    def _scan_loop(self):
        period = float(self.cfg.get("scan_s", 1.0)); nxt = time.monotonic(); k = 0
        while self.running:
            a = time.monotonic()
            with self.lock:
                self.rt.auto_enabled = self.auto
                for step in (self.rt.scan, self.rt.fast_control, self._post_scan):      # 한 단계가 실패해도 나머지 단계(빠른 제어 · 경보 판정)는 돈다
                    try: step()
                    except Exception as e:                                       # 어떤 실패든 수집은 이어 간다
                        self.rt.note("오류", f"수집 주기 예외({step.__name__}): {type(e).__name__}: {e}")
            dt = time.monotonic() - a; k += 1
            self.scan_ms.append(dt * 1000); self.rt.max_scan_s = max(self.rt.max_scan_s, dt)
            if dt > period and k > 1:                                            # 첫 주기는 모든 장치에 접속을 맺는 시간이 들어 있어 세지 않는다
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
                "fuel_l": 0.0, "h2_nm3": 0.0, "peak_load": 0.0, "peak_pv": 0.0, "grid": 0.0, "grid_peak": 0.0, "grid_cost": 0.0, "peak_cut": 0.0, "hours": [[0.0] * 6 for _ in range(24)]}

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
            gk = max(k.get("grid", 0.0), 0.0); hrf = datetime.now().hour + datetime.now().minute / 60          # 상전 수전량·최대 수전·요금(단가 설정 시)
            e["grid"] += gk * h; e["grid_peak"] = max(e["grid_peak"], gk); e["grid_cost"] += gk * h * self.rt.gar.price(hrf)
            if self.rt.tied() and self.rt.gar.band(hrf) == "peak": e["peak_cut"] += max(k["ess"], 0) * h           # 최대부하 시간대에 ESS 가 대신 공급한 전력량
        self._t_en = now

    def _sup_loop(self):
        """통신 감시 주기(0.5초): 수집 주기(1초)와 별도로 두절·경로 저하를 판정한다. 감지 한도 = 두절 판정 2.0초 + 0.5초."""
        per = min(2.0, max(0.1, float(self.cfg.get("sup_s", 0.5))))
        while self.running:
            time.sleep(per)
            try:
                with self.lock:
                    rt = self.rt; ch = rt.lm.check(rt.now())
                    for n, st in ch.items():
                        if not rt.fleet.empty(n): rt.note("통신", f"{n} 통신 {st}")
                        if n in rt.dev: rt.dev[n].online = rt.controllable(n)
                        autodev.link_alarm(self, n, st)
                    self.purge()
            except Exception as e:
                self.rt.note("오류", f"감시 주기 예외: {type(e).__name__}: {e}")
