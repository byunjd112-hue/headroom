# -*- coding: utf-8 -*-
"""날씨 입력 반영(장병의 휴대폰 날씨 수기 입력 · 군 통신망 날씨 자료)의 효과를 합성 자료로 잰다 → wx_eval.json (기술자료에 그대로 싣는다).

방법: 합성 현장 자료 120일 가운데 마지막 21일을 빼고 태양광 예측 모델을 학습한다. 그 21일을 시간 순서대로 지나가며 1시간마다 24시간 예측을 내고,
      제품과 같은 코드(ifps_ems_rt/weather.py)로 날씨 기록을 섞어 낮 시간 실측과 견준다(설비 용량 대비 평균 절대 오차 %). 반영 비율과 표기별 보정도 제품처럼 그때그때 실측으로 정한다.
날씨 입력을 흉내 내는 법(가정):
  · 작전지 수기: 하루 세 번(07 · 12 · 17시) 날씨 앱을 보고 넣는다. 07 · 12시에는 '지금부터 6시간', 17시에는 '내일 하루'.
      앱의 표기는 그 기간의 실제 평균 구름에 가장 가까운 다섯 가지(맑음 ~ 흐림) 가운데 하나이고, 앱 예보가 한 칸 어긋날 확률을 오늘 25% · 내일 35% 로 둔다.
  · 주둔지 통신망: 6시간마다 앞으로 24시간의 시간별 운량(0~10)을 받는다. 오차는 표준편차 1.0 + 0.05 × 선행시간(시간).
비교: ① AI 만 ② 단순 섞기(환산표 그대로, 비율 30% 고정) ③ 보완한 방식(선행시간별 비율을 실측으로 정함 + 날씨 표기별 실측 보정).
주의: 합성 자료의 결과다. 합성 자료는 날씨가 하루 단위로 맑음 · 구름 · 흐림 사이를 오가게 만든 것이라 '내일 날씨'가 실제로 정보가 된다. 앱 · 통신망 예보의 오차 크기는 가정이다.
      실제 효과는 현장에서 화면의 '견준 오차'로 다시 확인해야 한다.
  python docs/ppt/wx_eval.py
"""
import json, os, sys, tempfile
from datetime import datetime, timedelta
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from ifps_ems import dataio, learner
from ifps_ems.config import Site
from ifps_ems.forecast import PVForecaster
from ifps_ems_rt import weather as wx

HOLD_DAYS = 21
CATS = ("맑음", "대체로 맑음", "구름 조금", "대체로 흐림", "흐림")
BUCKETS = ((4, "1시간 이내"), (12, "1~3시간"), (24, "3~6시간"), (96, "6~24시간"))


def _label(k_mean, rng, p_err):
    """실제 평균 구름 계수에 가장 가까운 표기. p_err 확률로 한 칸 어긋난다(앱 예보의 오차)."""
    c = wx.cloud_of(min(1.0, k_mean)); i = min(range(len(CATS)), key=lambda q: abs(wx.SKY[CATS[q]] - c))
    if rng.random() < p_err: i = min(len(CATS) - 1, max(0, i + (1 if rng.random() < 0.5 else -1)))
    return CATS[i]


def entries(kind, ts, kt, day, o0, n, rng):
    """날씨 입력 목록: [(넣은 시각의 칸 번호, [기록 …])] — 넣은 시각 순."""
    out = []; mean = lambda a, b: float(np.mean(kt[a:b][day[a:b]])) if day[a:b].any() else None
    for i in range(o0, n):
        t = ts[i]
        if kind == "수기" and t.minute == 0 and t.hour in (7, 12, 17):
            a, b = (i, min(n, i + 24)) if t.hour != 17 else (i + 28, min(n, i + 28 + 96)); m = mean(a, b)          # 17시에는 내일 0~24시
            if m is not None and a < n: out.append((i, [wx.record(ts[a], ts[a] + timedelta(minutes=15 * (b - a)), sky=_label(m, rng, 0.25 if t.hour != 17 else 0.35), at=t)]))
        if kind == "통신망" and t.minute == 0 and t.hour % 6 == 0:
            recs = []
            for h in range(24):
                a = i + 4 * h; m = mean(a, min(n, a + 4))
                if m is not None: recs.append(wx.record(ts[a], ts[a] + timedelta(hours=1), cloud=float(np.clip(wx.cloud_of(min(1.0, m)) + rng.normal(0, 1.0 + 0.05 * h), 0, 10)), src="통신망", at=t))
            if recs: out.append((i, recs))
    return out


