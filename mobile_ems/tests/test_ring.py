# -*- coding: utf-8 -*-
"""환망 감시: 구간분전함(FSU)·휴대용 배전체계(PPDU) 상태 판단, 자리마다 읽은 ID 로 배치 자동 인식, 경보, 설정 검사, 화면부 연결."""
import copy, json, os, shutil, sys, tempfile, time, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from ifps_ems_rt import ring                            # noqa: E402
from ifps_ems_rt.hmi.engine import Engine                # noqa: E402

R = ring.settings(copy.deepcopy(ring.DEFAULT))


def values(open_at=4, cut=(), dead=(), ids=None):
    """정상 상태의 신호 값(고칠 것만 인자로)."""
    v = {"RING.auto": 1.0}
    for i, t in enumerate(ring.sw_tags(R)): v[t] = 2.0 if i in cut else 0.0 if i == open_at else 1.0
    for x in R["fsu"] + R["ppdu"]: v[x["id"] + ".id"] = float((ids or {}).get(x["id"], x["code"])); v[x["id"] + ".v"] = 0.0 if x["id"] in dead else 380.0
    for p in R["ppdu"]:
        v.update({p["id"] + ".kw": 10.0, p["id"] + ".mccb": 1.0, p["id"] + ".gnd": 35.0, p["id"] + ".lamp": 0.0})
        for n in range(1, 7): v[f"{p['id']}.ch{n}"] = 1.0; v[f"{p['id']}.ch{n}_kw"] = 1.5
    return v


