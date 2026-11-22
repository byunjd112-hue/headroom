# -*- coding: utf-8 -*-
"""날씨 정보의 반영: 장병이 손으로 넣은 날씨(작전지)와 군 통신망에서 받은 날씨(주둔지)를 태양광 예측에 섞고, AI 예측과 견주어 반영 비율을 정한다.

  · 넣는 것(장병): 휴대폰 날씨 앱(구글 날씨 등)에 보이는 그대로 — 하늘 상태(맑음 · 대체로 흐림 · 비 …), 강수 확률(%), 기온, 기간(지금부터 몇 시간 · 내일 · 모레).
      하늘 상태는 운량(0~10할)으로 바꿔 쓴다(SKY 표). 강수 확률 p% 가 있으면 운량을 (p/10 − 1) 이상으로 본다(비 올 가능성이 높으면 구름도 많다고 보는 가정).
      운량 숫자를 직접 넣는 것은 통신망 자료용이다(화면의 수기 입력에는 없다). 기온·강수량은 적어 두기만 한다.
  · 날씨 기반 예측 = 맑은 하늘 발전량 × 구름 계수 × 설비 보정.
      구름 계수 k = 1 − 0.75·(운량/10)^3.4   (Kasten·Czeplak 1980 의 운량-일사 관계식, 원식은 8분위 운량)
      설비 보정 = 최근 14일 낮 시간의 (실측 ÷ 맑은 하늘 발전량) 위쪽 10% 값 — 맑은 날 이 설비가 실제로 내는 비율
  · 섞기: 최종 = (1 − w)·AI 예측 + w·날씨 기반 예측. 날씨 기록이 없는 시간은 AI 예측 그대로.
  · 견주기: 예측을 낼 때마다 1·3·6·12시간 뒤 값(AI, 날씨 기반, 최종)을 적어 두었다가 실측이 나오면 오차를 잰다.
      비교가 쌓이기 전에는 w = w0(기본 0.3). 그 뒤에는 그동안의 실측에 가장 잘 맞았을 비율(최소제곱) w* = Σ(실측 − AI)(날씨 − AI) ÷ Σ(날씨 − AI)², 0 ~ w_max(기본 0.8).
      w 는 선행시간 묶음(≤1 · ≤3 · ≤6 · 그보다 먼 시간)마다 따로 정한다 — 가까운 시간은 직전 실측을 아는 AI 가, 먼 시간은 날씨 정보가 유리할 수 있어서다.
      AI 가 더 정확하면 w 가 내려가고(도움이 안 되면 0), 날씨 입력이 더 정확하면 올라간다.
  · 배우기: 넣은 날씨 표기(예: '대체로 흐림')가 실제로 맑은 하늘의 몇 배 발전으로 이어졌는지 실측으로 모아, 환산표의 구름 계수를 그 현장의 값으로 조금씩 고친다(Score.factor).
  · 우선순위: 같은 시간에 손으로 넣은 것과 통신망에서 받은 것이 겹치면 손으로 넣은 것(현지에서 본 것)을 쓴다. 같은 출처끼리는 나중에 넣은 것.
이 파일은 통신을 하지 않는다(받아 오기는 hmi/weatherwatch.py). 기온·강수는 지금 예측에 쓰지 않는다(부하 예측은 그대로).
"""
import csv, io, json, math
from datetime import datetime, timedelta

SKY = {"맑음": 0.5, "대체로 맑음": 2.5, "구름 조금": 4.0, "대체로 흐림": 7.0, "흐림": 9.0, "안개": 8.0, "소나기": 8.0, "비": 10.0, "뇌우": 10.0, "눈": 10.0, "진눈깨비": 10.0,
       "구름 많음": 7.0, "비·눈": 10.0}          # 휴대폰 날씨 앱의 표기 → 운량(0~10할). 끝의 둘은 통신망 자료에서 쓰는 다른 표기
