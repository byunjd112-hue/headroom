# -*- coding: utf-8 -*-
"""부하 목록(종류 · 수량 · 등급 · 정격 · 절감 비율). 운용자가 부하 관리 화면에서 늘리고 줄인다.

부하 한 줄 = 같은 부하 여러 개(예: 막사 3동). 등급(1 · 2 · 3)이 급전선(L1 · L2 · L3)을 정한다.
EMS 가 재는 것은 급전선별 합계(LOAD.p1_kw · p2_kw · p3_kw)뿐이다 — 부하 하나하나의 전력은 정격 비율로 나눈 추정값이다.
절감 비율: 그 부하가 '절감 공급'(LDS = 3) 때 줄일 수 있는 몫(냉난방 설정 완화 · 조명 감광 · 비필수 회로 차단). 0 이면 줄일 수 없는 부하다."""

import re

MAX_ITEMS = 24; MAX_N = 20
# 부하 종류: (이름, 기본 등급, 대당 정격 kW, 절감 비율 %, 배치도 그림)
KINDS = {"c2": ("지휘통제소", 1, 30.0, 0, "L1"), "comm": ("통신 · 레이더", 1, 15.0, 0, "L1"), "medical": ("의무시설", 2, 16.0, 10, "L2"), "barrack": ("막사", 2, 12.0, 30, "BARRACK"),
         "kitchen": ("취사 · 급수", 2, 20.0, 20, "L2"), "maint": ("정비 · 충전소", 3, 20.0, 40, "L3"), "hvac": ("냉난방 · 편의", 3, 15.0, 50, "BARRACK"), "ammo": ("탄약 · 물자 저장", 3, 25.0, 20, "L3")}
DEFAULT = [{"id": "c2", "kind": "c2", "name": "지휘통제(C2)", "grade": 1, "kw": 30.0, "n": 1, "save_pct": 0},
           {"id": "med", "kind": "medical", "name": "의무시설", "grade": 2, "kw": 16.0, "n": 1, "save_pct": 10},
           {"id": "brk", "kind": "barrack", "name": "막사", "grade": 2, "kw": 12.0, "n": 2, "save_pct": 30},
           {"id": "ammo", "kind": "ammo", "name": "탄약저장", "grade": 3, "kw": 25.0, "n": 1, "save_pct": 20}]
# 부하 종류가 보통 물리는 배전체계의 차례(0 = 첫째 배전체계). 부하에 배전체계를 따로 정하지 않으면('자동') 이 차례로 붙인다
KIND_AT = {"c2": 0, "comm": 0, "medical": 1, "barrack": 1, "kitchen": 1, "maint": 2, "hvac": 2, "ammo": 2}
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
        _check1(i, it, ids, bad); ids.add(it.get("id"))
    if not bad and limit: _check_limit(items, limit, bad)
    return bad


def _check1(i, it, ids, bad):
    """부하 한 줄의 검사."""
    nm = it.get("name"); tag = f"{i}번째({nm})" if isinstance(nm, str) else f"{i}번째"; n = it.get("n")
    rules = ((isinstance(it.get("id"), str) and 0 < len(it["id"]) <= 16 and it["id"] not in ids, "식별자 없음 · 중복"), (it.get("kind") in KINDS, "모르는 종류"),
             (isinstance(nm, str) and 1 <= len(nm.strip()) <= 24, "이름은 1~24자"), (it.get("grade") in (1, 2, 3), "등급은 1 · 2 · 3"), (_num(it.get("kw"), 0.1, 500), "대당 정격은 0.1~500 kW"),
             (isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= MAX_N, f"수량은 0~{MAX_N}"), (_num(it.get("save_pct"), 0, 80), "절감 비율은 0~80 %"))
    bad.extend(f"{tag}: {why}" for ok, why in rules if not ok)
    if not (isinstance(it.get("ppdu", ""), str) and re.fullmatch(r"(PPDU[1-9][0-9]?)?", it.get("ppdu", ""))): bad.append(f"{tag}: 배전체계 이름 오류")
    if _num(it.get("save_pct"), 0, 80) and it.get("grade") == 1 and it["save_pct"] > 0: bad.append(f"{tag}: 1등급 부하는 절감하지 않는다(절감 비율 0)")


def _check_limit(items, limit, bad):
    """정격 합이 급전선 계측 범위를 넘는지."""
    r = rated(items)
    for g, kw in r.items():
        if limit.get(g) is not None and kw > limit[g]: bad.append(f"{g}등급 정격 합 {kw:.0f} kW 가 그 급전선의 계측 범위({limit[g]:.0f} kW)를 넘음 — 수량을 줄이거나 대응표(LOAD.p{g}_kw)의 범위를 먼저 늘린다")
    if limit.get(0) is not None and sum(r.values()) > limit[0]: bad.append(f"전체 정격 합 {sum(r.values()):.0f} kW 가 부하 합계의 계측 범위({limit[0]:.0f} kW)를 넘음 — 대응표(LOAD.kw)의 범위를 먼저 늘린다")


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


def attach(items, ppdus):
    """부하마다 물린 배전체계를 정한다. ppdus: 지금 있는 배전체계 [{id, name, at}] (환망 순서). 부하에 정해 둔 배전체계가 있으면 그것, 없거나 그 배전체계가 지금 없으면 종류에 따른 차례로.
    반환: {부하 id: {"ppdu", "ppdu_name", "fsu", "auto"}} — 배전체계가 하나도 없으면 빈 값."""
    out = {}; by = {p["id"]: p for p in ppdus}
    for it in items:
        p = by.get(it.get("ppdu") or ""); auto = p is None
        if auto and ppdus: p = ppdus[min(KIND_AT.get(it["kind"], 0), len(ppdus) - 1)]
        out[it["id"]] = {"ppdu": p["id"] if p else "", "ppdu_name": p["name"] if p else "", "fsu": p["at"] if p else "", "auto": auto}
    return out


def share(items, feeder_kw, stage):
    """부하별 추정 전력: 급전선 계측값을 정격(절감 중이면 줄인 정격) 비율로 나눈다. feeder_kw · stage: {급전선: 값}. 반환: {id: kW 또는 None}"""
    w = {}; tot = {}
    for it in items:
        f = FEEDER[it["grade"]]; k = it["kw"] * it["n"] * ((1 - it["save_pct"] / 100.0) if stage.get(f) == "save" else 1.0)
        w[it["id"]] = (f, k); tot[f] = tot.get(f, 0.0) + k
    return {i: (None if feeder_kw.get(f) is None else 0.0 if stage.get(f) == "off" or tot[f] <= 0 else feeder_kw[f] * k / tot[f]) for i, (f, k) in w.items()}
