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


UNITS = ["kW", "kWh", "%", "V", "A", "Hz", "Nm3", "L", "degC", ""]
PKIND = ["이름 중복", "자료형 오류", "바이트 순서 오류", "기능 코드 오류", "읽기·쓰기 구분 오류", "지령은 보유", "단위 오류", "배율 0", "범위 하한", "정의되지 않은 장치", "주소 겹침", "전력 채널 단위"]


def phase2():
    """2단계 벡터: 대응표 검사·읽기 묶음, SHA-256·HMAC, 십진수 해석, 지령 순번."""
    import hashlib, hmac
    from ifps_ems_rt import pointmap as pm
    devs = {"D0": {}, "D1": {}}; val, blk = [], []
    for case in range(400):
        n = R.randrange(1, 40); pts = []; addr = {("D0", 3): 0, ("D0", 4): 0, ("D1", 3): 0, ("D1", 4): 0}; faulty = case % 4 != 0
        for i in range(n):
            dv = R.choice(["D0", "D1"]); fc = R.choice([3, 4]); ty = R.choice(TYPES); rw = "w" if (fc == 3 and R.random() < 0.2) else "r"; un = R.choice(UNITS)
            tag = f"{dv}.p{i}" if R.random() < 0.85 else f"{dv}.x{i}.kw"
            if tag.endswith(".kw") and not faulty: un = "kW"
            a = addr[(dv, fc)] + R.choice([0, 0, 0, 1, 3]); addr[(dv, fc)] = a + mb.NREG[ty]
            lo, hi = R.choice([(None, None), (0.0, 100.0), (-50.0, 50.0), (None, 10.0)])
            p = {"tag": tag, "device": dv, "fc": fc, "addr": a, "type": ty, "scale": R.choice([1.0, 0.1, 0.01, -0.1]), "unit": un, "lo": lo, "hi": hi, "rw": rw, "order_raw": "", "order": R.choice(ORDERS)}
            if faulty and R.random() < 0.25:
                k = R.randrange(11)
                if k == 0 and pts: p["tag"] = R.choice(pts)["tag"]
                elif k == 1: p["type"] = "u99"
                elif k == 2: p["order"] = None
                elif k == 3: p["fc"] = R.choice([1, 6])
                elif k == 4: p["rw"] = "x"
                elif k == 5: p["rw"] = "w"; p["fc"] = 4
                elif k == 6: p["unit"] = "kVA"
                elif k == 7: p["scale"] = 0.0
                elif k == 8: p["lo"], p["hi"] = 10.0, 10.0
                elif k == 9: p["device"] = "NOPE"
                else: p["addr"] = max(0, a - 1)
            pts.append(p)
        errs = pm.validate(pts, devs); cnt = [sum(1 for e in errs if k in e) for k in PKIND]
        assert sum(cnt) == len(errs), errs
        enc = lambda p: " ".join(str(x) for x in (p["tag"], {"D0": 0, "D1": 1}.get(p["device"], -1), p["fc"], p["addr"], TYPES.index(p["type"]) if p["type"] in TYPES else 8, h(p["scale"]),
                                                  UNITS.index(p["unit"]) if p["unit"] in UNITS else 99, int(p["lo"] is not None), h(p["lo"] or 0.0), int(p["hi"] is not None), h(p["hi"] or 0.0),
                                                  {"r": 0, "w": 1}.get(p["rw"], 2), ORDERS.index(p["order"]) if p["order"] else 4))
        val.append(f"case {n}"); val += [enc(p) for p in pts]; val.append("expect " + " ".join(str(c) for c in cnt))
        if not faulty:
            for dv in ("D0", "D1"):
                gap = R.choice([0, 0, 1, 4]); mx = R.choice([100, 8, 20]); mix = pts[:]; R.shuffle(mix); bs = pm.blocks(mix, dv, gap, mx)      # 입력 순서가 섞여 있어도 주소순으로 묶는다
                blk.append(f"case {n}"); blk += [enc(p) for p in mix]; blk.append(f"expect {0 if dv == 'D0' else 1} {gap} {mx} {len(bs)} " + " ".join(f"{b[0]} {b[1]} {b[2]} {len(b[3])}" for b in bs))
    sha = []
    for _ in range(300):
        msg = bytes(R.randrange(256) for _ in range(R.choice([0, 1, 55, 56, 57, 63, 64, 65, 119, 120, R.randrange(300)]))); key = bytes(R.randrange(256) for _ in range(R.choice([0, 1, 32, 64, 65, 100])))
        sha.append(f"{msg.hex() or '-'} {key.hex() or '-'} {hashlib.sha256(msg).hexdigest()} {hmac.new(key, msg, hashlib.sha256).hexdigest()}")
    dec = []
    for _ in range(1500):
        ip = str(R.randrange(0, 10 ** R.randrange(1, 9))); fp = "".join(R.choice("0123456789") for _ in range(R.randrange(0, 7))); t = R.choice(["", "-", "+"]) + ip + ("." + fp if (fp or R.random() < 0.1) else "")
        t = R.choice([t, t, t, t, "abc", "", "1e5", "1.2.3", "-", ".", "12a", " 1"]) if R.random() < 0.15 else t
        try: v = h(float(t)) if (t.strip() == t and "e" not in t.lower() and t not in ("", "-", "+") and "_" not in t and any(c.isdigit() for c in t) and "inf" not in t and "nan" not in t) else "bad"
        except ValueError: v = "bad"
        dec.append(f"[{t}] {v}")
    seq = []; cur = 0
    for _ in range(500):
        last = R.choice([0, cur, R.randrange(65536), 65535, 65534]); nxt = max(cur, last) % 65535 + 1; seq.append(f"{cur} {last} {nxt}"); cur = R.choice([nxt, nxt, R.randrange(65536)])
    return val, blk, sha, dec, seq


nd, ne = codec(); L, ga, gd, au, sw = ops(); sq = shed_seq(); pv, pb, sh2, dc, sq2 = phase2()
for name, rows in (("pm_validate.txt", pv), ("pm_blocks.txt", pb), ("sha.txt", sh2), ("decimal.txt", dc), ("seq.txt", sq2)):
    open(os.path.join(OUT, name), "w").write("\n".join(rows) + "\n")
for name, rows in (("site.txt", L), ("garrison.txt", ga), ("gdg.txt", gd), ("autonomy.txt", au), ("shedwant.txt", sw), ("shedseq.txt", sq)):
    open(os.path.join(OUT, name), "w").write("\n".join(rows) + "\n")
print(f"벡터: decode {nd}, encode {ne}, garrison {len(ga)}, gdg {len(gd)}, autonomy {len(au)}, shedwant {len(sw)}, shedseq {len(sq)}, 대응표 검사 {sum(1 for x in pv if x.startswith('case'))}, 읽기 묶음 {sum(1 for x in pb if x.startswith('case'))}, SHA·HMAC {len(sh2)}, 십진수 {len(dc)}, 순번 {len(sq2)}")
