# -*- coding: utf-8 -*-
"""가상 자료 가져오기 · 재생(가상 장치 모드 전용): CSV 로 준 값을 시간 순서대로 가상 장치에 넣어, 현장에서 잰 하루나 만들어 둔 상황을 그대로 다시 돌려 본다.

CSV 형식(쉼표, UTF-8)
  첫 줄   t,<신호>,<신호>…           t 는 처음부터 잰 초(0, 60, 120 …) 또는 시각(2026-05-01 13:00[:00])
  신호    대응표의 읽기 신호 이름(LOAD.p1_kw, PV.kw, ESS.soc, ENV.temp …) 또는 운전 이력(history.csv)의 열 이름(load_kw, load_p1, pv_kw, temp …)
  값      숫자. 빈 칸은 '앞 값 그대로'
TPCS 가 남긴 history.csv 를 그대로 넣어도 된다(ts 열을 시각으로 읽고, 모르는 열은 건너뛴다).
줄 사이의 값은 앞 줄 값을 유지한다(계단). 상태 · 생존 계수 · 지령 신호는 넣을 수 없다 — 그것은 가상 장치가 스스로 만든다."""
import csv, io, math, time
from datetime import datetime

MAX_ROWS = 5000; SPEEDS = (1, 10, 60, 600)
ALIAS = {"load_kw": "LOAD.kw", "load_p1": "LOAD.p1_kw", "load_p2": "LOAD.p2_kw", "load_p3": "LOAD.p3_kw", "pv_kw": "PV.kw", "temp": "ENV.temp", "press": "ENV.press", "rh": "ENV.rh"}
SKIP = {"plan", "mode", "sky"}                      # 운전 이력의 열 가운데 가상 장치에 넣지 않는 것
BLOCK = ("status", "hb", "seq_ack", "mode", "pcs_mode")     # 가상 장치가 스스로 만드는 신호


def _time(x, t0):
    """첫 열을 초로 바꾼다. 반환: (초, 기준 시각)"""
    x = x.strip()
    try: return float(x), t0
    except ValueError: pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            d = datetime.strptime(x, fmt); t0 = d if t0 is None else t0; return (d - t0).total_seconds(), t0
        except ValueError: pass
    raise ValueError(f"시각을 읽을 수 없음: {x[:30]}")


def _columns(head, by_tag):
    """머리줄 → [(열 번호, 신호)] 와 오류 · 건너뛴 열."""
    cols, bad, skipped = [], [], []
    for i, h in enumerate(head[1:], 1):
        name = h.strip(); tag = ALIAS.get(name, name); p = by_tag.get(tag)
        if not name or name in SKIP: skipped.append(name); continue
        if p is None: bad.append(f"모르는 신호: {name}")
        elif p["rw"] != "r" or tag.rpartition(".")[2] in BLOCK: bad.append(f"넣을 수 없는 신호(가상 장치가 스스로 만듦): {name}")
        elif tag in [t for _, t in cols]: bad.append(f"같은 신호가 두 번: {name}")
        else: cols.append((i, tag))
    if not cols and not bad: bad.append("넣을 신호 열이 없음")
    return cols, bad, [s for s in skipped if s]


def _values(r, cols, by_tag, n, bad):
    """한 줄의 값 → {신호: 값}. 빈 칸은 뺀다(앞 값 유지). 숫자가 아니거나 범위 밖이면 bad 에 적는다."""
    vals = {}
    for i, tag in cols:
        c = r[i].strip() if i < len(r) else ""
        if not c: continue
        p = by_tag[tag]
        try: v = float(c)
        except ValueError: bad.append(f"{n}줄 {tag}: 숫자가 아님 ({c[:20]})"); continue
        if not math.isfinite(v) or (p["lo"] is not None and v < p["lo"]) or (p["hi"] is not None and v > p["hi"]): bad.append(f"{n}줄 {tag}: 범위 {p['lo']}~{p['hi']} 밖 ({c[:20]})"); continue
        vals[tag] = v
    return vals


