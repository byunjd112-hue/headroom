# -*- coding: utf-8 -*-
"""EMS 운영 보고서(Word)를 그 자리에서 만든다: 현재 현황 · 최근 운영 현황 · 상황 기록 · 운전 시퀀스 · 전기안전 점검 기록 · 자료 보관 상태.

화면의 [보고서 출력]이 부른다. 현장 노트북에서 바로 만들 수 있게 표준 라이브러리만 쓴다(docx.py).
수치는 기록 보관소(archive.db)와 지금 장치에서 읽은 값이다. 가상 장치 모드의 값과 시연용 과거 자료는 그렇게 표시한다.
"""
import json, os, time
from datetime import datetime, timedelta
from .docx import Doc

MODES = [("작전지", "평시", "ESS·태양광 우선, 부족하면 연료전지·디젤 기동. 예비력(N-1) 감시"), ("작전지", "저소음", "디젤 기동 금지. 연료전지로 대신하고 3등급 부하는 자동 차단"),
         ("작전지", "자립", "외부 보급 없이 목표 시간을 버티도록 지속시간을 계산하고 부하 차단을 권고·실행"), ("주둔지 · 상전 연계", "평시", "역송 방지, 최대부하 시간대 ESS 방전으로 수전 억제, 경부하 시간대 충전"),
         ("주둔지 · 상전 연계", "저소음", "평시와 같음(발전기 정지 상태)"), ("주둔지 · 상전 연계", "자립", "자립은 상전 상실을 뜻한다 — 차단기가 닫혀 있으면 경보를 내고 수전을 최소로 묶음"),
         ("주둔지 · 정전", "평시", "ESS·태양광으로 무정전 공급, 부족하면 주둔지 발전기 기동(최소 운전 시간 유지)"), ("주둔지 · 정전", "저소음", "주둔지 발전기를 쓰지 않고 ESS·태양광·연료전지로 공급"),
         ("주둔지 · 정전", "자립", "전시·유사시 상전 상실: ESS·태양광·주둔지 발전기로 자립, 연료 50% 이하 보충 경보")]
RESULT = dict(zip(("pass", "fail", "skip"), ("통과", "실패", "건너뜀")))
OP = {"eq": "=", "ge": "≥", "le": "≤"}
KIND = {"command": "지령", "expect": "판정", "set": "입력", "wait": "대기", "branch": "분기", "response": "고장 주입", "policy": "EMS 정책 실행", "policy_check": "EMS 판단 판정"}


def describe(s):
    """시나리오 한 단계를 한 줄로."""
    t = s["type"]
    if t == "command": return f"{s['device']} {'기동' if s['value'] == 1 else '정지'} 지령"
    if t == "wait": return f"대기 {s['ms']} ms"
    if t == "response": return f"{s['device']} " + ("지령 응답 없음" if s["ms"] < 0 else f"상태 응답 지연 {s['ms']} ms")
    if t == "set": return f"{s['tag']} ← {s['value']}"
    if t == "policy": return f"{ {'auto': 'AUTO', 'manual': 'MANUAL', 'immediate': 'MANUAL · 즉시 실행'}.get(s['control'], s['control'])} · { {'island': '작전지', 'grid': '주둔지'}[s['mode']]} · {s['posture']}"
    if t == "policy_check": return f"{s['metric']} {OP[s['op']]} {s['value']}"
    return f"{s['tag']} {OP[s['op']]} {s['value']}" + (f" (한도 {s['ms']} ms)" if s.get("ms") else "")


def _period(q):
    """보고 구간. days(기본 7일) 또는 from·to(YYYY-MM-DD)."""
    if q.get("from") and q.get("to"):
        a = datetime.strptime(q["from"], "%Y-%m-%d"); b = datetime.strptime(q["to"], "%Y-%m-%d") + timedelta(days=1)
    else:
        days = max(1, min(int(q.get("days", 7)), 1830)); b = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1); a = b - timedelta(days=days)
    return a, b


def _n(v, d=1, unit=""):
    return "—" if v is None else f"{v:,.{d}f}{unit}"


