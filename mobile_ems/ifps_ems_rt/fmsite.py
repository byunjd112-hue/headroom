"""현장 구성 반영: 지금의 장비 대수 · 모선 구성 · 환망(구간분전함 · 배전체계) · 부하 목록에서 FMEA 의 해당 항목을 실제 이름으로 펼치고, FAT 점검표의 줄을 만든다.

입력은 화면이 쓰는 스냅샷(snapshot)의 fleet · bus · ring · loads 다 — 화면에 보이는 구성과 같은 값에서 만든다.
원칙: ① 기존 FM · C 번호는 바꾸지 않는다(펼친 줄은 원래 번호 아래에 붙는다). ② 심각도 · 발생도 · 검출도는 새로 매기지 않는다(원래 항목의 값을 따른다).
③ 구성 때문에 영향이 달라지는 줄은 '재검토'로만 표시한다 — 점수는 사람이 정한다. ④ FAT 항목 번호는 짓지 않는다(번호 칸은 비운다 — 발주처와 정한 체계를 적는다).
"""
FORMING = ("ESS", "G1")                                   # 모선 전압을 세우는 전원(계통 형성)
CTL = {"DG": "기동 · 정지", "FC": "기동 · 정지 · 출력 설정", "PV": "계통 연결 · 분리 · 출력 제한", "GDG": "기동 · 정지"}      # EMS 가 지령하는 종류(나머지는 감시 전용)
FM_HEAD = ["기준 항목", "대상(현장 이름)", "고장 모드", "이 구성에서의 영향", "현 대책 · 검출", "재검토"]
FAT_HEAD = ["번호", "구분", "대상", "시험 내용", "방법", "합격 기준", "관련 항목", "결과", "비고"]


def _sources(snap):
    """인식한 전원 한 대 한 대: [{id, kind, name, bus, n(그 종류의 대수)}] — 지금 없는 종류는 뺀다."""
    fl = snap.get("fleet") or {}; out = []
    for s in (snap.get("bus") or {}).get("sources", []):
        if not s.get("present"): continue
        f = fl.get("DG" if s["kind"] == "G1" else s["kind"]); n = len(f["units"]) if f else 1
        out.append({"id": s["id"], "kind": s["kind"], "name": s["name"], "bus": s["bus"], "n": max(1, n)})
    return out


def _loads(snap):
    return [i for i in (snap.get("loads") or {}).get("items", []) if i.get("n", 0) > 0]


def _lname(i):
    return f"{i['name']} ×{i['n']}" if i["n"] > 1 else i["name"]


def _at(snap, fsu):
    """그 구간분전함에 물린 부하 이름들."""
    return [f"{_lname(i)}({i['grade']}등급)" for i in _loads(snap) if i.get("fsu") == fsu]


def _refed(ring, i):
    """구간 i 가 끊기면 반대쪽에서 다시 받는 구간분전함들(상시 개방점을 닫아 급전). 상시 개방점 자체가 끊기면 빈 목록."""
    n = len(ring["fsu"]); o = ring.get("open", n)
    if i == o: return []
    return ring["fsu"][i:o] if i < o else ring["fsu"][o:i]


def _sec_name(ring, i):
    f = ring["fsu"]; n = len(f)
    return f"모선 A ↔ {f[0]['name']}" if i == 0 else f"{f[n - 1]['name']} ↔ 모선 B" if i == n else f"{f[i - 1]['name']} ↔ {f[i]['name']}"


