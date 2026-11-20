# -*- coding: utf-8 -*-
"""지속 학습: 현장(또는 가상 장치) 자료로 예측 모델을 주기적으로 다시 학습하고, 검증을 통과한 모델만 적용한다.

흐름
  1. 자료 점검      행 수·결측이 기준에 못 미치면 학습하지 않는다(나쁜 자료로 배우지 않는다).
  2. 도전 모델 학습  마지막 holdout_days 를 빼고 학습한다.
  3. 검증           현재 모델과 도전 모델을 그 holdout 구간에서 같은 방법으로 채점한다(학습에 쓰지 않은 자료).
  4. 적용 판단      부하·태양광을 따로 판단한다. 도전 모델의 오차가 현재 모델보다 크지 않을 때만(또는 현재 모델이 없을 때) 그 종류를 바꾼다.
                    바꿀 때는 전체 자료로 다시 학습한 모델을 쓴다. 판단과 수치는 모두 이력에 남긴다.
     모델을 유지하는 경우에도 예측 구간(10~90%)은 최근 자료의 오차로 다시 맞춘다.
  5. 단기 보정      학습 사이에는 최근 오차(직전 2시간)로 예측을 보정한다. 보정이 holdout 에서 오차를 줄일 때만 켠다.
  6. 되돌리기       이전 판을 보관하고(keep 개), 한 번에 되돌릴 수 있다.

모델 파일: <모델 폴더>/model_load.npz · model_pv.npz (적용 중), <모델 폴더>/models/<판>/ (보관), models/history.json (판단 이력)
별도 프로세스로 돌린다(제어 주기를 방해하지 않게):  python -m ifps_ems.learner <이력.csv> <모델 폴더> [설정.json]
"""
import json, os, shutil, sys, time
import numpy as np
from . import dataio, nowcast
from .config import Site, HORIZON
from .forecast import LoadForecaster, PVForecaster, BUCKET, CAL_ROWS

DEFAULTS = {"holdout_days": 3, "min_gain": 0.0, "keep": 10, "max_days": 120, "max_gap": 0.2, "bias_slots": 8, "bias_tau": 8.0, "nmae_limit": 15.0}
MIN_FIT = 672 + CAL_ROWS + HORIZON                    # 학습에 필요한 최소 행 수(15일)
KINDS = (("load", LoadForecaster, "model_load.npz"), ("pv", PVForecaster, "model_pv.npz"))


def recent_bias(f, d, o, kind, site, k=8):
    """발행 시점 o 직전 k 구간의 1구간 앞 예측 오차. 부하: 평균 오차(kW, 더할 값) / 태양광: 실측÷예측 비율(곱할 값, 낮에만)."""
    act, pred = [], []
    for j in range(k, 0, -1):
        oo = o - j
        if oo < 672 or oo + 1 >= d["n"]: continue
        p = float(f.predict(d, oo)[0][0]); a = float(d[kind][oo + 1])
        if kind == "pv" and d["clear"][oo + 1] <= 0.05 * site.pv_kwp: continue
        act.append(a); pred.append(p)
    if len(act) < 3: return None
    if kind == "load": return float(np.mean(np.array(act) - np.array(pred)))
    return float(min(1.5, max(0.5, sum(act) / max(sum(pred), 1e-6))))


def apply_bias(kind, bias, tau, p50, lo, hi):
    """최근 오차 보정을 선행시간에 따라 줄여 가며 적용한다(가까운 구간일수록 크게)."""
    if bias is None: return p50, lo, hi
    w = np.exp(-np.arange(HORIZON) / float(tau))
    if kind == "load": adj = lambda a: np.maximum(0.0, a + bias * w)
    else: adj = lambda a: np.maximum(0.0, a * (1.0 + (bias - 1.0) * w))
    return adj(p50), adj(lo), np.maximum(adj(hi), adj(p50))


def predict(f, d, o, kind, site, meta=None):
    """모델 예측 + (meta 가 허용하면) 최근 오차 보정. 반환: (중앙, 하한, 상한, 적용한 보정값 또는 None)"""
    p50, lo, hi, _ = f.predict(d, o); m = (meta or {}).get(kind, {}); bias = None
    if m.get("bias_on"):
        bias = recent_bias(f, d, o, kind, site, int((meta or {}).get("bias_slots", DEFAULTS["bias_slots"])))
        p50, lo, hi = apply_bias(kind, bias, (meta or {}).get("bias_tau", DEFAULTS["bias_tau"]), p50, lo, hi)
    weights = m.get("nowcast_weights")
    if weights and any(weights):
        ref, valid = nowcast.reference(d, o, kind, site)
        p50, lo, hi = nowcast.blend(p50, lo, hi, ref, valid, weights, kind, site)
    return p50, lo, hi, bias


