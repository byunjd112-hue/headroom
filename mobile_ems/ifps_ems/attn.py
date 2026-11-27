# -*- coding: utf-8 -*-
"""주의집중(어텐션) 예측기: 지금과 비슷했던 과거 상황을 찾아 그 뒤에 실제로 일어난 일을 가중 평균한다.

대형 언어 모델(트랜스포머)의 핵심 연산과 같은 원리다 — 질의(query)와 열쇠(key)의 닮은 정도를 소프트맥스로 가중치로 바꾸고, 값(value)을 가중 합한다.
    wᵢ = exp(−Σₖ sₖ² (qₖ − Kᵢₖ)²) / Σⱼ exp(…)        ŷ(h) = Σᵢ wᵢ · Vᵢ(h)
  q    지금 상황(최근 청천 지수, 변동, 하늘 카메라의 구름량과 변화, 습도·기온·기압 변화, 시각)
  Kᵢ   과거 시점 i 의 상황,  Vᵢ(h)  그 시점에서 h 구간 뒤에 실제로 나온 청천 지수(실측 ÷ 청천 출력)
  sₖ   특징별 중요도(학습으로 정한다). 가까운 예측(2시간 이내)과 먼 예측에 따로 둔다.
규모는 아주 작다(특징 13개, 기억 수천 건). 그래서 노트북에서 몇 초 안에 학습하고, 어떤 과거를 참고했는지 설명할 수 있다.
인과성: 예측 시점보다 뒤에 끝난 기억은 쓰지 않는다(미래를 보지 않는다).
"""
import math
import threading
import numpy as np

_local = threading.local()


def set_cancel(fn):
    """이 가닥에서 도는 예측 계산을 그만둘지 묻는 함수를 정한다(없으면 None). TPCS 가 멈출 때 뒤에서 돌던 계산을 끝내는 데 쓴다."""
    _local.cancel = fn


def _check():
    fn = getattr(_local, "cancel", None)
    if fn is not None and fn(): raise InterruptedError("예측 계산 중단")

NF = 13                     # 특징 수
NEAR = 8                    # 가까운 예측의 경계(구간) = 2시간
STRIDE = 4                  # 기억을 만드는 간격(구간) = 1시간
MIN_MEM = 200               # 학습에 필요한 최소 기억 수
NAMES = ("최근 1시간 지수", "최근 3시간 지수", "최근 2시간 변동", "하루 평균 지수", "지수 변화", "구름량(카메라)", "구름량 변화", "습도", "기온", "기압 변화(3시간)",
         "시각 sin", "시각 cos", "청천 출력")


def _nm(a, dflt):
    return float(np.nanmean(a)) if np.any(np.isfinite(a)) else dflt


def sky_pair(d, o, r1):
    """(지금 구름량, 30분 전 대비 변화). 카메라 값이 없으면(미설치·야간·고장) 최근 청천 지수로 대신한다."""
    sky = d.get("sky"); alt = float(np.clip((1.0 - r1) / 0.85, 0.0, 1.0))
    s0 = float(sky[o]) if sky is not None and np.isfinite(sky[o]) else alt
    s2 = float(sky[o - 2]) if sky is not None and o >= 2 and np.isfinite(sky[o - 2]) else s0
    return s0, s0 - s2


def context(d, o, r, kwp):
    """시점 o 의 상황 벡터(그 시점까지의 자료만 쓴다)."""
    rd = _nm(r[max(0, o - 95):o + 1], 0.7); r1 = _nm(r[max(0, o - 3):o + 1], rd); r3 = _nm(r[max(0, o - 11):o + 1], rd)
    seg = r[max(0, o - 7):o + 1]; var = float(np.nanstd(seg)) if np.sum(np.isfinite(seg)) > 1 else 0.0
    s0, ds = sky_pair(d, o, r1); hr = d["hour"][o]
    return [r1, r3, var, rd, r1 - r3, s0, ds, d["rh"][o] / 100.0, d["temp"][o] / 40.0, (d["press"][o] - d["press"][max(0, o - 12)]) / 5.0,
            math.sin(2 * math.pi * hr / 24), math.cos(2 * math.pi * hr / 24), d["clear"][o] / kwp]


def memory(d, r, kwp, horizon):
    """기억(열쇠 K, 값 V, 시점 O)을 자료에서 만든다. d 에 넣어 두고 다시 쓴다(자료 길이가 바뀌면 다시 만든다)."""
    if "_att" not in d or d["_att"][3] != d["n"]:
        O = np.arange(96, d["n"] - 1, STRIDE); K = np.array([context(d, int(o), r, kwp) for o in O], dtype=float).reshape(-1, NF)
        V = np.full((len(O), horizon), np.nan)
        for i, o in enumerate(O):
            seg = r[o + 1:o + 1 + horizon]; V[i, :len(seg)] = seg
        d["_att"] = (K, V, O, d["n"])
    return d["_att"][:3]


