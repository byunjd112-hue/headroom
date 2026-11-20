# -*- coding: utf-8 -*-
"""AI 예측 기술자료·논문에 싣는 수치를 한 번에 잰다 → ai_paper_eval.json (문서 생성기가 그대로 읽는다. 손으로 고치지 않는다).

자료: 합성 현장 자료 120일(씨앗 고정). 앞 106일로 학습·보정, 뒤 14일로 시험(학습에 쓰지 않음). 2시간 간격으로 24시간 예측을 발행한다.
비교: 전일 같은 시각(기준선) / 릿지 회귀 / ＋하늘 카메라 / ＋주의집중.  오차: 부하는 평균 부하 대비, 태양광은 설비 용량 대비(낮 구간만).
  python docs/ppt/ai_paper_eval.py
"""
import json, os, sys, tempfile, time
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, "..", ".."))
from ifps_ems import dataio, learner, attn, nowcast
from ifps_ems.config import Site, HORIZON
from ifps_ems.forecast import LoadForecaster, PVForecaster, BUCKET, bucket_of

TEST_DAYS = 14


def evaluate(f, d, origins, kind, site, scale):
    """구간별 오차(%), 전체·2시간 이내 오차, 80% 구간 포함률, 기준선(전일 같은 시각) 오차."""
    E = [[] for _ in BUCKET]; B = [[] for _ in BUCKET]; cov = []
    for o in origins:
        p50, lo, hi, _ = f.predict(d, o); y = d[kind][o + 1:o + 1 + HORIZON]; base = d[kind][o + 1 - 96:o + 1 - 96 + HORIZON]
        ok = np.ones(HORIZON, bool) if kind == "load" else d["clear"][o + 1:o + 1 + HORIZON] > 0.05 * site.pv_kwp
        for h in range(HORIZON):
            if not ok[h]: continue
            b = bucket_of(h + 1); E[b].append(abs(p50[h] - y[h]) / scale); B[b].append(abs(base[h] - y[h]) / scale); cov.append(lo[h] <= y[h] <= hi[h])
    pc = lambda a: round(float(np.mean(a)) * 100, 2); al = sum(E, []); bl = sum(B, [])
    return {"by_h": [pc(e) for e in E], "base_by_h": [pc(e) for e in B], "nmae": pc(al), "base": pc(bl), "near": pc(E[0] + E[1]), "base_near": pc(B[0] + B[1]),
            "cov": round(float(np.mean(cov)) * 100, 1), "n": len(al)}


def sample_day(f, d, o, kind):
    p50, lo, hi, _ = f.predict(d, o); r = lambda a: [round(float(x), 1) for x in a]
    return {"issued": d["ts"][o], "p50": r(p50), "lo": r(lo), "hi": r(hi), "act": r(d[kind][o + 1:o + 1 + HORIZON]), "past": r(d[kind][o - 47:o + 1])}


def viz(fp, dtr, d, o, site):
    """입체 그림용 실제 값: ① 릿지 회귀(1시간 이내 구간)의 학습 표본·예측값과 두 특징에 대한 단면 평면  ② 한 발행 시점의 주의집중 가중치와 기억의 위치."""
    rng = np.random.default_rng(0); m = fp.models[0]; X, Y, _ = fp._samples(dtr, range(fp.MIN_O, dtr["n"] - 97, 3)); X = np.array(X[0]); Y = np.array(Y[0])
    pick = rng.choice(len(Y), size=min(260, len(Y)), replace=False); J1, J2 = 5, 18                                # 특징: 최근 1시간 청천 지수, 구름량(카메라)
    coef = m.w[1:] / m.sd; c0 = float(m.w[0] - np.sum(coef * m.mu) + np.sum(np.delete(coef, [J1, J2]) * np.delete(X.mean(0), [J1, J2])))
    ridge = {"x1": "최근 1시간 청천 지수", "x2": "구름량(카메라)", "a": round(float(coef[J1]), 4), "b": round(float(coef[J2]), 4), "c": round(c0, 4), "lam": m.lam, "n_fit": int(len(Y)), "n_w": int(len(m.w)),
             "pts": [[round(float(X[i, J1]), 3), round(float(X[i, J2]), 3), round(float(Y[i]), 3), round(float(m.predict(X[i])[0]), 3)] for i in pick]}
    r = fp._idx(d); q = attn.context(d, o, r, site.pv_kwp); K, V, O = attn.memory(d, r, site.pv_kwp, HORIZON); Q = fp.att._query(d, o, r, site.pv_kwp)
    w = fp.att._weights(Q[0], Q[3], 0)[0]; w = w / w.sum(); s = fp.att.s[0]; ax = [int(i) for i in np.argsort(-s)[:3]]
    z = lambda v: [round(float((v[k] - fp.att.mu[k]) / fp.att.sd[k] * s[k]), 3) for k in ax]                       # 중요도를 곱한 표준화 좌표(가중 거리의 주된 3축)
    top = [int(i) for i in np.argsort(-w)[:120]]; ok = np.nonzero(Q[3][0] > 0)[0]; rest = [int(i) for i in rng.choice(ok, size=min(380, len(ok)), replace=False) if int(i) not in top]
    mem = [z(K[i]) + [round(float(w[i]) * 100, 3), None if not np.isfinite(V[i, 3]) else round(float(V[i, 3]), 3), d["ts"][int(O[i])]] for i in top + rest]
    att = {"axes": [attn.NAMES[k] for k in ax], "s": [round(float(s[k]), 2) for k in ax], "q": z(q), "issued": d["ts"][o], "mem": mem, "n_ok": int(len(ok)),
           "pred_1h": round(float(fp.att.predict(d, o, r, site.pv_kwp)[3]), 3), "act_1h": None if not np.isfinite(r[o + 4]) else round(float(r[o + 4]), 3)}
    return {"ridge": ridge, "att": att}


