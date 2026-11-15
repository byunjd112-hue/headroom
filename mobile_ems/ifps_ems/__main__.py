# -*- coding: utf-8 -*-
"""핵심 프로그램 명령.
  python -m ifps_ems verify                       자가 점검(기동 전 검사, systemd ExecStartPre)
  python -m ifps_ems gen-sample <csv> [--days N]  합성 현장 자료 생성
  python -m ifps_ems train <csv> <모델 폴더>        부하·PV 예측 모델 학습
"""
import argparse, os, sys, tempfile, time


def verify():
    import numpy as np
    from . import __version__, supervisor as sv, dispatch as dp, security
    from .config import Site
    site = Site(); bad = []
    lm = sv.LinkMonitor(["X"]); lm.heartbeat("X", 0.0, "A"); lm.heartbeat("X", 0.0, "B"); lm.heartbeat("X", 3.0, "A")
    if lm.check(3.0).get("X") != sv.DEGRADED: bad.append("LinkMonitor 경로 저하 판정")
    if lm.check(10.0).get("X") != sv.LOST: bad.append("LinkMonitor 두절 판정")
    dev = {"DG": sv.Device("DG"), "FC": sv.Device("FC")}; c = sv.Commander(dev)
    if not c.send("DG", "start")[0] or c.send("DG", "start")[0]: bad.append("Commander 중복 지령 차단")
    if not dp.reserve_need(130, [500, 100]) or dp.reserve_need(80, [500, 100]): bad.append("N-1 예비력 판정")
    if sv.sync_check(0.5, 1, 1)[0] or not sv.sync_check(0.05, 1, 2)[0]: bad.append("동기 판정")
    pl = dp.Planner(site); T = 8
    V = pl.plan(np.full(T, 120.0), np.zeros(T), np.tile([30, 50, 40], (T, 1)), np.arange(T) * 0.25 + 12)
    if not np.all(np.isfinite(V)): bad.append("운전계획 가치함수")
    td = tempfile.mkdtemp(); a = security.AuditLog(os.path.join(td, "a.log"), security.CryptoProvider(b"verify-key-0123456789abcdef"))
    for i in range(3): a.append("verify", "test", {"i": i})
    if not a.verify()[0]: bad.append("감사 기록 연쇄")
    print(f"ifps_ems v{__version__} 자가 점검:", "정상" if not bad else "이상 " + ", ".join(bad))
    return 0 if not bad else 1


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ifps_ems"); sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("verify")
    g = sub.add_parser("gen-sample"); g.add_argument("csv"); g.add_argument("--days", type=int, default=120)
    t = sub.add_parser("train"); t.add_argument("csv"); t.add_argument("outdir")
    a = ap.parse_args(argv)
    if a.cmd == "verify": return verify()
    from .config import Site
    from . import dataio
    site = Site()
    if a.cmd == "gen-sample":
        n = dataio.gen_sample(site, a.csv, a.days); print(f"{a.csv}: {n}행"); return 0
    if a.cmd == "train":
        from .forecast import LoadForecaster, PVForecaster
        d = dataio.load_csv(a.csv, site); os.makedirs(a.outdir, exist_ok=True); t0 = time.time()
        fl = LoadForecaster(site).fit(d); dataio.save_model(os.path.join(a.outdir, "model_load.npz"), fl)
        fp = PVForecaster(site).fit(d); dataio.save_model(os.path.join(a.outdir, "model_pv.npz"), fp)
        print(f"학습 완료 {d['n']}행, {time.time() - t0:.1f}초 → {a.outdir}"); return 0


if __name__ == "__main__":
    sys.exit(main())
