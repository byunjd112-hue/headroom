# -*- coding: utf-8 -*-
"""부하 관리 — 화면부 연결. 부하 목록을 상태 폴더(loads.json)에 두고, 바뀔 때마다 실행기(절감 가능 비율)와 가상 장치(부하 배율)에 알린다.
목록은 스냅샷의 loads 로 나가 부하 관리 · 개요 · 결선도 · 환망 · 운영 시나리오 화면이 같이 따라간다. 계산은 ifps_ems_rt/loads.py."""
import json, os, secrets
from .. import loads, fsio
from .engdefs import wall_iso


class LoadBook:
    def __init__(self, eng):
        self.eng = eng; self.path = os.path.join(eng.rt.state_dir, "loads.json"); self.rev = 0; self.by = ""; self.t = ""
        self.items = [dict(i) for i in (eng.cfg.get("loads") or loads.DEFAULT)]
        try:
            with open(self.path, encoding="utf-8") as f: o = json.load(f)
            if not loads.check(o.get("items")): self.items = o["items"]; self.rev = int(o.get("rev", 0)); self.by = str(o.get("by", "")); self.t = str(o.get("t", ""))
        except (OSError, ValueError, TypeError, AttributeError): pass
        if loads.check(self.items): self.items = [dict(i) for i in loads.DEFAULT]      # 설정의 목록이 틀렸으면 기본 목록으로
        self.apply()

    def limit(self):
        """급전선 계측 범위의 상한(대응표): {등급: kW, 0: 합계}"""
        hi = {p["tag"]: p["hi"] for p in self.eng.rt.pts}
        return {1: hi.get("LOAD.p1_kw"), 2: hi.get("LOAD.p2_kw"), 3: hi.get("LOAD.p3_kw"), 0: hi.get("LOAD.kw")}

    def apply(self):
        """실행기와 가상 장치에 알린다: 절감 가능 비율(자동 절감을 할지 · 얼마나 줄지), 가상 부하의 배율."""
        eng = self.eng; fr = loads.save_frac(self.items); eng.rt.load_frac = fr
        if eng.plant is not None: eng.plant.save_frac = dict(fr); eng.plant.load_scale = loads.scale(self.items)

    def change(self, b, who):
        """op: add(kind) · count(id, delta) · set(id, name · grade · kw · save_pct) · del(id) · reset. 반환: {ok, why | msg}"""
        op = b.get("op"); items = [dict(i) for i in self.items]; it = next((i for i in items if i["id"] == b.get("id")), None)
        if op == "add":
            k = b.get("kind")
            if k not in loads.KINDS: return {"ok": False, "why": "모르는 부하 종류"}
            nm, g, kw, sv, _ = loads.KINDS[k]; n = sum(1 for i in items if i["kind"] == k)
            it = {"id": "l" + secrets.token_hex(3), "kind": k, "name": nm + (f" {n + 1}" if n else ""), "grade": g, "kw": kw, "n": 1, "save_pct": sv}; items.append(it); msg = f"부하 추가: {it['name']}({g}등급 · {kw:.0f} kW)"
        elif op == "reset": items = [dict(i) for i in loads.DEFAULT]; msg = "부하 목록을 기본으로 되돌림"
        elif it is None: return {"ok": False, "why": "없는 부하"}
        elif op == "count": it["n"] = it["n"] + int(b.get("delta", 0)); msg = f"{it['name']} 수량 {it['n']}"
        elif op == "del": items.remove(it); msg = f"부하 삭제: {it['name']}"
        elif op == "set":
            for k in ("name", "grade", "kw", "save_pct"):
                if k in b: it[k] = b[k].strip() if k == "name" and isinstance(b[k], str) else b[k]
            if it["grade"] == 1 and "grade" in b and "save_pct" not in b: it["save_pct"] = 0
            msg = f"{it['name']} 변경: {it['grade']}등급 · 대당 {it['kw']:g} kW · 절감 {it['save_pct']:g}%"
        else: return {"ok": False, "why": f"동작 없음: {op}"}
        bad = loads.check(items, self.limit())
        if bad: return {"ok": False, "why": " / ".join(bad[:3])}
        self.items = items; self.rev += 1; self.by = who; self.t = wall_iso()
        try: fsio.write_json(self.path, {"rev": self.rev, "items": items, "by": who, "t": self.t}, indent=1)
        except OSError as e: msg += f" (저장 실패: {e} — 재기동하면 되돌아간다)"
        self.apply(); self.eng.rt.note("부하", msg, actor=who); return {"ok": True, "msg": msg, "loads": self.view()}

    def stage(self):
        """급전선별 공급 상태: on 공급 · save 절감 공급 · off 차단(개방 · 트립) · None 모름."""
        rt = self.eng.rt; out = {}
        for f in ("L1", "L2", "L3"):
            c = rt.val.get(f"CB.{f}"); out[f] = None if c is None else "off" if int(round(c)) != 1 else "save" if f in rt.feeder_save else "on"
        return out

    def view(self):
        rt = self.eng.rt; st = self.stage(); kw = {"L1": rt.val.get("LOAD.p1_kw"), "L2": rt.val.get("LOAD.p2_kw"), "L3": rt.val.get("LOAD.p3_kw")}
        est = loads.share(self.items, kw, st); r = loads.rated(self.items); fr = loads.save_frac(self.items)
        items = [dict(i, feeder=loads.FEEDER[i["grade"]], rated=round(i["kw"] * i["n"], 1), est_kw=None if est[i["id"]] is None else round(est[i["id"]], 1), spr=loads.KINDS[i["kind"]][4]) for i in self.items]
        grades = [{"grade": g, "feeder": f, "rated": round(r[g], 1), "kw": kw[f], "stage": st[f], "n": sum(i["n"] for i in self.items if i["grade"] == g), "save_frac": round(fr.get(f, 0.0), 3),
                   "auto": "save" if f in rt.shedder.saved else "shed" if f in rt.shedder.mine else "", "why": rt.shedder.why.get(f, "")} for g, f in loads.FEEDER.items()]
        return {"rev": self.rev, "by": self.by, "t": self.t, "items": items, "grades": grades, "limit": self.limit(),
                "kinds": [{"id": k, "name": v[0], "grade": v[1], "kw": v[2], "save_pct": v[3]} for k, v in loads.KINDS.items()], "max_n": loads.MAX_N, "max_items": loads.MAX_ITEMS}


def http_post(eng, b, sess):
    """POST /api/loads {op, …} — 운용자."""
    with eng.lock: return eng.loadw.change(b, sess["name"])
