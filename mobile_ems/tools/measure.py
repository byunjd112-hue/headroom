# -*- coding: utf-8 -*-
"""동적 시험(성능·요구 시간) 측정. 가상 장치 + 실행 엔진 + 웹 서버를 띄워 실제 통신으로 잰다.
  python tools/measure.py [결과.json] [--soak 초]
결과는 시험 리포트(docs/build_test_report.js)의 입력으로 쓴다."""
import json, os, resource, shutil, statistics as st, sys, tempfile, threading, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from ifps_ems_rt.hmi.engine import Engine
from ifps_ems_rt.hmi.server import serve


def q(base, path, body=None, tok=None):
    r = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST")
    if tok: r.add_header("X-EMS-Token", tok)
    with urllib.request.urlopen(r, timeout=10) as f: return json.loads(f.read())  # nosec B310 — 시험용, 127.0.0.1 http 고정


def until(fn, limit=10.0, step=.05):
    t0 = time.monotonic()
    while time.monotonic() - t0 < limit:
        if fn(): return time.monotonic() - t0
        time.sleep(step)
    return None


def pct(a, p): a = sorted(a); return a[min(len(a) - 1, int(len(a) * p))] if a else None


def main():
    out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else os.path.join(ROOT, "docs", "test_results.json")
    soak = int(sys.argv[sys.argv.index("--soak") + 1]) if "--soak" in sys.argv else 120
    td = tempfile.mkdtemp()
    for f in ("runtime.json", "pointmap.csv"): shutil.copy(os.path.join(ROOT, "config", f), td)
    cfgp = os.path.join(td, "runtime.json"); cfg = json.load(open(cfgp, encoding="utf-8")); cfg["ctrl_s"] = 3600; cfg["hmi"] = {"pin_operator": "4321", "pin_engineer": "8765"}
    json.dump(cfg, open(cfgp, "w", encoding="utf-8"), ensure_ascii=False)
    R = {"env": {"python": sys.version.split()[0], "platform": sys.platform, "cpu": os.cpu_count(), "date": time.strftime("%Y-%m-%d %H:%M")}}
    eng = Engine(cfgp, sim=True, plan_dir=os.path.join(ROOT, "results")); eng.start(); httpd = serve(eng, "127.0.0.1", 0); base = f"http://127.0.0.1:{httpd.server_address[1]}"
    time.sleep(3); op = q(base, "/api/login", {"pin": "4321", "name": "시험"})["token"]
    rss0 = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    lk = lambda d: eng.rt.lm.state[d]
    # 1) 통신 두절 감지(요구 3.0초)
    det = []
    for _ in range(5):
        eng.plant.muted.add("ESS"); det.append(until(lambda: lk("ESS") == "두절")); eng.plant.muted.discard("ESS"); until(lambda: lk("ESS") == "정상")
    R["comm_lost_s"] = det
    # 2) 경로 저하 감지
    deg = []
    for _ in range(3):
        eng.plant.down.add("A"); deg.append(until(lambda: lk("DG") == "경로 저하")); eng.plant.down.clear(); until(lambda: lk("DG") == "정상")
    R["path_degraded_s"] = deg
    # 3) 복구 후 재조회·정상 복귀
    rec = []
    for _ in range(3):
        eng.plant.muted.add("FC"); until(lambda: lk("FC") == "두절"); t0 = time.monotonic(); eng.plant.muted.discard("FC"); until(lambda: lk("FC") == "정상"); rec.append(time.monotonic() - t0)
    R["recovery_s"] = rec
    # 4) SBO 지령 응답(선택→실행→응답 확인)
    sbo = []
    for i in range(4):
        want = (i % 2 == 0); sid = q(base, "/api/select", {"dev": "DG", "cmd": "start" if want else "stop"}, op)["sid"]; t0 = time.monotonic(); q(base, "/api/operate", {"sid": sid}, op)
        until(lambda: eng.rt.dev["DG"].on == want); sbo.append(time.monotonic() - t0)
    R["sbo_ack_s"] = sbo
    # 5) 무응답 → 재지령 → 대체 전원(요구 5.0초)
    fb = []
    for _ in range(3):
        for d in ("DG", "FC"):
            if eng.rt.dev[d].on: eng.rt.cmd.send(d, "stop")
        eng.plant.no_ack.add("DG"); eng.rt.scan(); ok, dt = eng.rt.cmd.send("DG", "start"); fb.append(dt if ok else None); eng.plant.no_ack.clear()
    R["fallback_s"] = fb
    # 6) 차단기 트립 → 경보
    trip = []
    for f in ("L3", "L2", "DG"):
        eng.simdrv.trip(f, 51); trip.append(until(lambda: any(a["key"] == f"cb.trip.{f}" for a in eng.alarms.snapshot()[0]))); eng.plant.set(f"CB.{f}", 1); eng.plant.set(f"FLT.{f}", 0)
    R["trip_alarm_s"] = trip
    # 7) 예측·운전계획 연산
    t0 = time.monotonic(); eng._compute_forecast(); R["forecast_backtest_s"] = time.monotonic() - t0; R["forecast_acc"] = {k: v for k, v in eng.fc_cache["acc"].items() if k in ("load_nmae", "pv_nmae", "load_cov", "pv_cov", "n_issue")}
    from ifps_ems.dispatch import Planner
    import numpy as np
    pl = Planner(eng.rt.site); tt = []
    for _ in range(3):
        t0 = time.monotonic(); pl.plan(np.full(96, 90.0), np.clip(300 * np.sin(np.pi * ((np.arange(96) * .25) - 6) / 12), 0, None), np.tile([30, 35, 25], (96, 1)).astype(float), (np.arange(96) * .25) % 24); tt.append(time.monotonic() - t0)
    R["plan_s"] = tt
    # 8) HTTP 부하: 20 동시 클라이언트 × 100 요청(/api/snapshot)
    lat, err = [], [0]; lock = threading.Lock()
    def worker():
        for _ in range(100):
            t0 = time.monotonic()
            try: q(base, "/api/snapshot")
            except Exception:
                with lock: err[0] += 1
                continue
            with lock: lat.append((time.monotonic() - t0) * 1000)
    ths = [threading.Thread(target=worker) for _ in range(20)]; t0 = time.monotonic(); [t.start() for t in ths]; [t.join() for t in ths]; dur = time.monotonic() - t0
    R["http"] = {"requests": len(lat) + err[0], "errors": err[0], "rps": round(len(lat) / dur, 1), "p50_ms": round(pct(lat, .5), 1), "p95_ms": round(pct(lat, .95), 1), "max_ms": round(max(lat), 1)}
    # 9) 장시간(soak): 수집 주기·주기 초과·메모리
    n0, o0 = eng.rt.n_scan, eng.rt.n_over; eng.scan_ms.clear(); time.sleep(soak)
    sm = list(eng.scan_ms)
    R["soak"] = {"seconds": soak, "scans": eng.rt.n_scan - n0, "overruns": eng.rt.n_over - o0, "avg_ms": round(st.mean(sm), 2), "p95_ms": round(pct(sm, .95), 2), "max_ms": round(max(sm), 2),
                 "rss_mb_start": round(rss0 / 1024, 1), "rss_mb_end": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)}
    R["audit"] = {"seq": eng.rt.audit.seq, "verify": eng.rt.audit.verify()}
    httpd.shutdown(); eng.stop(); shutil.rmtree(td, ignore_errors=True)
    json.dump(R, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1); print(json.dumps(R, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