def bench(site):
    """독립 시험(tools/forecast_benchmark.py 결과 — 시드별 98일 학습·8일 가중치 선택·14일 시험, 합성 카메라 열 제외)을 문서용으로 간추린다.
    구간은 두 방식으로 잰 결과를 함께 싣는다: 학습 때 한 번 보정(static) / 운용처럼 매일 보정 + 변동 여유(daily)."""
    rd = lambda n: json.load(open(os.path.join(HERE, "..", n), encoding="utf-8")); B = rd("forecast_benchmark.json"); S = rd("forecast_benchmark_static.json")
    stat = {(r["seed"], k): t for r in S["runs"] for k, t in r["targets"].items()}; rows = []
    for r in B["runs"]:
        for k, t in r["targets"].items():
            b, e = t["baseline"], t["enhanced"]; s0 = stat.get((r["seed"], k))
            rows.append({"seed": r["seed"], "kind": k, "w": t["weights"][:3], "bias": t["bias"], "scale": t["interval_scale_mean"], "ms": t["median_ms"],
                         "nmae": {h: [b[h]["nmae_pct"], e[h]["nmae_pct"]] for h in ("15m", "1h", "4h", "24h")}, "cov": {h: [b[h]["coverage_pct"], e[h]["coverage_pct"]] for h in ("15m", "1h", "4h", "24h")},
                         "cov24_static": None if s0 is None else s0["enhanced"]["24h"]["coverage_pct"]})
    agg = {}
    for k in ("load", "pv"):
        rr = [x for x in rows if x["kind"] == k]; cut = [100 * (1 - x["nmae"]["15m"][1] / x["nmae"]["15m"][0]) for x in rr]
        agg[k] = {"n": len(rr), "cut15_min": round(min(cut), 1), "cut15_max": round(max(cut), 1), "cut15_mean": round(float(np.mean(cut)), 1), "used": sum(any(x["w"]) for x in rr),
                  "nmae15": [round(float(np.mean([x["nmae"]["15m"][i] for x in rr])), 2) for i in (0, 1)], "nmae1h": [round(float(np.mean([x["nmae"]["1h"][i] for x in rr])), 2) for i in (0, 1)],
                  "nmae24": [round(float(np.mean([x["nmae"]["24h"][i] for x in rr])), 2) for i in (0, 1)],
                  "cov24": [round(min(x["cov"]["24h"][1] for x in rr), 1), round(max(x["cov"]["24h"][1] for x in rr), 1), round(float(np.mean([x["cov"]["24h"][1] for x in rr])), 1)],
                  "cov24_static": [round(min(x["cov24_static"] for x in rr), 1), round(max(x["cov24_static"] for x in rr), 1), round(float(np.mean([x["cov24_static"] for x in rr])), 1)],
                  "scale": [round(min(x["scale"] for x in rr), 2), round(max(x["scale"] for x in rr), 2)]}
    # 결합 함수의 응답면: 기존 예측 100 kW, 실측 참조와의 차이 −50~+50 kW, 선행 15분~4시간. 첫 시드에서 채택된 가중치를 실제 nowcast.blend 에 넣어 계산한다.
    surf = {}; diffs = list(range(-50, 51, 10))
    for k in ("load", "pv"):
        w = next(x["w"] for x in rows if x["kind"] == k) + [0.0, 0.0, 0.0]; grid = []
        for dk in diffs:
            p = np.full(HORIZON, 100.0); mid, _, _ = nowcast.blend(p, p - 10, p + 10, p + dk, np.ones(HORIZON, bool), w, k, site); grid.append([round(float(v - 100.0), 2) for v in mid[:16]])
        surf[k] = {"w": w[:3], "diffs": diffs, "grid": grid}
    return {"fit_days": B["fit_days"], "tune_days": B["tune_days"], "test_days": B["test_days"], "origins": B["runs"][0]["test_origins"], "seeds": [r["seed"] for r in B["runs"]], "rows": rows, "agg": agg, "surface": surf}


