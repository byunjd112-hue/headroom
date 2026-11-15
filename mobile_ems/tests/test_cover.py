# -*- coding: utf-8 -*-
"""실행률 보완 시험: 다른 시험이 지나지 않는 경로(논리 모형 시뮬레이션, 시각 동기 판정, 이력 기록, 주기 실행, 감사 키 선택, 웹 경로)를 확인한다."""
import datetime as dtm, json, os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
import numpy as np
from ifps_ems import dispatch as dp, security, supervisor as sv
from ifps_ems.config import Site
from test_rt import Base
from test_hmi import TestHmi as HmiBase


class TestCoreLogic(unittest.TestCase):
    def test_simulate_rule_policy_balances_energy(self):
        site = Site(); T = 96; hrs = np.arange(T) * 0.25; load = np.full(T, 90.0); pv = np.clip(300 * np.sin((hrs - 6) / 12 * np.pi), 0, None); lc = np.tile([30.0, 40.0, 20.0], (T, 1))
        pol = lambda k, soc, h2, dgp: dp.rule_action(site, soc, h2, dgp, 0, load[k], pv[k], hrs[k])
        r = dp.simulate(site, load, pv, lc, hrs, pol); self.assertGreaterEqual(r["fuel_l"], 0.0); self.assertGreaterEqual(r["shed_kwh"], 0.0)
        self.assertTrue(site.soc_min <= r["soc_end"] <= site.soc_max); self.assertGreaterEqual(r["h2_end"], 0.0)

    def test_time_sync_and_device_dict(self):
        ts = sv.TimeSync(); ts.synced(100.0); self.assertTrue(ts.ok(101.0)); self.assertGreater(ts.error_ms(1e7), ts.error_ms(200.0)); self.assertFalse(ts.ok(1e12))
        self.assertEqual(sv.Device("X", on=True).as_dict()["on"], True)

    def test_audit_key_sources(self):
        import tempfile, shutil
        td = tempfile.mkdtemp()
        try:
            k1, n1 = security.load_or_create_key(td); self.assertEqual(len(k1), 32); self.assertIn("생성", n1)
            k2, n2 = security.load_or_create_key(td); self.assertEqual(k1, k2); self.assertEqual(n2, "")
            os.environ["IFPS_TEST_KEY"] = "ab" * 32; k3, n3 = security.load_or_create_key(td, env="IFPS_TEST_KEY"); self.assertEqual(k3, bytes.fromhex("ab" * 32)); del os.environ["IFPS_TEST_KEY"]
            td2 = os.path.join(td, "old"); os.makedirs(td2); open(os.path.join(td2, "audit.log"), "w").close()
            k4, n4 = security.load_or_create_key(td2); self.assertEqual(k4, security.LEGACY_DEV_KEY); self.assertIn("개발 키", n4)
            with self.assertRaises(ValueError): security.CryptoProvider("short")
            c = security.CryptoProvider("k" * 20, verified=False); self.assertFalse(security.crypto_gate(c, "운용")[0]); self.assertTrue(security.crypto_gate(c, "개발")[0])
            a = security.AuditLog(os.path.join(td, "x.log"), c); self.assertEqual(a.tail(5), []); self.assertEqual(a.verify(), (True, "기록 없음"))
            a.append("t", "k", {}); open(a.path, "a", encoding="utf-8").write("not json\n"); self.assertFalse(a.verify()[0]); self.assertEqual(len(a.tail(5)), 1)
        finally:
            shutil.rmtree(td, ignore_errors=True)


class TestRuntimeLoop(Base):
    def test_history_row_written_when_quarter_changes(self):
        t = [dtm.datetime(2026, 11, 15, 10, 14, 50)]; self.rt.wall = lambda: t[0]
        self.rt.scan(); t[0] = dtm.datetime(2026, 11, 15, 10, 15, 1); self.rt.scan()
        rows = open(os.path.join(self.rt.state_dir, "history.csv"), encoding="utf-8").read().splitlines()
        self.assertEqual(rows[0].split(",")[0], "ts"); self.assertTrue(rows[1].startswith("2026-11-15 10:00,80.00,30.00")); self.assertEqual(len(rows), 2)

    def test_run_counts_overruns_and_saves_state(self):
        naps = []; self.rt.cfg["scan_s"] = 0.0001; self.rt.run(3, sleep=naps.append)
        self.assertEqual(self.rt.n_scan, 3); self.assertEqual(len(naps), 3); self.assertGreaterEqual(self.rt.n_over, 1); self.assertTrue(any(e["kind"] == "주기" for e in self.rt.events))
        st = json.load(open(os.path.join(self.rt.state_dir, "last.json"), encoding="utf-8")); self.assertIn("LOAD.kw", st["val"])

    def test_link_write_refuses_read_only_point_and_reports_dead_paths(self):
        from ifps_ems_rt import modbus as mb
        with self.assertRaises(mb.ModbusError): self.rt.links["DG"].write("DG.kw", 1)
        self.plant.muted.add("DG"); self.assertFalse(self.rt.links["DG"].write("DG.cmd", 0)); self.assertIsNone(self.rt.links["DG"].read_all()); self.assertTrue(self.rt.links["DG"].err)


