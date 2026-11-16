# -*- coding: utf-8 -*-
"""IFPS 제안 발표 자료의 EMS 장(3-4) 뒤에 EMS 하드웨어 2장·소프트웨어 2장을 넣고, 큰 그림을 다시 압축해 25 MB 아래로 줄인다.

  python docs/ppt/add_ems_to_proposal.py Rev24      (보통은 docs/build_all.py 가 부른다)

원본은 docs/ppt/base/IFPS_제안발표_원본.pptx 에 둔다(사용자 자료라 저장소에 올리지 않는다). 없으면 건너뛴다.
결과: docs/out/IFPS_제안발표_EMS보완_<Rev>.pptx — 다른 문서와 같은 리비전 번호."""
import sys, copy, re, os, io, zipfile
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

HERE = os.path.dirname(os.path.abspath(__file__)); REV = sys.argv[1] if len(sys.argv) > 1 else "Rev00"
SRC = os.path.join(HERE, "base", "IFPS_제안발표_원본.pptx"); IMG = os.path.join(HERE, "img")
OUT = os.path.join(HERE, "..", "out", f"IFPS_제안발표_EMS보완_{REV}.pptx"); LIMIT = 25_000_000
if not os.path.exists(SRC): print("건너뜀: 원본 없음 —", SRC); sys.exit(0)
p = Presentation(SRC); base = p.slides[8]; N0 = len(p.slides)
assert "이동형 전력체계 EMS" in base.shapes[5].text_frame.text
C = lambda h: RGBColor.from_string(h)
INK, DARK, CREAM, GOLD, BROWN, LINE, GRAY, WHITE = "2B2723", "35302A", "F9F1E6", "8A7449", "7B674F", "E0D7C8", "6F6B68", "FFFFFF"


def text(s, x, y, w, h, t, size=12, bold=False, color=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h)); tf = tb.text_frame; tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0; tf.vertical_anchor = anchor
    for i, line in enumerate(t if isinstance(t, list) else [t]):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph(); para.alignment = align; para.space_after = Pt(2)
        r = para.add_run(); r.text = line; r.font.size = Pt(size); r.font.bold = bold; r.font.color.rgb = C(color); r.font.name = "맑은 고딕"
    return tb


def rect(s, x, y, w, h, fill, line=None, shape=MSO_SHAPE.RECTANGLE):
    sh = s.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h)); sh.fill.solid(); sh.fill.fore_color.rgb = C(fill); sh.shadow.inherit = False
    if line: sh.line.color.rgb = C(line); sh.line.width = Pt(0.75)
    else: sh.line.fill.background()
    return sh


def new_slide(title, sub):
    s = p.slides.add_slide(base.slide_layout)
    for ph in list(s.placeholders): ph._element.getparent().remove(ph._element)
    for sh in list(base.shapes)[:9]: s.shapes._spTree.append(copy.deepcopy(sh._element))      # 머리띠·장 번호·제목·바닥글
    def put(sh, t):
        r = sh.text_frame.paragraphs[0].runs; r[0].text = t
        for x in r[1:]: x.text = ""
    put(s.shapes[5], title); put(s.shapes[6], sub); s.shapes[5].width = Inches(12.3)
    return s


def tile(s, i, n, img, head, lines, ratio, y=1.68, cap=None):
    """그림 한 장 + 머리 + 요점. i 번째(0부터), 한 줄에 n 장."""
    gap = 0.14; w = (12.33 - gap * (n - 1)) / n; x = 0.5 + i * (w + gap); h = w / ratio
    s.shapes.add_picture(f"{IMG}/{img}.jpg", Inches(x), Inches(y), Inches(w), Inches(h))
    fr = rect(s, x, y, w, h, WHITE, LINE); fr.fill.background()
    rect(s, x, y + h, w, 0.34, BROWN); text(s, x + 0.1, y + h, w - 0.2, 0.34, head, 12.5, True, WHITE, anchor=MSO_ANCHOR.MIDDLE)
    bh = 5.72 - (y + h + 0.34); rect(s, x, y + h + 0.34, w, bh, CREAM, LINE)
    text(s, x + 0.1, y + h + 0.42, w - 0.2, bh - 0.12, ["· " + t for t in lines], 10.5)


