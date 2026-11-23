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


class TestFieldGuards(Base):
    """실전 대비: 지령 대체 · 묵은 값 · 저장 실패 · 재기동에 대한 안전 처리."""
    def fake(self):
        """시각을 손으로 넘길 수 있는 실행기(같은 설정 · 같은 가상 장치)."""
        clk = [100.0]; rt = runtime.Runtime(self.cfgp, clock=lambda: clk[0]); self.addCleanup(rt.close); return rt, clk

    def test_stop_failure_never_stops_the_other_source(self):
        self.rt.scan(); self.assertTrue(self.rt.cmd.send("DG", "start")[0]); self.assertTrue(self.rt.cmd.send("FC", "start")[0])
        self.plant.no_ack.add("DG"); ok, _ = self.rt.cmd.send("DG", "stop")
        self.assertFalse(ok); self.assertEqual(int(self.plant.get("FC.status")), 1)                       # 디젤 정지 실패가 연료전지 정지로 바뀌지 않는다
        self.assertFalse([e for e in self.rt.cmd.log if "대체 전원" in e["text"] and e["cmd"] == "stop"])

    def test_slow_scan_does_not_mark_live_devices_lost(self):
        rt, clk = self.fake(); rt.scan(); read = rt._read_parallel
        def slow():
            got = read(); clk[0] += 2.6; return got                                                       # 읽는 데 두절 판정 시간(2초)보다 오래 걸렸다
        rt._read_parallel = slow; rt.scan(); self.assertEqual(rt.lm.check(rt.now()), {}); self.assertEqual(rt.lm.state["ESS"], "정상")

    def test_stale_soc_runs_a_generator(self):
        rt, clk = self.fake(); rt.scan(); self.assertFalse(rt.soc_blind()); self.assertFalse(rt.decide()["DG"])
        self.plant.muted.add("ESS"); clk[0] += 3.0; rt.scan(); clk[0] += 3.0; rt.scan()
        self.assertEqual(rt.lm.state["ESS"], "두절"); self.assertTrue(rt.soc_blind()); self.assertTrue(rt.decide()["DG"])          # 충전율을 모르면 발전기를 돌린다
        rt.posture = "저소음"; w = rt.decide(); self.assertFalse(w["DG"]); self.assertTrue(w["FC"])                                # 저소음 태세에서는 연료전지
        self.plant.muted.discard("ESS"); clk[0] += 1.0; rt.scan(); clk[0] += 1.0; rt.scan(); rt.posture = "평시"
        self.assertFalse(rt.soc_blind()); self.assertFalse(rt.decide()["DG"])

    def test_grid_state_held_while_meter_is_unreadable(self):
        rt, clk = self.fake(); rt.set_ops(mode="grid"); self.plant.set("CB.GRID", 1); rt.scan(); rt.fast_control(); self.assertTrue(rt.tied()); self.assertFalse(rt.grid_blind())
        self.plant.muted.add("MTR"); clk[0] += 3.0; rt.scan(); clk[0] += 3.0; rt.scan(); rt.fast_control()
        self.assertTrue(rt.grid_blind()); self.assertTrue(rt.tied()); self.assertFalse(rt.grid_lost); self.assertTrue(rt.decide().get("_hold"))      # 정전으로 단정하지 않고 보류
        self.assertEqual(rt.control(force=True), [])
        self.plant.set("ESS.soc", 18.0); clk[0] += 1.0; rt.scan(); w = rt.decide(); self.assertFalse(w.get("_hold")); self.assertTrue(w["DG"] or w["FC"] or w.get("GDG"))   # ESS 가 낮아지면 자립 논리로 기동
        rt.close(); rt2 = runtime.Runtime(self.cfgp, clock=lambda: clk[0]); self.addCleanup(rt2.close); self.assertEqual(rt2.mode, "grid")     # 재기동: 처음부터 수전점을 못 읽는다
        for _ in range(4): clk[0] += 1.0; rt2.scan(); rt2.fast_control()
        self.assertTrue(rt2.grid_blind()); self.assertTrue(rt2.tied()); self.assertFalse(rt2.grid_lost)
        self.plant.muted.discard("MTR"); self.plant.set("CB.GRID", 0)
        for _ in range(3): clk[0] += 1.0; rt2.scan(); rt2.fast_control()
        self.assertFalse(rt2.grid_blind()); self.assertTrue(rt2.grid_lost)                                 # 읽히면 실제 상태로 판정한다

    def test_outage_inferred_from_ess_while_meter_is_unreadable(self):
        """수전점을 못 읽는 동안: ESS 가 설정값보다 훨씬 많이 내보내는 상태가 이어지면 정전으로 미루어 보고 자립 논리로 넘어간다."""
        rt, clk = self.fake(); rt.set_ops(mode="grid"); self.plant.set("CB.GRID", 1); rt.scan(); rt.fast_control(); self.assertTrue(rt.tied())
        self.plant.muted.add("MTR"); clk[0] += 3.0; rt.scan(); clk[0] += 3.0; rt.scan(); self.assertTrue(rt.grid_blind())
        rt._w["ESS.kw_set"] = 0.0; rt.val["ESS.kw"] = 5.0; rt.flag["ESS.kw"] = 0
        for _ in range(30): clk[0] += 1.0; rt.fast_control()
        self.assertFalse(rt.grid_lost); self.assertTrue(rt.decide().get("_hold"))                          # 설정값대로면 보류를 이어 간다
        rt.val["ESS.kw"] = 70.0
        for _ in range(10): clk[0] += 1.0; rt.fast_control()
        self.assertFalse(rt.grid_lost)                                                                     # 잠깐의 차이로는 바꾸지 않는다
        for _ in range(15): clk[0] += 1.0; rt.fast_control()
        self.assertTrue(rt.grid_lost); self.assertFalse(rt.tied()); self.assertFalse(rt.decide().get("_hold"))
        self.assertTrue(any("정전 추정" in e["text"] for e in rt.events))
        rt2, clk2 = self.fake(); rt2.scan(); rt2.fast_control(); rt2.val["ESS.kw"] = 70.0; rt2.flag["ESS.kw"] = 0; self.assertTrue(rt2.grid_blind())
        for _ in range(40): clk2[0] += 1.0; rt2.fast_control()
        self.assertFalse(rt2.grid_lost)                                                                    # 설정값을 모르면(쓴 적 없음) 미루어 보지 않는다

    def test_accepted_command_waits_for_completion_limit(self):
        """지령을 받아들였지만 상태가 늦게 바뀌는 장비: 공통 완료 한도까지 기다리고(대체 전원을 켜지 않는다), 걸린 시간을 남긴다."""
        self.assertEqual(self.rt.cmd.done_default, 20.0); self.rt.scan(); self.plant.ack_delay = 0.2; real = self.plant._tick_cmd
        hold = {"until": time.monotonic() + 3.0, "seq": None}
        def slow(dev, now):                                                                                # 순번은 곧바로 되돌려 쓰고(수용) 상태는 3초 뒤에 바꾼다
            if dev == "DG" and time.monotonic() < hold["until"]:
                if int(round(self.plant.get("DG.cmd"))): self.plant.set("DG.seq_ack", self.plant.get("DG.seq"))
                return
            real(dev, now)
        self.plant._tick_cmd = slow; ok, dt = self.rt.cmd.send("DG", "start")
        self.assertTrue(ok); self.assertGreater(dt, 2.5); self.assertEqual(int(self.plant.get("FC.status")), 0); self.assertGreater(self.rt.cmd.took["DG"], 2.5)
        self.assertFalse([e for e in self.rt.cmd.log if "대체 전원" in e["text"]])

    def test_history_write_failure_keeps_the_cycle(self):
        self.rt.scan(); os.mkdir(os.path.join(self.rt.state_dir, "history.csv"))                           # 쓸 수 없는 이력 파일
        self.rt.slot = self.rt.slot.replace(year=self.rt.slot.year - 1); self.rt.acc = [[1.0] * 8]; self.rt.acc_sky = [float("nan")]
        r = self.rt.scan(); self.assertIn("t", r); self.assertTrue(self.rt.hist_err); self.assertEqual(len(self.rt.acc), 1)       # 예외 없이 주기를 마치고 다음 구간을 쌓는다

    def test_setpoints_rewritten_after_device_returns(self):
        rt, clk = self.fake(); rt.scan(); self.assertTrue(rt._write1("ESS", "ESS.kw_set", 12.0, 0.5)); self.assertIn("ESS.kw_set", rt._w)
        self.plant.muted.add("ESS"); clk[0] += 3.0; rt.scan(); self.assertFalse(rt._write1("ESS", "ESS.kw_set", 30.0, 0.5))      # 두절 중에는 쓰지 않는다
        self.plant.muted.discard("ESS"); self.plant.set("ESS.kw_set", 0.0); clk[0] += 1.0; rt.scan(); clk[0] += 1.0; rt.scan()   # 장치가 재기동하며 기본값으로 돌아갔다
        self.assertNotIn("ESS.kw_set", rt._w); self.assertIn("ESS", rt.rewrite)
        self.assertTrue(rt._write1("ESS", "ESS.kw_set", 12.0, 0.5)); self.assertAlmostEqual(self.plant.get("ESS.kw_set"), 12.0, places=1)     # 같은 값이라도 다시 쓴다

    def test_no_setpoint_to_a_unit_in_local_mode(self):
        self.rt.scan(); self.assertTrue(self.rt._write1("PV", "PV.lim_set", 50.0, 0.5))
        self.plant.set("PV.mode", 1); self.rt.scan(); self.assertFalse(self.rt.can_write("PV")); self.assertFalse(self.rt._write1("PV", "PV.lim_set", 10.0, 0.5))
        self.assertAlmostEqual(self.plant.get("PV.lim_set"), 50.0, places=1)

    def test_auto_off_and_shed_feeders_survive_restart(self):
        self.assertIsNone(self.rt.ops_auto); self.rt.ops_auto = False; self.rt.shedder.mine = {"L3"}; self.rt.save_ops()
        rt2 = runtime.Runtime(self.cfgp); self.addCleanup(rt2.close); self.assertIs(rt2.ops_auto, False); self.assertEqual(rt2.shedder.mine, {"L3"})

    def test_one_bad_block_does_not_kill_the_device(self):
        lk = self.rt.links["MTR"]; real = lk.cl["A"]; first = lk.blk[0][1]; self.assertGreater(len(lk.blk), 1)
        class Part:
            timeout = 0.3
            def read(self, addr, n, fc):
                if addr == first: raise mb.DeviceException(2, "장치 예외 응답 2 (주소 불가)")
                return real.read(addr, n, fc)
        v = lk.read_blocks(Part()); self.assertTrue(v); self.assertTrue(lk.miss); self.assertFalse(set(lk.miss) & set(v))       # 나머지 블록은 읽는다
        class Dead(Part):
            def read(self, addr, n, fc): raise mb.DeviceException(11, "게이트웨이 대상 무응답")
        with self.assertRaises(mb.ModbusError): lk.read_blocks(Dead())                                      # 게이트웨이 무응답은 통신 실패
        class Never(Part):
            def read(self, addr, n, fc): raise mb.DeviceException(2, "주소 불가")
        with self.assertRaises(mb.ModbusError): lk.read_blocks(Never())                                     # 모든 블록이 예외면 살아 있다고 보지 않는다


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

    def test_background_plan_does_not_block_commands(self):
        """운전계획을 뒤에서 계산하면(화면부의 설정) 계산 중에도 판단이 바로 나온다 — 지령 처리가 계획 계산을 기다리지 않는다."""
        import threading
        from ifps_ems_rt.planlink import PlanPolicy
        res = os.path.join(CORE, "results"); ensure_sample(res); clk = [0.0]
        pol = PlanPolicy(self.rt.site, os.path.join(res, "sample_site_data.csv"), res, clock=lambda: clk[0]); pol.background = True
        gate = threading.Event(); real = pol.replan
        def slow(hr=None): gate.wait(10.0); real(hr)                                                     # 계획 계산이 오래 걸리는 상황
        pol.replan = slow; self.rt.scan()
        t0 = time.monotonic(); a = pol(dict(self.rt.val), 14.0); dt = time.monotonic() - t0
        self.assertLess(dt, 0.5); self.assertEqual(pol.note, "운전계획 계산 중 → 규칙 운전"); self.assertEqual(len(a), 3)      # 기다리지 않고 규칙 운전으로 답한다
        pol(dict(self.rt.val), 14.0); self.assertEqual(threading.active_count(), threading.active_count())                  # 계산 중에 또 불러도 가닥을 더 만들지 않는다
        self.assertEqual(sum(1 for t in threading.enumerate() if t.name == "plan"), 1)
        gate.set(); pol._bg.join(120.0); self.assertFalse(pol._bg.is_alive()); self.assertEqual(pol.bg_err, ""); a2 = pol(dict(self.rt.val), 14.0); self.assertEqual(pol.note, "계획 운전(실측 이력)"); self.assertEqual(len(a2), 3)
        v_old = pol.V; clk[0] = 3700.0; gate.clear(); t0 = time.monotonic(); pol(dict(self.rt.val), 15.0); self.assertLess(time.monotonic() - t0, 0.5)
        self.assertIs(pol.V, v_old); self.assertEqual(pol.note, "계획 운전(실측 이력)")                                      # 다시 세우는 동안에는 직전 계획을 쓴다
        gate.set(); pol._bg.join(120.0); self.assertIsNot(pol.V, v_old)
        pol.cancel(); clk[0] = 7400.0; pol(dict(self.rt.val), 16.0); pol._bg.join(30.0); self.assertIn("중단", pol.bg_err)                 # 멈추라고 하면 계산을 그만둔다(EMS 종료)
        short = os.path.join(self.td, "short_bg.csv")
        with open(os.path.join(res, "sample_site_data.csv"), encoding="utf-8") as f, open(short, "w", encoding="utf-8") as g: g.writelines(f.readlines()[:200])
        pol2 = PlanPolicy(self.rt.site, short, res); pol2.background = True; pol2(dict(self.rt.val), 14.0); pol2._bg.join(60.0); pol2(dict(self.rt.val), 14.0)
        self.assertIn("이력", pol2.note); self.assertIn("규칙 운전", pol2.note)                                              # 뒤에서 난 실패(이력 부족)도 사유가 남는다


if __name__ == "__main__":
    unittest.main()
