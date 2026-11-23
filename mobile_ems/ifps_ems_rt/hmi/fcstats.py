# -*- coding: utf-8 -*-
"""예측 정밀도 화면용 통계: 마지막 7일을 6시간 간격으로 다시 예측해 보고(백테스트) 오차·구간 포함률을 낸다. 원래 측정된 값만 채점한다."""
import numpy as np
from ifps_ems import learner
from ifps_ems.forecast import BUCKET, bucket_of


def _score(pred, y, valid, scale, err, cov):
    """한 번의 예측을 선행시간 구간별 오차와 구간 포함 여부로 나눠 담는다."""
    p, lo, hi = pred
    for h in np.nonzero(valid)[0]:
        err[bucket_of(h + 1)].append(abs(p[h] - y[h]) / scale); cov.append(lo[h] <= y[h] <= hi[h])


def _daily(d):
    ts = d["ts"]; out = []
    for dd in sorted(set(t[:10] for t in ts))[-14:]:
        m = np.array([t.startswith(dd) for t in ts])
        out.append({"d": dd, "load": round(float(d["load"][m].sum() * 0.25), 1), "pv": round(float(d["pv"][m].sum() * 0.25), 1),
                    "clear": round(float(d["clear"][m].sum() * 0.25), 1), "peak": round(float(d["load"][m].max()), 1)})
    return out


def backtest(d, fl, fp, site, meta, stop=None):
    """반환: (정밀도 사전, 일별 발전·부하 목록)"""
    n = d["n"]; el = {b: [] for b in range(len(BUCKET))}; ep = {b: [] for b in range(len(BUCKET))}; cl = []; cp = []; mean_l = max(float(np.mean(d["load"][-7 * 96:])), 1e-6)
    day_l, day_p, pts = [], [], []
    for oo in range(n - 7 * 96 - 1, n - 97, 24):
        if stop is not None and stop(): raise InterruptedError("예측 계산 중단")      # EMS 가 멈추면 그만둔다
        a = learner.predict(fl, d, oo, "load", site, meta)[:3]; b = learner.predict(fp, d, oo, "pv", site, meta)[:3]; sl = slice(oo + 1, oo + 97)
        yl = d["load"][sl]; yp = d["pv"][sl]; valid_l = d["load_observed"][sl]; valid_p = d["pv_observed"][sl] & (d["clear"][sl] > 0.05 * site.pv_kwp)
        _score(a, yl, valid_l, mean_l, el, cl); _score(b, yp, valid_p, site.pv_kwp, ep, cp)
        load_total = float(yl[valid_l].sum()); pv_total = float(yp[valid_p].sum())
        if load_total > 0: day_l.append(abs(float(a[0][valid_l].sum()) - load_total) / load_total)
        if pv_total > 0: day_p.append(abs(float(b[0][valid_p].sum()) - pv_total) / pv_total)
        pts += [[float(a[0][h]), float(yl[h])] for h in range(0, 96, 8) if valid_l[h]]
    percent = lambda values, digits=2: round(float(np.mean(values)) * 100, digits) if values else None
    mk = lambda e: [percent(e[b]) for b in range(len(BUCKET))]
    acc = {"load_nmae": percent(sum(el.values(), [])), "pv_nmae": percent(sum(ep.values(), [])), "load_cov": percent(cl, 1), "pv_cov": percent(cp, 1),
           "load_day": percent(day_l), "pv_day": percent(day_p), "buckets": list(BUCKET), "load_by_h": mk(el), "pv_by_h": mk(ep), "n_issue": len(day_l), "scatter": pts[:400], "limit": 15.0}
    return acc, _daily(d)
