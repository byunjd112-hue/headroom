# -*- coding: utf-8 -*-
"""예측·운전계획 연결. 실행기(Runtime)의 policy 자리에 넣는다.

쌓인 15분 자료(history.csv)와 학습 모델로 24시간 예측을 내고 동적계획법으로 전원 투입을 정한다.
매시간 다시 계획하고, 그 사이에는 계산해 둔 가치함수에서 현재 실측 상태에 맞는 결정을 고른다.
자료가 모자라거나 연산이 실패하면 규칙 운전으로 넘어간다(supervisor.guarded와 같은 원칙).
"""
import os, time
from threading import RLock
import numpy as np
from ifps_ems import dataio, dispatch as dp
from ifps_ems.config import HORIZON
from ifps_ems.forecast import LoadForecaster, PVForecaster

from ifps_ems import learner
MIN_ROWS = 8 * 96                       # 예측 특징에 필요한 최소 이력(8일)


class PlanPolicy:
    """demo_csv: 실측 이력이 모자랄 때 대신 쓸 합성 자료(가상 장치 시연 전용). 실장치 운전에서는 주지 않는다 — 이력이 쌓일 때까지 규칙 운전한다."""

    def __init__(self, site, hist_csv, model_dir, days_since_deploy=30, demo_csv=None, clock=time.monotonic):
        self.site, self.hist, self.demo = site, hist_csv, demo_csv; self.md = model_dir; self._lock = RLock(); self.reload()
        self.pl = dp.Planner(site); self.kappa = dp.kappa_for(days_since_deploy); self.clock = clock
        self.V = None; self.k = 0; self.rows = 0; self.fc = None; self.note = ""; self.t_plan = None; self.src = ""; self.sh = None

    def reload(self):
        """적용 중인 예측 모델을 다시 읽는다(지속 학습이 새 모델을 적용했을 때)."""
        with self._lock:
            self.fl, self.fp = LoadForecaster(self.site), PVForecaster(self.site)
            dataio.load_model(os.path.join(self.md, "model_load.npz"), self.fl); dataio.load_model(os.path.join(self.md, "model_pv.npz"), self.fp)
            self.meta = learner.active(self.md); self.t_plan = None

    def _history(self):
        """쓸 이력을 고른다: 실측이 8일 이상이면 실측, 아니면 시연용 합성 자료(있을 때만)."""
        d = dataio.load_csv(self.hist, self.site) if os.path.exists(self.hist) else {"n": 0}
        if d["n"] >= MIN_ROWS: self.src = "실측 이력"; return d
        if self.demo and os.path.exists(self.demo):
            d2 = dataio.load_csv(self.demo, self.site)
            if d2["n"] >= MIN_ROWS: self.src = "시연용 합성 이력"; return d2
        raise ValueError(f"이력 {d['n']}행 < {MIN_ROWS}행")

    def replan(self, hr=None):
        d = self._history(); o = d["n"] - 1
        if hr is not None:                                               # 기준 줄을 현재 시각대와 맞춘다(합성 자료·오래된 이력의 시각 어긋남 방지)
            q = int(hr * 4) % 96; same = np.nonzero((np.round(d["hour"] * 4).astype(int) % 96) == q)[0]; same = same[same >= MIN_ROWS - 1]
            if len(same): o = int(same[-1])
        l50, _, lhi, _ = learner.predict(self.fl, d, o, "load", self.site, self.meta); p50, plo, _, _ = learner.predict(self.fp, d, o, "pv", self.site, self.meta)
        lf = l50 + self.kappa * (lhi - l50); pf = np.clip(p50 - self.kappa * (p50 - plo), 0, None)       # 보수적 수급: 부하는 높게, PV는 낮게
        sh = d["load_p"][max(0, o + 1 - HORIZON):o + 1]; sh = sh / np.maximum(sh.sum(1, keepdims=True), 1e-9)
        if len(sh) < HORIZON: sh = np.vstack([np.tile(sh[:1], (HORIZON - len(sh), 1)), sh])
        hrs = (d["hour"][o] + (1 + np.arange(HORIZON)) * 0.25) % 24
        self.V = self.pl.plan(lf, pf, lf[:, None] * sh, hrs); self.k = 0; self.rows = d["n"]; self.sh = sh; self.t_plan = self.clock()
        self.fc = {"load": l50, "load_hi": lhi, "pv": p50, "pv_lo": plo}

    def __call__(self, val, hr):
        with self._lock:
            g = lambda k, dflt=0.0: val.get(k, dflt)
            try:
                if self.V is None or self.t_plan is None or self.clock() - self.t_plan >= 3600.0: self.replan(hr)                 # 1시간마다 다시 계획
                else: self.k = min(int((self.clock() - self.t_plan) // 900), HORIZON - 1)                   # 그 사이는 15분 칸을 따라간다
                lp = np.array([g("LOAD.p1_kw"), g("LOAD.p2_kw"), g("LOAD.p3_kw")])
                a = self.pl.act(self.V[self.k + 1], g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), g("LOAD.kw"), g("PV.kw"), lp, hr)
                self.note = f"계획 운전({self.src})"; return a
            except Exception as e:                                           # 어떤 실패든 운전은 이어 간다
                self.note = f"계획 실패({type(e).__name__}: {e}) → 규칙 운전"
                return dp.rule_action(self.site, g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), int(g("FC.status")), g("LOAD.kw"), g("PV.kw"), hr)
