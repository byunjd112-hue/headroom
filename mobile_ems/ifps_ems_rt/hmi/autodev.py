# -*- coding: utf-8 -*-
"""주 장치(발전기·연료전지·ESS·태양광 등)의 자동 인식: 작전지마다 가져가는 장치의 종류와 대수가 다르므로,
EMS 를 켠 뒤 한 번도 응답하지 않은 장치는 '설치되지 않은 장치'로 보고 화면에서 흐리게 하고 통신 두절 경보를 낮춘다(조작 없음).
한 번이라도 응답한 장치가 끊기면 그때는 평소대로 1등급 '통신 두절' 경보다. 설치했는데 응답이 없는 경우를 놓치지 않도록 3등급 알림은 남긴다.
"""
ALIVE = ("정상", "경로 저하", "재조회 대기")


def absent(eng, n):
    """그 장치가 설치되지 않은 것으로 보이는가: 지금 두절이고, 켠 뒤 한 번도 응답한 적이 없다."""
    st = eng.rt.lm.state.get(n)
    if st in ALIVE: eng.ever.add(n)
    return st == "두절" and n not in eng.ever


def link_alarm(eng, n, st):
    """통신 두절 경보. 설치되지 않은 것으로 보이는 장치는 3등급 알림으로 낮춘다."""
    gone = absent(eng, n)
    eng.alarms.set(f"link.{n}", st == "두절" and not gone, 1, n, f"{n} 통신 두절 — 지령 차단, 직전 유효값 유지")
    eng.alarms.set(f"absent.{n}", gone, 3, n, f"{n} 응답 없음 — 켠 뒤 한 번도 응답하지 않아 설치되지 않은 장치로 보고 화면에서 뺌(자동 인식). 설치했다면 통신선·주소 확인")
