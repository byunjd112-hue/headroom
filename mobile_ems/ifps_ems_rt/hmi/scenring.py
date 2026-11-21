# -*- coding: utf-8 -*-
"""시나리오용 환망(고리 모양 배전) 모형: 전원에서 나가 부하 마디를 차례로 지나 다시 전원으로 돌아오는 고리.

  전원 ─ S1 ─ N1 ─ S2 ─ N2 ─ S3 ─ N3 ─ S4 ─ 전원        (S = 구간, N = 부하 마디)
평소에는 한 구간을 열어 둔다(상시 개방점). 어느 구간이 끊어지면(단선) 그 구간을 양 끝에서 떼어 내고(구간 차단)
상시 개방점을 닫아 반대쪽에서 전기를 보낸다 — 부하는 계속 공급된다.

모의 신호(가상 장치에만 생긴다. 실제 대응표는 바뀌지 않는다)
  RING.<구간>  0 개방 · 1 투입 · 2 차단(고장으로 떼어 냄)        BRK.<구간>  1 = 단선(시험 입력)
  RN.<마디>    1 = 전기가 들어옴 · 0 = 정전                        RING.auto   1 = 자동 구간 차단·절체 사용(기본) · 0 = 수동
  RING.ok      1 = 모든 마디에 전기가 들어옴
구간 차단 시간(trip_ms)과 절체 시간(close_ms)은 시험용 가정값이다. 실제 값은 보호·배전 자동화 장치의 정정으로 정한다.
"""
import re

ID = re.compile(r"^[A-Z][A-Z0-9]{0,5}$")
DEFAULT = {"enabled": True, "name": "부하 환망(고리 모양 배전)", "sections": ["S1", "S2", "S3", "S4"], "open": "S3",
           "nodes": [{"id": "N1", "feeder": "L1"}, {"id": "N2", "feeder": "L2"}, {"id": "N3", "feeder": "L3"}], "trip_ms": 150, "close_ms": 400}
MAX_NODES = 8


def _shape(ring):
    """구간·마디 목록의 모양이 맞는지: 마디 n개면 구간은 n+1개."""
    sec, nodes = ring.get("sections"), ring.get("nodes")
    return isinstance(sec, list) and isinstance(nodes, list) and 1 <= len(nodes) <= MAX_NODES and len(sec) == len(nodes) + 1 and all(isinstance(n, dict) for n in nodes)


def check(ring, feeders, bad):
    """구조 검사: 마디 n개면 구간은 n+1개, 상시 개방점은 구간 중 하나."""
    if ring is None: return
    if not isinstance(ring, dict): bad.append("환망: 객체여야 함"); return
    if not _shape(ring): bad.append(f"환망: 마디 1~{MAX_NODES}개, 구간은 마디보다 하나 많아야 함"); return
    sec, nodes = ring["sections"], ring["nodes"]; ids = sec + [n.get("id") for n in nodes]
    if any(not isinstance(i, str) or not ID.fullmatch(i) for i in ids) or len(set(ids)) != len(ids): bad.append("환망: 구간·마디 이름은 영문 대문자로 시작하는 6자 이내, 겹치지 않게")
    if ring.get("open") not in sec: bad.append("환망: 상시 개방점(open)은 구간 중 하나")
    if any(n.get("feeder") and n["feeder"] not in feeders for n in nodes): bad.append("환망: 마디의 급전선(feeder)이 구성에 없음")
    for k, lo, hi in (("trip_ms", 0, 5000), ("close_ms", 0, 10000)):
        v = ring.get(k, DEFAULT[k])
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi: bad.append(f"환망.{k}: {lo}~{hi} ms")


def points(ring, add):
    """모의 신호를 만든다(add 는 scenextra.points 의 것)."""
    if not ring or not ring.get("enabled", True): return
    for s in ring["sections"]: add(f"RING.{s}", "u16", 1.0, "", 0.0, 2.0); add(f"BRK.{s}", "u16", 1.0, "", 0.0, 1.0)
    for n in ring["nodes"]: add(f"RN.{n['id']}", "u16", 1.0, "", 0.0, 1.0)
    add("RING.auto", "u16", 1.0, "", 0.0, 1.0); add("RING.ok", "u16", 1.0, "", 0.0, 1.0)


class Ring:
    """가상 장치 위에서 환망을 움직인다."""
    def __init__(self, ring, plant, kw):
        self.r = ring if ring and ring.get("enabled", True) and f"RING.{ring['sections'][0]}" in plant.by_tag else None; self.p = plant; self.kw = kw; self.t_brk = {}; self.t_trip = None; self.saved = {}; self.armed = False
        if self.r is None: return
        for s in self.r["sections"]: plant.set(f"RING.{s}", 0 if s == self.r["open"] else 1); plant.set(f"BRK.{s}", 0)
        plant.set("RING.auto", 1); self._nodes()

    def _state(self, s): return int(round(self.p.get(f"RING.{s}")))
    def _conducts(self, s): return self._state(s) == 1 and int(round(self.p.get(f"BRK.{s}"))) == 0

    def _nodes(self):
        """마디마다 전기가 들어오는지: 왼쪽으로든 오른쪽으로든 전원까지 이어져 있으면 들어온다."""
        sec = self.r["sections"]; ok = [self._conducts(s) for s in sec]; src = "BUS.b_v" not in self.p.by_tag or self.p.get("BUS.b_v") > 300.0; live_all = True
        self.armed = self.armed or src; src = src or not self.armed                       # 모선 전압을 한 번 본 뒤부터 전원 정전을 따진다(기동 직후의 0 V 를 정전으로 보지 않게)
        for k, n in enumerate(self.r["nodes"]):
            live = src and (all(ok[:k + 1]) or all(ok[k + 1:])); self.p.set(f"RN.{n['id']}", 1 if live else 0); live_all = live_all and live
            tag = self.kw.get(n.get("feeder") or "")
            if not tag or tag not in self.p.by_tag: continue
            if not live and n["id"] not in self.saved: self.saved[n["id"]] = self.p.get(tag); self.p.set(tag, 0.0)          # 정전된 마디의 부하는 0 으로, 다시 들어오면 되돌린다
            elif live and n["id"] in self.saved:
                was = self.saved.pop(n["id"])
                if abs(self.p.get(tag)) < 1e-9: self.p.set(tag, was)                      # 그 사이 시험이 새 값을 넣었으면 그 값을 둔다
        self.p.set("RING.ok", 1 if live_all else 0)

    def tick(self, now):
        if self.r is None: return
        auto = int(round(self.p.get("RING.auto"))) == 1
        for s in self.r["sections"]:
            broken = int(round(self.p.get(f"BRK.{s}"))) == 1
            if not broken or self._state(s) != 1: self.t_brk.pop(s, None); continue
            if not auto: continue
            t0 = self.t_brk.setdefault(s, now)
            if now - t0 >= self.r.get("trip_ms", DEFAULT["trip_ms"]) / 1000.0: self.p.set(f"RING.{s}", 2); self.t_brk.pop(s, None); self.t_trip = now       # 구간 차단
        no = self.r["open"]
        if auto and self.t_trip is not None and now - self.t_trip >= self.r.get("close_ms", DEFAULT["close_ms"]) / 1000.0:
            if self._state(no) == 0 and int(round(self.p.get(f"BRK.{no}"))) == 0: self.p.set(f"RING.{no}", 1)                                              # 상시 개방점 투입 → 반대쪽에서 공급
            self.t_trip = None
        self._nodes()
