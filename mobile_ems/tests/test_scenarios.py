import copy
import json
from pathlib import Path
from threading import RLock
from types import SimpleNamespace
from unittest.mock import Mock
import unittest

from ifps_ems_rt.planlink import PlanPolicy
from ifps_ems_rt.hmi.scenarios import catalog, compatible_presets, evaluate, load_profile, regression_source, verify


class ScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.points, cls.devices = load_profile(Path(__file__).resolve().parents[1] / "config/runtime.json")

    def setUp(self):
        self.normal = {"name": "normal", "steps": [
            {"type": "command", "device": "DG", "value": 1},
            {"type": "expect", "tag": "DG.status", "value": 1, "op": "eq", "ms": 500, "limit": 1500},
        ]}
        self.delayed = copy.deepcopy(self.normal)
        self.delayed["name"] = "delay"
        self.delayed["steps"].insert(0, {"type": "response", "device": "DG", "ms": 800})

    def test_parallel_runs_are_isolated_and_improvement_retests_batch(self):
        cases = [self.normal, self.delayed]
        result = verify(cases, self.points, self.devices, improve=True)
        self.assertEqual([True, False], [run["ok"] for run in result["results"]])
        failure = result["results"][1]["rows"][-1]
        self.assertEqual(0, failure["actual"])
        self.assertEqual(1, failure["expected"])
        self.assertGreater(failure["suggest_ms"], 500)
        self.assertLessEqual(failure["suggest_ms"], 1500)
        self.assertEqual(500, cases[1]["steps"][-1]["ms"])
        self.assertEqual(1, len(result["changes"]))
        self.assertTrue(all(run["ok"] for run in result["retest"]))
        self.assertIn("candidate", result)

    def test_rows_carry_plant_state_for_topology_playback(self):
        case = {"name": "snap", "steps": [{"type": "set", "tag": "CB.L3", "value": 2}, {"type": "command", "device": "DG", "value": 1},
                                           {"type": "expect", "tag": "DG.status", "value": 1, "op": "eq", "ms": 500, "limit": 1500}]}
        rows = verify([case], self.points, self.devices)["results"][0]["rows"]
        self.assertEqual(rows[0]["snap"]["CB.L3"], 2); self.assertEqual(rows[0]["snap"]["DG.status"], 0); self.assertEqual(rows[2]["snap"]["DG.status"], 1)
        self.assertTrue(all(key in rows[2]["snap"] for key in ("CB.GRID", "ESS.soc", "PV.kw", "LOAD.p1_kw", "FLT.L3")))

    def test_no_ack_blocks_candidate_and_reports_injected_failure(self):
        self.delayed["steps"][0]["ms"] = -1
        result = verify([self.delayed], self.points, self.devices, improve=True)
        self.assertNotIn("candidate", result)
        self.assertIn("무응답", result["results"][0]["rows"][-1]["detail"])

    def test_branch_and_generated_source(self):
        steps = self.normal["steps"]
        steps.insert(0, {"type": "branch", "tag": "DG.status", "op": "eq", "value": 1, "skip": 1})
        steps[-1]["value"] = 0
        self.normal["name"] = "test '\\ <case>"
        result = evaluate([self.normal], self.points, self.devices)[0]
        self.assertEqual(["pass", "skip", "pass"], [row["state"] for row in result["rows"]])
        source = regression_source([self.normal], self.points, self.devices)
        namespace = {"__name__": "generated", "__file__": __file__}
        exec(compile(source, "generated.py", "exec"), namespace)
        namespace["ScenarioRegression"]("test_scenarios").test_scenarios()

    def test_malformed_threshold_is_rejected(self):
        self.normal["steps"][-1]["limit"] = 1
        with self.assertRaisesRegex(ValueError, "2단계"):
            evaluate([self.normal], self.points, self.devices)

    def test_built_in_cases_and_expected_fault(self):
        root = Path(__file__).resolve().parents[1]
        source = root / "ifps_ems_rt/hmi/static/scenario_presets.json"
        presets = json.loads(source.read_text(encoding="utf-8"))
        commands = catalog(self.points, self.devices)["commands"]
        self.assertEqual(presets, compatible_presets(presets, self.points, commands))
        result = verify(presets, self.points, self.devices, improve=True, profile=root / "config/runtime.json")
        failed = [run for run in result["results"] if not run["ok"]]
        self.assertEqual(["고장 시험 · 디젤 기동 응답 지연"], [run["name"] for run in failed])
        self.assertEqual(len(presets), len(result["candidate"]))
        mode_cases = {case["name"] for case in presets if case["cat"] == "정상 운전 · 운전 모드"}
        self.assertEqual(mode_cases, {case["name"] for case in presets[:12]})                       # 운전 모드 12건은 맨 앞(결과 요약이 앞 12건을 운전 모드로 센다)
        cats = [case["cat"] for case in presets]; self.assertEqual({c: cats.count(c) for c in dict.fromkeys(cats)}, {"정상 운전 · 운전 모드": 12, "정상 운전 · 장비 시퀀스": 6, "고장 대응 (FMEA)": 31, "보호 협조 (FAT 시험 항목)": 6})
        self.assertEqual(4, sum(1 for case in presets if case["name"].startswith("환망 · ")))                    # 환망(고리 모양 배전) 단선 대응 4건
        self.assertTrue(all(case["ref"] and case["fat"] for case in presets if case["cat"] == "고장 대응 (FMEA)"))      # 고장 대응에는 FMEA 번호와 FAT 확인 항목이 있어야 한다
        self.assertEqual({f"{control} · {site} · {posture}" for control in ("AUTO", "MANUAL")
                          for site in ("작전지", "주둔지") for posture in ("평시", "저소음", "자립")}, mode_cases)
        self.assertTrue(all(run["ok"] for run in result["retest"]))
        reduced = [p for p in self.points if p["tag"] != "FLT.GRID"]
        self.assertEqual(len(presets) - 1, len(compatible_presets(presets, reduced, commands)))      # 그 신호를 쓰는 한 건만 빠진다

    def test_plan_restart_after_model_reload_invalidates_timestamp(self):
        plan = PlanPolicy.__new__(PlanPolicy)
        plan._lock = RLock()
        plan.site = SimpleNamespace(h2_nm3=1000)
        plan.clock = lambda: 100.0
        plan.src = "시험"
        plan.V = [0, 0]
        plan.t_plan = None
        plan.k = 0
        plan.pl = SimpleNamespace(act=Mock(return_value=(0, 1, 0)))
        plan.replan = Mock()
        self.assertEqual((0, 1, 0), plan({}, 11))
        plan.replan.assert_called_once_with(11)
        self.assertEqual("계획 운전(시험)", plan.note)
