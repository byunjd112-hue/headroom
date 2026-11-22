# -*- coding: utf-8 -*-
"""현장 진단 도구(diag) 시험. 가상 장치에 실제 통신으로 진단하고, 고장을 넣어 원인 안내가 맞는지 본다."""
import contextlib, io, json, os, sys, unittest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
from ifps_ems_rt import diag, modbus as mb, pointmap as pm
from test_rt import Base


class TestDiag(Base):
    def setUp(self):
        super().setUp(); self.cfg = json.load(open(self.cfgp, encoding="utf-8")); self.out = io.StringIO()

    def test_all_devices_ok_and_report_saved(self):
        res = diag.diagnose_all(self.cfg, self.pts, hb_wait=2.2)
        self.assertEqual(res["state"], diag.OK, [(d["name"], d["summary"]) for d in res["devices"]]); self.assertEqual(len(res["devices"]), len(self.cfg["devices"]))
        diag.print_result(res, self.out, detail=True); self.assertIn("모든 장비 통신 정상", self.out.getvalue()); self.assertIn("ESS.soc", self.out.getvalue())
        path = diag.save_report(res, os.path.join(self.td, "diag")); txt = open(path, encoding="utf-8").read()
        self.assertIn("현장 통신 진단 보고서", txt); self.assertIn("DG.status", txt); self.assertTrue(os.path.exists(path[:-5] + ".json"))

    def test_refused_port_and_outside_allowlist_explained(self):
        self.cfg["devices"]["DG"]["paths"] = [["127.0.0.1", 1], ["10.9.9.9", 502]]
        d = diag.diagnose_all(self.cfg, self.pts, only="DG", hb_wait=0.1)["devices"][0]
        self.assertEqual(d["state"], diag.BAD); self.assertIn("통신 불가", d["summary"])
        self.assertIn("포트 번호", d["paths"]["A"]["steps"][-1]["text"]); self.assertIn("allow", d["paths"]["B"]["steps"][-1]["text"])

    def test_one_path_down_is_degraded_not_failed(self):
        self.plant.down.add("B"); res = diag.diagnose_all(self.cfg, self.pts, only="FC", timeout=0.3, hb_wait=0.1); d = res["devices"][0]
        self.assertEqual(d["state"], diag.WARN); self.assertIn("경로 저하", d["summary"]); self.assertEqual(diag.RANK[res["state"]], 1)

    def test_wrong_order_type_scale_are_suggested(self):
        p = dict(tag="X.kw", device="ESS", fc=3, addr=60, type="f32", scale=1.0, unit="kW", lo=-550.0, hi=550.0, rw="r", order="ABCD")
        c = mb.Client("127.0.0.1", self.pa, self.units["ESS"], 0.3); c.write(60, mb.encode(-12.5, "f32", 1, "CDAB"))
        r = diag.read_point(c, p); self.assertEqual(r["state"], diag.WARN); self.assertIn("CDAB", r["note"])
        c.write(70, mb.encode(-20.0, "i16", 0.1)); r = diag.read_point(c, dict(p, addr=70, type="u16", scale=0.1)); self.assertIn("i16", r["note"])
        c.write(71, [5000]); r = diag.read_point(c, dict(p, addr=71, type="u16", scale=1.0)); self.assertIn("배율", r["note"]); c.close()
        self.assertEqual(diag.read_point(mb.Client("127.0.0.1", 1, 1, 0.2), p)["state"], diag.BAD)

    def test_heartbeat_freeze_detected(self):
        self.plant.tick = lambda dt: None
        d = diag.diagnose_all(self.cfg, self.pts, only="DG", hb_wait=0.3)["devices"][0]
        self.assertEqual(d["state"], diag.BAD); self.assertIn("생존 계수 정지", d["summary"])

    def test_hints_cover_common_errors(self):
        for err, word in (("장치 예외 응답 2 (주소 불가)", "40001"), ("장치 예외 응답 11 (게이트웨이 대상 무응답)", "RS-485"), ("TimeoutError: timed out", "ping"), ("???", "프레임 추적")):
            self.assertIn(word, " ".join(diag.hint(err)))
        self.assertEqual(diag.width("가a"), 3); self.assertEqual(diag.pad("가", 4), "가  ")

    def test_command_handshake_ok_noack_manual(self):
        self.assertTrue(diag.command_test(self.cfg, self.pts, "DG", "start", out=self.out)); self.assertIn("지령 규약 적합", self.out.getvalue())
        self.assertFalse(diag.command_test(self.cfg, self.pts, "DG", "start", out=self.out)); self.assertIn("이미 운전", self.out.getvalue())
        self.plant.no_ack.add("FC"); self.assertFalse(diag.command_test(self.cfg, self.pts, "FC", "start", wait=0.5, out=self.out))
        self.assertIn("cmd=0", self.out.getvalue()); self.assertEqual(int(self.plant.get("FC.cmd")), 0)                      # 실패한 지령은 취소된다
        self.plant.set("ELZ.mode", 1); self.assertFalse(diag.command_test(self.cfg, self.pts, "ELZ", "start", out=self.out)); self.assertIn("수동 모드", self.out.getvalue())
        self.assertFalse(diag.command_test(self.cfg, self.pts, "ESS", "start", out=self.out)); self.assertIn("지령 규약 점 없음", self.out.getvalue())

    def test_watch_scan_and_menu(self):
        self.assertEqual(diag.watch(self.cfg, self.pts, "ESS", "A", period=0.05, count=2, out=self.out), 2); self.assertIn("ESS.soc", self.out.getvalue())
        c = diag.client_for(self.cfg, "DG"); found = diag.scan_addresses(c, 3, 0, 12, self.out); c.close(); self.assertEqual(sorted(found), [0, 1, 2, 3, 4, 6, 10, 11])      # 대응표에 있는 주소만 응답(나머지는 예외 02)
        keys = iter(["8", "6", "4", "1", "A", "3", "4", "4", "5", "2", "", "3", "0", "5", "7", "1", "1", "아니오", "9", "0"])
        with contextlib.redirect_stdout(self.out): self.assertEqual(diag.menu(self.cfg, self.pts, os.path.join(self.td, "diag"), inp=lambda *_: next(keys), out=self.out), 0)
        txt = self.out.getvalue(); self.assertIn("대응표 정상", txt); self.assertIn("응답 주소", txt); self.assertIn("취소", txt)

    def test_main_demo_auto_and_bad_args(self):
        cfgp = os.path.join(ROOT, "config", "runtime.json"); rep = os.path.join(self.td, "rep")
        with contextlib.redirect_stdout(self.out), contextlib.redirect_stderr(self.out):
            self.assertEqual(diag.main([cfgp, "--auto", "--device", "NOPE"]), 2); self.assertEqual(diag.main([os.path.join(self.td, "none.json"), "--auto"]), 2)
            self.assertEqual(diag.main([cfgp, "--demo", "--auto", "--device", "PV", "--report", rep]), 0); 
        self.assertTrue(any(f.endswith(".html") for f in os.listdir(rep)))
        self.assertEqual(pm.validate(self.pts, self.cfg["devices"]), [])


if __name__ == "__main__":
    unittest.main()
