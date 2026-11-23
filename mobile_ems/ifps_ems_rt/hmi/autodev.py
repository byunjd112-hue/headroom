# -*- coding: utf-8 -*-
"""주 장치(발전기·연료전지·ESS·태양광 등)의 자동 인식: 작전지마다 가져가는 장치의 종류와 대수가 다르므로,
EMS 를 켠 뒤 한 번도 응답하지 않은 장치는 '설치되지 않은 장치'로 보고 화면에서 흐리게 하고 통신 두절 경보를 낮춘다(조작 없음).
한 번이라도 응답한 장치가 끊기면 그때는 평소대로 1등급 '통신 두절' 경보다. 설치했는데 응답이 없는 경우를 놓치지 않도록 3등급 알림은 남긴다.
같은 종류의 추가 자리(DG2 …)가 빈 것은 알리지 않는다. 같은 종류가 한 대라도 있으면 첫 자리가 빈 것도 알리지 않는다(ifps_ems_rt/fleet.py).
"""
from .. import fleet


def absent(eng, n):
    """그 장치가 설치되지 않은 것으로 보이는가: 지금 두절이고, 켠 뒤 한 번도 응답한 적이 없다."""
    return eng.rt.lm.state.get(n) == "두절" and n not in eng.rt.seen


def link_alarm(eng, n, st):
    """통신 두절 경보. 설치되지 않은 것으로 보이는 장치는 3등급 알림으로 낮춘다."""
    gone = absent(eng, n) or n in getattr(eng, "unit_drop", ()); k = fleet.kind(n)      # 빼기로 한 장치(unitctl)는 끊겨도 두절 경보를 내지 않는다
    alone = k is None or not any(u in eng.rt.seen for u in eng.rt.fleet.slots.get(k, ()))          # 그 종류가 한 대도 없는가
    eng.alarms.set(f"link.{n}", st == "두절" and not gone, 1, n, f"{n} 통신 두절 — 지령 차단, 직전 유효값 유지")
    eng.alarms.set(f"absent.{n}", gone and alone and not fleet.is_slot(n), 3, n, f"{n} 응답 없음 — 켠 뒤 한 번도 응답하지 않아 설치되지 않은 장치로 보고 화면에서 뺌(자동 인식). 설치했다면 통신선·주소 확인")


def cycle(eng):
    """주기마다 하는 자동 인식 쪽 일(엔진의 줄 수를 늘리지 않으려고 한데 모았다)."""
    from . import unitctl
    from .. import hybrid
    ems_power(eng); unitctl.cycle(eng)
    for key, on, prio, src, text in hybrid.alarms(eng.rt, eng.rt.now()): eng.alarms.set(key, on, prio, src, text)


def ems_power(eng):
    """EMS 쉘터의 주 전원(배전 모선)이 끊겼는지. EMS 는 입력 3종(상전 · 모선 · 차량 28 V) 자동 절체와 무정전 전원으로 켜져 있지만,
    모선이 죽으면 배터리 · 차량 전원으로 버티는 중이므로 운용자에게 알린다. 무정전 전원의 상태 신호는 아직 대응표에 없어 모선 전압으로 미루어 본다(추정)."""
    v = eng.rt.val; a, b = v.get("BUS.a_v"), v.get("BUS.b_v"); gw = eng.rt.lm.state.get("MTR") not in ("두절", "재조회 대기")
    dead = gw and a is not None and b is not None and a < 300.0 and b < 300.0
    eng.alarms.set("ems.power", bool(dead), 2, "EMS", "EMS 주 전원(배전 모선) 상실 — 무정전 전원으로 운전 중(추정). 차량 28 V 입력을 연결하고 배터리 잔량을 확인하십시오. 잔량이 낮아지면 기록을 닫고 정상 종료합니다")