PHONE = ("맑음", "대체로 맑음", "구름 조금", "대체로 흐림", "흐림", "안개", "소나기", "비", "뇌우", "눈", "진눈깨비")      # 화면의 고르는 목록(구글 날씨의 한국어 표기)
FMT = "%Y-%m-%d %H:%M"
HORIZONS = (4, 12, 24, 48)                   # 견줄 선행시간(15분 칸): 1 · 3 · 6 · 12시간 — 반영 비율도 이 묶음마다 따로 정한다
DEFAULT = {"enabled": True, "url": "", "interval_min": 30, "timeout_s": 5, "only_garrison": True, "w0": 0.3, "w_max": 0.8, "keep_days": 30}
RANGE = {"interval_min": (5, 1440), "timeout_s": (1, 30), "w0": (0, 1), "w_max": (0, 1), "keep_days": (1, 365)}
MAX_REC = 2000
KEEP = 1600                                  # 남겨 두는 비교 건수
WINDOW = 300                                 # 반영 비율을 정할 때 보는 최근 비교 건수(선행시간 묶음마다)


def settings(cfg):
    return dict(DEFAULT, **(cfg if isinstance(cfg, dict) else {}))


def check(cfg, bad):
    """runtime.json 의 weather 검사."""
    if cfg is None: return
    if not isinstance(cfg, dict): bad.append("weather: 객체여야 함"); return
    for k, (lo, hi) in RANGE.items():
        v = cfg.get(k, lo)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi: bad.append(f"weather.{k}: {lo}~{hi} 범위의 숫자")
    u = cfg.get("url", "")
    if not isinstance(u, str) or (u and not u.startswith(("http://", "https://"))): bad.append("weather.url: 비우거나 http:// · https:// 로 시작하는 주소")
    for k in ("enabled", "only_garrison"):
        if not isinstance(cfg.get(k, True), bool): bad.append(f"weather.{k}: 참·거짓")


def clearness(cloud):
    """운량(0~10할) → 맑은 하늘 대비 일사 비율(구름 계수)."""
    c = min(10.0, max(0.0, float(cloud))) / 10.0
    return 1.0 - 0.75 * c ** 3.4


def cloud_of(k):
    """구름 계수 → 운량(0~10할). clearness 의 역."""
    return 10.0 * (min(0.75, max(0.0, 1.0 - float(k))) / 0.75) ** (1 / 3.4)


def _num(v, lo, hi, name):
    if v in (None, ""): return None
    try: x = float(v)
    except (TypeError, ValueError): raise ValueError(f"{name}: 숫자가 아님")
    if not math.isfinite(x) or not lo <= x <= hi: raise ValueError(f"{name}: {lo}~{hi} 범위 밖")
    return x


def _time(v, name):
    if isinstance(v, (int, float)) and not isinstance(v, bool): return datetime.fromtimestamp(float(v))
    try: return datetime.strptime(str(v).strip().replace("T", " ")[:16], FMT)
    except ValueError: raise ValueError(f"{name}: 시각은 'YYYY-MM-DD HH:MM' 꼴")


def record(t0, t1, cloud=None, sky=None, temp=None, rain=None, src="수기", **more):
    """기록 하나를 검사해 만든다. 운량(cloud)이 없으면 하늘 상태(sky)와 강수 확률(pop %)로 정한다. 틀리면 ValueError.
    more: who(넣은 사람) · note(적어 둔 말) · at(넣은 시각) · pop(강수 확률 %)"""
    who, note, at, pop = more.get("who", ""), more.get("note", ""), more.get("at"), more.get("pop")
    if set(more) - {"who", "note", "at", "pop"}: raise TypeError(f"모르는 항목: {sorted(set(more) - {'who', 'note', 'at', 'pop'})}")
    a, b = _time(t0, "시작"), _time(t1, "끝")
    if b <= a or b - a > timedelta(days=7): raise ValueError("기간: 끝이 시작보다 뒤이고 7일 이내")
    c = _num(cloud, 0, 10, "운량"); pp = _num(pop, 0, 100, "강수 확률")
    if c is None:
        if sky not in SKY: raise ValueError("하늘 상태를 골라야 함")
        c = max(SKY[sky], (pp or 0) / 10.0 - 1.0)                       # 강수 확률이 높으면 구름도 많다고 본다
    return {"t0": a.strftime(FMT), "t1": b.strftime(FMT), "cloud": round(c, 1), "sky": sky if sky in SKY else "", "temp": _num(temp, -60, 60, "기온"), "rain": _num(rain, 0, 500, "강수"), "pop": pp,
            "src": str(src)[:12], "who": str(who)[:20], "note": str(note)[:60], "at": (at or datetime.now()).strftime(FMT + ":%S")}


