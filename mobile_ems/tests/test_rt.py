# -*- coding: utf-8 -*-
"""실장치 연동 계층 시험. 가상 장치(Modbus TCP 서버)를 로컬에 띄워 실제 통신으로 확인한다."""
import json, os, shutil, sys, tempfile, time, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
CORE = os.environ.get("IFPS_EMS_CORE", ROOT)
sys.path.insert(0, ROOT); sys.path.insert(0, CORE)
from ifps_ems_rt import modbus as mb, pointmap as pm, simplant, runtime
from ifps_ems.config import SUP


def ensure_sample(res):
    """시험용 합성 이력과 학습 모델이 없으면 만든다."""
    from ifps_ems import __main__ as core
    os.makedirs(res, exist_ok=True); csvp = os.path.join(res, "sample_site_data.csv")
    if not os.path.exists(csvp): core.main(["gen-sample", csvp])
    if not os.path.exists(os.path.join(res, "model_pv.npz")): core.main(["train", csvp, res])


class Base(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.mkdtemp(); shutil.copy(os.path.join(ROOT, "config", "pointmap.csv"), self.td)
        self.pts = pm.load(os.path.join(self.td, "pointmap.csv")); self.units = {"DG": 1, "FC": 2, "ESS": 3, "MTR": 4}
        self.plant = simplant.Plant(self.pts, self.units); self.pa, self.pb = self.plant.start([0, 0])
        cfg = json.load(open(os.path.join(ROOT, "config", "runtime.json"), encoding="utf-8"))
        cfg["allow"] = ["127.0.0.0/8"]; cfg["timeout_s"] = 0.3
        for n in cfg["devices"]: cfg["devices"][n]["paths"] = [["127.0.0.1", self.pa], ["127.0.0.1", self.pb]]
        self.cfgp = os.path.join(self.td, "runtime.json"); json.dump(cfg, open(self.cfgp, "w", encoding="utf-8"), ensure_ascii=False)
        self.rt = runtime.Runtime(self.cfgp)

    def tearDown(self):
        self.rt.close(); self.plant.stop(); shutil.rmtree(self.td, ignore_errors=True)


class TestModbus(Base):
    def test_roundtrip_and_types(self):
        c = mb.Client("127.0.0.1", self.pa, 1, 0.3); c.write(40, [1234]); self.assertEqual(c.read(40, 1), [1234])
        c.write(50, mb.encode(-12.5, "i16", 0.1)); self.assertAlmostEqual(mb.decode(c.read(50, 1), "i16", 0.1), -12.5)
        c.write(60, mb.encode(3.25, "f32")); self.assertAlmostEqual(mb.decode(c.read(60, 2), "f32"), 3.25, places=5); c.close()

    def test_allowlist_rejects_outside_addresses(self):
        for h in ("8.8.8.8", "example.com", "10.1.2.3"):
            with self.assertRaises(mb.ModbusError): mb.Client(h, 502, 1, 0.1, allow=("127.0.0.0/8", "192.168.10.0/24"))
        with self.assertRaises(mb.ModbusError): mb.Client("8.8.8.8", 502, 1, 0.1, allow=("0.0.0.0/0",))      # 공인 주소는 목록에 있어도 거부

    def test_pointmap_validation(self):
        self.assertEqual(pm.validate(self.pts, self.units), [])
        bad = [dict(self.pts[0]), dict(self.pts[0], tag="X.kw", unit="V"), dict(self.pts[1], tag="Y", type="q8")]
        self.assertGreaterEqual(len(pm.validate(bad, self.units)), 3)


class TestRuntime(Base):
    def test_scan_reads_values_within_period(self):
        t0 = time.monotonic(); r = self.rt.scan(); dt = time.monotonic() - t0
        self.assertEqual(r["link"], {}); self.assertEqual(r["bad"], {}); self.assertLess(dt, 0.5)       # 1초 주기에 50% 이상 여유
        self.assertAlmostEqual(self.rt.val["LOAD.kw"], 80.0, places=1); self.assertAlmostEqual(self.rt.val["PV.kw"], 40.0, places=1)

    def test_range_check_keeps_last_good_value(self):
        self.rt.scan(); self.plant.set("PV.kw", 900.0); r = self.rt.scan()
        self.assertEqual(r["bad"].get("PV.kw"), 5); self.assertAlmostEqual(self.rt.val["PV.kw"], 40.0, places=1)

    def test_command_ack(self):
        self.rt.scan(); ok, dt = self.rt.cmd.send("DG", "start")
        self.assertTrue(ok); self.assertLess(dt, SUP["ack_s"]); self.assertEqual(int(self.plant.get("DG.status")), 1)
        self.assertFalse(self.rt.cmd.send("DG", "start")[0])                                              # 중복 지령 차단

    def test_no_ack_falls_back_to_alternate_source(self):
        self.plant.no_ack.add("DG"); self.rt.scan(); ok, dt = self.rt.cmd.send("DG", "start")
        self.assertTrue(ok); self.assertEqual(int(self.plant.get("FC.status")), 1); self.assertEqual(int(self.plant.get("DG.status")), 0)
        self.assertLess(dt, 5.0)                                                                           # 대체 전원 지령 완료 5초 이내
        self.assertEqual(int(self.plant.get("DG.cmd")), 0)                                                 # 실패한 지령은 취소(cmd=0)
        self.plant.no_ack.discard("DG"); time.sleep(0.6); self.assertEqual(int(self.plant.get("DG.status")), 0)   # 장치가 회복돼도 잔류 지령이 실행되지 않음

    def test_manual_mode_blocks_command(self):
        self.plant.set("DG.mode", 1); self.rt.scan()
        self.assertFalse(self.rt.cmd.send("DG", "start")[0]); self.assertEqual(int(self.plant.get("DG.status")), 0)

    def test_one_path_down_keeps_control_both_down_blocks(self):
        self.rt.scan(); self.plant.down.add("A")
        for _ in range(3): self.rt.scan(); time.sleep(SUP["comm_s"] / 2)
        self.assertEqual(self.rt.lm.state["DG"], "경로 저하"); self.assertTrue(self.rt.cmd.send("DG", "start")[0])
        self.plant.down.add("B"); t0 = time.monotonic()
        while self.rt.lm.state["DG"] != "두절" and time.monotonic() - t0 < 5: self.rt.scan(); time.sleep(0.2)
        self.assertEqual(self.rt.lm.state["DG"], "두절"); self.assertLess(time.monotonic() - t0, 3.0)      # 두절 감지 3초 이내
        self.assertFalse(self.rt.cmd.send("DG", "stop")[0])
        self.plant.down.clear(); self.rt.scan(); self.rt.scan()
        self.assertEqual(self.rt.lm.state["DG"], "정상")                                                   # 복구 뒤 재조회하고 제어 재개

    def test_reserve_rule_starts_fuel_cell(self):
        self.plant.set("LOAD.p1_kw", 70.0); self.plant.set("LOAD.p2_kw", 60.0); self.plant.set("LOAD.kw", 150.0); self.rt.scan()
        done = self.rt.control(force=True); self.assertIn(("FC", True, True), [d[:3] for d in done]); self.assertEqual(int(self.plant.get("FC.status")), 1)

    def test_run_loop_and_audit(self):
        self.rt.cfg["scan_s"] = 0.2; self.rt.run(5); self.assertEqual(self.rt.n_scan, 5); self.assertEqual(self.rt.n_over, 0)
        self.assertTrue(os.path.exists(os.path.join(self.rt.state_dir, "last.json"))); self.assertTrue(self.rt.audit.verify()[0])

    def test_unverified_crypto_refused_in_operation_mode(self):
        cfg = json.load(open(self.cfgp, encoding="utf-8")); cfg["run_mode"] = "운용"; p2 = os.path.join(self.td, "op.json"); json.dump(cfg, open(p2, "w", encoding="utf-8"), ensure_ascii=False)
        with self.assertRaises(RuntimeError): runtime.Runtime(p2)


class TestPlanLink(Base):
    def test_plan_policy_decides_from_history_and_falls_back(self):
        from ifps_ems_rt.planlink import PlanPolicy
        res = os.path.join(CORE, "results"); ensure_sample(res)
        pol = PlanPolicy(self.rt.site, os.path.join(res, "sample_site_data.csv"), res)
        self.rt.scan(); a = pol(dict(self.rt.val), 14.0)
        self.assertEqual(pol.note, "계획 운전"); self.assertEqual(len(a), 3); self.assertTrue(all(x in (0, 1) for x in a))
        self.assertEqual(len(pol.fc["load"]), 96)
        short = os.path.join(self.td, "short.csv")
        with open(os.path.join(res, "sample_site_data.csv"), encoding="utf-8") as f, open(short, "w", encoding="utf-8") as g: g.writelines(f.readlines()[:200])
        pol2 = PlanPolicy(self.rt.site, short, res); a2 = pol2(dict(self.rt.val), 14.0)
        self.assertIn("규칙 운전", pol2.note); self.assertEqual(len(a2), 3)                                 # 이력이 모자라면 규칙 운전
        self.rt.policy = pol; self.assertIsInstance(self.rt.decide(), dict)


if __name__ == "__main__":
    unittest.main()
