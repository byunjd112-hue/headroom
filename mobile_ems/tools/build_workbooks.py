# -*- coding: utf-8 -*-
"""배전체계 계산서 · 개발비 워크북 보완본을 만든다(사용자 원본을 읽어 시트 · 줄을 더한다 — 원본 파일은 바꾸지 않는다).

  python tools/build_workbooks.py <Rev> [원본 폴더] [출력 폴더]
  원본 폴더(기본 docs/xlsx_base, 저장소 제외)에 두 파일이 있어야 한다. 없으면 건너뛴다.
    · *연동계산서*Rev08*.xlsx 또는 IFPU*.xlsx  — IFPU 케이블·보호기 단계별 연동 계산서(IFPU-C-001)
    · *개발비*.xlsx 또는 이름에 '배전'이 든 개발비 파일 — ⑥ 이동형 배전·변압체계 개발비용
보완 내용(EMS 의 공급 경로 · 무정전 구성과 맞춘 것)
  계산서: 조건설정에 우회 결선 · 1등급 부하의 N+1 입력을 더하고, 새 시트 '07A_우회결선·N+1'에서 기존 표(03_입력기준의 도체 정수 · 허용전류 · 온도 보정)와 기존 예산(전압강하)을 그대로 써서 계산한다.
  개발비: 시제작비에 PPDU-20 · 우회 결선 케이블 · 절체 스위치, 시험평가비에 우회 절체 · N+1 시험을 더한다. 새 품목의 단가는 공개 시세를 임시로 넣은 것이다(시트 '보완내역'에 출처 · 환율 · 한계).
수식은 Excel 이 열 때 계산한다."""
import glob, os, sys
from copy import copy
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment

SAND = PatternFill("solid", fgColor="F3E9D2"); NOTE = Font(color="8A6D3B", italic=True); BOLD = Font(bold=True)
# 새 품목의 임시 단가(백만원) — 공개 시세를 어림 환율로 바꾼 값. 견적으로 바꿔야 한다
PRICE = {"ppdu": (3.6, "63 A 3상 IP67 휴대용 분전함(상용품) £432~2,045/대의 상단, £1 ≈ 1,750원 — 군용화 · 시제 개발 가산 없음", "rubberbox.co.uk"),
         "cable_m": (0.025, "고무 유연 케이블 H07RN-F 5심 6 ㎟ £12.5~14.4/m", "farnell.com · rs-online.com"),
         "conn": (0.10, "IEC 60309 16 A 5극 IP67 플러그 약 54~116달러(호주 · 뉴질랜드)/개", "schnap.com.au · rs-online.com"),
         "ats": (1.0, "16 A급 자동 절체기(단상) 약 NZ$1,236/대 — 3상 정지형(STS)의 공개 가격은 찾지 못함", "pbtech.co.nz"),
         "dio": (0.6, "16점 디지털 입력 원격 I/O(Modbus TCP, 상용품) 약 US$414/대, 달러 ≈ 1,400원 어림 — 군용화 · 배선 공사비 없음", "newegg.com")}


def _find(folder, *keys):
    for f in sorted(glob.glob(os.path.join(folder, "*.xlsx"))):
        if any(k in os.path.basename(f) for k in keys): return f
    return None


def _style(ws, src, dst):
    """src 줄의 서식을 dst 줄에 옮긴다."""
    for c in ws[src]:
        d = ws.cell(row=dst, column=c.column)
        if c.has_style: d.font, d.border, d.fill, d.number_format, d.alignment = copy(c.font), copy(c.border), copy(c.fill), c.number_format, copy(c.alignment)
    ws.row_dimensions[dst].height = ws.row_dimensions[src].height


def _move_down(ws, first, last, by):
    """first~last 줄을 by 줄 아래로(값 · 서식). 병합은 그 범위에 있으면 함께 옮긴다. 수식의 줄 번호는 호출한 쪽이 다시 쓴다."""
    merged = [m for m in list(ws.merged_cells.ranges) if first <= m.min_row <= last]
    for m in merged: ws.unmerge_cells(str(m))
    for r in range(last, first - 1, -1):
        for c in ws[r]:
            d = ws.cell(row=r + by, column=c.column); d.value = c.value
            if c.has_style: d.font, d.border, d.fill, d.number_format, d.alignment = copy(c.font), copy(c.border), copy(c.fill), c.number_format, copy(c.alignment)
            c.value = None
        ws.row_dimensions[r + by].height = ws.row_dimensions[r].height
    for m in merged: ws.merge_cells(start_row=m.min_row + by, end_row=m.max_row + by, start_column=m.min_col, end_column=m.max_col)


