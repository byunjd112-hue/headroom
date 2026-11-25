# -*- coding: utf-8 -*-
"""모선 구성: 전원과 부하 급전선이 모선 A · B 가운데 어디에 물렸는지. 결선도 · 운영 시나리오 구성도 · 가상 장치의 모선 전압 계산이 이 구성 하나를 같이 쓴다.

이 구성은 '실제 결선을 EMS 에 알려 주는 값'이다 — 여기서 바꾼다고 케이블이 옮겨지지 않는다. 실제 결선을 바꾼 뒤(또는 바꾸기 전에 검토하려고) 맞춰 넣는다.
바꿀 때마다 check() 가 구성의 약점을 찾아 알려 주고, 고칠 수 있는 것은 고치는 방법(fix)을 함께 준다. auto() 는 그 방법을 차례로 적용한다.

점검하는 것
  ① 모선마다 전압을 세울 전원(계통 형성: 이동형 ESS · 복합전력 ESS)이 있는가 — 없으면 모선 연계 차단기가 열릴 때 그 모선이 정전된다.
  ② 1등급 부하가 물린 모선에 전원이 있는가.
  ③ 연계 차단기가 열렸을 때 모선마다 전원 정격이 부하 정격을 감당하는가.
  ④ 전원이 한 모선에만 몰려 있지 않은가."""

import re

NODES = ("GRID", "PV", "DG", "FC", "GDG", "ESS", "G1", "L1", "L2", "L3")
NAME = {"GRID": "상전 수전", "PV": "태양광", "DG": "디젤 발전기", "FC": "연료전지", "GDG": "주둔지 발전기", "ESS": "이동형 ESS", "G1": "복합전력 ESS", "L1": "1등급 부하", "L2": "2등급 부하", "L3": "3등급 부하"}
DEFAULT = {"GRID": "A", "PV": "A", "DG": "A", "FC": "A", "GDG": "B", "ESS": "B", "G1": "A", "L1": "A", "L2": "B", "L3": "B"}      # 계통 형성 전원을 모선마다 하나씩(복합전력 ESS = A, 이동형 ESS = B) — 연계 차단기가 열려도 두 모선이 모두 선다(Rev60)
SOURCES = ("GRID", "PV", "DG", "FC", "GDG", "ESS", "G1"); LOADS = ("L1", "L2", "L3")
FORMING = ("ESS", "G1")           # 자립 운전에서 모선의 전압 · 주파수를 늘 세우는 전원(계통 형성)
STARTING = ("DG", "GDG", "GRID")  # 돌거나 붙어 있을 때만 전압을 주는 전원
OTHER = {"A": "B", "B": "A"}


UNIT = re.compile(r"^(PV|DG|FC|ESS)([2-9])$")      # 같은 종류의 추가 장비(2호기 …) — 호기마다 모선을 따로 정할 수 있다


def kind_of(n):
    """장치 이름 → 종류(ESS2 → ESS). 종류 이름은 그대로."""
    m = UNIT.match(n); return m.group(1) if m else n


def unit_name(n):
    m = UNIT.match(n); return f"{NAME[m.group(1)]} {m.group(2)}호기" if m else NAME.get(n, n)


def bus_of(assign, n):
    """그 장치(또는 종류)가 물린 모선: 호기에 따로 정한 값이 있으면 그것, 없으면 종류의 값."""
    return assign.get(n) or assign[kind_of(n)]


def settings(o):
    """저장된 구성을 다듬는다: 모르는 이름 · 값은 버리고 빠진 것은 기본값으로. 추가 장비(ESS2 …)의 값은 그대로 둔다."""
    out = dict(DEFAULT)
    if isinstance(o, dict): out.update({k: v for k, v in o.items() if (k in DEFAULT or (isinstance(k, str) and UNIT.match(k))) and v in ("A", "B")})
    return out


def _each(n, units):
    """종류 n 의 장치 이름들(여러 대가 아니면 종류 이름 하나)."""
    return list((units or {}).get(n) or [n])


def _on(assign, bus, present, pick, units=None):
    """bus 에 한 대라도 물린 종류들."""
    return [n for n in pick if n in present and any(bus_of(assign, u) == bus for u in _each(n, units))]


def _kw(assign, bus, rated, pick, units):
    """bus 에 물린 정격 합: 종류의 정격을 그 모선에 있는 대수 비율로 나눈다."""
    tot = 0.0
    for n in pick:
        us = _each(n, units); tot += rated.get(n, 0.0) * sum(1 for u in us if bus_of(assign, u) == bus) / len(us)
    return tot


