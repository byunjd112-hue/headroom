# 오프라인 학습 예측의 표본 외 평가: 앞 98일로 학습·보정, 뒤 22일로 시험. 기준선(전일 동시각)과 비교. 예측 계획 vs 규칙 운전 모의.
import json, os, sys, tempfile, time
import numpy as np
sys.path.insert(0, sys.argv[1])
from ifps_ems import dataio, dispatch as dp
from ifps_ems.config import Site, HORIZON, DT_H
from ifps_ems.forecast import LoadForecaster, PVForecaster, BUCKET, bucket_of
site = Site(); d = dataio.load_csv(os.path.join(sys.argv[1], "results/sample_site_data.csv"), site); n = d["n"]; NTR = 98 * 96
def cut(d, m):
    return {k: (v[:m] if hasattr(v, "__len__") and len(v) == d["n"] else v) for k, v in d.items() if not k.startswith("_")} | {"n": m}
dtr = cut(d, NTR); fl, fp = LoadForecaster(site), PVForecaster(site)
t0 = time.time(); fl.fit(dtr); fp.fit(dtr); t_train = time.time() - t0
td = tempfile.mkdtemp(); dataio.save_model(os.path.join(td, "l.npz"), fl); dataio.save_model(os.path.join(td, "p.npz"), fp)
size_kb = [round(os.path.getsize(os.path.join(td, f)) / 1024, 1) for f in ("l.npz", "p.npz")]
t0 = time.time(); fl.predict(d, n - 200); fp.predict(d, n - 200); t_pred = time.time() - t0
mean_l = float(np.mean(d["load"][NTR:])); kwp = site.pv_kwp
E = {k: {b: [] for b in range(len(BUCKET))} for k in ("l", "lb", "p", "pb")}; cl, cp, dl, dlb, dpv, dpb = [], [], [], [], [], []
issues = list(range(NTR, n - 97, 24))
for o in issues:
    a, alo, ahi, _ = fl.predict(d, o); b, blo, bhi, _ = fp.predict(d, o)
    yl = d["load"][o + 1:o + 97]; yp = d["pv"][o + 1:o + 97]; day = d["clear"][o + 1:o + 97] > 0.05 * kwp
    bl = np.array([d["load"][o + h - 96] for h in range(1, 97)]); bp = np.array([d["pv"][o + h - 96] for h in range(1, 97)])       # 기준선: 전일 동시각
    for h in range(96):
        bb = bucket_of(h + 1); E["l"][bb].append(abs(a[h] - yl[h]) / mean_l); E["lb"][bb].append(abs(bl[h] - yl[h]) / mean_l); cl.append(alo[h] <= yl[h] <= ahi[h])
        if day[h]: E["p"][bb].append(abs(b[h] - yp[h]) / kwp); E["pb"][bb].append(abs(bp[h] - yp[h]) / kwp); cp.append(blo[h] <= yp[h] <= bhi[h])
    dl.append(abs(a.sum() - yl.sum()) / yl.sum()); dlb.append(abs(bl.sum() - yl.sum()) / yl.sum()); dpv.append(abs(b.sum() - yp.sum()) / max(yp.sum(), 1)); dpb.append(abs(bp.sum() - yp.sum()) / max(yp.sum(), 1))
pct = lambda x: round(float(np.mean(x)) * 100, 2); allv = lambda e: sum(e.values(), [])
R = {"train_days": 98, "test_days": round((n - NTR) / 96, 1), "n_issue": len(issues), "n_train_rows": NTR, "t_train_s": round(t_train, 2), "t_pred_ms": round(t_pred * 1000, 1), "model_kb": size_kb,
     "n_feat": {"load": len(fl.features(d, 2000, 4)), "pv": len(fp.features(d, 2000, 4))}, "buckets": list(BUCKET),
     "load": {"nmae": pct(allv(E["l"])), "base": pct(allv(E["lb"])), "by_h": [pct(E["l"][b]) for b in range(6)], "base_by_h": [pct(E["lb"][b]) for b in range(6)], "cov": round(float(np.mean(cl)) * 100, 1), "day": pct(dl), "day_base": pct(dlb)},
     "pv": {"nmae": pct(allv(E["p"])), "base": pct(allv(E["pb"])), "by_h": [pct(E["p"][b]) for b in range(6)], "base_by_h": [pct(E["pb"][b]) for b in range(6)], "cov": round(float(np.mean(cp)) * 100, 1), "day": pct(dpv), "day_base": pct(dpb)}}
# 운전 모의(논리 모형): 시험 기간 전체, 실제 부하·태양광으로 진행. 계획은 1시간마다 예측으로 다시 세움
pl = dp.Planner(site); T0, T1 = NTR, n - 97
def run(policy_kind):
    soc, h2, dgp, fcp = 0.6, site.h2_nm3 * 0.7, 0, 0; fuel = shed = 0.0; starts = silent = 0; V = None; k = 0; shed12 = 0.0
    for t in range(T0, T1):
        hr = d["hour"][t]; lc = d["load_p"][t]
        if policy_kind == "rule": a = dp.rule_action(site, soc, h2, dgp, fcp, d["load"][t], d["pv"][t], hr)
        else:
            if V is None or k >= 4:
                o = t - 1
                if policy_kind == "plan": l50, _, lhi, _ = fl.predict(d, o); p50, plo, _, _ = fp.predict(d, o); lf = l50 + 0.5 * (lhi - l50); pf = np.clip(p50 - 0.5 * (p50 - plo), 0, None)
                else: lf = d["load"][t:t + 96].copy(); pf = d["pv"][t:t + 96].copy()            # 완전 예측(상한 참고)
                sh = d["load_p"][o + 1 - 96:o + 1]; sh = sh / np.maximum(sh.sum(1, keepdims=True), 1e-9); hrs = (d["hour"][o] + (1 + np.arange(96)) * 0.25) % 24
                V = pl.plan(lf, pf, lf[:, None] * sh, hrs); k = 0
            a = pl.act(V[k + 1], soc, h2, dgp, d["load"][t], d["pv"][t], lc, hr); k += 1
        soc2, h2b, short, _ = pl.step(np.array([soc]), h2, a, d["load"][t], d["pv"][t], lc)
        fuel += a[0] * site.dg_kw * DT_H * site.dg_l_per_kwh; starts += int(a[0] and not dgp); silent += int(a[0] and dp.silent_hour(hr)); s_ = float(short[0]); shed += s_ * DT_H; shed12 += max(0.0, s_ - lc[2]) * DT_H
        soc = float(np.clip(soc2[0], site.soc_min, site.soc_max)); h2 = float(np.clip(h2b, 0, site.h2_nm3)); dgp, fcp = a[0], a[1]
    days = (T1 - T0) / 96
    return {"fuel_l": round(fuel, 1), "fuel_l_day": round(fuel / days, 1), "dg_starts": starts, "dg_silent_h": round(silent * DT_H, 1), "shed_kwh": round(shed, 1), "shed12_kwh": round(shed12, 1), "soc_end": round(soc, 3), "h2_end": round(h2, 1), "days": round(days, 1)}
t0 = time.time(); R["sim"] = {"rule": run("rule"), "plan": run("plan"), "perfect": run("perfect")}; R["sim_s"] = round(time.time() - t0, 1)
json.dump(R, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1); print(json.dumps(R, ensure_ascii=False))
