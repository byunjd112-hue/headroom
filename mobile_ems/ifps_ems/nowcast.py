"""Causal short-horizon corrections for the existing load and PV models."""
import numpy as np

from .config import HORIZON
from .forecast import BUCKET, _clear_at

WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
SHORT_BUCKETS = 3
PV_TAPER = np.ones(HORIZON)
PV_TAPER[:4] = (1.0, 0.6, 0.3, 0.15)


def reference(d, o, kind, site):
    """Return the sensor-driven reference and its validity mask."""
    horizons = np.arange(1, HORIZON + 1)
    start = max(96 if kind == "load" and o >= 96 else 0, o - 2)
    y = d[kind][start:o + 1]
    measured = d.get(kind + "_observed")
    valid = np.isfinite(y)
    if measured is not None:
        valid &= measured[start:o + 1]

    if kind == "load":
        if o < 96 or not valid[-1]:
            return np.zeros(HORIZON), np.zeros(HORIZON, dtype=bool)
        history = d["load"][start - 96:o + 1 - 96]
        past = np.isfinite(history)
        if measured is not None:
            past &= measured[start - 96:o + 1 - 96]
        usable = valid & past
        if not usable.any():
            return np.zeros(HORIZON), np.zeros(HORIZON, dtype=bool)
        shift = float(np.median((y - history)[usable]))
        shift = np.clip(shift, -0.30 * site.base_load_kw, 0.30 * site.base_load_kw)
        idx = o + horizons - 96
        lag_valid = np.isfinite(d["load"][idx])
        if measured is not None:
            lag_valid &= measured[idx]
        profile = d["load"][idx] + shift * np.exp(-(horizons - 1) / 12)
        # The latest load anchors the closest forecast. The daily curve takes over gradually.
        mix = np.exp(-(horizons - 1) / 3)
        return np.maximum(0.0, mix * y[-1] + (1 - mix) * profile), lag_valid

    clear = d["clear"][start:o + 1]
    day = valid & (clear >= 0.08 * site.pv_kwp)
    if not day[-1] or not np.isfinite(clear[-1]):
        return np.zeros(HORIZON), np.zeros(HORIZON, dtype=bool)
    ratios = np.clip(y[day] / clear[day], 0, 1.1)
    index = 0.7 * ratios[-1] + 0.3 * float(np.median(ratios))
    future_clear = np.array([_clear_at(site, d, o, h) for h in horizons])
    return np.clip(future_clear * index, 0, site.pv_kwp), future_clear >= 0.02 * site.pv_kwp


def blend(p50, lo, hi, ref, valid, weights, kind, site):
    weights = np.asarray(weights, dtype=float)
    if weights.shape != (len(BUCKET),) or not np.all(np.isin(weights, WEIGHTS)):
        return p50, lo, hi
    by_slot = np.repeat(weights, np.diff((0,) + BUCKET))
    if kind == "pv":
        by_slot = by_slot * PV_TAPER
    effective = np.where(valid, by_slot, 0.0)
    shift = np.where(effective > 0, effective * (ref - p50), 0.0)
    cap = site.pv_kwp if kind == "pv" else np.inf
    mid = np.clip(p50 + shift, 0, cap)
    lower = np.minimum(mid, np.clip(lo + shift, 0, cap))
    upper = np.maximum(mid, np.clip(hi + shift, 0, cap))
    return np.where(effective > 0, mid, p50), np.where(effective > 0, lower, lo), np.where(effective > 0, upper, hi)


def select(samples, kind="load"):
    """Choose weights per short horizon. Require 2% MAE gain and no coverage loss over 2 pp."""
    errors = np.zeros((len(BUCKET), len(WEIGHTS)))
    covered = np.zeros_like(errors)
    counts = np.zeros(len(BUCKET), dtype=int)
    for base, lo, hi, ref, usable, target in samples:
        for b in range(SHORT_BUCKETS):
            lower = 0 if b == 0 else BUCKET[b - 1]
            sl = slice(lower, BUCKET[b])
            mask = usable[sl] & np.isfinite(target[sl])
            counts[b] += int(np.sum(mask))
            y = target[sl][mask]
            base_slice = base[sl][mask]
            delta = ref[sl][mask] - base_slice
            if kind == "pv":
                delta *= PV_TAPER[sl][mask]
            shifts = np.asarray(WEIGHTS)[:, None] * delta
            errors[b] += np.abs(base_slice + shifts - y).sum(axis=1)
            covered[b] += ((lo[sl][mask] + shifts <= y) & (y <= hi[sl][mask] + shifts)).sum(axis=1)
    chosen = [0.0] * len(BUCKET)
    for b in range(SHORT_BUCKETS):
        if counts[b] < 40:
            continue
        eligible = (errors[b] <= 0.98 * errors[b, 0]) & (covered[b] >= covered[b, 0] - 0.02 * counts[b])
        for i in np.argsort(errors[b], kind="stable"):
            if eligible[i]:
                chosen[b] = WEIGHTS[i]
                break
    return chosen
