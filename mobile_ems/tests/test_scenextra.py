# -*- coding: utf-8 -*-
"""시나리오용 추가 설비: 정의 검사, 실제 대응표를 건드리지 않는 모의 신호, 보호 계전기의 선택 차단, 저장·되읽기."""
import json, os, shutil, tempfile, unittest
from pathlib import Path
from ifps_ems_rt.hmi import scenarios, scenextra

ROOT = Path(__file__).resolve().parents[1]
EX = lambda tag, value, ms=0, op="eq": {"type": "expect", "tag": tag, "value": value, "op": op, "ms": ms, "limit": ms}


class TestScenarioExtra(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.mkdtemp()
        for f in ("runtime.json", "pointmap.csv"): shutil.copy(ROOT / "config" / f, self.td)
        self.cfg = os.path.join(self.td, "runtime.json")
        self.base, self.devices = scenarios.load_profile(self.cfg)            # 추가 설비 파일이 없는 상태
        self.extra = {"feeders": [{"id": "L4", "name": "정비고 부하", "kind": "load", "bus": "B", "kw": 40}],
                      "transformers": [{"id": "TR9", "name": "정비고 변압기", "on": "L4", "kva": 100, "pf": 0.8}],
                      "relays": [{"id": "51-L4", "name": "정비고 과전류", "cb": "L4", "sum": ["L4"], "pickup_kw": 60, "delay_ms": 200, "code": 51},
                                 {"id": "51-TIE", "name": "후비", "cb": "TIE", "sum": ["L2", "L3", "L4"], "pickup_kw": 100, "delay_ms": 600, "code": 51}]}

    def tearDown(self): shutil.rmtree(self.td, ignore_errors=True)

    def test_definition_is_checked(self):
        self.assertEqual(scenextra.check(self.extra, self.base), [])
        bad = json.loads(json.dumps(self.extra)); bad["feeders"][0]["id"] = "L3"; self.assertTrue(any("이미 있는" in e for e in scenextra.check(bad, self.base)))      # 기본 급전선과 이름이 겹침
        bad = json.loads(json.dumps(self.extra)); bad["feeders"][0]["bus"] = "C"; bad["relays"][0]["cb"] = "없음"; bad["relays"][1]["sum"] = []; bad["transformers"][0]["kva"] = 0
        errs = scenextra.check(bad, self.base); self.assertEqual(len(errs), 4, errs)
        self.assertTrue(scenextra.check({"feeders": [{}] * 13}, self.base)); self.assertTrue(scenextra.check([], self.base))
        self.assertTrue(scenextra.save(self.cfg, bad, self.base)); self.assertFalse(os.path.exists(scenextra.path_for(self.cfg)))                            # 틀린 정의는 저장하지 않는다

    def test_virtual_points_do_not_touch_the_real_point_map(self):
        before = (ROOT / "config" / "pointmap.csv").read_bytes(); mine = Path(self.td, "pointmap.csv").read_bytes()
        self.assertEqual(scenextra.save(self.cfg, self.extra, self.base), []); self.assertEqual(scenextra.load(self.cfg)["feeders"][0]["id"], "L4")
        self.assertEqual(Path(self.td, "pointmap.csv").read_bytes(), mine); self.assertEqual((ROOT / "config" / "pointmap.csv").read_bytes(), before)
        pts, _ = scenarios.load_profile(self.cfg); tags = {p["tag"]: p for p in pts}
        self.assertTrue(all(t in tags for t in ("CB.L4", "FLT.L4", "L4.kw", "TR9.load_pct"))); self.assertTrue(tags["CB.L4"]["virtual"])
        used = {(p["device"], p["fc"], p["addr"]) for p in self.base}; self.assertFalse(any((p["device"], p["fc"], p["addr"]) in used for p in pts if p.get("virtual")))   # 주소가 겹치지 않는다
        self.assertEqual(len(scenextra.merge(pts, self.extra)), len(pts))                                                                                       # 여러 번 합쳐도 같다
        self.assertEqual(scenextra.save(self.cfg, scenextra.empty(), self.base), []); self.assertTrue(os.path.exists(scenextra.path_for(self.cfg) + ".bak"))

    def test_relays_trip_selectively_and_backup_acts_only_when_needed(self):
        scenextra.save(self.cfg, self.extra, self.base); pts, dev = scenarios.load_profile(self.cfg)
        run = lambda steps: scenarios.verify([{"name": "t", "steps": steps}], pts, dev, profile=self.cfg)["results"][0]
        r = run([{"type": "set", "tag": "L4.kw", "value": 90}, EX("CB.L4", 1), EX("CB.L4", 2, 400), EX("FLT.L4", 51), {"type": "wait", "ms": 900}, EX("CB.TIE", 1), EX("TR9.load_pct", 0)])
        self.assertTrue(r["ok"], [x for x in r["rows"] if x["state"] == "fail"])                                 # 하위가 먼저 열려 상위는 동작하지 않는다(차단 뒤 부하율 0)
        r = run([{"type": "set", "tag": "L4.kw", "value": 55}, {"type": "wait", "ms": 300}, EX("CB.L4", 1), EX("TR9.load_pct", 68, 0, "ge"), EX("CB.TIE", 2, 500), EX("FLT.TIE", 51), EX("CB.L4", 1)])
        self.assertTrue(r["ok"], [x for x in r["rows"] if x["state"] == "fail"])                                 # 하위는 정정값 아래, 합계(30+20+55)가 넘어 상위가 동작
        r = run([{"type": "set", "tag": "L4.kw", "value": 90}, {"type": "wait", "ms": 100}, {"type": "set", "tag": "L4.kw", "value": 10}, {"type": "wait", "ms": 600}, EX("CB.L4", 1)])
        self.assertTrue(r["ok"])                                                                                # 정한 시간 안에 내려가면 동작하지 않는다
        self.assertIn("CB.L4", r["rows"][-1]["snap"]); self.assertIn("TR9.load_pct", r["rows"][-1]["snap"])

    def _run(self, extra, steps, profile=None):
        self.assertEqual(scenextra.save(self.cfg, extra, self.base), []); pts, dev = scenarios.load_profile(self.cfg)
        return scenarios.verify([{"name": "t", "steps": steps}], pts, dev, profile=self.cfg)["results"][0]

    def test_inverse_time_ground_fault_undervoltage_and_breaker_failure(self):
        inv = {"feeders": [], "transformers": [], "relays": [{"id": "51", "kind": "oc", "cb": "L3", "sum": ["L3"], "pickup": 50, "curve": "vi", "tms": 0.05}]}
        t = []
        for kw in (75, 150):                                                # 반한시: 넘는 정도가 클수록 빨리 동작한다(강반한시 1.5배 1.35초, 3배 0.34초)
            r = self._run(inv, [{"type": "set", "tag": "LOAD.p3_kw", "value": kw}, EX("CB.L3", 2, 3000)]); self.assertTrue(r["ok"]); t.append(r["rows"][-1]["elapsed"])
        self.assertGreater(t[0], 1200); self.assertLess(t[0], 1500); self.assertGreater(t[1], 250); self.assertLess(t[1], 450)
        gf = {"feeders": [], "transformers": [], "relays": [{"id": "64", "kind": "gf", "cb": "L2", "on": "L2", "pickup": 30, "delay_ms": 100}]}
        r = self._run(gf, [{"type": "set", "tag": "GF.L2", "value": 20}, {"type": "wait", "ms": 400}, EX("CB.L2", 1), {"type": "set", "tag": "GF.L2", "value": 45}, EX("CB.L2", 2, 300), EX("FLT.L2", 64), EX("CB.L3", 1)])
        self.assertTrue(r["ok"], [x for x in r["rows"] if x["state"] == "fail"])
        uv = {"feeders": [], "transformers": [], "relays": [{"id": "27", "kind": "uv", "cb": "L3", "bus": "B", "pickup": 300, "delay_ms": 300}]}
        dead = [{"type": "set", "tag": t2, "value": 0} for t2 in ("CB.TIE", "CB.ESS", "CB.G1")]
        r = self._run(uv, dead + [{"type": "wait", "ms": 800}, EX("BUS.b_v", 0), EX("CB.L3", 1)]); self.assertTrue(r["ok"])                   # 정상 전압을 본 적이 없으면 동작하지 않는다
        r = self._run(uv, [{"type": "wait", "ms": 200}] + dead + [EX("CB.L3", 2, 600), EX("FLT.L3", 27)]); self.assertTrue(r["ok"], [x for x in r["rows"] if x["state"] == "fail"])
        bf = {"feeders": [], "transformers": [], "relays": [{"id": "51", "kind": "oc", "cb": "L3", "sum": ["L3"], "pickup": 50, "delay_ms": 100, "backup": "TIE", "bf_ms": 300}]}
        r = self._run(bf, [{"type": "set", "tag": "STK.L3", "value": 1}, {"type": "set", "tag": "LOAD.p3_kw", "value": 90}, {"type": "wait", "ms": 250}, EX("CB.L3", 1), EX("FLT.L3", 51), EX("CB.TIE", 1), EX("CB.TIE", 2, 400), EX("FLT.TIE", 50)])
        self.assertTrue(r["ok"], [x for x in r["rows"] if x["state"] == "fail"])
        r = self._run(bf, [{"type": "set", "tag": "LOAD.p3_kw", "value": 90}, EX("CB.L3", 2, 300), {"type": "wait", "ms": 600}, EX("CB.TIE", 1)]); self.assertTrue(r["ok"])     # 차단기가 정상이면 후비는 동작하지 않는다
        bad = {"feeders": [], "transformers": [], "relays": [{"id": "x", "kind": "uv", "cb": "L3", "bus": "B", "pickup": 300, "curve": "si"}, {"id": "y", "kind": "oc", "cb": "L3", "sum": ["L3"], "pickup": 50, "backup": "L3"}, {"id": "z", "kind": "zz", "cb": "L3"}]}
        self.assertEqual(len(scenextra.check(bad, self.base)), 3)

    def test_extra_feeder_can_count_in_the_load_seen_by_ems(self):
        ex = {"feeders": [{"id": "L4", "name": "정비고", "kind": "load", "bus": "B", "kw": 40, "ems": True, "photo": "l3"}, {"id": "G9", "name": "임시 전원", "kind": "src", "bus": "A", "kw": 15, "ems": True},
                          {"id": "L5", "name": "수급 제외", "kind": "load", "bus": "B", "kw": 99}], "transformers": [], "relays": []}
        r = self._run(ex, [{"type": "wait", "ms": 100}, EX("LOAD.kw", 105), {"type": "set", "tag": "CB.L4", "value": 0}, {"type": "wait", "ms": 100}, EX("LOAD.kw", 65),      # 80 + 40 − 15, 차단기를 열면 빠진다
                           {"type": "set", "tag": "LOAD.kw", "value": 200}, {"type": "set", "tag": "CB.L4", "value": 1}, {"type": "wait", "ms": 100}, EX("LOAD.kw", 225)])         # 시험이 새 값을 넣으면 그 값이 기준
        self.assertTrue(r["ok"], [(x["step"], x.get("actual")) for x in r["rows"] if x["state"] == "fail"])
        bad = json.loads(json.dumps(ex)); bad["feeders"][0]["photo"] = "../x"; bad["feeders"][1]["ems"] = "yes"; self.assertEqual(len(scenextra.check(bad, self.base)), 2)

    def test_shipped_definition_and_presets_are_valid(self):
        base = [p for p in scenarios.load_profile(ROOT / "config/runtime.json")[0] if not p.get("virtual")]
        shipped = json.loads((ROOT / "config" / scenextra.FILE).read_text(encoding="utf-8")); self.assertEqual(scenextra.check(shipped, base), [])
        self.assertEqual(scenextra.load(os.path.join(self.td, "없는폴더", "runtime.json")), scenextra.empty())


if __name__ == "__main__":
    unittest.main()
