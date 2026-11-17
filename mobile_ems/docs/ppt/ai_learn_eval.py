# -*- coding: utf-8 -*-
"""보고자료용 지속 학습 평가(합성 자료, 씨앗 고정 → 다시 돌려도 같은 값). 결과: docs/ppt/ai_learn_eval.json
상황 1: 30일 자료로 만든 기본 모델을 쓰다가, 자료가 45일 · 60일로 쌓일 때마다 학습 주기를 돌린다(자료 성질이 변하지 않는 경우).
상황 2: 36일째부터 부하가 30% 늘어난다. 30일째 모델을 그대로 쓸 때와 다시 학습했을 때의 오차를 비교한다.
  python docs/ppt/ai_learn_eval.py"""
import json, os, shutil, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
from ifps_ems import dataio, learner          # noqa: E402
from ifps_ems.config import Site             # noqa: E402

site = Site(); td = tempfile.mkdtemp(); out = {"cycles": [], "defaults": learner.DEFAULTS, "min_rows": learner.MIN_FIT + learner.DEFAULTS["holdout_days"] * 96}
try:
    full = os.path.join(td, "full.csv"); dataio.gen_sample(site, full, days=60, start="2026-09-01 00:00"); rows = open(full, encoding="utf-8").read().splitlines(); md = os.path.join(td, "m")
    for days in (30, 45, 60):
        part = os.path.join(td, f"d{days}.csv"); open(part, "w", encoding="utf-8").write("\n".join(rows[:1 + days * 96]) + "\n")
        r = learner.train(part, md, site, now=f"{days}일째", source="합성 자료"); a = learner.active(md)
        out["cycles"].append({"days": days, "adopted": r["adopted"], "recal": bool(r.get("recal")), "why": r["why"], "kinds": r["kinds"], "updated": a.get("updated", []), "sec": r["sec"]})
    # 현장 상황이 바뀌는 경우: 36일째부터 부하가 30% 늘어난다(부대 증편 등). 30일째 모델을 그대로 쓸 때와 60일째에 다시 학습했을 때를 비교
    drift = [rows[0]]
    for i, ln in enumerate(rows[1:]):
        c = ln.split(",")
        if i >= 35 * 96: c[1:5] = [f"{float(x) * 1.3:.2f}" for x in c[1:5]]
        drift.append(",".join(c))
    md2 = os.path.join(td, "m2"); p30 = os.path.join(td, "s30.csv"); open(p30, "w", encoding="utf-8").write("\n".join(drift[:1 + 30 * 96]) + "\n")
    p60 = os.path.join(td, "s60.csv"); open(p60, "w", encoding="utf-8").write("\n".join(drift) + "\n")
    learner.train(p30, md2, site, now="30일째", source="합성 자료"); r = learner.train(p60, md2, site, now="60일째", source="합성 자료(부하 30% 증가)")
    out["drift"] = {"why": r["why"], "kinds": r["kinds"], "adopted": r["adopted"]}
finally:
    shutil.rmtree(td, ignore_errors=True)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ai_learn_eval.json"), "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, indent=1)
print("drift", out["drift"]["why"], {k: (v["current"], v["new"], v["near"], v["near_bias"], v["bias_on"]) for k, v in out["drift"]["kinds"].items()})
for c in out["cycles"]: print(c["days"], c["why"], {k: (v["current"], v["new"], v["near"], v["near_bias"], v["bias_on"]) for k, v in c["kinds"].items()}, c["sec"])
