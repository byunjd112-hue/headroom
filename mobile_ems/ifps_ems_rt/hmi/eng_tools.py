# -*- coding: utf-8 -*-
"""엔지니어 도구: 레지스터 읽기 · 쓰기, 가상 장치 조작, 배치도 저장.Engine(hmi/engine.py)의 한 부분이다 — 기능별로 파일을 나눈 것이며 메서드는 Engine 의 것으로 쓴다.
"""
import json, math, os, time
from datetime import datetime
from .. import fleet, fsio
from .. import modbus as mb
from .engdefs import FEEDERS, wall_iso


class ToolsMixin:
    """Engine 에 섞어 쓰는 묶음(자체 상태는 없다 — self 는 Engine 이다)."""

    # ── 디버그: 레지스터 탐색기
    def _client(self, q):
        if q.get("host"):
            return mb.Client(q["host"], int(q.get("port", 502)), int(q.get("unit", 1)), float(self.cfg.get("timeout_s", 0.5)), self.cfg["allow"]), True
        lk = self.rt.links[q["dev"]]; return lk.cl[q.get("path", "A")], False

    def mb_read(self, q):
        fc = int(q.get("fc", 3)); addr = int(q.get("addr", 0)); n = int(q.get("count", 10))
        cl, tmp = self._client(q)
        if tmp: cl.tag = ("직접", f"{cl.host}"); cl.trace = self._tracer(cl)
        t0 = time.monotonic()
        try:
            regs = cl.read_bits(addr, n, fc) if fc in (1, 2) else cl.read(addr, n, fc)
            rtt = round((time.monotonic() - t0) * 1000, 2)
        finally:
            if tmp: cl.close()
        tags = {}
        if not tmp:
            for p in self.rt.pts:
                if p["device"] == q["dev"] and p["fc"] == fc: tags[p["addr"]] = p["tag"]
        return {"ok": True, "fc": fc, "addr": addr, "regs": regs, "tags": {str(k): v for k, v in tags.items()}, "rtt": rtt}

    def mb_write(self, q, who):
        fc = int(q.get("fc", 6)); addr = int(q["addr"]); vals = [int(x) for x in q["values"]]
        if not vals or fc not in (5, 6, 16): raise ValueError("쓰기 값 없음 또는 기능 코드 오류(5/6/16)")
        if not 0 <= addr <= 0xFFFF or any(not 0 <= v <= 0xFFFF for v in vals): raise ValueError("주소·값은 0~65535")
        cl, tmp = self._client(q)
        if tmp: cl.tag = ("직접", f"{cl.host}"); cl.trace = self._tracer(cl)
        try:
            if fc == 5: cl.write_coil(addr, bool(vals[0]))
            elif fc == 6: cl.write(addr, vals[:1])
            else: cl.write(addr, vals, fc=16)
        finally:
            if tmp: cl.close()
        tgt = q.get("host") or f"{q['dev']}/{q.get('path', 'A')}"
        self.rt.note("엔지니어링", f"레지스터 쓰기 {tgt} fc{fc} @{addr} = {vals}", actor=who)
        return {"ok": True}

    # ── 디버그: 가상 장치 고장 주입
    SIM_HOLD = ("LOAD.p1_kw", "LOAD.p2_kw", "LOAD.p3_kw", "PV.kw", "LOAD.kw", "ENV.temp", "ENV.press", "ENV.rh", "DG.fuel_l", "H2.nm3")

    def _sim_set(self, q):
        tag = q["tag"]; val = float(q["value"]); p = self.plant
        if tag not in p.by_tag: raise ValueError(f"점 없음: {tag}")
        if q.get("hold", True) and tag in self.SIM_HOLD: self.simdrv.hold[tag] = val
        p.set(tag, val)

    def _sim_feeder(self, q):
        f = q["target"]
        if f not in FEEDERS: raise ValueError(f"급전선 없음: {f}")
        if q["action"] == "fault": self.simdrv.trip(f, int(q.get("code", 51)))
        else: self.plant.set(f"CB.{f}", 1 if q.get("on", True) else 0); self.plant.set(f"FLT.{f}", 0)

    def _sim_clock(self, hour):
        """시연용 모의 시각: 가상 장치(태양광·부하)와 EMS 시간대 판단을 같은 시각으로 옮긴다. hour 가 없으면 실제 시각으로 되돌린다."""
        off = 0.0
        if hour is not None:
            h = float(hour); now = datetime.now()
            if not (math.isfinite(h) and 0 <= h < 24): raise ValueError("시각은 0 이상 24 미만")
            off = h - (now.hour + now.minute / 60)
        self.simdrv.off_h = off; self.rt.hr_off = off

    def _sim_unit(self, tgt, on):
        """같은 종류 장치를 놓거나 뺀다(자동 인식 연습)."""
        if tgt not in self.plant.units or not fleet.kind(tgt): raise ValueError("놓고 뺄 수 있는 장치가 아님")
        (self.plant.gone.discard if on else self.plant.gone.add)(tgt)

    def _sim_grid(self, out):
        """상전 정전·복전."""
        p = self.plant
        if "CB.GRID" not in p.by_tag: raise ValueError("수전점 계측이 없음")
        p.set("CB.GRID", 0 if out else 1); p.set("FLT.GRID", 27 if out else 0)

    def sim_action(self, q, who):
        if not self.sim: raise ValueError("가상 장치 모드가 아님")
        a = q["action"]; p = self.plant; tgt = q.get("target"); on = q.get("on", True)
        flags = {"mute": p.muted, "noack": p.no_ack, "down": p.down}
        if a in flags: (flags[a].add if on else flags[a].discard)(tgt)
        elif a == "unit": self._sim_unit(tgt, on)
        elif a == "manual": p.set(f"{tgt}.mode", 1 if on else 0)
        elif a == "set": self._sim_set(q)
        elif a == "release": self.simdrv.hold.pop(q["tag"], None)
        elif a == "clock": self._sim_clock(q.get("hour"))
        elif a == "scenario" and q["name"] in ("grid_outage", "grid_restore"): self._sim_grid(q["name"] == "grid_outage")
        elif a == "scenario": self.simdrv.scenario(q["name"])
        elif a in ("fault", "cb"): self._sim_feeder(q)
        else: raise ValueError(f"동작 없음: {a}")
        self.rt.note("시뮬레이터", f"고장 주입 {a} {tgt or q.get('tag') or q.get('name') or ''} {q.get('on', '')}".strip(), actor=who)
        return {"ok": True, "sim": self.sim_state()}

    # ── 작전지 배치(운용자 편집): state/layout.json. 장비 대수·막사 수량·위치·연결 급전선
    LAYOUT_KINDS = {"DG", "ESS", "PV", "FC", "DIST", "EMS", "FSU", "L1", "L2", "L3", "BARRACK"}

    LAYOUT_BINDS = {"", "G1", "ESS", "PV", "FC", "DIST", "EMS", "L1", "L2", "L3"}

    def layout(self):
        pth = os.path.join(self.rt.state_dir, "layout.json")
        if os.path.exists(pth):
            try:
                with open(pth, encoding="utf-8") as f: return json.load(f)
            except (OSError, ValueError):
                pass
        return {"rev": 0, "items": None}                                       # None → 화면 기본 배치

    def save_layout(self, lay, who):
        items = lay.get("items")
        if not isinstance(items, list) or not 1 <= len(items) <= 120: raise ValueError("배치 항목 수 오류(1~120)")
        clean, uids = [], set()
        for it in items:
            k, b = str(it.get("kind", "")), str(it.get("bind", ""))
            if k not in self.LAYOUT_KINDS: raise ValueError(f"장비 종류 오류: {k}")
            if b not in self.LAYOUT_BINDS: raise ValueError(f"연결 급전선 오류: {b}")
            x, y = float(it["x"]), float(it["y"])
            if not (0 <= x <= 1600 and 0 <= y <= 900): raise ValueError("배치 좌표 범위 밖")
            uid = str(it.get("uid", ""))[:24] or f"u{len(clean)}"
            if uid in uids: raise ValueError(f"중복 식별자 {uid}")
            uids.add(uid); clean.append({"uid": uid, "kind": k, "bind": b, "name": str(it.get("name", ""))[:24], "x": round(x, 1), "y": round(y, 1)})
        old = self.layout(); rev = int(old.get("rev", 0)) + 1
        out = {"rev": rev, "items": clean, "by": who, "t": wall_iso()}
        fsio.write_json(os.path.join(self.rt.state_dir, "layout.json"), out, indent=1)
        cnt = {}
        for it in clean: cnt[it["kind"]] = cnt.get(it["kind"], 0) + 1
        self.rt.note("배치", f"작전지 배치 변경 rev{rev}: " + ", ".join(f"{k}×{v}" for k, v in sorted(cnt.items())), actor=who)
        return {"ok": True, "rev": rev}

    def reset_layout(self, who):
        pth = os.path.join(self.rt.state_dir, "layout.json")
        if os.path.exists(pth): os.replace(pth, pth + ".bak")
        self.rt.note("배치", "작전지 배치 기본값 복원(이전 배치는 layout.json.bak)", actor=who); return {"ok": True}