def run(d, site, fp, kind, mode, seed):
    """한 번의 평가. mode: 'plain'(환산표 그대로 · 비율 30% 고정) 또는 'full'(선행시간별 비율 + 표기별 보정). 반환: 오차 모음."""
    n = d["n"]; o0 = n - HOLD_DAYS * 96; rng = np.random.default_rng(seed); kwp = site.pv_kwp; pv, clear = d["pv"], d["clear"]
    ts = [datetime.strptime(t, wx.FMT) for t in d["ts"]]; day = clear > 0.05 * kwp; cal0 = wx.calibrate(list(pv[:o0]), list(clear[:o0]), kwp)
    kt = np.where(day, pv / np.maximum(clear * cal0, 1e-9), 0.0); ents = entries(kind, ts, kt, day, o0, n, rng); ptr = 0; book = wx.Book(); score = wx.Score()
    err = {b: {"ai": [], "wx": [], "mix": []} for b, _ in BUCKETS}; cover = [0, 0]
    for o in range(o0, n - 97, 4):
        while ptr < len(ents) and ents[ptr][0] <= o: book.add(ents[ptr][1], replace_src="통신망" if kind == "통신망" else None); ptr += 1
        score.settle({d["ts"][i]: (float(pv[i]), bool(day[i])) for i in range(max(0, o - 200), o + 1)}, d["ts"][o])
        p50 = [float(x) for x in learner.predict(fp, d, o, "pv", site, learner.DEFAULTS)[0]]; cal = wx.calibrate(list(pv[:o + 1]), list(clear[:o + 1]), kwp)
        recs = [book.at(ts[o + j]) for j in range(1, 97)]; ks = [None if r is None else (score.factor(r) if mode == "full" else wx.clearness(r["cloud"])) for r in recs]
        ws = score.weights(0.3, 0.8, 96) if mode == "full" else 0.3; cl = [float(clear[o + j]) for j in range(1, 97)]; mix, wxp = wx.blend(p50, cl, ks, cal, ws)
        for h in wx.HORIZONS: score.note(ts[o + h], h, p50[h - 1], wxp[h - 1], mix[h - 1], (recs[h - 1] or {}).get("sky", ""), cl[h - 1] * cal)
        for j in range(1, 97):
            i = o + j
            if not day[i]: continue
            cover[1] += 1
            if wxp[j - 1] is None: continue
            cover[0] += 1; b = next(x for x, _ in BUCKETS if j <= x)
            err[b]["ai"].append(abs(p50[j - 1] - pv[i])); err[b]["wx"].append(abs(wxp[j - 1] - pv[i])); err[b]["mix"].append(abs(mix[j - 1] - pv[i]))
    return err, cover, score


def summarize(runs, kwp):
    """여러 씨앗의 결과를 모아 묶음별 오차(%)로."""
    out = []; pct = lambda xs: round(float(np.mean(xs)) / kwp * 100, 2) if xs else None
    for b, name in BUCKETS:
        cat = {k: sum((r[0][b][k] for r in runs), []) for k in ("ai", "wx", "mix")}
        out.append({"h": name, "n": len(cat["ai"]), "ai": pct(cat["ai"]), "wx": pct(cat["wx"]), "mix": pct(cat["mix"])})
    al = {k: sum((r[0][b][k] for r in runs for b, _ in BUCKETS), []) for k in ("ai", "wx", "mix")}
    out.append({"h": "전체(날씨 기록이 있는 낮 시간)", "n": len(al["ai"]), "ai": pct(al["ai"]), "wx": pct(al["wx"]), "mix": pct(al["mix"])})
    sc = runs[0][2]
    return {"rows": out, "cover_pct": round(100.0 * sum(r[1][0] for r in runs) / max(1, sum(r[1][1] for r in runs)), 1),
            "weights": {str(h): sc.weight(0.3, 0.8, h) for h in wx.HORIZONS}, "learned": sc.learned()}


def main():
    site = Site(); td = tempfile.mkdtemp(); p = os.path.join(td, "a.csv"); dataio.gen_sample(site, p); d = dataio.load_csv(p, site)
    fp = PVForecaster(site).fit(learner.cut(d, d["n"] - HOLD_DAYS * 96)); seeds = (11, 23, 37)
    res = {"method": {"days": 120, "hold_days": HOLD_DAYS, "issue_every_h": 1, "seeds": list(seeds), "metric": "설비 용량 대비 평균 절대 오차(%) — 날씨 기록이 있는 낮 시간만",
                      "note": "합성 자료 결과. 앱 · 통신망 예보의 오차 크기는 가정(수기: 한 칸 어긋날 확률 오늘 25% · 내일 35%, 통신망: 운량 표준편차 1.0 + 0.05 × 선행시간)."}, "cases": {}}
    for kind, title in (("수기", "작전지 — 휴대폰 날씨 수기 입력(하루 3회)"), ("통신망", "주둔지 — 군 통신망 날씨 자료(6시간마다, 시간별)")):
        res["cases"][title] = {m: summarize([run(d, site, fp, kind, m, s) for s in seeds], site.pv_kwp) for m in ("plain", "full")}
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "wx_eval.json"), "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, indent=1)
    for title, c in res["cases"].items():
        print(title, "· 덮는 비율", c["full"]["cover_pct"], "%")
        for a, b in zip(c["plain"]["rows"], c["full"]["rows"]): print(f"   {a['h']:<22} n={a['n']:<6} AI {a['ai']}  날씨만 {a['wx']}→{b['wx']}  단순 섞기 {a['mix']}  보완 {b['mix']}")
        print("   반영 비율", c["full"]["weights"], "· 배운 값", [(x["sky"], x["table"], x["seen"]) for x in c["full"]["learned"]])


if __name__ == "__main__":
    main()
