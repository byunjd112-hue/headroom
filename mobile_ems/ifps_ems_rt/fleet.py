# -*- coding: utf-8 -*-
"""같은 종류의 주 장치 여러 대를 스스로 알아내 한 묶음으로 다룬다(자동 인식 — 화면·설정 조작 없음).

  · 자리: runtime.json 의 devices 에 종류 이름 뒤에 번호를 붙인 장치(DG2, ESS2 …)를 두면 그 종류의 추가 자리다.
    대응표에 그 자리의 줄이 없으면 같은 종류 첫 장치(DG, ESS …)의 줄을 그대로 본뜬다(주소는 같고 통신 주소·장치 번호만 다르다).
  · 인식: 켠 뒤 응답한 자리만 '있는 장치'다. 한 번도 응답하지 않은 추가 자리는 빈 자리로 보고 경보·화면에서 뺀다(가끔만 다시 불러 본다).
  · 합산: 제어·화면이 쓰는 종류 이름의 값(DG.kw, ESS.soc …)은 있는 장치들의 합(또는 평균·하나라도 운전)으로 바꿔 넣는다. 장치별 값은 raw 에 남는다.
  · 분배: 기동·정지는 그 종류의 있는 장치 모두에게, 설정값(kW)은 똑같이 나누어 보낸다(대수별 순차 기동·정격 차이는 다루지 않는다).
같은 종류 장치는 그 종류의 급전 차단기(CB.DG 등) 아래에 함께 물린 것으로 본다(가정).
"""
import json, re
from . import fsio

KINDS = ("DG", "FC", "ESS", "PV", "ELZ")
SLOT = re.compile(r"^([A-Z]+?)([2-9])$")
AGG = {"kw": "sum", "fuel_l": "sum", "lim": "sum", "h2_rate": "sum", "kw_set": "sum", "lim_set": "sum", "status": "any", "soc": "mean", "ess_kw": "sum", "ess_soc": "mean"}      # ess_* : 복합전력 PCS 의 ESS
PROBE_S = 10.0                    # 응답한 적 없는 자리를 다시 불러 보는 간격(초)


def kind(name):
    """장치 이름 → 종류(DG2 → DG). 묶어 다루는 종류가 아니면 None."""
    if name in KINDS: return name
    m = SLOT.fullmatch(name); return m.group(1) if m and m.group(1) in KINDS else None


def is_slot(name):
    """추가 자리(DG2 …)인가."""
    return name not in KINDS and kind(name) is not None


