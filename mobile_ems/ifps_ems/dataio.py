# -*- coding: utf-8 -*-
"""15분 이력(history.csv) 읽기·쓰기, 학습 모델 저장·불러오기, 합성 현장 자료 생성."""
import csv, math, os
from datetime import datetime, timedelta
import numpy as np
from .solar import clear_pv_kw

HIST_COLS = ["ts", "load_kw", "load_p1", "load_p2", "load_p3", "pv_kw", "temp", "press", "rh", "plan", "mode"]


def _f(x, d=np.nan):
    try:
        v = float(x); return v if v == v else d
    except (TypeError, ValueError):
        return d


def load_csv(path, site):
    """history.csv를 읽어 배열 사전으로 돌려준다. 빈 값은 앞 값으로 채운다."""
    with open(path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    n = len(rows); ts = [r["ts"] for r in rows]
    dt = [datetime.strptime(t, "%Y-%m-%d %H:%M") for t in ts]
    col = lambda k: np.array([_f(r.get(k)) for r in rows], dtype=float)
    d = {"n": n, "ts": ts, "doy": np.array([x.timetuple().tm_yday for x in dt], dtype=float),
         "hour": np.array([x.hour + x.minute / 60 for x in dt], dtype=float), "dow": np.array([x.weekday() for x in dt], dtype=int),
         "load": col("load_kw"), "load_p": np.stack([col("load_p1"), col("load_p2"), col("load_p3")], 1) if n else np.zeros((0, 3)),
         "pv": col("pv_kw"), "temp": col("temp"), "press": col("press"), "rh": col("rh"), "plan": col("plan"), "mode": col("mode")}
    for k in ("load", "pv", "temp", "press", "rh", "plan", "mode"):
        d[k] = _ffill(d[k])
    if n: d["load_p"] = np.stack([_ffill(d["load_p"][:, i]) for i in range(3)], 1)
    d["clear"] = clear_pv_kw(site, d["doy"], d["hour"]) if n else np.zeros(0)
    return d


def _ffill(a):
    a = a.copy(); last = np.nan
    for i in range(len(a)):
        if a[i] == a[i]: last = a[i]
        else: a[i] = last
    if len(a) and a[0] != a[0]:
        good = a[a == a]; a[a != a] = good[0] if len(good) else 0.0
    return a


def save_model(path, model):
    np.savez(path, **model.to_arrays())


def load_model(path, model):
    """모델 파일이 있으면 불러온다. 반환: 불러왔는지 여부(없으면 모델은 전일 동시각 기준으로 동작)."""
    if not os.path.exists(path): return False
    with np.load(path, allow_pickle=False) as z:
        model.from_arrays({k: z[k] for k in z.files})
    return True


def gen_sample(site, path, days=120, start="2026-07-01 00:00", seed=7):
    """합성 현장 자료(15분)를 만든다. 실측이 쌓이기 전 학습·시험용."""
    rng = np.random.default_rng(seed); t0 = datetime.strptime(start, "%Y-%m-%d %H:%M"); n = days * 96
    press = 1013.0; cloud = 0.9; wx = 0; plan = 1
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(HIST_COLS)
        for i in range(n):
            t = t0 + timedelta(minutes=15 * i); hr = t.hour + t.minute / 60; doy = t.timetuple().tm_yday
            if i % 96 == 0:
                wx = rng.choice(3, p=[0.5, 0.3, 0.2]) if rng.random() < 0.45 else wx
                if rng.random() < 0.08: plan = int(rng.integers(1, 4))
            target = (0.92, 0.6, 0.25)[wx]; cloud += 0.15 * (target - cloud) + rng.normal(0, 0.05); cloud = min(1.05, max(0.05, cloud))
            press += 0.02 * (1013 - press) + rng.normal(0, 0.25) - (0.15 if wx == 2 else 0.0)
            season = 6 * math.cos(2 * math.pi * (doy - 200) / 365)
            temp = 16 + season + 7 * math.sin(2 * math.pi * (hr - 9) / 24) - 3 * (wx == 2) + rng.normal(0, 0.4)
            rh = min(100, max(15, 60 - 1.5 * (temp - 18) + 15 * (wx == 2) + rng.normal(0, 3)))
            clear = float(clear_pv_kw(site, doy, hr)); pv = max(0.0, clear * cloud * (1 + rng.normal(0, 0.03)))
            day = 1.0 if 7 <= hr < 19 else 0.0; act = (1.0, 1.15, 1.35)[plan - 1]
            p1 = 28 + rng.normal(0, 1.0)
            p2 = (18 + 16 * day + 0.9 * max(0.0, temp - 24)) * act + rng.normal(0, 1.5)
            p3 = (8 + 18 * day * (0.6 + 0.4 * math.sin(math.pi * (hr - 7) / 12)) ) * act * (0.8 if t.weekday() == 6 else 1.0) + rng.normal(0, 1.5)
            p1, p2, p3 = max(p1, 0), max(p2, 0), max(p3, 0)
            w.writerow([t.strftime("%Y-%m-%d %H:%M"), f"{p1 + p2 + p3:.2f}", f"{p1:.2f}", f"{p2:.2f}", f"{p3:.2f}", f"{pv:.2f}", f"{temp:.2f}", f"{press:.2f}", f"{rh:.2f}", plan, 2])
    return n
