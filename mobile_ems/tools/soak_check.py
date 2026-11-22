# -*- coding: utf-8 -*-
"""통합 점검: 가상 장치를 돌리면서 고장·단선·장비 이동·교체를 차례로(일부는 겹쳐서) 넣고, EMS 의 감시(경보)·대응과 1등급 부하 공급 유지를 본다.

  python -m tools.soak_check        (약 5분. 저장소 폴더에서 실행)

설정은 임시 폴더에 복사해 쓴다(저장소의 설정·상태를 바꾸지 않는다). 줄마다 (상황, 확인 여부, 걸린 초, 새로 뜬 경보(등급), 설명)을 찍고,
끝에 남은 경보 · 주기 초과 횟수 · 오류 기록 · 1등급 부하 공급이 끊긴 순간을 찍는다. 가상 장치에서의 확인이며 실장비 시험을 대신하지 않는다."""
import os, shutil, sys, tempfile, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); os.chdir(sys.path[0])
from ifps_ems_rt.hmi.engine import Engine


def main():
    td = tempfile.mkdtemp(); shutil.copytree("config", td + "/config", ignore=shutil.ignore_patterns("state*", "backup"))
    e = Engine(td + "/config/runtime.json", sim=True)
    e.start(); rt = e.rt; P = e.plant; W = e.ringw; rows = []; crit = []          # crit: 1등급 부하 공급이 끊긴 시각들
    T0 = time.monotonic()

    def act():
        return {a["key"]: a["prio"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}

    def watch(sec, want=None):
        """sec 초 동안 지켜본다. 매 0.5초 1등급 부하 공급(모선 A 전압, CB.L1, 1등급 전력)을 확인. want(): 참이 되면 걸린 시간을 돌려준다."""
        t0 = time.monotonic(); hit = None
        while time.monotonic() - t0 < sec:
            v = rt.val
            if not (v.get("BUS.a_v", 0) > 300 and round(v.get("CB.L1", 1)) == 1 and v.get("LOAD.p1_kw", 0) > 1): crit.append(round(time.monotonic() - T0, 1))
            if want and hit is None and want(): hit = round(time.monotonic() - t0, 1)
            time.sleep(0.5)
        return hit

    def step(name, do, want, sec=14, undo=None, note=""):
        before = set(act()); do(); hit = watch(sec, want); new = {k: p for k, p in act().items() if k not in before}
        rows.append((name, "확인" if hit is not None else "미확인", hit, ", ".join(f"{k}({p})" for k, p in sorted(new.items())) or "-", note))
        print(rows[-1], flush=True)
        if undo: undo(); watch(8)

    def sim(q): e.sim_action(q, "점검")
    def now_ctl():
        with e.lock: rt.t_ctl = -1e9

    watch(10); crit.clear(); print("시작 상태", {k: round(rt.val.get(k, -1), 1) for k in ("LOAD.kw", "PV.kw", "ESS.soc", "BUS.a_v")}, act(), flush=True)
    # 1) 환망 구간 단선 → 구간 차단 → 반대쪽 공급
    step("환망 구간 2 단선", lambda: W.sim({"action": "break", "section": 2}), lambda: W.status()["cut"] == [2] and W.status()["switched"] and W.status()["ok"], 16, note="구간 차단 뒤 상시 개방점 투입, 전 마디 공급")
    # 2) 단선이 남은 채로 둘째 단선(겹친 고장) → 고립 마디 경보
    step("겹친 단선(구간 3 추가)", lambda: W.sim({"action": "break", "section": 3}), lambda: W.status()["isolated"] == ["FSU3"] and "ring.dead.FSU3" in act(), 14, lambda: W.sim({"action": "restore"}), "두 구간 사이 마디만 정전, 나머지 공급")
    # 3) 장비 이동(배치 뒤섞기) → 조작 없이 다시 인식, 경보 없음
    order = [x["id_read"] for x in W.status()["fsu"]]
    step("장비 이동(구간분전함 순서 뒤바꿈)", lambda: W.sim({"action": "shuffle"}), lambda: [x["id_read"] for x in W.status()["fsu"]] == order[::-1] and W.status()["ok"] and not [k for k in act() if k.startswith("ring.")], 12, note="이름·회로 구성이 ID 를 따라감")
    # 4) 장비 교체(배전체계 한 대를 빼고 새 ID 의 장치를 놓음)
    def swap_unit(): W.sim({"action": "remove", "id": "PPDU2"}); time.sleep(3); W.sim({"action": "add", "kind": "ppdu", "at": 4})
    step("장비 교체(배전체계 PPDU 한 대 → 새 장치)", swap_unit, lambda: len(W.status()["ppdu"]) == 3 and len(W.status()["recog"]["new"]) == 1 and not [k for k in act() if k.startswith("ring.")], 14, lambda: W.sim({"action": "restore"}), "새 ID 를 바로 인식")
    # 5) 배전체계 1등급 회로 트립
    step("배전체계 1등급 회로 트립", lambda: W.sim({"action": "ppdu", "id": "PPDU1", "what": "ch3", "value": 2}), lambda: act().get("ring.ch.PPDU1.3") == 1, 10, lambda: W.sim({"action": "ppdu", "id": "PPDU1", "what": "ch3", "value": 1}))
    # 6) 3등급 급전선 과전류 트립
    step("3등급 급전선 과전류 트립(51)", lambda: sim({"action": "fault", "target": "L3", "code": 51}), lambda: any("L3" in k for k in act()), 10, lambda: sim({"action": "cb", "target": "L3", "on": True}), "1·2등급은 계속 공급")
    # 7) ESS 통신 두절
    step("ESS 통신 두절", lambda: sim({"action": "mute", "target": "ESS", "on": True}), lambda: act().get("link.ESS") == 1, 10, lambda: sim({"action": "mute", "target": "ESS", "on": False}), "지령 차단, 직전 값 유지")
    # 8) 통신 경로 A 단절(이중 경로)
    step("통신 경로 A 단절", lambda: sim({"action": "down", "target": "A", "on": True}), lambda: any(k.startswith("deg.") for k in act()) and not any(k.startswith("link.") for k in act()), 10, lambda: sim({"action": "down", "target": "A", "on": False}), "경로 B 로 제어 유지")
    # 9) 충전율 저하 + 디젤 지령 무시(겹침) → 연료전지 대체 기동
    def low_and_noack(): sim({"action": "noack", "target": "DG", "on": True}); sim({"action": "set", "tag": "ESS.soc", "value": 21.0, "hold": False}); now_ctl()
    fc_was = P.get("FC.status") > 0.5
    step("충전율 저하 + 디젤 기동 무응답", low_and_noack, lambda: P.get("FC.status") > 0.5 and (not fc_was or any("대체 전원" in x["text"] for x in rt.events[-120:])), 45, lambda: sim({"action": "noack", "target": "DG", "on": False}),
         "연료전지가 이미 운전 중이라 대체 기동은 이번에 볼 수 없음(충전율 낮음 경보만 확인)" if fc_was else "디젤 실패 → 연료전지 대체")
    # 10) 같은 종류 장치 추가(디젤 한 대 더)
    step("장비 추가(디젤 DG2)", lambda: sim({"action": "unit", "target": "DG2", "on": True}), lambda: e.snapshot()["fleet"]["DG"]["n"] == 2, 20, note="조작 없이 2대로 인식")
    # 11) 쓰던 장치 고장(DG2 통신 두절) + 부하 급증
    def dg2_gone(): sim({"action": "unit", "target": "DG2", "on": False}); sim({"action": "scenario", "name": "load_surge"})
    step("DG2 고장(두절) + 부하 급증 +60 kW", dg2_gone, lambda: act().get("link.DG2") == 1 and e.snapshot()["fleet"]["DG"]["n"] == 1, 14, note="남은 장치로 계속 운전")
    # 12) 디젤 차동 보호 트립(87)
    step("디젤 급전선 차동(87) 트립", lambda: sim({"action": "fault", "target": "DG", "code": 87}), lambda: any("DG" in k and k.startswith(("cb.", "flt.", "trip.", "fault.")) or "CB-DG" in k for k in act()) or round(rt.val.get("CB.DG", 1)) == 2, 10, lambda: sim({"action": "cb", "target": "DG", "on": True}))
    # 13) 모두 정상으로
    sim({"action": "scenario", "name": "normal"}); W.sim({"action": "restore"}); watch(15)
    s = e.snapshot(); left = {k: p for k, p in act().items()}
    print("\n남은 경보", left); print("주기", s["stats"]["n_scan"], "회 | 초과", s["stats"]["n_over"], "| 최대", s["stats"]["max_ms"], "ms | 평균", s["stats"]["avg_ms"], "ms")
    print("오류 기록", [x["text"] for x in rt.events if x["kind"] == "오류"][:5]); print("가상 장치 오류", e.simdrv.err or "없음")
    print("1등급 부하 공급이 끊긴 순간", len(crit), crit[:10]); print("끝 상태", {k: round(rt.val.get(k, -1), 1) for k in ("LOAD.kw", "LOAD.p1_kw", "ESS.soc", "BUS.a_v", "BUS.b_v")})
    e.stop(); shutil.rmtree(td, ignore_errors=True)
    return 0 if not crit and all(r[1] == "확인" for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
