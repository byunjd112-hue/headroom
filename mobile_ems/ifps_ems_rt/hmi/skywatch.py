# -*- coding: utf-8 -*-
"""하늘 카메라 연결: 정해진 경로의 최신 하늘 사진에서 구름량을 읽어 실행기에 넘긴다(15분 이력의 sky 열 → 태양광 예측 입력).

실장치: 카메라(또는 카메라 PC)가 runtime.json 의 skycam.path 에 최신 사진을 계속 덮어쓴다. TPCS 는 읽기만 한다.
가상 장치: 모의 구름 상태로 하늘 그림을 만들어 같은 경로에 쓴다(카메라 흉내) — 읽는 쪽은 실장치와 같은 코드다.
사진이 없거나 오래됐거나 야간이면 값을 비워 둔다. 그때 예측은 발전 실적·기온·기압·습도만으로 계산한다(카메라 고장이 예측을 멈추지 않는다).
"""
import os, time
import numpy as np
from ifps_ems import skycam
from ifps_ems.solar import clear_pv_kw

DEFAULTS = {"enabled": True, "path": "", "max_age_s": 180.0, "period_s": 10.0}


class SkyWatch:
    def __init__(self, eng):
        self.cfg = dict(DEFAULTS, **(eng.cfg.get("skycam") or {})); self.on = bool(self.cfg["enabled"])
        p = self.cfg["path"] or os.path.join(eng.rt.state_dir, "skycam.png")
        self.path = p if os.path.isabs(p) else os.path.join(os.path.dirname(os.path.abspath(eng.cfg_path)), p) if self.cfg["path"] else p
        self.cam = skycam.SkyCam(self.path, self.cfg["max_age_s"]); self.t = 0.0; self.last = {"ok": False, "why": "사용 안 함" if not self.on else "아직 읽지 않음"}

    def _simulate(self, drv):
        """가상 장치: 모의 구름량으로 하늘 그림을 만들어 쓴다(밤에는 어두운 그림)."""
        img = np.full((120, 160, 3), 12, dtype=np.uint8) if drv.sky is None else skycam.render(drv.sky, seed=int(time.time() // 600))
        skycam.write_png(self.path, img)

    def step(self, eng):
        if not self.on or time.time() - self.t < float(self.cfg["period_s"]): return
        self.t = time.time()
        try:
            if eng.simdrv: self._simulate(eng.simdrv)
        except OSError as e:
            eng.simdrv.err = f"하늘 그림 쓰기 실패: {e}"
        self.last = self.cam.read(); c = self.last.get("cover") if self.last.get("ok") else None
        eng.rt.sky = float("nan") if c is None else float(c)
        now = eng.rt.wall(); hr = now.hour + now.minute / 60.0; site = eng.rt.site
        day = float(clear_pv_kw(site, now.timetuple().tm_yday, hr)) > 0.05 * site.pv_kwp
        bad = day and not self.last.get("ok") and "야간" not in self.last.get("why", "")
        eng.alarms.set("skycam", bad, 3, "TPCS", f"하늘 카메라 사진을 쓸 수 없음({self.last.get('why', '')}) — 카메라 없이 예측(발전 실적·기온·기압·습도만 사용)")

    def status(self):
        s = self.last; c = s.get("cover") if s.get("ok") else None
        return {"on": self.on, "ok": bool(s.get("ok")), "cover": None if c is None else round(100.0 * c, 0), "why": s.get("why", ""), "t": s.get("t")}

    def image(self):
        """최신 사진(PNG 바이트). 없으면 None"""
        try:
            with open(self.path, "rb") as f: return f.read() if self.path.lower().endswith(".png") else None
        except OSError: return None
