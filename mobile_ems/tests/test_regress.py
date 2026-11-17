# -*- coding: utf-8 -*-
"""Rev16 결함 보완 재발 방지 시험. 각 시험은 고치기 전 코드에서 실패하던 동작을 확인한다(시험결과 보고서의 결함 번호 R-xx 와 대응)."""
import http.client, json, os, socket, socketserver, struct, sys, threading, time, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
from ifps_ems import dataio, security
from ifps_ems.config import Site, SUP
from ifps_ems_rt import modbus as mb, pointmap as pm
from ifps_ems_rt.hmi.engine import AlarmManager
from test_rt import Base
from test_hmi import TestHmi as HmiBase


class TestCommandSafety(Base):
    def test_R01_frozen_heartbeat_blocks_send_not_only_select(self):
        clk = [1000.0]; self.rt.now = lambda: clk[0]; self.rt.scan(); self.plant.tick = lambda dt: None
        for _ in range(7): clk[0] += 1.0; self.rt.scan()
        ok, _ = self.rt.cmd.send("DG", "start"); self.assertFalse(ok); self.assertEqual(int(self.plant.get("DG.status")), 0)
        self.assertIn("차단: 통신 두절", self.rt.cmd.log[-1]["text"])

    def test_R05_watchdog_is_kicked_while_waiting_for_ack(self):
        self.plant.no_ack.update({"DG", "FC"}); self.rt.scan(); kicks = []
        self.rt.cmd.tick = lambda: kicks.append(time.monotonic()); t0 = time.monotonic(); ok, _ = self.rt.cmd.send("DG", "start")
        self.assertFalse(ok); self.assertGreater(time.monotonic() - t0, 2 * SUP["ack_s"]); self.assertGreater(len(kicks), 10)
        self.assertLess(max(b - a for a, b in zip(kicks, kicks[1:])), SUP["wd_s"])                     # 감시 한도(3초)보다 촘촘히 갱신

    def test_R09a_slow_starting_device_needs_done_s(self):
        self.plant.slow["DG"] = 2.0; self.plant.no_ack.add("FC"); self.rt.scan()
        ok, _ = self.rt.cmd.send("DG", "start"); self.assertFalse(ok); self.assertTrue(any("수용했으나 상태 미변화" in e["text"] for e in self.rt.cmd.log))
        time.sleep(2.2); self.rt.cmd.send("DG", "stop"); time.sleep(2.4); self.rt.scan(); self.assertEqual(int(self.plant.get("DG.status")), 0)
        self.rt.cmd.done_s = {"DG": 4.0}; ok, dt = self.rt.cmd.send("DG", "start"); self.assertTrue(ok); self.assertGreater(dt, 1.9)       # 장치별 완료 한도를 주면 기다린다

    def test_R09b_seq_and_cmd_go_in_one_frame(self):
        frames = []; self.rt.scan()
        for cl in self.rt.links["DG"].cl.values(): cl.trace = lambda way, data, rtt: frames.append((way, bytes(data) if isinstance(data, (bytes, bytearray)) else data))
        self.assertTrue(self.rt.cmd.send("DG", "start")[0])
        wr = [f for w, f in frames if w == "TX" and f[7] in (6, 16)]; self.assertEqual(len(wr), 1); self.assertEqual(wr[0][7], 16)
        addr, n = struct.unpack(">HH", wr[0][8:12]); self.assertEqual((addr, n), (10, 2)); self.assertEqual(struct.unpack(">HH", wr[0][13:17]), (1, self.rt.cmd.seq))

    def test_R04_nan_and_out_of_range_values_never_reach_device_or_state(self):
        for bad in (float("nan"), float("inf"), "12", None, True):
            with self.assertRaises(mb.ModbusError): mb.encode(bad, "u16")
        with self.assertRaises(mb.ModbusError): mb.encode(1e40, "f32")
        self.rt.scan(); self.assertFalse(self.rt.links["FC"].write("FC.kw_set", float("nan"))); self.assertTrue(all(self.rt.links["FC"].alive.values()))       # 값 거부는 경로 상태를 건드리지 않는다
        p = dict(self.rt.links["ESS"].by_tag["ESS.kw"], tag="ESS.f", addr=30, type="f32", scale=1.0, lo=None, hi=None)
        self.rt.links["ESS"].pts.append(p); self.rt.links["ESS"].by_tag["ESS.f"] = p; self.rt.links["ESS"].blk = pm.blocks(self.rt.links["ESS"].pts, "ESS")
        self.plant.reg["ESS"][(3, 30)] = 0x7FC0; self.plant.reg["ESS"][(3, 31)] = 0
        r = self.rt.scan(); self.assertEqual(r["bad"].get("ESS.f"), 5); self.assertNotIn("ESS.f", self.rt.val)

    def test_R08_blocks_do_not_span_undefined_addresses(self):
        blk = pm.blocks(self.pts, "DG"); spans = [(a, a + n - 1) for _, a, n, _ in blk]; self.assertIn((0, 4), spans); self.assertIn((6, 6), spans)
        self.assertEqual(len(pm.blocks(self.pts, "DG", gap=4)), 1)
        c = mb.Client("127.0.0.1", self.pa, 1, 0.3)
        with self.assertRaises(mb.ModbusError) as cm: c.read(0, 8)
        self.assertIn("예외 응답 2", str(cm.exception)); c.close()


