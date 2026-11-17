# -*- coding: utf-8 -*-
"""태양광 예측 보강(하늘 카메라·주의집중)의 효과를 합성 자료로 잰다 → pv_ai_eval.json (보고자료에 그대로 싣는다).

방법: 마지막 7일을 빼고 학습 → 그 7일에서 2시간 간격으로 24시간 예측을 발행해 오차(설비 용량 대비 %)를 잰다. 세 구성을 같은 자료·같은 방법으로 비교한다.
자료: ① 여름~가을 120일(기본 합성 자료)  ② 가을 60일(시연 모드가 쓰는 것과 같은 구간 길이)
주의: 합성 자료의 결과다. 하늘 카메라가 15~30분 뒤 구름을 미리 본다는 가정이 들어 있다. 실제 효과는 현장 카메라 자료로 다시 재야 한다.
  python docs/ppt/pv_ai_eval.py
"""
import json, os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from ifps_ems import dataio, learner
from ifps_ems.config import Site
from ifps_ems.forecast import PVForecaster

CASES = (("기존(발전 실적·기온·기압·습도)", {"use_sky": False, "use_att": False}), ("＋하늘 카메라", {"use_sky": True, "use_att": False}), ("＋하늘 카메라＋주의집중", {"use_sky": True, "use_att": True}))


def run(d, site):
    n = d["n"]; hold = 7 * 96; dt = learner.cut(d, n - hold); origins = list(range(n - hold - 1, n - 97, 8)); out = []
    for name, kw in CASES:
        f = PVForecaster(site, **kw).fit(dt); s = learner.score(f, d, origins, "pv", site, learner.DEFAULTS)
        out.append({"name": name, "nmae": s["nmae"], "near": s["near"], "n": s["n"], "alpha": [float(a) for a in f.alpha]})
    return out


def main():
    site = Site(); td = tempfile.mkdtemp(); res = {}
    p = os.path.join(td, "a.csv"); dataio.gen_sample(site, p); res["여름~가을 120일"] = run(dataio.load_csv(p, site), site)
    p = os.path.join(td, "b.csv"); dataio.gen_sample(site, p, days=320, start="2026-01-01 00:00"); res["가을 60일"] = run(learner._tail(dataio.load_csv(p, site), 60 * 96), site)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pv_ai_eval.json"), "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, indent=1)
    for k, rows in res.items():
        print(k); [print("   ", r["name"], "24시간", r["nmae"], "2시간 이내", r["near"], "α", r["alpha"]) for r in rows]


if __name__ == "__main__":
    main()
