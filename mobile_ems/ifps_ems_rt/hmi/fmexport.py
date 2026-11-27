"""FMEA · FAT 내보내기: 지금 화면에 보이는 구성(장비 대수 · 모선 · 환망 · 부하)으로 문서를 만든다.

  GET /api/archive/fmexport?doc=fmea&fmt=html   FMEA · FTA 워크벤치(문서 묶음의 것과 같은 화면 · 같은 Excel 내보내기)에 '현장 구성 · FAT 점검표'를 채운 것
  GET /api/archive/fmexport?doc=fat&fmt=html    FAT 점검표(인쇄용 한 쪽 문서)
  GET /api/archive/fmexport?doc=site&fmt=xlsx   현장 구성 FMEA 펼침 + FAT 점검표(Excel)
  GET /api/archive/fmexport?doc=site&fmt=json   같은 자료(빌드가 문서 묶음에 넣을 때 쓴다)
운용자 로그인이 필요하다. 계산은 ifps_ems_rt/fmsite.py, 워크벤치 양식은 docs/fmea/(build_fmea.render)다 — 양식을 여기서 따로 만들지 않는다.
"""
import html as _h, importlib.util, json, os, time
from urllib.parse import quote
from .. import fmsite
from . import xlsxw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
NOTE = ("이 표는 TPCS 가 지금 인식한 구성에서 자동으로 펼친 것이다. 심각도 · 발생도 · 검출도는 원래 항목의 값을 따르며 새로 매기지 않았다 — '재검토' 표시가 있는 줄은 사람이 다시 본다. "
        "FAT 의 번호 칸은 비워 두었다(정한 번호 체계를 적는다). 합격 기준의 시간은 설정값(환망의 차단 · 투입 시간)이며 현장 보호 설정값이 아니다.")


def site(eng):
    """지금 구성으로 펼친 자료(fmsite.build)."""
    with eng.lock: snap = eng.snapshot()
    return fmsite.build(snap, eng.cfg.get("ring", {}), time.strftime("%Y-%m-%d %H:%M"))


def _rev():
    try:
        with open(os.path.join(ROOT, "VERSION"), encoding="utf-8") as f: return f.read().strip()
    except OSError: return "Rev"


def fmea_html(data, rev):
    """FMEA · FTA 워크벤치 HTML(docs/fmea 의 양식 그대로)."""
    path = os.path.join(ROOT, "docs", "fmea", "build_fmea.py")
    if not os.path.exists(path): raise FileNotFoundError("FMEA 양식(docs/fmea)이 이 설치본에 없습니다")
    spec = importlib.util.spec_from_file_location("ems_build_fmea", path); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod.render(rev, data["when"][:10], data)[0]


def _table(head, rows, blank=()):
    th = "".join(f"<th>{_h.escape(h)}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f'<td class="{"b" if i in blank else ""}">{_h.escape(str(c))}</td>' for i, c in enumerate(r)) + "</tr>" for r in rows)
    return f"<table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>"


def fat_html(data, rev):
    """FAT 점검표 — 인쇄해서 결과를 적는 한 쪽 문서."""
    sm = "".join(f"<tr><th>{_h.escape(k)}</th><td>{_h.escape(v)}</td></tr>" for k, v in data["summary"])
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>IFPS TPCS FAT 점검표 {rev}</title><style>
body{{font-family:"Malgun Gothic","맑은 고딕",sans-serif;font-size:11px;color:#222;margin:18px}} h1{{font-size:18px;margin:0 0 4px}} h2{{font-size:13px;margin:16px 0 6px}} p{{margin:4px 0;color:#555}}
table{{border-collapse:collapse;width:100%}} th,td{{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}} thead th{{background:#e7e0d0}} td.b{{min-width:54px}} .sm th{{width:90px;background:#f3efe4}}
@media print{{body{{margin:8mm}} tr{{page-break-inside:avoid}}}}</style></head><body>
<h1>IFPS 이동형 전력체계 TPCS — FAT 점검표(현장 구성 반영)</h1><p>{rev} · 만든 때 {_h.escape(data["when"])} · 항목 {len(data["fat"])}건</p>
<h2>1. 구성 요약</h2><table class="sm">{sm}</table>
<h2>2. 점검 항목</h2>{_table(data["fat_head"], data["fat"], blank=(0, 7, 8))}
<p>{_h.escape(NOTE)}</p><p>시험자: ________________ &nbsp; 확인자: ________________ &nbsp; 날짜: ________________</p></body></html>"""


def site_xlsx(data, rev):
    """현장 구성 FMEA 펼침 + FAT 점검표(Excel)."""
    cover = [["#IFPS TPCS 현장 구성 반영 — FMEA 펼침 · FAT 점검표", ""], ["리비전", rev], ["만든 때", data["when"]]] + [[k, v] for k, v in data["summary"]] + [["알림", NOTE]]
    return xlsxw.write([("00_구성요약", cover, [16, 110]),
                        ("21_현장구성FMEA", [["#" + data["fm_head"][0]] + data["fm_head"][1:]] + data["fmea"], [10, 34, 34, 70, 44, 9]),
                        ("22_FAT점검표", [["#" + data["fat_head"][0]] + data["fat_head"][1:]] + data["fat"], [8, 8, 26, 30, 36, 60, 16, 10, 18])])


def http_get(hd, eng, q):
    """내보내기 GET — 운용자."""
    if eng is None: return hd._err(403, "기록 조회기에서는 내보낼 수 없습니다(구성은 TPCS 가 안다)")      # pylint: disable=protected-access
    if hd._sess("operator") is None: return None                                                          # pylint: disable=protected-access
    doc, fmt = q.get("doc", "fmea"), q.get("fmt", "html"); rev = _rev(); data = site(eng); stamp = time.strftime("%Y%m%d_%H%M")
    try:
        if (doc, fmt) == ("fmea", "html"): name, body, ct = f"IFPS_TPCS_FMEA_FTA_{rev}_{stamp}.html", fmea_html(data, rev), "text/html; charset=utf-8"
        elif (doc, fmt) == ("fat", "html"): name, body, ct = f"IFPS_TPCS_FAT_checklist_{rev}_{stamp}.html", fat_html(data, rev), "text/html; charset=utf-8"
        elif (doc, fmt) == ("site", "xlsx"): name, body, ct = f"IFPS_TPCS_FMEA_FAT_site_{rev}_{stamp}.xlsx", site_xlsx(data, rev), XLSX
        elif (doc, fmt) == ("site", "json"): return hd._send(200, json.dumps(data, ensure_ascii=False))     # pylint: disable=protected-access
        else: return hd._err(400, "doc · fmt 오류")                                                        # pylint: disable=protected-access
    except (OSError, ValueError, KeyError) as e:
        return hd._err(503, f"문서를 만들지 못했습니다: {e}")                                               # pylint: disable=protected-access
    return hd._send(200, body, ct, {"Content-Disposition": "attachment; filename*=UTF-8''" + quote(name)})  # pylint: disable=protected-access