def _rows(text):
    """받은 글을 줄 목록으로: JSON 이면 hours, 아니면 CSV."""
    text = (text or "").strip()
    if not text: raise ValueError("내용이 비어 있음")
    if len(text) > 262144: raise ValueError("내용이 너무 큼(256 KB 까지)")
    if text[0] in "{[":
        try: j = json.loads(text)
        except ValueError as e: raise ValueError(f"JSON 형식 오류: {e}")
        rows = j.get("hours") if isinstance(j, dict) else j
        if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows): raise ValueError("JSON 의 hours 는 객체 목록")
    else:
        rows = [dict(zip(("t", "cloud", "temp", "rain"), [x.strip() for x in r])) for r in csv.reader(io.StringIO(text)) if r and r[0].strip()]
        if rows and not rows[0]["t"][:1].isdigit(): rows = rows[1:]
    if not rows or len(rows) > 400: raise ValueError("줄 수는 1~400")
    return rows


def _end(r, ts, i):
    """그 줄의 유효 끝 시각: h(시간)를 적었으면 그만큼, 아니면 다음 줄 시각까지(마지막 줄은 1시간)."""
    h = _num(r.get("h"), 0.25, 72, "유효 시간")
    if h: return ts[i] + timedelta(hours=h)
    return ts[i + 1] if i + 1 < len(ts) and ts[i + 1] > ts[i] else ts[i] + timedelta(hours=1)


def parse(text, src="통신망"):
    """받은 글(JSON 또는 CSV)을 기록 목록으로 바꾼다. 틀린 줄이 있으면 ValueError(몇 번째인지 알린다).
    JSON: {"issued": "...", "hours": [{"t": "YYYY-MM-DD HH:MM", "cloud": 0~10 또는 "sky": "맑음"…, "temp": ℃, "rain": mm, "h": 유효 시간(기본 다음 줄까지, 마지막은 1)}]}
    CSV : 시각,운량[,기온,강수]  (첫 줄이 글자면 머리줄로 보고 넘긴다)"""
    rows = _rows(text); out = []; ts = []
    try:
        for i, r in enumerate(rows): ts.append(_time(r.get("t"), "시각"))
        for i, r in enumerate(rows): out.append(record(ts[i], _end(r, ts, i), r.get("cloud"), r.get("sky"), r.get("temp"), r.get("rain"), src, pop=r.get("pop")))
    except ValueError as e: raise ValueError(f"{i + 1}번째: {e}")
    return out


