# -*- coding: utf-8 -*-
"""관련 문서 전체를 같은 리비전 번호로 한 번에 다시 만든다(Word 문서·장치별 안내서·보고자료 PPT).

  python docs/build_all.py              VERSION 파일의 리비전으로 생성
  python docs/build_all.py --measure    정적·동적 측정부터 다시 하고 생성(약 10분)
  python docs/build_all.py --zip        (커밋한 뒤) 실행 패키지 IFPS_Mobile_EMS_<Rev>.zip 만 묶음. 문서는 다시 만들지 않는다

규칙: 소프트웨어 패키지·문서·보고자료는 모두 VERSION 의 리비전 하나를 쓴다. 리비전을 올릴 때는 VERSION 만 고치고 이 스크립트를 돌린다.
docs/out 에는 현재 리비전 파일만 남긴다(이전 리비전 산출물은 지운다 — 이력은 git 에 있다).
필요: node, npm 패키지 docx·pptxgenjs (개발 PC). 측정에는 pip 패키지 coverage·bandit·pyflakes·radon·pylint.
"""
import argparse, datetime, os, re, subprocess, sys  # nosec B404 — 개발 도구 실행(고정 인자)

DOCS = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(DOCS); OUT = os.path.join(DOCS, "out")
BUILDERS = ["build_test_report.js", "build_reliability_report.js", "build_security_review.js", "build_interface_guide.js", "build_device_guides.js", "build_cpp_report.js", "build_ai_paper.js"]


def run(args, cwd=ROOT, env=None):
    r = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True)  # nosec B603 — 고정 인자, shell 미사용
    tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
    print(("  완료 " if r.returncode == 0 else "  실패 ") + " ".join(os.path.basename(a) if os.sep in a else a for a in args[:3]) + "  " + tail[0][:110])
    if r.returncode != 0: print(r.stdout[-1500:], r.stderr[-1500:]); sys.exit(1)


def clean(rev):
    """docs/out 에서 현재 리비전이 아닌 산출물과 PDF 를 지운다."""
    n = 0
    for dp, _, fs in os.walk(OUT):
        for f in fs:
            m = re.search(r"_(Rev\d+)\.(docx|pptx|pdf|html)$", f)
            if m and (m.group(1) != rev or m.group(2) == "pdf"): os.remove(os.path.join(dp, f)); n += 1
    old = os.path.join(OUT, "보고자료")
    if os.path.isdir(old) and not os.listdir(old): os.rmdir(old)
    return n


def bundle(rev):
    """docs/out 전체를 IFPS_EMS_문서_<Rev>.zip 으로 묶는다. 한글 파일 이름이 Windows 에서 깨지지 않게 파이썬 zipfile 로 만든다
    (zipfile 은 한글 이름에 UTF-8 표시를 붙인다. 리눅스 zip 명령은 붙이지 않아 Windows 탐색기에서 이름이 깨진다)."""
    import zipfile
    for f in os.listdir(ROOT):
        if re.fullmatch(r"IFPS_EMS_문서_Rev\d+\.zip", f): os.remove(os.path.join(ROOT, f))
    z = os.path.join(ROOT, f"IFPS_EMS_문서_{rev}.zip")
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for dp, _, fs in sorted(os.walk(OUT)):
            for f in sorted(fs): p = os.path.join(dp, f); zf.write(p, os.path.relpath(p, OUT).replace(os.sep, "/"))
        bad = [i.filename for i in zf.infolist() if not i.filename.isascii() and not i.flag_bits & 0x800]
    if bad: sys.exit(f"UTF-8 표시가 없는 파일 이름: {bad}")
    return z


def main(argv=None):
    ap = argparse.ArgumentParser(description="관련 문서 전체를 같은 리비전으로 생성")
    ap.add_argument("--rev", help="리비전(기본: VERSION 파일)"); ap.add_argument("--measure", action="store_true", help="정적·동적 측정부터 다시"); ap.add_argument("--soak", type=int, default=300)
    ap.add_argument("--zip", action="store_true", help="실행 패키지까지 묶음")
    a = ap.parse_args(argv)
    with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f: rev = a.rev or f.read().strip()
    if not re.fullmatch(r"Rev\d{2,}", rev): sys.exit(f"리비전 형식 오류: {rev} (예: Rev18)")
    today = datetime.date.today(); date = f"{today.year}. {today.month}. {today.day}."; ym = f"{today.year}. {today.month:02d}."
    env = dict(os.environ); env["NODE_PATH"] = os.pathsep.join(p for p in (os.path.join(DOCS, "node_modules"), os.path.join(DOCS, "ppt", "node_modules"), env.get("NODE_PATH", "")) if p)
    print(f"리비전 {rev} · 작성일 {date}")
    if a.zip:                                                    # 묶기만 한다(문서는 다시 만들지 않는다 — 커밋된 것과 같은 파일이 들어가게)
        z = os.path.join(ROOT, f"IFPS_Mobile_EMS_{rev}.zip")
        dirty = subprocess.run(["git", "status", "--porcelain", "."], cwd=ROOT, capture_output=True, text=True).stdout.strip()  # nosec B603 B607 — 고정 인자
        if dirty: sys.exit("커밋하지 않은 변경이 있습니다. 먼저 커밋하십시오:\n" + dirty[:600])
        run(["git", "archive", "--format=zip", f"--prefix=IFPS_Mobile_EMS_{rev}/", "-o", z, "HEAD:" + os.path.basename(ROOT)], cwd=os.path.dirname(ROOT)); print("패키지:", z)
        print("문서 묶음:", bundle(rev)); return 0
    if a.measure:
        run([sys.executable, "tools/cpp_report.py"])                       # C++ 핵심부: 동등성 시험·실행률·정적 점검
        run([sys.executable, "tools/static_report.py"]); run([sys.executable, "tools/measure.py", "docs/test_results.json", "--soak", str(a.soak)])
    os.makedirs(OUT, exist_ok=True); print(f"이전 리비전 산출물 {clean(rev)}개 삭제")
    for b in BUILDERS: run(["node", os.path.join(DOCS, b), rev, date], env=env)
    run(["node", os.path.join(DOCS, "ppt", "build_deck.js"), rev, ym], env=env)
    run(["node", os.path.join(DOCS, "ppt", "build_ai_deck.js"), rev, ym], env=env)            # AI 예측 기술자료(수식·입체 모델 그림)
    run(["node", os.path.join(DOCS, "ppt", "build_hw_deck.js"), rev, ym], env=env)            # 하드웨어 구성 기술자료
    run([sys.executable, os.path.join(DOCS, "fmea", "build_fmea.py"), rev, date])
    run([sys.executable, os.path.join(DOCS, "ppt", "add_ems_to_proposal.py"), rev])                 # 제안 발표 자료 EMS 보완본(원본이 있을 때만)          # FMEA·FTA 통합 분석 워크벤치(HTML)
    names = sorted(os.path.relpath(os.path.join(dp, f), OUT) for dp, _, fs in os.walk(OUT) for f in fs)
    bad = [n for n in names if rev not in n]
    print(f"산출물 {len(names)}개 (docs/out):"); [print("   ", n) for n in names]
    if bad: sys.exit(f"리비전이 다른 파일이 남아 있음: {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
