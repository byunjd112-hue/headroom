# -*- coding: utf-8 -*-
"""EMS FMEA·FTA 통합 분석 워크벤치(HTML 한 파일, 인터넷 없이 열림)를 만든다.

  python docs/fmea/build_fmea.py Rev23 "2026. 11. 16."     → docs/out/IFPS_EMS_FMEA_FTA_통합분석_Rev23.html

자료: data_fmea.py(고장모드), data_fta.py(고장수목·부속 표). 화면·계산: app.js, style.css. 도표·Excel: lib/(Chart.js MIT, SheetJS Apache-2.0).
RPN·등급·확률·최소절단집합·중요도는 화면에서 자료로부터 계산한다(이 스크립트는 자료를 묶기만 한다)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import data_fmea as FM   # noqa: E402
import data_fta as FT    # noqa: E402

OSCALE = [[1, "매우 낮음 (10년 1회 미만)", 0.03, "자동 감시·즉시 경보", 0.1], [2, "매우 낮음", 0.07, "자동 감시·즉시 경보", 1.0], [3, "낮음 (3년 1회)", 0.2, "EMS 경보", 8.0],
          [4, "낮음", 0.33, "EMS 경보", 24.0], [5, "보통 (연 1회)", 0.7, "운전 자료 추이 분석", 168.0], [6, "보통", 1.0, "운전 자료 추이 분석", 720.0],
          [7, "높음 (분기 1회)", 2.0, "정기 점검·시험 때 검출", 2160.0], [8, "높음", 4.0, "정기 점검·시험 때 검출", 4380.0],
          [9, "매우 높음 (월 1회 이상)", 8.0, "상시 감시 불가(고장 후 인지)", 8760.0], [10, "매우 높음", 12.0, "상시 감시 불가(고장 후 인지)", 17520.0]]
NAV = [("dashboard", "01", "대시보드"), ("fmea", "05", "FMEA 워크시트"), ("rpn", "06", "RPN·위험매트릭스"), ("fta", "08", "FTA 고장수목"), ("mcs", "11", "MCS·중요도"),
       ("comm", "12", "연동·CCF·리스크"), ("design", "14", "보완설계·조치계획"), ("qa", "15", "정합성·무결성"), ("scn", "20", "시나리오·FAT 연결"), ("tools", "⚙", "저장·내보내기")]


def scenario_links():
    """운영 시나리오 검증 결과(docs/scenario_results.json)를 읽어 FMEA 와 잇는다: [{name, cat, ref, ok, fat}]. 파일이 없으면 빈 목록."""
    path = os.path.join(HERE, "..", "scenario_results.json")
    if not os.path.exists(path): return []
    with open(path, encoding="utf-8") as f: sc = json.load(f)
    return [{"name": r["name"], "cat": r.get("cat", ""), "ref": r.get("ref", ""), "ok": bool(t["ok"]), "first": bool(r["ok"]), "steps": r["steps"]} for r, t in zip(sc["results"], sc["retest"])]


def build_data(rev, date):
    rows = FM.fmea(); ids = {r["id"] for r in rows}
    gates = {g[0]: g for g in FT.GATES}; be = {b[0]: b for b in FT.BE}
    parent = {}
    for g in FT.GATES:
        for x in [v.strip() for v in g[3].split(",")]:
            if x not in gates and x not in be: raise ValueError(f"{g[0]} 입력 {x} 정의 없음")
            parent.setdefault(x, g[0])
    for b in FT.BE:
        if b[1] != "조건" and b[2] not in ids: raise ValueError(f"{b[0]} 근거 {b[2]} 없음")
        if b[0] not in parent: raise ValueError(f"{b[0]} 수목 미연결")
    for r in rows:                                   # FMEA 의 'FTA 사상' 열은 기본사상 표에서 역으로 만든다(손으로 맞추지 않는다)
        m = [b[0] for b in FT.BE if b[2] == r["id"]]
        r["fta"] = "·".join(m).replace("·BE-", "·") if m else "—"
    tree = []

    def walk(nid, prefix, last, depth):
        g = gates.get(nid); b = be.get(nid)
        lead = "" if depth == 0 else prefix + ("└─ " if last else "├─ ")
        if g: tree.append({"id": nid, "lvl": f"{lead}[{g[1]}] {nid}", "logic": g[1], "desc": g[2], "basis": None, "note": g[5]})
        else: tree.append({"id": nid, "lvl": f"{lead}{'◇' if b[1] == '조건' else '⬡' if b[1] == 'CCF' else '○'} {nid}", "logic": b[1], "desc": b[3], "basis": b[2], "note": b[4]})
        if g:
            kids = [v.strip() for v in g[3].split(",")]
            for i, k in enumerate(kids): walk(k, "" if depth == 0 else prefix + ("    " if last else "│   "), i == len(kids) - 1, depth + 1)
    walk("TOP", "", True, 0)
    order = ["G1", "G2", "G2.1", "G2.2", "G2.3", "G3", "G3.1", "G3.2", "G3.3", "G4", "G4.1", "G5", "TOP"]
    return {"fmea": rows, "oscale": OSCALE, "scn": scenario_links(),
            "be": [{"id": b[0], "type": b[1], "fm": b[2], "desc": b[3], "gate": parent[b[0]], "note": b[4]} for b in FT.BE],
            "gates": [{"id": gates[i][0], "logic": gates[i][1], "desc": gates[i][2], "inputs": gates[i][3], "cls": gates[i][4]} for i in order],
            "tree": tree, "s07_1": FT.S07_1, "s07_2": FT.S07_2, "s07_note": FT.S07_NOTE, "s07_3": FT.S07_3, "s07_4": FT.S07_4, "s08_1": FT.S08_1, "s08_h2": FT.S08_H2, "s08_2": FT.S08_2,
            "s09": FT.S09, "s10": [[str(a[0])] + a[1:] for a in FT.S10], "b_crit": FT.B_CRIT, "b_sys2": FT.B_SYS2, "b_design": FT.B_DESIGN, "b_design_note": FT.B_DESIGN_NOTE,
            "b_after": FT.B_AFTER, "b_abbr": FT.B_ABBR, "b_ref": FT.B_REF, "params": {"tm": 72, "hours": 8760, "beta": 0.1, "he0": 0.1, "he1": 0.03},
            "meta": {"docno": "HAES-IFPS-EMS-FMEA-001", "rev": rev, "date": date, "project": "IFPS 이동형 전력체계 EMS", "org": "",
                     "nOrg": sum(r["grp"] == "본체" for r in rows), "nSup": sum(r["grp"] == "연동" for r in rows)}}


def main(argv=None):
    a = argv or sys.argv[1:]
    with open(os.path.join(HERE, "..", "..", "VERSION"), encoding="utf-8") as f: rev = a[0] if a else f.read().strip()
    date = a[1] if len(a) > 1 else ""
    rd = lambda *p: open(os.path.join(HERE, *p), encoding="utf-8").read()
    data = build_data(rev, date)
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    nav = "\n".join(f'      <a href="#{h}"><span class="k">{k}</span>{t}</a>' for h, k, t in NAV)
    html = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>IFPS EMS FMEA·FTA 통합 분석 워크벤치 {rev}</title>
<!-- 인터넷 없이 동작: 웹 글꼴 미사용, 도표·Excel 기능 내장 -->
<style>
{rd("style.css")}
</style></head><body>
<div class="app">
  <aside class="rail">
    <div class="brand">IFPS EMS FMEA·FTA 통합 분석<small>Failure Analysis Workbench · {rev}</small></div>
    <nav class="nav" id="nav">
{nav}
    </nav>
    <div class="railfoot">{data["meta"]["docno"]} {rev}<br>EMS 본체 {data["meta"]["nOrg"]}건 + 연동 {data["meta"]["nSup"]}건<br>IEC 60812 · IEC 61025 · {date}<br><span id="railstate"></span></div>
  </aside>
  <main class="main" id="main"></main>
</div>
<div class="toast" id="toast"></div>
<div class="drawer" id="drawer"><div class="panel" id="panel"></div></div>
<script>/* Chart.js v4.4.1 (MIT) */
{rd("lib", "chart.min.js")}</script>
<script>/* SheetJS xlsx 0.18.5 (Apache-2.0) */
{rd("lib", "xlsx.min.js")}</script>
<script>
const DATA = {js};
{rd("app.js")}
</script></body></html>
"""
    out = os.path.join(HERE, "..", "out"); os.makedirs(out, exist_ok=True)
    path = os.path.abspath(os.path.join(out, f"IFPS_EMS_FMEA_FTA_통합분석_{rev}.html"))
    with open(path, "w", encoding="utf-8") as f: f.write(html)
    print(f"saved {path}  고장모드 {len(data['fmea'])}건, 기본사상 {len(data['be'])}개, 게이트 {len(data['gates'])}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
