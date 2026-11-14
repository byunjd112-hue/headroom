# -*- coding: utf-8 -*-
"""릿지 회귀(입력 표준화)와 분위수 예측 구간."""
import numpy as np


class Ridge:
    def __init__(self, lam=3.0):
        self.lam = lam; self.mu = None; self.sd = None; self.w = None

    def fit(self, X, y):
        X = np.asarray(X, float); y = np.asarray(y, float)
        self.mu = X.mean(0); self.sd = X.std(0); self.sd[self.sd < 1e-9] = 1.0
        Z = np.hstack([np.ones((len(X), 1)), (X - self.mu) / self.sd])
        R = self.lam * np.eye(Z.shape[1]); R[0, 0] = 0.0
        self.w = np.linalg.solve(Z.T @ Z + R, Z.T @ y)
        return self

    def predict(self, X):
        X = np.atleast_2d(np.asarray(X, float))
        return np.hstack([np.ones((len(X), 1)), (X - self.mu) / self.sd]) @ self.w

    def to_arrays(self, p):
        return {p + "mu": self.mu, p + "sd": self.sd, p + "w": self.w}

    def from_arrays(self, a, p):
        self.mu, self.sd, self.w = a[p + "mu"], a[p + "sd"], a[p + "w"]
        return self


def quantiles(res, lo=0.10, hi=0.90):
    res = np.asarray(res, float); res = res[np.isfinite(res)]
    if len(res) < 10: return -0.15, 0.15
    return float(np.quantile(res, lo)), float(np.quantile(res, hi))
