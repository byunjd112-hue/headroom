# -*- coding: utf-8 -*-
"""부하 관리 — 화면부 연결. 부하 목록을 상태 폴더(loads.json)에 두고, 바뀔 때마다 실행기(절감 가능 비율)와 가상 장치(부하 배율)에 알린다.
목록은 스냅샷의 loads 로 나가 부하 관리 · 개요 · 결선도 · 환망 · 운영 시나리오 화면이 같이 따라간다. 계산은 ifps_ems_rt/loads.py."""
import json, os, secrets
from .. import loads, fsio, ring
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
        rw = getattr(eng, "ringw", None)
        if rw is not None and rw.model is not None: rw.model.branch = self.branch; rw.model.want = self.want      # 가상 장치: 분기 전력계와 배전체계의 자리 · 대수가 부하 목록을 따른다

    def where(self):
        """부하마다 물린 자리(지금 인식한 환망 배치 기준). 반환: (자리, 배전체계 목록, 구간분전함 목록)"""
        rg = self.eng.ringw.status() if getattr(self.eng, "ringw", None) is not None else None
        pp = [{"id": p["id"], "name": p["name"], "at": p["at"]} for p in (rg or {}).get("ppdu", [])]; ff = [{"id": f["id"], "name": f["name"]} for f in (rg or {}).get("fsu", [])]
        return loads.attach(self.items, pp, ff, ring.RATED_KW, ring.FSU_KW, ring.FSU_OUT), pp, ff

    def want(self):
        """부하 목록대로 배전체계를 놓을 자리(loads.plan) — 가상 장치가 이대로 놓는다. 실장비에서는 실제로 놓은 장치를 ID 로 알아낸다."""
        rg = self.eng.ringw.status() if getattr(self.eng, "ringw", None) is not None else None
        return loads.plan(self.items, (rg or {}).get("fsu", []), ring.RATED_KW, ring.FSU_OUT)

    def branch(self):
        """분기별 몫(loads.weights) — 환망의 분기 전력계 · 중요 부하 표시가 쓴다."""
        return loads.weights(self.items, self.where()[0], self.stage())

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
        items = [dict(i) for i in self.items]
        try: items, msg = _edit(items, b)
        except ValueError as e: return {"ok": False, "why": str(e)}
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
        at, pp, ff = self.where()
        items = [dict(i, feeder=loads.FEEDER[i["grade"]], rated=round(i["kw"] * i["n"], 1), est_kw=None if est[i["id"]] is None else round(est[i["id"]], 1), spr=loads.KINDS[i["kind"]][4],
                      **{k: at[i["id"]][k] for k in ("fsu", "fsu_name", "ppdu", "ppdu_name", "ppdus", "need")}, fsu_auto=at[i["id"]]["auto"], fsu_over=at[i["id"]]["over"], out_over=at[i["id"]]["out_over"]) for i in self.items]
        grades = [{"grade": g, "feeder": f, "rated": round(r[g], 1), "kw": kw[f], "stage": st[f], "n": sum(i["n"] for i in self.items if i["grade"] == g), "save_frac": round(fr.get(f, 0.0), 3),
                   "auto": "save" if f in rt.shedder.saved else "shed" if f in rt.shedder.mine else "", "why": rt.shedder.why.get(f, "")} for g, f in loads.FEEDER.items()]
        return {"rev": self.rev, "by": self.by, "t": self.t, "items": items, "grades": grades, "limit": self.limit(), "ppdus": pp, "fsus": ff, "ring_rated": round(sum(i["rated"] for i in items if i["fsu"]), 1), "ppdu_need": sum(i["need"] for i in items), "ppdu_have": len(pp), "ppdu_slots": int((self.eng.cfg.get("ring") or {}).get("ppdu_slots", ring.DEFAULT["ppdu_slots"])), "ppdu_kw": ring.RATED_KW, "fsu_kw": ring.FSU_KW, "fsu_a": ring.FSU_A, "fsu_out": ring.FSU_OUT,
                "kinds": [{"id": k, "name": v[0], "grade": v[1], "kw": v[2], "save_pct": v[3]} for k, v in loads.KINDS.items()], "max_n": loads.MAX_N, "max_items": loads.MAX_ITEMS}


def _add(items, k):
    """종류의 기본값(등급 · 정격 · 절감 비율)으로 새 부하 한 줄을 넣는다."""
    if k not in loads.KINDS: raise ValueError("모르는 부하 종류")
    nm, g, kw, sv, _ = loads.KINDS[k]; n = sum(1 for i in items if i["kind"] == k)
    it = {"id": "l" + secrets.token_hex(3), "kind": k, "name": nm + (f" {n + 1}" if n else ""), "grade": g, "kw": kw, "n": 1, "save_pct": sv}
    return items + [it], f"부하 추가: {it['name']}({g}등급 · {kw:.0f} kW)"


def _place(items, b):
    """개요 배치도를 저장할 때: 그림을 옮긴 자리에서 가장 가까운 구간분전함(at: {부하: 구간분전함})과 고친 이름(names: {부하: 이름})을 부하 목록에 반영한다."""
    at, names = b.get("at") or {}, b.get("names") or {}; done = []
    if not isinstance(at, dict) or not isinstance(names, dict): raise ValueError("형식 오류")
    for it in items:
        if it["id"] in at and it.get("fsu", "") != at[it["id"]]: it["fsu"] = at[it["id"]]; done.append(f"{it['name']} → {at[it['id']]}")
        if it["id"] in names and isinstance(names[it["id"]], str) and names[it["id"]].strip() and names[it["id"]].strip() != it["name"]: done.append(f"{it['name']} 이름 → {names[it['id']].strip()}"); it["name"] = names[it["id"]].strip()
    if not done: raise ValueError("바뀐 것이 없음")
    return items, "개요 배치 반영: " + ", ".join(done[:6]) + (" …" if len(done) > 6 else "")


def _edit(items, b):
    """목록에 한 가지 변경을 한다. 반환: (새 목록, 기록할 글). 할 수 없으면 ValueError."""
    op = b.get("op"); it = next((i for i in items if i["id"] == b.get("id")), None)
    if op == "add": return _add(items, b.get("kind"))
    if op == "reset": return [dict(i) for i in loads.DEFAULT], "부하 목록을 기본으로 되돌림"
    if op == "place": return _place(items, b)
    if it is None: raise ValueError("없는 부하")
    if op == "count": it["n"] = it["n"] + int(b.get("delta", 0)); return items, f"{it['name']} 수량 {it['n']}"
    if op == "del": items.remove(it); return items, f"부하 삭제: {it['name']}"
    if op != "set": raise ValueError(f"동작 없음: {op}")
    for k in ("name", "grade", "kw", "save_pct", "fsu"):
        if k in b: it[k] = b[k].strip() if k == "name" and isinstance(b[k], str) else b[k]
    if it["grade"] == 1 and "grade" in b and "save_pct" not in b: it["save_pct"] = 0
    return items, f"{it['name']} 변경: {it['grade']}등급 · 대당 {it['kw']:g} kW · 절감 {it['save_pct']:g}%" + (f" · 구간분전함 {it['fsu'] or '자동'}" if "fsu" in b else "")


def http_post(eng, b, sess):
    """POST /api/loads {op, …} — 운용자."""
    with eng.lock: return eng.loadw.change(b, sess["name"])
