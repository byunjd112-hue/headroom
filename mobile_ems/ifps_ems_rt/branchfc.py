# -*- coding: utf-8 -*-
"""분기별 부하 예측. 구간분전함(FSU) · 휴대용 배전체계(PPDU)의 분기 전력계가 재는 전력(kW)과 전력량(kWh)으로 분기마다 앞으로 24시간의 부하를 예측한다.

방법(단순하고 설명할 수 있는 것)
  ① 15분 구간마다 분기의 평균 전력을 구한다. 전력량계 값이 있으면 구간 처음과 끝의 차이(kWh × 4)를 쓰고, 없으면 전력 표본의 평균을 쓴다.
  ② 하루 96구간의 '시간대 평균'을 분기마다 둔다. 새 값이 들어오면 지수 가중(ALPHA)으로 섞는다 — 최근 며칠의 모습을 따라간다.
  ③ 예측 = 시간대 평균 × 수준 보정. 수준 보정은 최근 1시간의 실측이 시간대 평균보다 얼마나 큰지(0.5~2배)이며, 먼 시각일수록 1 에 가까워진다(TAU 구간).
  ④ 구간이 끝날 때마다 1시간 전에 한 예측과 실측을 견주어 평균 오차를 쌓는다 — 화면에 그대로 보인다.
전체 부하 예측(오프라인 학습 AI)은 바꾸지 않는다. 분기 예측의 합은 그 옆에 견주어 보이는 값이다(분기에 물리지 않은 부하는 들어 있지 않다)."""
import math

SLOTS = 96; ALPHA = 0.3; TAU = 12.0; LEAD = 4      # 하루 구간 수 · 시간대 평균의 섞는 비율 · 수준 보정이 줄어드는 길이(구간) · 오차를 재는 앞선 시간(구간, 1시간)
MAX_KW = 5000.0                   # 전력량 차이로 구한 평균 전력이 이보다 크면(계량기 교체 · 초기화) 버리고 표본 평균을 쓴다


def slot_of(wall):
    """벽시계 → (날짜 글, 하루 중 구간 0~95)"""
    return wall.strftime("%Y-%m-%d"), wall.hour * 4 + wall.minute // 15


