# -*- coding: utf-8 -*-
"""예측 구간의 변동 여유: 최근에 구간이 좁게 나왔으면 넓히고, 잘 맞았으면 그대로 둔다. 모델 파일에 함께 저장된다."""
import os, shutil, tempfile, unittest
import numpy as np
from ifps_ems import dataio
from ifps_ems.config import Site
from ifps_ems.forecast import LoadForecaster, PVForecaster, _drift_scale, DRIFT_SCALES


class TestDriftMargin(unittest.TestCase):
    def test_scale_grows_only_when_recent_errors_escape_the_interval(self):
        rng = np.random.default_rng(1); early = rng.normal(0, 1.0, 4000)
        mk = lambda late: ([np.concatenate([early, late])], [np.concatenate([np.zeros(4000, bool), np.ones(len(late), bool)])])
        self.assertEqual(_drift_scale(*mk(rng.normal(0, 1.0, 1500))), 1.0)                      # 성질이 그대로면 넓히지 않는다
        s = _drift_scale(*mk(rng.normal(0, 1.6, 1500))); self.assertGreater(s, 1.0); self.assertIn(s, DRIFT_SCALES)      # 최근 오차가 커졌으면 넓힌다
        self.assertEqual(_drift_scale(*mk(rng.normal(0, 30.0, 1500))), DRIFT_SCALES[-1])        # 한도까지만
        self.assertEqual(_drift_scale([np.zeros(3)], [np.zeros(3, bool)]), 1.0)                # 자료가 없으면 넓히지 않는다

    def test_calibration_keeps_scale_in_model_file_and_old_files_still_load(self):
        d = tempfile.mkdtemp(); site = Site()
        try:
            p = os.path.join(d, "h.csv"); dataio.gen_sample(site, p, days=24); x = dataio.load_csv(p, site)
            for cls in (LoadForecaster, PVForecaster):
                f = cls(site).fit(x); self.assertIn(f.cal_scale, DRIFT_SCALES); self.assertTrue(np.all(f.q[:, 0] <= 0) and np.all(f.q[:, 1] >= 0))
                m = os.path.join(d, "m.npz"); dataio.save_model(m, f); g = cls(site); dataio.load_model(m, g); self.assertEqual(g.cal_scale, f.cal_scale)
                o = x["n"] - 150; a = f.predict(x, o); b = g.predict(x, o); self.assertTrue(np.allclose(a[1], b[1]) and np.allclose(a[2], b[2]))
                old = f.to_arrays(); old.pop("cal_scale"); h = cls(site); h.from_arrays(old); self.assertEqual(h.cal_scale, 1.0)      # 이전 판 모델 파일
        finally: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