def _fm_sources(snap):
    out = []; src = _sources(snap)
    for s in src:
        same = [q for q in src if q["kind"] == s["kind"]]; form = [q for q in src if q["kind"] in FORMING and q["bus"] == s["bus"] and q["id"] != s["id"]]
        eff = f"같은 종류 {len(same)}대 가운데 1대 — 나머지 {len(same) - 1}대로 운전을 잇는다" if len(same) > 1 else "이 종류의 하나뿐인 장치 — 이 전원을 쓰지 못한다(다른 전원으로 대체)"
        review = ""
        if s["kind"] in FORMING and not form:
            eff += f". 모선 {s['bus']} 의 전압을 세우는 전원이 이것뿐이다 — 연계 차단기가 열려 있으면 모선 {s['bus']} 정전"; review = "재검토"
        out.append(["FM-02", f"{s['name']} · 모선 {s['bus']}", "한 장치의 양 경로 동시 두절", eff, "통신 두절 경보, 지령 차단, 직전 값 유지 표시(####)", review])
    return out


def _fm_bus(snap):
    out = []; src = _sources(snap); b = snap.get("bus") or {}
    for bus in ("A", "B"):
        names = [s["name"] for s in src if s["bus"] == bus]; form = [s["name"] for s in src if s["bus"] == bus and s["kind"] in FORMING]; lds = [x["name"] for x in b.get("loads", []) if x.get("bus") == bus]
        eff = f"전원: {', '.join(names) or '없음'} / 전압을 세우는 전원: {', '.join(form) or '없음'} / 부하: {', '.join(lds) or '없음'}"
        out.append(["FM-74", f"모선 {bus}", "모선 구성의 약점 · 화면과 실제 결선 불일치", eff, "모선 구성 점검(전압을 세울 전원 · 정격 · 치우침), 결선도 표시", "" if form else "재검토"])
    for it in b.get("issues", []):
        out.append(["FM-74", "모선 구성 점검 결과", "모선 구성의 약점", str(it.get("text") or it), "모선 구성 화면의 [자동 보완] 또는 결선 변경", "재검토"])
    return out


def _fm_ring(snap, cfg):
    ring = snap.get("ring"); out = []
    if not ring: return out
    t = (cfg.get("trip_ms", 100) + cfg.get("close_ms", 2500)) / 1000.0; o = ring.get("open")
    for sec in ring["sections"]:
        i = sec["i"]; ref = _refed(ring, i); lds = [x for f in ref for x in _at(snap, f["id"])]
        if i == o: eff = "상시 개방점 구간(평소 열림) — 끊겨도 급전은 그대로다. 다만 다른 구간이 끊겼을 때 반대쪽에서 보낼 길이 없어진다"
        else: eff = f"{', '.join(f['name'] for f in ref) or '해당 없음'} 을(를) 상시 개방점을 닫아 반대쪽에서 급전. 영향 부하: {', '.join(lds) or '없음'} — 2 · 3등급은 약 {t:.1f}초 정전 뒤 복구, 1등급은 우회 결선 · 절체 장치로 잇는다"
        out.append(["C-11", f"구간 {i} ({_sec_name(ring, i)})", "구간 단선 시 구간 미차단 또는 상시 개방점 미투입", eff, "구간 차단기 · 상시 개방점 상태 감시, 환망 경보, 무정전 점검", "재검토" if i == o else ""])
    return out


def _fm_fsu(snap):
    ring = snap.get("ring"); out = []
    if not ring: return out
    for f in ring["fsu"]:
        mine = [i for i in _loads(snap) if i.get("fsu") == f["id"]]
        if not mine: continue
        parts = []; review = ""
        for i in mine:
            if i["grade"] == 1 and i.get("alt_name"): parts.append(f"{_lname(i)}(1등급): 우회 결선으로 {i['alt_name']} 에서 받는다")
            elif i["grade"] == 1: parts.append(f"{_lname(i)}(1등급): 우회할 구간분전함이 없어 정전"); review = "재검토"
            else: parts.append(f"{_lname(i)}({i['grade']}등급): 복구할 때까지 정전")
        out.append(["FM-75", f"{f['name']} (물린 부하 {len(mine)}건)", "구간분전함 자체 고장 · 정격 · 출력 회로 초과", " / ".join(parts), "구간분전함 전압 · 전력 감시, 과부하 경보, 무정전 점검", review])
    for i in _loads(snap):
        have = len(i.get("ppdus") or []); short = have < i.get("need", 0) or i.get("fsu_over") or i.get("out_over")
        out.append(["FM-75", f"{_lname(i)} → {i.get('fsu_name') or '미정'}", "배전체계 부족 · 공급 경로 불일치", f"{i['grade']}등급 · 정격 {i['rated']:g} kW · 배전체계 {have}대(필요 {i.get('need', 0)}대)" + (" — 부족 또는 초과" if short else ""), "부하 관리의 공급 경로 계산, 부족 · 초과 안내", "재검토" if short else ""])
    return out


