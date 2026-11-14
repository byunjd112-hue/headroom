# -*- coding: utf-8 -*-
"""EMS 제어화면 기동.

  python -m ifps_ems_rt.hmi config/runtime.json --sim          가상 장치로 기동(실장치 없이 시연·교육·시험)
  python -m ifps_ems_rt.hmi config/runtime.json                실장치 연동(runtime.json의 devices 주소로 접속)
  python -m ifps_ems_rt.hmi config/runtime.json --plan results 예측 기반 운전계획 사용(모델 폴더)
"""
import argparse, os, signal, sys, threading, time, webbrowser


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ifps_ems_rt.hmi", description="이동형 전력체계 EMS 제어화면")
    ap.add_argument("config"); ap.add_argument("--sim", action="store_true", help="가상 장치(Modbus TCP 서버)를 함께 띄운다")
    ap.add_argument("--plan", metavar="모델폴더", help="예측·운전계획 연결(model_load.npz, model_pv.npz 폴더)")
    ap.add_argument("--days", type=int, default=30, help="전개 후 경과 일수(보수 계수)")
    ap.add_argument("--bind"); ap.add_argument("--port", type=int); ap.add_argument("--open", action="store_true", help="기동 후 브라우저 열기")
    a = ap.parse_args(argv)
    from .engine import Engine
    from .server import serve
    try:
        eng = Engine(a.config, sim=a.sim, plan_dir=a.plan, days_since_deploy=a.days)
    except (ValueError, RuntimeError, OSError) as e:
        print(f"[기동 실패] {e}", file=sys.stderr); return 2
    eng.start()
    try:
        httpd = serve(eng, a.bind, a.port)
    except OSError as e:
        print(f"[기동 실패] 웹 서버 포트 사용 불가: {e}", file=sys.stderr); eng.stop(); return 3
    host, port = httpd.server_address[:2]; url = f"http://{'127.0.0.1' if host in ('0.0.0.0', '') else host}:{port}/"
    print("=" * 64)
    print(" IFPS 이동형 전력체계 EMS 제어화면")
    print(f"  모드      : {'가상 장치(SIM)' if a.sim else '실장치 연동'}   운전 방식 {eng.rt.mode}   {eng.cfg.get('run_mode', '개발')}")
    print(f"  제어화면  : {url}")
    print(f"  상태 폴더 : {eng.rt.state_dir}")
    if a.sim: print(f"  가상 장치 : Modbus TCP 127.0.0.1:{eng.sim_ports[0]} (경로 A), :{eng.sim_ports[1]} (경로 B)")
    print("  종료      : Ctrl+C")
    print("=" * 64, flush=True)
    if a.open: threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *x: stop.set())
    if hasattr(signal, "SIGTERM"): signal.signal(signal.SIGTERM, lambda *x: stop.set())
    try:
        while not stop.is_set(): stop.wait(0.5)
    finally:
        print("종료 중 — 마지막 상태 저장", flush=True); httpd.shutdown(); eng.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
