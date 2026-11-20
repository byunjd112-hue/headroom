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


# 문서 묶음의 폴더 구성(읽는 순서): (폴더, 설명, 파일 이름에 들어 있는 말들)
LAYOUT = [("01_제안발표", "제안 발표 자료에 EMS 하드웨어·소프트웨어 4장을 넣은 보완본", ("IFPS_제안발표",)),
          ("02_화면과운용", "화면 구성·운용 방안·사용 방법·디버깅·신뢰성 결과를 한 권으로 묶은 보고자료, 화면에서 출력하는 운영 보고서의 견본(가상 장치 값)", ("화면구성_사용설명_보고자료", "운영보고서_예시")),
          ("03_하드웨어", "쉘터 탑재형 구성, 이동·충격·진동·PLS·EMP 설계, WBS 와 시판 참조 모델", ("하드웨어구성_기술자료",)),
          ("04_AI예측", "예측 수식·학습된 모델의 입체 그림·독립 검증(기술자료)과 같은 내용의 논문 초안", ("AI예측_기술자료", "AI예측_논문")),
          ("05_통신연동", "실장치 통신 연동 방안서(Modbus TCP 규약·설정·시운전 절차)", ("실장치통신연동방안서",)),
          ("06_장치별연동", "장치 제작사에 보내는 연동·디버깅 안내서 7종", ("EMS연동디버깅안내서",)),
          ("07_시험과신뢰성", "FMEA·FTA 워크벤치, 시험 결과 보고서, 신뢰성 시험 결과서, 보안성 검토, C++ 이식 사전 점검", ("FMEA_FTA", "SW시험결과보고서", "SW신뢰성시험결과서", "보안성검토결과", "Cpp이식"))]
EVIDENCE = [("scenario_results.json", "운영 시나리오 20건 실행 결과(운전 모드 12종 포함)"), ("forecast_benchmark.json", "예측 독립 시험 6세트 — 매일 구간 보정 + 변동 여유"),
            ("forecast_benchmark_static.json", "같은 시험 — 구간을 학습 때 한 번만 보정(개선 전 비교 기준)"), ("ppt/ai_paper_eval.json", "AI 기술자료·논문의 모든 수치와 그림용 값"),
            ("test_results.json", "동적 시험 측정값"), ("static_results.json", "정적 시험·실행률·메트릭 측정값"),
            ("ppt/img/aich_bench15.png", "그래프: 15분 앞 예측 오차(적용 전후)"), ("ppt/img/aich_cov24.png", "그래프: 24시간 예측 구간 포함률"), ("ppt/img/ai3d_m_now.jpg", "입체 그림: 단기 실측 앙상블의 보정량 응답면")]


def _guide(rev, date, groups, evid):
    """문서 묶음 첫 화면(00_…문서안내.html): 읽는 순서와 문서별 한 줄 설명."""
    esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;")
    sec = "".join(f'<section><h2>{esc(d)}</h2><p>{esc(desc)}</p><ul>' + "".join(f'<li><a href="{esc(d)}/{esc(n)}">{esc(n)}</a></li>' for n in names) + "</ul></section>" for d, desc, names in groups if names)
    ev = "".join(f'<li><a href="08_시험근거/{esc(n)}">{esc(n)}</a> — {esc(t)}</li>' for n, t in evid)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>IFPS EMS {rev} 문서 안내</title>