def strip(s, items, note):
    """아래 띠: 핵심 수치·요점 상자와 주석."""
    n = len(items); gap = 0.14; w = (12.33 - gap * (n - 1)) / n
    for i, (lab, val) in enumerate(items):
        x = 0.5 + i * (w + gap); rect(s, x, 5.86, w, 0.74, DARK)
        text(s, x, 5.89, w, 0.24, lab, 10, False, "EFE6D8", PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE); text(s, x, 6.13, w, 0.42, val, 15, True, WHITE, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    text(s, 0.5, 6.66, 12.33, 0.3, note, 8.8, False, GRAY, anchor=MSO_ANCHOR.MIDDLE)


HW, SW = 1024 / 688, 16 / 9
import json  # noqa: E402
with open(os.path.join(HERE, "..", "static_results.json"), encoding="utf-8") as f: _r = json.load(f)
NT, ST, BR = len(_r["tests"]), _r["stmt"]["pct"], _r["branch"]["pct"]
# ── 하드웨어 ①
s1 = new_slide("3-4.  ⑤ EMS 하드웨어 ① — 쉘터 탑재 · 이동 · 방진", "PLS 플랫랙에 실어 옮기고, 내려놓으면 바로 연결  |  쉘터 – 랙 – 장비 3단계 방진  |  무게중심·고박 관리")
tile(s1, 0, 4, "hw_pls", "PLS 적재 · 하역", ["ISO 규격 치수·모서리 쇠, 플랫랙 후크 인터페이스", "적재·하역 기울기와 착지 충격이 설계 조건", "이동 전 정상 종료 → 하역 후 접지·연결·기동 점검"], HW)
tile(s1, 1, 4, "hw_tiedown", "고박", ["모서리 쇠 4곳 잠금 + 고박 고리", "도로·야지·철도·선박 하중 방향별 대응", "내부 장비는 레일 잠금·전면 고정 바"], HW)
tile(s1, 2, 4, "hw_rack", "방진 랙", ["와이어로프 방진기로 랙 전체를 매달아 충격·진동 저감", "회전 디스크 금지(SSD), 풀림 방지 체결", "방진 행정만큼 공간·케이블 여유"], HW)
tile(s1, 3, 4, "hw_interior", "쉘터 내부", ["방진 랙 2 + 운용 콘솔, 냉난방·등화관제", "무거운 장비는 아래 — 무게중심 낮춤", "랙 전면 정비, 예비품 차폐 보관"], HW)
strip(s1, [("진동 · 충격", "MIL-STD-810H 514.8 · 516.8"), ("철도 충격", "MIL-STD-810H 526.2"), ("수송 규격", "ISO 668 · 1496-1"), ("방진 구조", "쉘터 – 랙 – 장비 3단계")],
      "※ 구성안(제작·시험 전). 시험 수준·후크 높이·허용 중량은 발주처 요구와 운용 차량 제원으로 확정. 그림은 개념도(AI 생성).")
# ── 하드웨어 ②
s2 = new_slide("3-4.  ⑤ EMS 하드웨어 ② — EMP 방호 · 전원 · 연산 · 접속", "차폐 구역 + 관통부 보호(전원은 필터, 신호는 광)  |  무정전 전원  |  서버·제어망 이중화  |  접속반 한 곳에서 연결")
tile(s2, 0, 4, "hw_emp", "EMP / EMI 방호", ["금속 차폐 쉘터, 출입문 가스켓", "전원: HEMP 필터 + 서지 보호기", "신호: 광케이블을 도파관으로 관통, 단일 접지점"], HW)
tile(s2, 1, 4, "hw_power", "전원", ["상전·체계 모선·차량 28 V 입력 선택", "온라인 무정전 전원 — 외부 정전에도 감시·제어 유지", "서버·스위치 A·B 분기 회로 분리"], HW)
tile(s2, 2, 4, "hw_compute", "연산 · 제어망", ["러기드 서버 주·예비, 운용 콘솔", "제어망 스위치 A·B(경로 이중화), 직렬 게이트웨이", "GPS 시각 서버(폐쇄망 시각 오류 대책)"], HW)
tile(s2, 3, 4, "hw_panel", "외부 접속반", ["군용 원형 커넥터·야전용 광 커넥터", "키·색·꼬리표로 오결선 방지", "연결 뒤 EMS 진단 도구로 자동 확인"], HW)
strip(s2, [("EMP 방호 기준", "MIL-STD-188-125-2"), ("전자파", "MIL-STD-461G"), ("차량 전원", "MIL-STD-1275E"), ("이중화", "서버 2 · 제어망 A·B")],
      "※ 방호 수준(완전 / 일부 + 신속 복구)은 발주처 요구로 확정. 서버 주·예비 자동 전환은 개발 과제(현재는 수동 교체). 그림은 개념도(AI 생성).")
# ── 소프트웨어 ①
s3 = new_slide("3-4.  ⑤ EMS 소프트웨어 ① — 한 화면 통합 감시 · 제어", "작전지·주둔지 겸용  |  ESS·태양광·수소·디젤·주둔지 기존 발전기 통합 운용  |  오프라인 학습 AI 예측")
tile(s3, 0, 4, "overview", "개요 화면", ["핵심 지표와 작전지 배치도를 한 화면에", "자립 지속시간·예비력 상시 표시", "운용 장소·태세(평시·저소음·자립) 전환"], SW)
tile(s3, 1, 4, "r20_sld_gdg", "단선 결선도", ["모선·차단기·전력 흐름 실시간 표시", "그림: 주둔지 정전 → ESS 무정전, 기존 발전기 기동", "태양광 우선, ESS 로 발전기 부하율 유지"], SW)
tile(s3, 2, 4, "r18_ctl_garrison", "설비 제어", ["선택 → 실행 2단계 지령, 응답·완료 확인", "주둔지: 역송 없이 전기료 절감·정전 대비", "지령 실패 시 재지령 → 대체 전원"], SW)
tile(s3, 3, 4, "energy", "발전 · 예측", ["현장 이력만으로 학습(외부 망 불필요)", "24시간 부하·태양광 예측과 운전 계획", "이력 부족·오차 과대 시 규칙 운전"], SW)
strip(s3, [("감시 주기", "1 초"), ("연동 장치", "7 종 · Modbus TCP"), ("통신 경로", "A · B 이중화"), ("부하 관리", "3 → 2등급 자동 차단")],
      "※ 화면은 가상 장치(Modbus TCP 모의 서버) 연동 상태의 실제 소프트웨어 화면이다. 실장비 연동시험(FAT)·현장 시운전(SAT) 전.")
# ── 소프트웨어 ②
s4 = new_slide("3-4.  ⑤ EMS 소프트웨어 ② — 고장 대응 · 현장 디버깅 · 신뢰성", "고장을 바로 보이고, 현장에서 원인을 찾고, 시험으로 뒷받침  |  FMEA·FTA 로 위험 관리")
tile(s4, 0, 4, "fault_sld", "고장 표시", ["차단기 트립·통신 두절을 결선도에 즉시 표시", "두절 장치는 '####', 지령 자동 차단", "1등급 부하는 EMS 가 차단하지 않음"], SW)
tile(s4, 1, 4, "alarms", "경보", ["4단계 우선순위, 반복 경보는 횟수로 집계", "지령·설정 변경은 위변조 방지 기록", "운용자 확인(ack) 관리"], SW)
tile(s4, 2, 4, "eng_trace", "통신 추적", ["Modbus 프레임을 화면에서 해석", "레지스터 탐색·값 강제·고장 주입", "32비트 바이트 순서 4종 자동 제안"], SW)
tile(s4, 3, 4, "comm", "통신 진단", ["장치·경로별 상태와 응답 시간", "현장 진단 도구: 7단계 자동 진단·보고서", "장치별 연동·디버깅 안내서 7종"], SW)
strip(s4, [("자동 시험", f"{NT} 건 통과"), ("실행률 (문장 / 분기)", f"약 {ST:.0f} % / {BR:.0f} %"), ("FMEA 고장모드", "61 건"), ("FTA 단일 고장점", "15 개 식별")],
      f"※ 수치는 EMS 소프트웨어 {REV} 기준(가상 장치 검증). 군 SW 신뢰성 등급별 목표값은 발주처 기준 확인 필요. FMEA 의 S·O·D 는 제안값.")
# ── EMS 장(9쪽) 바로 뒤로 옮기고 쪽 번호 갱신
lst = p.slides._sldIdLst; ids = list(lst); new = ids[N0:]
for k, e in enumerate(new): lst.remove(e); lst.insert(9 + k, e)
tot = len(p.slides)
for n, s in enumerate(p.slides, 1):
    for sh in s.shapes:
        if sh.has_text_frame and re.fullmatch(r"\s*\d+\s*/\s*\d+\s*", sh.text_frame.text):
            r = sh.text_frame.paragraphs[0].runs; r[0].text = f"{n} / {tot}"
            for x in r[1:]: x.text = ""
buf = io.BytesIO(); p.save(buf)


def shrink(data):
    """불투명한 큰 PNG 를 JPEG 로 바꿔 용량을 줄인다(관계 파일의 이름도 함께 고친다). 투명한 그림과 작은 그림은 그대로 둔다."""
    from PIL import Image
    zin = zipfile.ZipFile(io.BytesIO(data)); ren = {}; body = {}
    for i in zin.infolist():
        b = zin.read(i.filename)
        if i.filename.startswith("ppt/media/") and i.filename.lower().endswith(".png") and len(b) > 400_000:
            im = Image.open(io.BytesIO(b))
            if im.mode in ("RGB", "L") or (im.mode in ("RGBA", "LA", "P") and im.convert("RGBA").getextrema()[3][0] == 255):
                o = io.BytesIO(); im.convert("RGB").save(o, "JPEG", quality=90, optimize=True)
                new = i.filename[:-4] + "_c.jpg"; ren[os.path.basename(i.filename)] = os.path.basename(new); body[new] = o.getvalue(); continue
        body[i.filename] = b
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, b in body.items():
            if name.endswith(".rels"):
                t = b.decode("utf-8")
                for a, c in ren.items(): t = t.replace("media/" + a + '"', "media/" + c + '"')
                b = t.encode("utf-8")
            elif name == "[Content_Types].xml" and b'Extension="jpg"' not in b:
                b = b.replace(b"<Default ", b'<Default Extension="jpg" ContentType="image/jpeg"/><Default ', 1)
            z.writestr(name, b)
    return out.getvalue(), len(ren)


data, n = shrink(buf.getvalue())
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "wb") as f: f.write(data)
Presentation(OUT)                                       # 다시 열어 손상 여부 확인
if len(data) > LIMIT: sys.exit(f"용량 초과: {len(data) / 1e6:.1f} MB")
print("saved", os.path.abspath(OUT), f"{tot}장, {len(data) / 1e6:.1f} MB (그림 {n}개 재압축)")
