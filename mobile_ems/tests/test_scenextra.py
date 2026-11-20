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

    def test_shipped_definition_and_presets_are_valid(self):
        base = [p for p in scenarios.load_profile(ROOT / "config/runtime.json")[0] if not p.get("virtual")]
        shipped = json.loads((ROOT / "config" / scenextra.FILE).read_text(encoding="utf-8")); self.assertEqual(scenextra.check(shipped, base), [])
        self.assertEqual(scenextra.load(os.path.join(self.td, "없는폴더", "runtime.json")), scenextra.empty())


if __name__ == "__main__":
    unittest.main()