class Book:
    """날씨 기록 묶음."""
    def __init__(self, rows=None):
        self.rows = [r for r in (rows or []) if isinstance(r, dict) and {"t0", "t1", "cloud", "src", "at"} <= set(r)]

    def add(self, recs, replace_src=None):
        """기록을 넣는다. replace_src 를 주면 그 출처의 기록 가운데 새 기록과 겹치는 것을 먼저 지운다(통신망 갱신)."""
        if replace_src and recs:
            lo = min(r["t0"] for r in recs); hi = max(r["t1"] for r in recs)
            self.rows = [r for r in self.rows if not (r["src"] == replace_src and r["t1"] > lo and r["t0"] < hi)]
        self.rows += recs; self.rows = self.rows[-MAX_REC:]

    def remove(self, at):
        n = len(self.rows); self.rows = [r for r in self.rows if r["at"] != at or r["src"] != "수기"]; return n - len(self.rows)

    def prune(self, now, keep_days):
        lim = (now - timedelta(days=keep_days)).strftime(FMT); self.rows = [r for r in self.rows if r["t1"] >= lim]

    def at(self, t):
        """그 시각에 쓸 기록(없으면 None): 손으로 넣은 것이 먼저, 같은 출처끼리는 나중에 넣은 것."""
        s = t.strftime(FMT); hit = [r for r in self.rows if r["t0"] <= s < r["t1"]]
        return max(hit, key=lambda r: (r["src"] == "수기", r["at"])) if hit else None

    def ahead(self, now):
        """지금과 앞으로의 기록(화면용, 시작 순)."""
        s = now.strftime(FMT); return sorted((r for r in self.rows if r["t1"] > s), key=lambda r: (r["t0"], r["at"]))


def calibrate(pv, clear, kwp, days=14):
    """설비 보정: 최근 days 일 낮 시간의 (실측 ÷ 맑은 하늘 발전량) 위쪽 10% 값. 자료가 모자라면 1."""
    xs = sorted(p / c for p, c in zip(pv[-days * 96:], clear[-days * 96:]) if c > 0.05 * kwp and p == p)
    return min(1.1, max(0.4, xs[int(len(xs) * 0.9)])) if len(xs) >= 20 else 1.0


def blend(ai, clear, ks, cal, ws):
    """AI 예측(ai)과 날씨 기반 예측을 섞는다. ks: 칸마다 구름 계수(없으면 None), ws: 칸마다 반영 비율(숫자 하나면 모든 칸에 같게).
    반환: (최종 목록, 날씨 기반 목록(없는 칸 None))"""
    out, wx = [], []; ws = ws if isinstance(ws, (list, tuple)) else [ws] * len(ai)
    for a, c, k, w in zip(ai, clear, ks, ws):
        x = None if k is None else max(0.0, c * k * cal)
        wx.append(x); out.append(a if x is None else max(0.0, (1 - w) * a + w * x))
    return out, wx


def horizon(j):
    """앞으로 j 번째 칸(1부터)이 속하는 선행시간 묶음."""
    return next((h for h in HORIZONS if j <= h), HORIZONS[-1])


