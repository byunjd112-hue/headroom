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
import csv, json, os, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from ifps_ems import supervisor as sv, dispatch as dp, security
from ifps_ems.config import Site, SUP
from . import pointmap as pm, modbus as mb
from .hal import DeviceLink, RtCommander

HIST_COLS = ["ts", "load_kw", "load_p1", "load_p2", "load_p3", "pv_kw", "temp", "press", "rh", "plan", "mode"]


class Runtime:
    def __init__(self, cfg_path, clock=time.monotonic, wall=datetime.now, key=None):
        with open(cfg_path, encoding="utf-8") as f: self.cfg = json.load(f)
        base = os.path.dirname(os.path.abspath(cfg_path))
        self.pts = pm.load(os.path.join(base, self.cfg["pointmap"]), self.cfg["devices"])
        bad = pm.validate(self.pts, self.cfg["devices"])
        if bad: raise ValueError("대응표 오류: " + "; ".join(bad))
        self.clock, self.wall = clock, wall; self._nlock = threading.Lock()
        self.site = Site(**{k: v for k, v in self.cfg.get("site", {}).items() if k in Site.keys()})
        self.links = {n: DeviceLink(n, [tuple(p) for p in d["paths"]], d["unit"], self.pts, self.cfg["allow"], self.cfg.get("timeout_s", 0.5)) for n, d in self.cfg["devices"].items()}
        self.pool = ThreadPoolExecutor(max_workers=max(2, sum(len(lk.cl) for lk in self.links.values())), thread_name_prefix="scan")
        self.ctl = [n for n in self.links if f"{n}.cmd" in self.links[n].by_tag]
        self.dev = {n: sv.Device(n) for n in self.ctl}
        self.cmd = RtCommander({n: self.links[n] for n in self.ctl}, self.dev, clock=clock)
        self.lm = sv.LinkMonitor(list(self.links)); self.wd = sv.Watchdog(["수집", "제어"])
        self.val = {}; self.flag = {}; self.t_upd = {}; self.hb_seen = {}; self.hb_stop = {}; self.t0 = clock(); self.events = []; self.n_scan = 0; self.n_over = 0; self.max_scan_s = 0.0
        self.state_dir = os.path.join(base, self.cfg.get("state_dir", "state")); os.makedirs(self.state_dir, exist_ok=True)
        self.key_note = ""
        if key is None: key, self.key_note = security.load_or_create_key(self.state_dir)
        self.audit = security.AuditLog(os.path.join(self.state_dir, "audit.log"), security.CryptoProvider(key))
        self.policy = None                       # 운전계획 연결 지점: policy(값 사전, 시각) → (디젤, 연료전지, 수전해) 기동 여부. 없으면 규칙 운전
        self.t_ctl = -1e9; self.acc = []; self.slot = None; self.mode = self.cfg.get("mode", "island"); self.plan = int(self.cfg.get("plan", 1))
        ok, why = security.crypto_gate(self.audit.c, self.cfg.get("run_mode", "개발"))
        if not ok: raise RuntimeError(why)

    def now(self): return self.clock() - self.t0

    def note(self, kind, text, actor="ems"):
        with self._nlock:
            self.events.append({"t": round(self.now(), 2), "wall": self.wall().strftime("%Y-%m-%d %H:%M:%S"), "kind": kind, "text": text, "actor": actor})
            if len(self.events) > 5000: del self.events[:1000]
            self.audit.append(actor, kind, {"text": text})

    # ── 1)~3) 수집·통신 감시·품질 확인
    def _read_parallel(self):
        """모든 장치·경로를 동시에 읽는다. 응답 없는 장치가 있어도 한 주기는 시간 초과 1회 안에 끝난다."""
        futs = {(n, k): self.pool.submit(lk._read_blocks, cl) for n, lk in self.links.items() for k, cl in lk.cl.items()}
        out = {}
        for n, lk in self.links.items():
            vals = None
            for k in lk.cl:                                         # 값은 경로 A를 우선, 실패하면 B
                try:
                    v = futs[(n, k)].result(); lk.alive[k] = True
                    if vals is None: vals = v
                except mb.ModbusError as e:
                    lk.alive[k] = False; lk.err = str(e)
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
            for tag, x in v.items():
                p = lk.by_tag[tag]; f = 0
                if (p["lo"] is not None and x < p["lo"]) or (p["hi"] is not None and x > p["hi"]): f = 5
                if f == 0: self.val[tag] = x; self.t_upd[tag] = t
                self.flag[tag] = f
        for n, st in self.lm.check(t).items():
            if not any(e["text"].startswith(f"{n} 통신") and e["text"].endswith(st) for e in self.events[-20:]): self.note("통신", f"{n} 통신 {st}")
        for n in self.links:                                          # 생존 계수(hb) 정지: 통신은 되는데 장치 제어기가 멈춘 경우
            hb = self.val.get(f"{n}.hb")
            if hb is None: continue
            last = self.hb_seen.get(n)
            if last is None or last[0] != hb: self.hb_seen[n] = (hb, t)
            stop = t - self.hb_seen[n][1] > SUP["stale_s"]
            if stop != self.hb_stop.get(n, False): self.note("통신", f"{n} 생존 계수 {'정지 — 지령 차단' if stop else '재개'}")
            self.hb_stop[n] = stop
        for tag, tu in self.t_upd.items():
            if t - tu > SUP["stale_s"] and self.flag.get(tag) == 0: self.flag[tag] = 3      # 갱신 지연
        for n in self.ctl:
            self.dev[n].online = self.controllable(n)
            if f"{n}.status" in self.val: self.dev[n].on = int(round(self.val[f"{n}.status"])) == 1
            if f"{n}.mode" in self.val: self.dev[n].manual = int(round(self.val[f"{n}.mode"])) == 1
        self.wd.kick("수집", t); self.n_scan += 1
        self._accumulate()
        return {"t": t, "bad": {k: f for k, f in self.flag.items() if f}, "link": {n: s for n, s in self.lm.state.items() if s != "정상"}}

    def controllable(self, n):
        """지령 가능: 통신 경로가 살아 있고 장치 생존 계수(hb)가 멈추지 않았다."""
        return self.lm.controllable(n) and not self.hb_stop.get(n, False)

    # ── 4) 제어
    def decide(self):
        g = lambda k, d=0.0: self.val.get(k, d); hr = self.wall().hour + self.wall().minute / 60
        if self.policy: a = self.policy(dict(self.val), hr)
        else: a = dp.rule_action(self.site, g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), int(g("FC.status")), g("LOAD.kw"), g("PV.kw"), hr)
        want = {"DG": bool(a[0]), "FC": bool(a[1]), "_policy": tuple(int(x) for x in a)}
        if self.mode == "island":                                     # 자립 운전 N-1 순동 예비력
            online = [self.site.ess_kw] * int(g("ESS.status", 1)) + [self.cfg.get("g1_kw", 100.0)] + [self.site.dg_kw] * int(want["DG"]) + [self.site.fc_kw] * int(want["FC"])
            if dp.reserve_need(g("LOAD.p1_kw") + g("LOAD.p2_kw"), online): want["FC"] = True; want["_reserve"] = True
        return want

    def control(self, force=False):
        t = self.now()
        if not force and t - self.t_ctl < self.cfg.get("ctrl_s", 60.0):
            self.wd.kick("제어", t); return []                       # 제어 주기 전이어도 제어 과정은 살아 있다
        self.t_ctl = t; want = self.decide(); done = []
        for n in ("DG", "FC"):
            if n not in self.dev: continue
            d = self.dev[n]
            if want[n] != d.on:
                n0 = len(self.cmd.log); ok, dt = self.cmd.send(n, "start" if want[n] else "stop")
                for e in self.cmd.log[n0:]: self.note("지령", e["text"])
                done.append((n, want[n], ok, round(dt, 2)))
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
            a = self.clock(); self.scan(); self.control(); k += 1
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
        r = rt.scan(); print("장치", len(rt.links), "대 | 읽은 점", len(rt.val), "| 통신 이상", r["link"] or "없음", "| 품질 이상", r["bad"] or "없음"); rt.close(); return 0 if not r["link"] else 1
    try: rt.run(a.scans)
    finally: rt.close()
    return 0