def select_nowcast(f, d, origins, kind, site, meta):
    def observations():
        for o in origins:
            if o + HORIZON >= d["n"]:
                continue
            p50, lo, hi, _ = predict(f, d, o, kind, site, meta)
            ref, valid = nowcast.reference(d, o, kind, site)
            sl = slice(o + 1, o + HORIZON + 1)
            observed = d.get(kind + "_observed")
            if observed is not None:
                valid &= observed[sl]
            if kind == "pv":
                valid &= d["clear"][sl] > 0.05 * site.pv_kwp
            yield p50, lo, hi, ref, valid, d[kind][sl]
    return nowcast.select(observations(), kind)


def score(f, d, origins, kind, site, cfg, with_bias=False):
    """origins 에서 발행한 24시간 예측의 정규화 평균 절대 오차(%). 부하: 평균 부하 대비 / 태양광: 설비 용량 대비(낮 구간만).
    반환: {"nmae": 전체, "near": 2시간 이내, "n": 표본 수}"""
    e_all, e_near = [], []; mean_l = float(np.mean(d["load"][-7 * 96:])) or 1.0
    for o in origins:
        if o + HORIZON >= d["n"]: continue
        p50, lo, hi, _ = f.predict(d, o)
        if with_bias: p50, _, _ = apply_bias(kind, recent_bias(f, d, o, kind, site, cfg["bias_slots"]), cfg["bias_tau"], p50, lo, hi)
        y = d[kind][o + 1:o + 1 + HORIZON]
        if kind == "load": e = np.abs(p50 - y) / mean_l; ok = np.ones(HORIZON, bool)
        else: e = np.abs(p50 - y) / site.pv_kwp; ok = d["clear"][o + 1:o + 1 + HORIZON] > 0.05 * site.pv_kwp
        observed = d.get(kind + "_observed")
        if observed is not None:
            ok &= observed[o + 1:o + 1 + HORIZON]
        e_all += list(e[ok]); e_near += [float(e[h]) for h in range(BUCKET[1]) if ok[h]]
    pct = lambda a: round(float(np.mean(a)) * 100, 2) if len(a) else None
    return {"nmae": pct(e_all), "near": pct(e_near), "n": len(e_all)}


def cut(d, n):
    """자료의 앞 n 행만 남긴다(배열만 자른다)."""
    return {k: (v[:n] if hasattr(v, "__len__") and not isinstance(v, (str, bytes)) and len(v) == d["n"] else v) for k, v in d.items()} | {"n": n}


def quality(d, cfg):
    """학습 자료 점검. 반환: (통과 여부, 설명)"""
    n = d["n"]
    if n < MIN_FIT + cfg["holdout_days"] * 96: return False, f"자료 {n}구간 — 학습에는 {MIN_FIT + cfg['holdout_days'] * 96}구간({(MIN_FIT + cfg['holdout_days'] * 96) // 96}일) 이상 필요"
    length = min(n, 30 * 96)
    load = d["load"][-length:]
    bad_load = float(np.mean(~d.get("load_observed", np.isfinite(d["load"]))[-length:]))
    day = d["clear"][-length:] > 0
    pv_seen = d.get("pv_observed", np.isfinite(d["pv"]))[-length:]
    bad_pv = float(np.mean(~pv_seen[day])) if day.any() else 0.0
    bad = max(bad_load, bad_pv)
    flat = float(np.mean(np.abs(np.diff(load)) < 1e-9)) if len(load) > 1 else 1.0          # 값이 멈춘 구간(결측을 앞 값으로 채운 흔적)
    if bad > cfg["max_gap"] or flat > max(cfg["max_gap"], 0.5): return False, f"자료 품질 미달 — 비정상 {bad * 100:.0f}%, 값 고정 {flat * 100:.0f}%"
    return True, f"자료 {n}구간({n // 96}일), 값 고정 {flat * 100:.0f}%"


def _hist_path(md): return os.path.join(md, "models", "history.json")


