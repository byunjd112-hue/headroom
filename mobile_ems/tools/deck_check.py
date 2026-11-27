# -*- coding: utf-8 -*-
"""발표 자료(.pptx)의 양식 점검: 글자 크기 · 내용 영역 · 첫 요소 높이가 기준(제안 발표 자료)과 같은지 본다.

  python tools/deck_check.py docs/out/IFPS_TPCS_SW_화면구성_사용설명_보고자료_Rev56.pptx …
  python tools/deck_check.py --match "⑤ TPCS (하드웨어|소프트웨어)" docs/out/IFPS_제안발표_EMS보완_Rev56.pptx

기준(docs/ppt/deck_lib.js 의 FS · L 과 같은 값): 글자 크기는 SIZES 안, 내용은 x 0.50~12.83 · y 1.72~6.75(※ 주석은 6.82까지),
내용의 첫 요소는 모든 장에서 y 1.72. 표지 · 맺음 장은 점검하지 않는다. --match 를 주면 그 글이 들어 있는 장만 본다(사용자 원본에 넣은 장).
문제가 있으면 목록을 찍고 1 을 돌려준다. 필요: pip 패키지 python-pptx."""
import argparse
import re
import sys

from pptx import Presentation
from pptx.util import Emu

SIZES = {7.5, 8.5, 8.8, 9.0, 9.5, 12.0, 12.5, 14.0, 16.0, 21.0, 28.0}     # 역할별 글자 크기(pt)
NOTE_PT = 8.8                                                             # ※ 주석
X0, X1, TOP, BOT, NOTE_BOT = 0.50, 12.83, 1.72, 6.75, 6.82                # 내용 영역(inch)
HEAD_Y, FOOT_Y, TOL = 1.55, 7.0, 0.015                                    # 이 위는 머리(제목), 이 아래는 바닥글
SKIP_LAYOUTS = ("COVER", "CLOSING")


def inch(v):
    return Emu(v).inches if v is not None else 0.0


def frames(shape):
    """도형 안의 글 틀(표는 칸마다)."""
    if getattr(shape, "has_table", False) and shape.has_table:
        return [c.text_frame for r in shape.table.rows for c in r.cells]
    return [shape.text_frame] if shape.has_text_frame else []


def sizes(shape):
    """도형에 직접 적힌 글자 크기(pt)들. 크기를 적지 않은 글(레이아웃을 따르는 글)은 건너뛴다."""
    out = set()
    for tf in frames(shape):
        for para in tf.paragraphs:
            out.update(round(r.font.size.pt, 2) for r in para.runs if r.font.size is not None and r.text.strip())
    return out


def box(shape):
    """(왼쪽, 위, 오른쪽, 아래) inch. 표는 줄 높이 합을 높이로 본다."""
    x, y, w, h = inch(shape.left), inch(shape.top), inch(shape.width), inch(shape.height)
    if getattr(shape, "has_table", False) and shape.has_table:
        h = sum(inch(r.height) for r in shape.table.rows)
    return x, y, x + w, y + h


def slide_text(slide):
    return " ".join(tf.text for sh in slide.shapes for tf in frames(sh))


def content(slide):
    """내용 영역의 도형(제목 자리 표시자 · 머리 · 바닥글 제외)."""
    return [sh for sh in slide.shapes if not sh.is_placeholder and HEAD_Y <= inch(sh.top) < FOOT_Y]


def check_slide(n, slide, w, h):
    """한 장의 문제 목록과 첫 요소 높이를 돌려준다."""
    bad = []
    for sh in slide.shapes:
        odd = sorted(sizes(sh) - SIZES)
        if odd:
            bad.append(f"{n}쪽: 글자 크기 {odd} — '{sh.name}'")
        x0, y0, x1, y1 = box(sh)
        if sh.name.startswith(("번호", "표식")) and abs((x1 - x0) - (y1 - y0)) > 0.01:      # 번호 동그라미가 타원으로 늘어나지 않았는지
            bad.append(f"{n}쪽: 번호 동그라미 비율 — '{sh.name}' {x1 - x0:.2f} × {y1 - y0:.2f}")
        if x0 < -TOL or y0 < -TOL or x1 > w + TOL or y1 > h + TOL:
            bad.append(f"{n}쪽: 슬라이드 밖 — '{sh.name}' ({x0:.2f},{y0:.2f})~({x1:.2f},{y1:.2f})")
    body = content(slide)
    for sh in body:
        x0, y0, x1, y1 = box(sh)
        lim = NOTE_BOT if sizes(sh) == {NOTE_PT} else BOT
        if x0 < X0 - TOL or x1 > X1 + TOL or y1 > lim + TOL:
            bad.append(f"{n}쪽: 내용 영역 밖 — '{sh.name}' x {x0:.2f}~{x1:.2f}, 아래 {y1:.2f} (한도 {lim})")
    top = min((box(sh)[1] for sh in body), default=None)
    if top is not None and abs(top - TOP) > TOL:
        bad.append(f"{n}쪽: 첫 요소 높이 {top:.2f} (기준 {TOP})")
    return bad, top


def check(path, match=None):
    """파일 하나를 점검해 (본 장 수, 문제 목록)을 돌려준다."""
    pres = Presentation(path)
    w, h = inch(pres.slide_width), inch(pres.slide_height)
    pat = re.compile(match) if match else None
    bad, seen = [], 0
    for n, slide in enumerate(pres.slides, 1):
        if slide.slide_layout.name in SKIP_LAYOUTS or (pat and not pat.search(slide_text(slide))):
            continue
        seen += 1
        bad.extend(check_slide(n, slide, w, h)[0])
    return seen, bad


def main(argv=None):
    ap = argparse.ArgumentParser(description="발표 자료 양식 점검(글자 크기 · 내용 영역 · 첫 요소 높이)")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--match", help="이 정규식의 글이 들어 있는 장만 점검")
    a = ap.parse_args(argv)
    total = 0
    for f in a.files:
        seen, bad = check(f, a.match)
        total += len(bad)
        print(f"{'문제 ' + str(len(bad)) + '건' if bad else '정상'}  {seen}장  {f}")
        for b in bad:
            print("   ", b)
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
