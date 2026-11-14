# -*- coding: utf-8 -*-
"""핵심 프로그램(ifps_ems) 시험: 운전계획, 규칙 운전, 통신 감시, 감사 기록, 동기 판정, 예측 정확도."""
import os, shutil, sys, tempfile, unittest
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
from ifps_ems import dispatch as dp, supervisor as sv, security, dataio
from ifps_ems.config import Site, SUP
from ifps_ems.forecast import LoadForecaster, PVForecaster


class TestDispatch(unittest.TestCase):
    def setUp(self):
        self.s = Site(); self.pl = dp.Planner(self.s); T = 96; self.hrs = (np.arange(T) * 0.25) % 24
        self.load = np.full(T, 90.0); self.pv = np.clip(300 * np.sin(np.pi * (self.hrs - 6) / 12), 0, None); self.lc = np.tile([30, 35, 25], (T, 1)).astype(float)

    def test_plan_is_finite_and_avoids_silent_hours(self):
        V = self.pl.plan(self.load, self.pv, self.lc, self.hrs); self.assertTrue(np.all(np.isfinite(V)))
        self.assertEqual(self.pl.act(V[1], 0.7, 700, 0, 90, 0, self.lc[0], 23.0)[0], 0)        # 야간·충전율 충분 → 디젤 정지
        self.assertEqual(self.pl.act(V[1], 0.16, 700, 0, 90, 0, self.lc[0], 23.0)[0], 1)       # 하한 근접 → 디젤 강제 기동

    def test_h2_limit_blocks_fuel_cell(self):
        V = self.pl.plan(self.load, self.pv, self.lc, self.hrs)
        self.assertEqual(self.pl.act(V[1], 0.3, self.s.h2_nm3 * self.s.h2_min + 1, 0, 90, 0, self.lc[0], 3.0)[1], 0)

    def test_rule_and_reserve(self):
        self.assertEqual(dp.rule_action(self.s, 0.2, 700, 0, 0, 90, 0, 12)[0], 1)
        self.assertEqual(dp.rule_action(self.s, 0.7, 700, 1, 0, 90, 0, 12)[0], 0)
        self.assertEqual(dp.rule_action(self.s, 0.4, 700, 1, 0, 90, 0, 12)[0], 1)              # 이력 현상: 중간 영역은 현재 상태 유지
        self.assertTrue(dp.reserve_need(130, [500, 100])); self.assertFalse(dp.reserve_need(130, [500, 100, 100]))
        self.assertEqual(dp.kappa_for(3), 1.0); self.assertEqual(dp.kappa_for(30), 0.5)


class TestSupervisor(unittest.TestCase):
    def test_link_monitor_sequence(self):
        lm = sv.LinkMonitor(["X"]); c = SUP["comm_s"]
        lm.heartbeat("X", 1.0, "A"); lm.heartbeat("X", 1.0, "B"); self.assertEqual(lm.check(1.0), {})
        lm.heartbeat("X", 1 + c, "A"); self.assertEqual(lm.check(1 + c + 0.5), {"X": sv.DEGRADED}); self.assertTrue(lm.controllable("X"))
        self.assertEqual(lm.check(10.0), {"X": sv.LOST}); self.assertFalse(lm.controllable("X"))
        lm.heartbeat("X", 11.0, "A"); lm.heartbeat("X", 11.0, "B"); self.assertEqual(lm.check(11.0), {"X": sv.RESYNC})
        self.assertEqual(lm.resync("X", {"a": 2.0}, {"a": 1.0}, 11.0), ["a"]); self.assertEqual(lm.state["X"], sv.NORMAL)

    def test_commander_checks(self):
        d = {"DG": sv.Device("DG"), "FC": sv.Device("FC")}; c = sv.Commander(d)
        d["DG"].manual = True; self.assertIn("수동", c.check("DG", "start")); d["DG"].manual = False
        d["DG"].online = False; self.assertIn("두절", c.check("DG", "start")); d["DG"].online = True
        self.assertEqual(c.check("DG", "start"), ""); self.assertIn("중복", c.check("DG", "stop"))

    def test_redundancy_needs_both_paths_lost(self):
        r = sv.Redundancy("backup"); r.peer_heartbeat("A", 0); r.peer_heartbeat("B", 0)
        r.peer_heartbeat("A", 10); self.assertFalse(r.step(10.5)); self.assertFalse(r.step(12))   # 한 회선만 끊김 → 절체 안 함
        self.assertFalse(r.step(13)); self.assertTrue(r.step(14.1))

    def test_sync_and_watchdog(self):
        self.assertTrue(sv.sync_check(0.05, 1.0, 2.0)[0]); self.assertFalse(sv.sync_check(0.3, 1.0, 2.0)[0]); self.assertFalse(sv.sync_check(0.1, 1.0, 7.0)[0])
        w = sv.Watchdog(["a"]); w.kick("a", 0); self.assertEqual(w.check(SUP["wd_s"] - 0.1), []); self.assertEqual(w.check(SUP["wd_s"] + 0.1), ["a"])


class TestSecurity(unittest.TestCase):
    def test_audit_detects_tampering(self):
        td = tempfile.mkdtemp(); p = os.path.join(td, "a.log"); c = security.CryptoProvider(b"0123456789abcdef-key")
        a = security.AuditLog(p, c)
        for i in range(5): a.append("t", "x", {"i": i})
        self.assertTrue(a.verify()[0]); a2 = security.AuditLog(p, c); a2.append("t", "x", {"i": 5}); self.assertTrue(a2.verify()[0])   # 재기동 후 연쇄 이어짐
        lines = open(p, encoding="utf-8").read().splitlines(); lines[2] = lines[2].replace('"i": 2', '"i": 9')
        open(p, "w", encoding="utf-8").write("\n".join(lines) + "\n"); ok, msg = a.verify(); self.assertFalse(ok); self.assertIn("3행", msg)
        lines.pop(2); open(p, "w", encoding="utf-8").write("\n".join(lines) + "\n"); self.assertFalse(a.verify()[0])
        self.assertFalse(security.crypto_gate(c, "운용")[0]); self.assertTrue(security.crypto_gate(security.CryptoProvider(b"0123456789abcdef-key", verified=True), "운용")[0])
        shutil.rmtree(td)


class TestForecast(unittest.TestCase):
    def test_accuracy_on_sample_site(self):
        from test_rt import ensure_sample
        res = os.path.join(ROOT, "results"); ensure_sample(res); s = Site(); d = dataio.load_csv(os.path.join(res, "sample_site_data.csv"), s)
        fl, fp = LoadForecaster(s), PVForecaster(s); self.assertTrue(dataio.load_model(os.path.join(res, "model_load.npz"), fl)); dataio.load_model(os.path.join(res, "model_pv.npz"), fp)
        el, ep = [], []
        for o in range(d["n"] - 96 * 5, d["n"] - 97, 96):
            l, lo, hi, _ = fl.predict(d, o); p, _, _, _ = fp.predict(d, o); a = d["load"][o + 1:o + 97]; b = d["pv"][o + 1:o + 97]
            el.append(np.mean(np.abs(l - a)) / np.mean(a) * 100); m = d["clear"][o + 1:o + 97] > 0.05 * s.pv_kwp; ep.append(np.mean(np.abs(p - b)[m]) / s.pv_kwp * 100)
            self.assertTrue(np.all(lo <= hi))
        self.assertLess(np.mean(el), 15.0); self.assertLess(np.mean(ep), 15.0)                     # 요구: 24시간 예측 오차 15% 이하


if __name__ == "__main__":
    unittest.main()
