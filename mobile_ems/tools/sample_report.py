# -*- coding: utf-8 -*-
"""운영 보고서 예시와 시퀀스 문서(PPT) 견본을 만든다(문서 묶음에 넣는 견본). 가상 장치를 잠깐 돌리고 태세를 한 번 바꾼 뒤 화면의 [보고서 출력]과 같은 함수로 Word 파일을 쓴다.

  python -m tools.sample_report <출력 파일.docx> [시퀀스 문서.pptx]
수치는 가상 장치와 시연용 합성 과거 자료의 값이다(보고서 머리에 그렇게 적힌다).
"""
import os, shutil, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from ifps_ems_rt.hmi.engine import Engine          # noqa: E402
from ifps_ems_rt.hmi import report                  # noqa: E402


def sequence(out, rev):
    """기본 시나리오 전부를 가상 장치로 검증한 시간과 함께 시퀀스 문서로 낸다(화면의 [시퀀스 PPT 내보내기]와 같은 함수)."""
    import json                                     # pylint: disable=import-outside-toplevel
    from ifps_ems_rt import pointmap                # pylint: disable=import-outside-toplevel
    from ifps_ems_rt.hmi import scenarios, scenextra, seqppt    # pylint: disable=import-outside-toplevel
    prof = os.path.join(ROOT, "config", "runtime.json")
    with open(prof, encoding="utf-8") as f: cfg = json.load(f)
    with open(os.path.join(ROOT, "ifps_ems_rt", "hmi", "static", "scenario_presets.json"), encoding="utf-8") as f: cases = json.load(f)
    pts = pointmap.load(os.path.join(ROOT, "config", "pointmap.csv"), cfg["devices"]); allp = scenextra.merge(pts, scenextra.load(prof)); cases = scenarios.compatible_presets(cases, allp, scenarios.catalog(allp, cfg["devices"])["commands"])
    body = seqppt.export(cases, scenarios.verify(cases, pts, cfg["devices"], profile=prof)["results"], rev, cfg.get("site", {}).get("name", ""))
    with open(out, "wb") as f: f.write(body)
    print(f"시퀀스 문서 견본: {out} (시나리오 {len(cases)}건, {len(body):,} 바이트)")


def main(out):
    d = tempfile.mkdtemp()
    try:
        shutil.copytree(os.path.join(ROOT, "config"), os.path.join(d, "config"), ignore=shutil.ignore_patterns("state*"))
        eng = Engine(os.path.join(d, "config", "runtime.json"), sim=True, plan_dir=os.path.join(ROOT, "results")); eng.start()
        try:
            time.sleep(6); eng.set_ops({"posture": "저소음"}, "시연"); time.sleep(6); eng.set_ops({"posture": "평시"}, "시연"); time.sleep(4)
            eng.archw.flush(); st = eng.archw.store; st.arch.sync(eng.rt.events, eng.alarms.hist); t1 = int(time.time() // 3600) * 3600; st.xfer.mark(st.xfer.make(t1 - 7 * 86400, t1 - 86400, "시연", eng.rt.site.name)["id"], "시연", "시연용 예시"); name, body = report.build(eng, st, {"days": 7})
        finally:
            eng.stop()
        with open(out, "wb") as f: f.write(body)
        print(f"운영 보고서 예시: {out} ({len(body):,} 바이트, 화면에서 받는 이름 {name})")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 2:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as _f: sequence(sys.argv[2], _f.read().strip())
    raise SystemExit(main(sys.argv[1]))
