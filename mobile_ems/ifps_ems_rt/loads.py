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
    if not (isinstance(it.get("fsu", ""), str) and re.fullmatch(r"(FSU[1-9][0-9]?)?", it.get("fsu", ""))): bad.append(f"{tag}: 구간분전함 이름 오류")
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


def _near(order, home, free, taken):
    """home 구간분전함에서 가까운 차례로, 배전체계가 없는 구간분전함을 고른다(다른 직결 부하가 아직 잡지 않은 곳 먼저)."""
    if home not in order: return ""
    k = order.index(home); cand = sorted((f for f in free), key=lambda f: (f in taken, abs(order.index(f) - k), order.index(f)))
    return cand[0] if cand else ""


def _auto(items, ppdus, cap, where, used, spot):
    """자리를 정하지 않은 부하의 자리: 종류에 따른 차례의 배전체계, 정격을 넘게 되면 가까운 직결 자리."""
    order, free, taken = where
    for it in items:
        if it["id"] in spot: continue
        p = ppdus[min(KIND_AT.get(it["kind"], 0), len(ppdus) - 1)] if ppdus else None; f = p["at"] if p else ""; r = it["kw"] * it["n"]
        if p and cap is not None and used.get(f, 0.0) + r > cap + 1e-9: f = _near(order, p["at"], free, taken) or f
        spot[it["id"]] = (f, True); used[f] = used.get(f, 0.0) + r; taken.add(f)


def attach(items, ppdus, fsus=(), cap=None):
    """부하마다 물린 자리를 정한다 — 구간분전함(fsu)이 기준이고, 그 구간분전함에 배전체계가 있으면 그것이 물린 배전체계다(없으면 구간분전함 직결).
    ppdus: 지금 있는 배전체계 [{id, name, at}], fsus: 지금 있는 구간분전함 [{id, name}] (환망 순서), cap: 배전체계 한 대의 정격(kW).
    부하에 정해 둔 구간분전함(개요 배치도에서 옮기거나 부하 관리에서 고른 것)이 지금 있으면 그것, 아니면 '자동' — 종류에 따른 차례의 배전체계로 보내되,
    그 배전체계의 정격(cap)을 넘게 되면 가까운 '배전체계 없는 구간분전함'에 직결한다(정격 20 kW 배전체계에 30 kW 시설을 물리는 그림이 되지 않게).
    반환: {부하 id: {"fsu", "fsu_name", "ppdu", "ppdu_name", "auto", "over"}} — over: 그 배전체계에 물린 정격 합이 cap 을 넘음. 환망이 없으면 빈 값."""
    out = {}; fn = {f["id"]: f["name"] for f in fsus}; at = {}; order = [f["id"] for f in fsus]; used = {}; taken = set(); spot = {}
    for p in ppdus: at.setdefault(p["at"], p)
    free = [f for f in order if f not in at]
    for it in items:                                                   # 자리를 정해 둔 부하 먼저
        f = it.get("fsu") or ""
        if f in fn: spot[it["id"]] = (f, False); used[f] = used.get(f, 0.0) + it["kw"] * it["n"]; taken.add(f)
    _auto(items, ppdus, cap, (order, free, taken), used, spot)
    for it in items:
        f, auto = spot[it["id"]]; p = at.get(f)
        out[it["id"]] = {"fsu": f, "fsu_name": fn.get(f, f), "ppdu": p["id"] if p else "", "ppdu_name": p["name"] if p else "", "auto": auto, "over": bool(p and cap is not None and used.get(f, 0.0) > cap + 1e-9)}
    return out


def weights(items, at, stage):
    """분기별 몫: 부하마다 (물린 구간분전함 · 배전체계 · 등급 · 그 급전선 전력에서 차지하는 비율). 가상 장치의 분기 전력계와 전력계 대조가 쓴다."""
    fr = share(items, {f: 1.0 for f in FEEDER.values()}, stage)
    return [{"id": it["id"], "fsu": at[it["id"]]["fsu"], "ppdu": at[it["id"]]["ppdu"], "grade": it["grade"], "frac": fr[it["id"]] or 0.0} for it in items if it["n"] > 0 and at.get(it["id"], {}).get("fsu")]


def share(items, feeder_kw, stage):
    """부하별 추정 전력: 급전선 계측값을 정격(절감 중이면 줄인 정격) 비율로 나눈다. feeder_kw · stage: {급전선: 값}. 반환: {id: kW 또는 None}"""
    w = {}; tot = {}
    for it in items:
        f = FEEDER[it["grade"]]; k = it["kw"] * it["n"] * ((1 - it["save_pct"] / 100.0) if stage.get(f) == "save" else 1.0)
        w[it["id"]] = (f, k); tot[f] = tot.get(f, 0.0) + k
    return {i: (None if feeder_kw.get(f) is None else 0.0 if stage.get(f) == "off" or tot[f] <= 0 else feeder_kw[f] * k / tot[f]) for i, (f, k) in w.items()}