<style>body{{font-family:"맑은 고딕","Malgun Gothic",sans-serif;margin:0;background:#f6f2ea;color:#24221d;line-height:1.6}}main{{max-width:980px;margin:0 auto;padding:28px 20px 60px}}
h1{{font-size:26px;margin:0 0 4px}}h2{{font-size:17px;margin:0 0 2px;color:#5b4a34}}.sub{{color:#6f6b68;margin:0 0 18px}}section{{background:#fff;border:1px solid #e0d7c8;border-radius:8px;padding:14px 18px;margin:12px 0}}
section p{{margin:0 0 6px;color:#4a463f;font-size:14px}}ul{{margin:4px 0 0;padding-left:20px}}li{{font-size:14px}}a{{color:#7b5a1e}}.note{{font-size:13px;color:#6f6b68}}</style></head><body><main>
<h1>IFPS 이동형 전력체계 EMS — 문서 안내</h1><p class="sub">{rev} · {date} · 모든 문서와 실행 패키지는 같은 리비전이다</p>
<section><h2>읽는 순서</h2><p>제안 발표 → 화면과 운용 → 하드웨어 → AI 예측 → 통신 연동 → 장치별 연동 → 시험과 신뢰성 → 시험 근거. 처음 보는 분은 02 보고자료부터 보면 전체가 잡힌다.</p></section>
{sec}
<section><h2>08_시험근거</h2><p>문서에 실린 수치의 원자료. 문서의 표와 그래프는 이 파일에서 그대로 읽어 만든다.</p><ul>{ev}</ul></section>
<p class="note">수치는 가상 장치와 합성 현장 자료에서 잰 것이다. 실장비 연동(FAT·SAT)과 현장 자료에서의 결과는 따로 확인해야 한다. 하드웨어 제품 이름은 참조 예시이며 탑재 품목은 승인 자료로 확정한다.</p></main></body></html>"""


def bundle(rev):
    """docs/out 전체를 IFPS_EMS_문서_<Rev>.zip 으로 묶는다. 읽는 순서대로 폴더(01~08)에 나눠 담고 첫 화면(00 문서 안내)을 넣는다.
    한글 파일 이름이 Windows 에서 깨지지 않게 파이썬 zipfile 로 만든다(zipfile 은 한글 이름에 UTF-8 표시를 붙인다. 리눅스 zip 명령은 붙이지 않는다)."""
    import zipfile
    for f in os.listdir(ROOT):
        if re.fullmatch(r"IFPS_EMS_문서_Rev\d+\.zip", f): os.remove(os.path.join(ROOT, f))
    z = os.path.join(ROOT, f"IFPS_EMS_문서_{rev}.zip"); files = sorted((os.path.join(dp, f), f) for dp, _, fs in os.walk(OUT) for f in fs); placed = set(); groups = []
    today = datetime.date.today(); date = f"{today.year}. {today.month}. {today.day}."
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for d, desc, keys in LAYOUT:
            names = [n for p, n in files if any(k in n for k in keys)]; groups.append((d, desc, names))
            for p, n in files:
                if n in names: zf.write(p, f"{d}/{n}"); placed.add(p)
        left = [n for p, n in files if p not in placed]
        if left: sys.exit(f"문서 묶음의 폴더가 정해지지 않은 파일: {left}")
        evid = [(os.path.basename(n), t) for n, t in EVIDENCE if os.path.exists(os.path.join(DOCS, n))]
        for n, _ in EVIDENCE:
            if os.path.exists(os.path.join(DOCS, n)): zf.write(os.path.join(DOCS, n), "08_시험근거/" + os.path.basename(n))
        zf.writestr(f"00_IFPS_EMS_문서안내_{rev}.html", _guide(rev, date, groups, evid))
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
        run([sys.executable, "-m", "tools.scenario_report", os.path.join(DOCS, "scenario_results.json")])     # 운영 시나리오 20건(문서의 시험 근거)
    os.makedirs(OUT, exist_ok=True); print(f"이전 리비전 산출물 {clean(rev)}개 삭제")
    for b in BUILDERS: run(["node", os.path.join(DOCS, b), rev, date], env=env)
    run(["node", os.path.join(DOCS, "ppt", "build_deck.js"), rev, ym], env=env)
    run(["node", os.path.join(DOCS, "ppt", "build_ai_deck.js"), rev, ym], env=env)            # AI 예측 기술자료(수식·입체 모델 그림)
    run(["node", os.path.join(DOCS, "ppt", "build_hw_deck.js"), rev, ym], env=env)            # 하드웨어 구성 기술자료
    run([sys.executable, os.path.join(DOCS, "fmea", "build_fmea.py"), rev, date])
    run([sys.executable, "-m", "tools.sample_report", os.path.join(OUT, f"이동형전력체계EMS_운영보고서_예시_{rev}.docx")])   # 화면의 [보고서 출력]으로 나오는 문서의 견본(가상 장치 값)
    run([sys.executable, os.path.join(DOCS, "ppt", "add_ems_to_proposal.py"), rev])                 # 제안 발표 자료 EMS 보완본(원본이 있을 때만)          # FMEA·FTA 통합 분석 워크벤치(HTML)
    names = sorted(os.path.relpath(os.path.join(dp, f), OUT) for dp, _, fs in os.walk(OUT) for f in fs)
    bad = [n for n in names if rev not in n]
    print(f"산출물 {len(names)}개 (docs/out):"); [print("   ", n) for n in names]
    if bad: sys.exit(f"리비전이 다른 파일이 남아 있음: {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
