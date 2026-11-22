# -*- coding: utf-8 -*-
"""같은 종류의 주 장치 여러 대를 스스로 알아내 한 묶음으로 다룬다(자동 인식 — 화면·설정 조작 없음).

  · 자리: runtime.json 의 devices 에 종류 이름 뒤에 번호를 붙인 장치(DG2, ESS2 …)를 두면 그 종류의 추가 자리다.
    대응표에 그 자리의 줄이 없으면 같은 종류 첫 장치(DG, ESS …)의 줄을 그대로 본뜬다(주소는 같고 통신 주소·장치 번호만 다르다).
  · 인식: 켠 뒤 응답한 자리만 '있는 장치'다. 한 번도 응답하지 않은 추가 자리는 빈 자리로 보고 경보·화면에서 뺀다(가끔만 다시 불러 본다).
  · 합산: 제어·화면이 쓰는 종류 이름의 값(DG.kw, ESS.soc …)은 있는 장치들의 합(또는 평균·하나라도 운전)으로 바꿔 넣는다. 장치별 값은 raw 에 남는다.
  · 분배: 기동·정지는 그 종류의 있는 장치 모두에게, 설정값(kW)은 똑같이 나누어 보낸다(대수별 순차 기동·정격 차이는 다루지 않는다).
같은 종류 장치는 그 종류의 급전 차단기(CB.DG 등) 아래에 함께 물린 것으로 본다(가정).
"""
import re

KINDS = ("DG", "FC", "ESS", "PV", "ELZ")
SLOT = re.compile(r"^([A-Z]+?)([2-9])$")
AGG = {"kw": "sum", "fuel_l": "sum", "lim": "sum", "h2_rate": "sum", "kw_set": "sum", "lim_set": "sum", "status": "any", "soc": "mean"}
PROBE_S = 10.0                    # 응답한 적 없는 자리를 다시 불러 보는 간격(초)


def kind(name):
    """장치 이름 → 종류(DG2 → DG). 묶어 다루는 종류가 아니면 None."""
    if name in KINDS: return name
    m = SLOT.fullmatch(name); return m.group(1) if m and m.group(1) in KINDS else None


def is_slot(name):
    """추가 자리(DG2 …)인가."""
    return name not in KINDS and kind(name) is not None


def expand(pts, devices):
    """대응표에 줄이 없는 추가 자리에 같은 종류 첫 장치의 줄을 본떠 넣는다. 종류 이름으로 시작하지 않는 점(공용 계측)은 본뜨지 않는다."""
    have = {p["device"] for p in pts}; out = list(pts)
    for n in devices or {}:
        k = kind(n)
        if n in have or not is_slot(n): continue
        out += [dict(p, tag=n + p["tag"][len(k):], device=n) for p in pts if p["device"] == k and p["tag"].startswith(k + ".")]
    return out


