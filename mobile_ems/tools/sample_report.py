# -*- coding: utf-8 -*-
"""운영 보고서 예시를 만든다(문서 묶음에 넣는 견본). 가상 장치를 잠깐 돌리고 태세를 한 번 바꾼 뒤 화면의 [보고서 출력]과 같은 함수로 Word 파일을 쓴다.

  python -m tools.sample_report <출력 파일.docx>
수치는 가상 장치와 시연용 합성 과거 자료의 값이다(보고서 머리에 그렇게 적힌다).
"""
import os, shutil, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from ifps_ems_rt.hmi.engine import Engine          # noqa: E402
from ifps_ems_rt.hmi import report                  # noqa: E402


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
    raise SystemExit(main(sys.argv[1]))
