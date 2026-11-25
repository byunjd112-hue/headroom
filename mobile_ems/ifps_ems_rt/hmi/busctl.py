# -*- coding: utf-8 -*-
"""모선 구성 — 화면부 연결. 구성을 상태 폴더(bus.json)에 두고, 바뀌면 가상 장치(모선 전압 계산)에 알린다. 스냅샷의 bus 로 나가 결선도 · 시나리오 구성도 · 개요가 같이 쓴다.
계산과 점검은 ifps_ems_rt/busplan.py. 바꾸는 것은 엔지니어 권한이다(전기 구성)."""
import json, os
from .. import busplan, fleet, fsio
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

    def units(self):
        """여러 대인 종류의 장치 이름들: {종류: [ESS, ESS2 …]} — 인식한(가져온) 장치만. 호기마다 모선을 따로 정할 수 있다."""
        fl = self.eng.rt.fleet; out = {}
        for k in ("PV", "DG", "FC", "ESS"):
            us = [n for n in fl.slots.get(k, []) if n in fl.live_now.get(k, [])]
            if len(us) > 1: out[k] = us
        if "DG" in out: out["G1"] = [fleet.g1_cb(n) for n in out["DG"]]      # 복합전력 차량마다 ESS 가 따로다(G1 · G1_2 …) — 차량마다 모선을 고른다
        return out

    def sides(self):
        """구간분전함마다 평소에 받는 모선: 상시 개방점 앞쪽은 모선 A(급전 A), 뒤쪽은 모선 B(급전 B). 반환: ({구간분전함: 모선}, 환망 순서의 이름들)"""
        rg = self.eng.ringw.status() if getattr(self.eng, "ringw", None) is not None else None
        order = [f["id"] for f in (rg or {}).get("fsu", [])]; op = (rg or {}).get("open", len(order))
        return {f: ("A" if k < op else "B") for k, f in enumerate(order)}, order

    def loads(self):
        """부하 하나하나와 물린 모선(그 구간분전함이 평소에 받는 쪽)."""
        lw = getattr(self.eng, "loadw", None); side = self.sides()[0]
        if lw is None: return []
        return [{"id": i["id"], "name": i["name"] + (f" ×{i['n']}" if i["n"] > 1 else ""), "n": i["n"], "grade": i["grade"], "rated": i["rated"], "fsu": i["fsu"], "fsu_name": i["fsu_name"], "bus": side.get(i["fsu"], "")} for i in lw.view()["items"] if i["n"] > 0 and i["fsu"]]

    def label(self, n):
        """기록 · 안내에 쓰는 이름: 같은 종류가 여러 대면 호기를 붙인다."""
        k = busplan.kind_of(n); us = self.units().get(k, [])
        return f"{busplan.NAME[k]} {us.index(n) + 1}호기" if n in us else busplan.unit_name(n)

    def sources(self, p):
        """전원 한 대 한 대: [{id, name, bus, present}] — 같은 종류가 여러 대면 호기로 나눈다."""
        us = self.units(); out = []
        for k in busplan.SOURCES:
            names = us.get(k, [k])
            for n, u in enumerate(names, 1): out.append({"id": u, "kind": k, "name": busplan.NAME[k] + (f" {n}호기" if len(names) > 1 else ""), "bus": busplan.bus_of(self.assign, u), "present": k in p})
        return out

    def view(self):
        p = self.present(); us = self.units(); ld = self.loads(); kw = {b: {} for b in ("A", "B")}; a = dict(self.assign)
        for x in ld:
            if x["bus"]: kw[x["bus"]][x["grade"]] = kw[x["bus"]].get(x["grade"], 0.0) + x["rated"]
        for g in (1, 2, 3):                                               # 등급 급전선의 모선(결선도 · 시나리오 구성도용)은 그 등급 부하가 더 많이 물린 쪽
            if kw["A"].get(g, 0.0) or kw["B"].get(g, 0.0): a[f"L{g}"] = "A" if kw["A"].get(g, 0.0) >= kw["B"].get(g, 0.0) else "B"
        self.load_kw = kw if ld else None
        extra = [{"id": u, "kind": k, "name": busplan.unit_name(u), "bus": busplan.bus_of(self.assign, u), "own": u in self.assign} for k, v in us.items() for u in v[1:]]
        return {"assign": a, "issues": busplan.check(self.assign, p, self.rated(), us, self.load_kw), "present": sorted(p), "names": busplan.NAME, "default": busplan.DEFAULT, "units": extra, "sources": self.sources(p), "loads": ld, "by": self.by, "t": self.t}

    def move_load(self, b, who):
        """부하 하나를 다른 모선으로: 그 모선 쪽 구간분전함 가운데 출력 회로가 가장 많이 남고 상시 개방점에 가까운 곳으로 옮긴다(부하 관리의 구간분전함 선택과 같은 일)."""
        side, order = self.sides(); lw = self.eng.loadw; it = next((i for i in self.loads() if i["id"] == b.get("id")), None)
        if it is None or b.get("bus") not in ("A", "B"): return {"ok": False, "why": "부하 또는 모선 오류"}
        if it["bus"] == b["bus"]: return {"ok": False, "why": "이미 그 모선에 있습니다"}
        cand = [f for f in order if side[f] == b["bus"]]
        if not cand: return {"ok": False, "why": f"모선 {b['bus']} 쪽에 구간분전함이 없습니다(상시 개방점 위치를 확인)"}
        used = {f: sum(i["need"] for i in lw.view()["items"] if i["fsu"] == f) for f in cand}; op = next((k for k, f in enumerate(order) if side[f] == "B"), len(order))
        f = min(cand, key=lambda f: (used[f], abs(order.index(f) - op + (0.5 if b["bus"] == "A" else -0.5))))
        r = lw.change({"op": "set", "id": it["id"], "fsu": f}, who)
        return {"ok": True, "msg": f"{it['name']} → 모선 {b['bus']}(구간분전함 {f[3:]})", "bus": self.view()} if r["ok"] else r

    def change(self, b, who):
        """op: set(node, bus — 전원 한 대) · load(id, bus — 부하 하나) · follow(node) · auto(고칠 수 있는 약점을 고친다) · reset(기본 구성). 반환: {ok, msg, bus}"""
        op = b.get("op"); a = dict(self.assign)
        if op == "load": return self.move_load(b, who)
        if op == "set":
            n = b.get("node"); sl = self.eng.rt.fleet.slots; known = n in busplan.NODES or (isinstance(n, str) and busplan.UNIT.match(n) and (n in sl.get(busplan.kind_of(n), []) or n in [fleet.g1_cb(d) for d in sl.get("DG", [])]))
            if not known or b.get("bus") not in ("A", "B"): return {"ok": False, "why": "이름 또는 모선 오류"}
            for u in self.units().get(n, [])[1:]: a.setdefault(u, busplan.bus_of(a, u))      # 한 대씩 고른다: 첫 장비를 바꿔도 같은 종류의 다른 호기는 지금 모선에 그대로
            a[n] = b["bus"]; msg = f"모선 구성: {self.label(n)} → 모선 {b['bus']}"
        elif op == "follow":                                              # 추가 장비를 다시 종류의 모선을 따르게
            if b.get("node") not in a or b.get("node") in busplan.NODES: return {"ok": False, "why": "따로 정한 값이 없습니다"}
            del a[b["node"]]; msg = f"모선 구성: {busplan.unit_name(b['node'])} → 종류의 모선을 따름"
        elif op == "auto":
            a, done = busplan.auto(a, self.present(), self.rated(), self.units(), getattr(self, "load_kw", None))
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