def _current(doc, s):
    """1. 현재 현황"""
    k = s["kpi"]; o = s["ops"]; place = "주둔지" if s["mode"] == "grid" else "작전지"
    doc.h1("1. 현재 현황")
    doc.table(["항목", "값"], [["운용 장소 · 태세", f"{place}{' · 상전 연계' if o['tied'] else ' · 정전(자립 운전)' if o['outage'] else ''} · {o['posture']}"], ["제어 방식", "자동(AUTO)" if s["auto"] else "수동(MANUAL)"],
                               ["운전 정책", s["policy"] or "규칙 운전"], ["운전 모드(설정)", s["run_mode"] + (" · 가상 장치" if s["sim"] else " · 실장비")],
                               ["자립 지속 예상", _n(o.get("autonomy"), 1, " 시간") if isinstance(o.get("autonomy"), (int, float)) else "—"], ["부하 차단 중", ", ".join(o["shed"]) or "없음"]], [30, 70])
    doc.h2("1.1 전력 수급(지금)")
    doc.table(["부하", "태양광", "디젤", "연료전지", "ESS(+방전)", "수전", "주둔지 발전기"], [[_n(k["load"], 1, " kW"), _n(k["pv"], 1, " kW"), _n(k["dg"], 1, " kW"), _n(k["fc"], 1, " kW"), _n(k["ess"], 1, " kW"), _n(k.get("grid"), 1, " kW"), _n(k.get("gdg"), 1, " kW")]])
    doc.table(["ESS 충전율", "수소 잔량", "디젤 연료", "1·2·3등급 부하", "예비력 여유"], [[_n(k["soc"], 1, " %"), _n(k["h2"], 0, " Nm³"), _n(k["fuel"], 0, " L"), f"{_n(k['l1'], 0)} / {_n(k['l2'], 0)} / {_n(k['l3'], 0)} kW", _n(k["reserve_margin"], 0, " kW")]])
    doc.h2("1.2 장치 상태")
    doc.table(["장치", "통신", "운전", "현장 수동", "생존 계수"], [[n, d["link"], "운전" if d["on"] else "정지", "예" if d["manual"] else "아니오", "정지" if d["hb_stop"] else "정상"] for n, d in s["devices"].items()], [20, 20, 20, 20, 20])
    act = [a for a in s["alarms"] if a["state"] == "ACT"]
    doc.h2(f"1.3 발생 중인 경보 ({len(act)}건)")
    doc.table(["등급", "대상", "내용", "발생 시각", "확인"], [[a["prio"], a["src"], a["text"], datetime.fromtimestamp(a["t_on"]).strftime("%m-%d %H:%M:%S"), "확인" if a["acked"] else "미확인"] for a in act[:60]], [8, 12, 52, 18, 10])
    _ring(doc, s.get("ring"))


def _ring(doc, r):
    """1.4 환망(구간분전함 · 휴대용 배전체계) — 환망 화면과 같은 이름 · 상태."""
    if not r: return
    st = {None: "값 없음", 0: "개방", 1: "투입", 2: "차단"}; live = {None: "값 없음", True: "공급", False: "정전"}; end = lambda i: "전원" if i == 0 else r["fsu"][0]["name"] + "(복귀선)" if i == len(r["fsu"]) + 1 else r["fsu"][i - 1]["name"]
    doc.h2("1.4 환망 · 구간분전함 · 휴대용 배전체계")
    doc.p(("전 마디 공급" if r["ok"] else "정전 마디 있음: " + ", ".join(r["isolated"]) if r["isolated"] else "확인 필요") + (" · 차단된 구간 " + ", ".join(str(i) for i in r["cut"]) if r["cut"] else "")
          + (" · 상시 개방점이 닫혀 반대쪽에서 공급 중(여유 없음)" if r["switched"] else "") + f" · 자동 인식: 구간분전함 {len(r['fsu'])}대, 배전체계 {len(r['ppdu'])}대")
    doc.table(["구간", "잇는 곳", "개폐기", "비고"], [[s["i"], f"{end(s['i'])} ↔ {end(s['i'] + 1)}", st.get(s["state"], "?"), "상시 개방점" if s["open"] else ""] for s in r["sections"]], [10, 50, 16, 24])
    doc.table(["구간분전함", "이름", "장치 ID", "전압", "공급"], [[f["id"], f["name"], f["id_read"] if f["id_read"] is not None else "—", _n(f["v"], 0, " V"), live.get(f["live"], "?")] for f in r["fsu"]], [16, 34, 16, 16, 18])
    doc.table(["배전체계", "이름", "연결", "전력", "주 차단기", "접지", "트립한 회로", "중요 부하"],
              [[p["id"], p["name"], p["at"] or "미확인", _n(p["kw"], 1, " kW"), st.get(p["mccb"], "?"), _n(p["gnd"], 0, " Ω"), ", ".join(f"CH{c['n']} {c['name']}" for c in p["ch"] if c["cb"] == 2) or "없음", "예" if p["vital"] else ""] for p in r["ppdu"]], [10, 18, 10, 10, 10, 8, 24, 10])