def history(md):
    try:
        with open(_hist_path(md), encoding="utf-8") as f: return json.load(f)
    except (OSError, ValueError): return []


def active(md):
    """적용 중인 모델의 정보(없으면 빈 사전)."""
    try:
        with open(os.path.join(md, "model_active.json"), encoding="utf-8") as f: return json.load(f)
    except (OSError, ValueError): return {}


def _write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True); tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _log(md, rec):
    h = history(md); h.append(rec); _write_json(_hist_path(md), h[-60:])


def _install(md, ver, meta):
    """보관 폴더의 판을 적용 위치로 복사하고 적용 정보를 갱신한다."""
    src = os.path.join(md, "models", ver)
    for _, _, name in KINDS:
        tmp = os.path.join(md, name + ".tmp.npz"); shutil.copyfile(os.path.join(src, name), tmp); os.replace(tmp, os.path.join(md, name))
    _write_json(os.path.join(md, "model_active.json"), meta)


def _prune(md, keep, cur):
    root = os.path.join(md, "models"); vs = sorted(v for v in os.listdir(root) if os.path.isdir(os.path.join(root, v)))
    for v in vs[:-keep]:
        if v != cur: shutil.rmtree(os.path.join(root, v), ignore_errors=True)


def _tail(d, n):
    """자료의 뒤 n 행만 남긴다."""
    return {k: (v[-n:] if hasattr(v, "__len__") and not isinstance(v, (str, bytes)) and len(v) == d["n"] else v) for k, v in d.items()} | {"n": n}


def _judge(what, md, data, site, cfg):
    """한 종류(부하 또는 태양광)의 현재 모델과 도전 모델을 같은 holdout 에서 채점한다. what: (종류, 모델 클래스, 파일 이름), data: (전체, 학습용, 발행 시점들).
    반환: (기록, 적용할 모델 정보)"""
    kind, cls, name = what; d, dtrain, origins = data
    champ = cls(site); has = dataio.load_model(os.path.join(md, name), champ) and champ.trained
    chal = cls(site).fit(dtrain)
    s_ch = score(champ, d, origins, kind, site, cfg) if has else {"nmae": None, "near": None, "n": 0}
    s_new = score(chal, d, origins, kind, site, cfg)
    win = s_new["nmae"] is not None and (s_ch["nmae"] is None or s_new["nmae"] <= s_ch["nmae"] - cfg["min_gain"])
    use, s_use = (chal, s_new) if win else (champ, s_ch)                      # 앞으로 쓸 모델
    s_bias = score(use, d, origins, kind, site, cfg, with_bias=True) if s_use["nmae"] is not None else {"near": None}
    bias_on = s_bias["near"] is not None and s_use["near"] is not None and s_bias["near"] < s_use["near"]          # 보정이 holdout 에서 오차를 줄일 때만 켠다
    gain = None if s_ch["nmae"] is None or s_new["nmae"] is None else round(s_ch["nmae"] - s_new["nmae"], 2)
    rec = {"current": s_ch["nmae"], "new": s_new["nmae"], "gain": gain, "near": s_use["near"], "near_bias": s_bias["near"], "bias_on": bias_on, "better": win, "n": s_new["n"]}
    tuning = {"bias_slots": cfg["bias_slots"], "bias_tau": cfg["bias_tau"], kind: {"bias_on": bias_on}}
    # Use denser issuance for short horizons while keeping all targets in the holdout.
    dense = range(origins[0], origins[-1] + 1, 8) if origins else ()
    weights = select_nowcast(use, d, dense, kind, site, tuning)
    rec["nowcast_weights"] = weights
    return rec, {"nmae": s_use["nmae"], "near": s_bias["near"] if bias_on else s_use["near"],
                 "bias_on": bias_on, "nowcast_weights": weights}