class Score:
    """AI 예측과 날씨 기반 예측을 실측과 견주고(선행시간별), 넣은 날씨 표기가 실제로 얼마의 발전으로 이어졌는지 배운다."""
    def __init__(self, state=None):
        s = state if isinstance(state, dict) else {}
        self.wait = {k: v for k, v in (s.get("wait") or {}).items() if isinstance(v, list) and len(v) == 5}      # {"시각|선행": [AI, 날씨, 최종, 날씨 표기, 맑은 하늘 × 설비 보정]} 실측을 기다리는 것
        self.done = [x for x in (s.get("done") or []) if isinstance(x, list) and len(x) == 6][-KEEP:]             # [시각, 선행, AI, 날씨, 최종, 실측]
        self.k = {a: b for a, b in (s.get("k") or {}).items() if isinstance(b, list) and len(b) == 2}            # {날씨 표기: [실측 구름 계수의 합, 건수]} — 오래된 것은 조금씩 잊는다

    def state(self):
        return {"wait": self.wait, "done": self.done, "k": self.k}

    def note(self, target, h, ai, wx, final, label="", ref=0.0):
        """예측을 적어 둔다(target: 그 예측이 가리키는 시각, label: 그 시각에 쓴 날씨 표기, ref: 맑은 하늘 발전량 × 설비 보정)."""
        if wx is not None and len(self.wait) < 3000: self.wait.setdefault(f"{target.strftime(FMT)}|{h}", [round(ai, 2), round(wx, 2), round(final, 2), label or "", round(ref, 2)])

    def settle(self, actual, last):
        """실측이 나온 것을 채점하고, 날씨 표기별 실제 구름 계수를 배운다. actual: {시각 글: (실측 kW, 낮인지)}, last: 실측의 마지막 시각 글."""
        seen = set()
        for k in sorted(self.wait):
            ts, h = k.split("|")
            if ts > last: continue
            v = self.wait.pop(k); a = actual.get(ts)
            if a is None or not a[1]: continue
            self.done.append([ts, int(h), v[0], v[1], v[2], round(a[0], 2)])
            if v[3] and v[4] > 1.0 and ts not in seen:                               # 같은 시각은 한 번만 배운다
                seen.add(ts); sm, n = self.k.get(v[3], [0.0, 0.0]); self.k[v[3]] = [round(sm * 0.98 + min(1.2, max(0.0, a[0] / v[4])), 4), round(n * 0.98 + 1, 3)]
        self.done = self.done[-KEEP:]

    def factor(self, rec):
        """그 기록의 구름 계수: 환산표 값에서 시작해, 같은 날씨 표기의 실측이 쌓일수록 실측 평균 쪽으로 옮겨 간다(6건이 표 값 한 번과 같은 무게)."""
        base = clearness(rec["cloud"]); sm, n = self.k.get(rec.get("sky") or "", [0.0, 0.0])
        return base if n < 4 else (6 * base + sm) / (6 + n)

    def learned(self):
        """배운 것(화면용): [{표기, 환산표 값, 실측 평균, 건수}]"""
        return [{"sky": a, "table": round(clearness(SKY[a]), 2) if a in SKY else None, "seen": round(b[0] / b[1], 2), "n": round(b[1], 1)} for a, b in sorted(self.k.items()) if b[1] >= 1]

    def stats(self, n=96, h=None):
        """최근 n 건의 평균 절대 오차(kW): {n, ai, wx, final}. h 를 주면 그 선행시간 묶음만."""
        d = [x for x in self.done if h is None or x[1] == h][-n:]
        if not d: return {"n": 0, "ai": None, "wx": None, "final": None}
        m = lambda i: round(sum(abs(x[i] - x[5]) for x in d) / len(d), 2)
        return {"n": len(d), "ai": m(2), "wx": m(3), "final": m(4)}

    def _best(self, h=None, n=WINDOW):
        """실측에 가장 잘 맞는 섞는 비율(최소제곱): w* = Σ(실측 − AI)(날씨 − AI) ÷ Σ(날씨 − AI)². 반환: (w*, 건수) — 견줄 것이 없으면 (None, 건수)."""
        d = [x for x in self.done if h is None or x[1] == h][-n:]; den = sum((x[3] - x[2]) ** 2 for x in d)
        return (sum((x[5] - x[2]) * (x[3] - x[2]) for x in d) / den if den > 1e-9 else None), len(d)

    def weight(self, w0, w_max, h=None, need=6):
        """날씨 기반 예측의 반영 비율: 그동안의 실측에 가장 잘 맞았을 비율(0 ~ w_max). 날씨 정보가 도움이 안 되던 구간에서는 0 에 가까워진다.
        그 선행시간의 비교가 need 건 이상이면 그것으로, 아니면 전체(8건 이상)로, 그것도 없으면 w0."""
        w, n = self._best(h) if h is not None else (None, 0)
        if w is None or n < need: w, n = self._best(); need = need if h is None else 8
        if w is None or n < need: return min(w0, w_max)
        return round(min(w_max, max(0.0, w)), 3)

    def weights(self, w0, w_max, n):
        """앞으로 n 칸의 칸별 반영 비율(선행시간 묶음마다 따로)."""
        by = {h: self.weight(w0, w_max, h) for h in HORIZONS}; return [by[horizon(j)] for j in range(1, n + 1)]
