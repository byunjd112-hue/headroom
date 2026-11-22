# -*- coding: utf-8 -*-
"""시나리오 검증에서 장치를 놓고 빼는 모의 신호 UNIT.<장치>(1 = 놓임, 0 = 없음).
작전지마다 가져가는 장치의 종류 · 대수가 다르므로, 추가 · 철수 · 미휴대 상황을 운영 시나리오로 검증할 수 있게 한다(FMEA 의 '장치 구성 변화').
가상 장치에만 있는 신호다 — 실제 대응표에는 넣지 않는다. 처음 값은 첫 장치 1, 추가 자리(DG2 …) 0 이다.
"""
from .. import fleet

KINDS = ("DG", "FC", "ESS", "PV")


def devices(pts):
    return sorted({p["device"] for p in pts if fleet.kind(p["device"]) in KINDS}, key=lambda n: (KINDS.index(fleet.kind(n)), n != fleet.kind(n), n))


def points(pts, addr):
    """모의 신호(대응표 한 줄과 같은 모양). addr 부터 차례로 놓는다."""
    return [{"tag": f"UNIT.{d}", "device": "MTR", "fc": 4, "addr": addr + i, "type": "u16", "scale": 1.0, "unit": "", "lo": 0.0, "hi": 1.0, "rw": "r", "order_raw": "", "order": "ABCD", "virtual": True}
            for i, d in enumerate(devices(pts))]


def _each(plant):
    return [(t[5:], t) for t in plant.by_tag if t.startswith("UNIT.") and t[5:] in plant.units]


def start(plant):
    for d, t in _each(plant): plant.set(t, 0 if d in plant.gone else 1)


def tick(plant):
    """신호 값대로 가상 장치를 놓거나 뺀다."""
    for d, t in _each(plant): (plant.gone.discard if plant.get(t) > 0.5 else plant.gone.add)(d)


def fleet_merge(rt, plant):
    """EMS 판단(정책 실행) 직전에: 놓인 장치만 '있는 장치'로 보고 종류 이름의 값을 합산한다(실행기의 자동 인식과 같은 계산)."""
    got = {}
    for n, lk in rt.links.items():
        if not fleet.kind(n): continue
        gone = n in plant.gone; rt.lm.state[n] = "두절" if gone else "정상"
        got[n] = None if gone else {t: rt.val[t] for t in lk.by_tag if t in rt.val}
        if gone and fleet.is_slot(n):
            for t in lk.by_tag: rt.val.pop(t, None)
    rt.fleet.merge(got, rt.lm.state, rt.val, lambda tag, ok: None)
