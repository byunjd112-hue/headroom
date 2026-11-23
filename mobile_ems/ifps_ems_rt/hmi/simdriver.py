# -*- coding: utf-8 -*-
"""가상 장치 구동기: 시연 · 교육 · 시험용으로 가상 장치의 부하 · 태양광 · 기상 값을 움직인다(실장비 모드에서는 쓰지 않는다).
"""
import collections, math, random, time
from datetime import datetime, timedelta
from ifps_ems.solar import clear_pv_kw
from ifps_ems.dataio import sky_from_clearness as dataio_sky
from .engdefs import FEEDERS


# ───────────────────────────────── 가상 장치 구동(현장 부하·PV 변화 모사)
class SimDriver:
    LEAD = 1500                                   # 카메라가 미리 보는 시간(초): 하늘 전체를 보므로 태양을 가리기 전의 구름이 보인다

    def __init__(self, plant, site):
        self.p = plant; self.site = site; self.hold = {}; self.cloud = 0.9; self.run = True; self.t_last = time.time()
        self.ahead = collections.deque([0.9] * self.LEAD); self.sky = None        # 앞으로 올 구름(25분치)과 하늘 카메라가 보는 구름량(밤에는 None)
        self.scn = ""; self.extra_load = 0.0; self.err = ""; self.off_h = 0.0

    def _cloud_step(self, clear):
        """구름을 한 걸음 진행한다. 카메라가 보는 구름량은 15~25분 뒤 태양을 가릴 구름이다(밤에는 None)."""
        nxt = self.ahead[-1] + 0.02 * (0.85 - self.ahead[-1]) + random.gauss(0, 0.015); self.ahead.append(min(1.02, max(0.15, nxt))); self.cloud = self.ahead.popleft()
        far = list(self.ahead)[900:]; self.sky = dataio_sky(sum(far) / len(far)) if clear > 0.02 * self.site.pv_kwp else None

    def step(self):
        now = datetime.now() + timedelta(hours=self.off_h); hr = now.hour + now.minute / 60 + now.second / 3600; doy = now.timetuple().tm_yday
        day = 1 / (1 + math.exp(-(hr - 7.5) * 2)) * 1 / (1 + math.exp((hr - 18.5) * 2))
        p1 = 28 + random.gauss(0, 0.4)
        p2 = 22 + 18 * day + random.gauss(0, 0.8)
        p3 = 9 + 16 * day * (0.6 + 0.4 * math.sin(math.pi * max(0.0, min(1.0, (hr - 7) / 12)))) + random.gauss(0, 0.8) + self.extra_load
        clear = float(clear_pv_kw(self.site, doy, hr)); self._cloud_step(clear); pv = max(0.0, clear * self.cloud * (1 + random.gauss(0, 0.01)))
        if "PV.status" in self.p.by_tag:                                    # 인버터 분리 → 0, 출력 제한 적용. 여러 대면 대수만큼 더한다
            pv = sum(0.0 if self.p.get(f"{u}.status") < .5 else min(pv, self.p.get(f"{u}.lim_set") or 400.0) for u in self.p.us("PV"))
        temp = 16 + 7 * math.sin(2 * math.pi * (hr - 9) / 24) + random.gauss(0, 0.05)
        vals = {"LOAD.p1_kw": p1, "LOAD.p2_kw": p2, "LOAD.p3_kw": max(0.0, p3), "PV.kw": pv, "ENV.temp": temp,
                "ENV.press": 1012.5 + random.gauss(0, 0.05), "ENV.rh": 55 + random.gauss(0, 0.3)}
        cbo = lambda f: (self.p.get(f"CB.{f}") > 0.5 and self.p.get(f"CB.{f}") < 1.5) if f"CB.{f}" in self.p.by_tag else True
        for tag, f in (("LOAD.p1_kw", "L1"), ("LOAD.p2_kw", "L2"), ("LOAD.p3_kw", "L3"), ("PV.kw", "PV")):
            if not cbo(f): vals[tag] = 0.0; self.hold.pop(tag, None)                      # 차단기 개방·트립 → 급전 없음
        for k, v in vals.items():
            if k in self.hold: v = self.hold[k]
            if k in self.p.by_tag: self.p.set(k, v)
        tot = sum(vals[k] if not cbo(f) else self.hold.get(k, vals[k]) for k, f in (("LOAD.p1_kw", "L1"), ("LOAD.p2_kw", "L2"), ("LOAD.p3_kw", "L3")))
        self.p.set("LOAD.kw", self.hold.get("LOAD.kw", tot))
        self._consume()

    def _consume(self):
        """연료·수소 소비와 생산."""
        for u in self.p.us("DG"):                                              # 디젤 연료 소비(장치마다)
            if self.p.get(f"{u}.status") > 0.5 and f"{u}.fuel_l" not in self.hold: self.p.set(f"{u}.fuel_l", max(0.0, self.p.get(f"{u}.fuel_l") - 90 * 0.28 / 3600))
        if "ELZ.h2_rate" in self.p.by_tag and "H2.nm3" not in self.hold:
            self.p.set("H2.nm3", min(1000.0, self.p.get("H2.nm3") + sum(self.p.get(f"{u}.h2_rate") for u in self.p.us("ELZ") if self.p.get(f"{u}.status") > .5) / 3600))
        fc_kw = sum(self.p.get(f"{u}.kw") for u in self.p.us("FC"))
        if fc_kw > 0 and "H2.nm3" not in self.hold:
            self.p.set("H2.nm3", max(0.0, self.p.get("H2.nm3") - fc_kw * 0.75 / 3600))

    def loop(self):
        while self.run:
            try: self.step()
            except Exception as e:                      # 가상 장치 구동 실패는 기록만 하고 계속(시험용 기능)
                self.err = f"{type(e).__name__}: {e}"
            time.sleep(1.0)

    def trip(self, f, code):
        """급전선 고장: 보호 IED가 차단기를 트립(2)하고 보호 요소 코드를 남긴 상태를 모사."""
        self.p.set(f"CB.{f}", 2); self.p.set(f"FLT.{f}", code)

    def scenario(self, name):
        self.scn = name
        if name == "load_surge": self.extra_load = 60.0
        elif name == "cloud": self.hold["PV.kw"] = max(0.0, self.p.get("PV.kw") * 0.3)
        elif name == "night": self.hold["PV.kw"] = 0.0
        elif name == "soc_low": self.p.set("ESS.soc", 22.0)
        elif name == "soc_critical": self.p.set("ESS.soc", 17.0)
        elif name == "h2_low": self.p.set("H2.nm3", 130.0)
        elif name in ("fault_l3", "fault_dg", "fault_ess"):
            f, code = {"fault_l3": ("L3", 51), "fault_dg": ("DG", 87), "fault_ess": ("ESS", 64)}[name]; self.trip(f, code)
        elif name == "tie_open": self.p.set("CB.TIE", 0)
        elif name == "normal":
            self.hold.clear(); self.extra_load = 0.0; self.scn = ""
            for f in FEEDERS:
                if f"CB.{f}" in self.p.by_tag: self.p.set(f"CB.{f}", 1); self.p.set(f"FLT.{f}", 0)
            self.p.muted.clear(); self.p.no_ack.clear(); self.p.down.clear()
            for d in ("DG", "FC", "ELZ", "PV"):
                if f"{d}.mode" in self.p.by_tag: self.p.set(f"{d}.mode", 0)
        else: raise ValueError(f"시나리오 없음: {name}")