class Garbage(socketserver.BaseRequestHandler):
    """형식이 틀린 응답을 보내는 장치."""
    mode = "short"
    def handle(self):
        try:
            head = self.request.recv(12)
            if len(head) < 8: return
            tid, _, _, unit, fc = struct.unpack(">HHHBB", head[:8])
            body = {"short": bytes([fc]), "trunc": bytes([fc, 4, 0, 1]), "fc": bytes([fc ^ 1, 2, 0, 1]), "exc": bytes([fc | 0x80])}[self.mode]
            self.request.sendall(struct.pack(">HHHB", tid, 0, len(body) + 1, unit) + body)
        except OSError:
            pass


class TestMalformedResponses(unittest.TestCase):
    def test_R06_malformed_frames_raise_modbus_error_only(self):
        srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Garbage); srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        try:
            for mode in ("short", "trunc", "fc", "exc"):
                Garbage.mode = mode; c = mb.Client("127.0.0.1", srv.server_address[1], 1, 0.5)
                with self.assertRaises(mb.ModbusError, msg=mode): c.read(0, 2)
                with self.assertRaises(mb.ModbusError, msg=mode): c.read_bits(0, 8)
                self.assertIsNone(c.sock, mode); c.close()
        finally:
            srv.shutdown(); srv.server_close()