class Book:
    """분기별 시간대 평균 · 최근 실측 · 오차. state() 를 파일에 두었다가 restore 로 되살린다."""

    def __init__(self, state=None):
        s = state if isinstance(state, dict) else {}
        self.b = {k: v for k, v in (s.get("b") or {}).items() if isinstance(v, dict) and len(v.get("prof", ())) == SLOTS}
        self.demo = bool(s.get("demo")); self.cur = None; self.acc = {}; self.day0 = dict(s.get("day0") or {}); self.day = s.get("day")

    def state(self):
        return {"b": self.b, "demo": self.demo, "day0": self.day0, "day": self.day}

    def _row(self, i):
        return self.b.setdefault(i, {"prof": [None] * SLOTS, "n": 0, "recent": [], "pend": {}, "err": [0.0, 0.0, 0]})

    def feed(self, day, slot, samples):
        """한 주기의 표본. samples: {분기: (kW 또는 None, 누적 kWh 또는 None)}. 반환: 구간이 바뀌어 닫았으면 True(저장할 때)."""
        closed = False
        if self.cur is not None and self.cur != (day, slot): self._close(self.cur[1]); closed = True
        if self.day != day: self.day = day; self.day0 = {i: kwh for i, (_, kwh) in samples.items() if kwh is not None}      # 오늘 전력량의 기준(자정 또는 켠 때의 누적값)
        self.cur = (day, slot)
        for i, (kw, kwh) in samples.items():
            a = self.acc.setdefault(i, [0.0, 0, None, None])
            if kw is not None and math.isfinite(kw): a[0] += kw; a[1] += 1
            if kwh is not None and math.isfinite(kwh):
                if a[2] is None: a[2] = kwh
                a[3] = kwh
                if i not in self.day0: self.day0[i] = kwh
        return closed

    def _mean(self, a):
        """구간 평균 전력: 전력량계의 차이를 먼저 쓰고(구간을 다 채웠을 때만), 아니면 전력 표본의 평균."""
        if a[1] >= 600 and a[2] is not None and a[3] is not None and 0 <= (a[3] - a[2]) * 4 <= MAX_KW: return (a[3] - a[2]) * 4
        return a[0] / a[1] if a[1] else None

    def _close(self, slot):
        for i, a in self.acc.items():
            x = self._mean(a)
            if x is None: continue
            r = self._row(i); f = r["pend"].pop(str(slot), None)
            if f is not None and max(abs(x), abs(f)) >= 0.5: r["err"][0] += abs(f - x); r["err"][1] += abs(x); r["err"][2] += 1      # 1시간 전 예측과 견준다
            p = r["prof"][slot]; r["prof"][slot] = x if p is None else p + ALPHA * (x - p); r["n"] += 1
            r["recent"] = (r["recent"] + [[slot, x]])[-4:]
            nxt = self.forecast(i, (slot + 1) % SLOTS, LEAD)
            if nxt[LEAD - 1] is not None: r["pend"][str((slot + LEAD) % SLOTS)] = nxt[LEAD - 1]
            if len(r["pend"]) > 2 * LEAD: r["pend"] = dict(list(r["pend"].items())[-LEAD:])
        self.acc = {}
        if any(r["n"] >= SLOTS for r in self.b.values()): self.demo = False      # 실측이 하루치 쌓이면 시연용 표시를 뗀다

    def level(self, i):
        """수준 보정: 최근 실측 / 그 시각의 시간대 평균(0.5~2). 견줄 것이 없으면 1."""
        r = self.b.get(i); pair = [(x, r["prof"][s]) for s, x in (r["recent"] if r else []) if r["prof"][s]]
        den = sum(p for _, p in pair)
        return min(2.0, max(0.5, sum(x for x, _ in pair) / den)) if pair and den > 0.2 else 1.0

    def forecast(self, i, slot, n=SLOTS):
        """slot 부터 n 구간의 예측 전력(kW). 시간대 평균이 없는 구간은 None."""
        r = self.b.get(i)
        if r is None: return [None] * n
        lv = self.level(i)
        return [None if r["prof"][(slot + k) % SLOTS] is None else max(0.0, r["prof"][(slot + k) % SLOTS] * (1 + (lv - 1) * math.exp(-k / TAU))) for k in range(n)]

    def seed(self, i, kw, shape):
        """시연용: 지금 전력과 하루 모양(shape: 96구간의 상대 크기)으로 시간대 평균을 채운다. 실측이 아니므로 demo 표시를 켠다."""
        if kw is None or i in self.b: return
        now = shape[self.cur[1]] if self.cur else 1.0; r = self._row(i); r["prof"] = [round(kw * s / max(now, 1e-6), 2) for s in shape]; self.demo = True

    def row(self, i, slot, kw, kwh):
        """화면 한 줄: 지금 · 오늘 전력량 · 다음 1시간 · 24시간 예측 · 최대 시각 · 오차."""
        f = self.forecast(i, (slot + 1) % SLOTS); have = [x for x in f if x is not None]; r = self.b.get(i) or {"n": 0, "err": [0, 0, 0]}
        pk = max(range(SLOTS), key=lambda k: f[k] if f[k] is not None else -1.0) if have else None; t = None if pk is None else (slot + 1 + pk) % SLOTS
        e = r["err"]; nxt = [x for x in f[:4] if x is not None]
        return {"kw": kw, "kwh": kwh, "today_kwh": None if kwh is None or i not in self.day0 else round(max(0.0, kwh - self.day0[i]), 1),
                "next1h": round(sum(nxt) / len(nxt), 1) if nxt else None, "next24_kwh": round(sum(have) / 4, 0) if len(have) == SLOTS else None,
                "peak_kw": None if pk is None else round(f[pk], 1), "peak_at": None if t is None else f"{t // 4:02d}:{t % 4 * 15:02d}",
                "err_pct": round(100 * e[0] / e[1], 1) if e[2] >= 4 and e[1] > 0 else None, "err_n": e[2], "slots": r["n"], "spark": [None if x is None else round(x, 1) for x in f[::2]]}