class TestWebRoutes(HmiBase):
    def test_remaining_routes(self):
        op = self.login("4321"); en = self.login("8765")
        import urllib.request
        with urllib.request.urlopen(self.base + "/api/export/trend.csv", timeout=5) as f: body = f.read().decode("utf-8"); self.assertIn("load_kw", body.splitlines()[0])
        for path in ("/api/points", "/api/journal?n=5", "/api/info", "/api/energy", "/api/layout", "/api/photos", "/api/audit/verify", "/api/trend?since=0", "/api/trace?since=0&limit=5"):
            self.assertEqual(self.req(path)[0], 200, path)
        self.assertEqual(self.req("/nope.html")[0], 404); self.assertEqual(self.req("/api/nope", {})[0], 404); self.assertEqual(self.req("/../../etc/passwd")[0], 404)
        self.assertEqual(self.req("/api/trend?since=abc")[0], 400); self.assertEqual(self.req("/api/select", {"dev": "DG"}, op)[0], 400)
        self.assertEqual(self.req("/api/cancel", {"sid": "none"}, op)[1]["ok"], True); self.assertTrue(self.req("/api/control_now", {}, op)[1]["ok"])
        self.assertEqual(self.req("/api/mb/read?dev=DG&path=A&fc=3&addr=900&count=2", tok=op)[1]["ok"], False)             # 없는 주소 → 통신 오류 안내(200)
        self.assertEqual(self.req("/api/mb/write", {"dev": "DG", "fc": 6, "addr": 40, "values": [70000]}, en)[0], 400)
        self.assertEqual(self.req("/api/sim", {"action": "nope"}, en)[0], 400); self.assertEqual(self.req("/api/sim", {"action": "set", "tag": "NO.tag", "value": 1}, en)[0], 400)
        self.assertTrue(self.req("/api/sim", {"action": "set", "tag": "ENV.temp", "value": 25.0}, en)[1]["ok"]); self.assertTrue(self.req("/api/sim", {"action": "release", "tag": "ENV.temp"}, en)[1]["ok"])
        self.assertFalse(self.req("/api/auto", {"on": False}, op)[1]["auto"]); self.assertTrue(self.req("/api/auto", {"on": True}, op)[1]["auto"])
        self.assertTrue(self.req("/api/trace/clear", {}, op)[1]["ok"]); self.assertEqual(self.req("/api/sim", {"action": "scenario", "name": "nope"}, en)[0], 400)
        self.assertEqual(self.req("/api/sim", {"action": "fault", "target": "ZZ"}, en)[0], 400)
        self.assertTrue(self.req("/api/sim", {"action": "scenario", "name": "fault_l3"}, en)[1]["ok"]); self.assertTrue(self.req("/api/sim", {"action": "cb", "target": "L3", "on": True}, en)[1]["ok"])
        self.assertFalse(self.req("/api/mb/write", {"host": "127.0.0.1", "port": 1, "unit": 1, "fc": 6, "addr": 1, "values": [1]}, en)[1]["ok"])          # 접속 실패 → 통신 오류 안내
        self.assertFalse(self.req("/api/select", {"dev": "FC", "cmd": "set", "tag": "FC.kw_set", "value": "abc"}, op)[1]["ok"])
        self.assertTrue(self.req("/api/layout/reset", {}, op)[1]["ok"]); self.assertEqual(self.req("/api/layout/reset", {})[0], 403)
        big = b"x" * (70 * 1024); r = urllib.request.Request(self.base + "/api/login", data=big, method="POST")
        try: urllib.request.urlopen(r, timeout=5); self.fail("거부되어야 함")
        except urllib.error.HTTPError as e: self.assertEqual(e.code, 400)
        self.assertTrue(self.req("/api/logout", {}, op)[1]["ok"]); self.assertEqual(self.req("/api/control_now", {}, op)[0], 403)

    def test_session_expiry_and_purge(self):
        import time
        op = self.login("4321"); self.eng.tokens[op]["exp"] = time.monotonic() - 1; self.assertIsNone(self.eng.session(op))
        op2 = self.login("4321"); r = self.req("/api/select", {"dev": "FC", "cmd": "set", "tag": "FC.kw_set", "value": 10}, op2)[1]; self.assertTrue(r["ok"])
        self.eng.selects[r["sid"]]["exp"] = time.monotonic() - 1; self.assertIn("시간 초과", self.req("/api/operate", {"sid": r["sid"]}, op2)[1]["why"])
        self.eng.tokens["dead"] = {"role": "operator", "name": "x", "exp": time.monotonic() - 5}; self.eng.selects["old"] = {"exp": time.monotonic() - 5}; self.eng.purge()
        self.assertNotIn("dead", self.eng.tokens); self.assertNotIn("old", self.eng.selects)


for _n in [n for n in dir(HmiBase) if n.startswith("test_")]: setattr(TestWebRoutes, _n, None)
del HmiBase

if __name__ == "__main__":
    unittest.main()
