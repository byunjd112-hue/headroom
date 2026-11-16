# -*- coding: utf-8 -*-
"""EMS 실행기. 1초 주기로 장치를 읽어 품질을 확인하고, 제어 주기마다 전원 투입을 정해 지령한다.

한 주기(scan)의 순서
  1) 수집      전 장치·경로를 동시에 읽는다(값은 경로 A 우선, 실패하면 B)
  2) 통신 감시  경로별 응답 시각을 기록하고 두절·경로 저하·복구를 판정한다
  3) 품질 확인  범위 밖 값, 갱신되지 않는 값을 표식하고 직전 유효값을 쓴다
  4) 제어      제어 주기가 되면 전원 투입을 정하고(계획 또는 규칙) 예비력 규칙을 더해 지령한다
  5) 기록      15분 평균을 학습용 자료로 쌓고, 지령과 통신 사건을 감사 기록에 남긴다
보호 차단과 우회 복구는 보호 IED가 수행한다. 이 실행기는 차단기 상태를 읽어 감시·기록하고 전원 지령만 낸다.
"""
import csv, json, math, os, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from ifps_ems import supervisor as sv, dispatch as dp, security
from ifps_ems.config import Site, SUP
from . import pointmap as pm, modbus as mb
from .hal import DeviceLink, RtCommander
from . import opsmode as om
from ifps_ems.solar import clear_pv_kw

HIST_COLS = ["ts", "load_kw", "load_p1", "load_p2", "load_p3", "pv_kw", "temp", "press", "rh", "plan", "mode"]