# ───────────────────────── 계산서
def calc_book(src, dst, rev, ems_rev):
    wb = openpyxl.load_workbook(src); c2 = wb["02_조건설정"]; r0 = c2.max_row + 2
    c2.cell(row=r0, column=2, value=f"우회 결선 · 1등급 부하의 배전체계 N+1 (EMS {ems_rev} 의 무정전 구성)").font = BOLD
    IN = [("G1_KW", "1등급 부하 하나의 정격(가장 큰 것)", 30, None, "kW", "EMS 기본 부하 목록의 지휘통제 30 kW"),
          ("PPDU_USE", "병렬 배전체계 한 대에 싣는 몫", 1, None, "", "1 = 정격까지. 전류 분담이 고르지 않을 것에 대비해 낮추면 대수가 는다(가정)"),
          ("N1_SPARE", "1등급 부하의 여유 대수(N+1)", 0, 1, "대", "개선: 한 대가 고장 나도 남은 것으로 정격을 감당"),
          ("FSU_OUT", "구간분전함 출력 회로 수", 4, None, "회로", "제안 발표 자료의 FSU 사양"),
          ("BY_A", "우회 결선 회로 정격(PPDU CH-2)", 16, None, "A", "PPDU-20 상세기술자료: CH-2 3상 16 A 환상 연결"),
          ("L_BY", "우회 결선 길이", "=2*$C$56+$C$57", "=2*$D$56+$D$57", "m", "가정: 상시 개방점 건너편 구간분전함까지 = 링 2구간 + 입력 길이. 실제 포설 경로로 확정"),
          ("BY_S", "우회 결선 굵기(현행은 입력, 개선은 권장값)", 6, "='07A_우회결선·N+1'!$C$31", "㎟", "현행: PPDU 3Φ 분기 릴과 같은 굵기 가정"),
          ("VD_BY", "우회 중 PPDU 입력까지 허용 강하", "=$C$11", "=$D$11", "%", "우회는 비상 운전 — 총 허용(5%)까지 본다(가정). 평소 예산은 VD_UP")]
    row = {}
    for k, (key, name, cur, imp, unit, note) in enumerate(IN, 1):
        r = r0 + k; row[key] = r; _style(c2, 57, r)
        for col, v in zip("ABCDEF", (key, name, cur, f"=$C${r}" if imp is None else imp, unit, note)): c2[f"{col}{r}"] = v
    I = lambda key, col: f"'02_조건설정'!${col}${row[key]}"
    ws = wb.create_sheet("07A_우회결선·N+1", wb.sheetnames.index("07_링_N-1") + 1); base = wb["07_링_N-1"]
    for col, w in zip("ABCD", (40, 26, 26, 62)): ws.column_dimensions[col].width = w
    ws["A1"] = "우회 결선 · 1등급 부하의 배전체계 N+1 검토"; ws["A1"].font = copy(base["A1"].font)
    ws["A2"] = "1등급 부하의 배전체계마다 둘째 입력(우회 결선)을 반대쪽 급전의 구간분전함에서 받는다 — 평소 열림, 제 구간분전함이 무전압일 때만 닫힘. 입력은 02_조건설정, 표값은 03_입력기준"
    for col, v in zip("ABCD", ("항목", "현행", "개선", "비고")):
        ws[f"{col}4"] = v; s = base[f"{col}4"]; d = ws[f"{col}4"]; d.font, d.fill, d.border, d.alignment = copy(s.font), copy(s.fill), copy(s.border), copy(s.alignment)
    UN, PF, SQ = "'03_입력기준'!$C$6", "0.9", "SQRT(3)"
    def R(n, name, f, note=""):
        """한 줄: f 는 열 글자(B · C)와 조건설정 열 글자(C · D)를 받는 수식 틀"""
        ws[f"A{n}"] = name; ws[f"B{n}"] = f("B", "C"); ws[f"C{n}"] = f("C", "D"); ws[f"D{n}"] = note
        for col in "ABCD": d = ws[f"{col}{n}"]; s = base[f"{col}6"]; d.font, d.border, d.alignment = copy(s.font), copy(s.border), copy(s.alignment)
    def H(n, text): ws[f"A{n}"] = text; ws[f"A{n}"].font = BOLD
    H(5, "A. 1등급 부하 앞의 배전체계 대수")
    R(6, "1등급 부하 정격(kW)", lambda b, c: f"={I('G1_KW', c)}")
    R(7, "배전체계 한 대에 싣는 한계(kW)", lambda b, c: f"='02_조건설정'!${c}$53*{I('PPDU_USE', c)}", "PPDU 정격 × 싣는 몫")
    R(8, "정격을 감당하는 대수", lambda b, c: f"=ROUNDUP({b}6/{b}7,0)")
    R(9, "적용 대수(N+1 · 우회 결선 전류 반영)", lambda b, c: f"=MAX({b}8+{I('N1_SPARE', c)},IF({I('N1_SPARE', c)}>0,ROUNDUP({b}6/{b}19,0),0))", "여유 대수를 두는 구성에서는 우회 중 한 줄의 전류가 회로 정격 이내가 되도록 더 늘린다(EMS 와 같은 규칙)")
    R(10, "구간분전함 출력 회로 판정", lambda b, c: f'=IF({b}9<={I("FSU_OUT", c)},"적합","부적합(출력 "&{I("FSU_OUT", c)}&"회로 초과)")', "배전체계 한 대가 출력 회로 하나")
    R(11, "평소 한 대의 몫(kW)", lambda b, c: f"={b}6/{b}9")
    R(12, "평소 한 대의 전류(A)", lambda b, c: f"={b}11*1000/({SQ}*{UN}*{PF})", "역률 0.9(07_링_N-1 과 같은 값)")
    R(13, "한 대 고장 때 남은 것의 몫(kW)", lambda b, c: f'=IF({b}9<=1,"공급 불가",{b}6/({b}9-1))')
    R(14, "한 대 고장 판정", lambda b, c: f'=IF({b}9<=1,"부적합(1대뿐 — 정전)",IF({b}13<={b}7+0.0001,"적합","부적합(남은 것 과부하 "&TEXT({b}13,"0.0")&"kW)"))', "N+1 의 목적")
    H(16, "B. 우회 결선 회로(PPDU CH-2 → 반대쪽 급전의 구간분전함)")
    R(17, "우회 중 한 줄의 전류 Ib(A)", lambda b, c: f"={b}12", "우회 때도 병렬 대수는 같다(모두 우회)")
    R(18, "회로 정격 In(A)", lambda b, c: f"={I('BY_A', c)}")
    R(19, "한 줄이 실을 수 있는 전력(kW)", lambda b, c: f"={SQ}*{UN}*{b}18*{PF}/1000", "역률 1 이면 10.5 kW(자료의 표기), 0.9 면 약 9.5 kW")
    R(20, "굵기(㎟)", lambda b, c: f"={I('BY_S', c)}")
    R(21, "외기 보정 kt", lambda b, c: f"=INDEX('03_입력기준'!$B$37:$B$44,MATCH(CEILING('02_조건설정'!${c}$6,5),'03_입력기준'!$A$37:$A$44,0))", "외기 최고온도를 5℃ 단위로 올려 적용(계산서의 방식)")
    R(22, "허용전류 Iz(A)", lambda b, c: f"=INDEX('03_입력기준'!$E$19:$E$34,MATCH({b}20,'03_입력기준'!$A$19:$A$34,0))*{b}21", "3심 부하 도체, 포설방법 E. 릴에 감은 채 쓰면 K_REEL 을 더 곱한다")
    R(23, "길이(m)", lambda b, c: f"={I('L_BY', c)}")
    R(24, "우회 결선 강하(%)", lambda b, c: f"={SQ}*{b}17*{b}23/1000*(INDEX('03_입력기준'!$B$19:$B$34,MATCH({b}20,'03_입력기준'!$A$19:$A$34,0))*'03_입력기준'!$C$10*{PF}+'03_입력기준'!$C$12*SIN(ACOS({PF})))/{UN}*100")
    R(25, "우회 쪽 구간분전함까지의 링 강하(%)", lambda b, c: f"='07_링_N-1'!{b}15", "반대쪽 급전의 정상 최원단 강하(보수적으로 최원단 값)")
    R(26, "우회 중 PPDU 입력 강하(%)", lambda b, c: f"={b}24+{b}25")
    R(27, "전류 판정(Ib ≤ In ≤ Iz)", lambda b, c: f'=IF({b}17>{b}18+0.0001,"부적합(Ib "&TEXT({b}17,"0.0")&"A > In "&{b}18&"A — 대수를 늘리거나 회로 정격 상향)",IF({b}18>{b}22,"부적합(In > Iz — 굵기 상향)","적합"))')
    R(28, "과부하 보호 판정(I2 ≤ 1.45·Iz)", lambda b, c: f'=IF(INDEX(\'03_입력기준\'!$B$47:$B$52,MATCH("MCCB",\'03_입력기준\'!$A$47:$A$52,0))*{b}18<=1.45*{b}22,"적합","부적합(굵기 상향)")', "KS C IEC 60364-4-43")
    R(29, "강하 판정", lambda b, c: f'=IF({b}26<={I("VD_BY", c)}+0.0001,"적합","부적합("&TEXT({b}26,"0.00")&"% > "&{I("VD_BY", c)}&"%)")', "우회 중 허용 강하(조건설정 VD_BY)")
    H(30, "C. 권장값")
    # 권장 굵기: 표의 굵기마다 강하 · 허용전류를 보고 처음으로 둘 다 맞는 것
    for k in range(16): ws[f"F{6 + k}"] = f"='03_입력기준'!$A${19 + k}"
    for col, cc in (("G", "C"), ("H", "D")):
        b = "B" if col == "G" else "C"
        for k in range(16):
            r = 6 + k; ws[f"{col}{r}"] = (f"=IF(AND({SQ}*{b}$17*{I('L_BY', cc)}/1000*('03_입력기준'!$B${19 + k}*'03_입력기준'!$C$10*{PF}+'03_입력기준'!$C$12*SIN(ACOS({PF})))/{UN}*100+{b}$25<={I('VD_BY', cc)},"
                                         f"'03_입력기준'!$E${19 + k}*{b}$21>={b}$18,INDEX('03_입력기준'!$B$47:$B$52,MATCH(\"MCCB\",'03_입력기준'!$A$47:$A$52,0))*{b}$18<=1.45*'03_입력기준'!$E${19 + k}*{b}$21),$F{r},9999)")
    ws["F4"], ws["G4"], ws["H4"] = "굵기(㎟)", "현행 조건에서 맞으면 굵기", "개선 조건에서 맞으면 굵기"
    for col in "FGH": ws[f"{col}4"].font = BOLD; ws.column_dimensions[col].width = 22
    R(31, "우회 결선 권장 굵기(㎟)", lambda b, c: f'=IF(MIN({"G" if b == "B" else "H"}6:{"G" if b == "B" else "H"}21)=9999,"해당 없음(길이 단축)",MIN({"G" if b == "B" else "H"}6:{"G" if b == "B" else "H"}21))', "강하 · 허용전류 · 과부하 보호를 모두 맞추는 가장 가는 굵기(F~H 열)")
    R(32, "우회 중 전류를 맞추는 대수", lambda b, c: f"=ROUNDUP({b}6/{b}19,0)", "한 줄 전류가 회로 정격 이내가 되는 병렬 대수")
    R(33, "종합 판정", lambda b, c: f'=IF(AND({b}10="적합",{b}14="적합",{b}27="적합",{b}28="적합",{b}29="적합"),"적합","부적합")')
    for n, t in ((35, "※ 우회 결선은 평소 열어 둔다(두 급전을 함께 잇지 않는다 — 순환 전류 방지). 닫히는 조건과 시간(STS 10 ms 또는 5초 이내)은 15_FAT·SAT 의 절체 시험으로 확인한다."),
                 (36, "※ 길이 · 굵기 · 한 대에 싣는 몫은 가정이다. 실제 포설 경로와 하드웨어 설계로 확정하고 02_조건설정의 값을 바꾼다."),
                 (37, f"※ EMS {ems_rev} 의 [정격 · 가정값]과 같은 항목이다: 배전체계 정격, 싣는 몫, N+1, 우회 결선의 유무 · 용량, 구간분전함 출력 회로 수.")):
        ws[f"A{n}"] = t; ws[f"A{n}"].font = NOTE
    for r in (row["G1_KW"], row["PPDU_USE"], row["N1_SPARE"], row["FSU_OUT"], row["BY_A"]): c2[f"C{r}"].fill = SAND
    # 표지 · 변경이력 · 연계문서
    cv = wb["00_표지"]; cv["B5"] = f"{rev} ({ems_rev} 연동 보완)"
    h = wb["22_변경이력"]; r = h.max_row + 1; _style(h, r - 1, r)
    h[f"A{r}"], h[f"B{r}"], h[f"C{r}"] = rev, "EMS " + ems_rev, ("EMS 의 무정전 구성 반영: 02_조건설정에 우회 결선 · 1등급 부하 N+1 입력 8개, 새 시트 07A_우회결선·N+1(대수 · 구간분전함 출력 회로 · 한 대 고장 때의 몫, 우회 회로의 전류 · 허용전류 · 과부하 보호 · 전압강하, 권장 굵기 · 대수). "
                                                              "기존 시트의 계산값은 바꾸지 않았다. 연계 문서에 이동형 배전체계 무정전 구성 기술자료 등록.")
    d = wb["23_연계문서"]; _move_down(d, 16, d.max_row, 1); _style(d, 14, 15)
    for col, v in zip("ABCDEF", (11, "이동형 배전체계 무정전 구성 기술자료", f"IFPS_이동형배전체계_무정전구성_기술자료_{ems_rev}.pptx", ems_rev, "", "공급 경로(구간분전함 → 배전체계 → 부하), 병렬 · N+1, 우회 결선, 무정전 점검 — 우회 회로의 계산은 07A")): d[f"{col}15"] = v
    d["C5"] = os.path.basename(dst); d["D5"] = rev
    wb.save(dst)