class RingTest(unittest.TestCase):
    def test_settings_and_check(self):
        self.assertIsNone(ring.settings(None)); self.assertIsNone(ring.settings({"enabled": False, "fsu": R["fsu"]})); bad = []; ring.check(R, bad); self.assertEqual(bad, [])
        for change in ({"open": 99}, {"fsu": [{"id": "X1"}]}, {"ppdu": [{"id": "PPDU1", "at": "FSU99", "load": "L1"}]}, {"ppdu": [{"id": "PPDU1", "at": "FSU1", "ch": [{"cls": 7}]}]}, {"trip_ms": -1}, {"auto": 1}, {"fsu_slots": 0}, {"ppdu_slots": 99},
                       {"fsu": [{"id": "FSU1", "code": 70000}]}, {"fsu": [{"id": "FSU1"}, {"id": "FSU1"}]}, {"fsu": [{"id": f"FSU{k}"} for k in range(1, 15)]}):
            bad = []; ring.check(dict(copy.deepcopy(R), **change), bad); self.assertTrue(bad, change)
        self.assertEqual(len(ring.tags(R)), 8 + 1 + 14 + 3 * 18)                           # 구간 개폐기 8 + 자동 1 + FSU 7×2 + PPDU 3×(6 + 회로 12)

    def test_status_normal_cut_and_isolated(self):
        s = ring.status(R, values()); self.assertTrue(s["ok"]); self.assertFalse(s["switched"]); self.assertEqual(s["missing"], []); self.assertTrue(all(f["fed"] for f in s["fsu"]))
        s = ring.status(R, values(open_at=99, cut=(2,))); self.assertEqual(s["cut"], [2]); self.assertTrue(s["switched"]); self.assertTrue(all(f["fed"] for f in s["fsu"]))       # 구간 2 차단 + 상시 개방점 닫힘 → 모두 공급
        s = ring.status(R, values(open_at=99, cut=(2, 3), dead=("FSU3",))); self.assertEqual(s["isolated"], ["FSU3"]); self.assertFalse(s["ok"]); self.assertFalse(s["fsu"][2]["fed"])
        s = ring.status(R, {}, lost=True); self.assertFalse(s["ok"]); self.assertIsNone(s["fsu"][0]["live"]); self.assertEqual(len(s["missing"]), 77)

    def test_auto_layout_follows_ids(self):
        d = ring.discover(R, values()); self.assertTrue(d["ok"] and d["auto"]); self.assertEqual([x["id"] for x in d["rows"]][:4], ["FSU1", "FSU2", "PPDU1", "FSU3"])           # 고리 순서, FSU 뒤에 거기 붙은 PPDU
        v = values(ids={"FSU2": R["fsu"][4]["code"], "FSU5": R["fsu"][1]["code"]}); s = ring.status(R, v); d = ring.discover(R, v)                                           # 두 대를 바꿔 놓아도 문제가 아니다 — 이름이 ID 를 따라간다
        self.assertTrue(d["ok"]); self.assertEqual((s["fsu"][1]["name"], s["fsu"][4]["name"]), ("구간분전함 5", "구간분전함 2")); self.assertFalse([a for a in ring.alarms(R, s) if a[1]])
        v = values(ids={"PPDU2": 0, "FSU7": 0}); s = ring.status(R, v); d = ring.discover(R, v)                                                                               # 대수가 달라도 된다: 빈 자리는 뺀다
        self.assertEqual((len(s["fsu"]), len(s["ppdu"]), len(s["sections"]), d["empty"]), (6, 2, 7, 2)); self.assertTrue(s["ok"] and d["ok"]); self.assertEqual(s["missing"], [])
        self.assertEqual([x["state"] for x in d["rows"] if x["id"] == "PPDU2"], ["비어 있음"])
        v = values(open_at=3, ids={"FSU4": 0}); s = ring.status(R, v); self.assertEqual(s["open"], 3); self.assertFalse(s["switched"])                                                   # 상시 개방점 자리의 장치가 빠지면 지금 열린 구간을 개방점으로 본다
        v = values(ids={"FSU3": 0x4699}); s = ring.status(R, v); self.assertEqual((s["fsu"][2]["new"], s["fsu"][2]["name"], s["recog"]["new"]), (True, f"구간분전함 (ID {0x4699})", ["FSU3"])); self.assertTrue(ring.discover(R, v)["ok"])    # 처음 보는 장치도 바로 넣는다
        for ids in ({"FSU3": R["fsu"][0]["code"]}, {"FSU3": R["ppdu"][0]["code"]}):                                                                                          # 같은 ID 가 둘, 종류가 다른 장치 → 확인 필요
            d = ring.discover(R, values(ids=ids)); self.assertFalse(d["ok"]); self.assertEqual(d["bad"], 1); self.assertIn("ring.id.FSU3", {a[0] for a in ring.alarms(R, ring.status(R, values(ids=ids))) if a[1]})
        v = values(); v.update({"PPDU1.up": float(R["fsu"][6]["code"]), "PPDU2.up": 9.0}); s = ring.status(R, v)                                                              # 배전체계가 물린 곳은 상위 ID 신호로 안다
        self.assertEqual((s["ppdu"][0]["at"], s["ppdu"][0]["at_auto"], s["ppdu"][1]["at"], s["ppdu"][2]["at"]), ("FSU7", True, "", "FSU6")); self.assertIn("ring.at.PPDU2", {a[0] for a in ring.alarms(R, s) if a[1]})
        v["PPDU2.v"] = 0.0; a = {x[0]: x[2] for x in ring.alarms(R, ring.status(R, v)) if x[1]}; self.assertEqual(a.get("ring.dead.PPDU2"), 1)                     # 어디 물렸는지 몰라도 정전 경보는 낸다(1등급 회로가 있으면 1등급)

    def test_fixed_layout_reports_swapped_units(self):
        F = dict(R, auto=False); d = ring.discover(F, values(ids={"FSU2": R["fsu"][4]["code"], "FSU5": R["fsu"][1]["code"]})); bad = [x for x in d["rows"] if x["state"] != "일치"]
        self.assertEqual([x["id"] for x in bad], ["FSU2", "FSU5"]); self.assertIn("FSU5 의 ID", bad[0]["hint"]); self.assertEqual(d["bad"], 2)
        d = ring.discover(F, values(ids={"PPDU2": 0})); self.assertEqual([x["state"] for x in d["rows"] if x["id"] == "PPDU2"], ["무응답"])
        self.assertIn("ring.id.FSU1", {a[0] for a in ring.alarms(F, ring.status(F, values(ids={"FSU1": 1}))) if a[1]})

    def test_alarms_priority_follows_vital_load(self):
        on = lambda s: {k: (p, t) for k, a, p, _, t in ring.alarms(R, s) if a}
        self.assertEqual(on(ring.status(R, values())), {})
        a = on(ring.status(R, values(open_at=99, cut=(2,), dead=("FSU2", "FSU4", "PPDU3")))); self.assertEqual(a["ring.cut.2"][0], 2); self.assertEqual(a["ring.switched"][0], 3)
        self.assertEqual(a["ring.dead.FSU2"][0], 1); self.assertIn("중요 부하", a["ring.dead.FSU2"][1]); self.assertEqual(a["ring.dead.PPDU3"][0], 1)      # 1등급 회로가 물린 배전체계와 그것이 붙은 구간분전함은 1등급 경보
        low = copy.deepcopy(R); [c.update(cls=3) for c in low["ppdu"][1]["ch"] if c["cls"] == 1]; b = on(ring.status(low, values(open_at=99, cut=(2,), dead=("FSU4", "PPDU2", "FSU1"))))
        self.assertEqual((b["ring.dead.FSU4"][0], b["ring.dead.FSU1"][0]), (2, 2))                                                                                    # 1등급 회로가 없거나 배전체계가 안 붙은 곳은 2등급
        self.assertNotIn("ring.id.FSU1", on(ring.status(R, values(ids={"FSU1": 1}))))                                                                                  # 자동 인식: 처음 보는 ID 는 경보가 아니다

    def test_ppdu_circuits_overload_ground_and_trip(self):
        s = ring.status(R, values()); p = s["ppdu"][0]; self.assertEqual(len(p["ch"]), 6); self.assertEqual((p["ch"][1]["cls"], p["ch"][2]["cls"], p["ch"][0]["limit"], p["ch"][2]["limit"]), (0, 1, 10.5, 4.4)); self.assertTrue(p["vital"])
        v = values(); v.update({"PPDU1.kw": 23.0, "PPDU2.gnd": 180.0, "PPDU3.mccb": 2.0, "PPDU1.ch3": 2.0, "PPDU1.ch6": 2.0, "PPDU1.ch2": 2.0}); a = {k: (pr, t) for k, on, pr, _, t in ring.alarms(R, ring.status(R, v)) if on}
        self.assertEqual(a["ring.over.PPDU1"][0], 2); self.assertIn("정격 20", a["ring.over.PPDU1"][1]); self.assertEqual(a["ring.gnd.PPDU2"][0], 2); self.assertEqual(a["ring.mccb.PPDU3"][0], 1)
        self.assertEqual((a["ring.ch.PPDU1.3"][0], a["ring.ch.PPDU1.6"][0]), (1, 3)); self.assertNotIn("ring.ch.PPDU1.2", a)                    # 회로 트립은 그 회로의 부하 등급대로, 환상 연결용 회로는 경보 없음


