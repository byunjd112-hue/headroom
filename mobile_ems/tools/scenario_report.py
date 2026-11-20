# -*- coding: utf-8 -*-
"""기본 운전 시나리오 20건(운전 모드 12종 + 장비 시나리오 8건)을 가상 장치 모형에서 돌려 결과를 JSON 으로 남긴다(문서의 시험 근거).

  python -m tools.scenario_report docs/scenario_results.json
한 건(디젤 기동 응답 지연)은 일부러 실패하게 만든 시험이다: 응답 대기 500 ms 에서 실패하고, 검증기가 제안한 대기 시간으로 다시 돌려 통과하는지를 본다.
제안값은 가상 시험의 대기 시간일 뿐이며 현장 보호 설정값이 아니다.
"""
import json, os, sys
from ifps_ems_rt.hmi import scenarios

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N_MODE = 12                                   # 앞 12건이 운전 모드(AUTO/MANUAL × 작전지·주둔지 × 평시·저소음·자립)


def brief(run):
    bad = [r for r in run["rows"] if r.get("state") != "pass"]
    return {"name": run["name"], "ok": bool(run["ok"]), "steps": len(run["rows"]), "fail_step": bad[0]["step"] if bad else None, "why": (bad[0].get("why") or "") if bad else ""}


def main(argv=None):
    out = (argv if argv is not None else sys.argv[1:] or [os.path.join(ROOT, "docs", "scenario_results.json")])[0]
    cfg = os.path.join(ROOT, "config", "runtime.json"); pts, devices = scenarios.load_profile(cfg)
    with open(os.path.join(ROOT, "ifps_ems_rt", "hmi", "static", "scenario_presets.json"), encoding="utf-8") as f: cases = json.load(f)
    r = scenarios.verify(cases, pts, devices, improve=True, profile=cfg); first = [brief(x) for x in r["results"]]; retest = [brief(x) for x in r.get("retest", r["results"])]
    res = {"total": len(first), "first_pass": sum(x["ok"] for x in first), "mode_total": N_MODE, "mode_pass": sum(x["ok"] for x in first[:N_MODE]), "retest_pass": sum(x["ok"] for x in retest),
           "results": first, "retest": retest, "changes": [dict(c, name=cases[c["case"]]["name"]) for c in r.get("changes", [])], "notes": {c["name"]: c.get("note", "") for c in cases}}
    with open(out, "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, indent=1)
    print(f"시나리오 {res['total']}건: 최초 {res['first_pass']}건 통과(운전 모드 {res['mode_pass']}/{N_MODE}), 대기 시간 조정 후 {res['retest_pass']}건 통과 → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