class Attention:
    def __init__(self, horizon=96):
        self.h = horizon; self.s = np.ones((2, NF)); self.mu = np.zeros(NF); self.sd = np.ones(NF); self.fitted = False

    def to_arrays(self):
        return {"att_s": self.s, "att_mu": self.mu, "att_sd": self.sd, "att_ok": np.array([int(self.fitted)])}

    def from_arrays(self, a):
        if "att_s" in a and a["att_s"].shape == (2, NF): self.s, self.mu, self.sd, self.fitted = a["att_s"], a["att_mu"], a["att_sd"], bool(int(a["att_ok"][0]))
        return self

    def _sqdiff(self, Q, K):
        """특징별 거리 제곱(특징 × 질의 × 기억). 표준화한 값으로 계산한다."""
        zq = (Q - self.mu) / self.sd; zk = (K - self.mu) / self.sd
        return np.stack([(zq[:, k][:, None] - zk[:, k][None, :]) ** 2 for k in range(NF)]).astype(np.float32)

    def _weights(self, D, ok, part):
        e = -np.tensordot(self.s[part] ** 2, D, axes=1); e = np.where(ok > 0, e, -np.inf)
        e = e - np.max(e, axis=1, keepdims=True)
        return np.where(ok > 0, np.exp(e), 0.0)

    def _apply(self, D, V, ok):
        """질의마다 기억의 가중 평균. D: 거리(특징×질의×기억), ok(질의×기억): 쓸 수 있는 기억(예측 시점 전에 끝난 것). 반환: 질의×horizon"""
        _check(); out = np.full((D.shape[1], self.h), np.nan); fin = np.isfinite(V).astype(float); V0 = np.where(np.isfinite(V), V, 0.0)
        for part, sl in ((0, slice(0, NEAR)), (1, slice(NEAR, self.h))):
            w = self._weights(D, ok, part); den = w @ fin[:, sl]; num = w @ V0[:, sl]
            out[:, sl] = np.where(den > 1e-9, num / np.maximum(den, 1e-9), np.nan)
        return out

    def _query(self, d, o, r, kwp):
        K, V, O = memory(d, r, kwp, self.h); ok = (O + self.h <= o)[None, :].astype(float)
        if not self.fitted or ok.sum() < 20: return None
        return self._sqdiff(np.array([context(d, o, r, kwp)]), K), V, O, ok

    def predict(self, d, o, r, kwp):
        """시점 o 에서 1~horizon 구간 뒤의 청천 지수 예측(쓸 수 없으면 NaN)."""
        q = self._query(d, o, r, kwp)
        return np.full(self.h, np.nan) if q is None else self._apply(q[0], q[1], q[3])[0]

    def explain(self, d, o, r, kwp, top=3):
        """가장 많이 참고한 과거 시점 [(시각, 가중 비율 %)] — 가까운 예측 기준."""
        q = self._query(d, o, r, kwp)
        if q is None: return []
        w = self._weights(q[0], q[3], 0)[0]; tot = float(w.sum())
        if tot <= 0: return []
        return [(d["ts"][int(q[2][i])], round(100.0 * float(w[i]) / tot, 1)) for i in np.argsort(-w)[:top] if w[i] > 0]

    def _loss(self, D, Y, V, ok):
        P = self._apply(D, V, ok); m = np.isfinite(P) & np.isfinite(Y); e = np.abs(np.where(m, P - Y, 0.0))
        return [float(e[:, :NEAR].sum() / max(1, m[:, :NEAR].sum())), float(e[:, NEAR:].sum() / max(1, m[:, NEAR:].sum()))]

    def fit(self, d, r, kwp, val_rows=7 * 96):
        """특징별 중요도 s 를 정한다: 마지막 val_rows 구간의 시점들을 그 이전 기억만으로 맞혀 보며, 오차가 줄어드는 쪽으로 한 특징씩 키우거나 줄인다."""
        K, V, O = memory(d, r, kwp, self.h); self.fitted = False
        if len(O) < MIN_MEM: return self
        self.mu = np.nanmean(K, axis=0); self.sd = np.maximum(np.nanstd(K, axis=0), 1e-6)
        vi = np.nonzero((O >= d["n"] - val_rows - self.h) & (O + self.h < d["n"]) & (d["clear"][O] > 0.05 * kwp))[0]
        if len(vi) < 20: return self
        D = self._sqdiff(K[vi], K); Y = V[vi]; ok = (O[None, :] + self.h <= O[vi][:, None]).astype(float)
        self.s = np.ones((2, NF)); best = self._loss(D, Y, V, ok)
        for _ in range(2):
            for k in range(NF):
                for part in (0, 1):
                    for mult in (2.0, 0.5, 0.0):
                        old = self.s[part, k]; self.s[part, k] = old * mult; cur = self._loss(D, Y, V, ok)[part]
                        if cur < best[part] - 1e-6: best[part] = cur
                        else: self.s[part, k] = old
        self.fitted = True
        return self

    def importance(self):
        """가까운·먼 예측에서 중요하게 본 특징 [(이름, 중요도)] 상위 5개씩."""
        return [sorted(zip(NAMES, [round(float(x), 2) for x in self.s[p]]), key=lambda t: -t[1])[:5] for p in (0, 1)]