def _recent(doc, arch, a, b):
    """2. 최근 운영 현황"""
    days = arch.series("day", a.timestamp(), b.timestamp()); tot = lambda c: sum(r[c] or 0.0 for r in days); mx = lambda c: max((r[c] or 0.0 for r in days), default=0.0)
    doc.h1("2. 최근 운영 현황"); doc.p(f"구간: {a:%Y-%m-%d} ~ {b - timedelta(days=1):%Y-%m-%d} ({len(days)}일 기록)")
    load = tot("load_kwh"); gen = tot("dg_kwh") + tot("fc_kwh") + tot("gdg_kwh")
    doc.table(["항목", "값", "항목", "값"], [["부하 전력량", _n(load, 1, " kWh"), "태양광 발전량", _n(tot("pv_kwh"), 1, " kWh")], ["발전기 발전량(디젤·연료전지·주둔지)", _n(gen, 1, " kWh"), "수전량 / 역송량", f"{_n(tot('grid_in_kwh'), 1)} / {_n(tot('grid_out_kwh'), 1)} kWh"],
                                         ["ESS 충전 / 방전", f"{_n(tot('ess_chg_kwh'), 1)} / {_n(tot('ess_dis_kwh'), 1)} kWh", "태양광 비율(부하 대비)", _n(100 * tot("pv_kwh") / load if load else None, 1, " %")],
                                         ["최대 부하", _n(mx("load_max"), 1, " kW"), "최대 수전", _n(mx("grid_max"), 1, " kW")]], [30, 20, 30, 20])
    doc.h2("2.1 일별 실적")
    doc.table(["날짜", "부하 kWh", "태양광 kWh", "발전기 kWh", "수전 kWh", "ESS 충전/방전 kWh", "최대 부하 kW", "평균 충전율 %"],
              [[r["k"] + (" *" if r["demo"] else ""), _n(r["load_kwh"]), _n(r["pv_kwh"]), _n((r["dg_kwh"] or 0) + (r["fc_kwh"] or 0) + (r["gdg_kwh"] or 0)), _n(r["grid_in_kwh"]), f"{_n(r['ess_chg_kwh'])} / {_n(r['ess_dis_kwh'])}", _n(r["load_max"]), _n(r["soc"])] for r in days[-62:]],
              [16, 12, 12, 12, 12, 16, 10, 10], 16)
    if any(r["demo"] for r in days): doc.p("* 표시는 시연용 합성 자료가 들어 있는 날이다(가상 장치 모드의 첫 기동 때 넣은 과거 자료).", size=17, color="595959")
    last = days[-1]["k"] if days else f"{b - timedelta(days=1):%Y-%m-%d}"; d0 = datetime.strptime(last, "%Y-%m-%d"); hours = arch.series("hour", d0.timestamp(), (d0 + timedelta(days=1)).timestamp())
    doc.h2(f"2.2 시간별 실적 — {last}")
    doc.table(["시각", "부하 kWh", "태양광 kWh", "발전기 kWh", "수전 kWh", "최대 부하 kW", "충전율 %", "모선 A/B 전압 V", "주파수 Hz"],
              [[r["k"][11:], _n(r["load_kwh"]), _n(r["pv_kwh"]), _n((r["dg_kwh"] or 0) + (r["fc_kwh"] or 0) + (r["gdg_kwh"] or 0)), _n(r["grid_in_kwh"]), _n(r["load_max"]), _n(r["soc"]), f"{_n(r['va'], 0)} / {_n(r['vb'], 0)}", _n(r["hz"], 2)] for r in hours], None, 16)