class Runtime:
    def __init__(self, cfg_path, clock=time.monotonic, wall=datetime.now, key=None):
        with open(cfg_path, encoding="utf-8") as f: self.cfg = json.load(f)
        base = os.path.dirname(os.path.abspath(cfg_path))
        self.pts = pm.load(os.path.join(base, self.cfg["pointmap"]), self.cfg["devices"])
        bad = pm.validate(self.pts, self.cfg["devices"])
        if bad: raise ValueError("대응표 오류: " + "; ".join(bad))
        self.clock, self.wall = clock, wall; self._nlock = threading.Lock()
        self.hr_off = 0.0                                             # 시연용 모의 시각 보정(시간). 가상 장치 모드에서만 바꾼다
        self.site = Site(**{k: v for k, v in self.cfg.get("site", {}).items() if k in Site.keys()})
        self.links = {n: DeviceLink(n, [tuple(p) for p in d["paths"]], d["unit"], self.pts, self.cfg["allow"], self.cfg.get("timeout_s", 0.5), int(d.get("gap", 0))) for n, d in self.cfg["devices"].items()}
        self.pool = ThreadPoolExecutor(max_workers=max(2, sum(len(lk.cl) for lk in self.links.values())), thread_name_prefix="scan")
        self.ctl = [n for n in self.links if f"{n}.cmd" in self.links[n].by_tag]
        self.dev = {n: sv.Device(n) for n in self.ctl}
        self.gdgs = [n for n in self.ctl if n.startswith("GDG")]          # 주둔지 기존 디젤발전기(여러 대면 GDG, GDG2 …)
        fb = {"DG": ["FC"], "FC": ["DG"]}; fb.update({n: ["DG", "FC"] for n in self.gdgs})      # 주둔지 발전기 기동 실패 → 이동형 디젤·연료전지
        self.cmd = RtCommander({n: self.links[n] for n in self.ctl}, self.dev, fallback=fb, clock=clock)
        self.cmd.gate = self.controllable; self.cmd.tick = lambda: self.wd.kick("제어", self.now())
        self.cmd.done_s = {n: float(d["done_s"]) for n, d in self.cfg["devices"].items() if "done_s" in d}
        self.lm = sv.LinkMonitor(list(self.links)); self.wd = sv.Watchdog(["수집", "제어"])
        self.val = {}; self.flag = {}; self.t_upd = {}; self.hb_seen = {}; self.hb_stop = {}; self.t0 = clock(); self.events = []; self.ev_n = 0; self.audit_err = ""; self.n_scan = 0; self.n_over = 0; self.max_scan_s = 0.0
        self.state_dir = os.path.join(base, self.cfg.get("state_dir", "state")); os.makedirs(self.state_dir, exist_ok=True)
        self.key_note = ""
        if key is None: key, self.key_note = security.load_or_create_key(self.state_dir)
        self.audit = security.AuditLog(os.path.join(self.state_dir, "audit.log"), security.CryptoProvider(key))
        self.policy = None                       # 운전계획 연결 지점: policy(값 사전, 시각) → (디젤, 연료전지, 수전해) 기동 여부. 없으면 규칙 운전
        self.t_ctl = -1e9; self.acc = []; self.slot = None; self.mode = self.cfg.get("mode", "island"); self.plan = int(self.cfg.get("plan", 1))
        # 군 운용: 운용 장소(작전지 island / 주둔지 grid), 운용 태세(평시·저소음·자립), 자동 부하 차단, 주둔지 설정
        self.gar = om.Garrison.from_cfg(self.cfg.get("garrison")); self.posture = "평시"; self.auto_enabled = True; self.shedder = om.LoadShedder()
        self.auto_h = None; self.auto_target_h = float(self.cfg.get("autonomy_target_h", 72.0)); self.t_posture = self.now(); self.pv_day_kwh = None
        self.grid_lost = False; self.t_grid_ok = None; self.t_outage = None; self.gdg_last = None; self.gar_last = None; self._gdg_t0 = None; self._w = {}; self._pvday = (None, 0.0)
        self._load_ops()
        ok, why = security.crypto_gate(self.audit.c, self.cfg.get("run_mode", "개발"))
        if not ok: raise RuntimeError(why)

    def now(self): return self.clock() - self.t0

    def note(self, kind, text, actor="ems"):
        """사건을 남긴다. 감사 기록 파일에 쓰지 못해도(디스크 가득·권한) 예외를 내지 않는다 — 감시·제어 주기가 멈추면 안 된다."""
        with self._nlock:
            self.ev_n += 1
            self.events.append({"id": self.ev_n, "t": round(self.now(), 2), "wall": self.wall().strftime("%Y-%m-%d %H:%M:%S"), "kind": kind, "text": text, "actor": actor})
            if len(self.events) > 5000: del self.events[:1000]
            try: self.audit.append(actor, kind, {"text": text}); self.audit_err = ""
            except OSError as e: self.audit_err = f"{type(e).__name__}: {e}"

    # ── 1)~3) 수집·통신 감시·품질 확인
    def _read_parallel(self):
        """모든 장치·경로를 동시에 읽는다. 응답 없는 장치가 있어도 한 주기는 시간 초과 1회 안에 끝난다."""
        futs = {(n, k): self.pool.submit(lk.read_blocks, cl) for n, lk in self.links.items() for k, cl in lk.cl.items()}
        out = {}
        for n, lk in self.links.items():
            vals = None
            for k in lk.cl:                                         # 값은 경로 A를 우선, 실패하면 B
                try:
                    v = futs[(n, k)].result(); lk.alive[k] = True
                    if vals is None: vals = v
                except Exception as e:                              # 한 장치의 어떤 오류도 다른 장치 수집을 막지 않는다
                    lk.alive[k] = False; lk.err = str(e) if isinstance(e, mb.ModbusError) else f"{type(e).__name__}: {e}"
            out[n] = vals
        return out

    def scan(self):
        t = self.now(); got = self._read_parallel()
        for n, lk in self.links.items():
            was = self.lm.state[n]; v = got[n]
            for k, a in lk.alive.items():
                if a: self.lm.heartbeat(n, t, k)
            if v is None: continue
            if was == "재조회 대기":                                 # 복구 뒤 첫 수집: 달라진 값을 반영한 뒤 제어 재개
                diff = self.lm.resync(n, v, {k: self.val.get(k) for k in v}, t); self.note("통신", f"{n} 복구, 변경 {len(diff)}건 반영")
            self._take(lk, v, t)
        for n, st in self.lm.check(t).items(): self.note("통신", f"{n} 통신 {st}")          # check 는 바뀐 것만 돌려준다
        self._check_hb(t)
        for tag, tu in self.t_upd.items():
            if t - tu > SUP["stale_s"] and self.flag.get(tag) == 0: self.flag[tag] = 3      # 갱신 지연
        self._refresh_devices()
        self.wd.kick("수집", t); self.n_scan += 1
        self._accumulate()
        return {"t": t, "bad": {k: f for k, f in self.flag.items() if f}, "link": {n: s for n, s in self.lm.state.items() if s != "정상"}}

    def _take(self, lk, v, t):
        """읽은 값을 품질 확인 뒤 반영한다. 범위 밖·NaN·무한대는 버리고 직전 유효값을 둔다(품질 5)."""
        for tag, x in v.items():
            p = lk.by_tag[tag]
            bad = not math.isfinite(x) or (p["lo"] is not None and x < p["lo"]) or (p["hi"] is not None and x > p["hi"])
            if not bad: self.val[tag] = x; self.t_upd[tag] = t
            self.flag[tag] = 5 if bad else 0

    def _check_hb(self, t):
        """생존 계수(hb) 정지: 통신은 되는데 장치 제어기가 멈춘 경우."""
        for n in self.links:
            hb = self.val.get(f"{n}.hb")
            if hb is None: continue
            last = self.hb_seen.get(n)
            if last is None or last[0] != hb: self.hb_seen[n] = (hb, t)
            stop = t - self.hb_seen[n][1] > SUP["stale_s"]
            if stop != self.hb_stop.get(n, False): self.note("통신", f"{n} 생존 계수 {'정지 — 지령 차단' if stop else '재개'}")
            self.hb_stop[n] = stop

    def _refresh_devices(self):
        for n in self.ctl:
            self.dev[n].online = self.controllable(n)
            if f"{n}.status" in self.val: self.dev[n].on = int(round(self.val[f"{n}.status"])) == 1
            if f"{n}.mode" in self.val: self.dev[n].manual = int(round(self.val[f"{n}.mode"])) == 1

    def controllable(self, n):
        """지령 가능: 통신 경로가 살아 있고 장치 생존 계수(hb)가 멈추지 않았다."""
        return self.lm.controllable(n) and not self.hb_stop.get(n, False)

    # ── 4) 제어
    # ── 군 운용 상태
    def _ops_path(self): return os.path.join(self.state_dir, "ops.json")

    def _load_ops(self):
        """지난 기동 때의 운용 장소·태세를 이어 쓴다(재기동해도 저소음 태세가 풀리지 않게)."""
        try:
            with open(self._ops_path(), encoding="utf-8") as f: o = json.load(f)
            if o.get("mode") in om.PLACES: self.mode = o["mode"]
            if o.get("posture") in om.POSTURES: self.posture = o["posture"]
        except (OSError, ValueError):
            pass

    def set_ops(self, mode=None, posture=None, who="ems"):
        if mode is not None:
            if mode not in om.PLACES: raise ValueError(f"운용 장소 오류: {mode}")
            if mode == "grid" and "GRID.kw" not in self.val and not any(p["tag"] == "GRID.kw" for p in self.pts): raise ValueError("주둔지 운전에는 수전점 계측(GRID.kw, CB.GRID)이 필요합니다")
            if mode != self.mode: self.mode = mode; self.grid_lost = False; self.t_grid_ok = None; self.note("운용", f"운용 장소 변경 → {'주둔지(상전 연계)' if mode == 'grid' else '작전지(자립 운전)'}", actor=who)
        if posture is not None:
            if posture not in om.POSTURES: raise ValueError(f"운용 태세 오류: {posture}")
            if posture != self.posture: self.posture = posture; self.t_posture = self.now(); self.note("운용", f"운용 태세 변경 → {posture}", actor=who)
        tmp = self._ops_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f: json.dump({"mode": self.mode, "posture": self.posture}, f, ensure_ascii=False)
        os.replace(tmp, self._ops_path())

    def tied(self):
        """상전에 연계되어 있는가(주둔지이고 수전 차단기 투입, 복전 뒤 안정 시간 경과)."""
        return self.mode == "grid" and not self.grid_lost and int(round(self.val.get("CB.GRID", 0))) == 1

    def _grid_watch(self, t):
        """주둔지: 수전 차단기 상태로 정전·복전을 판정한다. 정전이면 곧바로 자립 운전 논리로 넘어간다."""
        if self.mode != "grid": return
        closed = int(round(self.val.get("CB.GRID", 0))) == 1
        if not closed:
            self.t_grid_ok = None
            if not self.grid_lost: self.grid_lost = True; self.t_outage = t; self.note("운용", "상전 정전(수전 차단기 개방) — 자립 운전으로 전환"); self._write("ESS", "ESS.kw_set", 0.0, 0.5); self._write("PV", "PV.lim_set", 0.0, 0.5)
        elif self.grid_lost:
            if self.t_grid_ok is None: self.t_grid_ok = t
            if t - self.t_grid_ok >= self.gar.restore_s: self.grid_lost = False; self.note("운용", f"상전 복전 {self.gar.restore_s:.0f}초 안정 — 주둔지 운전 복귀")

    def _write(self, dev, tag, value, tol):
        """자동 설정값 쓰기. 직전에 쓴 값과 tol 이내면 다시 쓰지 않는다. 지령 가능 상태가 아니면 쓰지 않는다."""
        lk = self.links.get(dev)
        if lk is None or tag not in lk.by_tag or not self.lm.controllable(dev): return False
        if tag in self._w and abs(self._w[tag] - value) <= tol: return True
        ok = lk.write(tag, value)
        if ok: self._w[tag] = value
        return ok

    def _pv_day(self):
        """하루 태양광 발전량 추정(kWh). 예측이 있으면 그 값, 없으면 맑은 날 가능량의 60%."""
        if self.pv_day_kwh is not None: return self.pv_day_kwh
        doy = self.wall().timetuple().tm_yday
        if self._pvday[0] != doy: self._pvday = (doy, 0.6 * 0.25 * sum(float(clear_pv_kw(self.site, doy, h / 4)) for h in range(96)))
        return self._pvday[1]

    def hr(self):
        """제어 판단에 쓰는 하루 중 시각(0~24). 기록 시각(wall)은 바꾸지 않는다."""
        w = self.wall(); return (w.hour + w.minute / 60 + self.hr_off) % 24

    def _autonomy_update(self, soc):
        """자립 지속시간. 주둔지에서는 기존 디젤발전기 연료도 넣는다(저소음 태세에서는 뺀다)."""
        g = lambda k, d=0.0: self.val.get(k, d); quiet = self.posture == "저소음"; gdg_e = 0.0
        if self.mode == "grid" and not quiet:
            gdg_e = sum(g(f"{n}.fuel_pct") / 100.0 * self.gar.gdg_tank_l / self.gar.gdg_l_per_kwh for n in self.gdgs)
        self.auto_h = om.autonomy(self.site, soc, g("H2.nm3"), g("DG.fuel_l"), (g("LOAD.p1_kw"), g("LOAD.p2_kw"), g("LOAD.p3_kw")), self._pv_day(), quiet, gdg_e)

    def _shed_want(self, t, soc):
        """자립 운전 중 부하 차단 필요 여부. 공급 능력 = 지금 붙어 있는 전원의 합."""
        g = lambda k, d=0.0: self.val.get(k, d); s = self.site
        ess_ok = g("ESS.status", 1) > 0.5 and soc > s.soc_min + 0.02
        avail = (s.ess_kw if ess_ok else 0.0) + float(self.cfg.get("g1_kw", 100.0)) * (g("CB.G1", 1) == 1) + s.dg_kw * (g("DG.status") > 0.5) + s.fc_kw * (g("FC.status") > 0.5) + max(0.0, g("PV.kw"))
        avail += sum(self.gar.gdg_kw for n in self.gdgs if g(f"{n}.status") > 0.5 and g(f"CB.{n}", 1) == 1)
        target = max(0.0, self.auto_target_h - (t - self.t_posture) / 3600.0) if self.posture == "자립" else self.auto_target_h
        return om.LoadShedder.want(s, self.posture, soc, avail, g("LOAD.p1_kw") + g("LOAD.p2_kw"), g("LOAD.kw"), self.auto_h, target)

    def fast_control(self):
        """매 수집 주기(1초)에 도는 빠른 제어: 주둔지 ESS·PV 설정값(역송 방지·피크 억제), 부하 자동 차단·복구, 자립 지속시간.
        반환: 한 일 목록. 자동 제어가 꺼져 있으면 계산만 하고 쓰지 않는다."""
        t = self.now(); g = lambda k, d=0.0: self.val.get(k, d); s = self.site; done = []; hr = self.hr()
        self._grid_watch(t); tied = self.tied(); soc = g("ESS.soc", 60.0) / 100
        self._autonomy_update(soc)
        if tied:
            r = om.garrison_step(s, self.gar, hr, g("LOAD.kw"), g("PV.kw"), g("ELZ.kw"), soc, g("H2.nm3")); self.gar_last = r
            if self.auto_enabled:
                if self._write("ESS", "ESS.kw_set", r["ess"], 1.0): done.append(("ESS.kw_set", r["ess"]))
                self._write("PV", "PV.lim_set", r["pv_lim"], 1.0)
        else:
            self.gar_last = None
            if self.mode != "grid": self._w.pop("ESS.kw_set", None)
        self._gdg_control(t, tied, soc)
        # 부하 자동 차단·복구(상전 연계 중에는 공급 능력으로 끊지 않는다)
        cb = {f: (int(round(self.val[f"CB.{f}"])) if f"CB.{f}" in self.val else None) for f in ("L2", "L3")}
        want = {"L3": "", "L2": ""} if tied else self._shed_want(t, soc)
        mtr = self.links.get("MTR")
        if self.auto_enabled and mtr is not None and "LDS.L3" in mtr.by_tag and self.lm.controllable("MTR"):
            for f, act, why in self.shedder.step(t, want, cb, soc, s.soc_min):
                ok = self.links["MTR"].write(f"LDS.{f}", 2 if act == "shed" else 1); nm = "2등급" if f == "L2" else "3등급"
                self.note("지령", f"부하 자동 {'차단' if act == 'shed' else '복구'}: {nm}({f}) — {why}{'' if ok else ' (쓰기 실패)'}"); done.append((f, act))
        return done

    def _gdg_ready(self):
        """지령할 수 있는 주둔지 발전기(통신 정상, 원격 모드)."""
        return [n for n in self.gdgs if self.controllable(n) and not self.dev[n].manual]

    def _gdg_control(self, t, tied, soc):
        """주둔지 정전 중 기존 디젤발전기 판단과 ESS 지령. 기동·정지 지령 자체는 제어 주기(decide)에서 낸다."""
        g = lambda k, d=0.0: self.val.get(k, d)
        if self.mode != "grid" or tied or not self.gdgs: self.gdg_last = None; self._gdg_t0 = None; return
        running = [n for n in self.gdgs if g(f"{n}.status") > 0.5]
        self._gdg_t0 = (t if self._gdg_t0 is None else self._gdg_t0) if running else None
        hold = bool(running) and t - self._gdg_t0 < self.gar.gdg_min_run_s
        net = g("LOAD.kw") + g("ELZ.kw") - g("PV.kw") - g("DG.kw") - g("FC.kw")
        r = om.gdg_step(self.site, self.gar, t - (self.t_outage if self.t_outage is not None else t), soc, bool(running), net, hold)
        if not self._gdg_ready() and not running: r = dict(r, run=False, why="주둔지 발전기 지령 불가(통신 두절·현장 수동) → 이동형 전원으로 운전")
        prev = self.gdg_last; self.gdg_last = r
        if prev is None or prev["run"] != r["run"]: self.t_ctl = -1e9          # 판단이 바뀌면 다음 주기를 기다리지 않고 곧바로 지령
        if self.auto_enabled: self._write("ESS", "ESS.kw_set", r["ess"] if running else 0.0, 2.0)

    def decide(self):
        g = lambda k, d=0.0: self.val.get(k, d); hr = self.hr()
        if self.tied():                                               # 주둔지 상전 연계: 디젤·연료전지는 쉬고 상전과 ESS 로 운전(수전해는 남는 전력이 있을 때만)
            r = self.gar_last or {}; w = {"DG": False, "FC": False, "_policy": (0, 0, int(bool(r.get("elz")))), "_garrison": True}
            if self.gdgs: w["GDG"] = False                            # 주둔지 발전기는 대기
            return w
        if self.policy: a = self.policy(dict(self.val), hr)
        else: a = dp.rule_action(self.site, g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), int(g("FC.status")), g("LOAD.kw"), g("PV.kw"), hr)
        if self.posture == "저소음" and a[0]:                         # 저소음 태세: 디젤 금지. 연료전지로 대신하고(수소가 있으면) 3등급 부하는 자동 차단
            h2_ok = g("H2.nm3") > self.site.h2_nm3 * self.site.h2_min * 1.2
            a = (0, 1 if h2_ok else int(a[1]), 0)
        want = {"DG": bool(a[0]), "FC": bool(a[1]), "_policy": tuple(int(x) for x in a)}
        if self.posture == "저소음": want["_quiet"] = True
        gdg_on = self._decide_gdg(want)
        if self.mode in ("island", "grid"):                           # 자립 운전(작전지, 또는 주둔지 정전 중) N-1 순동 예비력
            online = [self.site.ess_kw] * int(g("ESS.status", 1)) + [self.cfg.get("g1_kw", 100.0)] + [self.site.dg_kw] * int(want["DG"]) + [self.site.fc_kw] * int(want["FC"]) + [self.gar.gdg_kw] * int(gdg_on)
            if not gdg_on and dp.reserve_need(g("LOAD.p1_kw") + g("LOAD.p2_kw"), online): want["FC"] = True; want["_reserve"] = True
        return want

    def _decide_gdg(self, want):
        """주둔지 정전: 기존 디젤발전기를 먼저 쓰고 이동형 디젤·연료전지는 쉰다. 반환: 발전기를 실제로 쓸 수 있는가."""
        if self.mode != "grid" or not self.gdgs: return False
        r = self.gdg_last or {}; want["GDG"] = bool(r.get("run")) and self.posture != "저소음"
        on = want["GDG"] and bool(self._gdg_ready() or any(self.val.get(f"{n}.status", 0.0) > 0.5 for n in self.gdgs))
        if on: want["DG"] = False; want["FC"] = False; want["_policy"] = (0, 0, 0); want["_gdg"] = True
        return on

    def control(self, force=False):
        t = self.now()
        if not force and t - self.t_ctl < self.cfg.get("ctrl_s", 60.0):
            self.wd.kick("제어", t); return []                       # 제어 주기 전이어도 제어 과정은 살아 있다
        self.t_ctl = t; want = self.decide(); done = []
        for n in ("DG", "FC") + tuple(self.gdgs):
            if n not in self.dev or (n in self.gdgs and "GDG" not in want): continue
            d = self.dev[n]; w_n = want["GDG"] if n in self.gdgs else want[n]
            if w_n != d.on:
                n0 = len(self.cmd.log); ok, dt = self.cmd.send(n, "start" if w_n else "stop")
                for e in self.cmd.log[n0:]: self.note("지령", e["text"])
                done.append((n, w_n, ok, round(dt, 2)))
        if len(self.cmd.log) > 2000: del self.cmd.log[:1000]
        self.wd.kick("제어", self.now())
        return done

    # ── 5) 기록
    def _accumulate(self):
        g = lambda k: self.val.get(k, float("nan")); w = self.wall(); slot = w.replace(minute=w.minute // 15 * 15, second=0, microsecond=0)
        if self.slot is not None and slot != self.slot and self.acc:
            m = [sum(c) / len(c) for c in zip(*self.acc)]; pth = os.path.join(self.state_dir, "history.csv"); new = not os.path.exists(pth)
            with open(pth, "a", newline="", encoding="utf-8") as f:
                wr = csv.writer(f)
                if new: wr.writerow(HIST_COLS)
                wr.writerow([self.slot.strftime("%Y-%m-%d %H:%M")] + [f"{x:.2f}" for x in m] + [self.plan, {"grid": 0, "direct": 1, "island": 2}.get(self.mode, 2)])
            self.acc = []
        self.slot = slot
        row = [g("LOAD.kw"), g("LOAD.p1_kw"), g("LOAD.p2_kw"), g("LOAD.p3_kw"), g("PV.kw"), g("ENV.temp"), g("ENV.press"), g("ENV.rh")]
        if all(x == x for x in row): self.acc.append(row)

    def save(self):
        tmp = os.path.join(self.state_dir, "last.json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"t": self.now(), "val": self.val, "link": self.lm.state, "on": {n: d.on for n, d in self.dev.items()}}, f, ensure_ascii=False)
        os.replace(tmp, os.path.join(self.state_dir, "last.json"))          # 쓰는 도중 전원이 끊겨도 앞 파일이 남는다

    # ── 주기 실행
    def run(self, n=None, sleep=time.sleep):
        period = self.cfg.get("scan_s", 1.0); k = 0; nxt = self.clock()
        while n is None or k < n:
            a = self.clock(); self.scan(); self.fast_control(); self.control(); k += 1
            dt = self.clock() - a; self.max_scan_s = max(self.max_scan_s, dt)
            if dt > period: self.n_over += 1; self.note("주기", f"주기 초과 {dt:.2f}초")
            stuck = self.wd.check(self.now())
            if stuck: self.note("감시", "프로세스 정지 감지: " + ", ".join(stuck))
            if k % 10 == 0: self.save()
            nxt += period; sleep(max(0.0, nxt - self.clock()))
        self.save()

    def close(self):
        self.pool.shutdown(wait=True, cancel_futures=True)
        for lk in self.links.values(): lk.close()


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog="ifps_ems_rt"); ap.add_argument("config"); ap.add_argument("--scans", type=int, default=None); ap.add_argument("--check", action="store_true", help="대응표와 접속만 확인")
    a = ap.parse_args(argv); rt = Runtime(a.config)
    if a.check:
        r = rt.scan(); dead = {n: lk.err or "무응답" for n, lk in rt.links.items() if not any(lk.alive.values())}      # 두절 판정(2초)을 기다리지 않고 1회 수집 결과로 본다
        half = {n: "경로 " + ",".join(k for k, ok in lk.alive.items() if not ok) + " 무응답" for n, lk in rt.links.items() if n not in dead and not all(lk.alive.values())}
        print("장치", len(rt.links), "대 | 읽은 점", len(rt.val), "| 통신 이상", dead or "없음", "| 경로 저하", half or "없음", "| 품질 이상", r["bad"] or "없음"); rt.close(); return 1 if dead else 0
    try: rt.run(a.scans)
    finally: rt.close()
    return 0
