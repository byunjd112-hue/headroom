# -*- coding: utf-8 -*-
"""부하·PV 24시간(96구간) 예측. 로직 설명서 3·4·5장.

부하: 목표 y = 부하(i+h) / 기준 부하(i). 선행시간 구간(BUCKET)별 릿지 회귀와 전일 동시각을 결합한다.
PV : 지수 r = 실제 출력 / 청천 출력을 예측해 청천 출력을 곱한다. 외부 기상 예보 없이 현장 센서만 쓴다.
예측 구간: 보정 구간(마지막 7일) 잔차의 10%·90% 분위수(분포 가정 없음).
"""
import math
import numpy as np
from .config import HORIZON
from .models import Ridge, quantiles
from .solar import clear_pv_kw

HS = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 80, 96)     # 학습 선행시간 표본
BUCKET = (4, 8, 16, 32, 64, 96)                            # 선행시간 구간 상한
W_MODEL = 0.8                                              # 모델 가중(나머지는 전일 동시각)
CAL_ROWS = 7 * 96


def bucket_of(h):
    for i, b in enumerate(BUCKET):
        if h <= b: return i
    return len(BUCKET) - 1


def _hfeat(hr):
    return [math.sin(2 * math.pi * hr / 24), math.cos(2 * math.pi * hr / 24), math.sin(4 * math.pi * hr / 24), math.cos(4 * math.pi * hr / 24),
            math.sin(6 * math.pi * hr / 24), math.cos(6 * math.pi * hr / 24)]


class _Base:
    MIN_O = 672

    def __init__(self, site):
        self.site = site; self.models = [None] * len(BUCKET); self.q = np.tile([-0.15, 0.15], (len(BUCKET), 1)); self.trained = False

    def to_arrays(self):
        a = {"trained": np.array([int(self.trained)]), "q": self.q}
        for i, m in enumerate(self.models):
            if m is not None: a.update(m.to_arrays(f"b{i}_"))
        return a

    def from_arrays(self, a):
        self.trained = bool(int(a["trained"][0])); self.q = a["q"]
        self.models = [Ridge().from_arrays(a, f"b{i}_") if f"b{i}_w" in a else None for i in range(len(BUCKET))]

    # 하위 클래스가 정의한다
    def target(self, d, o, h): raise NotImplementedError
    def features(self, d, o, h): raise NotImplementedError
    def _point(self, d, o, h, x): raise NotImplementedError

    def _samples(self, d, o_range):
        X = {i: [] for i in range(len(BUCKET))}; Y = {i: [] for i in range(len(BUCKET))}; O = {i: [] for i in range(len(BUCKET))}
        for o in o_range:
            for h in HS:
                if o + h >= d["n"]: continue
                y = self.target(d, o, h)
                if y is None: continue
                b = bucket_of(h); X[b].append(self.features(d, o, h)); Y[b].append(y); O[b].append((o, h))
        return X, Y, O

    def fit(self, d, stride=3):
        n = d["n"]
        if n < self.MIN_O + CAL_ROWS + HORIZON: raise ValueError(f"학습 자료 부족: {n}행")
        cut = n - CAL_ROWS - HORIZON
        X, Y, _ = self._samples(d, range(self.MIN_O, cut, stride))
        for b in range(len(BUCKET)):
            self.models[b] = Ridge(3.0).fit(np.array(X[b]), np.array(Y[b])) if len(X[b]) > 30 else None
        self.trained = True
        return self.calibrate(d)

    def calibrate(self, d):
        """예측 구간(10~90%)을 최근 자료의 오차로 다시 맞춘다. 모델 가중치는 그대로 둔다(지속 학습이 모델을 유지할 때도 구간은 새로 맞춘다)."""
        n = d["n"]; cut = n - CAL_ROWS - HORIZON
        if cut < self.MIN_O: raise ValueError(f"보정 자료 부족: {n}행")
        Xc, Yc, Oc = self._samples(d, range(cut, n - 1, 2))
        for b in range(len(BUCKET)):
            if not Xc[b]: continue
            pred = np.array([self._point(d, o, h, x) for (o, h), x in zip(Oc[b], Xc[b])])
            self.q[b] = quantiles(np.array(Yc[b]) - pred)
        return self