def fmea(snap, cfg):
    """현장 구성으로 펼친 FMEA 줄(FM_HEAD 순서)."""
    rows = _fm_sources(snap) + _fm_bus(snap) + _fm_ring(snap, cfg) + _fm_fsu(snap)
    for it in ((snap.get("ring") or {}).get("n1") or {}).get("items", []):
        if it.get("level") != "info": rows.append(["C-12", f"무정전 점검 · {it.get('area', '')}", "한 곳 고장에 급전이 끊기는 자리", it.get("text", ""), it.get("fix") or "무정전 점검 화면", "재검토"])
    return rows


def _fat_sources(snap):
    out = []
    for s in _sources(snap):
        if s["kind"] == "G1": continue                                  # 복합전력 ESS 는 디젤과 같은 차량(PCS) — 디젤 줄에서 본다
        nm = s["name"]
        out.append(["전원", nm, "통신 연결과 자동 인식", "장치를 켜고 통신선을 잇는다", "수 초 안에 개요 · 결선도 · 설비 제어에 나타나고 두절 경보가 없다", "FM-01 · FM-02"])
        out.append(["전원", nm, "통신 두절 검출", "통신선 한 가닥, 이어서 두 가닥을 뺀다", "한 가닥: 운전 지속 · 경로 경보 / 두 가닥: 두절 경보 · 지령 차단", "FM-01 · FM-02"])
        out.append(["전원", nm, f"모선 표시 일치(모선 {s['bus']})", "실제 결선과 화면의 모선 구성을 맞대어 본다", f"화면의 모선 {s['bus']} 와 실제 결선이 같다", "FM-74"])
        if s["kind"] in CTL: out.append(["전원", nm, f"지령 응답({CTL[s['kind']]})", "설비 제어에서 선택 → 실행으로 지령한다", "완료 한도 안에 상태가 바뀌고 응답 기록이 남는다", "FM-14"])
        else: out.append(["전원", nm, "감시 값 확인(지령 없음)", "출력 · 충전율을 계측기와 맞대어 본다", "화면 값이 계측기와 허용 오차 안에서 같다", "FM-10"])
    return out


def _fat_ring(snap, cfg):
    ring = snap.get("ring"); out = []
    if not ring: return out
    t = (cfg.get("trip_ms", 100) + cfg.get("close_ms", 2500)) / 1000.0
    for sec in ring["sections"]:
        if sec["i"] == ring.get("open"): continue
        ref = _refed(ring, sec["i"]); nm = f"구간 {sec['i']} ({_sec_name(ring, sec['i'])})"
        out.append(["환망", nm, "구간 차단 시 반대쪽 급전", "그 구간의 차단기를 연다(또는 케이블을 분리한다)", f"상시 개방점이 닫히고 {', '.join(f['name'] for f in ref) or '뒤쪽 마디'} 이(가) 약 {t:.1f}초 안에 다시 급전된다. 1등급 부하는 끊기지 않는다", "C-11"])
    for f in ring["fsu"]:
        lds = _at(snap, f["id"])
        out.append(["환망", f["name"], "전압 · 전력 표시와 통신", "화면 값을 계측기와 맞대어 본다", "전압 · 전력이 허용 오차 안에서 같고 통신 고립 표시가 없다", "FM-73"])
        if lds: out.append(["환망", f["name"], "구간분전함 정전 시 표시와 우회", "그 구간분전함의 입력을 끊는다", f"정전 경보가 뜨고 물린 부하({', '.join(lds)})의 상태가 바뀐다. 1등급 부하는 우회 결선으로 잇는다", "FM-75 · C-12"])
    return out