class TestAuditDurability(Base):
    def test_R02_audit_write_failure_does_not_raise(self):
        self.rt.audit.path = os.path.join(self.td, "no", "such", "dir", "audit.log")
        self.rt.note("시험", "쓰기 실패 상황"); self.assertTrue(self.rt.audit_err); self.assertEqual(self.rt.events[-1]["text"], "쓰기 실패 상황")
        self.rt.audit.path = os.path.join(self.td, "ok.log"); self.rt.note("시험", "복구"); self.assertEqual(self.rt.audit_err, "")

    def test_R07_torn_tail_is_quarantined_and_chain_continues(self):
        p = os.path.join(self.td, "a.log"); c = security.CryptoProvider(b"k" * 32); a = security.AuditLog(p, c)
        for i in range(3): a.append("t", "k", {"i": i})
        with open(p, "ab") as f: f.write(b'{"seq": 4, "ts": "2026-11-15T0')                       # 쓰는 도중 전원 차단
        b = security.AuditLog(p, c); self.assertEqual(b.seq, 3); b.append("t", "k", {"i": 9})
        ok, msg = b.verify(); self.assertTrue(ok, msg); self.assertIn("4건", msg); self.assertTrue(os.path.exists(p + ".torn"))
        self.assertEqual([r["seq"] for r in b.tail(2)], [3, 4])

    def test_R02_rotation_keeps_chain_and_detects_tamper(self):
        p = os.path.join(self.td, "r.log"); c = security.CryptoProvider(b"k" * 32); a = security.AuditLog(p, c, max_bytes=600)
        for i in range(12): a.append("t", "k", {"i": i})
        old = [f for f in os.listdir(self.td) if f.startswith("r.log.")]; self.assertTrue(old); ok, msg = a.verify(); self.assertTrue(ok, msg)
        first = json.loads(open(p, encoding="utf-8").readline()); self.assertEqual(first["kind"], security.AuditLog.ROTATE)
        lines = open(p, encoding="utf-8").read().splitlines()
        if len(lines) > 2:
            open(p, "w", encoding="utf-8").write("\n".join(lines[1:]) + "\n"); self.assertFalse(security.AuditLog(p, c).verify()[0])        # 이어쓰기 건을 지우면 검출

    def test_R18_history_with_gap_and_torn_row_is_regridded(self):
        p = os.path.join(self.td, "h.csv"); row = lambda ts, v: f"{ts},{v},1,2,3,0,20,1013,50,1,2\n"
        with open(p, "w", encoding="utf-8") as f:
            f.write(",".join(dataio.HIST_COLS) + "\n" + row("2026-07-01 00:00", 10) + row("2026-07-01 00:15", 20) + row("2026-07-01 01:00", 50) + "2026-07-01 0")
        d = dataio.load_csv(p, Site()); self.assertEqual(d["n"], 5); self.assertEqual(list(d["load"]), [10.0, 20.0, 20.0, 20.0, 50.0]); self.assertEqual(d["ts"][2], "2026-07-01 00:30")


class TestForecastWithoutSampleFiles(unittest.TestCase):
    def test_R23_sim_generates_demo_data_and_live_explains(self):
        """results 폴더가 비어 있어도(실행 파일을 거치지 않고 기동) 시연 모드의 발전·예측 화면이 동작한다."""
        import shutil, tempfile
        from ifps_ems_rt.hmi.engine import Engine
        td = tempfile.mkdtemp()
        try:
            for f in ("runtime.json", "pointmap.csv"): shutil.copy(os.path.join(ROOT, "config", f), td)
            empty = os.path.join(td, "results"); eng = Engine(os.path.join(td, "runtime.json"), sim=True, plan_dir=empty)
            try:
                eng._compute_forecast(); fc = eng.fc_cache; self.assertTrue(fc["ok"], fc.get("why")); self.assertEqual(len(fc["load"]), 96); self.assertIn("합성", fc["source"])
                self.assertTrue(all(os.path.exists(os.path.join(empty, n)) for n in ("sample_site_data.csv", "model_load.npz", "model_pv.npz")))
                # R-25: 시연 모드의 예측은 고정된 옛 자료가 아니라 '지금 시각'까지 이어진 자료로 계산하고, 15분 구간이 넘어가면 다시 계산한다
                from datetime import datetime, timedelta
                issued = datetime.strptime(fc["issued"], "%Y-%m-%d %H:%M"); self.assertLess(abs((datetime.now() - issued).total_seconds()), 31 * 60); self.assertEqual(fc["hist_ts"][-1], fc["issued"])
                self.assertEqual(eng.forecast()["issued"], fc["issued"]); self.assertFalse(eng._fc_busy)                         # 같은 구간에서는 다시 계산하지 않는다
                hist = os.path.join(eng.rt.state_dir, "history.csv"); new = not os.path.exists(hist)                             # 가상 장치 실측이 예측 자료에 들어간다
                with open(hist, "a", encoding="utf-8") as h:
                    if new: h.write("ts,load_kw,load_p1,load_p2,load_p3,pv_kw,temp,press,rh,plan,mode\n")
                    h.write(f"{fc['issued']},333.00,100.00,120.00,113.00,0.00,10.00,1012.00,55.00,1,2\n")
                eng._compute_forecast(); self.assertAlmostEqual(eng.fc_cache["load_act"][-1], 333.0, places=1); self.assertIn("가상 장치 실측 1구간", eng.fc_cache["source"])
                real = type(eng)._slot_now; type(eng)._slot_now = staticmethod(lambda: real() + timedelta(minutes=15))
                try:
                    eng.forecast(); t0 = time.time()
                    while eng._fc_busy and time.time() - t0 < 60: time.sleep(0.1)
                    nxt = datetime.strptime(eng.fc_cache["issued"], "%Y-%m-%d %H:%M"); self.assertEqual(nxt - issued, timedelta(minutes=15))    # 구간이 넘어가면 발행 시각이 따라 움직인다
                finally:
                    type(eng)._slot_now = real
                eng.sim = False; shutil.rmtree(empty); eng._compute_forecast()                       # 실장치: 이력이 모자라면 이유를 알려 준다
                self.assertFalse(eng.fc_cache["ok"]); self.assertIn("8일", eng.fc_cache["why"]); self.assertNotIn("FileNotFound", eng.fc_cache["why"])
            finally:
                eng.sim = True; eng.stop()
        finally:
            shutil.rmtree(td, ignore_errors=True)