class LoadForecaster(_Base):
    def base(self, d, o):
        if o < 96: return self.site.base_load_kw
        return float(np.mean(d["load"][:min(o + 1, 14 * 96)]))           # 14일까지 갱신하고 고정

    def features(self, d, o, h):
        L = d["load"]; b = self.base(d, o); th = (d["hour"][o] + h * 0.25) % 24
        tgt = o + h; yday = L[tgt - 96] if tgt - 96 >= 0 else L[o]; wk = L[tgt - 672] if tgt - 672 >= 0 else yday
        tmp = d["temp"]; t_est = (tmp[tgt - 96] if tgt - 96 >= 0 else tmp[o]) + (tmp[o] - (tmp[o - 96] if o >= 96 else tmp[o]))
        dow_t = (d["dow"][o] + int((d["hour"][o] + h * 0.25) // 24)) % 7
        clear = _clear_at(self.site, d, o, h) / self.site.pv_kwp
        return [h / 96.0] + _hfeat(th) + [float(dow_t == 6), float(d["plan"][o]), L[o] / b, float(np.mean(L[max(0, o - 3):o + 1])) / b,
                                          float(np.mean(L[max(0, o - 95):o + 1])) / b, yday / b, wk / b, (L[o] - (L[o - 96] if o >= 96 else L[o])) / b,
                                          tmp[o], t_est, clear]

    def target(self, d, o, h):
        return d["load"][o + h] / self.base(d, o)

    def _point(self, d, o, h, x):
        b = bucket_of(h); tgt = o + h; yday = (d["load"][tgt - 96] if tgt - 96 >= 0 else d["load"][o]) / self.base(d, o)
        if not self.trained or self.models[b] is None: return yday
        return W_MODEL * float(self.models[b].predict(x)[0]) + (1 - W_MODEL) * yday

    def predict(self, d, o):
        """발행 시점 o에서 96구간 예측. 반환: (중앙, 하한, 상한, 정보)."""
        bse = self.base(d, o); p50 = np.zeros(HORIZON); lo = np.zeros(HORIZON); hi = np.zeros(HORIZON)
        for h in range(1, HORIZON + 1):
            x = self.features(d, o, h); y = self._point(d, o, h, x); q = self.q[bucket_of(h)]
            p50[h - 1] = max(0.0, y * bse); lo[h - 1] = max(0.0, (y + q[0]) * bse); hi[h - 1] = max(p50[h - 1], (y + q[1]) * bse)
        return p50, lo, hi, {"trained": self.trained, "base_kw": bse}


def _clear_at(site, d, o, h):
    """발행 시점 o에서 h구간 뒤의 청천 PV 출력(kW)."""
    t = d["hour"][o] + h * 0.25
    return float(clear_pv_kw(site, d["doy"][o] + int(t // 24), t % 24))


class PVForecaster(_Base):
    def __init__(self, site):
        super().__init__(site); self.q = np.tile([-0.08, 0.08], (len(BUCKET), 1))

    def _idx(self, d):
        if "_r" not in d:
            c = d["clear"]; m = c >= 0.05 * self.site.pv_kwp
            r = np.full(d["n"], np.nan); r[m] = d["pv"][m] / c[m]; d["_r"] = np.clip(r, 0, 1.2)
        return d["_r"]

    def _clear_at(self, d, o, h):
        return _clear_at(self.site, d, o, h)

    def features(self, d, o, h):
        r = self._idx(d); nm = lambda a, dflt: float(np.nanmean(a)) if np.any(np.isfinite(a)) else dflt
        rd = nm(r[max(0, o - 95):o + 1], 0.7); r1 = nm(r[max(0, o - 3):o + 1], rd); r3 = nm(r[max(0, o - 11):o + 1], rd)
        seg = r[max(0, o - 7):o + 1]; var = float(np.nanstd(seg)) if np.sum(np.isfinite(seg)) > 1 else 0.0
        tgt = o + h; ry = r[tgt - 96] if tgt - 96 >= 0 and np.isfinite(r[tgt - 96]) else rd
        P = d["press"]; pm = lambda k: P[o] - P[max(0, o - k)]
        th = (d["hour"][o] + h * 0.25) % 24; k = self.site.pv_kwp
        return [h / 96.0, self._clear_at(d, o, h) / k, d["clear"][o] / k, math.sin(2 * math.pi * th / 24), math.cos(2 * math.pi * th / 24),
                r1, r3, var, rd, ry, P[o] - float(np.mean(P[max(0, o - 95):o + 1])), pm(12), pm(48), pm(96),
                d["rh"][o], d["rh"][o] - d["rh"][max(0, o - 24)], d["temp"][o], d["temp"][o] - d["temp"][max(0, o - 96)]]

    def target(self, d, o, h):
        r = self._idx(d)[o + h]
        return None if not np.isfinite(r) else float(r)

    def _point(self, d, o, h, x):
        b = bucket_of(h)
        if not self.trained or self.models[b] is None: return x[9]          # 전일 동시각 지수
        return W_MODEL * float(self.models[b].predict(x)[0]) + (1 - W_MODEL) * x[9]

    def predict(self, d, o):
        p50 = np.zeros(HORIZON); lo = np.zeros(HORIZON); hi = np.zeros(HORIZON)
        for h in range(1, HORIZON + 1):
            c = self._clear_at(d, o, h)
            if c < 0.02 * self.site.pv_kwp: continue
            x = self.features(d, o, h); r = float(np.clip(self._point(d, o, h, x), 0, 1.1)); q = self.q[bucket_of(h)]
            p50[h - 1] = r * c; lo[h - 1] = max(0.0, (r + q[0]) * c); hi[h - 1] = min(1.1 * c, max(p50[h - 1], (r + q[1]) * c))
        return p50, lo, hi, {"trained": self.trained}