def _adopt(md, d, site, cfg, rec, meta):
    """검증을 통과한 종류만 새 모델로 바꾼다(전체 자료로 다시 학습해 적용). 나머지는 현재 모델을 그대로 새 판에 담는다."""
    ver = meta["ver"]; out = os.path.join(md, "models", ver); os.makedirs(out, exist_ok=True); won = []
    for kind, cls, name in KINDS:
        cur = os.path.join(md, name)
        if rec["kinds"][kind]["better"] or not os.path.exists(cur): dataio.save_model(os.path.join(out, name), cls(site).fit(d)); won.append(kind)
        else:                                             # 모델은 유지하되 예측 구간은 최근 자료로 다시 맞춘다
            m = cls(site); dataio.load_model(cur, m); dataio.save_model(os.path.join(out, name), m.calibrate(d) if m.trained else m)
    meta["prev"] = active(md).get("ver"); meta["updated"] = won
    _write_json(os.path.join(out, "meta.json"), meta); _install(md, ver, meta); _prune(md, cfg["keep"], ver)
    nm = {"load": "부하", "pv": "태양광"}; kept = [nm[k] for k, _, _ in KINDS if k not in won]
    if won: rec.update(adopted=True, ver=ver, recal=bool(kept), why="검증 통과 — " + "·".join(nm[k] for k in won) + " 모델 적용" + (f"({'·'.join(kept)}은 현재 모델이 더 정확해 유지, 예측 구간만 재보정)" if kept else ""))
    else: rec.update(adopted=False, ver=ver, recal=True, why="현재 모델 유지 — 새 모델의 검증 오차가 더 크거나 같음(예측 구간만 최근 자료로 재보정)")


def train(hist_csv, md, site=None, cfg=None, now=None, source=""):
    """한 번의 학습 주기. 반환: 판단 기록(사전). 예외는 기록으로 바꿔 돌려준다(학습 실패가 운전을 멈추면 안 된다)."""
    cfg = dict(DEFAULTS, **(cfg or {})); site = site or Site(); now = now or time.strftime("%Y-%m-%d %H:%M:%S"); t0 = time.time()
    rec = {"t": now, "source": source, "adopted": False, "ver": None, "why": "", "kinds": {}}
    try:
        d = dataio.load_csv(hist_csv, site)
        if d["n"] > cfg["max_days"] * 96: d = _tail(d, cfg["max_days"] * 96)
        ok, why = quality(d, cfg); rec["rows"] = d["n"]; rec["data"] = why
        if ok:
            n = d["n"]; hold = cfg["holdout_days"] * 96; dtrain = cut(d, n - hold); origins = list(range(n - hold - 1, n - HORIZON - 1, 24))
            meta = {"ver": time.strftime("%Y%m%d-%H%M%S"), "t": now, "rows": n, "source": source, "bias_slots": cfg["bias_slots"], "bias_tau": cfg["bias_tau"]}
            for what in KINDS: rec["kinds"][what[0]], meta[what[0]] = _judge(what, md, (d, dtrain, origins), site, cfg)
            _adopt(md, d, site, cfg, rec, meta)
            act = active(md); rec["degraded"] = bool(act) and any((act.get(k, {}).get("nmae") or 0) > cfg["nmae_limit"] for k in ("load", "pv"))
        else:
            rec["why"] = "학습 보류: " + why
    except Exception as e:                                # 학습 실패는 기록만 하고 현재 모델을 그대로 둔다
        rec["why"] = f"학습 실패: {type(e).__name__}: {e}"
    rec["sec"] = round(time.time() - t0, 1)
    _log(md, rec)
    return rec


def rollback(md, now=None):
    """바로 앞 판으로 되돌린다. 반환: 기록(사전)"""
    cur = active(md); prev = cur.get("prev"); now = now or time.strftime("%Y-%m-%d %H:%M:%S")
    rec = {"t": now, "source": "되돌리기", "adopted": False, "ver": None, "why": "", "kinds": {}}
    p = os.path.join(md, "models", str(prev), "meta.json")
    if not prev or not os.path.exists(p): rec["why"] = "되돌릴 이전 판이 없음"; return rec
    with open(p, encoding="utf-8") as f: meta = json.load(f)
    _install(md, prev, meta); rec.update(adopted=True, ver=prev, why=f"이전 판 {prev} 으로 되돌림(되돌리기 전 {cur.get('ver')})"); _log(md, rec)
    return rec


def main(argv=None):
    a = argv if argv is not None else sys.argv[1:]
    if len(a) < 2: print("사용: python -m ifps_ems.learner <이력.csv> <모델 폴더> [설정.json]"); return 2
    opt = {}
    if len(a) > 2:
        with open(a[2], encoding="utf-8") as f: opt = json.load(f)
    site = Site(**{k: v for k, v in (opt.get("site") or {}).items() if k in Site.keys()})
    rec = train(a[0], a[1], site, opt.get("ai"), source=opt.get("source", ""))
    print(json.dumps(rec, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