class TestAlarmDedupe(unittest.TestCase):
    def test_R15_repeated_event_alarms_are_counted_not_stacked(self):
        A = AlarmManager()
        for _ in range(50): A.event(3, "DG", "DG start 차단: 현장 수동 모드")
        A.event(3, "FC", "FC start 차단: 현장 수동 모드"); lst, _ = A.snapshot(); self.assertEqual(len(lst), 2); self.assertIn("×50", lst[0]["text"] + lst[1]["text"])
        A.ack("all", "시험"); A.event(3, "DG", "DG start 차단: 현장 수동 모드"); self.assertEqual(len(A.snapshot()[0]), 1)


class TestServerHardening(HmiBase):
    def raw(self, method, path, body=b"", headers=None):
        h = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5); h.request(method, path, body=body, headers=headers or {})
        r = h.getresponse(); out = r.status, r.read(); h.close(); return out

    def test_R26_garrison_autonomy_means_grid_lost_and_fuel_alarm_repeats(self):
        """R-26: 주둔지 자립 태세 = 전시·유사시 상전 상실. 가상 장치에서는 자립을 고르면 수전 차단기가 열린 상태가 되고 정전 논리로 운전한다.
        연료는 50% 이하(또는 정격 운전 8시간분 이하)에서 보충 경보를 올리고, 확인해도 보충 전에는 주기적으로 다시 알린다."""
        eng, p, A = self.eng, self.eng.plant, self.eng.alarms; item = lambda k: A.items.get(k)
        try:
            eng.set_ops({"mode": "grid"}, "시험"); time.sleep(2.5); self.assertEqual(int(p.get("CB.GRID")), 1); self.assertTrue(eng.rt.tied())
            eng.set_ops({"posture": "자립"}, "시험"); time.sleep(3.0); self.assertEqual(int(p.get("CB.GRID")), 0); self.assertFalse(eng.rt.tied()); self.assertTrue(eng.rt.grid_lost)
            self.assertAlmostEqual(p.get("GRID.kw"), 0.0, delta=0.5); self.assertEqual(item("grid.out")["state"], "ACT"); self.assertIsNone(item("grid.wartime"))
            p.hold = getattr(p, "hold", None); eng.simdrv.hold["PV.kw"] = 300.0; time.sleep(2.0)       # 태양광이 부하보다 훨씬 많은 낮
            p.set("CB.GRID", 1); time.sleep(6.0)                                                     # R-27: 차단기가 다시 닫힌 직후(복전 확인 30초 전)에도 역송 방지가 곧바로 동작해 역전력 트립이 없다
            self.assertEqual(int(p.get("CB.GRID")), 1); self.assertGreaterEqual(p.get("GRID.kw"), -1.0); self.assertTrue(eng.rt.grid_lost)
            eng.simdrv.hold.pop("PV.kw", None); eng.rt.grid_lost = False; time.sleep(2.5); self.assertEqual(item("grid.wartime")["state"], "ACT"); self.assertLess(p.get("GRID.kw"), 15.0)   # 수전 최소화로 운전
            eng.set_ops({"posture": "평시"}, "시험"); time.sleep(2.5); self.assertEqual(int(p.get("CB.GRID")), 1)
            # 연료 보충 경보
            p.set("DG.fuel_l", 900.0); p.set("GDG.fuel_pct", 85.0); time.sleep(2.5); self.assertTrue(item("fuel.DG") is None or item("fuel.DG")["state"] != "ACT")
            p.set("DG.fuel_l", 480.0); time.sleep(2.5); a = item("fuel.DG"); self.assertEqual((a["state"], a["prio"]), ("ACT", 2)); self.assertIn("연료 보충 요청", a["text"]); self.assertIn("48%", a["text"])
            a["acked"] = True; eng._fuel_t["DG"] -= 31 * 60; time.sleep(2.5); self.assertFalse(item("fuel.DG")["acked"])            # 확인해도 30분 뒤 다시 알린다
            self.assertTrue(any(h["ev"] == "재통보" for h in A.journal(50)))
            p.set("DG.fuel_l", 150.0); time.sleep(2.5); a = item("fuel.DG"); self.assertEqual(a["prio"], 1); self.assertIn("긴급", a["text"])                    # 8시간분 이하 → 긴급
            p.set("GDG.fuel_pct", 50.0); time.sleep(2.5); g = item("fuel.GDG"); self.assertEqual((g["state"], g["prio"]), ("ACT", 2)); self.assertIn("9.6시간", g["text"])   # 50%에서 아직 8시간 넘게 남는다
            p.set("GDG.fuel_pct", 40.0); time.sleep(2.5); self.assertEqual(item("fuel.GDG")["prio"], 1)
            p.set("DG.fuel_l", 900.0); p.set("GDG.fuel_pct", 85.0); time.sleep(2.5); self.assertNotEqual(item("fuel.DG")["state"] if item("fuel.DG") else "RTN", "ACT")
        finally:
            p.set("DG.fuel_l", 900.0); p.set("GDG.fuel_pct", 85.0); eng.set_ops({"mode": "island", "posture": "평시"}, "시험"); time.sleep(1.5)
            for k in ("all",): eng.alarms.ack(k, "시험") if hasattr(eng.alarms, "ack") else None

    def test_R03_negative_content_length_rejected(self):
        s = socket.create_connection(("127.0.0.1", self.httpd.server_address[1]), timeout=5)
        s.sendall(b"POST /api/login HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\nConnection: close\r\n\r\n" + b'{"pin":"0"}'); data = s.recv(4096); s.close()
        self.assertIn(b" 400 ", data.split(b"\r\n")[0])

    def test_R11_mutating_and_sensitive_routes_need_login(self):
        self.assertEqual(self.req("/api/trace", {"on": False})[0], 403); self.assertTrue(self.eng.trace_on)
        self.assertEqual(self.req("/api/trace/clear", {})[0], 403); self.assertEqual(self.req("/api/audit?n=5")[0], 403); self.assertEqual(self.req("/api/forecast?force=1")[0], 403)
        op = self.login("4321"); self.assertEqual(self.req("/api/audit?n=0", tok=op)[0], 200); self.assertLessEqual(len(self.req("/api/audit?n=0", tok=op)[1]["rows"]), 1)
        self.assertEqual(self.req("/api/trace", {"on": "false"}, op)[0], 400); self.assertEqual(self.req("/api/trace", {"on": True}, op)[0], 200)

    def test_R13_set_only_setpoints_and_finite_values(self):
        op = self.login("4321")
        for tag in ("DG.cmd", "DG.seq"): self.assertIn("설정 대상 아님", self.req("/api/select", {"dev": "DG", "cmd": "set", "tag": tag, "value": 1}, op)[1]["why"])
        self.assertFalse(self.req("/api/select", {"dev": "FC", "cmd": "set", "tag": "FC.kw_set", "value": "nan"}, op)[1]["ok"])
        self.assertTrue(self.req("/api/select", {"dev": "FC", "cmd": "set", "tag": "FC.kw_set", "value": 50}, op)[1]["ok"])

    def test_R19_wrong_json_shapes_are_400_not_500(self):
        en = self.login("8765")
        self.assertEqual(self.raw("POST", "/api/login", b"[]", {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.req("/api/layout", {"items": [1, 2]}, en)[0], 400); self.assertEqual(self.req("/api/mb/write", {"dev": "DG", "fc": 5, "addr": 1, "values": []}, en)[0], 400)
        self.assertEqual(self.req("/api/auto", {"on": "false"}, en)[0], 400)

    def test_R04_snapshot_is_strict_json_even_with_nan(self):
        real = self.eng.snapshot; self.eng.snapshot = lambda: {"values": {"X.f": {"v": float("nan")}}, "kpi": {"a": float("inf"), "b": [1.0, float("-inf")]}}
        try:
            st, body = self.raw("GET", "/api/snapshot"); self.assertEqual(st, 200); self.assertNotIn(b"NaN", body); self.assertNotIn(b"Infinity", body)
            d = json.loads(body, parse_constant=lambda c: self.fail(c)); self.assertIsNone(d["values"]["X.f"]["v"]); self.assertEqual(d["kpi"]["b"], [1.0, None])
        finally:
            self.eng.snapshot = real

    def test_R10_time_step_back_does_not_corrupt_energy_or_sessions(self):
        e0 = dict(self.eng.energy); real = time.time; op = self.login("4321")
        import ifps_ems_rt.hmi.engine as E
        E.time.time = lambda: real() - 3600                                                            # 벽시계를 한 시간 뒤로
        try: time.sleep(2.2); self.assertGreaterEqual(self.eng.energy["load"], e0["load"]); self.assertIsNotNone(self.eng.session(op))
        finally: E.time.time = real


for _n in [n for n in dir(HmiBase) if n.startswith("test_")]: setattr(TestServerHardening, _n, None)      # 기반 클래스의 시험은 다시 돌리지 않는다
del HmiBase

if __name__ == "__main__":
    unittest.main()


class TestGarrisonNeverExportsWhileElectrolyzerStarts(unittest.TestCase):
    """R-24: 주둔지에서 ESS 가 가득 차고 태양광이 남을 때, 수전해를 '기동'만 하고 태양광을 제한하지 않아 그 주기의 목표 수전이 음수(역송)가 되던 결함.
    C++ 이식 중 불변 조건(목표 수전 ≥ 최소 수전) 검사로 찾았다."""

    def test_R24_target_import_never_below_minimum(self):
        import random
        from ifps_ems_rt import opsmode as om
        from ifps_ems.config import Site
        s, g, r = Site(), om.Garrison(), random.Random(24)
        x = om.garrison_step(s, g, 10.2, 22.4, 365.4, 0.0, 0.90, 413.4)                      # 발견 당시 조건: 목표 수전 −342 kW 였다
        self.assertTrue(x["elz"]); self.assertGreater(x["pv_lim"], 0.0); self.assertGreaterEqual(x["grid"], g.import_min_kw)
        for _ in range(20000):
            a = (r.uniform(0, 24), r.uniform(0, 400), r.uniform(0, 420), r.choice([0.0, 50.0]), r.uniform(0.1, 0.95), r.uniform(0, 1000))
            self.assertGreaterEqual(om.garrison_step(s, g, *a)["grid"], g.import_min_kw - 1e-6, a)