def main():
    site = Site(); td = tempfile.mkdtemp(); p = os.path.join(td, "a.csv"); dataio.gen_sample(site, p); d = dataio.load_csv(p, site); n = d["n"]
    ntr = n - TEST_DAYS * 96; dtr = learner.cut(d, ntr); origins = list(range(ntr, n - HORIZON - 1, 8)); mean_l = float(np.mean(d["load"][ntr:]))
    out = {"data": {"days": n // 96, "train_days": ntr // 96, "test_days": TEST_DAYS, "issues": len(origins), "kwp": site.pv_kwp, "mean_load": round(mean_l, 1), "buckets": [b / 4 for b in BUCKET]}}
    t0 = time.time(); fl = LoadForecaster(site).fit(dtr); t_load = time.time() - t0; out["load"] = evaluate(fl, d, origins, "load", site, mean_l)
    pv = []
    for name, kw in (("릿지 회귀", {"use_sky": False, "use_att": False}), ("＋하늘 카메라", {"use_sky": True, "use_att": False}), ("＋하늘 카메라＋주의집중", {})):
        t0 = time.time(); f = PVForecaster(site, **kw).fit(dtr); sec = time.time() - t0; e = evaluate(f, d, origins, "pv", site, site.pv_kwp); e.update(name=name, sec=round(sec, 1), alpha=[float(a) for a in f.alpha]); pv.append(e)
    out["pv"] = pv; fp = f; K, V, O = attn.memory(dtr, fp._idx(dtr), site.pv_kwp, HORIZON); imp = fp.att.importance()
    out["att"] = {"memories": int(len(O)), "features": attn.NF, "names": list(attn.NAMES), "s_near": [round(float(x), 2) for x in fp.att.s[0]], "s_far": [round(float(x), 2) for x in fp.att.s[1]], "top_near": imp[0], "top_far": imp[1]}
    day = [o for o in origins if 9.5 <= d["hour"][o] <= 10.5]; o = day[len(day) // 2]                       # 오전 10시쯤 발행한 예측 하나를 그림용으로 남긴다
    out["sample"] = {"load": sample_day(fl, d, o, "load"), "pv": sample_day(fp, d, o, "pv"), "refs": fp.att.explain(d, o, fp._idx(d), site.pv_kwp, top=5)}
    w = fp.att._query(d, o, fp._idx(d), site.pv_kwp); ww = fp.att._weights(w[0], w[3], 0)[0]; ww = np.sort(ww / ww.sum())[::-1]
    out["sample"]["weights"] = [round(float(x) * 100, 2) for x in ww[:40]]; out["sample"]["top10_share"] = round(float(ww[:10].sum()) * 100, 1); out["sample"]["eff_n"] = round(float(1.0 / np.sum(ww ** 2)), 1)
    out["viz"] = viz(fp, dtr, d, o, site); out["bench"] = bench(site); out["viz"]["nowcast"] = out["bench"].pop("surface")
    dataio.save_model(os.path.join(td, "l.npz"), fl); dataio.save_model(os.path.join(td, "p.npz"), fp)
    t0 = time.time(); fl.predict(d, n - 200); fp.predict(d, n - 200); t_pred = time.time() - t0
    out["cost"] = {"train_load_s": round(t_load, 1), "train_pv_s": pv[-1]["sec"], "predict_s": round(t_pred, 2), "load_kb": round(os.path.getsize(os.path.join(td, "l.npz")) / 1024, 1), "pv_kb": round(os.path.getsize(os.path.join(td, "p.npz")) / 1024, 1),
                   "params_ridge": int(sum(len(m.w) for m in fp.models if m is not None)), "params_att": int(fp.att.s.size), "params_alpha": len(BUCKET)}
    with open(os.path.join(HERE, "ai_paper_eval.json"), "w", encoding="utf-8") as fo: json.dump(out, fo, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k not in ("sample",)}, ensure_ascii=False)[:2400])


if __name__ == "__main__":
    main()
