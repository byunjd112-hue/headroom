# -*- coding: utf-8 -*-
"""군 운용 논리 시험: 주둔지(상전 연계·역송 없음·피크 억제·정전 자립 전환), 운용 태세(저소음·자립), 부하 자동 차단·복구, 자립 지속시간."""
from dataclasses import replace
import datetime as dtm, os, sys, time, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
from ifps_ems.config import Site
from ifps_ems_rt import opsmode as om
from test_rt import Base


class TestOpsLogic(unittest.TestCase):
    def setUp(self):
        self.s = Site(dg_kw=90.0, elz_kw=150.0, h2_min=0.30); self.g = om.Garrison()

    def test_garrison_never_exports_and_shaves_peak(self):
        s, g = self.s, self.g
        for hr in (3, 9.5, 11, 14, 20):
            for load in (40, 120, 260):
                for pv in (0, 150, 380):
                    for soc in (0.2, 0.5, 0.7, 0.9):
                        r = om.garrison_step(s, g, hr, load, pv, 0.0, soc, 500.0)
                        grid = load - (min(pv, r["pv_lim"]) if r["pv_lim"] else pv) - r["ess"] + (0 if not r["elz"] else 0)
                        if not r["elz"]: self.assertGreaterEqual(grid, g.import_min_kw - 0.2, (hr, load, pv, soc, r))          # 역송 없음(수전해 기동 예정이면 다음 주기에 해소)
                        if soc <= g.reserve_soc: self.assertLessEqual(r["ess"], 0.01, (hr, load, pv, soc, r))                  # 정전 대비 하한 아래로는 방전하지 않는다
        r = om.garrison_step(s, g, 14, 120, 0, 0, 0.8, 500); self.assertEqual(r["band"], "peak"); self.assertAlmostEqual(r["grid"], 5.0, places=1); self.assertGreater(r["ess"], 100)   # 최대부하 시간대 방전
        r = om.garrison_step(s, g, 3, 40, 0, 0, 0.5, 500); self.assertEqual(r["band"], "off"); self.assertLess(r["ess"], -100); self.assertLessEqual(r["grid"], g.peak_kw + 0.1)        # 경부하 충전(피크 한도 안)
        r = om.garrison_step(s, g, 20, 260, 0, 0, 0.8, 500); self.assertAlmostEqual(r["grid"], g.peak_kw, places=1); self.assertIn("피크 억제", r["why"])                             # 피크 억제
        r = om.garrison_step(s, g, 12.5, 40, 380, 0, 0.9, 500); self.assertTrue(r["elz"])                                                                                          # 남는 전력 → 수전해
        r = om.garrison_step(s, g, 12.5, 40, 380, 0, 0.9, 990); self.assertFalse(r["elz"]); self.assertAlmostEqual(r["pv_lim"], 35.0, places=0)                                    # 수소 가득 → PV 제한
        r = om.garrison_step(s, g, 20, 60, 0, 150, 0.7, 500); self.assertFalse(r["elz"])                                                                             # 상전으로 수소를 만들지 않는다
        self.assertEqual(g.band(23.5), "off"); self.assertEqual(g.band(12.5), "mid"); self.assertEqual(om.Garrison.from_cfg({"peak_kw": 99, "x": 1}).peak_kw, 99)

    def test_garrison_generator_start_stop_and_min_load(self):
        s, g = self.s, self.g
        r = om.gdg_step(s, g, 5, 0.6, False, 60); self.assertFalse(r["run"]); self.assertEqual(r["ess"], 0.0)                 # 짧은 정전: ESS 로만 버틴다
        r = om.gdg_step(s, g, 31, 0.6, False, 60); self.assertTrue(r["run"]); self.assertIn("정전 지속", r["why"])             # 30초 넘으면 기동
        self.assertAlmostEqual(r["gdg"], 300.0, places=0); self.assertAlmostEqual(r["ess"], -240.0, places=0)                # 최소 부하율 30% = 300kW, 나머지는 ESS 충전
        self.assertFalse(om.gdg_step(s, g, 600, 0.80, False, 60)["run"])                                                    # ESS 가 충분하면 기다린다
        self.assertTrue(om.gdg_step(s, g, 5, 0.30, False, 60)["run"])                                                       # 충전율이 낮으면 지체 없이
        self.assertTrue(om.gdg_step(s, g, 5, 0.6, False, 700)["run"])                                                       # ESS 로 감당 못 할 부하
        self.assertTrue(om.gdg_step(s, g, 600, 0.70, True, 60)["run"]); self.assertFalse(om.gdg_step(s, g, 600, 0.86, True, 60)["run"])   # 충전 완료 → 정지
        r = om.gdg_step(s, g, 600, 0.5, True, 1300); self.assertAlmostEqual(r["gdg"], 1000.0, places=0); self.assertAlmostEqual(r["ess"], 300.0, places=0)   # 정격 초과분은 ESS 방전
        r = om.gdg_step(s, g, 600, 0.899, True, 60); self.assertFalse(r["run"])
        r = om.gdg_step(s, g, 600, 0.6, False, -50); self.assertFalse(r["run"]); self.assertIn("태양광", r["why"])           # 태양광이 부하를 감당하면 정전이 길어도 대기
        self.assertTrue(om.gdg_step(s, g, 600, 0.30, False, -50)["run"])                                                    # 단, 충전율이 낮으면 기동
        r = om.gdg_step(s, g, 600, 0.6, True, -50); self.assertFalse(r["run"]); self.assertIn("태양광", r["why"])            # 운전 중 태양광이 충분해지면 정지
        r = om.gdg_step(s, g, 600, 0.6, True, -50, hold=True); self.assertTrue(r["run"]); self.assertIn("최소 운전", r["why"])   # 최소 운전 시간 안에는 유지
        self.assertTrue(om.gdg_step(s, g, 600, 0.40, True, -50)["run"])                                                     # 충전율이 낮으면 태양광이 있어도 계속

    def test_garrison_uses_mobile_pv_tied_and_in_outage(self):
        """주둔지에서도 이동형 태양광을 그대로 쓴다: 상전 연계 중에는 수전을 줄이고, 정전 중에는 발전기·ESS 부담을 줄인다."""
        s, g = self.s, self.g
        a = om.garrison_step(s, g, 9.5, 120, 0, 0, 0.6, 500); b = om.garrison_step(s, g, 9.5, 120, 80, 0, 0.6, 500)        # 중간부하 시간대, 태양광 0 / 80 kW
        self.assertAlmostEqual(a["grid"] - b["grid"], 80.0, places=0); self.assertEqual(b["pv_lim"], 0.0)                  # 태양광만큼 수전 감소, 출력 제한 없음
        c = om.garrison_step(s, g, 9.5, 60, 300, 0, 0.6, 500); self.assertEqual(c["pv_lim"], 0.0); self.assertLess(c["ess"], -200); self.assertIn("남는 태양광", c["why"])
        c = om.garrison_step(s, g, 14.0, 60, 300, 0, 0.6, 500); self.assertLess(c["ess"], -200); self.assertNotIn("방전", c["why"])             # 최대부하 시간대라도 남으면 충전(사유도 그렇게 표시)   # 남는 태양광은 먼저 ESS 충전
        self.assertFalse(om.gdg_step(s, g, 600, 0.80, False, 60 - 200)["run"])                                             # 정전 중 태양광이 부하보다 크면 발전기 대기
        n = om.gdg_step(s, g, 600, 0.5, True, 700 - 300); d = om.gdg_step(s, g, 600, 0.5, True, 700)
        self.assertAlmostEqual(d["gdg"] - n["gdg"], 300.0, places=0)                                                       # 발전기 부하가 태양광만큼 줄어든다

    def test_garrison_self_supply_holds_import_at_minimum(self):
        """주둔지 자립 태세: 상전이 붙어 있어도 쓰지 않는다(수전 = 최소 수전), 상전으로 ESS 를 채우지 않는다."""
        s, g = self.s, self.g
        for hr in (3, 9.5, 11, 14, 20):
            for load in (40, 120, 260):
                for pv in (0, 150, 380):
                    r = om.garrison_step(s, replace(g, self_supply=True), hr, load, pv, 0, 0.6, 500)
                    self.assertAlmostEqual(r["grid"], g.import_min_kw, places=1, msg=(hr, load, pv)); self.assertEqual(r["short"], 0.0)
                    if load > pv + g.import_min_kw: self.assertGreater(r["ess"], 0); self.assertIn("자립 태세", r["why"])           # 모자라는 만큼 ESS 방전(시간대와 무관)
        n = om.garrison_step(s, g, 3, 120, 0, 0, 0.6, 500); self.assertLess(n["ess"], 0); self.assertGreater(n["grid"], 100)          # 평소 경부하 시간대: 상전으로 충전
        r = om.garrison_step(s, replace(g, self_supply=True), 14, 120, 0, 0, 0.40, 500); self.assertGreater(r["ess"], 100)                     # 정전 대비 하한(50%) 아래로도 방전(자립 태세)
        r = om.garrison_step(s, replace(g, self_supply=True), 14, 120, 0, 0, s.soc_min + 0.05, 500)                                            # ESS 가 바닥이면 상전을 쓰고 알린다
        self.assertAlmostEqual(r["short"], 115.0, delta=1.0); self.assertIn("자체 전원 부족", r["why"]); self.assertAlmostEqual(r["grid"], 120.0, delta=1.0)
        r = om.garrison_step(s, replace(g, self_supply=True), 14, 700, 0, 0, 0.6, 500); self.assertAlmostEqual(r["ess"], 500.0, delta=1.0); self.assertAlmostEqual(r["short"], 195.0, delta=1.0)   # PCS 정격 초과분

    def test_autonomy_hours(self):
        a = om.autonomy(self.s, 0.9, 1000, 1500, (30, 40, 50))
        self.assertEqual(a["ess_kwh"], 712); self.assertEqual(a["h2_kwh"], 933); self.assertEqual(a["dg_kwh"], 5357)
        self.assertAlmostEqual(a["full"], (712.5 + 933.3 + 5357.1) / 120, places=0); self.assertGreater(a["shed3"], a["full"]); self.assertGreater(a["p1"], a["shed3"])
        q = om.autonomy(self.s, 0.9, 1000, 1500, (30, 40, 50), quiet=True); self.assertEqual(q["dg_kwh"], 0); self.assertLess(q["full"], a["full"])           # 저소음: 디젤 연료 제외
        self.assertEqual(om.autonomy(self.s, 0.9, 1000, 1500, (30, 40, 50), pv_kwh_day=24 * 200)["full"], 999.0)                                               # 태양광이 부하보다 크면 무기한

    def test_staged_reduction_then_shed(self):
        """공급 능력 부족: 절감 공급을 먼저 하고, 그래도 모자라면 차단한다. 절감으로 풀리면 끊지 않는다. 태세 · 충전율 사유는 바로 끊는다."""
        s = self.s; W = om.LoadShedder.want; cb = {"L2": 1, "L3": 1}; fr = {"L3": 0.3, "L2": 0.2}; kw = {"L3": 50.0, "L2": 40.0}
        w = W(s, "평시", 0.8, 100, 70, 120); self.assertEqual(w["_soft"], {"L3"}); self.assertFalse(w["L2"])
        sh = om.LoadShedder(); self.assertEqual(sh.step(0, w, cb, 0.8, s.soc_min, kw, fr), []); a = sh.step(3, w, cb, 0.8, s.soc_min, kw, fr)
        self.assertEqual([(f, x) for f, x, _ in a], [("L3", "save")]); self.assertEqual(sh.saved, {"L3"}); self.assertAlmostEqual(sh.held["L3"], 15.0)
        self.assertEqual(sh.step(8, w, cb, 0.8, s.soc_min, kw, fr), [])                                       # 절감의 효과를 10초 지켜본다
        a = sh.step(13.1, w, cb, 0.8, s.soc_min, {"L3": 35.0, "L2": 40.0}, fr); self.assertEqual([(f, x) for f, x, _ in a], [("L3", "shed")])      # 그래도 모자라면 차단
        self.assertEqual(sh.mine, {"L3"}); self.assertEqual(sh.saved, set()); self.assertAlmostEqual(sh.held["L3"], 50.0)                    # 되살리면 돌아올 부하 = 절감 전 크기
        sh = om.LoadShedder(); sh.step(0, w, cb, 0.8, s.soc_min, kw, fr); sh.step(3, w, cb, 0.8, s.soc_min, kw, fr)
        ok = W(s, "평시", 0.8, 100, 70, 98); self.assertFalse(ok["L3"]); ok["_keep"] = {"L3"}                # 절감으로 풀렸다. 되살리면 다시 모자란다 → 그대로 둔다
        for t in (20, 60, 200): self.assertEqual(sh.step(t, ok, cb, 0.8, s.soc_min, kw, fr), [])
        self.assertEqual(sh.saved, {"L3"}); ok["_keep"] = set(); self.assertEqual(sh.step(210, ok, cb, 0.8, s.soc_min, kw, fr), [])
        a = sh.step(271, ok, cb, 0.8, s.soc_min, kw, fr); self.assertEqual([(f, x) for f, x, _ in a], [("L3", "restore")]); sh.restored("L3"); self.assertEqual((sh.saved, sh.held), (set(), {}))
        sh = om.LoadShedder(); q = W(s, "저소음", 0.8, 700, 60, 100); self.assertEqual(q["_soft"], set()); sh.step(0, q, cb, 0.8, s.soc_min, kw, fr)
        self.assertEqual([(f, x) for f, x, _ in sh.step(3, q, cb, 0.8, s.soc_min, kw, fr)], [("L3", "shed")])  # 태세 사유는 절감을 거치지 않는다
        sh = om.LoadShedder(); sh.step(0, w, cb, 0.8, s.soc_min, kw, {"L3": 0.0}); self.assertEqual([(f, x) for f, x, _ in sh.step(3, w, cb, 0.8, s.soc_min, kw, {"L3": 0.0})], [("L3", "shed")])   # 줄일 몫이 없으면 바로 차단
        both = W(s, "평시", 0.8, 60, 70, 120); self.assertEqual(both["_soft"], {"L2", "L3"}); sh = om.LoadShedder(); sh.step(0, both, cb, 0.8, s.soc_min, kw, fr)
        self.assertEqual([(f, x) for f, x, _ in sh.step(3, both, cb, 0.8, s.soc_min, kw, fr)], [("L3", "save"), ("L2", "save")])                 # 3등급 먼저
        self.assertEqual([(f, x) for f, x, _ in sh.step(14, both, cb, 0.8, s.soc_min, kw, fr)], [("L3", "shed"), ("L2", "shed")])

    def test_shedder_order_hold_and_restore(self):
        sh = om.LoadShedder(hold_s=3, restore_s=60); s = self.s; cb = {"L2": 1, "L3": 1}
        w = om.LoadShedder.want(s, "평시", 0.20, 700, 60, 100); self.assertTrue(w["L3"]); self.assertFalse(w["L2"])
        self.assertEqual(sh.step(0, w, cb, 0.20, s.soc_min), []); self.assertEqual(sh.step(2, w, cb, 0.20, s.soc_min), [])                                   # 3초 유지 전에는 끊지 않는다
        self.assertEqual([a[:2] for a in sh.step(3.1, w, cb, 0.20, s.soc_min)], [("L3", "shed")]); cb["L3"] = 0
        w2 = om.LoadShedder.want(s, "평시", 0.17, 700, 60, 60); self.assertTrue(w2["L2"]); sh.step(10, w2, cb, 0.17, s.soc_min)
        self.assertEqual([a[:2] for a in sh.step(13.5, w2, cb, 0.17, s.soc_min)], [("L2", "shed")]); cb["L2"] = 0
        ok = {"L3": "", "L2": ""}; self.assertEqual(sh.step(20, ok, cb, 0.40, s.soc_min), []); self.assertEqual(sh.step(70, ok, cb, 0.40, s.soc_min), [])
        self.assertEqual([a[:2] for a in sh.step(81, ok, cb, 0.40, s.soc_min)], [("L2", "restore")]); cb["L2"] = 1                                           # 2등급부터 복구
        acts = sh.step(82, ok, cb, 0.40, s.soc_min) + sh.step(145, ok, cb, 0.40, s.soc_min); self.assertIn(("L3", "restore"), [a[:2] for a in acts])
        self.assertTrue(om.LoadShedder.want(s, "저소음", 0.8, 700, 60, 100)["L3"]); self.assertTrue(om.LoadShedder.want(s, "평시", 0.8, 50, 60, 100)["L2"])    # 공급 능력 부족
        w3 = om.LoadShedder.want(s, "자립", 0.8, 700, 60, 100, {"full": 40, "shed3": 30, "p1": 90}, 72); self.assertTrue(w3["L3"] and w3["L2"])