def _events(doc, arch, a, b):
    """3. 상황 기록"""
    rows = arch.events(a.timestamp(), b.timestamp(), limit=400); doc.h1("3. 상황 기록")
    doc.p(f"구간 안의 사건·경보 {len(rows)}건(최근 것부터, 최대 400건). 전체는 기록 조회 화면에서 찾는다.")
    kinds = {}
    for r in rows: kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    doc.table(["종류", "건수"], sorted(kinds.items(), key=lambda x: -x[1]), [70, 30])
    doc.table(["시각", "종류", "대상", "내용", "행위자"], [[r["t"][5:], r["kind"], r["src"] or "", r["text"], r["actor"] or ""] for r in rows], [16, 14, 10, 48, 12], 16)


def _sequences(doc, eng, arch, a, b):
    """4. 운전 시퀀스: 운전 모드 정의, 지령 시퀀스 기록, 운영 시나리오(단계와 검증 결과)"""
    doc.h1("4. 운전 시퀀스"); doc.h2("4.1 운용 장소 · 태세별 동작")
    doc.table(["운용 장소", "태세", "EMS 동작"], [list(m) for m in MODES], [22, 12, 66])
    cmd = [r for r in arch.events(a.timestamp(), b.timestamp(), kind="지령", limit=300)]
    doc.h2(f"4.2 지령 시퀀스 기록 ({len(cmd)}건)"); doc.p("EMS 가 장치에 낸 지령과 응답(수용·완료·재지령·대체)을 시간순으로 적는다.")
    doc.table(["시각", "내용", "행위자"], [[r["t"][5:], r["text"], r["actor"] or ""] for r in reversed(cmd)], [18, 68, 14], 16)
    if eng is not None: _scenarios(doc, eng)


def _scenarios(doc, eng):
    """4.3 운영 시나리오: 단계 정의와(가상 장치 모드에서는) 검증 결과"""
    from . import scenarios, scenextra             # pylint: disable=import-outside-toplevel — scenarios 가 engine 을 불러 돌려 부르기(순환)를 피한다
    base = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(base, "static", "scenario_presets.json"), encoding="utf-8") as f: cases = json.load(f)
    pts = scenextra.merge(eng.rt.pts, scenextra.load(eng.cfg_path)); cases = scenarios.compatible_presets(cases, pts, scenarios.catalog(pts, eng.cfg["devices"])["commands"]); res = None
    if eng.sim:
        try: res = scenarios.verify(cases, eng.rt.pts, eng.cfg["devices"], profile=eng.cfg_path)["results"]
        except (ValueError, OSError) as e: doc.p(f"시나리오 검증을 실행하지 못했다: {e}", color="C00000")
    doc.h2(f"4.3 운영 시나리오 {len(cases)}건" + (" — 가상 장치 검증 결과" if res else " — 단계 정의"))
    doc.p("시나리오는 정상 운전(운전 모드 · 장비 시퀀스), 고장 대응(FMEA 의 고장 모드에 대응), 보호 협조로 나뉜다. 고장 대응에는 근거가 되는 FMEA 번호를 적었다.")
    if res: doc.table(["번호", "분류", "시나리오", "근거", "단계 수", "결과"], [[i + 1, c.get("cat", ""), r["name"], c.get("ref", ""), len(r["rows"]), "통과" if r["ok"] else "실패"] for i, (r, c) in enumerate(zip(res, cases))], [6, 22, 44, 8, 9, 11], 16)
    else: doc.table(["번호", "분류", "시나리오", "근거", "단계 수"], [[i + 1, c.get("cat", ""), c["name"], c.get("ref", ""), len(c["steps"])] for i, c in enumerate(cases)], [6, 24, 50, 9, 11], 16)
    if not res: doc.p("실장비 모드에서는 시나리오를 실행하지 않는다. 아래는 단계 정의이며, 검증은 가상 장치 모드에서 한다.")
    for i, c in enumerate(cases):
        doc.p(f"({i + 1}) {c['name']}", bold=True)
        if c.get("note"): doc.p(c["note"], size=17, color="595959")
        if c.get("fat"): doc.p("실장비 시험(FAT)에서 확인할 것: " + c["fat"], size=17, color="7B5A1E")
        rows = {r["step"]: r for r in res[i]["rows"]} if res else {}
        doc.table(["단계", "종류", "내용", "결과", "관측", "시간 ms"], [[j + 1, KIND.get(s["type"], s["type"]), describe(s), RESULT.get(rows.get(j, {}).get("state"), ""),
                                                             "" if rows.get(j, {}).get("actual") is None else rows[j]["actual"], rows.get(j, {}).get("elapsed", "")] for j, s in enumerate(c["steps"])], [8, 14, 46, 10, 10, 12], 16)


