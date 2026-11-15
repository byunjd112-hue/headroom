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
        self.pts = pm.load(os.path.join(self.td, "pointmap.csv")); self.units = {n: d["unit"] for n, d in json.load(open(os.path.join(ROOT, "config", "runtime.json"), encoding="utf-8"))["devices"].items()}
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


class TestByteOrder(Base):
    """16·32·64비트 자료형과 바이트·워드 순서(ABCD/CDAB/BADC/DCBA)."""
    def test_known_vectors(self):
        exp = {"ABCD": [0x1122, 0x3344], "CDAB": [0x3344, 0x1122], "BADC": [0x2211, 0x4433], "DCBA": [0x4433, 0x2211]}
        for o, regs in exp.items():
            self.assertEqual(mb.encode(0x11223344, "u32", 1, o), regs, o); self.assertEqual(mb.decode(regs, "u32", 1, o), 0x11223344, o)
        self.assertEqual(mb.encode(1.0, "f32", 1, "ABCD"), [0x3F80, 0x0000]); self.assertEqual(mb.encode(1.0, "f32", 1, "CDAB"), [0x0000, 0x3F80])
        self.assertEqual(mb.encode(0x1234, "u16", 1, "BADC"), [0x3412]); self.assertEqual(mb.encode(0x1234, "u16", 1, "CDAB"), [0x1234])   # 16비트는 바이트만 영향
        self.assertEqual(mb.encode(0x0102030405060708, "u64", 1, "CDAB"), [0x0708, 0x0506, 0x0304, 0x0102])
        for o in mb.ORDERS:
            for typ, v in (("i16", -123), ("u16", 65535), ("i32", -2_000_000_000), ("u32", 4_000_000_000), ("f32", -12.5), ("i64", -9_000_000_000_000), ("f64", 1234.5678)):
                self.assertAlmostEqual(mb.decode(mb.encode(v, typ, 1, o), typ, 1, o), v, places=3, msg=f"{typ} {o}")
        self.assertAlmostEqual(mb.decode(mb.encode(-48.7, "i32", 0.1, "CDAB"), "i32", 0.1, "CDAB"), -48.7, places=6)
        self.assertEqual(mb.norm_order("word swap"), "CDAB"); self.assertEqual(mb.norm_order("3412"), "CDAB"); self.assertEqual(mb.norm_order(""), "ABCD")
        with self.assertRaises(mb.ModbusError): mb.norm_order("ACBD")
        with self.assertRaises(mb.ModbusError): mb.encode(70000, "u16")              # 범위 밖은 잘라 보내지 않고 거부
        with self.assertRaises(mb.ModbusError): mb.encode(-1, "u32")

    def _write(self, rows, dev_order=None):
        src = open(os.path.join(ROOT, "config", "pointmap.csv"), encoding="utf-8").read().rstrip("\n").split("\n")
        open(os.path.join(self.td, "pointmap.csv"), "w", encoding="utf-8").write("\n".join(src + rows) + "\n")
        cfg = json.load(open(self.cfgp, encoding="utf-8"))
        for d, o in (dev_order or {}).items(): cfg["devices"][d]["order"] = o
        json.dump(cfg, open(self.cfgp, "w", encoding="utf-8"), ensure_ascii=False); return cfg

    def test_pointmap_order_column_and_device_default(self):
        cfg = self._write(["ESS.kwh,ESS,3,30,u32,0.1,kWh,,,r,CDAB", "ESS.p32,ESS,3,32,f32,1,kW,,,r,"], {"ESS": "DCBA"})
        pts = {p["tag"]: p for p in pm.load(os.path.join(self.td, "pointmap.csv"), cfg["devices"])}
        self.assertEqual(pts["ESS.kwh"]["order"], "CDAB"); self.assertEqual(pts["ESS.p32"]["order"], "DCBA"); self.assertEqual(pts["DG.kw"]["order"], "ABCD")
        self.assertEqual(pm.validate(list(pts.values()), cfg["devices"]), [])
        self._write(["ESS.bad,ESS,3,30,u32,1,,,,r,XYZW"])
        bad = pm.validate(pm.load(os.path.join(self.td, "pointmap.csv")), self.units); self.assertTrue(any("바이트 순서" in b for b in bad), bad)

    def test_end_to_end_mixed_orders_with_simulator(self):
        """장치마다 순서가 다른 현장을 모의: 32비트 점 3종 + 장치 기본 DCBA(16비트 지령까지 바이트 뒤집힘)."""
        cfg = self._write(["ESS.kwh,ESS,3,30,u32,0.1,kWh,,,r,CDAB", "ESS.p32,ESS,3,32,f32,1,kW,,,r,BADC", "ESS.i32,ESS,4,34,i32,0.01,kW,,,r,DCBA"], {"DG": "DCBA"})
        self.rt.close(); self.plant.stop()
        pts = pm.load(os.path.join(self.td, "pointmap.csv"), cfg["devices"])
        self.plant = simplant.Plant(pts, self.units); pa, pb = self.plant.start([0, 0])
        for n in cfg["devices"]: cfg["devices"][n]["paths"] = [["127.0.0.1", pa], ["127.0.0.1", pb]]
        json.dump(cfg, open(self.cfgp, "w", encoding="utf-8"), ensure_ascii=False)
        self.rt = runtime.Runtime(self.cfgp)
        self.plant.set("ESS.kwh", 123456.7); self.plant.set("ESS.p32", -12.5); self.plant.set("ESS.i32", -48.25)
        r = self.rt.scan(); self.assertEqual(r["link"], {})
        self.assertAlmostEqual(self.rt.val["ESS.kwh"], 123456.7, places=1); self.assertAlmostEqual(self.rt.val["ESS.p32"], -12.5, places=4)
        self.assertAlmostEqual(self.rt.val["ESS.i32"], -48.25, places=4); self.assertAlmostEqual(self.rt.val["LOAD.kw"], 80.0, places=1)
        c = mb.Client("127.0.0.1", pa, self.units["ESS"], 0.3); raw = c.read(30, 2); c.close()
        self.assertNotAlmostEqual(mb.decode(raw, "u32", 0.1, "ABCD"), 123456.7, places=0)          # 순서를 틀리면 값이 틀린다
        ok, _ = self.rt.cmd.send("DG", "start"); self.assertTrue(ok); self.assertEqual(int(self.plant.get("DG.status")), 1)   # DCBA 장치 지령·응답 확인


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

    def test_heartbeat_freeze_blocks_command(self):
        """통신은 정상인데 장치 hb가 멈추면 지령을 막고, 다시 올라가면 풀린다."""
        clk = [1000.0]; self.rt.now = lambda: clk[0]
        self.rt.scan(); self.assertTrue(self.rt.controllable("DG"))
        orig = self.plant.tick; self.plant.tick = lambda dt: None            # 장치 제어기 정지(hb·상태 갱신 멈춤)
        try:
            for _ in range(7): clk[0] += 1.0; self.rt.scan()
            self.assertFalse(self.rt.controllable("DG")); self.assertEqual(self.rt.lm.state["DG"], "정상")
            self.assertTrue(any("생존 계수 정지" in e["text"] for e in self.rt.events))
        finally: self.plant.tick = orig
        time.sleep(0.3); clk[0] += 1.0; self.rt.scan(); self.assertTrue(self.rt.controllable("DG"))

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
        self.assertEqual(pol.note, "계획 운전(실측 이력)"); self.assertEqual(len(a), 3); self.assertTrue(all(x in (0, 1) for x in a))
        self.assertEqual(len(pol.fc["load"]), 96)
        short = os.path.join(self.td, "short.csv")
        with open(os.path.join(res, "sample_site_data.csv"), encoding="utf-8") as f, open(short, "w", encoding="utf-8") as g: g.writelines(f.readlines()[:200])
        pol2 = PlanPolicy(self.rt.site, short, res); a2 = pol2(dict(self.rt.val), 14.0)
        self.assertIn("규칙 운전", pol2.note); self.assertEqual(len(a2), 3)                                 # 이력이 모자라면 규칙 운전
        self.rt.policy = pol; self.assertIsInstance(self.rt.decide(), dict)
        clk = [0.0]; pol3 = PlanPolicy(self.rt.site, short, res, demo_csv=os.path.join(res, "sample_site_data.csv"), clock=lambda: clk[0])
        pol3(dict(self.rt.val), 14.0); self.assertEqual(pol3.note, "계획 운전(시연용 합성 이력)"); self.assertEqual(pol3.k, 0)      # 시연: 합성 자료, 현재 시각대에 맞춘 계획
        self.assertAlmostEqual(float((pol3.V is not None) and 14.25), 14.25); clk[0] = 1900.0; pol3(dict(self.rt.val), 14.5); self.assertEqual(pol3.k, 2)   # 15분 칸을 시간으로 따라간다
        t_old = pol3.t_plan; clk[0] = 3700.0; pol3(dict(self.rt.val), 15.0); self.assertGreater(pol3.t_plan, t_old)               # 1시간 지나면 다시 계획


if __name__ == "__main__":
    unittest.main()
