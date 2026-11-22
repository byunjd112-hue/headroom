# -*- coding: utf-8 -*-
"""같은 종류 주 장치 여러 대의 자동 인식: 대응표 본뜨기, 합산, 빈 자리, 지령·설정값 분배, 화면용 자료."""
import os, shutil, sys, tempfile, time, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from ifps_ems_rt import fleet, pointmap as pm              # noqa: E402
from ifps_ems_rt.hmi.engine import Engine                   # noqa: E402


class FleetUnitTest(unittest.TestCase):
    def test_kind_slot_and_pointmap_expand(self):
        self.assertEqual([fleet.kind(n) for n in ("DG", "DG2", "ESS3", "MTR", "GDG", "GDG2", "DG10")], ["DG", "DG", "ESS", None, None, None, None])
        self.assertEqual([fleet.is_slot(n) for n in ("DG", "DG2", "MTR")], [False, True, False])
        dev = {n: {} for n in ("DG", "FC", "ESS", "MTR", "ELZ", "PV", "GDG", "DG2", "FC2")}; pts = pm.load(os.path.join(ROOT, "config", "pointmap.csv"), dev); tags = {p["tag"]: p for p in pts}
        self.assertEqual((tags["DG2.kw"]["device"], tags["DG2.kw"]["addr"], tags["DG2.cmd"]["rw"]), ("DG2", tags["DG.kw"]["addr"], "w"))      # 주소는 같고 장치만 다르다
        self.assertNotIn("FC2.nm3", tags); self.assertEqual(sum(1 for p in pts if p["tag"] == "H2.nm3"), 1); self.assertEqual(pm.validate(pts, dev), [])   # 공용 계측은 본뜨지 않는다
        self.assertEqual(len(fleet.expand(pts, dev)), len(pts))                                                                     # 이미 줄이 있으면 다시 넣지 않는다

    def test_merge_sum_any_mean_and_empty_slot(self):
        f = fleet.Fleet(["DG", "DG2", "ESS", "ESS2", "MTR"]); val = {}; seen = []; mark = lambda tag, ok: seen.append((tag, ok)); st = {"DG": "정상", "DG2": "정상", "ESS": "정상", "ESS2": "정상"}
        self.assertEqual((f.live("DG"), f.n("DG"), f.live("MTR")), (["DG"], 1, ["MTR"]))                                             # 아직 읽기 전: 한 대로 본다
        f.merge({"DG": {"DG.kw": 90.0, "DG.status": 1.0}, "DG2": None, "ESS": {"ESS.kw": -20.0, "ESS.soc": 60.0, "ESS.status": 1.0}, "ESS2": {"ESS2.kw": -10.0, "ESS2.soc": 40.0, "ESS2.status": 0.0}}, st, val, mark)
        self.assertEqual((f.live("DG"), f.live("ESS"), f.empty("DG2"), f.empty("ESS2")), (["DG"], ["ESS", "ESS2"], True, False))
        self.assertEqual((val["DG.kw"], val["ESS.kw"], val["ESS.soc"], val["ESS.status"]), (90.0, -30.0, 50.0, 1.0)); self.assertIn(("ESS.soc", True), seen)
        self.assertEqual((f.running("ESS", val), f.running("DG", val), f.share("ESS"), f.share("DG"), f.share("MTR")), (1, 1, 2, 1, 1))                 # 운전 중인 대수와 설정값을 나눌 대수
        del seen[:]; f.merge({"ESS": {"ESS.kw": -5.0, "ESS.status": 1.0}, "ESS2": {"ESS2.kw": -5.0, "ESS2.soc": 41.0, "ESS2.status": 1.0}}, st, val, mark, bad={"ESS.soc"})
        self.assertEqual((val["ESS.soc"], val["ESS.kw"]), (50.0, -10.0)); self.assertIn(("ESS.soc", False), seen)                                       # 검사에서 떨어진 값이 낀 합산은 하지 않는다(직전 값 유지, 품질 불량 표시)
        del seen[:]; f.merge({"ESS": None, "ESS2": {"ESS2.kw": -99.0, "ESS2.soc": 41.0, "ESS2.status": 1.0}}, st, val, mark); self.assertEqual((val["ESS.kw"], seen), (-10.0, []))   # 한 대를 이번에 읽지 못하면 묵은 값으로 합산하지 않는다
        f.merge({"ESS": {"ESS.kw": -20.0, "ESS.soc": 60.0, "ESS.status": 1.0}, "ESS2": {"ESS2.kw": -10.0, "ESS2.soc": 40.0, "ESS2.status": 0.0}}, st, val, mark)
        self.assertEqual((f.unit("ESS", "kw", val), f.unit("ESS2", "soc", val)), (-20.0, 40.0))                                      # 장치별 값은 따로 남는다
        f.merge({"DG": None, "DG2": {"DG2.kw": 45.0, "DG2.status": 1.0}}, dict(st, DG="두절"), val, mark)                      # 첫 장치가 끊기고 둘째만 있어도 종류 값이 나온다
        self.assertEqual((f.live("DG"), val["DG.kw"], f.share("DG")), (["DG2"], 45.0, 2)); v = f.view(dict(st, DG="두절"), {}, val)
        self.assertEqual((v["DG"]["n"], v["DG"]["seen"], v["DG"]["slots"], [u["id"] for u in v["DG"]["units"]], v["ESS"]["on"]), (1, 2, 2, ["DG", "DG2"], True))
        self.assertEqual(set(f.clean({"DG.kw": 1.0, "DG2.kw": 45.0, "ESS.kw": 2.0, "ESS2.kw": 3.0, "LOAD.kw": 9.0})), {"DG.kw", "DG2.kw", "ESS.kw", "ESS2.kw", "LOAD.kw"})                 # 종류 값(DG.kw)은 한 대라도 있으면 남긴다
        f.merge({"DG": None, "DG2": None}, dict(st, DG="두절", DG2="두절"), val, mark); self.assertEqual(set(f.clean({"DG.kw": 1.0, "DG2.kw": 45.0, "ESS.kw": 2.0, "LOAD.kw": 9.0})), {"ESS.kw", "LOAD.kw"})   # 그 종류가 한 대도 없으면 종류 값도 뺀다
        self.assertTrue(f.skip("ESS3", 0.0) is False and not f.skip("DG", 0.0)); g = fleet.Fleet(["PV", "PV2"]); self.assertFalse(g.skip("PV2", 0.0)); self.assertTrue(g.skip("PV2", 5.0)); self.assertFalse(g.skip("PV2", fleet.PROBE_S + 1))


