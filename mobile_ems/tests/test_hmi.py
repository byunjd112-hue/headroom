# -*- coding: utf-8 -*-
"""제어화면(HMI) 시험. 가상 장치 + 실행 엔진 + 웹 서버를 띄우고 HTTP와 Modbus TCP로 실제 동작을 확인한다."""
import json, os, shutil, sys, tempfile, time, unittest, urllib.request, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
from ifps_ems_rt.hmi.engine import Engine
from ifps_ems_rt.hmi.server import serve


class TestHmi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.td = tempfile.mkdtemp()
        for f in ("runtime.json", "pointmap.csv"): shutil.copy(os.path.join(ROOT, "config", f), cls.td)
        p = os.path.join(cls.td, "runtime.json"); cfg = json.load(open(p, encoding="utf-8"))
        cfg["ctrl_s"] = 3600; cfg["timeout_s"] = 0.3; cfg["hmi"] = {"pin_operator": "4321", "pin_engineer": "8765", "sbo_s": 5}
        with open(p, "w", encoding="utf-8") as f: json.dump(cfg, f, ensure_ascii=False)
        from test_rt import ensure_sample
        ensure_sample(os.path.join(ROOT, "results")); res = os.path.join(cls.td, "results"); os.makedirs(res)      # 시험이 개발 폴더의 모델을 바꾸지 않게 복사본을 쓴다
        for f in ("sample_site_data.csv", "model_load.npz", "model_pv.npz"): shutil.copy(os.path.join(ROOT, "results", f), res)
        cls.eng = Engine(p, sim=True, plan_dir=res); cls.eng.start(); cls.httpd = serve(cls.eng, "127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"; time.sleep(2.5)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.eng.stop(); shutil.rmtree(cls.td, ignore_errors=True)

    def req(self, path, body=None, tok=None):
        r = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST")
        if tok: r.add_header("X-EMS-Token", tok)
        try:
            with urllib.request.urlopen(r, timeout=5) as f: return f.status, json.loads(f.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def login(self, pin):
        return self.req("/api/login", {"pin": pin, "name": "시험"})[1]["token"]

    def wait(self, cond, limit=6.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < limit:
            s = self.req("/api/snapshot")[1]
            if cond(s): return s, time.monotonic() - t0
            time.sleep(0.2)
        self.fail("조건 미충족")

    def test_1_static_and_snapshot(self):
        with urllib.request.urlopen(self.base + "/", timeout=5) as f:
            html = f.read().decode(); self.assertIn("IFPS", html); self.assertIn("default-src 'self'", f.headers["Content-Security-Policy"])
        s = self.req("/api/snapshot")[1]
        self.assertEqual({n for n, d in s["devices"].items() if not d["slot"]}, {"DG", "FC", "ESS", "MTR", "ELZ", "PV", "GDG"}); self.assertTrue(all(d["link"] == "정상" for d in s["devices"].values() if not d["slot"]))
        self.assertEqual({n for n, d in s["devices"].items() if d["slot"]}, {"DG2", "FC2", "ESS2", "PV2"}); self.assertEqual({k: f["n"] for k, f in s["fleet"].items()}, {"DG": 1, "FC": 1, "ESS": 1, "PV": 1, "ELZ": 1})      # 추가 자리는 비어 있다
        self.assertGreater(s["kpi"]["load"], 30); self.assertEqual(s["me"]["role"], "viewer")
        self.assertGreater(len(self.req("/api/trend")[1]["rows"]), 0); self.assertGreater(len(self.req("/api/trace")[1]["rows"]), 0)
        self.assertEqual(self.req("/static/../../runtime.py")[0], 404)                                # 경로 이탈 차단

    def test_2_auth_and_roles(self):
        self.assertFalse(self.req("/api/login", {"pin": "0000"})[1]["ok"])
        self.assertEqual(self.req("/api/select", {"dev": "DG", "cmd": "start"})[0], 403)             # 조회 권한으로 지령 불가
        op = self.login("4321")
        self.assertEqual(self.req("/api/sim", {"action": "mute", "target": "DG"}, op)[0], 403)        # 운용자는 고장 주입 불가
        self.assertEqual(self.req("/api/mb/write", {"dev": "DG", "addr": 40, "values": [1]}, op)[0], 403)

    def test_3_sbo_command_with_ack(self):
        op = self.login("4321"); r = self.req("/api/select", {"dev": "DG", "cmd": "stop"}, op)[1]
        self.assertFalse(r["ok"]); self.assertIn("중복", r["why"])                                    # 정지 중 정지 = 중복 지령 차단
        sid = self.req("/api/select", {"dev": "DG", "cmd": "start"}, op)[1]["sid"]
        self.assertFalse(self.req("/api/operate", {"sid": "bogus"}, op)[1]["ok"])
        self.assertTrue(self.req("/api/operate", {"sid": sid}, op)[1]["ok"])
        self.assertFalse(self.req("/api/operate", {"sid": sid}, op)[1]["ok"])                         # 한 번 쓴 선택은 재사용 불가
        s, dt = self.wait(lambda s: s["devices"]["DG"]["on"]); self.assertLess(dt, 3.0)
        self.assertEqual(int(self.eng.plant.get("DG.status")), 1); self.assertTrue(any("응답 확인" in c["text"] for c in s["cmdlog"]))
        sid = self.req("/api/select", {"dev": "DG", "cmd": "stop"}, op)[1]["sid"]; self.req("/api/operate", {"sid": sid}, op)
        self.wait(lambda s: not s["devices"]["DG"]["on"])
        r = self.req("/api/select", {"dev": "FC", "cmd": "set", "tag": "FC.kw_set", "value": 500}, op)[1]
        self.assertFalse(r["ok"]); self.assertIn("범위", r["why"])                                     # 설정 범위 검사

    def test_4_fault_injection_alarms_and_parallel_scan(self):
        en = self.login("8765"); op = self.login("4321")
        self.assertTrue(self.req("/api/sim", {"action": "down", "target": "A", "on": True}, en)[1]["ok"])
        s, _ = self.wait(lambda s: s["devices"]["DG"]["link"] == "경로 저하")
        self.req("/api/sim", {"action": "mute", "target": "ESS", "on": True}, en)
        s, dt = self.wait(lambda s: s["devices"]["ESS"]["link"] == "두절"); self.assertLess(dt, 3.5)   # 두절 감지 3초 한도(+폴링)
        self.assertTrue(any(a["key"] == "link.ESS" and a["prio"] == 1 for a in s["alarms"]))
        self.assertLess(s["stats"]["last_ms"], 600)                                                    # 병렬 수집: 무응답 장치가 있어도 시간 초과 1회 안
        self.req("/api/sim", {"action": "scenario", "name": "normal"}, en)
        s, _ = self.wait(lambda s: all(d["link"] == "정상" for d in s["devices"].values() if not d["slot"]))
        n = self.req("/api/ack", {"ids": "all"}, op)[1]["n"]; self.assertGreater(n, 0)
        s = self.req("/api/snapshot")[1]; self.assertFalse(any(a["key"] == "link.ESS" for a in s["alarms"]))  # 복귀+확인 = 목록에서 사라짐

    def test_5_register_explorer_and_audit(self):
        op = self.login("4321"); en = self.login("8765")
        r = self.req("/api/mb/read?dev=DG&path=B&fc=3&addr=0&count=5", tok=op)[1]
        self.assertTrue(r["ok"]); self.assertEqual(len(r["regs"]), 5); self.assertEqual(r["tags"]["4"], "DG.kw")
        self.assertTrue(self.req("/api/mb/write", {"dev": "DG", "path": "A", "fc": 16, "addr": 40, "values": [7, 8]}, en)[1]["ok"])
        self.assertEqual(self.req("/api/mb/read?dev=DG&path=A&fc=3&addr=40&count=2", tok=op)[1]["regs"], [7, 8])
        r = self.req("/api/mb/read?host=8.8.8.8&port=502&unit=1&fc=3&addr=0&count=1", tok=op)[1]
        self.assertFalse(r["ok"]); self.assertIn("허용 목록", r["why"])                                  # 직접 접속도 허용 목록 검사
        v = self.req("/api/audit/verify")[1]; self.assertTrue(v["ok"], v["msg"])
        self.assertTrue(any("레지스터 쓰기" in (e["data"].get("text", "")) for e in self.req("/api/audit?n=50", tok=self.login("4321"))[1]["rows"]))

    def test_6_auto_control_runs(self):
        op = self.login("4321"); self.req("/api/control_now", {}, op)
        s, _ = self.wait(lambda s: s["decision"] is not None)
        self.assertIn("DG", s["decision"]["want"]); self.assertEqual(len(s["decision"]["action"]), 3)
        self.assertEqual(self.req("/api/snapshot")[1]["stats"]["n_over"], 0)

    def test_7_forecast_accuracy_and_energy(self):
        t0 = time.monotonic()
        while time.monotonic() - t0 < 180:                                   # 첫 기동에는 별도 프로세스의 학습이 끝난 뒤에 예측이 나온다
            f = self.req("/api/forecast")[1]
            if f.get("ok"): break
            time.sleep(0.5)
        self.assertTrue(f["ok"], f.get("why")); self.assertEqual(len(f["load"]), 96); self.assertEqual(len(f["pv_act"]), 96)
        self.assertTrue(all(lo <= hi for lo, hi in zip(f["load_lo"], f["load_hi"])))
        self.assertLess(f["acc"]["load_nmae"], 15.0); self.assertLess(f["acc"]["pv_nmae"], 15.0); self.assertGreaterEqual(f["acc"]["load_cov"], 70.0)
        self.assertEqual(len(f["daily"]), 14)
        e = self.req("/api/energy")[1]; self.assertEqual(len(e["hours"]), 24)
        s = self.req("/api/snapshot")[1]["energy"]; self.assertGreater(s["load"], 0.0)                 # 금일 부하 전력량 적산

    def test_8_breaker_trip_shown_and_deenergizes_feeder(self):
        en = self.login("8765"); op = self.login("4321")
        self.assertTrue(self.req("/api/sim", {"action": "fault", "target": "L3", "code": 51}, en)[1]["ok"])
        s, dt = self.wait(lambda s: (s["values"]["CB.L3"]["v"] or 0) > 1.5 and s["values"]["LOAD.p3_kw"]["v"] == 0.0)
        a = [x for x in s["alarms"] if x["key"] == "cb.trip.L3"]; self.assertTrue(a); self.assertIn("51 한시 과전류", a[0]["text"])
        self.assertEqual(s["values"]["FLT.L3"]["v"], 51.0); self.assertGreater(s["values"]["BUS.b_v"]["v"], 400)   # 급전선 고장은 모선을 살려 둔다
        self.req("/api/sim", {"action": "cb", "target": "L3", "on": True}, en)
        s, _ = self.wait(lambda s: s["values"]["CB.L3"]["v"] == 1.0 and s["values"]["LOAD.p3_kw"]["v"] > 0)
        self.req("/api/ack", {"ids": "all"}, op); s = self.req("/api/snapshot")[1]
        self.assertFalse(any(x["key"] == "cb.trip.L3" for x in s["alarms"]))
        with urllib.request.urlopen(self.base + "/sld.js", timeout=5) as f: self.assertIn("sldUpdate", f.read().decode())

    def test_9_layout_edit_persist_and_validate(self):
        items = [{"uid": "a", "kind": "ESS", "bind": "ESS", "name": "ESS #1", "x": 500, "y": 300}, {"uid": "b", "kind": "BARRACK", "bind": "L2", "name": "막사 #1", "x": 900, "y": 780},
                 {"uid": "c", "kind": "BARRACK", "bind": "L3", "name": "막사 #2", "x": 1000, "y": 800}, {"uid": "d", "kind": "FSU", "bind": "", "name": "FSU-1", "x": 700, "y": 600}]
        self.assertEqual(self.req("/api/layout", {"items": items})[0], 403)                            # 조회 권한으로 배치 변경 불가
        op = self.login("4321")
        r = self.req("/api/layout", {"items": items}, op)[1]; self.assertTrue(r["ok"]); rev = r["rev"]
        lay = self.req("/api/layout")[1]; self.assertEqual(lay["rev"], rev); self.assertEqual(sum(1 for i in lay["items"] if i["kind"] == "BARRACK"), 2)
        self.assertEqual(self.req("/api/layout", {"items": items + [{"uid": "e", "kind": "TANK", "bind": "", "x": 1, "y": 1}]}, op)[0], 400)      # 정의되지 않은 종류
        self.assertEqual(self.req("/api/layout", {"items": [dict(items[0], x=5000)]}, op)[0], 400)                                               # 좌표 범위
        self.assertEqual(self.req("/api/layout", {"items": [items[0], dict(items[1], uid="a")]}, op)[0], 400)                                    # 식별자 중복
        self.assertTrue(any("배치 변경" in e["data"].get("text", "") for e in self.req("/api/audit?n=50", tok=self.login("4321"))[1]["rows"]))
        self.assertTrue(self.req("/api/layout/reset", {}, op)[1]["ok"]); self.assertIsNone(self.req("/api/layout")[1]["items"])

    def test_10_security_lockout_hash_and_gate(self):
        from ifps_ems_rt.hmi.engine import pin_hash, pin_verify
        h = pin_hash("482915"); self.assertTrue(pin_verify("482915", h)); self.assertFalse(pin_verify("482916", h)); self.assertNotIn("482915", h)
        eng = self.eng; src = "10.9.9.9"
        for _ in range(eng.LOCK_N): self.assertFalse(eng.login("0000", "공격", src)["ok"])
        r = eng.login("4321", "운용", src); self.assertFalse(r["ok"]); self.assertIn("잠금", r["why"])          # 잠금 중에는 맞는 PIN도 거부
        self.assertTrue(eng.login("4321", "운용", "10.9.9.8")["ok"])                                            # 다른 출처는 영향 없음
        eng.fail.clear()
        kp = os.path.join(eng.rt.state_dir, "audit.key"); self.assertTrue(os.path.exists(kp))
        if os.name == "posix": self.assertEqual(os.stat(kp).st_mode & 0o777, 0o600)
        bad, warn = eng.security_check(); self.assertEqual(bad, []); self.assertTrue(any("평문" in w for w in warn))   # 개발 모드: 경고만
        eng.cfg["run_mode"] = "운용"
        try:
            bad, _ = eng.security_check(); self.assertTrue(any("평문" in b for b in bad)); self.assertTrue(any("가상 장치" in b for b in bad))
        finally:
            eng.cfg["run_mode"] = "개발"
        with urllib.request.urlopen(self.base + "/", timeout=5) as f: self.assertIn("camera=()", f.headers["Permissions-Policy"])

    def test_11_all_units_load_shed_elz_pv(self):
        op = self.login("4321"); s = self.req("/api/snapshot")[1]
        self.assertTrue(s["devices"]["ELZ"]["ctl"]); self.assertTrue(s["devices"]["PV"]["ctl"])               # 수전해·PV 인버터도 지령 대상
        def run(body):
            r = self.req("/api/select", body, op)[1]; self.assertTrue(r.get("ok"), r); self.assertTrue(self.req("/api/operate", {"sid": r["sid"]}, op)[1]["ok"])
        r = self.req("/api/select", {"dev": "MTR", "cmd": "set", "tag": "LDS.L1", "value": 2}, op)[1]
        self.assertFalse(r["ok"])                                                                             # 1등급 부하는 차단 지령 점이 없음
        run({"dev": "MTR", "cmd": "set", "tag": "LDS.L3", "value": 2})
        s, _ = self.wait(lambda s: s["values"]["CB.L3"]["v"] == 0.0 and s["values"]["LOAD.p3_kw"]["v"] == 0.0)
        run({"dev": "MTR", "cmd": "set", "tag": "LDS.L3", "value": 1}); self.wait(lambda s: s["values"]["CB.L3"]["v"] == 1.0)
        if not s["devices"]["ELZ"]["on"]:
            run({"dev": "ELZ", "cmd": "start"}); s, _ = self.wait(lambda s: s["devices"]["ELZ"]["on"] and (s["values"]["ELZ.kw"]["v"] or 0) > 100)
        run({"dev": "ELZ", "cmd": "stop"}); self.wait(lambda s: not s["devices"]["ELZ"]["on"])
        run({"dev": "PV", "cmd": "stop"}); self.wait(lambda s: not s["devices"]["PV"]["on"])
        run({"dev": "PV", "cmd": "start"}); self.wait(lambda s: s["devices"]["PV"]["on"])


if __name__ == "__main__":
    unittest.main()