class Fleet:
    def __init__(self, names, seen=None):
        self.slots = {}                                    # {종류: [장치 이름 …]} 첫 장치가 맨 앞
        for n in names:
            if kind(n): self.slots.setdefault(kind(n), []).append(n)
        for k in self.slots: self.slots[k].sort(key=lambda n: (n != k, n))
        self.ever = set() if seen is None else seen        # 켠 뒤 한 번이라도 응답한 장치(실행기의 seen 과 같은 집합)
        self.raw = {}; self.park = {}; self.live_now = {k: [] for k in self.slots}

    def skip(self, n, t):
        """이번 주기에 읽지 않을 자리인가: 응답한 적 없는 추가 자리는 PROBE_S 마다만 불러 본다(없는 장치의 시간 초과가 주기를 잡아먹지 않게)."""
        if n in self.ever or not is_slot(n): return False
        if t < self.park.get(n, -1e9): return True
        nxt = next((m for m in self.slots.get(kind(n), ()) if is_slot(m) and m not in self.ever), None)      # 그 종류의 다음 빈 자리는 자주, 그 뒤 자리는 드물게(빈 자리가 많아도 불러 보는 부담이 늘지 않게)
        self.park[n] = t + (PROBE_S if n == nxt else 3 * PROBE_S); return False

    def empty(self, n):
        """빈 자리(응답한 적 없는 추가 자리)인가."""
        return is_slot(n) and n not in self.ever

    def live(self, k):
        """그 종류의 지금 있는 장치(응답한 적이 있고 지금 통신이 되는 것). 묶는 종류가 아니거나 아직 한 번도 읽지 않았으면 [k]."""
        return self.live_now[k] if k in self.live_now and self.ever else [k]

    def n(self, k):
        return len(self.live(k))

    def unit(self, n, suffix, val):
        """장치 하나의 값(합산 전). 없으면 val 의 값."""
        return self.raw.get(n, {}).get(f"{n}.{suffix}", val.get(f"{n}.{suffix}"))

    def running(self, k, val):
        """그 종류의 운전 중인 대수(상태 1). 아직 읽기 전이면 종류 이름의 상태로 0 또는 1."""
        if not (k in self.live_now and self.ever): return int((val.get(f"{k}.status") or 0) > 0.5)
        return sum(1 for n in self.live_now[k] if (self.unit(n, "status", val) or 0) > 0.5)

    def share(self, k):
        """설정값을 나눌 대수: 있는 장치 + 응답하다가 끊긴 장치(끊긴 장치는 마지막 몫을 그대로 쥐고 있을 수 있으므로 남은 장치에 몰아 주지 않는다)."""
        return max(1, len([n for n in self.slots.get(k, ()) if n in self.ever]))

    def merge(self, got, state, val, mark, bad=()):
        """읽은 값(got: {장치: 값 사전 또는 None})으로 있는 장치를 가리고, 종류 이름의 값을 합산해 val 에 넣는다.
        got 의 값은 품질 검사를 통과한 것만 넘긴다. bad: 이번에 검사에서 떨어진 점 이름 — 그 점이 낀 합산은 하지 않고 직전 값을 둔다(mark(tag, False)).
        있는 장치 가운데 이번 주기에 읽지 못한 것이 있어도 합산하지 않는다(묵은 값을 새 값처럼 쓰지 않는다)."""
        for n, v in got.items():
            if v is not None and kind(n): self.ever.add(n); self.raw[n] = v
        for k, names in self.slots.items():
            live = self.live_now[k] = [n for n in names if n in self.ever and state.get(n) != "두절"]
            if len(names) < 2 or not live or any(got.get(n) is None for n in live): continue
            for suf, how in AGG.items(): self._sum(k, suf, how, live, val, mark, bad)

    def _sum(self, k, suf, how, live, val, mark, bad):
        """한 항목의 합산: 합 · 하나라도 운전 · 평균."""
        if any(f"{n}.{suf}" in bad for n in live): mark(f"{k}.{suf}", False); return
        xs = [self.raw[n][f"{n}.{suf}"] for n in live if f"{n}.{suf}" in self.raw.get(n, {})]
        if not xs: return
        val[f"{k}.{suf}"] = sum(xs) if how == "sum" else float(any(x > 0.5 for x in xs)) if how == "any" else sum(xs) / len(xs); mark(f"{k}.{suf}", True)

    def span(self, tag, dev):
        """다른 장치(계측 게이트웨이)가 재는 종류 합계(PV.kw 등)의 범위 배율: 그 종류가 여러 대면 정격도 그만큼 는다."""
        k, _, suf = tag.partition(".")
        return max(1, len(self.live_now.get(k, ()))) if k in self.slots and dev != k and AGG.get(suf) == "sum" else 1

    def view(self, state, dev, val):
        """화면용: {종류: {n, seen, slots, on, units: [{id, link, seen, on, manual, kw, soc}]}}"""
        out = {}
        for k, names in self.slots.items():
            us = [{"id": n, "link": state.get(n), "seen": n in self.ever, "live": n in self.live_now[k], "on": bool(self.unit(n, "status", val) or 0) if n in self.live_now[k] else False,
                   "manual": bool(dev[n].manual) if n in dev else False, "kw": self.unit(n, "kw", val), "soc": self.unit(n, "soc", val)} for n in names]
            out[k] = {"n": len(self.live_now[k]), "seen": sum(1 for u in us if u["seen"]), "slots": len(names), "on": any(u["on"] for u in us), "units": [u for u in us if u["seen"]]}
        return out
