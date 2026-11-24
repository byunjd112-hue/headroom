# -*- coding: utf-8 -*-
"""모선 구성 — 화면부 연결. 구성을 상태 폴더(bus.json)에 두고, 바뀌면 가상 장치(모선 전압 계산)에 알린다. 스냅샷의 bus 로 나가 결선도 · 시나리오 구성도 · 개요가 같이 쓴다.
계산과 점검은 ifps_ems_rt/busplan.py. 바꾸는 것은 엔지니어 권한이다(전기 구성)."""
import json, os
from .. import busplan, fsio
from .engdefs import wall_iso


class BusBook:
    def __init__(self, eng):
        self.eng = eng; self.path = os.path.join(eng.rt.state_dir, "bus.json"); self.by = ""; self.t = ""; o = eng.cfg.get("bus")
        try:
            with open(self.path, encoding="utf-8") as f: s = json.load(f)
            o = s.get("assign"); self.by = str(s.get("by", "")); self.t = str(s.get("t", ""))
        except (OSError, ValueError, AttributeError): pass
        self.assign = busplan.settings(o); self.apply()

    def apply(self):
        if self.eng.plant is not None: self.eng.plant.bus = dict(self.assign)
        from . import scenarios
        scenarios.BUS = dict(self.assign)                                 # 운영 시나리오의 가상 장치도 같은 모선 구성으로 돈다

    def present(self):
        """지금 있는 전원 · 부하: 인식한 장치, 주둔지에서만 상전 · 주둔지 발전기, 부하 목록에 있는 등급."""
        rt = self.eng.rt; out = set()
        for k in ("PV", "DG", "FC", "ESS"):
            if k in rt.links and rt.fleet.n(k) > 0 and not (k in rt.fleet.slots and rt.fleet.ever and not rt.fleet.live(k)): out.add(k)
        if "DG" in out: out.add("G1")
        if rt.mode == "grid": out.add("GRID"); out.update(["GDG"] if rt.gdgs else [])
        ld = getattr(self.eng, "loadw", None)
        for g, f in ((1, "L1"), (2, "L2"), (3, "L3")):
            if ld is None or any(i["grade"] == g and i["n"] > 0 for i in ld.items): out.add(f)
        return out

    def rated(self):
        rt = self.eng.rt; s = rt.site; n = rt.fleet.n; r = {"PV": s.pv_kwp * max(1, n("PV")), "DG": s.dg_kw * max(1, n("DG")), "FC": s.fc_kw * max(1, n("FC")), "ESS": s.ess_kw * max(1, n("ESS")), "G1": rt.g1_kw(), "GDG": rt.gar.gdg_kw * max(1, len(rt.gdgs))}
        ld = getattr(self.eng, "loadw", None)
        if ld is not None: r.update({f: sum(i["kw"] * i["n"] for i in ld.items if i["grade"] == g) for g, f in ((1, "L1"), (2, "L2"), (3, "L3"))})
        return r

    def view(self):
        p = self.present(); return {"assign": dict(self.assign), "issues": busplan.check(self.assign, p, self.rated()), "present": sorted(p), "names": busplan.NAME, "default": busplan.DEFAULT, "by": self.by, "t": self.t}

    def change(self, b, who):
        """op: set(node, bus) · auto(고칠 수 있는 약점을 고친다) · reset(기본 구성). 반환: {ok, msg, bus}"""
        op = b.get("op"); a = dict(self.assign)
        if op == "set":
            if b.get("node") not in busplan.NODES or b.get("bus") not in ("A", "B"): return {"ok": False, "why": "이름 또는 모선 오류"}
            a[b["node"]] = b["bus"]; msg = f"모선 구성: {busplan.NAME[b['node']]} → 모선 {b['bus']}"
        elif op == "auto":
            a, done = busplan.auto(a, self.present(), self.rated())
            if not done: return {"ok": False, "why": "자동으로 고칠 것이 없습니다"}
            msg = "모선 구성 자동 보완: " + ", ".join(done)
        elif op == "reset": a = dict(busplan.DEFAULT); msg = "모선 구성을 기본으로 되돌림"
        else: return {"ok": False, "why": f"동작 없음: {op}"}
        self.assign = a; self.by = who; self.t = wall_iso()
        try: fsio.write_json(self.path, {"assign": a, "by": who, "t": self.t})
        except OSError as e: msg += f" (저장 실패: {e})"
        self.apply(); self.eng.rt.note("모선", msg, actor=who); return {"ok": True, "msg": msg, "bus": self.view()}


def http_post(eng, b, sess):
    """POST /api/bus {op, …} — 엔지니어."""
    if sess.get("role") != "engineer": return {"ok": False, "why": "엔지니어 권한 필요(모선 구성은 전기 구성이다)"}
    with eng.lock: return eng.busw.change(b, sess["name"])
