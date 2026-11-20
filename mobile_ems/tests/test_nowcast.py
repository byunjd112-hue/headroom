import unittest

import numpy as np

from ifps_ems import learner, nowcast
from ifps_ems.config import Site


class NowcastTests(unittest.TestCase):
    def test_reference_depends_only_on_available_measurements(self):
        site = Site()
        d = {"load": np.full(250, 30.0), "load_observed": np.ones(250, dtype=bool)}
        o = 130
        d["load"][o] = 45
        ref, mask = nowcast.reference(d, o, "load", site)
        self.assertEqual(ref[0], 45)
        self.assertTrue(np.all(mask))
        d["load"][o + 1:] = 9999
        np.testing.assert_array_equal(ref, nowcast.reference(d, o, "load", site)[0])
        d["load_observed"][o] = False
        self.assertFalse(np.any(nowcast.reference(d, o, "load", site)[1]))

    def test_weight_gate_and_long_horizon_fallback(self):
        baseline = np.full(96, 10.0)
        ref = np.full(96, 18.0)
        expected = np.full(96, 18.0)
        valid = np.ones(96, dtype=bool)
        sample = (baseline, baseline-2, baseline+2, ref, valid, expected)
        self.assertEqual(nowcast.select([sample]), [0.0] * 6)
        weights = nowcast.select([sample] * 12)
        self.assertEqual(weights, [1.0, 1.0, 1.0, 0.0, 0.0, 0.0])
        p, lo, hi = nowcast.blend(*sample[:5], weights, "load", Site())
        np.testing.assert_array_equal(p[:16], expected[:16])
        np.testing.assert_array_equal(p[16:], baseline[16:])
        self.assertTrue(np.all((lo <= p) & (p <= hi)))

    def test_legacy_prediction_works_without_model_metadata(self):
        class Forecaster:
            def predict(self, d, o):
                return np.full(96, 30.0), np.full(96, 20.0), np.full(96, 40.0), {}
        result = learner.predict(Forecaster(), {}, 10, "load", Site())
        self.assertIsNone(result[3])
        self.assertTrue(np.all(result[0] == 30.0))