def _no_forming(assign, bus, present, src, lds, units=None):
    """① 이 모선에 늘 전압을 세우는 전원이 없을 때의 약점 한 건. 반대쪽에 계통 형성 장비가 둘 이상이면 하나를(추가 장비 → 복합전력 ESS 차례로) 옮기는 방법을 준다."""
    other = [u for n in FORMING if n in present for u in _each(n, units) if bus_of(assign, u) == OTHER[bus]]; fix = {other[-1]: bus} if len(other) >= 2 else None
    gen = [n for n in src if n in STARTING]                           # 돌려야 전압이 서는 전원(디젤 · 주둔지 발전기 · 상전)
    why = f"연계 차단기가 열리면 {NAME[gen[0]]}가 전압을 줄 때까지 이 모선은 정전된다" if gen else "연계 차단기가 열리면 이 모선은 정전된다"
    tail = ""
    if fix: tail = f" {unit_name(other[-1])} 를 모선 {bus} 로 옮기면 해결된다."
    elif len(other) < 2: tail = " 계통 형성 전원이 하나뿐이라 옮길 수 없다 — 연계 차단기를 닫아 두고 운용한다."
    return {"level": "bad" if lds and not gen else "warn", "bus": bus, "fix": fix, "text": f"모선 {bus} 에 늘 전압을 세우는 전원(이동형 ESS · 복합전력 ESS)이 없다 — {why}." + tail}


def _bus_issues(assign, bus, present, rated, units=None, load_kw=None):
    """모선 하나의 약점(①②③). load_kw 가 있으면 부하는 그것(부하 하나하나가 물린 모선의 등급별 정격 합)으로 본다."""
    out = []; src = _on(assign, bus, present, SOURCES, units)
    lds = _on(assign, bus, present, LOADS, units) if load_kw is None else [f"L{g}" for g in (1, 2, 3) if load_kw[bus].get(g, 0.0) > 0]
    if not src and not lds: return out
    if not _on(assign, bus, present, FORMING, units): out.append(_no_forming(assign, bus, present, src, lds, units))
    if "L1" in lds and not src: out.append({"level": "bad", "bus": bus, "fix": None, "text": f"1등급 부하가 물린 모선 {bus} 에 전원이 하나도 없다 — 연계 차단기에만 기댄다."})
    need = _kw(assign, bus, rated, [n for n in lds], units) if load_kw is None else sum(load_kw[bus].values()); have = _kw(assign, bus, rated, [n for n in src if n != "GRID"], units)
    if lds and src and rated and need > have + 0.5: out.append({"level": "warn", "bus": bus, "fix": None, "text": f"모선 {bus}: 부하 정격 {need:.0f} kW 가 전원 정격 {have:.0f} kW 보다 크다 — 연계 차단기가 열리면 부하를 다 감당하지 못한다(자동 절감 · 차단이 동작한다)."})
    return out


def check(assign, present, rated=None, units=None, load_kw=None):
    """구성의 약점. present: 지금 있는 전원 · 부하의 종류 이름 모음, rated: {종류: 정격 kW 합}(없으면 정격 비교를 건너뛴다), units: {종류: [장치 이름 …]}(여러 대인 종류 — 호기마다 모선이 다를 수 있다).
    반환: [{"level": "bad" | "warn", "bus", "text", "fix": {이름: 모선} 또는 None}] — bad 는 정전으로 이어질 수 있는 것."""
    rated = rated or {}; out = _bus_issues(assign, "A", present, rated, units, load_kw) + _bus_issues(assign, "B", present, rated, units, load_kw)      # load_kw: {"A": {등급: kW}, "B": {…}} — 부하 하나하나가 물린 모선(구간분전함의 급전 쪽)으로 센 값
    used = {bus_of(assign, u) for n in SOURCES if n in present and n != "GRID" for u in _each(n, units)}
    far = any(assign[n] not in used for n in LOADS if n in present) if load_kw is None else any(sum(load_kw[b].values()) > 0 for b in ("A", "B") if b not in used)
    if len(used) == 1 and far:
        out.append({"level": "warn", "bus": OTHER[next(iter(used))], "fix": None, "text": f"전원이 모두 모선 {next(iter(used))} 에 있다 — 반대쪽 모선의 부하는 연계 차단기 하나에 기댄다."})
    return out


def auto(assign, present, rated=None, units=None, load_kw=None):
    """고칠 수 있는 약점을 차례로 고친다. 반환: (새 구성, 한 일 목록)"""
    a = dict(assign); done = []
    for _ in range(4):
        fix = next((i["fix"] for i in check(a, present, rated, units, load_kw) if i["fix"]), None)
        if not fix: break
        for n, bus in fix.items(): a[n] = bus; done.append(f"{unit_name(n)} → 모선 {bus}")
    return a, done


def live(assign, src_on, tie):
    """모선이 살아 있는지. src_on: 지금 모선에 전압을 줄 수 있는 전원 이름 모음(종류 또는 장치 이름 — 차단기 투입 + 운전), tie: 연계 차단기 투입. 반환: (A, B)"""
    a = any(bus_of(assign, n) == "A" for n in src_on); b = any(bus_of(assign, n) == "B" for n in src_on)
    return (a or (tie and b)), (b or (tie and a))
