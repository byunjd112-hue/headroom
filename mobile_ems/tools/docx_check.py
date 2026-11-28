"""Word 산출물의 구조 점검(쪽 구성이 Word 에서 깨지는 원인을 문서 XML 에서 미리 잡는다).
  ① 맞붙은 표: 표 두 개 사이에 문단이 없으면 Word 가 한 표로 합쳐, 쪽이 넘어갈 때 앞 표의 제목 · 머리줄을 다시 찍는다 — 0 이어야 한다
  ② 문단 묶음 속성(keepNext · keepLines · pageBreakBefore): 편집 기호를 켜면 문단 앞에 검은 네모가 보인다 — 0 이어야 한다
  ③ 쪽 사이에서 잘릴 수 있는 표의 줄(cantSplit 없음) — 0 이어야 한다
  python tools/docx_check.py <파일 또는 폴더> …      문제가 있으면 종료 코드 1
"""
import os, re, sys, zipfile


def check(path):
    d = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    touch = len(re.findall(r"</w:tbl>\s*<w:tbl>", d))
    keep = len(re.findall(r'<w:(keepNext|keepLines|pageBreakBefore)(/>| w:val="(true|1)")', d))
    rows = re.findall(r"<w:tr[ >].*?</w:tr>", d, re.S); split = sum(1 for r in rows if "<w:cantSplit" not in r)
    return touch, keep, split


def main(args):
    files = []
    for a in args:
        if os.path.isdir(a): files += [os.path.join(dp, f) for dp, _, fs in os.walk(a) for f in fs if f.endswith(".docx")]
        else: files.append(a)
    bad = 0
    for f in sorted(files):
        t, k, s = check(f)
        if "운영보고서_예시" in f: continue                      # 프로그램이 만드는 문서(다른 작성기)
        if t or k or s: bad += 1; print(f"문제  맞붙은 표 {t} · 묶음 속성 {k} · 잘릴 수 있는 줄 {s}  {os.path.basename(f)}")
    print(f"Word 구조 점검 {len(files)}개: " + ("정상" if not bad else f"문제 {bad}개"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["docs/out"]))