def _fat_loads(snap):
    out = []
    for i in _loads(snap):
        nm = _lname(i); at = i.get("fsu_name") or "미정"
        out.append(["부하", nm, f"급전과 전력 표시({at})", "부하를 켜고 분기 전력계 값을 본다", f"화면의 물린 자리({at})가 실제와 같고 전력이 허용 오차 안에서 같다", "FM-72 · FM-73"])
        out.append(["부하", nm, f"배전체계 대수(필요 {i.get('need', 0)}대)", "부하 앞의 배전체계를 센다", f"배전체계 {i.get('need', 0)}대가 붙어 있고 과부하 표시가 없다", "FM-75"])
        if i["grade"] == 1: out.append(["부하", nm, "1등급 무정전(우회 결선 · 절체)", "물린 구간분전함의 입력을 끊는다", f"부하가 끊기지 않고 {i.get('alt_name') or '우회 구간분전함'} 에서 받는다", "C-04 · C-12"])
        else: out.append(["부하", nm, f"{i['grade']}등급 차단 · 복구" + (" · 절감 공급" if i.get("save_pct") else ""), "설비 제어에서 그 등급을 차단 · 복구(절감)한다", "차단하면 0 kW, 복구하면 돌아온다" + (f". 절감하면 약 {i['save_pct']:g}% 줄어든다" if i.get("save_pct") else ""), "FM-70 · FM-71"])
    return out


def fat(snap, cfg):
    """현장 구성에 맞춘 FAT 점검표의 줄(FAT_HEAD 순서 — 번호 · 결과 · 비고는 빈칸)."""
    body = _fat_sources(snap) + _fat_ring(snap, cfg) + _fat_loads(snap)
    body.append(["체계", "모선 연계 차단기", "연계 차단기 개방 시 두 모선 유지", "연계 차단기를 연다", "두 모선 모두 전압이 유지된다(모선마다 전압을 세우는 전원이 있을 때)", "FM-74"])
    body.append(["체계", "화면 간 일치", "개요 · 결선도 · 환망 · 부하 관리 · 설비 제어의 구성 일치", "장비 한 대 · 부하 하나의 모선과 구간분전함을 화면마다 본다", "모든 화면이 같은 구성을 보인다", "FM-72 · FM-74"])
    return [[""] + r + ["", ""] for r in body]


def summary(snap):
    """구성 요약(문서 머리말): [(이름, 값)]."""
    src = _sources(snap); ring = snap.get("ring") or {}; lds = _loads(snap); kinds = {}
    for s in src: kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    return [("전원", ", ".join(f"{k} {n}대" for k, n in kinds.items()) or "없음"),
            ("모선 A", ", ".join(s["name"] for s in src if s["bus"] == "A") or "없음"), ("모선 B", ", ".join(s["name"] for s in src if s["bus"] == "B") or "없음"),
            ("환망", f"구간분전함 {len(ring.get('fsu', []))}개 · 배전체계 {len(ring.get('ppdu', []))}대 · 상시 개방점 구간 {ring.get('open', '—')}" if ring else "없음"),
            ("부하", f"{sum(i['n'] for i in lds)}개 · 정격 합 {sum(i['rated'] for i in lds):g} kW ({', '.join(_lname(i) for i in lds)})")]


def build(snap, cfg, when=""):
    """내보내기 자료: {when, summary, fm_head, fmea, fat_head, fat}."""
    return {"when": when, "summary": [list(x) for x in summary(snap)], "fm_head": FM_HEAD, "fmea": fmea(snap, cfg), "fat_head": FAT_HEAD, "fat": fat(snap, cfg)}