# ───────────────────────── 개발비
def cost_book(src, dst, rev, ems_rev):
    wb = openpyxl.load_workbook(src); m = wb["시제작비"]; n_ppdu, n_by, l_by, n_dio = 18, 8, 90, 3      # 원격 I/O 3대 = 48점: 추가 장비 차단기 16개(추가 자리 13 + 복합전력 차량별 ESS 3)의 개폐 · 트립 접점 32점 + 여유
    p_ppdu = round(n_ppdu * PRICE["ppdu"][0]); p_by = round(n_by * l_by * PRICE["cable_m"][0] + 2 * n_by * PRICE["conn"][0]); p_ats = round(n_by * PRICE["ats"][0]); p_dio = round(n_dio * PRICE["dio"][0], 1)
    add = [("완제 시제", f"⑥-2 PPDU-20 휴대용 배전체계 {n_ppdu}대(20 kW · IP67 · 6회로) — 임시 단가", 2, p_ppdu, (0, p_ppdu, p_ppdu), "P-1, P-2"),
           ("완제 시제", f"우회 결선 케이블(5심 6 ㎟ {l_by} m × {n_by}줄)·IP67 커넥터 — 임시 단가", 2, p_by, (0, 0, 2 * p_by), "P-1, P-2"),
           ("완제 시제", f"PPDU 우회 절체 스위치 {n_by}대(16 A급) — 임시 단가", 2, p_ats, (0, 0, 2 * p_ats), "P-1, P-2"),
           ("완제 시제", f"장비별 차단기 상태 신호 연동 — 원격 I/O 16점 {n_dio}대(추가 장비 차단기 16개의 개폐 · 트립 접점) — 임시 단가", 2, p_dio, (0, 0, 2 * p_dio), "P-1, P-2")]
    k = len(add); _move_down(m, 23, 25, k)                                   # 공통 · 합계 · 정합성 줄을 아래로
    for i, (a, b, q, d, yrs, use) in enumerate(add):
        r = 23 + i; _style(m, 22, r)
        for col, v in zip("ABCDEFGHI", (a, b, q, d, f"=C{r}*D{r}", yrs[0], yrs[1], yrs[2], use)): m[f"{col}{r}"] = v
        for col in "CD": m[f"{col}{r}"].fill = SAND
    rc, rt, rv = 23 + k, 24 + k, 25 + k
    m[f"E{rc}"] = f"=C{rc}*D{rc}"
    for col in "EFGH": m[f"{col}{rt}"] = f"=SUM({col}5:{col}{rc})"
    m[f"E{rv}"] = f"=SUM(F{rt}:H{rt})-E{rt}"
    m["A2"] = str(m["A2"].value) + f" / {rev}: PPDU-20 · 우회 결선 · 절체 스위치 · 장비별 차단기 신호 연동 추가(임시 단가 — 「보완내역」 참조)"
    t = wb["시험평가비"]; tests = [("보호시험", "우회 결선 절체(평소 열림 → 제 구간분전함 무전압 때 닫힘, 10 ms 이내 · 복귀 때 재개방)", "자체 시험기준(ATP)", "P-1", 1, 70, 3),
                                   ("보호시험", "배전체계 병렬 · N+1 — 한 대 탈락 때 부하 넘겨받기, 구간분전함 고립 때 1등급 무정전", "자체 시험기준(ATP)", "P-1, P-2", 2, 55, 3),
                                   ("보호시험", "장비별 차단기 상태 · 보호 코드 신호 연동 — 장비마다 차단기를 열고 닫아 화면 · 경보 · 공급 능력 판단 확인(EMS 설치 점검 포함)", "자체 시험기준(ATP)", "P-1, P-2", 1, 55, 3)]
    k2 = len(tests); _move_down(t, 27, t.max_row, k2)
    for i, (a, b, c, dd, e, f, hh) in enumerate(tests):
        r = 27 + i; _style(t, 26, r)
        for col, v in zip("ABCDEFGHI", (a, b, c, dd, e, f, f"=E{r}*F{r}", hh, f'=H{r}&"차년도"')): t[f"{col}{r}"] = v
    last = 26 + k2; tt = 27 + k2
    t[f"E{tt}"], t[f"G{tt}"] = f"=SUM(E5:E{last})", f"=SUM(G5:G{last})"
    for y in (1, 2, 3): t[f"D{tt + 1 + y}"] = f"=SUMIF($H$5:$H${last},{y},$G$5:$G${last})"
    s = wb["총괄요약"]
    for col, c in zip("BCD", "FGH"): s[f"{col}6"] = f"=시제작비!{c}{rt}"
    for col, y in zip("BCD", (1, 2, 3)): s[f"{col}7"] = f"=시험평가비!D{tt + 1 + y}"
    s["A2"] = str(s["A2"].value) + " / PPDU-20 18대 · 1등급 부하 우회 결선 포함"
    u = wb["시제운용·활용계획"]; per = p_ppdu + p_by + p_ats + p_dio
    for r in (6, 7): u[f"I{r}"] = u[f"I{r}"].value + per
    u["F6"] = u["F6"].value + 2; u["F7"] = u["F7"].value + 1; u["I15"] = f"=I14-시제작비!E{rt}"
    u["G6"] = str(u["G6"].value) + "·우회 절체·N+1"; u["G7"] = str(u["G7"].value) + "·N+1"
    n = wb.create_sheet("보완내역"); n.column_dimensions["A"].width = 34; n.column_dimensions["B"].width = 16; n.column_dimensions["C"].width = 70; n.column_dimensions["D"].width = 34
    rows = [(f"보완내역 — {rev} (EMS {ems_rev} 의 무정전 구성 반영)",), (),
            ("더한 것", "금액(백만원)", "산출", "단가 근거(공개 시세 · 임시)"),
            (f"PPDU-20 {n_ppdu}대 / 식", p_ppdu, f"{n_ppdu}대 × {PRICE['ppdu'][0]} 백만원", f"{PRICE['ppdu'][1]} — {PRICE['ppdu'][2]}"),
            (f"우회 결선 케이블 · 커넥터 / 식", p_by, f"{n_by}줄 × {l_by} m × {PRICE['cable_m'][0]} + 커넥터 {2 * n_by}개 × {PRICE['conn'][0]}", f"{PRICE['cable_m'][1]} — {PRICE['cable_m'][2]} / {PRICE['conn'][1]} — {PRICE['conn'][2]}"),
            (f"PPDU 우회 절체 스위치 {n_by}대 / 식", p_ats, f"{n_by}대 × {PRICE['ats'][0]} 백만원", f"{PRICE['ats'][1]} — {PRICE['ats'][2]}"),
            (f"장비별 차단기 상태 신호 연동(원격 I/O {n_dio}대) / 식", p_dio, f"{n_dio}대 × {PRICE['dio'][0]} 백만원", f"{PRICE['dio'][1]} — {PRICE['dio'][2]}"),
            ("시험: 우회 결선 절체", 70, "1회 × 70", "기존 'STS 무정전 절체' 항목의 단가를 준용"),
            ("시험: 병렬 · N+1 · 구간분전함 고립", 110, "2회 × 55", "기존 'FDIR 고장 격리 · 우회 급전 복구' 항목의 단가를 준용"),
            ("시험: 장비별 차단기 신호 연동", 55, "1회 × 55", "기존 'FDIR 고장 격리 · 우회 급전 복구' 항목의 단가를 준용"), (),
            ("한계",), ("· 새 품목의 단가는 공개된 상용품 시세를 어림 환율(£1 ≈ 1,750원, 호주 · 뉴질랜드달러 ≈ 800~900원)로 바꾼 임시값이다. 군용화 · 시제 개발 · 인증 비용이 들어 있지 않아 실제 시제 단가는 더 클 수 있다 — 견적으로 바꿔야 한다.",),
            ("· 우회 결선의 줄 수(8) · 길이(90 m)는 1등급 부하 두 곳에 배전체계 4대씩을 가정한 값이다. 계산서 07A_우회결선·N+1 의 권장 굵기 · 대수가 정해지면 다시 계산한다.",),
            ("· 3상 정지형 절체 스위치(STS)의 공개 가격을 찾지 못해 단상 자동 절체기 시세를 넣었다.",),
            ("· 장비별 차단기 상태 신호는 차단기 보조 접점을 원격 I/O 로 받는다고 가정했다(차단기 16개 × 개폐 · 트립 2점). 보호 계전기가 통신으로 상태를 내주면 이 품목은 줄거나 없어진다. 배선 · 단자 · 공사비는 넣지 않았다.",),
            ("· 인건비 · 기타직접비는 바꾸지 않았다. 간접비 · 재원 분담은 수식으로 따라 바뀐다.",)]
    for i, r in enumerate(rows, 1):
        for j, v in enumerate(r): n.cell(row=i, column=1 + j, value=v)
    n["A1"].font = BOLD
    for c in n[3]: c.font = BOLD
    for r in (4, 5, 6, 7): n[f"B{r}"].fill = SAND
    wb.save(dst)


def main(rev, base, out, calc_rev="Rev09", cost_rev="Rev06"):
    made = []
    a = _find(base, "IFPU", "연동계산서"); b = _find(base, "개발비", "Rev05")
    if a: d = os.path.join(out, f"IFPU_케이블보호기_연동계산서_보완_{rev}.xlsx"); calc_book(a, d, calc_rev, rev); made.append(d)
    if b and b != a: d = os.path.join(out, f"이동형배전변압체계_개발비용_보완_{rev}.xlsx"); cost_book(b, d, cost_rev, rev); made.append(d)
    return made


if __name__ == "__main__":
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    rev = sys.argv[1] if len(sys.argv) > 1 else "Rev00"; base = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "docs", "xlsx_base"); out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(here, "docs", "out")
    made = main(rev, base, out); print("워크북 보완본:", ", ".join(os.path.basename(x) for x in made) if made else "원본이 없어 건너뜀(" + base + ")")
