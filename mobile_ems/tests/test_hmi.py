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

    def test_replay_feeds_imported_values_to_the_plant(self):
        """가상 자료 가져오기 · 재생: CSV 의 값을 시간 순서대로 가상 장치에 넣고, 멈추면 가상 장치가 다시 스스로 값을 만든다."""
        from ifps_ems_rt.hmi import simreplay
        e = self.eng; by = e.plant.by_tag
        d = simreplay.parse("t,LOAD.p1_kw,pv_kw,plan\n0,31,77,1\n60,33,,1\n120,35,12,1\n", by); self.assertEqual(d["tags"], ["LOAD.p1_kw", "PV.kw"]); self.assertEqual(d["skipped"], ["plan"]); self.assertEqual(d["rows"][1], (60.0, {"LOAD.p1_kw": 33.0}))
        d2 = simreplay.parse("ts,load_kw\n2026-05-01 13:00,80\n2026-05-01 13:15,90\n", by); self.assertEqual([r[0] for r in d2["rows"]], [0.0, 900.0])
        for bad in ("t,NOPE.x\n0,1\n", "t,DG.status\n0,1\n", "t,PV.kw\n0,abc\n", "t,PV.kw\n0,99999\n", "t,PV.kw\n10,1\n5,2\n", "t,PV.kw\n", "t,ESS.kw_set\n0,1\n"):
            with self.assertRaises(ValueError, msg=bad): simreplay.parse(bad, by)
        r = e.sim_action({"action": "replay", "op": "start", "text": "t,LOAD.p1_kw,PV.kw\n0,31,77\n60,33,66\n120,35,12\n", "name": "시험.csv", "speed": 60, "loop": False}, "시험")
        self.assertTrue(r["sim"]["replay"]["on"]); e.simdrv.step(); self.assertAlmostEqual(e.plant.get("LOAD.p1_kw"), 31.0, places=1); self.assertAlmostEqual(e.plant.get("PV.kw"), 77.0, places=1)
        time.sleep(2.4); e.simdrv.step(); st = e.sim_state()["replay"]; self.assertTrue(st["done"]); self.assertAlmostEqual(e.plant.get("LOAD.p1_kw"), 35.0, places=1); self.assertAlmostEqual(e.plant.get("PV.kw"), 12.0, places=1)
        with self.assertRaises(ValueError): e.sim_action({"action": "replay", "op": "start", "text": "t,PV.kw\n0,1\n", "speed": 7}, "시험")
        e.sim_action({"action": "replay", "op": "stop"}, "시험"); self.assertFalse(e.sim_state()["replay"]["on"]); self.assertNotIn("LOAD.p1_kw", e.simdrv.hold); self.assertNotIn("PV.kw", e.simdrv.hold)

    def test_load_book_changes_follow_everywhere(self):
        """부하 관리: 종류 · 수량을 바꾸면 스냅샷(모든 화면의 자료) · 가상 부하 배율 · 절감 가능 비율 · 저장 파일이 함께 바뀐다. 틀린 입력은 막는다."""
        from ifps_ems_rt import loads
        e = self.eng; tok = self.login("4321"); v0 = e.snapshot()["loads"]; self.assertEqual([i["id"] for i in v0["items"]], ["c2", "med", "brk", "ammo"]); self.assertEqual([g["rated"] for g in v0["grades"]], [30.0, 40.0, 20.0])
        self.assertEqual(self.req("/api/loads", {"op": "count", "id": "brk", "delta": 1})[0], 403)                                     # 로그인 없이 못 바꾼다
        try:
            r = self.req("/api/loads", {"op": "count", "id": "brk", "delta": 1}, tok)[1]; self.assertTrue(r["ok"]); g2 = r["loads"]["grades"][1]; self.assertEqual((g2["n"], g2["rated"]), (4, 52.0))
            self.assertAlmostEqual(e.plant.load_scale[2], 52.0 / 40.0); self.assertAlmostEqual(e.rt.load_frac["L2"], (16 * 0.1 + 36 * 0.3) / 52.0)
            r = self.req("/api/loads", {"op": "add", "kind": "hvac"}, tok)[1]; nid = r["loads"]["items"][-1]["id"]; self.assertEqual(r["loads"]["items"][-1]["feeder"], "L3"); self.assertEqual(r["loads"]["items"][-1]["spr"], "BARRACK")
            r = self.req("/api/loads", {"op": "set", "id": nid, "name": "냉난방 A", "grade": 2, "kw": 10, "save_pct": 60}, tok)[1]; it = r["loads"]["items"][-1]; self.assertEqual((it["name"], it["grade"], it["feeder"], it["rated"]), ("냉난방 A", 2, "L2", 10.0))
            for bad in ({"op": "count", "id": "brk", "delta": 30}, {"op": "set", "id": "c2", "save_pct": 20}, {"op": "set", "id": nid, "kw": 0}, {"op": "set", "id": "ammo", "kw": 300}, {"op": "add", "kind": "nope"}, {"op": "del", "id": "nope"}):
                self.assertFalse(self.req("/api/loads", bad, tok)[1]["ok"], bad)                                                    # 수량 · 1등급 절감 · 정격 · 계측 범위 초과 · 모르는 종류
            self.assertEqual(json.load(open(e.loadw.path, encoding="utf-8"))["rev"], e.loadw.rev); self.assertTrue(any(x["kind"] == "부하" for x in e.rt.events))
            snap = e.snapshot()["loads"]; self.assertEqual(len(snap["items"]), 5); self.assertTrue(all(i["est_kw"] is not None for i in snap["items"])); self.assertIn(snap["grades"][2]["stage"], ("on", "save", "off"))
            self.assertAlmostEqual(sum(i["est_kw"] for i in snap["items"] if i["feeder"] == "L2"), e.rt.val["LOAD.p2_kw"], delta=0.2)   # 추정 전력의 합 = 급전선 계측값
            at = {i["id"]: (i["fsu"], i["need"], i["fsu_auto"]) for i in snap["items"]}; ff = [f["id"] for f in snap["fsus"]]
            self.assertEqual((at["c2"], at["med"], at["ammo"]), (("FSU2", 4, True), ("FSU4", 1, True), ("FSU6", 1, True)))                                     # 종류에 따른 구간분전함(자동), 부하 앞 배전체계: 30 kW 는 20 kW 2대 병렬 + 1등급이라 한 대 더
            self.assertEqual(at["brk"][1], 3); self.assertNotEqual(at[nid][0], "FSU4")                                                                         # 막사 3동은 동마다 1대. 출력 4회로가 다 찬 구간분전함 대신 가까운 곳으로
            self.assertEqual((snap["ppdu_kw"], snap["fsu_a"], snap["fsu_out"]), (20.0, 630.0, 4)); full = lambda: all(len(i["ppdus"]) == i["need"] for i in e.snapshot()["loads"]["items"]) or len(e.snapshot()["ring"]["ppdu"]) == 18; t0 = time.time()
            while not full() and time.time() - t0 < 12.0: time.sleep(0.3)
            self.assertTrue(full())   # 가상 장치가 목록대로 배전체계를 놓는다(자리 18개까지)
            free = next(f for f in ff if f not in {i["fsu"] for i in snap["items"]})
            r = self.req("/api/loads", {"op": "set", "id": "ammo", "grade": 1, "save_pct": 0, "fsu": free}, tok)[1]; it = next(i for i in r["loads"]["items"] if i["id"] == "ammo")
            self.assertEqual((it["feeder"], it["fsu"], it["fsu_auto"]), ("L1", free, False))                                                       # 등급 · 자리를 바꾸면 급전선과 구간분전함이 따라간다(배전체계 없는 구간분전함에도 물린다)
            self.assertFalse(self.req("/api/loads", {"op": "set", "id": "ammo", "fsu": "../x"}, tok)[1]["ok"])
            r = self.req("/api/loads", {"op": "place", "at": {"med": "FSU2"}, "names": {"med": "의무대"}}, tok)[1]; it = next(i for i in r["loads"]["items"] if i["id"] == "med")      # 개요 배치 저장: 옮긴 자리 · 고친 이름
            self.assertEqual((it["fsu"], it["name"], it["fsu_auto"]), ("FSU2", "의무대", False)); self.assertFalse(self.req("/api/loads", {"op": "place", "at": {}, "names": {}}, tok)[1]["ok"])
            r = self.req("/api/loads", {"op": "set", "id": "ammo", "fsu": "FSU19"}, tok)[1]; it = next(i for i in r["loads"]["items"] if i["id"] == "ammo"); self.assertTrue(it["fsu_auto"])   # 지금 없는 구간분전함이면 자동으로 붙인다
            self.assertTrue(self.req("/api/loads", {"op": "del", "id": nid}, tok)[1]["ok"])
            from ifps_ems_rt.hmi.loadctl import LoadBook
            b2 = LoadBook(e); self.assertEqual([i["n"] for i in b2.items], [1, 1, 3, 1])                                             # 다시 켜도 그대로
        finally:
            self.assertTrue(self.req("/api/loads", {"op": "reset"}, tok)[1]["ok"]); self.assertEqual(e.plant.load_scale, {1: 1.0, 2: 1.0, 3: 20.0 / 27.5})      # 3등급 곡선(최대 25 kW)은 기본 정격 20 kW 에서 최대 약 18 kW
        self.assertEqual(loads.check([dict(loads.DEFAULT[0], grade=1, save_pct=10)]), ["1번째(지휘통제(C2)): 1등급 부하는 절감하지 않는다(절감 비율 0)"])
        st = {"L1": "on", "L2": "save", "L3": "off"}; sh = loads.share(loads.DEFAULT, {"L1": 28.0, "L2": 30.0, "L3": 0.0}, st); self.assertEqual(sh["ammo"], 0.0); self.assertAlmostEqual(sh["med"] + sh["brk"], 30.0)

    def test_bus_plan_and_layout_scale(self):
        """모선 구성을 바꾸면 스냅샷 · 가상 장치의 모선 전압 계산이 따라가고(엔지니어만), 배치의 크기 값이 저장된다."""
        e = self.eng; op = self.login("4321"); en = self.login("8765"); b0 = e.snapshot()["bus"]; self.assertEqual(b0["assign"]["G1"], "A"); self.assertEqual(b0["issues"], [])      # 기본 구성은 약점이 없다
        self.assertFalse(self.req("/api/bus", {"op": "set", "node": "G1", "bus": "A"}, op)[1]["ok"])                                  # 운용자는 바꾸지 못한다
        try:
            r = self.req("/api/bus", {"op": "set", "node": "G1", "bus": "B"}, en)[1]; self.assertEqual([i["level"] for i in r["bus"]["issues"]], ["warn"])          # 복합전력 ESS 를 모선 B 로 옮기면 모선 A 에 계통 형성 전원이 없어진다
            r = self.req("/api/bus", {"op": "auto"}, en)[1]; self.assertTrue(r["ok"]); self.assertEqual(r["bus"]["assign"]["G1"], "A"); self.assertEqual(r["bus"]["issues"], []); self.assertEqual(e.plant.bus["G1"], "A")
            self.assertFalse(self.req("/api/bus", {"op": "auto"}, en)[1]["ok"]); self.assertFalse(self.req("/api/bus", {"op": "set", "node": "X", "bus": "A"}, en)[1]["ok"])
            r = self.req("/api/bus", {"op": "set", "node": "ESS", "bus": "A"}, en)[1]; self.assertTrue(any(i["bus"] == "B" for i in r["bus"]["issues"]))
            self.assertEqual(json.load(open(e.busw.path, encoding="utf-8"))["assign"]["ESS"], "A"); self.assertTrue(any(x["kind"] == "모선" for x in e.rt.events))
        finally:
            self.assertTrue(self.req("/api/bus", {"op": "reset"}, en)[1]["ok"]); self.assertEqual(e.plant.bus, e.snapshot()["bus"]["default"])
        b = e.snapshot()["bus"]; self.assertEqual([s["id"] for s in b["sources"]], ["GRID", "PV", "DG", "FC", "GDG", "ESS", "G1"])                      # 창에는 전원 한 대 한 대, 부하 하나하나가 줄로 나온다
        self.assertEqual({x["id"]: (x["bus"], x["fsu"]) for x in b["loads"]}, {"c2": ("A", "FSU2"), "med": ("A", "FSU4"), "brk": ("A", "FSU4"), "ammo": ("B", "FSU6")})   # 부하의 모선 = 물린 구간분전함이 평소에 받는 쪽(상시 개방점 앞 = A)
        try:
            r = self.req("/api/bus", {"op": "load", "id": "med", "bus": "B"}, en)[1]; self.assertTrue(r["ok"], r); m = next(x for x in r["bus"]["loads"] if x["id"] == "med"); self.assertEqual((m["bus"], m["fsu"]), ("B", "FSU5"))   # 부하 하나의 모선을 바꾸면 그쪽 구간분전함으로 옮겨진다
            self.assertEqual(next(i for i in e.snapshot()["loads"]["items"] if i["id"] == "med")["fsu"], "FSU5"); self.assertFalse(self.req("/api/bus", {"op": "load", "id": "med", "bus": "B"}, en)[1]["ok"]); self.assertFalse(self.req("/api/bus", {"op": "load", "id": "nope", "bus": "A"}, en)[1]["ok"])
            r = self.req("/api/loads", {"op": "split", "id": "brk"}, op)[1]; self.assertTrue(r["ok"], r); bk = [i for i in r["loads"]["items"] if i["kind"] == "barrack"]                # 막사 ×2 를 하나씩 나눈다 → 하나마다 구간분전함 · 모선을 따로
            self.assertEqual([(i["name"], i["n"]) for i in bk], [("막사 #1", 1), ("막사 #2", 1)]); self.assertFalse(self.req("/api/loads", {"op": "split", "id": bk[0]["id"]}, op)[1]["ok"])
            r = self.req("/api/bus", {"op": "load", "id": bk[1]["id"], "bus": "B"}, en)[1]; self.assertTrue(r["ok"], r); self.assertEqual({x["name"]: x["bus"] for x in r["bus"]["loads"] if x["name"].startswith("막사")}, {"막사 #1": "A", "막사 #2": "B"})
        finally: self.assertTrue(self.req("/api/loads", {"op": "reset"}, op)[1]["ok"])
        lay = e.layout(); items = lay.get("items") or [{"uid": "a", "kind": "DG", "bind": "G1", "name": "발전", "x": 300.4, "y": 400.26}]
        items = [dict(i) for i in items]; items[0]["s"] = 0.55; items[0]["x"] = 301.23; r = self.req("/api/layout", {"items": items}, op)[1]; self.assertTrue(r["ok"], r)
        try:
            got = e.layout()["items"][0]; self.assertEqual((got["s"], got["x"]), (0.55, 301.2)); items[0]["s"] = 9; self.req("/api/layout", {"items": items}, op); self.assertEqual(e.layout()["items"][0]["s"], 1.6)   # 범위 밖 크기는 한도로
        finally: self.req("/api/layout/reset", {}, op)

    def test_reduce_command_scales_the_virtual_load(self):
        """절감 공급 지령(LDS = 3): 가상 부하가 절감 비율만큼 줄고 차단기는 그대로다. 복구(1)하면 돌아온다. 화면 상태도 따라간다."""
        e = self.eng; p = e.plant; self.assertEqual(int(p.get("CB.L3")), 1); fr = p.save_frac["L3"]; self.assertGreater(fr, 0)
        e._do_cmd({"dev": "MTR", "cmd": "set", "tag": "LDS.L3", "value": 3.0, "who": "시험"}); time.sleep(0.4); e.simdrv.step(); time.sleep(1.3)
        self.assertIn("L3", p.save); self.assertEqual(int(p.get("CB.L3")), 1); self.assertEqual(e.snapshot()["loads"]["grades"][2]["stage"], "save")
        e._do_cmd({"dev": "MTR", "cmd": "set", "tag": "LDS.L3", "value": 1.0, "who": "시험"}); time.sleep(0.4); self.assertNotIn("L3", p.save); time.sleep(1.3); self.assertEqual(e.snapshot()["loads"]["grades"][2]["stage"], "on")

    def test_late_operator_command_is_dropped(self):
        """앞선 지령에 밀려 늦어진 운용자 지령은 버린다(잊은 지령이 뒤늦게 나가지 않게)."""
        e = self.eng; n0 = len(e.rt.cmd.log); on = e.rt.dev["FC"].on
        e._do_cmd({"dev": "FC", "cmd": "stop" if on else "start", "who": "시험", "exp": time.monotonic() - 30.0})
        self.assertIn("버림", e.rt.cmd.log[-1]["text"]); self.assertEqual(len(e.rt.cmd.log), n0 + 1); self.assertEqual(e.rt.dev["FC"].on, on)

    def test_1_static_and_snapshot(self):
        with urllib.request.urlopen(self.base + "/", timeout=5) as f:
            html = f.read().decode(); self.assertIn("IFPS", html); self.assertIn("default-src 'self'", f.headers["Content-Security-Policy"])
        s = self.req("/api/snapshot")[1]
        self.assertEqual({n for n, d in s["devices"].items() if not d["slot"]}, {"DG", "FC", "ESS", "MTR", "ELZ", "PV", "GDG"}); self.assertTrue(all(d["link"] == "정상" for d in s["devices"].values() if not d["slot"]))
        self.assertEqual({n for n, d in s["devices"].items() if d["slot"]}, {f"{k}{j}" for k, m in (("DG", 4), ("FC", 4), ("ESS", 4), ("PV", 5), ("ELZ", 4)) for j in range(2, m + 1)}); self.assertEqual({k: f["n"] for k, f in s["fleet"].items()}, {"DG": 1, "FC": 1, "ESS": 1, "PV": 1, "ELZ": 1})      # 추가 자리는 비어 있다
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
        from ifps_ems_rt.hmi.engdefs import pin_hash, pin_verify
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