def parse(text, by_tag):
    """CSV 글 → {"tags", "rows": [(초, {신호: 값})], "skipped"}. 형식 · 범위 오류는 ValueError(여러 건이면 앞의 5건)."""
    rd = list(csv.reader(io.StringIO(text.lstrip("﻿")))); rd = [r for r in rd if any(c.strip() for c in r)]
    if len(rd) < 2: raise ValueError("머리줄과 값 줄이 한 줄 이상 있어야 함")
    if len(rd) - 1 > MAX_ROWS: raise ValueError(f"줄 수 {len(rd) - 1} — 한 번에 {MAX_ROWS}줄까지")
    cols, bad, skipped = _columns(rd[0], by_tag); rows = []; t0 = None; last = -1.0
    for n, r in enumerate(rd[1:], 2):
        if bad and len(bad) >= 5: break
        try: t, t0 = _time(r[0], t0)
        except ValueError as e: bad.append(f"{n}줄: {e}"); continue
        if t < 0 or t <= last: bad.append(f"{n}줄: 시각이 앞 줄보다 뒤가 아님"); continue
        last = t; rows.append((t, _values(r, cols, by_tag, n, bad)))
    if bad: raise ValueError(" / ".join(bad[:5]))
    return {"tags": [t for _, t in cols], "rows": rows, "skipped": skipped}


class Replay:
    """재생기. 가상 장치 구동기(SimDriver)가 매 걸음 step() 을 부른다. 재생 중인 신호는 구동기의 '값 유지'(hold)로 넣어 구동기가 덮어쓰지 않게 한다."""

    def __init__(self):
        self.data = None; self.name = ""; self.speed = 1; self.loop = False; self.t0 = None; self.i = 0; self.done = False; self.who = ""

    def start(self, data, name="", speed=1, loop=False, who=""):
        if speed not in SPEEDS: raise ValueError(f"배속은 {' · '.join(str(s) for s in SPEEDS)} 중 하나")
        self.data = data; self.name = str(name)[:60]; self.speed = speed; self.loop = bool(loop); self.t0 = time.monotonic(); self.i = 0; self.done = False; self.who = who

    def stop(self, drv):
        """재생을 멈추고 넣어 두었던 값 유지를 푼다(구동기가 다시 스스로 값을 만든다)."""
        for tag in (self.data or {}).get("tags", ()): drv.hold.pop(tag, None)
        self.data = None; self.done = False

    def step(self, drv):
        d = self.data
        if d is None or self.done: return
        rows = d["rows"]; t = (time.monotonic() - self.t0) * self.speed
        while self.i < len(rows) and rows[self.i][0] - rows[0][0] <= t:
            for tag, v in rows[self.i][1].items():
                drv.hold[tag] = v
                if tag in drv.p.by_tag: drv.p.set(tag, v)
            self.i += 1
        if self.i >= len(rows):
            if self.loop: self.t0 = time.monotonic(); self.i = 0
            else: self.done = True                              # 끝난 뒤에는 마지막 값을 유지한다(멈춤을 눌러야 풀린다)

    def state(self):
        d = self.data
        if d is None: return {"on": False}
        rows = d["rows"]; span = rows[-1][0] - rows[0][0]
        return {"on": True, "name": self.name, "tags": d["tags"], "rows": len(rows), "at": self.i, "span_s": span, "speed": self.speed, "loop": self.loop, "done": self.done, "skipped": d["skipped"], "who": self.who}


def action(eng, q, who):
    """제어화면의 요청(가상 장치 조작의 한 갈래): op = start(글 text · 이름 name · 배속 speed · 되풀이 loop) | stop."""
    rp = eng.simdrv.replay; op = q.get("op")
    if op == "stop": rp.stop(eng.simdrv); return
    if op != "start": raise ValueError(f"동작 없음: {op}")
    rp.stop(eng.simdrv); rp.start(parse(str(q.get("text", "")), eng.plant.by_tag), q.get("name", ""), int(q.get("speed", 1)), q.get("loop", False), who)
