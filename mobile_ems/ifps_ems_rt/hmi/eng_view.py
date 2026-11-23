# -*- coding: utf-8 -*-
"""화면에 주는 자료: 스냅샷, 지표, 신호 목록, 추세 · 통신 추적, 실행 정보.Engine(hmi/engine.py)의 한 부분이다 — 기능별로 파일을 나눈 것이며 메서드는 Engine 의 것으로 쓴다.
"""
import copy, json, os, time
from datetime import datetime, timedelta, timezone
from ifps_ems import __version__ as CORE_VERSION
from ifps_ems.config import SUP
from .. import fleet, hybrid, __version__ as RT_VERSION
from . import autodev
from .engdefs import PKG_REV, FLAG_TXT, wall_iso


class ViewMixin:
    """Engine 에 섞어 쓰는 묶음(자체 상태는 없다 — self 는 Engine 이다)."""

    # ── 상태
    def kpi(self):
        rt = self.rt; v = rt.val; g = lambda k, d=0.0: v.get(k, d); s = rt.site; n = lambda k: max(1, rt.fleet.n(k))         # 같은 종류 대수(용량에 곱한다)
        run = lambda k: rt.fleet.running(k, v) if rt.fleet.ever else int(rt.dev[k].on if k in rt.dev else g(f"{k}.status") > 0.5)          # 운전 중인 대수
        load, pv, dg, fc, ess = g("LOAD.kw"), g("PV.kw"), g("DG.kw"), g("FC.kw"), g("ESS.kw"); elz = g("ELZ.kw")
        online = [float(x) for x in rt.online_kw(run("DG"), run("FC"))]
        l12 = g("LOAD.p1_kw") + g("LOAD.p2_kw"); margin = (sum(online) - max(online)) - l12 if online else -l12
        soc = g("ESS.soc", 0.0); h2 = g("H2.nm3", 0.0); fuel = g("DG.fuel_l", 0.0)
        ess_h = ((soc / 100 - s.soc_min) * s.ess_kwh * n("ESS") / ess) if ess > 1 else None
        return {"load": load, "pv": pv, "dg": dg, "fc": fc, "ess": ess, "soc": soc, "h2": h2, "fuel": fuel, "l1": g("LOAD.p1_kw"), "l2": g("LOAD.p2_kw"), "l3": g("LOAD.p3_kw"),
                "gen": pv + dg + fc + max(ess, 0.0) + max(g("GRID.kw"), 0.0) + max(g("GDG.kw"), 0.0), "renew": (min(pv, load) / load * 100) if load > 1 else 0.0, "reserve_margin": margin, "reserve_need": margin < 0,
                "online_kw": online, "ess_h": ess_h, "h2_h": h2 / (s.fc_kw * n("FC") * s.fc_nm3_per_kwh) if s.fc_kw else None, "fuel_h": fuel / (s.dg_kw * n("DG") * s.dg_l_per_kwh) if s.dg_kw else None,
                "grid": g("GRID.kw"), "gdg": sum(g(f"{n}.kw") for n in rt.gdgs), "temp": g("ENV.temp"), "press": g("ENV.press"), "rh": g("ENV.rh"), "elz": elz, "g1_kw": rt.g1_kw(), "g1_n": rt.g1_n(), "hy": hybrid.view(rt.cfg.get("hybrid"))}

    def _snap_values(self, now):
        rt = self.rt
        return {p["tag"]: {"v": rt.val.get(p["tag"]), "f": rt.flag.get(p["tag"], 3 if p["tag"] not in rt.val else 0),
                           "age": round(now - rt.t_upd[p["tag"]], 1) if p["tag"] in rt.t_upd else None} for p in rt.pts if p["rw"] == "r"}

    def _snap_device(self, n, lk, now):
        rt = self.rt; d = rt.dev.get(n)
        paths = {k: {"alive": lk.alive.get(k, False), "host": f"{cl.host}:{cl.port}", "unit": cl.unit, "ok": cl.n_ok, "err": cl.n_err,
                     "rtt": None if cl.last_rtt is None else round(cl.last_rtt * 1000, 2), "last_err": cl.last_err, "age": round(now - rt.lm.last[n][k], 1)} for k, cl in lk.cl.items()}
        return {"link": rt.lm.state[n], "absent": autodev.absent(self, n), "slot": fleet.is_slot(n), "kind": fleet.kind(n), "since": round(now - rt.lm.since[n], 1), "ctl": n in rt.dev, "paths": paths,
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
                "policy": (getattr(self.rt.policy, "note", "") or self.plan_note) if self.rt.policy else self.plan_note, "version": {"rt": RT_VERSION, "core": CORE_VERSION, "pkg": PKG_REV}, "values": vals, "devices": devs, "kpi": self.kpi(),
                "alarms": alarms[:200], "alarm_cnt": cnt, "cmdlog": rt.cmd.log[-60:][::-1], "events": rt.events[-150:][::-1],
                "decision": self.last_decision, "busy": (self.busy or {}).get("kind"), "queue": self.jobs.qsize(),
                "next_ctrl_s": max(0.0, round(float(self.cfg.get("ctrl_s", 60.0)) - (now - rt.t_ctl), 1)), "ctrl_s": float(self.cfg.get("ctrl_s", 60.0)),
                "stats": {"n_scan": rt.n_scan, "n_over": rt.n_over, "max_ms": round(rt.max_scan_s * 1000, 1), "last_ms": round(sm[-1], 1) if sm else None,
                          "avg_ms": round(sum(sm) / len(sm), 1) if sm else None, "p95_ms": round(st[int(len(st) * 0.95) - 1], 1) if len(st) > 20 else None,
                          "scan_s": float(self.cfg.get("scan_s", 1.0)), "wd": {k: (None if t is None else round(now - t, 1)) for k, t in rt.wd.last.items()},
                          "trace_n": self.trace_n, "audit_seq": rt.audit.seq, "hist": hist, "hist_top": round(top, 1)},
                "sim_state": self.sim_state() if self.sim else None, "ring": self.ringw.status(), "fleet": rt.fleet.view(rt.lm.state, rt.dev, rt.val), "loads": self.loadw.view(), "ops": self.ops(), "energy": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in self.energy.items() if k != "hours"}}

    def sim_state(self):
        p = self.plant
        return {"muted": sorted(p.muted), "noack": sorted(p.no_ack), "down": sorted(p.down), "gone": sorted(p.gone), "hold": dict(self.simdrv.hold), "scenario": self.simdrv.scn, "replay": self.simdrv.replay.state(),
                "clock": (datetime.now() + timedelta(hours=self.simdrv.off_h)).strftime("%H:%M") if self.simdrv.off_h else "",
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
                "version": {"rt": RT_VERSION, "core": CORE_VERSION, "pkg": PKG_REV}, "crypto": {"module": self.rt.audit.c.module, "verified": self.rt.audit.c.verified},
                "sup": SUP, "policy": self.plan_note,
                "cmd": {"took": {n: round(t, 2) for n, t in self.rt.cmd.took.items()}, "done_default": self.rt.cmd.done_default, "done_s": dict(self.rt.cmd.done_s)}}