class TestOpsRuntime(Base):
    def loop(self, n, clk, dt=1.0):
        for _ in range(n): clk[0] += dt; time.sleep(0.07); self.rt.scan(); self.rt.fast_control()

    def test_garrison_peak_discharge_no_export_outage_and_restore(self):
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.rt.wall = lambda: dtm.datetime(2026, 11, 16, 14, 0)            # 최대부하 시간대
        self.plant.set("ESS.soc", 80.0); self.plant.set("CB.GRID", 1); self.rt.scan(); self.rt.set_ops(mode="grid", who="시험")
        self.loop(4, clk); self.assertTrue(self.rt.tied()); self.assertAlmostEqual(self.plant.get("GRID.kw"), 5.0, delta=1.5); self.assertGreater(self.plant.get("ESS.kw"), 20)
        d = self.rt.decide(); self.assertFalse(d["DG"] or d["FC"]); self.assertTrue(d.get("_garrison"))
        self.plant.set("PV.kw", 380.0); self.plant.set("LOAD.kw", 40.0); self.plant.set("ESS.soc", 89.9); self.plant.set("H2.nm3", 990.0); self.loop(4, clk)   # 남는 전력, 받을 곳 없음 → PV 제한
        self.assertGreater(self.plant.get("PV.lim_set"), 1.0); self.assertEqual(int(self.plant.get("CB.GRID")), 1)
        self.plant.set("PV.kw", 40.0); self.plant.set("LOAD.kw", 80.0); self.plant.set("CB.GRID", 0); self.plant.set("FLT.GRID", 27); self.loop(2, clk)         # 정전
        self.assertFalse(self.rt.tied()); self.assertTrue(self.rt.grid_lost); self.assertTrue(any("상전 정전" in e["text"] for e in self.rt.events)); self.assertNotIn("_garrison", self.rt.decide())
        self.assertEqual(self.plant.get("ESS.kw_set"), 0.0)
        self.plant.set("CB.GRID", 1); self.loop(3, clk); self.assertFalse(self.rt.tied())                                                                      # 복전 직후에는 안정 시간을 기다린다
        self.loop(4, clk, dt=10.0); self.assertTrue(self.rt.tied()); self.assertTrue(any("복전" in e["text"] for e in self.rt.events))

    def test_garrison_outage_uses_existing_generator_with_ess_and_pv(self):
        """주둔지 정전: ESS 가 먼저 버티고, 30초 뒤 기존 디젤발전기를 기동해 ESS·태양광과 함께 운전. 복전하면 발전기를 세운다."""
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.rt.wall = lambda: dtm.datetime(2026, 11, 16, 20, 0); self.plant.slow["GDG"] = 0.3
        self.plant.set("ESS.soc", 60.0); self.plant.set("CB.GRID", 1); self.rt.scan(); self.rt.set_ops(mode="grid", who="시험"); self.loop(3, clk)
        self.rt.gar.gdg_min_run_s = 0.0
        self.assertTrue(self.rt.tied()); self.assertFalse(self.rt.decide()["GDG"]); self.assertEqual(self.rt.gdgs, ["GDG"])
        self.plant.set("CB.GRID", 0); self.loop(3, clk); d = self.rt.decide(); self.assertFalse(d["GDG"]); self.assertIn("대기", self.rt.gdg_last["why"])        # 정전 직후: 발전기 대기
        self.assertAlmostEqual(self.plant.get("ESS.kw"), self.plant.get("LOAD.kw") - self.plant.get("PV.kw"), delta=2.0)                                       # ESS 가 부하를 받는다
        self.loop(4, clk, dt=10.0); d = self.rt.decide(); self.assertTrue(d["GDG"]); self.assertFalse(d["DG"]); self.assertTrue(d["_gdg"])                      # 30초 경과: 기동 판단, 이동형 디젤은 쉼
        done = self.rt.control(force=True); self.assertIn(("GDG", True, True), [x[:3] for x in done]); self.loop(4, clk)
        self.assertEqual(int(self.plant.get("GDG.status")), 1); self.assertEqual(int(self.plant.get("CB.GDG")), 1)
        self.assertAlmostEqual(self.plant.get("GDG.kw"), 300.0, delta=15.0); self.assertLess(self.plant.get("ESS.kw"), -150.0)                                  # 최소 부하율 유지, ESS 충전
        self.plant.set("ESS.soc", 86.0); self.loop(3, clk); self.assertFalse(self.rt.decide()["GDG"]); self.rt.control(force=True); self.loop(3, clk)          # 충전 완료 → 정지
        self.assertEqual(int(self.plant.get("GDG.status")), 0); self.assertEqual(self.plant.get("ESS.kw_set"), 0.0)
        self.plant.set("ESS.soc", 30.0); self.loop(3, clk); self.assertTrue(self.rt.decide()["GDG"]); self.rt.control(force=True); self.loop(3, clk)           # 다시 낮아지면 재기동
        self.assertEqual(int(self.plant.get("GDG.status")), 1)
        self.rt.gar.gdg_min_run_s = 600.0; self.plant.set("ESS.soc", 86.0); self.loop(3, clk); self.assertTrue(self.rt.decide()["GDG"]); self.assertIn("최소 운전", self.rt.gdg_last["why"])   # 최소 운전 시간 안에는 세우지 않는다
        self.plant.set("CB.GRID", 1); self.loop(5, clk, dt=10.0); self.assertTrue(self.rt.tied()); self.assertFalse(self.rt.decide()["GDG"])                   # 복전 → 정지
        self.rt.control(force=True); self.loop(2, clk); self.assertEqual(int(self.plant.get("GDG.status")), 0)
        self.assertGreater(self.rt.auto_h["gdg_kwh"], 1000)                                                                                                 # 자립 시간에 발전기 연료 반영

    def test_garrison_generator_unavailable_falls_back_to_mobile_sources(self):
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.plant.set("ESS.soc", 22.0); self.plant.set("CB.GRID", 1); self.rt.scan(); self.rt.set_ops(mode="grid", who="시험")
        self.plant.set("GDG.mode", 1); self.plant.set("CB.GRID", 0); self.loop(4, clk)                           # 발전기가 현장 수동이면 EMS 가 지령할 수 없다
        d = self.rt.decide(); self.assertFalse(d["GDG"]); self.assertTrue(d["DG"] or d["FC"]); self.assertIn("지령 불가", self.rt.gdg_last["why"])
        self.rt.set_ops(mode="island", who="시험"); self.loop(2, clk); self.assertNotIn("GDG", self.rt.decide())
        self.rt.wall = lambda: dtm.datetime(2026, 11, 16, 1, 30); self.assertAlmostEqual(self.rt.hr(), 1.5); self.rt.hr_off = 11.5; self.assertAlmostEqual(self.rt.hr(), 13.0)   # 시연용 모의 시각
        self.rt.hr_off = 23.0; self.assertAlmostEqual(self.rt.hr(), 0.5)    # 작전지에서는 주둔지 발전기를 다루지 않는다

    def test_mode_matrix_every_place_and_posture_behaves_as_defined(self):
        """운용 장소(작전지 / 주둔지 연계 / 주둔지 정전) × 태세(평시 / 저소음 / 자립) 9가지가 정의대로 동작한다."""
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.rt.wall = lambda: dtm.datetime(2026, 11, 16, 3, 0); p = self.plant; rt = self.rt       # 새벽 3시(경부하 시간대)
        st = lambda: (round(p.get("GRID.kw")), int(p.get("DG.status")), int(p.get("FC.status")), int(p.get("GDG.status")), int(p.get("CB.L3")), int(p.get("CB.L2")))
        def settle(n=3):
            for _ in range(n): self.loop(3, clk); rt.control(force=True); self.loop(3, clk)
        p.set("ESS.soc", 60.0); p.set("CB.GRID", 1); rt.scan()
        # ── 작전지: 상전을 쓰지 않는다(수전 계측이 있어도 판단에 넣지 않는다)
        rt.set_ops(mode="island", posture="평시"); settle(); self.assertFalse(rt.tied()); self.assertIsNone(rt.gar_last); self.assertNotIn("GDG", rt.decide()); self.assertEqual(st()[4:], (1, 1))
        rt.set_ops(posture="저소음"); self.loop(5, clk); settle(); self.assertEqual(st()[1], 0); self.assertEqual(st()[4], 1); self.assertTrue(rt.decide().get("_quiet"))      # 디젤 금지. 저장량이 넉넉하면 3등급을 끊지 않는다(부하 · 발전 · 저장량을 보고 판단 — Rev66)
        self.assertGreater(rt.quiet_h, 12.0); h2 = p.get("H2.nm3"); rt.load_frac = {"L3": 0.2, "L2": 0.3}; p.set("H2.nm3", 3.0); p.set("ESS.soc", 32.0); self.loop(6, clk)                                      # 수소 · 충전율이 줄어 디젤 없이 12시간을 못 버틴다 → 먼저 절감 공급
        self.assertLess(rt.quiet_h, 12.0); self.assertEqual((st()[4], "L3" in rt.shedder.saved), (1, True)); self.assertTrue(any("부하 자동 절감 공급: 3등급" in e["text"] for e in rt.events))
        self.loop(14, clk); self.assertEqual(st()[4], 0); self.assertIn("저소음 태세: 디젤 없이", rt.shedder.why["L3"]); self.assertEqual(st()[5], 1)                       # 절감 뒤에도 모자라면 차단(2등급은 그대로)
        p.set("H2.nm3", h2); p.set("ESS.soc", 60.0); rt.load_frac = {}
        rt.set_ops(posture="평시"); self.loop(3, clk); clk[0] += 70; settle(); self.assertEqual(st()[4], 1)                                                                # 태세를 풀면 60초 뒤 복구
        # ── 주둔지 · 상전 연계
        rt.set_ops(mode="grid", posture="평시"); settle(); self.assertTrue(rt.tied()); self.assertEqual(st()[1:4], (0, 0, 0)); self.assertGreater(p.get("GRID.kw"), 100); self.assertLess(p.get("ESS.kw"), -20)   # 경부하: 상전으로 충전
        rt.set_ops(posture="저소음"); settle(); self.assertEqual(st()[1:], (0, 0, 0, 1, 1)); self.assertGreater(p.get("GRID.kw"), 100)                                   # 상전은 조용하다 → 평시와 같음, 부하 차단 없음
        rt.set_ops(posture="자립"); settle(); self.assertAlmostEqual(p.get("GRID.kw"), rt.gar.import_min_kw, delta=1.5); self.assertGreater(p.get("ESS.kw"), 20)            # 수전 최소화, ESS 방전
        self.assertEqual(st()[1:], (0, 0, 0, 1, 1)); self.assertIn("자립 태세", rt.gar_last["why"])                                                                       # ESS 로 충분하면 발전기를 켜지 않고, 부하도 끊지 않는다
        p.set("ESS.soc", 21.0); settle(4); self.assertEqual(int(p.get("FC.status")), 1); self.assertEqual(int(p.get("GDG.status")), 0)                                    # ESS 가 바닥나면 연료전지 투입(주둔지 발전기는 상전과 병렬하지 않는다)
        self.assertLess(p.get("GRID.kw"), 40.0); self.assertEqual(st()[4:], (1, 1))
        p.set("ESS.soc", 62.0); settle(); self.assertEqual(int(p.get("FC.status")), 0)                                                                                 # ESS 가 60% 를 넘으면 정지
        # ── 주둔지 · 정전
        rt.set_ops(posture="평시"); settle(); p.set("CB.GRID", 0); self.loop(3, clk); self.assertFalse(rt.tied()); clk[0] += 40; settle(4)
        self.assertEqual(int(p.get("GDG.status")), 1); self.assertEqual(st()[0:3], (0, 0, 0))                                                                           # 정전 30초 지속 → 주둔지 발전기, 이동형 전원은 쉼
        rt.set_ops(posture="저소음"); self.loop(5, clk); clk[0] += 700; settle(4); self.assertEqual(int(p.get("GDG.status")), 0); self.assertEqual(st()[1], 0); self.assertEqual(st()[4], 1)   # 저소음: 발전기·디젤 금지. 3등급은 저장량이 넉넉해 그대로
        rt.set_ops(posture="자립"); self.loop(3, clk); clk[0] += 70; settle(4); self.assertEqual(int(p.get("GDG.status")), 1)                                             # 자립: 주둔지 발전기를 다시 쓴다
        p.set("CB.GRID", 1); self.loop(3, clk); clk[0] += 40; settle(4); self.assertTrue(rt.tied()); self.assertEqual(int(p.get("GDG.status")), 0)                        # 복전 → 발전기 정지
        self.assertAlmostEqual(p.get("GRID.kw"), rt.gar.import_min_kw, delta=1.5)                                                                                        # 태세가 자립이므로 복전 뒤에도 수전 최소화

    def test_quiet_posture_forbids_diesel_and_sheds_class3_then_restores(self):
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.plant.set("ESS.soc", 27.0); self.rt.scan()      # 방전 하한 20 %(기본 운용 범위) 보다 7 %p 위
        self.assertTrue(self.rt.decide()["DG"])                                                                # 평시: 충전율이 낮으면 디젤
        self.rt.set_ops(posture="저소음", who="시험"); d = self.rt.decide(); self.assertFalse(d["DG"]); self.assertTrue(d["FC"]); self.assertTrue(d["_quiet"])
        self.loop(6, clk); self.assertEqual(int(self.plant.get("CB.L3")), 0); self.assertEqual(int(self.plant.get("CB.L2")), 1); self.assertIn("L3", self.rt.shedder.mine)
        self.assertEqual(int(self.plant.get("CB.L1")), 1); self.assertTrue(any("부하 자동 차단: 3등급" in e["text"] for e in self.rt.events))
        self.plant.set("ESS.soc", 60.0); self.rt.set_ops(posture="평시", who="시험"); self.loop(3, clk); self.assertEqual(int(self.plant.get("CB.L3")), 0)      # 60초 안정 뒤 복구
        self.loop(8, clk, dt=10.0); self.assertEqual(int(self.plant.get("CB.L3")), 1); self.assertEqual(self.rt.shedder.mine, set())

    def test_ops_persist_and_validation(self):
        self.rt.set_ops(posture="자립", who="시험"); from ifps_ems_rt import runtime
        rt2 = runtime.Runtime(self.cfgp); self.assertEqual(rt2.posture, "자립"); rt2.close()
        with self.assertRaises(ValueError): self.rt.set_ops(posture="무소음")
        with self.assertRaises(ValueError): self.rt.set_ops(mode="moon")
        self.rt.scan(); self.rt.fast_control(); h = self.rt.auto_h; self.assertGreater(h["p1"], h["full"]); self.assertGreater(h["store_kwh"], 0)
        self.rt.auto_enabled = False; self.plant.set("ESS.soc", 16.0); clk = [5000.0]; self.rt.now = lambda: clk[0]; self.loop(6, clk)
        self.assertEqual(int(self.plant.get("CB.L3")), 1)                                                      # 자동 제어가 꺼져 있으면 끊지 않는다


if __name__ == "__main__":
    unittest.main()