def g1_cb(n):
    """복합전력 차량의 ESS 차단기 이름: 첫 차량(DG)은 G1, 추가 차량(DG2 …)은 G1_2 …"""
    return "G1" if n == "DG" else "G1_" + n[2:]


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
        self.slots = {}; self.names = list(names)          # slots: {종류: [장치 이름 …]} 첫 장치가 맨 앞. names: 모든 장치(묶지 않는 장치 포함 — 인식 목록 저장에 쓴다)
        for n in names:
            if kind(n): self.slots.setdefault(kind(n), []).append(n)
        for k in self.slots: self.slots[k].sort(key=lambda n: (n != k, n))
        self.ever = set() if seen is None else seen        # 켠 뒤 한 번이라도 응답한 장치(실행기의 seen 과 같은 집합)
        self.raw = {}; self.park = {}; self.live_now = {k: [] for k in self.slots}; self.keep = True; self.agg = {}      # keep: 인식 목록을 파일로 남길지(가상 장치 모드는 남기지 않는다)

    def restore(self, path):
        """재기동 전에 인식했던 장치를 되살린다. 그래야 TPCS 를 다시 켰을 때 그사이 고장 난 장치가 '설치되지 않은 장치'로 낮춰지지 않고 통신 두절(1등급)로 알려진다.
        철수한 장치는 설비 제어 화면의 − 로 지운다. 파일이 없거나 깨졌으면 아무것도 되살리지 않는다(처음 켠 것과 같다)."""
        self.path = path; known = set(self.names)
        try:
            with open(path, encoding="utf-8") as f: self.ever.update(n for n in json.load(f) if n in known)
        except (OSError, ValueError, TypeError): pass

    def store(self):
        """인식한 장치 목록을 적어 둔다(임시 파일 뒤 교체). 저장 실패는 운전을 막지 않는다."""
        path = getattr(self, "path", None)
        if not path or not self.keep: return
        try:
            fsio.write_json(path, sorted(self.ever))
        except OSError: pass

    def forget(self, n):
        """철수한 장치를 인식 목록에서 지운다(빈 자리로 돌아간다)."""
        self.ever.discard(n); self.store()

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

    def _hybrid(self, n):
        """복합전력 PCS 한 대의 ESS 쪽 값(그 차량의 ESS 그림에 쓴다): ess_kw · ess_soc · mode. 그런 신호가 없는 장치는 빈 값."""
        r = self.raw.get(n, {})
        return {k: r[f"{n}.{s}"] for k, s in (("ess_kw", "ess_kw"), ("ess_soc", "ess_soc"), ("mode", "pcs_mode")) if f"{n}.{s}" in r}

    def own_kw(self, n):
        """그 장치가 제 통신점으로 내주는 출력(인버터의 out_kw). 없으면 None."""
        return self.raw.get(n, {}).get(f"{n}.out_kw")

    def unit_kw(self, n, val):
        """장치 한 대의 출력: 제 통신점의 값이 있으면 그 값, 없으면 kw(태양광 첫 장비의 kw 는 게이트웨이가 잰 합계다)."""
        own = self.own_kw(n)
        return own if own is not None else self.unit(n, "kw", val)

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
            if v is not None and kind(n):
                self.raw[n] = v
                if n not in self.ever: self.ever.add(n); self.store()
        for k, names in self.slots.items():
            live = self.live_now[k] = [n for n in names if n in self.ever and state.get(n) != "두절"]
            if len(names) < 2 or not live: continue
            if any(got.get(n) is None for n in live):               # 있는 장치를 이번에 못 읽었다: 직전 합계를 그대로 둔다(첫 장치의 값만으로 합계인 척하지 않게)
                for suf in AGG: self._hold(f"{k}.{suf}", val)
                continue
            for suf, how in AGG.items(): self._sum(k, suf, how, live, val, mark, bad)

    def _sum(self, k, suf, how, live, val, mark, bad):
        """한 항목의 합산: 합 · 하나라도 운전 · 평균."""
        if any(f"{n}.{suf}" in bad for n in live): self._hold(f"{k}.{suf}", val); mark(f"{k}.{suf}", False); return
        xs = [self.raw[n][f"{n}.{suf}"] for n in live if f"{n}.{suf}" in self.raw.get(n, {})]
        if not xs: return
        self.agg[f"{k}.{suf}"] = val[f"{k}.{suf}"] = sum(xs) if how == "sum" else float(any(x > 0.5 for x in xs)) if how == "any" else sum(xs) / len(xs); mark(f"{k}.{suf}", True)

    def _hold(self, tag, val):
        """합산하지 못한 주기: 직전 합계를 되돌려 둔다. 첫 장치의 값은 종류 이름(DG.kw 등)으로 들어오므로, 두지 않으면 한 대의 값이 합계 자리에 남는다."""
        if tag in self.agg: val[tag] = self.agg[tag]

    def clean(self, val):
        """기록 보관용 값: 지금 없는 장치(빈 자리 · 뺀 장치 · 두절)의 묵은 값을 뺀다. 종류 이름의 값(DG.kw 등)은 그 종류가 한 대도 없을 때만 뺀다."""
        gone = {n for k, names in self.slots.items() if len(names) > 1 for n in names if n not in self.live_now[k] and (is_slot(n) or not self.live_now[k])}
        return {t: v for t, v in val.items() if t.partition(".")[0] not in gone} if gone and self.ever else dict(val)

    def span(self, tag, dev):
        """다른 장치(계측 게이트웨이)가 재는 종류 합계(PV.kw 등)의 범위 배율: 그 종류가 여러 대면 정격도 그만큼 는다."""
        k, _, suf = tag.partition(".")
        if k not in self.slots or dev == k or AGG.get(suf) != "sum": return 1
        spare = any(is_slot(n) and n not in self.ever for n in self.slots[k])      # 빈 자리가 있으면 한 대분의 여유: 막 연결한 장치가 인식되기 전(수 초)에 합계가 먼저 커져도 정상 값을 버리지 않는다
        return max(1, len(self.live_now.get(k, ()))) + int(spare)

    def view(self, state, dev, val):
        """화면용: {종류: {n, seen, slots, on, units: [{id, link, seen, on, manual, kw, soc}]}}"""
        out = {}
        for k, names in self.slots.items():
            us = [{"id": n, "link": state.get(n), "seen": n in self.ever, "live": n in self.live_now[k], "on": bool(self.unit(n, "status", val) or 0) if n in self.live_now[k] else False,
                   "manual": bool(dev[n].manual) if n in dev else False, "kw": self.unit_kw(n, val), "own": self.own_kw(n) is not None, "soc": self.unit(n, "soc", val), **self._hybrid(n)} for n in names]
            out[k] = {"n": len(self.live_now[k]), "seen": sum(1 for u in us if u["seen"]), "slots": len(names), "on": any(u["on"] for u in us), "units": [u for u in us if u["seen"]]}
        return out
