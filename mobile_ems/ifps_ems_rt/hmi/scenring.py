# -*- coding: utf-8 -*-
"""시나리오 검증기에서 환망을 움직인다. 환망의 정의와 감시 논리는 ifps_ems_rt/ring.py 에 있고, 구간분전함(FSU)·휴대용 배전체계(PPDU-20)의 신호는 실제 대응표에 있다.

여기서는 시험에만 쓰는 모의 신호 둘을 보탠다(가상 장치에만 생긴다).
  BRK.<구간 번호>   1 = 그 구간 단선(시험 입력). 구간 0 은 전원 ─ FSU1, 구간 k 는 FSUk ─ 다음.
  RING.ok           1 = 모든 FSU 에 전기가 들어옴
구간 차단 시간(trip_ms)과 절체 시간(close_ms)은 runtime.json 의 ring 에 있는 시험용 가정값이다.
"""
import json
from .. import ring


def config(profile):
    """runtime.json 의 ring 설정(없거나 끄면 None)."""
    if not profile: return None
    try:
        with open(profile, encoding="utf-8") as f: return ring.settings(json.load(f).get("ring"))
    except (OSError, ValueError):
        return None


def points(r, add):
    """모의 신호를 만든다(add 는 scenextra.points 의 것)."""
    if not r: return
    for i in range(len(r["fsu"]) + 1): add(f"BRK.{i}", "u16", 1.0, "", 0.0, 1.0)
    add("RING.ok", "u16", 1.0, "", 0.0, 1.0)


class Ring(ring.Model):
    """가상 장치의 환망 + 모든 마디에 전기가 들어오는지(RING.ok)."""
    def tick(self, now):
        if self.r is None: return
        super().tick(now)
        if "RING.ok" in self.p.by_tag: self.p.set("RING.ok", 1 if all(self.p.get(f"{f['id']}.v") >= ring.V_LIVE for f in self.r["fsu"]) else 0)
