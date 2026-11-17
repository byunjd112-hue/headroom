# -*- coding: utf-8 -*-
"""지속 학습: 검증을 통과한 모델만 적용하고, 나쁜 자료로는 배우지 않으며, 되돌릴 수 있다."""
import io, json, os, shutil, tempfile, unittest
import numpy as np
from ifps_ems import dataio, learner
from ifps_ems.config import Site, HORIZON
from ifps_ems.forecast import LoadForecaster


class TestLearner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(); cls.site = Site(); cls.csv = os.path.join(cls.d, "hist.csv"); dataio.gen_sample(cls.site, cls.csv, days=24)
        cls.md = os.path.join(cls.d, "models_a"); cls.r1 = learner.train(cls.csv, cls.md, cls.site, source="시험")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.d, ignore_errors=True)

    def test_first_training_adopts_and_records(self):
        r = self.r1; self.assertTrue(r["adopted"], r["why"]); self.assertTrue(r["ver"]); self.assertIn("검증 통과", r["why"])
        for k in ("load", "pv"):
            self.assertIsNone(r["kinds"][k]["current"]); self.assertLess(r["kinds"][k]["new"], 25.0); self.assertGreater(r["kinds"][k]["n"], 100)
        a = learner.active(self.md); self.assertEqual(a["ver"], r["ver"]); self.assertEqual(a["rows"], 24 * 96); self.assertIn("bias_on", a["load"])
        self.assertTrue(all(os.path.exists(os.path.join(self.md, n)) for n in ("model_load.npz", "model_pv.npz", "model_active.json")))
        f = LoadForecaster(self.site); self.assertTrue(dataio.load_model(os.path.join(self.md, "model_load.npz"), f)); self.assertTrue(f.trained)
        self.assertEqual(learner.history(self.md)[-1]["ver"], r["ver"]); self.assertFalse(r["degraded"])

    def test_worse_challenger_is_rejected_and_rollback_restores(self):
        import time
        md = os.path.join(self.d, "models_b"); shutil.copytree(self.md, md); v1 = learner.active(md)["ver"]; w1 = np.load(os.path.join(md, "model_load.npz"))["b0_w"].copy()
        self.assertFalse(learner.rollback(md)["adopted"])                                       # 이전 판이 없으면 되돌리지 않는다
        time.sleep(1.1); r = learner.train(self.csv, md, self.site, {"min_gain": 50.0})         # 50%p 이상 좋아져야 한다는 조건 → 모델 유지
        self.assertFalse(r["adopted"]); self.assertTrue(r["recal"]); self.assertIn("현재 모델 유지", r["why"]); a = learner.active(md)
        self.assertEqual(a["updated"], []); self.assertEqual(a["prev"], v1); self.assertTrue(np.array_equal(w1, np.load(os.path.join(md, "model_load.npz"))["b0_w"]))      # 가중치는 그대로(구간만 재보정)
        time.sleep(1.1); r2 = learner.train(self.csv, md, self.site, {"min_gain": -50.0}); self.assertTrue(r2["adopted"]); self.assertEqual(sorted(learner.active(md)["updated"]), ["load", "pv"])
        b = learner.rollback(md); self.assertTrue(b["adopted"]); self.assertEqual(learner.active(md)["ver"], a["ver"]); self.assertGreaterEqual(len(learner.history(md)), 3)

    def test_bad_or_short_data_is_not_learned(self):
        md = os.path.join(self.d, "models_c"); short = os.path.join(self.d, "short.csv"); dataio.gen_sample(self.site, short, days=10)
        r = learner.train(short, md, self.site); self.assertFalse(r["adopted"]); self.assertIn("학습 보류", r["why"]); self.assertEqual(learner.active(md), {})
        flat = os.path.join(self.d, "flat.csv"); rows = open(self.csv, encoding="utf-8").read().splitlines()
        with open(flat, "w", encoding="utf-8") as f:                                            # 센서가 멈춘 자료(부하가 계속 같은 값)
            f.write(rows[0] + "\n")
            for ln in rows[1:]: c = ln.split(","); c[1:5] = ["80.00", "30.00", "30.00", "20.00"]; f.write(",".join(c) + "\n")
        r = learner.train(flat, md, self.site); self.assertFalse(r["adopted"]); self.assertIn("품질 미달", r["why"])
        r = learner.train(os.path.join(self.d, "none.csv"), md, self.site); self.assertFalse(r["adopted"]); self.assertIn("학습 실패", r["why"])      # 파일이 없어도 예외를 내지 않는다
        self.assertEqual(learner.history(os.path.join(self.d, "nowhere")), []); self.assertEqual(learner.main([]), 2)

    def test_recent_error_correction(self):
        z = np.zeros(HORIZON); p, lo, hi = learner.apply_bias("load", 10.0, 8.0, z + 100, z + 90, z + 110)
        self.assertAlmostEqual(p[0], 110.0); self.assertLess(p[40] - 100.0, 0.1); self.assertTrue(np.all(hi >= p)); self.assertAlmostEqual(lo[0], 100.0)
        p, _, _ = learner.apply_bias("pv", 0.5, 8.0, z + 100, z + 80, z + 120); self.assertAlmostEqual(p[0], 50.0); self.assertGreater(p[60], 99.0)
        p, _, _ = learner.apply_bias("load", -500.0, 8.0, z + 100, z, z + 100); self.assertEqual(p[0], 0.0)                                           # 음수 전력은 없다
        self.assertIs(learner.apply_bias("load", None, 8.0, z, z, z)[0], z)
        d = dataio.load_csv(self.csv, self.site); f = LoadForecaster(self.site); dataio.load_model(os.path.join(self.md, "model_load.npz"), f); o = d["n"] - 200
        d2 = dict(d); d2["load"] = d["load"].copy(); d2["load"][o - 8:o + 1] += 40.0                                                                # 최근 2시간 부하가 40 kW 높게 나온 상황
        b = learner.recent_bias(f, d2, o, "load", self.site); self.assertGreater(b, 5.0)
        raw = f.predict(d2, o)[0]; cor, _, _, used = learner.predict(f, d2, o, "load", self.site, {"load": {"bias_on": True}})
        self.assertAlmostEqual(used, b); self.assertGreater(cor[0], raw[0]); self.assertAlmostEqual(cor[-1], raw[-1], delta=0.1)
        self.assertIsNone(learner.predict(f, d2, o, "load", self.site, {"load": {"bias_on": False}})[3]); self.assertIsNone(learner.recent_bias(f, d, 100, "load", self.site))

    def test_each_kind_is_judged_separately(self):
        """부하는 좋아지고 태양광은 나빠지면 부하 모델만 바꾼다(태양광은 현재 모델을 유지)."""
        md = os.path.join(self.d, "models_e"); shutil.copytree(self.md, md); before = open(os.path.join(md, "model_pv.npz"), "rb").read()
        real = learner.score
        def fake(f, d, origins, kind, site, cfg, with_bias=False):                              # 도전 태양광 모델만 일부러 나쁘게 채점
            r = real(f, d, origins, kind, site, cfg, with_bias); fake.n[kind] = fake.n.get(kind, 0) + 1
            return dict(r, nmae=r["nmae"] + 30.0) if (kind == "pv" and fake.n[kind] == 2) else r
        fake.n = {}; learner.score = fake
        try:
            import time; time.sleep(1.1); r = learner.train(self.csv, md, self.site)
        finally:
            learner.score = real
        self.assertTrue(r["adopted"]); self.assertTrue(r["kinds"]["load"]["better"]); self.assertFalse(r["kinds"]["pv"]["better"]); self.assertIn("태양광은 현재 모델이 더 정확해 유지", r["why"]); self.assertTrue(r["recal"])
        self.assertEqual(learner.active(md)["updated"], ["load"]); z0 = np.load(io.BytesIO(before)); z1 = np.load(os.path.join(md, "model_pv.npz"))
        self.assertTrue(all(np.array_equal(z0[k], z1[k]) for k in z0.files if k != "q"))                                    # 태양광 가중치는 그대로

    def test_cli_and_cut(self):
        md = os.path.join(self.d, "models_d"); opt = os.path.join(self.d, "opt.json")
        with open(opt, "w", encoding="utf-8") as f: json.dump({"site": self.site.to_dict(), "ai": {"holdout_days": 2}, "source": "명령줄"}, f)
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf): self.assertEqual(learner.main([self.csv, md, opt]), 0)
        rec = json.loads(buf.getvalue().strip().splitlines()[-1]); self.assertTrue(rec["adopted"]); self.assertEqual(rec["source"], "명령줄")
        d = dataio.load_csv(self.csv, self.site); c = learner.cut(d, 500); self.assertEqual(c["n"], 500); self.assertEqual(len(c["load"]), 500); self.assertEqual(len(c["ts"]), 500)


if __name__ == "__main__":
    unittest.main()
