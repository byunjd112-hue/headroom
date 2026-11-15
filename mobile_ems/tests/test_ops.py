# -*- coding: utf-8 -*-
"""군 운용 논리 시험: 주둔지(상전 연계·역송 없음·피크 억제·정전 자립 전환), 운용 태세(저소음·자립), 부하 자동 차단·복구, 자립 지속시간."""
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

    def test_autonomy_hours(self):
        a = om.autonomy(self.s, 0.9, 1000, 1500, (30, 40, 50))
        self.assertEqual(a["ess_kwh"], 712); self.assertEqual(a["h2_kwh"], 933); self.assertEqual(a["dg_kwh"], 5357)
        self.assertAlmostEqual(a["full"], (712.5 + 933.3 + 5357.1) / 120, places=0); self.assertGreater(a["shed3"], a["full"]); self.assertGreater(a["p1"], a["shed3"])
        q = om.autonomy(self.s, 0.9, 1000, 1500, (30, 40, 50), quiet=True); self.assertEqual(q["dg_kwh"], 0); self.assertLess(q["full"], a["full"])           # 저소음: 디젤 연료 제외
        self.assertEqual(om.autonomy(self.s, 0.9, 1000, 1500, (30, 40, 50), pv_kwh_day=24 * 200)["full"], 999.0)                                               # 태양광이 부하보다 크면 무기한

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

    def test_quiet_posture_forbids_diesel_and_sheds_class3_then_restores(self):
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.plant.set("ESS.soc", 22.0); self.rt.scan()
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
