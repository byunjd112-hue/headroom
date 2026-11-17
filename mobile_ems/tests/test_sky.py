# -*- coding: utf-8 -*-
"""하늘 카메라(구름량)와 주의집중 예측: 사진 판독, 고장 시 안전한 동작, 미래를 보지 않음, 검증 없이는 섞지 않음, 이전 판 자료와의 호환."""
import os, shutil, tempfile, time, unittest
import numpy as np
from ifps_ems import dataio, skycam, attn
from ifps_ems.config import Site
from ifps_ems.forecast import PVForecaster, BUCKET


class TestSkyCam(unittest.TestCase):
    def setUp(self): self.d = tempfile.mkdtemp()
    def tearDown(self): shutil.rmtree(self.d, ignore_errors=True)

    def test_cloud_cover_follows_the_picture(self):
        for want in (0.0, 0.2, 0.5, 0.8, 1.0):
            self.assertAlmostEqual(skycam.cloud_cover(skycam.render(want, seed=3)), want, delta=0.03)
        self.assertIsNone(skycam.cloud_cover(np.full((60, 80, 3), 10, dtype=np.uint8)))             # 야간(어두움)은 판정하지 않는다

    def test_png_round_trip_and_filtered_rows(self):
        img = skycam.render(0.4, seed=1, size=(48, 36)); p = os.path.join(self.d, "a.png"); skycam.write_png(p, img)
        self.assertTrue(np.array_equal(skycam.read_png(p), img))
        import struct, zlib                                                                  # 줄 필터(Sub·Up·Average·Paeth)를 쓴 그림도 읽는다
        h, w, _ = img.shape; raw = bytearray(); a = img.astype(int).reshape(h, w * 3)
        for y in range(h):
            ft = 1 + y % 4; raw.append(ft); prev = a[y - 1] if y else np.zeros(w * 3, dtype=int)
            for x in range(w * 3):
                le = a[y, x - 3] if x >= 3 else 0; up = prev[x]; ul = prev[x - 3] if x >= 3 else 0
                pa, pb, pc = abs(up - ul), abs(le - ul), abs(le + up - 2 * ul); pae = le if (pa <= pb and pa <= pc) else (up if pb <= pc else ul)
                raw.append((a[y, x] - {1: le, 2: up, 3: (le + up) >> 1, 4: pae}[ft]) & 255)
        ch = lambda t, b: struct.pack(">I", len(b)) + t + b + struct.pack(">I", zlib.crc32(t + b) & 0xFFFFFFFF)
        with open(p, "wb") as f: f.write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(bytes(raw))) + ch(b"IEND", b""))
        self.assertTrue(np.array_equal(skycam.read_png(p), img))

    def test_bad_or_stale_picture_gives_no_value(self):
        p = os.path.join(self.d, "s.png"); cam = skycam.SkyCam(p, max_age_s=60)
        self.assertFalse(cam.read()["ok"])                                                   # 파일 없음
        with open(p, "wb") as f: f.write(b"not a picture")
        r = cam.read(); self.assertFalse(r["ok"]); self.assertIn("읽기 실패", r["why"])
        skycam.write_png(p, skycam.render(0.6)); r = cam.read(); self.assertTrue(r["ok"]); self.assertAlmostEqual(r["cover"], 0.6, delta=0.03)
        r = cam.read(now=time.time() + 600); self.assertFalse(r["ok"]); self.assertIn("전 것", r["why"])      # 오래된 사진은 쓰지 않는다
        with open(p, "wb") as f: f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)
        os.utime(p, (time.time() + 5, time.time() + 5)); self.assertFalse(cam.read()["ok"])                # 깨진 PNG


