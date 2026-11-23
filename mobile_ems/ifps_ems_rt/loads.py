# -*- coding: utf-8 -*-
"""부하 목록(종류 · 수량 · 등급 · 정격 · 절감 비율). 운용자가 부하 관리 화면에서 늘리고 줄인다.

부하 한 줄 = 같은 부하 여러 개(예: 막사 3동). 등급(1 · 2 · 3)이 급전선(L1 · L2 · L3)을 정한다.
EMS 가 재는 것은 급전선별 합계(LOAD.p1_kw · p2_kw · p3_kw)뿐이다 — 부하 하나하나의 전력은 정격 비율로 나눈 추정값이다.
절감 비율: 그 부하가 '절감 공급'(LDS = 3) 때 줄일 수 있는 몫(냉난방 설정 완화 · 조명 감광 · 비필수 회로 차단). 0 이면 줄일 수 없는 부하다."""

MAX_ITEMS = 24; MAX_N = 20
# 부하 종류: (이름, 기본 등급, 대당 정격 kW, 절감 비율 %, 배치도 그림)
KINDS = {"c2": ("지휘통제소", 1, 30.0, 0, "L1"), "comm": ("통신 · 레이더", 1, 15.0, 0, "L1"), "medical": ("의무시설", 2, 16.0, 10, "L2"), "barrack": ("막사", 2, 12.0, 30, "BARRACK"),
         "kitchen": ("취사 · 급수", 2, 20.0, 20, "L2"), "maint": ("정비 · 충전소", 3, 20.0, 40, "L3"), "hvac": ("냉난방 · 편의", 3, 15.0, 50, "BARRACK"), "ammo": ("탄약 · 물자 저장", 3, 25.0, 20, "L3")}
DEFAULT = [{"id": "c2", "kind": "c2", "name": "지휘통제(C2)", "grade": 1, "kw": 30.0, "n": 1, "save_pct": 0},
           {"id": "med", "kind": "medical", "name": "의무시설", "grade": 2, "kw": 16.0, "n": 1, "save_pct": 10},
           {"id": "brk", "kind": "barrack", "name": "막사", "grade": 2, "kw": 12.0, "n": 2, "save_pct": 30},
           {"id": "ammo", "kind": "ammo", "name": "탄약저장", "grade": 3, "kw": 25.0, "n": 1, "save_pct": 20}]
BASE = {1: 30.0, 2: 40.0, 3: 25.0}                 # 기본 목록의 등급별 정격 합(kW) — 가상 장치의 부하 곡선이 이 값을 기준으로 만들어져 있다
FEEDER = {1: "L1", 2: "L2", 3: "L3"}


def _num(v, lo, hi):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and lo <= v <= hi


def check(items, limit=None):
    """목록 검사. limit: {등급: 그 급전선 계측 범위의 상한 kW} — 정격 합이 넘으면 계측값이 범위 밖으로 버려지므로 막는다. 반환: 오류 목록"""
    bad = []; ids = set()
    if not isinstance(items, list) or len(items) > MAX_ITEMS: return [f"부하는 {MAX_ITEMS}줄까지"]
    for i, it in enumerate(items, 1):
        if not isinstance(it, dict): bad.append(f"{i}번째: 형식 오류"); continue
        nm = it.get("name"); tag = f"{i}번째({nm})" if isinstance(nm, str) else f"{i}번째"
        if not (isinstance(it.get("id"), str) and it["id"] and len(it["id"]) <= 16) or it.get("id") in ids: bad.append(f"{tag}: 식별자 없음 · 중복")
        ids.add(it.get("id"))
        if it.get("kind") not in KINDS: bad.append(f"{tag}: 모르는 종류")
        if not (isinstance(nm, str) and 1 <= len(nm.strip()) <= 24): bad.append(f"{tag}: 이름은 1~24자")
        if it.get("grade") not in (1, 2, 3): bad.append(f"{tag}: 등급은 1 · 2 · 3")
        if not _num(it.get("kw"), 0.1, 500): bad.append(f"{tag}: 대당 정격은 0.1~500 kW")
        if not (isinstance(it.get("n"), int) and not isinstance(it.get("n"), bool) and 0 <= it["n"] <= MAX_N): bad.append(f"{tag}: 수량은 0~{MAX_N}")
        if not _num(it.get("save_pct"), 0, 80): bad.append(f"{tag}: 절감 비율은 0~80 %")
        elif it.get("grade") == 1 and it["save_pct"] > 0: bad.append(f"{tag}: 1등급 부하는 절감하지 않는다(절감 비율 0)")
    if not bad:
        for g, kw in rated(items).items():
            if limit and limit.get(g) is not None and kw > limit[g]: bad.append(f"{g}등급 정격 합 {kw:.0f} kW 가 그 급전선의 계측 범위({limit[g]:.0f} kW)를 넘음 — 수량을 줄이거나 대응표(LOAD.p{g}_kw)의 범위를 먼저 늘린다")
        if limit and limit.get(0) is not None and sum(rated(items).values()) > limit[0]: bad.append(f"전체 정격 합 {sum(rated(items).values()):.0f} kW 가 부하 합계의 계측 범위({limit[0]:.0f} kW)를 넘음 — 대응표(LOAD.kw)의 범위를 먼저 늘린다")
    return bad


def rated(items):
    """등급별 정격 합(kW)."""
    out = {1: 0.0, 2: 0.0, 3: 0.0}
    for it in items: out[it["grade"]] += it["kw"] * it["n"]
    return out


def save_frac(items):
    """급전선별 절감 가능 비율(0~1): 절감 공급 때 그 급전선의 부하가 줄어드는 몫. 1등급은 없다."""
    r = rated(items); cut = {2: 0.0, 3: 0.0}
    for it in items:
        if it["grade"] in cut: cut[it["grade"]] += it["kw"] * it["n"] * it["save_pct"] / 100.0
    return {FEEDER[g]: (cut[g] / r[g] if r[g] > 0 else 0.0) for g in cut}


def scale(items):
    """가상 장치의 급전선별 부하 배율: 기본 목록의 정격 합을 1 로 본다."""
    r = rated(items); return {g: r[g] / BASE[g] for g in BASE}


def share(items, feeder_kw, stage):
    """부하별 추정 전력: 급전선 계측값을 정격(절감 중이면 줄인 정격) 비율로 나눈다. feeder_kw · stage: {급전선: 값}. 반환: {id: kW 또는 None}"""
    w = {}; tot = {}
    for it in items:
        f = FEEDER[it["grade"]]; k = it["kw"] * it["n"] * ((1 - it["save_pct"] / 100.0) if stage.get(f) == "save" else 1.0)
        w[it["id"]] = (f, k); tot[f] = tot.get(f, 0.0) + k
    return {i: (None if feeder_kw.get(f) is None else 0.0 if stage.get(f) == "off" or tot[f] <= 0 else feeder_kw[f] * k / tot[f]) for i, (f, k) in w.items()}