def _safety(doc, arch, a, b):
    """5. 전기안전 점검 기록: 누적 검침값과 측정 통계, 사람이 넣은 점검 기록"""
    rows = arch.series("raw", a.timestamp(), b.timestamp()); doc.h1("5. 전기안전 점검 기록"); doc.h2("5.1 검침 누적값")
    first, last = (rows[0], rows[-1]) if rows else ({}, {})
    names = [("cum_load", "부하 전력량"), ("cum_pv", "태양광 발전량"), ("cum_gen", "발전기 발전량"), ("cum_grid_in", "수전 전력량"), ("cum_grid_out", "역송 전력량")]
    doc.table(["검침 항목", "구간 시작 지침 kWh", "구간 끝 지침 kWh", "구간 사용량 kWh"], [[n, _n(first.get(c)), _n(last.get(c)), _n((last.get(c) or 0) - (first.get(c) or 0)) if rows else "—"] for c, n in names], [34, 22, 22, 22])
    doc.p("지침은 EMS 가 계측값을 적산한 값이다. 요금 정산용 계량기의 지침과 다를 수 있으므로 검침 대조 때는 계량기 값을 기준으로 한다.", size=17, color="595959")
    doc.h2("5.2 측정 항목 통계"); pick = lambda c: [r[c] for r in rows if r.get(c) is not None]
    stat = lambda c, d=1: [_n(min(pick(c)), d), _n(sum(pick(c)) / len(pick(c)), d), _n(max(pick(c)), d)] if pick(c) else ["—", "—", "—"]
    doc.table(["항목", "최소", "평균", "최대"], [["모선 A 전압 (V)"] + stat("va"), ["모선 B 전압 (V)"] + stat("vb"), ["주파수 (Hz)"] + stat("hz", 2), ["ESS 충전율 (%)"] + stat("soc"), ["기온 (℃)"] + stat("temp"),
                                           ["구간 최대 부하 (kW)"] + stat("load_max"), ["구간 최대 수전 (kW)"] + stat("grid_max")], [40, 20, 20, 20])
    trips = arch.events(a.timestamp(), b.timestamp(), q="트립", limit=200)
    doc.kv("보호 동작(트립) 기록", f"{len(trips)}건"); ins = arch.inspects(min(a, b - timedelta(days=366)).timestamp(), b.timestamp())
    doc.h2(f"5.3 점검 기록(수기 입력) {len(ins)}건"); doc.p("절연저항·접지저항·누설전류처럼 EMS 가 재지 못하는 항목은 점검자가 기록 조회 화면에서 넣는다. 보고 구간이 짧아도 최근 1년의 점검 기록을 함께 싣는다.")
    doc.table(["일시", "항목", "값", "단위", "의견", "점검자"], [[r["t"], r["item"], r["value"], r["unit"], r["note"], r["who"]] for r in ins], [18, 22, 12, 10, 26, 12], 16)


