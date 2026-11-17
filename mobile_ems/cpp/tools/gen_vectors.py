# -*- coding: utf-8 -*-
"""파이썬 기준 구현의 입력·출력을 시험 벡터 파일로 뽑는다. C++ 시험이 같은 입력으로 같은 출력을 내는지 비교한다.
사용: python cpp/tools/gen_vectors.py <출력 폴더>      (난수 씨앗 고정 — 언제 돌려도 같은 벡터)"""
import math, os, random, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path.insert(0, ROOT)
from ifps_ems_rt import modbus as mb, opsmode as om      # noqa: E402
from ifps_ems.config import Site                        # noqa: E402

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); R = random.Random(20261117)
TYPES = ["u16", "i16", "u32", "i32", "f32", "u64", "i64", "f64"]; ORDERS = ["ABCD", "CDAB", "BADC", "DCBA"]
h = lambda x: float(x).hex() if isinstance(x, float) else float(x).hex()


def codec():
    dec, enc = [], []
    for _ in range(4000):
        t = R.randrange(8); o = R.randrange(4); n = mb.NREG[TYPES[t]]; sc = R.choice([1.0, 0.1, 0.01, 10.0, -0.1, 0.001])
        regs = [R.choice([0, 1, 0x7FFF, 0x8000, 0xFFFF, R.randrange(65536), R.randrange(65536)]) for _ in range(n)]
        if TYPES[t] in ("u64", "i64"): regs[0] = R.choice([0, 0, 0xFFFF, R.randrange(32)]); regs[1] = R.choice([0, 0xFFFF, R.randrange(65536)]) if regs[0] in (0, 0xFFFF) else regs[1]
        v = mb.decode(regs, TYPES[t], sc, ORDERS[o])
        if TYPES[t] in ("u64", "i64") and abs(v if sc != 1 else int(v)) >= 2 ** 53 * abs(sc if sc != 1 else 1): continue          # 배정도로 정확히 표현되는 범위만 비교
        dec.append(f"{t} {o} {h(sc)} {' '.join(str(r) for r in regs + [0] * (4 - n))} {'nan' if (isinstance(v, float) and math.isnan(v)) else h(float(v))}")
    for _ in range(4000):
        t = R.randrange(8); o = R.randrange(4); sc = R.choice([1.0, 0.1, 0.01, 10.0, 0.5]); n = mb.NREG[TYPES[t]]
        mag = R.choice([1, 100, 40000, 3e9, 5e12, 1e19, 1e39]); v = R.choice([0.0, 0.5, 1.5, 2.5, -0.5, -1.5, R.uniform(-mag, mag), float(R.randrange(-70000, 70000)), R.uniform(-1, 1) * 1e-40])
        if v == 0.0 and math.copysign(1.0, v) < 0: v = 0.0
        try: regs = mb.encode(v, TYPES[t], sc, ORDERS[o]); ok = 1
        except mb.ModbusError: regs = []; ok = 0
        if ok and TYPES[t] in ("u64", "i64") and abs(v / sc) >= 2 ** 53: continue
        enc.append(f"{t} {o} {h(sc)} {h(v)} {ok} {' '.join(str(r) for r in regs + [0] * (4 - len(regs)))}")
    open(os.path.join(OUT, "decode.txt"), "w").write("\n".join(dec) + "\n"); open(os.path.join(OUT, "encode.txt"), "w").write("\n".join(enc) + "\n")
    return len(dec), len(enc)


S = Site(); G = om.Garrison()
GWHY = [("부하 공급·ESS 충전(발전기 대기)", 1), ("발전기 대기", 0), ("충전율 낮음", 2), ("정전 지속", 3), ("최소 운전 시간", 5), ("충전 완료", 6), ("부하를 감당 → 발전기 정지", 7), ("발전기 운전", 4)]
SWHY = [("저소음", 1), ("자립 태세", 2), ("충전율", 3), ("공급 능력", 4)]
code = lambda s, tab: next((c for k, c in tab if k in s), 0)


