# -*- coding: utf-8 -*-
"""주기마다의 경보 판정: 통신 · 품질 · 차단기 · 운용 · 사건.Engine(hmi/engine.py)의 한 부분이다 — 기능별로 파일을 나눈 것이며 메서드는 Engine 의 것으로 쓴다.
"""
import time
from ifps_ems.config import SUP
from .. import fleet
from . import fuelwatch, autodev
from .engdefs import FEEDERS, FEEDER_TXT, ANSI


class AlarmsMixin:
    """Engine 에 섞어 쓰는 묶음(자체 상태는 없다 — self 는 Engine 이다)."""

    def _post_scan(self):
        k = self.kpi(); self._integrate(k); self.archw.step(self, k); self.ringw.step(self)
        self.trend.append([round(time.time() * 1000), round(k["load"], 2), round(k["pv"], 2), round(k["dg"], 2), round(k["fc"], 2), round(k["ess"], 2),
                           round(k["soc"], 2), round(k["h2"], 1), round(k["reserve_margin"], 1)])
        self._alarms_comm(); self._alarms_process(k); self._alarms_grid(); self._alarms_ops(); self._alarms_events(); autodev.cycle(self)

    def _alarms_comm(self):
        """통신·품질 경보."""
        rt = self.rt; A = self.alarms
        for n, st in rt.lm.state.items():
            autodev.link_alarm(self, n, st)
            dead = [p for p, a in rt.links[n].alive.items() if not a]
            A.set(f"deg.{n}", st == "경로 저하", 3, n, f"{n} 통신 경로 저하 — 경로 {','.join(dead) or '?'} 무응답")
            A.set(f"hb.{n}", rt.hb_stop.get(n, False) and st != "두절", 1, n, f"{n} 생존 계수(hb) {SUP['stale_s']:.0f}초 이상 정지 — 장치 제어기 이상, 지령 차단")
        for tag, f in rt.flag.items():
            dev = tag.split(".")[0]
            A.set(f"q5.{tag}", f == 5, 3, dev, f"{tag} 측정값 범위 밖 — 직전 유효값 유지")
            src = self._tag_dev.get(tag, dev)                                 # 그 점을 읽어 오는 장치(예: PV.kw 는 계측 게이트웨이)
            lost = rt.lm.state.get(src) in ("두절", "재조회 대기")           # 장치 두절이면 '통신 두절' 경보 하나로 충분하다(점마다 올리지 않는다)
            A.set(f"q3.{tag}", f == 3 and not lost, 3, dev, f"{tag} 값 갱신 지연(>{SUP['stale_s']:.0f}초)")
        A.set("ai.degraded", rt.ai_degraded, 3, "TPCS", "예측 정확도 저하 — 계획 운전을 쉬고 규칙 운전 중(자료가 쌓이면 다시 학습)")
        A.set("audit", bool(rt.audit_err), 2, "TPCS", f"감사 기록 쓰기 실패 — 저장 공간·권한 확인 ({rt.audit_err})")
        bad = [i["text"] for i in self.busw.view()["issues"] if i["level"] == "bad"]
        A.set("bus.plan", bool(bad), 3, "TPCS", "모선 구성 점검 필요 — " + (bad[0] if bad else ""))
        A.set("hist", bool(rt.hist_err), 2, "TPCS", f"운전 이력 쓰기 실패 — 저장 공간·권한 확인 ({rt.hist_err})")
        for n, lk in rt.links.items():
            A.set(f"part.{n}", bool(lk.miss) and rt.lm.state[n] != "두절", 3, n, f"{n} 일부 신호를 읽지 못함 — 장치가 '없는 주소'로 답함: {', '.join(lk.miss[:6])}{' …' if len(lk.miss) > 6 else ''}")

    def _alarms_process(self, k):
        """공정 경보: 충전율·수소·연료·예비력·운전 모드."""
        rt = self.rt; v = rt.val; g = lambda k, d=0.0: v.get(k, d); s = rt.site; A = self.alarms
        soc = g("ESS.soc", 60.0)
        A.set("soc.ll", soc < s.soc_min * 100 + 4, 1, "ESS", f"ESS 충전율 매우 낮음 {soc:.1f}% — 디젤 강제 기동 영역")
        A.set("soc.lo", s.soc_min * 100 + 4 <= soc < 25, 2, "ESS", f"ESS 충전율 낮음 {soc:.1f}%")
        A.set("soc.hi", soc > s.soc_max * 100 - 1, 4, "ESS", f"ESS 충전율 상한 근접 {soc:.1f}% — PV 출력 제한 가능")
        A.set("soc.blind", rt.soc_blind(), 1, "ESS", "ESS 충전율을 읽지 못함(통신 두절 · 값 이상) — 자립 운전 중이면 안전 쪽으로 발전기를 돌림. ESS 통신과 표시창의 충전율을 확인")
        A.set("grid.blind", rt.grid_blind(), 1, "GRID", "수전 차단기 상태를 읽지 못함(계측 두절) — 상전 판정을 직전 그대로 두고 발전기 자동 기동 · 정지를 보류. ESS 가 설정값보다 많이 내보내는 상태가 이어지거나 충전율이 낮아지면 정전으로 보고 자립 운전 논리로 기동. 현장에서 상전 상태를 확인")
        h2 = g("H2.nm3", s.h2_nm3)
        A.set("h2.lo", h2 < s.h2_nm3 * s.h2_min * 1.5, 2, "FC", f"수소 잔량 낮음 {h2:.0f}Nm³")
        fuelwatch.alarms(self)
        A.set("reserve", k["reserve_need"], 3, "TPCS", f"N-1 순동 예비력 부족 {k['reserve_margin']:.0f}kW — 연료전지 병렬 필요")
        for n, d in rt.dev.items():
            A.set(f"man.{n}", d.manual, 4, n, f"{n} 현장 수동 모드 — TPCS 지령 차단")
        A.set("auto.off", not self.auto, 4, "TPCS", "자동 제어 해제 — 운용자 수동 지령 운전")

    def _alarms_unit_cb(self, v):
        """장비 한 대마다의 차단기 경보: 추가 자리 장비(CB.DG2 …)와 추가 복합전력 차량의 ESS(CB.G1_2 …) — 인식한 장치만(빈 자리의 신호로 경보를 내지 않는다)."""
        A = self.alarms
        for n in sorted(self.rt.seen):                                             # 추가 자리 장비의 차단기(CB.DG2 …)와 추가 복합전력 차량의 ESS 차단기(CB.G1_2 …) — 인식한 장치만
            for f in ([n] if fleet.is_slot(n) else []) + ([fleet.g1_cb(n)] if fleet.is_slot(n) and fleet.kind(n) == "DG" else []):
                c = v.get(f"CB.{f}")
                if c is None: continue
                code = int(round(v.get(f"FLT.{f}", 0)))
                A.set(f"cb.trip.{f}", c > 1.5, 2, f"CB-{f}", f"CB-{f} 차단기 트립 — {ANSI.get(code, f'보호요소 {code}')}"); A.set(f"cb.open.{f}", c < 0.5, 4, f"CB-{f}", f"CB-{f} 차단기 개방")

    def _alarms_grid(self):
        """차단기·모선 경보(보호 IED 게이트웨이)."""
        v = self.rt.val; A = self.alarms
        for f in FEEDERS:
            c = v.get(f"CB.{f}")
            if c is None: continue
            code = int(round(v.get(f"FLT.{f}", 0)))
            A.set(f"cb.trip.{f}", c > 1.5, 1 if f in ("L1", "DG", "ESS", "G1", "TIE") else 2, f"CB-{f}", f"CB-{f} {FEEDER_TXT[f]} 차단기 트립 — {ANSI.get(code, f'보호요소 {code}')}")
            A.set(f"cb.open.{f}", c < 0.5, 3 if f == "TIE" else 4, f"CB-{f}", f"CB-{f} {FEEDER_TXT[f]} 차단기 개방")
        self._alarms_unit_cb(v)
        rt = self.rt; gc = v.get("CB.GRID")                                    # 주둔지: 수전 차단기·정전
        if gc is not None:
            code = int(round(v.get("FLT.GRID", 0))); grid = rt.mode == "grid"
            A.set("grid.trip", grid and gc > 1.5, 1, "CB-GRID", f"수전 차단기 트립 — {ANSI.get(code, f'보호요소 {code}')}")
            A.set("grid.out", grid and rt.grid_lost, 1, "GRID", "상전 정전 — 자립 운전으로 전환(무정전: ESS 계통 형성). " + ("주둔지 발전기 자동 투입" if rt.gdgs else "디젤·연료전지 자동 투입"))
            A.set("grid.wartime", grid and rt.posture == "자립" and rt.tied(), 2, "GRID", "자립 태세(상전 상실 대비)인데 수전 차단기가 투입 상태 — 상전 분리를 확인하십시오. 분리 전까지는 수전을 최소로 묶고 운전합니다(주둔지 발전기는 상전과 병렬 운전하지 않음)")
        for n in rt.gdgs:                                                       # 주둔지 기존 발전기 차단기
            c = v.get(f"CB.{n}")
            if c is not None: code = int(round(v.get(f"FLT.{n}", 0))); A.set(f"cb.trip.{n}", c > 1.5, 1, f"CB-{n}", f"주둔지 발전기 차단기 트립 — {ANSI.get(code, f'보호요소 {code}')}")
        if "BUS.a_v" in v:
            A.set("bus.a", v["BUS.a_v"] < 300, 1, "BUS-A", "모선 A 무전압(정전)"); A.set("bus.b", v.get("BUS.b_v", 440) < 300, 1, "BUS-B", "모선 B 무전압(정전)")

    def _alarms_ops(self):
        """군 운용 경보: 자동 부하 차단, 저소음 태세 자원 고갈, 자립 목표 미달."""
        rt = self.rt; A = self.alarms; s = rt.site; soc = rt.val.get("ESS.soc", 60.0) / 100; h = rt.auto_h or {}
        for f, nm in (("L3", "3등급"), ("L2", "2등급")):
            A.set(f"shed.{f}", f in rt.shedder.mine, 2 if f == "L2" else 3, "TPCS", f"{nm} 부하 자동 차단 중 — {rt.shedder.why.get(f, '')}")
            A.set(f"save.{f}", f in rt.shedder.saved, 3, "TPCS", f"{nm} 부하 절감 공급 중 — {rt.shedder.why.get(f, '')}. 모자람이 이어지면 차단으로 넘어간다")
        A.set("quiet.low", rt.posture == "저소음" and soc < s.soc_min + 0.06, 1, "TPCS", f"저소음 태세: ESS {soc * 100:.0f}% — 자원 고갈 임박. 디젤을 쓰려면 운용 태세를 바꾸십시오")
        tgt = max(0.0, rt.auto_target_h - (rt.now() - rt.t_posture) / 3600.0)
        A.set("auto.short", rt.posture == "자립" and bool(h) and h.get("p1", 999) < tgt, 1, "TPCS", f"자립 태세: 1등급 부하만으로도 {h.get('p1', 0):.0f}시간 — 남은 목표 {tgt:.0f}시간 미달, 보급 필요")

    def _alarms_events(self):
        """사건(지령 실패·차단, 주기 초과, 내부 오류)을 경보로 옮긴다."""
        rt = self.rt; A = self.alarms
        if rt.lm.state.get("FC") != "정상" or rt.hb_stop.get("FC"): self.fc_set_written = None      # 통신 복구·제어기 재기동 뒤에는 설정값을 다시 쓴다
        evs = [e for e in list(rt.events) if e["id"] > self._ev_i]             # 번호 기준: 다른 스레드가 덧붙이거나 앞부분을 잘라도 빠뜨리지 않는다
        for e in evs:
            t = e["text"]
            if e["kind"] == "지령" and ("무응답" in t or "실패" in t or "미변화" in t): A.event(2, t.split()[0], t)
            elif e["kind"] == "지령" and "차단" in t: A.event(3, t.split()[0], t)
            elif e["kind"] == "주기": A.event(4, "TPCS", t)
            elif e["kind"] == "오류": A.event(2, "TPCS", t)
        if evs: self._ev_i = evs[-1]["id"]
