# -*- coding: utf-8 -*-
"""환망 감시를 화면부에 잇는다: 감시 주기마다 구간분전함(FSU)·휴대용 배전체계(PPDU-20) 상태 판단과 경보, 초기 기동 점검(ID 차례 확인),
자리마다 읽은 ID 로 배치를 스스로 알아내 화면을 구성(조작 없음), 현장에서 고르는 배전체계 구성(회로별 시설·부하 등급, 중요 부하) 저장, 가상 장치 모드의 환망 모형.
계산은 ifps_ems_rt/ring.py 가 한다. 여기서는 값을 넘기고 결과를 화면·경보·설정 파일로 옮긴다.
"""
import json, time
from .. import ring
from . import cfgedit

EDIT = ("at", "name")                           # 운용자가 현장에서 고칠 수 있는 배전체계(PPDU) 항목 — 회로별 이름·등급은 따로 다룬다


class RingWatch:
    def __init__(self, eng):
        self.r = ring.settings(eng.cfg.get("ring")); self.model = None; self.last = None; self.keys = set(); self.sig = None; self.hold = 0; self.on = set()
        if self.r and eng.sim and eng.plant is not None: self.model = ring.Model(self.r, eng.plant)

    def _lost(self, eng):
        return eng.rt.lm.state.get("MTR") in ("두절", "재조회 대기")

    def step(self, eng):
        """감시 주기마다: (가상 장치면 환망을 한 걸음 움직이고) 상태를 판단해 경보를 올리고 내린다."""
        if self.r is None: return
        if self.model is not None: self.model.tick(time.monotonic())
        self.last = ring.status(self.r, eng.rt.val, self._lost(eng)); keys = set(); self._recognized(eng); quiet = self.hold > 0; self.hold = max(0, self.hold - 1)
        for key, on, prio, src, text in ring.alarms(self.r, self.last):
            keys.add(key)
            if not (quiet and on and key not in self.on): eng.alarms.set(key, bool(on), prio, src, text)      # 배치가 막 바뀐 동안에는 새 경보를 올리지 않는다(값이 한 주기 엇갈려 읽힐 수 있다)
            if not on: self.on.discard(key)
            elif not quiet: self.on.add(key)
        for key in self.keys - keys: eng.alarms.set(key, False, 3, "환망", ""); self.on.discard(key)     # 빠진 장치의 경보는 내린다
        self.keys = keys

    def _recognized(self, eng):
        """자동 인식한 배치가 달라지면 기록에 남긴다(화면은 조작 없이 따라 바뀐다)."""
        s = self.last; units = s["fsu"] + s["ppdu"]
        if not s["recog"]["auto"] or any(u["id_read"] is None for u in units): return
        sig = tuple((u["id"], u["id_read"], u.get("at")) for u in units)
        if sig != self.sig: self.sig = sig; self.hold = 3; eng.rt.note("환망", f"장치 자동 인식: 구간분전함 {len(s['fsu'])}대 · 배전체계 {len(s['ppdu'])}대 — 화면을 이 배치로 구성")

    def status(self):
        return self.last

    def view(self, eng):
        """환망 화면이 받는 것: 상태 + 초기 기동 점검 결과 + 구성."""
        if self.r is None: return {"ok": False, "why": "환망을 쓰지 않습니다(runtime.json 의 ring)"}
        st = ring.status(self.r, eng.rt.val, self._lost(eng))
        return {"ok": True, "status": st, "discover": ring.discover(self.r, eng.rt.val, self._lost(eng)), "config": {k: v for k, v in st["eff"].items() if k != "empty"}, "spec": {"rated_kw": ring.RATED_KW, "gnd_limit": ring.GND_LIMIT, "ch": [{"type": t, "kw": k} for t, k in ring.CH_SPEC]}, "sim": bool(self.model),
                "sim_break": sorted(self.model.brk) if self.model else [], "sim_swap": self.model.swap if self.model else None, "sim_place": {k: sorted(v) for k, v in self.model.place.items()} if self.model else None}

    def _save(self, eng, new, who, what):
        """runtime.json 의 ring 을 바꿔 쓰고(이전 판 보관) 바로 적용한다."""
        bad = []; ring.check(new, bad)
        if bad: return {"ok": False, "why": " / ".join(bad[:3])}
        ed = eng.cfged; synced = ed.loaded["runtime"] == cfgedit._sha(ed._text("runtime"))                   # pylint: disable=protected-access
        with open(eng.cfg_path, encoding="utf-8") as f: full = json.load(f)
        full["ring"] = new; ed._write("runtime", json.dumps(full, ensure_ascii=False, indent=1) + "\n")        # pylint: disable=protected-access
        if synced: ed.loaded["runtime"] = cfgedit._sha(ed._text("runtime"))                                   # pylint: disable=protected-access — 바로 적용되므로 '재기동 필요'로 보이지 않게
        eng.cfg["ring"] = new; self.r = ring.settings(new)
        if self.model is not None: self.model.r = self.r
        eng.rt.note("설정", f"환망 구성 저장: {what}", actor=who); return {"ok": True}

    def _entry(self, new, e):
        """아는 장치 목록에서 그 ID 의 배전체계를 찾는다. 없으면 새로 넣는다(가득 찼으면 지금 없는 것 하나를 비운다)."""
        for p in new["ppdu"]:
            if p.get("code") == e["code"]: return p
        here = {x["code"] for x in self.last["ppdu"]}
        if len(new["ppdu"]) >= ring.MAX_PPDU: new["ppdu"].remove(next(p for p in new["ppdu"] if p.get("code") not in here))
        used = {p["id"] for p in new["ppdu"]}; names = [f["id"] for f in new["fsu"]]
        p = {"id": next(f"PPDU{k}" for k in range(1, 99) if f"PPDU{k}" not in used), "code": e["code"], "at": e["at"] if e.get("at") in names else names[0], "name": e["name"], "ch": [dict(c) for c in e["ch"]]}
        new["ppdu"].append(p); return p

    def _targets(self, new, by):
        """고칠 대상: [(목록의 항목, 화면에서 온 값, 붙는 곳을 고칠 수 있는지)]. 자동 인식이면 지금 그 자리에 있는 장치의 ID 로 목록 항목을 찾는다."""
        eff = self.last["eff"] if self.last else self.r
        if not eff.get("eff"): return [(p, by[p["id"]], True) for p in new["ppdu"] if p["id"] in by]
        return [(self._entry(new, e), by[e["id"]], not e.get("at_auto")) for e in eff["ppdu"] if e["id"] in by and e.get("seen")]

    def _open_slot(self, i):
        """화면의 구간 번호(지금 배치 기준) → 설정에 적는 자리 번호."""
        eff = self.last["eff"] if self.last else self.r
        if not eff.get("eff"): return i
        if not 0 <= i < len(ring.sw_tags(eff)): raise ValueError("상시 개방점 구간 번호 오류")
        t = ring.sw_tags(eff)[i]; return 0 if t == "RING.sw0" else int(t[3:-3])

    def configure(self, eng, b, who):
        """배전체계(PPDU) 구성(운용자): 이름 · 회로별 시설 이름과 부하 등급(1등급이 있으면 중요 부하) · (자동으로 알 수 없을 때만) 붙는 FSU. 구성은 장치 ID 를 따라간다."""
        if self.r is None: raise ValueError("환망을 쓰지 않습니다")
        by = {p["id"]: p for p in b.get("ppdu", []) if isinstance(p, dict)}; new = json.loads(json.dumps({k: v for k, v in self.r.items() if k not in ("eff", "empty")})); n = 0
        for p, src, at_ok in self._targets(new, by):
            for k in EDIT:
                if k in src and src[k] != p.get(k) and (k != "at" or at_ok): p[k] = str(src[k])[:30]; n += 1
            for i, c in enumerate(src.get("ch") or []):                                  # 회로마다 물린 시설 이름과 부하 등급(0 = 환상 연결용·미사용)
                if i < len(p["ch"]) and isinstance(c, dict):
                    new_c = {"name": str(c.get("name", p["ch"][i]["name"]))[:20], "cls": int(c.get("cls", p["ch"][i]["cls"]))}
                    if new_c != p["ch"][i]: p["ch"][i] = new_c; n += 1
        if "open" in b and self._open_slot(int(b["open"])) != new["open"]: new["open"] = self._open_slot(int(b["open"])); n += 1
        return self._save(eng, new, who, f"배전체계 구성 {n}곳 변경") if n else {"ok": True, "same": True}

    def accept(self, eng, who):
        """초기 기동 점검에서 읽은 ID 를 그 자리의 기준 ID 로 삼는다(엔지니어). 응답이 없는 장치가 있으면 받지 않는다."""
        if self.r is None: raise ValueError("환망을 쓰지 않습니다")
        if self.r.get("auto", True): return {"ok": False, "why": "자동 인식을 쓰고 있어 확정할 것이 없습니다 — 읽은 ID 가 곧 그 자리의 장치입니다"}
        d = ring.discover(self.r, eng.rt.val, self._lost(eng)); rd = {x["id"]: x["read"] for x in d["rows"]}
        if any(x["state"] == "무응답" for x in d["rows"]): return {"ok": False, "why": "응답이 없는 장치가 있어 확정할 수 없습니다"}
        if len(set(rd.values())) != len(rd): return {"ok": False, "why": "같은 ID 를 가진 장치가 둘 이상입니다"}
        new = json.loads(json.dumps(self.r))
        for x in new["fsu"] + new["ppdu"]: x["code"] = rd[x["id"]]
        return self._save(eng, new, who, "초기 기동 점검에서 읽은 장치 ID 를 기준으로 확정")

    def _pair(self, b):
        """자리 바꿈 대상: 지금 놓여 있는 같은 종류 두 장치. 비우면 해제."""
        pair = (str(b["a"]), str(b["b"])) if b.get("a") and b.get("b") else None; here = [u["id"] for u in self.last["fsu"] + self.last["ppdu"]] if self.last else []
        if pair and (pair[0] not in here or pair[1] not in here or pair[0][:3] != pair[1][:3]): raise ValueError("자리 바꿈은 지금 놓여 있는 같은 종류 두 장치만")
        return pair

    def _sim_ppdu(self, b):
        """배전체계 고장 연습: 주 차단기·회로 트립, 접지저항."""
        i = str(b["id"]); tag = f"{i}.{b['what']}"
        if b["what"] not in ("mccb", "gnd") + tuple(f"ch{n}" for n in range(1, 7)) or tag not in self.model.p.by_tag: raise ValueError("배전체계 조작 대상 오류")
        self.model.p.set(tag, float(b["value"]))

    def sim(self, b):
        """가상 장치 모드의 환망 조작(연습용): 구간 단선 넣기·빼기, 두 장치의 자리 바꾸기, 장치 빼기·넣기·뒤섞기, 처음 상태로."""
        m = self.model
        if m is None: raise ValueError("가상 장치 모드가 아닙니다")
        a = b.get("action")
        if a == "break": (m.brk.add if b.get("on", True) else m.brk.discard)(int(b["section"]))
        elif a == "swap": m.swap = self._pair(b)
        elif a == "auto": m.p.set("RING.auto", 1 if b.get("on", True) else 0)
        elif a == "switch": m.p.set(ring.sw_tags(m.eff())[int(b["section"])], int(b["state"]))
        elif a == "ppdu": self._sim_ppdu(b)
        elif a == "remove": m.remove(str(b["id"]))
        elif a == "add": m.add("fsu" if b.get("kind") == "fsu" else "ppdu", int(b.get("at", 0)))
        elif a == "shuffle": m.shuffle()
        elif a == "restore": m.restore()
        else: raise ValueError("환망 조작 종류 오류")
        return {"ok": True}


def http_post(eng, b, sess):
    """POST /api/ring — 배전체계 구성은 운용자, 고정 배치의 ID 확정과 가상 장치 조작은 엔지니어."""
    w = eng.ringw; kind = b.get("do"); who = sess["name"]
    if kind == "config": return w.configure(eng, b, who)
    if sess["role"] != "engineer": return {"ok": False, "why": "권한 필요: engineer"}
    if kind == "accept": return w.accept(eng, who)
    if kind == "sim":
        r = w.sim(b); eng.rt.note("시뮬레이터", f"환망 조작 {b.get('action')} {b.get('section', '')}".strip(), actor=who); return r
    raise ValueError("환망 요청 종류 오류")
