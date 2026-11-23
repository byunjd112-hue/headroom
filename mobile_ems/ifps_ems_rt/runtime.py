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
from . import pointmap as pm, modbus as mb, fleet, hybrid, fsio
from .hal import DeviceLink, RtCommander
from . import opsmode as om
from dataclasses import replace
from ifps_ems.solar import clear_pv_kw

HIST_COLS = ["ts", "load_kw", "load_p1", "load_p2", "load_p3", "pv_kw", "temp", "press", "rh", "plan", "mode", "sky"]


def _add_sky_header(pth):
    """이전 판이 만든 이력 파일(sky 열 없음)의 머리줄에 sky 를 붙인다. 지난 줄은 그대로 둔다(빈 값으로 읽힌다)."""
    with open(pth, encoding="utf-8") as f: head = f.readline(); rest = f.read()
    if "sky" in head.strip().split(","): return
    tmp = pth + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f: f.write(head.rstrip("\r\n") + ",sky\n" + rest)
    os.replace(tmp, pth)


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
        self._probe = {}; self.seen = set()                                                 # 켠 뒤 한 번이라도 응답한 장치
        self.fleet = fleet.Fleet(list(self.links), self.seen)                        # 같은 종류 여러 대 자동 인식·합산
        self.lm = sv.LinkMonitor(list(self.links)); self.wd = sv.Watchdog(["수집", "제어"])
        self.val = {}; self.flag = {}; self.t_upd = {}; self.hb_seen = {}; self.hb_stop = {}; self.hb_skip = set(); self.t0 = clock(); self.events = []; self.ev_n = 0; self.audit_err = ""; self.n_scan = 0; self.n_over = 0; self.max_scan_s = 0.0
        self.state_dir = os.path.join(base, self.cfg.get("state_dir", "state")); os.makedirs(self.state_dir, exist_ok=True)
        self.fleet.restore(os.path.join(self.state_dir, "seen.json"))                # 재기동 전에 인식했던 장치(그사이 고장 난 장치를 '미설치'로 낮추지 않게)
        self.key_note = ""
        if key is None: key, self.key_note = security.load_or_create_key(self.state_dir)
        self.audit = security.AuditLog(os.path.join(self.state_dir, "audit.log"), security.CryptoProvider(key))
        self.sky = float("nan")                  # 하늘 카메라 구름량(0~1). 없으면 NaN — 화면부(skywatch)가 넣는다
        self.ai_degraded = False                 # 예측 정확도 저하(지속 학습이 판정) → 계획 운전을 쉬고 규칙 운전
        self.policy = None                       # 운전계획 연결 지점: policy(값 사전, 시각) → (디젤, 연료전지, 수전해) 기동 여부. 없으면 규칙 운전
        self.t_ctl = -1e9; self.acc = []; self.acc_sky = []; self.slot = None; self.mode = self.cfg.get("mode", "island"); self.plan = int(self.cfg.get("plan", 1))
        # 군 운용: 운용 장소(작전지 island / 주둔지 grid), 운용 태세(평시·저소음·자립), 자동 부하 차단, 주둔지 설정
        self.gar = om.Garrison.from_cfg(self.cfg.get("garrison")); self.posture = "평시"; self.auto_enabled = True; self.shedder = om.LoadShedder()
        self.auto_h = None; self.auto_target_h = float(self.cfg.get("autonomy_target_h", 72.0)); self.t_posture = self.now(); self.pv_day_kwh = None
        self.grid_lost = False; self.t_grid_ok = None; self.t_outage = None; self._grid_reset_pending = False; self.gdg_last = None; self.gar_last = None; self._gdg_t0 = None; self._w = {}; self._pvday = (None, 0.0)
        self._tags = {p["tag"] for p in self.pts}; self.rewrite = set(); self._grid_was = True; self.hist_err = ""; self.ops_auto = None; self._load_ops(); self._shed_saved = set(self.shedder.mine)
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
        skip = {n for n in self.links if self.fleet.empty(n)}; out = {n: self._probe_slot(n) for n in skip}     # 빈 자리는 주기 밖에서 가끔만 불러 본다
        futs = {(n, k): self.pool.submit(lk.read_blocks, cl) for n, lk in self.links.items() if n not in skip for k, cl in lk.cl.items()}
        for n, lk in self.links.items():
            if n in skip: continue
            vals = None
            for k in lk.cl:                                         # 값은 경로 A를 우선, 실패하면 B
                try:
                    v = futs[(n, k)].result(); lk.alive[k] = True
                    if vals is None: vals = v
                except Exception as e:                              # 한 장치의 어떤 오류도 다른 장치 수집을 막지 않는다
                    lk.alive[k] = False; lk.err = str(e) if isinstance(e, mb.ModbusError) else f"{type(e).__name__}: {e}"
            out[n] = vals
        return out

    def _probe_slot(self, n):
        """빈 자리(같은 종류 추가 자리)를 불러 본다. 응답을 기다리지 않는다 — 없는 장치의 시간 초과가 수집 주기를 늦추지 않게 따로 돌리고, 끝난 결과만 다음 주기에 받는다.
        반환: 이번에 받은 값 사전(없으면 None)."""
        f = self._probe.get(n)
        if f is None:
            if not self.fleet.skip(n, self.now()): self._probe[n] = self.pool.submit(self.links[n].read_all)
            return None
        if not f.done(): return None
        del self._probe[n]
        try: return f.result()
        except Exception: return None                              # 어떤 오류든 '아직 없음'으로 본다

    def scan(self):
        got = self._read_parallel(); t = self.now(); bad = set()      # 응답 시각은 읽기를 마친 때다(읽기가 길어져도 살아 있는 장치를 두절로 보지 않는다)
        for n, lk in self.links.items():
            was = self.lm.state[n]; v = got[n]
            for k, a in lk.alive.items():
                if a: self.lm.heartbeat(n, t, k)
            if len(lk.cl) == 1 and lk.alive.get("A"): self.lm.heartbeat(n, t, "B")      # 경로가 하나뿐인 장치: '경로 저하'로 보지 않는다
            if v is None: continue
            if n not in self.seen: self.seen.add(n); self.fleet.store()            # 처음 응답한 장치: 인식 목록에 넣고 적어 둔다(재기동 뒤에도 기억)
            if was == "재조회 대기":                                 # 복구 뒤 첫 수집: 달라진 값을 반영한 뒤 제어 재개
                diff = self.lm.resync(n, v, {k: self.val.get(k) for k in v}, t); self.note("통신", f"{n} 복구, 변경 {len(diff)}건 반영"); self._forget_writes(n)
            self._take(lk, v, t); got[n] = {tag: x for tag, x in v.items() if self.flag.get(tag) == 0}      # 합산에는 품질 검사를 통과한 값만 넘긴다
            bad.update(tag for tag in v if self.flag.get(tag) != 0)
        for n, st in self.lm.check(t).items():                                              # check 는 바뀐 것만 돌려준다
            if not self.fleet.empty(n): self.note("통신", f"{n} 통신 {st}")                  # 빈 자리의 무응답은 적지 않는다
        self._merge_fleet(got, t, bad); self._check_hb(t)
        for tag, tu in self.t_upd.items():
            if t - tu > SUP["stale_s"] and self.flag.get(tag) == 0: self.flag[tag] = 3      # 갱신 지연
        self._refresh_devices()
        self.wd.kick("수집", t); self.n_scan += 1
        self._accumulate()
        return {"t": t, "bad": {k: f for k, f in self.flag.items() if f}, "link": {n: s for n, s in self.lm.state.items() if s != "정상"}}

    def _merge_fleet(self, got, t, bad):
        """같은 종류 여러 대: 있는 장치를 가리고 종류 이름의 값을 합산한다. 대수가 바뀌면 기록에 남긴다."""
        before = {k: list(v) for k, v in self.fleet.live_now.items()}
        def mark(tag, ok):
            self.flag[tag] = 0 if ok else 5
            if ok: self.t_upd[tag] = t
        self.fleet.merge(got, self.lm.state, self.val, mark, bad)
        for k, us in self.fleet.live_now.items():
            if us != before[k] and len(self.fleet.slots[k]) > 1: self.note("자동 인식", f"{k} {len(us)}대 인식: {', '.join(us) or '없음'}")

    def _take(self, lk, v, t):
        """읽은 값을 품질 확인 뒤 반영한다. 범위 밖·NaN·무한대는 버리고 직전 유효값을 둔다(품질 5)."""
        for tag, x in v.items():
            p = lk.by_tag[tag]
            bad = not math.isfinite(x) or (p["lo"] is not None and x < p["lo"]) or (p["hi"] is not None and x > p["hi"] * self.fleet.span(tag, p["device"]))
            if not bad: self.val[tag] = x; self.t_upd[tag] = t
            self.flag[tag] = 5 if bad else 0

    def _check_hb(self, t):
        """생존 계수(hb) 정지: 통신은 되는데 장치 제어기가 멈춘 경우."""
        for n in self.links:
            hb = self.val.get(f"{n}.hb")
            if hb is None or self.fleet.empty(n) or n in self.hb_skip: continue      # 빈 자리와 빼는 중인 장치(unitctl)는 묵은 값으로 판정하지 않는다
            last = self.hb_seen.get(n)
            if last is None or last[0] != hb: self.hb_seen[n] = (hb, t)
            stop = t - self.hb_seen[n][1] > SUP["stale_s"]
            if stop != self.hb_stop.get(n, False):
                self.note("통신", f"{n} 생존 계수 {'정지 — 지령 차단' if stop else '재개'}")
                if not stop: self._forget_writes(n)
            self.hb_stop[n] = stop

    def _refresh_devices(self):
        for n in self.ctl:
            self.dev[n].online = self.controllable(n)
            st = self.fleet.unit(n, "status", self.val)                           # 장치 하나의 상태(종류 이름의 값은 여러 대의 합산이다)
            if st is not None: self.dev[n].on = int(round(st)) == 1
            if f"{n}.mode" in self.val: self.dev[n].manual = int(round(self.val[f"{n}.mode"])) == 1

    def _forget_writes(self, n):
        """장치가 통신 두절 · 제어기 정지에서 돌아왔다: 그 장치에 써 둔 설정값을 잊는다. 장치가 재기동하며 기본값으로 돌아갔을 수 있으므로 다음 제어 때 다시 쓴다."""
        for k in [k for k in self._w if k.partition(".")[0] == n]: del self._w[k]
        self.__dict__.get("hy_last", {}).pop(n, None); self.rewrite.add(n)

    def can_write(self, n):
        """설정값을 써도 되는가: 지령 가능하고 현장 수동이 아니다(수동인 장치의 설정은 현장 운용자의 것이다)."""
        return self.controllable(n) and int(round(self.val.get(f"{n}.mode", 0))) != 1

    def fresh(self, tag):
        """그 값이 지금 것인가(품질 정상). 범위 밖이거나 갱신이 멈췄으면(통신 두절 포함) 아니다."""
        return self.flag.get(tag) == 0

    def _blind(self, tag, wait=0):
        """판단에 꼭 필요한 값을 믿을 수 없는가: 읽다가 끊겼거나 값이 이상하거나, 대응표에 있는데 켠 뒤 한 번도 읽지 못했다."""
        if tag in self.flag: return self.flag[tag] != 0
        return tag not in self.val and tag in self._tags and self.n_scan >= wait

    def soc_blind(self): return self._blind("ESS.soc", 3)

    def grid_blind(self): return self.mode == "grid" and self._blind("CB.GRID")

    def _grid_closed(self):
        """수전 차단기 투입 여부. 읽지 못하는 동안은 직전 판정을 그대로 둔다(처음부터 못 읽었으면 '연계 중' — 정전으로 단정해 발전기를 돌리지 않는다)."""
        if not self.grid_blind(): self._grid_was = int(round(self.val.get("CB.GRID", 0))) == 1
        return self._grid_was

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
            if isinstance(o.get("auto"), bool): self.ops_auto = o["auto"]
            self.shedder.mine = {f for f in o.get("shed", ()) if f in ("L2", "L3")}; self.shedder.why = {f: "재기동 전 자동 차단" for f in self.shedder.mine}
        except (OSError, ValueError):
            pass

    def set_ops(self, mode=None, posture=None, who="ems"):
        if mode is not None:
            if mode not in om.PLACES: raise ValueError(f"운용 장소 오류: {mode}")
            if mode == "grid" and "GRID.kw" not in self.val and not any(p["tag"] == "GRID.kw" for p in self.pts): raise ValueError("주둔지 운전에는 수전점 계측(GRID.kw, CB.GRID)이 필요합니다")
            if mode != self.mode: self.mode = mode; self.grid_lost = False; self.t_grid_ok = None; self._grid_reset_pending = False; self.note("운용", f"운용 장소 변경 → {'주둔지(상전 연계)' if mode == 'grid' else '작전지(자립 운전)'}", actor=who)
        if posture is not None:
            if posture not in om.POSTURES: raise ValueError(f"운용 태세 오류: {posture}")
            if posture != self.posture: self.posture = posture; self.t_posture = self.now(); self.note("운용", f"운용 태세 변경 → {posture}", actor=who)
        self.save_ops()

    def save_ops(self):
        """운용 상태를 적어 둔다: 운용 장소 · 태세, 자동 제어 켬/끔, EMS 가 스스로 끊은 급전선. 재기동해도 운용자가 끈 자동 제어가 켜지지 않고, 끊어 둔 부하를 되살릴 수 있다."""
        o = {"mode": self.mode, "posture": self.posture, "shed": sorted(self.shedder.mine)}
        if self.ops_auto is not None: o["auto"] = bool(self.ops_auto)
        fsio.write_json(self._ops_path(), o)

    def tied(self):
        """상전에 연계되어 있는가(주둔지이고 수전 차단기 투입, 복전 뒤 안정 시간 경과)."""
        return self.mode == "grid" and not self.grid_lost and self._grid_closed()

    def _grid_watch(self, t):
        """주둔지: 수전 차단기 상태로 정전·복전을 판정한다. 정전이면 곧바로 자립 운전 논리로 넘어간다."""
        if self.mode != "grid" or self.grid_blind(): return        # 수전 차단기 상태를 못 읽는 동안은 판정을 바꾸지 않는다
        closed = self._grid_closed()
        if not closed:
            self.t_grid_ok = None
            if not self.grid_lost:
                self.grid_lost = True; self.t_outage = t
                self.note("운용", "상전 정전(수전 차단기 개방) — 자립 운전으로 전환")
                self._grid_reset_pending = True
            if self.auto_enabled and self._grid_reset_pending:
                a = self._write("ESS", "ESS.kw_set", 0.0, 0.5) or not self._writable("ESS", "ESS.kw_set"); b = self._write("PV", "PV.lim_set", 0.0, 0.5) or not self._writable("PV", "PV.lim_set")
                self._grid_reset_pending = not (a and b)              # 쓰기에 실패했으면 다음 주기에 다시 쓴다
        elif self.grid_lost:
            self._grid_reset_pending = False
            if self.t_grid_ok is None: self.t_grid_ok = t
            if t - self.t_grid_ok >= self.gar.restore_s: self.grid_lost = False; self.note("운용", f"상전 복전 {self.gar.restore_s:.0f}초 안정 — 주둔지 운전 복귀")

    def _write(self, dev, tag, value, tol):
        """자동 설정값 쓰기. 같은 종류가 여러 대면 있는 장치에 똑같이 나누어 쓴다."""
        us = self.fleet.live(dev); ok = False; den = self.fleet.share(dev) if len(us) > 1 or dev in self.fleet.slots and self.fleet.ever else 1
        for n in us: ok = self._write1(n, n + tag[len(dev):], value / max(den, len(us)), tol) or ok
        return ok

    def _writable(self, dev, tag):
        """그 종류에 이 설정 점이 있는가(없는 점은 쓰기 실패로 세지 않는다)."""
        return any(n in self.links and n + tag[len(dev):] in self.links[n].by_tag for n in self.fleet.live(dev))

    def _write1(self, dev, tag, value, tol):
        """장치 하나에 쓰기. 직전에 쓴 값과 tol 이내면 다시 쓰지 않는다. 지령 가능 상태가 아니면 쓰지 않는다."""
        lk = self.links.get(dev)
        if lk is None or tag not in lk.by_tag or not self.can_write(dev): return False
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
        avail = (s.ess_kw if ess_ok else 0.0) + self.g1_kw() * (g("CB.G1", 1) == 1) + s.dg_kw * (g("DG.status") > 0.5) + s.fc_kw * (g("FC.status") > 0.5) + max(0.0, g("PV.kw"))
        avail += sum(self.gar.gdg_kw for n in self.gdgs if g(f"{n}.status") > 0.5 and g(f"CB.{n}", 1) == 1)
        target = max(0.0, self.auto_target_h - (t - self.t_posture) / 3600.0) if self.posture == "자립" else self.auto_target_h
        return om.LoadShedder.want(s, self.posture, soc, avail, g("LOAD.p1_kw") + g("LOAD.p2_kw"), g("LOAD.kw"), self.auto_h, target)

    def _garrison_control(self, tied, hr, soc):
        """수전 차단기가 투입된 동안의 ESS·태양광 설정값(역송 방지·피크 억제·시간대 충방전). 반환: 한 일 목록.
        복전 확인 중(tied 아님)에도 역송 방지는 곧바로 한다 — 기다리는 동안 태양광이 남으면 역전력 보호가 동작한다.
        주둔지 자립 태세(상전 상실)인데 차단기가 아직 투입 상태일 때도 같다: 수전을 최소로 묶는다(경보로 분리 확인 요청)."""
        g = lambda k, d=0.0: self.val.get(k, d); done = []
        ss = self.posture == "자립" or not tied
        load = g("LOAD.kw") - ((g("DG.kw") + g("FC.kw")) if ss else 0.0)     # 이때 돌리는 연료전지·디젤 출력은 부하에서 뺀다
        r = om.garrison_step(self.site, replace(self.gar, self_supply=ss), hr, load, g("PV.kw"), g("ELZ.kw"), soc, g("H2.nm3")); self.gar_last = r
        if self.posture == "저소음": r["why"] += " · 저소음 태세: 상전 연계 중에는 평시와 같음(발전기 정지 상태)"
        if self.auto_enabled:
            if self._write("ESS", "ESS.kw_set", r["ess"], 1.0): done.append(("ESS.kw_set", r["ess"]))
            self._write("PV", "PV.lim_set", r["pv_lim"], 1.0)
        return done

    def fast_control(self):
        """매 수집 주기(1초)에 도는 빠른 제어: 주둔지 ESS·PV 설정값(역송 방지·피크 억제), 부하 자동 차단·복구, 자립 지속시간.
        반환: 한 일 목록. 자동 제어가 꺼져 있으면 계산만 하고 쓰지 않는다."""
        t = self.now(); g = lambda k, d=0.0: self.val.get(k, d); s = self.site; done = []; hr = self.hr()
        self._grid_watch(t); tied = self.tied(); soc = g("ESS.soc", 60.0) / 100
        self._autonomy_update(soc)
        phys = self.mode == "grid" and self._grid_closed()         # 수전 차단기가 실제로 투입되어 있는가(복전 확인 시간 중 포함)
        if self.grid_blind(): self.gar_last = None                   # 수전점 계측을 못 읽는다: 묵은 부하 값으로 ESS · 태양광 설정을 바꾸지 않는다
        elif tied or phys: done += self._garrison_control(tied, hr, soc)
        else:
            self.gar_last = None
            if self.mode != "grid": self._w.pop("ESS.kw_set", None)
        self._gdg_control(t, tied or phys, soc)
        # 부하 자동 차단·복구(상전 연계 중에는 공급 능력으로 끊지 않는다)
        cb = {f: (int(round(self.val[f"CB.{f}"])) if f"CB.{f}" in self.val else None) for f in ("L2", "L3")}
        want = {"L3": "", "L2": ""} if tied else self._shed_want(t, soc)
        mtr = self.links.get("MTR")
        if self.auto_enabled and mtr is not None and "LDS.L3" in mtr.by_tag and self.lm.controllable("MTR"):
            for f, act, why in self.shedder.step(t, want, cb, soc, s.soc_min):
                ok = self.links["MTR"].write(f"LDS.{f}", 2 if act == "shed" else 1); nm = "2등급" if f == "L2" else "3등급"
                self.note("지령", f"부하 자동 {'차단' if act == 'shed' else '복구'}: {nm}({f}) — {why}{'' if ok else ' (쓰기 실패)'}"); done.append((f, act))
            if self.shedder.mine != self._shed_saved: self._save_shed()
        return done

    def _save_shed(self):
        self._shed_saved = set(self.shedder.mine)
        try: self.save_ops()
        except OSError: pass                                         # 저장 실패는 운전을 막지 않는다

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
        g = lambda k, d=0.0: self.val.get(k, d); hr = self.hr(); hold = self._decide_hold()
        if hold is not None: return hold
        if self.tied() and not self.grid_blind():                                               # 주둔지 상전 연계: 디젤·연료전지는 쉬고 상전과 ESS 로 운전(수전해는 남는 전력이 있을 때만)
            r = self.gar_last or {}; dg, fc = self._self_supply_sources(r) if self.posture == "자립" else (False, False)
            w = {"DG": dg, "FC": fc, "_policy": (int(dg), int(fc), int(bool(r.get("elz")))), "_garrison": True}
            if self.gdgs: w["GDG"] = False                            # 주둔지 발전기는 대기(상전과 병렬 운전하지 않는다)
            return w
        if self.policy and not self.ai_degraded: a = self.policy(dict(self.val), hr)
        else: a = dp.rule_action(self.site, g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), int(g("FC.status")), g("LOAD.kw"), g("PV.kw"), hr)
        if self.soc_blind(): a = (1, int(a[1]), 0)                   # ESS 충전율을 믿을 수 없다: 안전 쪽으로 발전기를 돌린다(묵은 값만 믿다가 방전되는 일을 막는다)
        if self.posture == "저소음" and a[0]:                         # 저소음 태세: 디젤 금지. 연료전지로 대신하고(수소가 있으면) 3등급 부하는 자동 차단
            h2_ok = g("H2.nm3") > self.site.h2_nm3 * self.site.h2_min * 1.2
            a = (0, 1 if h2_ok else int(a[1]), 0)
        want = {"DG": bool(a[0]), "FC": bool(a[1]), "_policy": tuple(int(x) for x in a)}
        if self.posture == "저소음": want["_quiet"] = True
        self._swap_missing(want); hybrid.need(self, want); gdg_on = self._decide_gdg(want)      # 복합전력의 ESS 가 낮으면 발전기로 충전
        if self.mode in ("island", "grid"):                           # 자립 운전(작전지, 또는 주둔지 정전 중) N-1 순동 예비력
            online = self.online_kw(self._ready("DG") if want["DG"] else 0, self._ready("FC") if want["FC"] else 0) + [self.gar.gdg_kw] * int(gdg_on)
            if not gdg_on and dp.reserve_need(g("LOAD.p1_kw") + g("LOAD.p2_kw"), online): want["FC"] = True; want["_reserve"] = True
        return want

    def _decide_hold(self):
        """수전 차단기 상태를 못 읽는 동안(주둔지): 발전기 기동 · 정지를 보류한다(상전이 살아 있는지 모른다). 반환: 보류 결정 또는 None.
        다만 ESS 가 낮거나 충전율도 못 읽으면 보류하지 않고 자립 운전 논리로 넘어간다 — 상전이 실제로 끊긴 것일 수 있다."""
        if not self.grid_blind(): return None
        if self.soc_blind() or self.val.get("ESS.soc", 60.0) / 100 < self.site.soc_min + 0.06: return None
        dg = self.fleet.running("DG", self.val) > 0; fc = self.fleet.running("FC", self.val) > 0
        return {"DG": dg, "FC": fc, "_policy": (int(dg), int(fc), 0), "_hold": True}

    def online_kw(self, n_dg, n_fc):
        """N-1 예비력 계산에 넣는 병렬 전원의 용량 목록: 운전 중인 ESS(대수만큼), 복합전력 G1, 디젤 n_dg 대, 연료전지 n_fc 대."""
        ess = self.fleet.running("ESS", self.val) if "ESS.status" in self.val else 1
        return [self.site.ess_kw] * ess + [float(self.cfg.get("g1_kw", 100.0))] * self.g1_n() + [self.site.dg_kw] * n_dg + [self.site.fc_kw] * n_fc

    def g1_n(self):
        """복합전력 차량의 대수 = 인식한 복합전력 PCS 의 수(한 PCS 가 발전기와 ESS 를 함께 맡는다 — 장치 이름 DG, DG2 …)."""
        return max(1, sum(1 for u in self.fleet.slots.get("DG", ()) if u in self.seen))

    def g1_kw(self):
        return float(self.cfg.get("g1_kw", 100.0)) * self.g1_n()

    def _ready(self, k):
        """기동 지령을 받을 수 있는 대수(있는 장치 가운데 현장 수동이 아닌 것). 아직 읽기 전이면 1."""
        if not self.fleet.ever: return 1
        return sum(1 for n in self.fleet.live(k) if not (n in self.dev and self.dev[n].manual))

    def _swap_missing(self, want):
        """가져오지 않은 종류는 지령하지 않는다: 디젤이 없으면 연료전지로, 연료전지가 없으면 디젤로 대신한다.
        '없다'는 그 종류의 모든 자리가 한 번도 응답하지 않았고 통신 두절로 판정된 뒤다(첫 수집을 한 번 놓친 것으로 바꾸지 않는다)."""
        for a, b in (("DG", "FC"), ("FC", "DG")):
            if want.get(a) and a in self.fleet.slots and all(u not in self.fleet.ever and self.lm.state.get(u) == "두절" for u in self.fleet.slots[a]):
                want[a] = False; want[b] = bool(want.get(b)) or b not in self.fleet.slots or self.fleet.n(b) > 0; want["_swap"] = a

    def _self_supply_sources(self, r):
        """주둔지 자립 태세(상전 연계 중): 태양광·ESS 로 모자라면 연료전지, 그래도 모자라거나 수소가 없으면 이동형 디젤을 돌린다.
        한 번 켠 전원은 ESS 가 60% 로 찰 때까지 유지한다(잦은 기동·정지 방지). 반환: (디젤, 연료전지)"""
        g = lambda k, d=0.0: self.val.get(k, d); s = self.site; soc = g("ESS.soc", 60.0) / 100; short = float(r.get("short", 0.0))
        need = short > 5.0 or soc < s.soc_min + 0.10; keep = soc < 0.60
        h2_ok = g("H2.nm3") > s.h2_nm3 * s.h2_min * 1.2; fc_on = g("FC.status") > 0.5; dg_on = g("DG.status") > 0.5
        fc = h2_ok and (need or (fc_on and keep))
        dg = (dg_on and keep) or (need and (not h2_ok or fc_on))      # 연료전지를 돌려도 모자라거나 수소가 없을 때
        return bool(dg), bool(fc)

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
        for n, k in self.targets(("DG", "FC")) if not want.get("_hold") else ():
            if n not in self.dev or (n in self.gdgs and "GDG" not in want): continue
            d = self.dev[n]; w_n = want["GDG"] if n in self.gdgs else want[k]
            if w_n != d.on:
                n0 = len(self.cmd.log); ok, dt = self.cmd.send(n, "start" if w_n else "stop")
                for e in self.cmd.log[n0:]: self.note("지령", e["text"])
                done.append((n, w_n, ok, round(dt, 2)))
        if len(self.cmd.log) > 2000: del self.cmd.log[:1000]
        self.wd.kick("제어", self.now())
        return done

    def targets(self, kinds):
        """지령 대상: [(장치, 종류)] — 그 종류의 있는 장치 모두, 그리고 주둔지 발전기."""
        return [(n, k) for k in kinds for n in self.fleet.live(k)] + [(n, "GDG") for n in self.gdgs]

    # ── 5) 기록
    def _accumulate(self):
        g = lambda k: self.val.get(k, float("nan")); w = self.wall(); slot = w.replace(minute=w.minute // 15 * 15, second=0, microsecond=0)
        if self.slot is not None and slot != self.slot and self.acc:
            m = [sum(c) / len(c) for c in zip(*self.acc)]; pth = os.path.join(self.state_dir, "history.csv"); new = not os.path.exists(pth)
            sk = [x for x in self.acc_sky if x == x]; sky = f"{sum(sk) / len(sk):.3f}" if sk else ""              # 구름량은 값이 있을 때만 적는다
            try:                                                     # 이력 쓰기 실패(저장 공간 · 권한)가 수집 · 제어 · 경보 주기를 멈추면 안 된다
                if not new: _add_sky_header(pth)
                with open(pth, "a", newline="", encoding="utf-8") as f:
                    wr = csv.writer(f)
                    if new: wr.writerow(HIST_COLS)
                    wr.writerow([self.slot.strftime("%Y-%m-%d %H:%M")] + [f"{x:.2f}" for x in m] + [self.plan, {"grid": 0, "direct": 1, "island": 2}.get(self.mode, 2), sky])
                self.hist_err = ""
            except OSError as e: self.hist_err = f"{type(e).__name__}: {e}"
            self.acc = []; self.acc_sky = []
        self.slot = slot
        row = [g("LOAD.kw"), g("LOAD.p1_kw"), g("LOAD.p2_kw"), g("LOAD.p3_kw"), g("PV.kw"), g("ENV.temp"), g("ENV.press"), g("ENV.rh")]
        if all(x == x for x in row): self.acc.append(row); self.acc_sky.append(self.sky)

    def save(self):
        fsio.write_json(os.path.join(self.state_dir, "last.json"), {"t": self.now(), "val": self.val, "link": self.lm.state, "on": {n: d.on for n, d in self.dev.items()}})

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
        r = rt.scan(); dead = {n: lk.err or "무응답" for n, lk in rt.links.items() if not any(lk.alive.values()) and not rt.fleet.empty(n)}; spare = [n for n in rt.links if rt.fleet.empty(n)]     # 응답 없는 추가 자리는 빈 자리      # 두절 판정(2초)을 기다리지 않고 1회 수집 결과로 본다
        half = {n: "경로 " + ",".join(k for k, ok in lk.alive.items() if not ok) + " 무응답" for n, lk in rt.links.items() if n not in dead and n not in spare and not all(lk.alive.values())}
        print("장치", len(rt.links) - len(spare), "대 | 빈 자리", ",".join(spare) or "없음", "| 읽은 점", len(rt.val), "| 통신 이상", dead or "없음", "| 경로 저하", half or "없음", "| 품질 이상", r["bad"] or "없음"); rt.close(); return 1 if dead else 0
    try: rt.run(a.scans)
    finally: rt.close()
    return 0
