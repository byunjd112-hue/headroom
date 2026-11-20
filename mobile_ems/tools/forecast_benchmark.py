"""Chronological 98/8/14-day comparison using reproducible synthetic data.

The prediction interval is recalibrated once per test day from data available at that time, as the
continual-learning cycle does in operation (--static-interval keeps the training-time interval)."""
import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import time

import numpy as np

from ifps_ems import dataio, learner
from ifps_ems.config import HORIZON, Site

DAY = 96


def summarize(rows, scale):
    out = {}
    for name, stop in (("15m", 1), ("1h", 4), ("2h", 8), ("4h", 16), ("24h", 96)):
        targets, predictions, covers = [], [], []
        for y, p, lo, hi, valid in rows:
            mask = valid[:stop]
            targets.extend(y[:stop][mask])
            predictions.extend(p[:stop][mask])
            covers.extend(((lo[:stop] <= y[:stop]) & (y[:stop] <= hi[:stop]))[mask])
        err = np.abs(np.asarray(targets) - np.asarray(predictions))
        out[name] = {"n": len(err), "mae_kw": round(float(err.mean()), 3),
                     "nmae_pct": round(float(100 * err.mean() / scale), 3),
                     "coverage_pct": round(float(100 * np.mean(covers)), 2)}
    return out


def evaluate(data, site, seed, daily=True):
    n = data["n"]
    fit = 98 * DAY
    test = 106 * DAY
    tuning = range(fit - 1, test - HORIZON, 8)
    origins = range(test - 1, n - HORIZON, 8)
    train = learner.cut(data, fit)
    out = {"seed": seed, "test_origins": len(origins), "targets": {}}
    for kind, model, _ in learner.KINDS:
        forecaster = model(site).fit(train)
        baseline = learner.score(forecaster, data, tuning, kind, site, learner.DEFAULTS)
        with_bias = learner.score(forecaster, data, tuning, kind, site, learner.DEFAULTS, with_bias=True)
        bias = with_bias["near"] is not None and with_bias["near"] < baseline["near"]
        params = {kind: {"bias_on": bias}}
        weights = learner.select_nowcast(forecaster, data, tuning, kind, site, params)
        candidate = {kind: {"bias_on": bias, "nowcast_weights": weights}}
        before, after, timing = [], [], []
        scales, last = [], None
        for o in origins:
            if daily and (last is None or o - last >= DAY):
                forecaster.calibrate(learner.cut(data, o + 1))
                scales.append(forecaster.cal_scale)
                last = o
            sl = slice(o + 1, o + 1 + HORIZON)
            y = data[kind][sl]
            valid = data[kind + "_observed"][sl].copy()
            if kind == "pv":
                valid &= data["clear"][sl] > 0.05 * site.pv_kwp
            p, lo, hi, _ = learner.predict(forecaster, data, o, kind, site, params)
            before.append((y, p, lo, hi, valid))
            start = time.perf_counter()
            p, lo, hi, _ = learner.predict(forecaster, data, o, kind, site, candidate)
            timing.append(time.perf_counter() - start)
            after.append((y, p, lo, hi, valid))
        scale = site.pv_kwp if kind == "pv" else float(data["load"][test:].mean())
        out["targets"][kind] = {"bias": bias, "weights": weights, "scale_kw": scale,
                                 "baseline": summarize(before, scale), "enhanced": summarize(after, scale),
                                 "interval_scale_mean": round(float(np.mean(scales)), 3) if scales else None,
                                 "median_ms": round(1000 * float(np.median(timing)), 2)}
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--seeds", nargs="+", type=int, default=[17, 43, 7, 101, 202, 303])
    parser.add_argument("--static-interval", action="store_true", help="keep the training-time interval")
    args = parser.parse_args()
    site = Site()
    results = []
    with TemporaryDirectory() as directory:
        for seed in args.seeds:
            path = Path(directory) / f"forecast-{seed}.csv"
            dataio.gen_sample(site, path, days=120, seed=seed)
            data = dataio.load_csv(path, site)
            # The bundled generator anticipates future cloud states. Exclude that proxy.
            data["sky"][:] = np.nan
            results.append(evaluate(data, site, seed, not args.static_interval))
    args.out.write_text(json.dumps({"fit_days": 98, "tune_days": 8, "test_days": 14, "camera": False, "interval": "static" if args.static_interval else "daily",
                                    "runs": results}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