def ops():
    L = [" ".join(h(x) for x in (S.ess_kwh, S.ess_kw, S.soc_min, S.soc_max, S.ess_eff, S.dg_l_per_kwh, S.fc_nm3_per_kwh, S.elz_kw, S.h2_nm3, S.h2_min))]
    ga, gd, au, sw = [], [], [], []
    for _ in range(3000):
        hr = R.choice([R.uniform(0, 24), 9.0, 10.0, 12.0, 13.0, 17.0, 23.0]); load = R.uniform(0, 400); pv = R.choice([0.0, R.uniform(0, 420)]); elz = R.choice([0.0, 0.0, 50.0]); soc = R.uniform(0.1, 0.95); h2 = R.choice([R.uniform(0, 1000), 960.0])
        r = om.garrison_step(S, G, hr, load, pv, elz, soc, h2); band = {"mid": 0, "peak": 1, "off": 2}[r["band"]]
        ga.append(f"{h(hr)} {h(load)} {h(pv)} {h(elz)} {h(soc)} {h(h2)} {h(r['grid'])} {h(r['ess'])} {h(r['pv_lim'])} {int(r['elz'])} {band}")
    for _ in range(3000):
        out = R.choice([0.0, 5.0, 29.9, 30.0, R.uniform(0, 900)]); soc = R.choice([R.uniform(0.1, 0.95), 0.35, 0.85, 0.75, 0.45]); run = R.random() < 0.5; net = R.choice([R.uniform(-300, 1400), -20.0, 0.0, 60.0]); hold = R.random() < 0.25
        r = om.gdg_step(S, G, out, soc, run, net, hold)
        gd.append(f"{h(out)} {h(soc)} {int(run)} {h(net)} {int(hold)} {int(r['run'])} {h(r['ess'])} {h(r['gdg'])} {code(r['why'], GWHY)} {int('부하율' in r['why'])}")
    for _ in range(2000):
        a = (R.uniform(0.1, 0.95), R.uniform(0, 1000), R.choice([0.0, -5.0, R.uniform(0, 1000)]), R.choice([0.0, 0.4, R.uniform(0, 60)]), R.uniform(0, 60), R.uniform(0, 60), R.choice([0.0, R.uniform(0, 2500)]), R.random() < 0.3, R.choice([0.0, R.uniform(0, 20000)]))
        r = om.autonomy(S, a[0], a[1], a[2], (a[3], a[4], a[5]), a[6], a[7], a[8])
        au.append(" ".join(h(x) for x in a[:7]) + f" {int(a[7])} {h(a[8])} {h(r['full'])} {h(r['shed3'])} {h(r['p1'])} {h(r['store_kwh'])}")
    for _ in range(3000):
        post = R.randrange(3); soc = R.choice([R.uniform(0.1, 0.9), 0.18, 0.21, 0.2]); has = R.random() < 0.8; sup = R.uniform(50, 700); l12 = R.uniform(20, 300); ld = l12 + R.uniform(0, 100); ha = R.random() < 0.7; fu = R.uniform(0, 150); s3 = R.uniform(0, 150); tg = R.choice([72.0, 24.0])
        w = om.LoadShedder.want(S, om.POSTURES[post], soc, sup if has else None, l12, ld, {"full": fu, "shed3": s3} if ha else None, tg)
        sw.append(f"{post} {h(soc)} {int(has)} {h(sup)} {h(l12)} {h(ld)} {int(ha)} {h(fu)} {h(s3)} {h(tg)} {code(w['L3'], SWHY)} {code(w['L2'], SWHY)}")
    return L, ga, gd, au, sw


def shed_seq():
    """차단·복구 상태 기계 벡터(주기마다: 시각, 요구, 차단기 상태, 충전율 → 조치)."""
    out = []
    for _ in range(60):
        sd = om.LoadShedder(3.0, 60.0); t = 0.0; cb = {"L3": 1, "L2": 1}; out.append("reset")
        for _ in range(120):
            t += R.choice([1.0, 1.0, 5.0, 30.0]); w3 = R.random() < 0.35; w2 = w3 and R.random() < 0.4
            if R.random() < 0.05: w2, w3 = True, False
            hs = R.random() < 0.9; soc = R.uniform(0.15, 0.6)
            if R.random() < 0.05: cb[R.choice(["L3", "L2"])] = R.choice([0, 1, 2, None])
            pre = dict(cb); acts = sd.step(t, {"L3": "x" if w3 else "", "L2": "y" if w2 else ""}, dict(cb), soc if hs else None, S.soc_min)
            for f, a, _ in acts: cb[f] = 0 if a == "shed" else 1
            e = lambda v: -1 if v is None else v
            pad = [(0, 0)] * (2 - len(acts)); al = [(0 if f == "L3" else 1, 0 if a == "shed" else 1) for f, a, _ in acts] + pad
            out.append(f"{h(t)} {int(w3)} {int(w2)} {e(pre['L3'])} {e(pre['L2'])} {int(hs)} {h(soc)} {len(acts)} {al[0][0]} {al[0][1]} {al[1][0]} {al[1][1]}")
    return out


nd, ne = codec(); L, ga, gd, au, sw = ops(); sq = shed_seq()
for name, rows in (("site.txt", L), ("garrison.txt", ga), ("gdg.txt", gd), ("autonomy.txt", au), ("shedwant.txt", sw), ("shedseq.txt", sq)):
    open(os.path.join(OUT, name), "w").write("\n".join(rows) + "\n")
print(f"벡터: decode {nd}, encode {ne}, garrison {len(ga)}, gdg {len(gd)}, autonomy {len(au)}, shedwant {len(sw)}, shedseq {len(sq)}")