class TestAttentionForecast(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(); cls.site = Site(); cls.csv = os.path.join(cls.dir, "h.csv"); dataio.gen_sample(cls.site, cls.csv, days=40)
        cls.d = dataio.load_csv(cls.csv, cls.site); cls.f = PVForecaster(cls.site).fit(cls.d)

    @classmethod
    def tearDownClass(cls): shutil.rmtree(cls.dir, ignore_errors=True)

    def test_sample_has_daytime_sky_only_and_other_columns_unchanged(self):
        d = self.d; day = d["clear"] > 0.05 * self.site.pv_kwp
        self.assertTrue(np.all(np.isfinite(d["sky"][day]))); self.assertTrue(np.all(np.isnan(d["sky"][d["clear"] <= 0])))
        self.assertTrue(np.all((d["sky"][day] >= 0) & (d["sky"][day] <= 1)))
        self.assertAlmostEqual(float(d["load"][100]), 54.84, delta=30); self.assertEqual(d["n"], 40 * 96)

    def test_attention_never_uses_memories_that_end_after_the_issue_time(self):
        d = self.d; f = self.f; o = d["n"] - 300; r = f._idx(d); kwp = self.site.pv_kwp
        y1 = f.att.predict(d, o, r, kwp)
        d2 = {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in d.items() if not k.startswith("_")}
        d2["pv"][o + 1:] = 0.0; d2["sky"][o + 1:] = 1.0                                           # 발행 시점 뒤의 값을 바꿔도 예측은 같아야 한다
        f2 = PVForecaster(self.site); f2.from_arrays(f.to_arrays()); y2 = f2.att.predict(d2, o, f2._idx(d2), kwp)
        self.assertTrue(np.allclose(y1, y2, equal_nan=True)); self.assertTrue(np.any(np.isfinite(y1)))
        p1 = f.predict(d, o)[0]; p2 = f2.predict(d2, o)[0]; self.assertTrue(np.allclose(p1, p2))

    def test_blend_ratio_is_validated_and_model_survives_save_and_load(self):
        f = self.f; self.assertTrue(f.att.fitted); self.assertEqual(len(f.alpha), len(BUCKET)); self.assertTrue(all(a in f.ALPHAS for a in f.alpha))
        p = os.path.join(self.dir, "m.npz"); dataio.save_model(p, f); g = PVForecaster(self.site); self.assertTrue(dataio.load_model(p, g)); self.assertTrue(g.trained)
        o = self.d["n"] - 150; self.assertTrue(np.allclose(f.predict(self.d, o)[0], g.predict(self.d, o)[0]))
        e = g.explain(self.d, o)
        if e["on"] and e["refs"]: self.assertTrue( e["refs"][0][0] < self.d["ts"][o]); self.assertLessEqual(sum(w for _, w in e["refs"]), 100.01)
        off = PVForecaster(self.site, use_att=False).fit(self.d); self.assertFalse(np.any(off.alpha > 0)); self.assertFalse(off.explain(self.d, o)["on"])

    def test_works_without_camera_and_with_old_model_file(self):
        d = {k: v for k, v in self.d.items() if not k.startswith("_")}; d["sky"] = np.full(d["n"], np.nan)      # 카메라 없는 현장
        f = PVForecaster(self.site).fit(d); p50 = f.predict(d, d["n"] - 150)[0]; self.assertTrue(np.all(np.isfinite(p50))); self.assertGreater(p50.max(), 0)
        d.pop("sky"); d.pop("_att", None); self.assertTrue(np.all(np.isfinite(PVForecaster(self.site).fit(d).predict(d, d["n"] - 150)[0])))
        a = self.f.to_arrays()                                                                # 이전 판 모델(입력 18개)은 학습 전 상태로 읽혀 다시 학습 대상이 된다
        for b in range(len(BUCKET)):
            if f"b{b}_w" in a: a[f"b{b}_w"] = a[f"b{b}_w"][:-2]; a[f"b{b}_mu"] = a[f"b{b}_mu"][:-2]; a[f"b{b}_sd"] = a[f"b{b}_sd"][:-2]
        old = PVForecaster(self.site); old.from_arrays(a); self.assertFalse(old.trained); self.assertTrue(np.all(np.isfinite(old.predict(self.d, self.d["n"] - 150)[0])))

    def test_attention_context_falls_back_when_sky_missing(self):
        d = self.d; r = self.f._idx(d); o = int(np.nonzero(d["clear"] > 0.3 * self.site.pv_kwp)[0][50]); c1 = attn.context(d, o, r, self.site.pv_kwp)
        self.assertEqual(len(c1), attn.NF); self.assertAlmostEqual(c1[5], float(d["sky"][o]))
        d2 = dict(d); d2["sky"] = np.full(d["n"], np.nan); c2 = attn.context(d2, o, r, self.site.pv_kwp); self.assertTrue(0.0 <= c2[5] <= 1.0); self.assertEqual(c2[6], 0.0)


class TestHistorySkyColumn(unittest.TestCase):
    def test_old_history_header_is_migrated_and_rows_still_read(self):
        from ifps_ems_rt.runtime import _add_sky_header, HIST_COLS
        d = tempfile.mkdtemp(); p = os.path.join(d, "history.csv")
        try:
            with open(p, "w", encoding="utf-8") as f: f.write("ts,load_kw,load_p1,load_p2,load_p3,pv_kw,temp,press,rh,plan,mode\n2026-07-01 12:00,80,30,30,20,150,20,1013,50,1,2\n")
            _add_sky_header(p); _add_sky_header(p)
            with open(p, "a", encoding="utf-8") as f: f.write("2026-07-01 12:15,81,30,30,21,160,20,1013,50,1,2,0.350\n")
            with open(p, encoding="utf-8") as f: self.assertEqual(f.readline().strip().split(","), HIST_COLS)
            x = dataio.load_csv(p, Site()); self.assertEqual(x["n"], 2); self.assertTrue(np.isnan(x["sky"][0])); self.assertAlmostEqual(x["sky"][1], 0.35); self.assertEqual(x["pv"][1], 160)
        finally: shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
