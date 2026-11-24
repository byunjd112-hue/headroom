# -*- coding: utf-8 -*-
"""모선 구성: 전원과 부하 급전선이 모선 A · B 가운데 어디에 물렸는지. 결선도 · 운영 시나리오 구성도 · 가상 장치의 모선 전압 계산이 이 구성 하나를 같이 쓴다.

이 구성은 '실제 결선을 EMS 에 알려 주는 값'이다 — 여기서 바꾼다고 케이블이 옮겨지지 않는다. 실제 결선을 바꾼 뒤(또는 바꾸기 전에 검토하려고) 맞춰 넣는다.
바꿀 때마다 check() 가 구성의 약점을 찾아 알려 주고, 고칠 수 있는 것은 고치는 방법(fix)을 함께 준다. auto() 는 그 방법을 차례로 적용한다.

점검하는 것
  ① 모선마다 전압을 세울 전원(계통 형성: 이동형 ESS · 복합전력 ESS)이 있는가 — 없으면 모선 연계 차단기가 열릴 때 그 모선이 정전된다.
  ② 1등급 부하가 물린 모선에 전원이 있는가.
  ③ 연계 차단기가 열렸을 때 모선마다 전원 정격이 부하 정격을 감당하는가.
  ④ 전원이 한 모선에만 몰려 있지 않은가."""

NODES = ("GRID", "PV", "DG", "FC", "GDG", "ESS", "G1", "L1", "L2", "L3")
NAME = {"GRID": "상전 수전", "PV": "태양광", "DG": "디젤 발전기", "FC": "연료전지", "GDG": "주둔지 발전기", "ESS": "이동형 ESS", "G1": "복합전력 ESS", "L1": "1등급 부하", "L2": "2등급 부하", "L3": "3등급 부하"}
DEFAULT = {"GRID": "A", "PV": "A", "DG": "A", "FC": "A", "GDG": "B", "ESS": "B", "G1": "B", "L1": "A", "L2": "B", "L3": "B"}
SOURCES = ("GRID", "PV", "DG", "FC", "GDG", "ESS", "G1"); LOADS = ("L1", "L2", "L3")
FORMING = ("ESS", "G1")           # 자립 운전에서 모선의 전압 · 주파수를 늘 세우는 전원(계통 형성)
STARTING = ("DG", "GDG", "GRID")  # 돌거나 붙어 있을 때만 전압을 주는 전원
OTHER = {"A": "B", "B": "A"}


def settings(o):
    """저장된 구성을 다듬는다: 모르는 이름 · 값은 버리고 빠진 것은 기본값으로."""
    out = dict(DEFAULT)
    if isinstance(o, dict): out.update({k: v for k, v in o.items() if k in DEFAULT and v in ("A", "B")})
    return out


def _on(assign, bus, present, pick):
    return [n for n in pick if assign[n] == bus and n in present]


def check(assign, present, rated=None):
    """구성의 약점. present: 지금 있는 전원 · 부하의 이름 모음, rated: {이름: 정격 kW}(없으면 정격 비교를 건너뛴다).
    반환: [{"level": "bad" | "warn", "bus", "text", "fix": {이름: 모선} 또는 None}] — bad 는 정전으로 이어질 수 있는 것."""
    out = []; rated = rated or {}; form = [n for n in FORMING if n in present]
    for bus in ("A", "B"):
        here = [n for n in NODES if assign[n] == bus and n in present]
        if not here: continue
        f = _on(assign, bus, present, FORMING); src = _on(assign, bus, present, SOURCES); lds = _on(assign, bus, present, LOADS)
        if not f:
            spare = _on(assign, OTHER[bus], present, FORMING); fix = {spare[-1]: bus} if len(spare) >= 2 else None      # 반대쪽에 계통 형성 전원이 둘이면 하나를 옮긴다(복합전력 ESS 를 먼저)
            gen = [n for n in src if n in STARTING]                    # 돌려야 전압이 서는 전원(디젤 · 주둔지 발전기 · 상전)
            why = f"연계 차단기가 열리면 {NAME[gen[0]]}가 전압을 줄 때까지 이 모선은 정전된다" if gen else "연계 차단기가 열리면 이 모선은 정전된다"
            out.append({"level": "bad" if lds and not gen else "warn", "bus": bus, "fix": fix, "text": f"모선 {bus} 에 늘 전압을 세우는 전원(이동형 ESS · 복합전력 ESS)이 없다 — {why}."
                        + (f" {NAME[spare[-1]]} 를 모선 {bus} 로 옮기면 해결된다." if fix else " 계통 형성 전원이 하나뿐이라 옮길 수 없다 — 연계 차단기를 닫아 두고 운용한다." if len(form) < 2 else "")})
        if "L1" in lds and not src: out.append({"level": "bad", "bus": bus, "fix": None, "text": f"1등급 부하가 물린 모선 {bus} 에 전원이 하나도 없다 — 연계 차단기에만 기댄다."})
        need = sum(rated.get(n, 0.0) for n in lds); have = sum(rated.get(n, 0.0) for n in src if n != "GRID")
        if lds and src and rated and need > have + 0.5: out.append({"level": "warn", "bus": bus, "fix": None, "text": f"모선 {bus}: 부하 정격 {need:.0f} kW 가 전원 정격 {have:.0f} kW 보다 크다 — 연계 차단기가 열리면 부하를 다 감당하지 못한다(자동 절감 · 차단이 동작한다)."})
    used = {assign[n] for n in SOURCES if n in present and n != "GRID"}
    if len(used) == 1 and any(assign[n] not in used for n in LOADS if n in present):
        out.append({"level": "warn", "bus": OTHER[next(iter(used))], "fix": None, "text": f"전원이 모두 모선 {next(iter(used))} 에 있다 — 반대쪽 모선의 부하는 연계 차단기 하나에 기댄다."})
    return out


def auto(assign, present, rated=None):
    """고칠 수 있는 약점을 차례로 고친다. 반환: (새 구성, 한 일 목록)"""
    a = dict(assign); done = []
    for _ in range(4):
        fix = next((i["fix"] for i in check(a, present, rated) if i["fix"]), None)
        if not fix: break
        for n, bus in fix.items(): a[n] = bus; done.append(f"{NAME[n]} → 모선 {bus}")
    return a, done


def live(assign, src_on, tie):
    """모선이 살아 있는지. src_on: 지금 모선에 전압을 줄 수 있는 전원 이름 모음(차단기 투입 + 운전), tie: 연계 차단기 투입. 반환: (A, B)"""
    a = any(assign[n] == "A" for n in src_on); b = any(assign[n] == "B" for n in src_on)
    return (a or (tie and b)), (b or (tie and a))
