# -*- coding: utf-8 -*-
"""예측·운전계획 연결. 실행기(Runtime)의 policy 자리에 넣는다.

쌓인 15분 자료(history.csv)와 학습 모델로 24시간 예측을 내고 동적계획법으로 전원 투입을 정한다.
매시간 다시 계획하고, 그 사이에는 계산해 둔 가치함수에서 현재 실측 상태에 맞는 결정을 고른다.
자료가 모자라거나 연산이 실패하면 규칙 운전으로 넘어간다(supervisor.guarded와 같은 원칙).
"""
import os
import numpy as np
from ifps_ems import dataio, dispatch as dp
from ifps_ems.config import HORIZON
from ifps_ems.forecast import LoadForecaster, PVForecaster

MIN_ROWS = 8 * 96                       # 예측 특징에 필요한 최소 이력(8일)


class PlanPolicy:
    def __init__(self, site, hist_csv, model_dir, days_since_deploy=30):
        self.site, self.hist = site, hist_csv; self.fl, self.fp = LoadForecaster(site), PVForecaster(site)
        dataio.load_model(os.path.join(model_dir, "model_load.npz"), self.fl); dataio.load_model(os.path.join(model_dir, "model_pv.npz"), self.fp)
        self.pl = dp.Planner(site); self.kappa = dp.kappa_for(days_since_deploy)
        self.V = None; self.k = 0; self.rows = 0; self.fc = None; self.note = ""

    def replan(self):
        d = dataio.load_csv(self.hist, self.site)
        if d["n"] < MIN_ROWS: raise ValueError(f"이력 {d['n']}행 < {MIN_ROWS}행")
        o = d["n"] - 1; l50, llo, lhi, _ = self.fl.predict(d, o); p50, plo, phi, _ = self.fp.predict(d, o)
        lf = l50 + self.kappa * (lhi - l50); pf = np.clip(p50 - self.kappa * (p50 - plo), 0, None)       # 보수적 수급: 부하는 높게, PV는 낮게
        sh = d["load_p"][-HORIZON:]; sh = sh / sh.sum(1, keepdims=True)
        hrs = (d["hour"][-1] + (1 + np.arange(HORIZON)) * 0.25) % 24
        self.V = self.pl.plan(lf, pf, lf[:, None] * sh, hrs); self.k = 0; self.rows = d["n"]; self.sh = sh
        self.fc = {"load": l50, "load_hi": lhi, "pv": p50, "pv_lo": plo}

    def __call__(self, val, hr):
        g = lambda k, dflt=0.0: val.get(k, dflt)
        try:
            rows = sum(1 for _ in open(self.hist, encoding="utf-8")) - 1
            if self.V is None or rows - self.rows >= 4: self.replan()                                   # 15분 자료 4개(1시간)마다 다시 계획
            else: self.k = min(rows - self.rows, HORIZON - 1)
            lp = np.array([g("LOAD.p1_kw"), g("LOAD.p2_kw"), g("LOAD.p3_kw")])
            a = self.pl.act(self.V[self.k + 1], g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), g("LOAD.kw"), g("PV.kw"), lp, hr)
            self.note = "계획 운전"; return a
        except Exception as e:                                           # 어떤 실패든 운전은 이어 간다
            self.note = f"계획 실패({type(e).__name__}: {e}) → 규칙 운전"
            return dp.rule_action(self.site, g("ESS.soc", 60.0) / 100, g("H2.nm3", self.site.h2_nm3 * 0.7), int(g("DG.status")), int(g("FC.status")), g("LOAD.kw"), g("PV.kw"), hr)