def _ess(doc, st, a, b):
    """6. ESS 안전 운영정보(1분 기록)의 구간 통계와 기록률"""
    d = st.dev.ess_series("year", a.timestamp(), b.timestamp()); doc.h1("6. ESS 안전 운영정보")
    doc.p("전기안전공사 ESS 통합관리시스템이 받는 운영정보(운영 환경 · 배터리 · PCS · 보호 이벤트)를 같은 주기(1분)로 현장에 쌓은 기록이다. 인터넷으로 보내지 못하므로 보관하고 주둔지 서버로 넘긴다.")
    if not d["items"]: doc.p("ESS 안전 운영정보 항목 파일(config/ess_safety.csv)이 없어 기록하지 않았다.", color="C00000"); return
    acc = {}
    for r in d["rows"]:
        for k, v in r["v"].items():
            c = acc.setdefault(k, [0.0, v[1], v[2], 0]); c[0] += v[0] * r["n"]; c[1] = min(c[1], v[1]); c[2] = max(c[2], v[2]); c[3] += r["n"]
    doc.table(["항목", "값"], [["기록 줄 수 / 있어야 할 줄 수", f"{d['recorded']:,} / {d['expected']:,}"], ["기록률", _n(d["rate"], 2, " %")], ["항목 수(수집 / 전체)", f"{sum(1 for i in d['items'] if i['tag'])} / {len(d['items'])}"]], [40, 60])
    doc.table(["분류", "항목", "단위", "연결 신호", "평균", "최소", "최대"], [[i["group"], i["label"], i["unit"], i["tag"] or "미수집(0 으로 기록)"] + ([_n(acc[i["key"]][0] / acc[i["key"]][3], 2), _n(acc[i["key"]][1], 2), _n(acc[i["key"]][2], 2)] if i["tag"] and i["key"] in acc else ["—", "—", "—"]) for i in d["items"]],
              [14, 24, 8, 22, 11, 10, 11], 16)
    doc.p("항목은 공개된 분류에 맞춘 초안이다. 공사의 정식 연계 명세(항목·열 순서)는 확보하지 못했으므로 명세를 받으면 config/ess_safety.csv 를 그 순서로 고친다. '미수집' 항목은 배터리 관리 장치(BMS)·PCS 의 신호를 대응표에 넣고 이 파일의 tag 에 적으면 기록된다.", size=17, color="595959")


def _devices(doc, st, a, b):
    """7. 장치별 자료: 장치마다 신호별 평균·최소·최대"""
    doc.h1("7. 장치별 자료"); doc.p("발전원과 저장 장치의 신호를 저장 주기마다 평균 · 최소 · 최대로 적은 기록의 구간 요약이다. 시간별 값은 기록 조회 화면의 '장치별 자료'에서 본다.")
    for dv in st.dev.devices():
        d = st.dev.dev_series(dv["dev"], "year", a.timestamp(), b.timestamp()); acc = {}
        for r in d["rows"]:
            for k, v in r["v"].items():
                c = acc.setdefault(k, [0.0, v[1], v[2], 0]); c[0] += v[0] * r["n"]; c[1] = min(c[1], v[1]); c[2] = max(c[2], v[2]); c[3] += r["n"]
        if not acc: continue
        doc.h2(f"{dv['name']} ({dv['dev']})")
        doc.table(["신호", "단위", "평균", "최소", "최대"], [[s["tag"], s["unit"], _n(acc[s["tag"]][0] / acc[s["tag"]][3], 2), _n(acc[s["tag"]][1], 2), _n(acc[s["tag"]][2], 2)] for s in d["signals"] if s["tag"] in acc], [36, 12, 18, 17, 17], 16)