class FleetLiveTest(unittest.TestCase):
    """가상 장치에 같은 종류 장치를 더 놓고 빼면서 인식·합산·지령 분배를 본다."""
    def setUp(self):
        self.td = tempfile.mkdtemp(); shutil.copytree(os.path.join(ROOT, "config"), os.path.join(self.td, "config"), ignore=shutil.ignore_patterns("state*", "backup"))
        self.eng = Engine(os.path.join(self.td, "config", "runtime.json"), sim=True); self.eng.start(); time.sleep(3.0)

    def tearDown(self):
        self.eng.stop(); shutil.rmtree(self.td, ignore_errors=True)

    def _wait(self, test, limit=25.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < limit:
            if test(): return True
            time.sleep(0.25)
        return False

    def test_unit_count_buttons_add_and_remove(self):
        """설비 제어 화면의 − · ＋: 가상 장치를 놓으면 조작 없이 인식되고, 빼면 두절 경보 없이 빈 자리로 돌아간다."""
        from ifps_ems_rt.hmi import unitctl
        e = self.eng; pv = lambda: e.snapshot()["fleet"]["PV"]; act = lambda: {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}
        self.assertTrue(self._wait(lambda: pv()["n"] == 1)); self.assertEqual(pv()["slots"], 5)
        for want in (2, 3):
            r = unitctl.change(e, "PV", 1, "시험"); self.assertTrue(r["ok"]); self.assertEqual(r["unit"], f"PV{want}")
            self.assertTrue(self._wait(lambda: pv()["n"] == want and len(pv()["units"]) == want), f"PV {want}대 인식")
        r = unitctl.change(e, "PV", -1, "시험"); self.assertEqual((r["ok"], r["unit"]), (True, "PV3"))
        self.assertTrue(self._wait(lambda: [u["id"] for u in pv()["units"]] == ["PV", "PV2"] and "PV3" not in e.rt.seen), "뺀 장치는 목록에서 사라진다")
        self.assertFalse([k for k in act() if k in ("link.PV3", "absent.PV3")], {"link": {n: (e.rt.lm.state.get(n), e.rt.links[n].err) for n in ("PV", "PV2", "PV3", "DG")}, "scan": (round(e.rt.max_scan_s, 2), e.rt.n_over, e.rt.n_scan), "events": [x["text"][:40] for x in e.rt.events[-14:]]})      # 일부러 뺀 장치는 두절 경보가 아니다(다른 장치의 경보는 여기서 보지 않는다 — 시험 장비가 느리면 흔들린다)
        time.sleep(7.0); self.assertEqual(unitctl.change(e, "PV", 1, "시험")["unit"], "PV3"); self.assertTrue(self._wait(lambda: pv()["n"] == 3)); time.sleep(3.0)      # 뺀 자리에 다시 놓을 수 있다
        self.assertFalse([x["text"] for x in e.rt.events if "PV3 생존 계수 정지" in x["text"]])                                       # 다시 놓을 때 묵은 생존 계수로 '정지' 경보가 뜨지 않는다
        self.assertEqual(e.rt.fleet.span("PV.kw", "MTR"), 3); self.assertEqual((e.rt.fleet.span("PV.kw", "PV"), e.rt.fleet.span("LOAD.kw", "MTR")), (1, 1))      # 게이트웨이가 재는 합계의 범위는 대수만큼 넓어진다
        for _ in range(2): self.assertTrue(unitctl.change(e, "PV", 1, "시험")["ok"])
        self.assertTrue(self._wait(lambda: pv()["n"] == 5)); self.assertFalse(unitctl.change(e, "PV", 1, "시험")["ok"])                          # 자리가 다 차면 알려 준다
        self.assertRaises(ValueError, unitctl.change, e, "MTR", 1, "시험"); self.assertRaises(ValueError, unitctl.change, e, "PV", 2, "시험")
        for _ in range(4): unitctl.change(e, "PV", -1, "시험")
        self.assertTrue(self._wait(lambda: len(pv()["units"]) == 1))

    def test_archive_follows_unit_changes(self):
        """장치를 놓고 빼도 기록 · 보고가 사실대로 남는다: 있는 장치의 값만 저장하고, 보고서에 장치 구성 표가 들어간다."""
        import io, zipfile
        from ifps_ems_rt import archdev
        from ifps_ems_rt.hmi import report, unitctl
        e = self.eng; rt = e.rt; pv = lambda: e.snapshot()["fleet"]["PV"]
        self.assertTrue(self._wait(lambda: pv()["n"] == 1)); unitctl.change(e, "PV", 1, "시험"); self.assertTrue(self._wait(lambda: pv()["n"] == 2 and "PV2.lim" in rt.val))
        c = rt.fleet.clean(rt.val); self.assertIn("PV2.lim", c); self.assertIn("PV.kw", c); self.assertNotIn("PV3.lim", c)                       # 있는 장치의 값은 남는다
        x = zipfile.ZipFile(io.BytesIO(report.build(e, e.archw.store, {"days": "1"})[1])).read("word/document.xml").decode("utf-8")
        for w in ("1.5 장치 구성", "2 / 5", "PV2 "): self.assertIn(w, x)                                                                          # 보고서: 인식 / 자리, 장치별 상태
        self.assertNotIn(">PV5<", x); self.assertNotIn(">DG4<", x)                                                                              # 빈 자리는 장치 상태 표에 적지 않는다
        self.assertTrue([t for t in rt.events if "PV 2대 인식" in t["text"]]); self.assertTrue([t for t in rt.events if "PV2 가상 장치 놓기" in t["text"]])      # 대수 변화가 기록에 남는다
        unitctl.change(e, "PV", -1, "시험"); self.assertTrue(self._wait(lambda: len(pv()["units"]) == 1 and pv()["n"] == 1))
        self.assertIn("PV2.lim", rt.val); c = rt.fleet.clean(rt.val); self.assertNotIn("PV2.lim", c); self.assertNotIn("PV2.status", c); self.assertIn("PV.kw", c); self.assertIn("LOAD.kw", c)      # 뺀 장치의 묵은 값은 저장하지 않는다
        self.assertTrue([t for t in rt.events if "PV2 빼기" in t["text"]])
        self.assertEqual((archdev._name("DG2"), archdev._name("ESS3"), archdev._name("DG"), archdev._name("FSU2")), ("디젤발전기 2", "ESS 3", "디젤발전기", "FSU2"))      # 장치별 자료의 이름

    def test_extra_units_are_recognized_summed_and_commanded(self):
        e = self.eng; rt = e.rt; fl = lambda: e.snapshot()["fleet"]; act = lambda: {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}
        self.assertTrue(self._wait(lambda: fl()["DG"]["n"] == 1 and fl()["ESS"]["n"] == 1)); self.assertFalse([k for k in act() if k.startswith(("link.", "absent."))])      # 빈 자리는 경보가 아니다
        self.assertRaises(ValueError, e.sim_action, {"action": "unit", "target": "MTR", "on": False}, "시험")
        for n in ("DG2", "ESS2", "PV2"): e.sim_action({"action": "unit", "target": n, "on": True}, "시험")
        self.assertTrue(self._wait(lambda: (fl()["DG"]["n"], fl()["ESS"]["n"], fl()["PV"]["n"]) == (2, 2, 2)))                                                # 조작 없이 인식
        self.assertTrue([x for x in rt.events if "DG 2대 인식" in x["text"]]); s = e.snapshot(); self.assertEqual(s["devices"]["DG2"]["absent"], False)
        self.assertTrue(self._wait(lambda: abs(rt.val["ESS.kw"] - rt.fleet.unit("ESS", "kw", rt.val) - rt.fleet.unit("ESS2", "kw", rt.val)) < 0.5 and abs(rt.fleet.unit("ESS", "kw", rt.val) - rt.fleet.unit("ESS2", "kw", rt.val)) < 0.5))
        with e.lock: rt.t_ctl = -1e9; e.sim_action({"action": "set", "tag": "ESS.soc", "value": 22.0, "hold": False}, "시험"); e.plant.set("ESS2.soc", 22.0)
        self.assertTrue(self._wait(lambda: e.plant.get("DG.status") > 0.5 and e.plant.get("DG2.status") > 0.5, 40.0), "두 대 모두 기동")                          # 기동 지령은 있는 장치 모두에게
        self.assertTrue(self._wait(lambda: abs(rt.val.get("DG.kw", 0) - 180.0) < 1.0)); self.assertEqual(e.kpi()["online_kw"].count(rt.site.dg_kw), 2)             # 합산과 용량
        from ifps_ems_rt.hmi import fuelwatch
        self.assertTrue(self._wait(lambda: rt.val.get("DG.fuel_l", 0) > 1700)); d = fuelwatch.status(e)[0]; self.assertTrue(85 < d[2] <= 90 and "2대" in d[1], d)   # 연료 %는 탱크 두 개 기준
        e.plant.set("DG2.mode", 1); self.assertTrue(self._wait(lambda: rt.dev["DG2"].manual)); self.assertEqual((rt._ready("DG"), rt.fleet.running("DG", rt.val)), (1, 2)); e.plant.set("DG2.mode", 0)   # 현장 수동인 장치는 새로 기동할 대수에서 뺀다
        with e.lock: self.assertTrue(rt._write("ESS", "ESS.kw_set", 80.0, 0.0))
        self.assertTrue(self._wait(lambda: abs(e.plant.get("ESS.kw_set") - 40.0) < 0.6 and abs(e.plant.get("ESS2.kw_set") - 40.0) < 0.6))                    # 설정값은 똑같이 나눈다
        e.sim_action({"action": "unit", "target": "DG2", "on": False}, "시험")                                                                                 # 쓰던 장치가 끊기면 평소대로 1등급 두절
        self.assertTrue(self._wait(lambda: "link.DG2" in act() and fl()["DG"]["n"] == 1)); self.assertTrue(self._wait(lambda: abs(rt.val.get("DG.kw", 0) - 90.0) < 1.0))
        e.sim_action({"action": "unit", "target": "ESS2", "on": False}, "시험"); self.assertTrue(self._wait(lambda: fl()["ESS"]["n"] == 1))
        with e.lock: rt._write("ESS", "ESS.kw_set", 60.0, 0.0)
        self.assertTrue(self._wait(lambda: abs(e.plant.get("ESS.kw_set") - 30.0) < 0.6))                                                                    # 끊긴 장치의 몫을 남은 장치에 몰아 주지 않는다
        r = e.select("DG", "stop", "시험"); self.assertTrue(r["ok"], r)                                                                                    # 한 대라도 받을 수 있으면 손 지령 가능

    def test_kind_not_brought_is_marked_absent_and_replaced(self):
        td = tempfile.mkdtemp(); shutil.copytree(os.path.join(ROOT, "config"), os.path.join(td, "config"), ignore=shutil.ignore_patterns("state*", "backup"))
        e = Engine(os.path.join(td, "config", "runtime.json"), sim=True); e.plant.gone.add("DG")                                                           # 디젤을 가져오지 않은 작전지
        try:
            e.start(); act = lambda: {a["key"]: a["prio"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}
            self.assertTrue(self._wait(lambda: e.snapshot()["devices"]["DG"]["absent"] and "absent.DG" in act())); a = act(); self.assertEqual(a["absent.DG"], 3); self.assertNotIn("link.DG", a)
            self.assertEqual((e.snapshot()["fleet"]["DG"]["n"], e.snapshot()["fleet"]["DG"]["seen"]), (0, 0))
            with e.lock: e.rt.val["ESS.soc"] = 20.0; w = e.rt.decide()
            self.assertEqual((w["DG"], w["FC"], w.get("_swap")), (False, True, "DG"))                                                                     # 없는 디젤 대신 연료전지
        finally:
            e.stop(); shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