class RingWatchTest(unittest.TestCase):
    """가상 장치를 띄워 감시 → 경보 → 자동 인식 → 배전체계 구성 저장까지."""
    def setUp(self):
        self.td = tempfile.mkdtemp(); shutil.copytree(os.path.join(ROOT, "config"), os.path.join(self.td, "config"), ignore=shutil.ignore_patterns("state*", "backup"))
        self.cfg = os.path.join(self.td, "config", "runtime.json"); self.eng = Engine(self.cfg, sim=True); self.eng.start(); time.sleep(3.5)

    def tearDown(self):
        self.eng.stop(); shutil.rmtree(self.td, ignore_errors=True)

    def _wait(self, test, limit=8.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < limit:
            if test(): return True
            time.sleep(0.2)
        return False

    def test_monitor_break_discover_and_configure(self):
        e = self.eng; w = e.ringw; self.assertTrue(self._wait(lambda: (e.snapshot()["ring"] or {}).get("ok")))
        v = w.view(e); self.assertEqual(v["status"]["missing"], []); self.assertTrue(v["discover"]["ok"]); self.assertEqual(v["discover"]["n"], 10)
        w.sim({"action": "break", "section": 2}); self.assertTrue(self._wait(lambda: w.status()["cut"] == [2] and w.status()["switched"] and w.status()["ok"]))                  # 구간 차단 뒤 반대쪽 공급
        keys = {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}; self.assertIn("ring.cut.2", keys); self.assertIn("ring.switched", keys)
        w.sim({"action": "break", "section": 3}); self.assertTrue(self._wait(lambda: w.status()["isolated"] == ["FSU3"]))
        w.sim({"action": "restore"}); w.sim({"action": "swap", "a": "FSU2", "b": "FSU5"}); self.assertTrue(self._wait(lambda: w.status()["fsu"][1]["name"] == "구간분전함 5"))      # 자리를 바꿔 놓아도 조작 없이 따라간다
        self.assertTrue(w.view(e)["discover"]["ok"]); self.assertEqual(w.status()["ppdu"][0]["at"], "FSU2"); self.assertFalse(w.accept(e, "시험")["ok"]); w.sim({"action": "swap"})
        self.assertTrue(w.status()["ppdu"][2]["vital"]); ch = [{"name": "통신 중계", "cls": 3}] + [{"name": c["name"], "cls": min(3, c["cls"] + 1) if c["cls"] else 0} for c in w.r["ppdu"][2]["ch"][1:]]      # 1등급 회로를 모두 낮춘다
        r = w.configure(e, {"ppdu": [{"id": "PPDU3", "at": "FSU1", "name": "통신소", "ch": ch}], "open": 3}, "시험"); self.assertTrue(r["ok"])
        with open(self.cfg, encoding="utf-8") as f: saved = json.load(f)["ring"]
        self.assertEqual((saved["ppdu"][2]["at"], saved["ppdu"][2]["name"], saved["ppdu"][2]["ch"][0], saved["open"]), ("FSU6", "통신소", {"name": "통신 중계", "cls": 3}, 3))      # 붙은 곳은 자동으로 알므로 화면에서 고치지 않는다
        self.assertTrue(os.listdir(os.path.join(self.td, "config", "backup"))); self.assertTrue(self._wait(lambda: not w.status()["ppdu"][2]["vital"]))                    # 1등급 회로가 없으면 중요 부하가 아니다
        w.sim({"action": "ppdu", "id": "PPDU1", "what": "ch3", "value": 2}); self.assertTrue(self._wait(lambda: "ring.ch.PPDU1.3" in {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}))
        self.assertRaises(ValueError, w.sim, {"action": "ppdu", "id": "PPDU1", "what": "id", "value": 1})
        self.assertTrue(w.configure(e, {"ppdu": []}, "시험").get("same"))
        self.assertRaises(ValueError, w.sim, {"action": "모름"}); self.assertRaises(ValueError, w.sim, {"action": "swap", "a": "PPDU1", "b": "PPDU6"}); self.assertRaises(ValueError, w.sim, {"action": "swap", "a": "FSU1", "b": "PPDU1"})
        self.assertRaises(ValueError, w.configure, e, {"ppdu": [], "open": -1}, "시험")
        import io, zipfile
        from ifps_ems_rt.hmi import report
        w.sim({"action": "restore"}); w.sim({"action": "break", "section": 5}); self.assertTrue(self._wait(lambda: w.status()["cut"] == [5]))
        x = zipfile.ZipFile(io.BytesIO(report.build(e, e.archw.store, {"days": "1"})[1])).read("word/document.xml").decode("utf-8")                    # 보고서에도 환망 화면과 같은 이름 · 상태가 들어간다
        for t in ("1.4 환망", "구간분전함 5", "차단된 구간 5", "상시 개방점", "지휘·통신 배전"): self.assertIn(t, x)

    def test_units_removed_added_and_shuffled_without_any_setting(self):
        e = self.eng; w = e.ringw; n = lambda: (len(w.status()["fsu"]), len(w.status()["ppdu"])); act = lambda: {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}
        self.assertTrue(self._wait(lambda: w.status() and w.status()["ok"] and n() == (7, 3)))
        w.sim({"action": "ppdu", "id": "PPDU2", "what": "mccb", "value": 2}); self.assertTrue(self._wait(lambda: "ring.mccb.PPDU2" in act()))
        w.sim({"action": "remove", "id": "PPDU2"}); w.sim({"action": "remove", "id": "FSU4"}); self.assertTrue(self._wait(lambda: n() == (6, 2) and w.status()["ok"]))            # 대수가 줄어도 화면이 따라가고
        self.assertTrue(self._wait(lambda: not [k for k in act() if k.startswith("ring.")])); self.assertFalse(w.status()["switched"])                                       # 빠진 장치의 경보는 내려간다
        w.sim({"action": "add", "kind": "ppdu", "at": 1}); w.sim({"action": "add", "kind": "fsu"}); self.assertTrue(self._wait(lambda: n() == (7, 3) and w.status()["ok"]))
        s = w.status(); self.assertEqual(len(s["recog"]["new"]), 2); p = next(x for x in s["ppdu"] if x["new"]); self.assertEqual((p["at"], len(p["ch"])), ("FSU1", 6))             # 처음 보는 장치도 바로 쓴다
        r = w.configure(e, {"ppdu": [{"id": p["id"], "name": "취사장 배전"}]}, "시험"); self.assertTrue(r["ok"]); self.assertTrue(self._wait(lambda: next(x for x in w.status()["ppdu"] if x["id"] == p["id"])["name"] == "취사장 배전"))
        before = {x["id_read"]: x["name"] for x in w.status()["fsu"] + w.status()["ppdu"]}; order = [x["id_read"] for x in w.status()["fsu"]]
        w.sim({"action": "shuffle"}); self.assertTrue(self._wait(lambda: [x["id_read"] for x in w.status()["fsu"]] == order[::-1])); s = w.status()
        self.assertEqual({x["id_read"]: x["name"] for x in s["fsu"] + s["ppdu"]}, before); self.assertTrue(s["ok"] and w.view(e)["discover"]["ok"])                       # 이름·구성이 ID 를 따라간다
        self.assertTrue([x for x in e.rt.events if "장치 자동 인식" in str(x)]); self.assertRaises(ValueError, w.sim, {"action": "remove", "id": "PPDU8"})


class AutoDeviceTest(unittest.TestCase):
    """주 장치 자동 인식: 켠 뒤 한 번도 응답하지 않은 장치는 미설치로 보고 경보를 낮춘다. 응답하던 장치가 끊기면 1등급 그대로."""
    def test_never_answered_device_is_treated_as_not_installed(self):
        from types import SimpleNamespace as NS
        from ifps_ems_rt.hmi import autodev
        got = {}; eng = NS(rt=NS(lm=NS(state={"DG": "두절", "FC": "정상"}), seen={"FC"}, fleet=NS(slots={"DG": ["DG", "DG2"], "FC": ["FC"]})), alarms=NS(set=lambda k, on, pr, src, text: got.__setitem__(k, (on, pr))))
        for n, st in eng.rt.lm.state.items(): autodev.link_alarm(eng, n, st)
        self.assertEqual((got["link.DG"], got["absent.DG"], got["link.FC"], got["absent.FC"]), ((False, 1), (True, 3), (False, 1), (False, 3)))
        eng.rt.lm.state["FC"] = "두절"; autodev.link_alarm(eng, "FC", "두절"); self.assertEqual((got["link.FC"][0], got["absent.FC"][0]), (True, False))            # 응답하던 장치의 두절은 그대로 1등급
        eng.rt.lm.state["DG2"] = "두절"; autodev.link_alarm(eng, "DG2", "두절"); self.assertEqual((got["link.DG2"][0], got["absent.DG2"][0]), (False, False))            # 추가 자리가 빈 것은 알리지 않는다
        eng.rt.seen.add("DG2"); autodev.link_alarm(eng, "DG", "두절"); self.assertEqual((got["link.DG"][0], got["absent.DG"][0]), (False, False))                      # 같은 종류가 한 대라도 있으면 첫 자리가 비어도 알리지 않는다
        eng.rt.seen.add("DG"); autodev.link_alarm(eng, "DG", "두절"); self.assertEqual((got["link.DG"][0], got["absent.DG"][0]), (True, False))


if __name__ == "__main__":
    unittest.main()