def _storage(doc, st):
    """8. 자료 보관 상태와 주둔지 서버 전달 이력"""
    i = dict(st.arch.info(), **st.dev.info()); doc.h1("8. 자료 보관 · 서버 전달"); doc.h2("8.1 보관 상태")
    doc.table(["항목", "값"], [["저장 주기", f"검침 · 장치별 자료 {i['interval_min']}분 / ESS 안전 운영정보 1분"], ["보관 기간", f"{i['retain_years']}년" + (f" (점검 기록 보존 기간 {i['legal_years']}년보다 짧음)" if i["retain_years"] < i["legal_years"] else "")],
                               ["가장 오래된 기록 ~ 최근 기록", f"{i['first'] or '—'} ~ {i['last'] or '—'}"], ["검침 / 장치별 / ESS 안전", f"{i['rows']:,}줄 / {i['dev_rows']:,}줄 / {i['ess_rows']:,}줄"], ["상황 기록 / 점검 기록", f"{i['events']:,}건 / {i['inspects']:,}건"],
                               ["보관소 크기 / 한도", f"{i['size_mb']:.1f} MB / {i['max_mb']:.0f} MB"], ["시연용 합성 자료", f"검침 {i['demo_rows']:,}줄(장치별 · ESS 자료도 같은 기간이 합성)" if i["demo_rows"] else "없음"]], [40, 60])
    doc.p("보관 기간이 지난 기록은 자동으로 지운다. 파일이 한도를 넘으면 가장 오래된 달부터 지운다. 점검 결과 기록의 보존 기간(4년)은 전기안전관리법 시행규칙에 따랐다. 검침 · 장치별 자료의 저장 주기를 정한 조항은 확인하지 못해 검침 관행(15분)을 기본으로 했고, ESS 안전 운영정보는 통합관리시스템의 전송 주기(1분)를 따랐다.", size=17, color="595959")
    h = st.xfer.history(60); doc.h2(f"8.2 주둔지 서버 전달 이력 ({len(h['rows'])}건)")
    doc.table(["항목", "값"], [["전달을 마친 구간의 끝", h["covered_to"] or "아직 없음"], ["기록의 끝", h.get("data_to") or "—"], ["아직 넘기지 않은 기간", f"{h['wait_days']}일"], ["전달 완료가 아닌 묶음", f"{h['pending']}건"]], [40, 60])
    doc.table(["번호", "구간", "줄 수", "상태", "방법", "전달 시각", "담당", "SHA-256(앞 16자)"], [[r["id"], f"{r['from_t']} ~ {r['to_t']}", f"{r['rows']:,}", r["status"], r["method"] or "", r["sent_t"][5:16], r["who"] or "", (r["sha256"] or "")[:16]] for r in h["rows"]], [7, 30, 9, 11, 8, 12, 9, 14], 15)


def build(eng, st, q):
    """보고서를 만들어 (파일 이름, 바이트)로 돌려준다."""
    a, b = _period(q); arch = st.arch; doc = Doc(); now = time.strftime("%Y-%m-%d %H:%M:%S")
    s = eng.snapshot() if eng is not None else {"site": "기록 보관소", "sim": False, "version": None}
    doc.p("작전지 종합전력공급체계(IFPS) 이동형 EMS", bold=True, size=28, align="center").p("운영 보고서", bold=True, size=40, align="center")
    doc.table(["항목", "내용"], [["현장", s["site"]], ["보고 구간", f"{a:%Y-%m-%d} ~ {b - timedelta(days=1):%Y-%m-%d}"], ["작성 시각", now], ["소프트웨어", f"패키지 {s['version']['pkg']} · 실행기 {s['version']['rt']} · 핵심 {s['version']['core']}" if s["version"] else "기록 조회기(보관소 파일만 읽음)"],
                               ["자료 출처", ("가상 장치(시연) — 실제 설비의 값이 아니다" if s["sim"] else "실장비 계측값" if eng is not None else "보관된 기록(현재 현황 없음)") + " · 기록 보관소 archive.db"]], [24, 76])
    doc.p("차례: 1 현재 현황 · 2 최근 운영 현황 · 3 상황 기록 · 4 운전 시퀀스 · 5 전기안전 점검 기록 · 6 ESS 안전 운영정보 · 7 장치별 자료 · 8 자료 보관 · 서버 전달", size=18, color="595959")
    if eng is not None: _current(doc, s)
    else: doc.h1("1. 현재 현황"); doc.p("기록 조회기에서 만든 보고서라 현재 현황은 없다. EMS 화면의 [보고서 출력]을 쓰면 들어간다.")
    _recent(doc, arch, a, b); _events(doc, arch, a, b); _sequences(doc, eng, arch, a, b); _safety(doc, arch, a, b); _ess(doc, st, a, b); _devices(doc, st, a, b); _storage(doc, st)
    site = "".join(c for c in s["site"] if c.isascii() and (c.isalnum() or c in "-_")) or "archive"       # 파일 이름은 영문·숫자만(브라우저·압축 도구에 따라 한글 이름이 깨진다)
    return f"EMS_report_{site}_{a:%Y%m%d}-{b - timedelta(days=1):%Y%m%d}.docx", doc.to_bytes()
