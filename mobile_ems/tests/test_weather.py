# -*- coding: utf-8 -*-
"""날씨 정보 반영: 구름 계수, 기록 검사·우선순위, 받은 글 읽기, AI 예측과 섞기·견주기, 화면부 연결(수기 입력 · 통신망 받기)."""
import copy, json, os, shutil, sys, tempfile, time, unittest
from datetime import datetime, timedelta
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from ifps_ems_rt import weather as wx                     # noqa: E402
from ifps_ems_rt.hmi import cfgedit                         # noqa: E402
from ifps_ems_rt.hmi.engine import Engine                   # noqa: E402

T = datetime(2026, 11, 22, 12, 0)
F = lambda d: d.strftime(wx.FMT)


class WeatherCalcTest(unittest.TestCase):
    def test_clearness_record_and_settings_check(self):
        self.assertEqual((wx.clearness(0), round(wx.clearness(10), 2)), (1.0, 0.25)); self.assertTrue(set(wx.PHONE) <= set(wx.SKY))
        p = lambda **k: wx.record(T, T + timedelta(hours=3), **k)["cloud"]                                                                              # 휴대폰 날씨 앱 수준: 하늘 상태 + 강수 확률
        self.assertEqual((p(sky="맑음"), p(sky="대체로 흐림"), p(sky="비"), p(sky="구름 조금", pop=80), p(sky="흐림", pop=20), p(sky="맑음", pop=0)), (0.5, 7.0, 10.0, 7.0, 9.0, 0.5))
        self.assertEqual(wx.record(T, T + timedelta(hours=3), sky="비", pop="70")["pop"], 70.0); self.assertRaises(ValueError, wx.record, T, T + timedelta(hours=1), sky="비", pop=120)
        self.assertTrue(wx.clearness(3) > wx.clearness(7) > wx.clearness(9))      # 구름이 많을수록 작다
        self.assertAlmostEqual(wx.cloud_of(wx.clearness(6.0)), 6.0, places=6)
        r = wx.record(T, T + timedelta(hours=6), sky="대체로 흐림", temp="12.5", who="김상사"); self.assertEqual((r["cloud"], r["src"], r["temp"], r["t1"]), (7.0, "수기", 12.5, "2026-11-22 18:00"))
        self.assertEqual(wx.record(F(T), F(T + timedelta(hours=1)), cloud=3, sky="흐림", pop=90)["cloud"], 3.0)                                                 # 운량을 적으면 그 값이 먼저
        for bad in (dict(cloud=11), dict(sky="모름"), dict(cloud=3, temp=99), dict(cloud=3, rain=-1), dict()):
            self.assertRaises(ValueError, wx.record, T, T + timedelta(hours=1), **bad)
        self.assertRaises(ValueError, wx.record, T, T, cloud=3); self.assertRaises(ValueError, wx.record, T, T + timedelta(days=8), cloud=3); self.assertRaises(ValueError, wx.record, "어제", T, cloud=3)
        bad = []; wx.check(wx.DEFAULT, bad); wx.check(None, bad); self.assertEqual(bad, [])
        for ch in ({"url": "ftp://x"}, {"interval_min": 1}, {"w_max": 2}, {"enabled": "yes"}, {"timeout_s": 0}):
            bad = []; wx.check(dict(wx.DEFAULT, **ch), bad); self.assertTrue(bad, ch)
        with open(os.path.join(ROOT, "config", "runtime.json"), encoding="utf-8") as f: cfg = json.load(f)
        self.assertEqual(cfgedit.check_runtime(cfg)[0], []); c2 = copy.deepcopy(cfg); c2["weather"]["url"] = "file:///etc/passwd"; self.assertTrue(cfgedit.check_runtime(c2)[0])   # 설정 편집기도 같은 검사를 한다

    def test_parse_json_and_csv(self):
        j = json.dumps({"issued": "x", "hours": [{"t": "2026-11-22 13:00", "cloud": 2}, {"t": "2026-11-22T14:00", "sky": "흐림", "temp": 9}, {"t": "2026-11-22 17:00", "cloud": 5, "h": 3}]})
        r = wx.parse(j); self.assertEqual([(x["t0"][11:], x["t1"][11:], x["cloud"]) for x in r], [("13:00", "14:00", 2.0), ("14:00", "17:00", 9.0), ("17:00", "20:00", 5.0)])     # 끝은 다음 줄까지, 마지막은 h 또는 1시간
        r = wx.parse("시각,운량,기온,강수\n2026-11-22 13:00,3,12,0\n2026-11-22 14:00,8,,1.5\n", "통신망(파일)"); self.assertEqual((len(r), r[1]["cloud"], r[1]["rain"], r[0]["src"]), (2, 8.0, 1.5, "통신망(파일)"))
        for bad in ("", "{", '{"hours": 3}', "2026-11-22 13:00,99", "어제,3", '{"hours": [{"t": "2026-11-22 13:00"}]}', "x" * 300000):
            self.assertRaises(ValueError, wx.parse, bad)

    def test_book_manual_wins_over_network_and_replace(self):
        b = wx.Book(); net = wx.parse(json.dumps({"hours": [{"t": F(T + timedelta(hours=h)), "cloud": 8} for h in range(6)]}))
        b.add(net, replace_src="통신망"); self.assertEqual(b.at(T + timedelta(minutes=30))["cloud"], 8.0); self.assertIsNone(b.at(T + timedelta(hours=7)))
        b.add([wx.record(T, T + timedelta(hours=2), cloud=2, at=T - timedelta(hours=1))]); self.assertEqual((b.at(T + timedelta(minutes=30))["cloud"], b.at(T + timedelta(hours=3))["cloud"]), (2.0, 8.0))    # 겹치면 손으로 넣은 것, 그 밖은 통신망
        b.add(wx.parse(json.dumps({"hours": [{"t": F(T + timedelta(hours=h)), "cloud": 4} for h in range(3)]})), replace_src="통신망")                             # 통신망 갱신: 겹치는 옛 통신망 기록만 바뀐다
        self.assertEqual((b.at(T + timedelta(minutes=30))["cloud"], b.at(T + timedelta(hours=2, minutes=30))["cloud"], b.at(T + timedelta(hours=4))["cloud"]), (2.0, 4.0, 8.0))
        m = [r for r in b.rows if r["src"] == "수기"][0]; self.assertEqual(b.remove(net[0]["at"] + "x"), 0); self.assertEqual(b.remove(m["at"]), 1); self.assertEqual(b.at(T + timedelta(minutes=30))["cloud"], 4.0)
        self.assertEqual([r["t0"] for r in b.ahead(T + timedelta(hours=4, minutes=30))][0], F(T + timedelta(hours=4))); b.prune(T + timedelta(days=40), 30); self.assertEqual(b.rows, [])
        self.assertEqual(wx.Book([{"t0": 1}, "x", net[0]]).rows, [net[0]])                                                                                   # 깨진 저장분은 버린다

    def test_blend_and_score_weight_follows_error(self):
        out, w = wx.blend([100.0, 100.0, 0.0], [200.0, 200.0, 0.0], [None, wx.clearness(10), wx.clearness(0)], 0.9, 0.5)
        self.assertEqual(w, [None, 45.0, 0.0]); self.assertEqual(out, [100.0, 72.5, 0.0])                                    # 기록이 없는 칸은 AI 그대로
        self.assertEqual(wx.calibrate([0.0] * 10, [0.0] * 10, 400), 1.0); self.assertAlmostEqual(wx.calibrate([80.0] * 100 + [40.0] * 100, [100.0] * 200, 400), 0.8)
        s = wx.Score(); self.assertEqual((s.weight(0.3, 0.8), s.stats()["n"]), (0.3, 0))
        for i in range(10): s.note(T + timedelta(minutes=15 * i), 4, 100.0, 60.0, 88.0)                                          # AI 100, 날씨 60 을 냈는데 실측은 62
        s.note(T, 4, 1.0, 1.0, 1.0); s.note(T + timedelta(hours=9), 4, 5.0, None, 5.0); self.assertEqual(len(s.wait), 10)              # 같은 시각·선행은 한 번만, 날씨가 없으면 적지 않는다
        act = {F(T + timedelta(minutes=15 * i)): (62.0, True) for i in range(9)}; act[F(T + timedelta(minutes=15 * 9))] = (0.0, False)  # 마지막은 밤 — 채점에서 뺀다
        s.settle(act, F(T + timedelta(minutes=15 * 5))); self.assertEqual((s.stats()["n"], len(s.wait)), (6, 4))                         # 실측이 나온 것까지만
        s.settle(act, F(T + timedelta(hours=5))); st = s.stats(); self.assertEqual((st["n"], st["ai"], st["wx"], st["final"]), (9, 38.0, 2.0, 26.0))
        self.assertEqual(s.weight(0.3, 0.8), 0.8); self.assertEqual(s.weight(0.3, 1.0), 0.95)                                           # 날씨가 더 정확 → 비율이 올라간다(한도까지)
        self.assertEqual((s.weight(0.3, 1.0, 4), s.weight(0.3, 1.0, 48), s.stats(h=48)["n"]), (0.95, 0.95, 0))                          # 그 선행시간의 비교가 없으면 전체 비교로 정한다
        for i in range(8): s.note(T + timedelta(hours=20, minutes=15 * i), 48, 50.0, 90.0, 60.0)                                       # 12시간 앞은 AI 가 더 정확했다
        s.settle({F(T + timedelta(hours=20, minutes=15 * i)): (52.0, True) for i in range(8)}, F(T + timedelta(hours=30))); ws = s.weights(0.3, 0.8, 96)
        self.assertEqual((ws[0], ws[3]), (0.8, 0.8)); self.assertTrue(0.1 < ws[4] == ws[23] < 0.8); self.assertLess(ws[24], 0.1); self.assertEqual(ws[95], ws[24]); self.assertEqual((wx.horizon(1), wx.horizon(5), wx.horizon(30), wx.horizon(96)), (4, 12, 48, 48))   # 선행시간마다 따로
        k = wx.Score(); rec = wx.record(T, T + timedelta(hours=6), sky="대체로 흐림"); base = wx.clearness(7.0); self.assertEqual(k.factor(rec), base)             # 표기별 배우기: 처음에는 환산표 값
        for i in range(12): k.note(T + timedelta(minutes=15 * i), 4, 50.0, 40.0, 45.0, "대체로 흐림", 100.0); k.note(T + timedelta(minutes=15 * i), 12, 50.0, 40.0, 45.0, "대체로 흐림", 100.0)
        k.settle({F(T + timedelta(minutes=15 * i)): (30.0, True) for i in range(12)}, F(T + timedelta(hours=5))); f = k.factor(rec); L = k.learned()[0]
        self.assertTrue(0.3 < f < base and abs(L["seen"] - 0.3) < 0.01 and 10 < L["n"] <= 12, (f, L)); self.assertEqual(wx.Score(k.state()).factor(rec), f)      # 실측(0.3)쪽으로 옮겨 가고, 같은 시각은 한 번만 센다
        g = wx.Score(s.state()); self.assertEqual(g.stats(), s.stats())                                                                       # 저장했다가 다시 읽어도 같다
        t = wx.Score()
        for i in range(9): t.note(T + timedelta(minutes=15 * i), 4, 61.0, 100.0, 70.0, "맑음", 110.0)
        t.settle(act, F(T + timedelta(hours=5))); self.assertLess(t.weight(0.3, 0.8), 0.05)                                           # AI 가 더 정확 → 비율이 내려간다


class WeatherLiveTest(unittest.TestCase):
    """가상 장치를 띄워 수기 입력 → 예측 반영, 통신망 받기(가상 장치의 시험용 자료), 실패 처리."""
    def setUp(self):
        self.td = tempfile.mkdtemp(); shutil.copytree(os.path.join(ROOT, "config"), os.path.join(self.td, "config"), ignore=shutil.ignore_patterns("state*", "backup"))
        shutil.copytree(os.path.join(ROOT, "results"), os.path.join(self.td, "results"))                                                 # 개발 폴더의 모델을 바꾸지 않게 복사본을 쓴다
        self.eng = Engine(os.path.join(self.td, "config", "runtime.json"), sim=True, plan_dir=os.path.join(self.td, "results")); self.eng.start()

    def tearDown(self):
        self.eng.stop(); shutil.rmtree(self.td, ignore_errors=True)

    def _fc(self, test, limit=150.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < limit:
            f = self.eng.forecast()
            if f.get("ok") and test(f): return f
            time.sleep(0.5)
        self.fail("예측 조건 미충족: " + str({k: f.get(k) for k in ("ok", "why", "weather")})[:400])

    def test_manual_input_changes_forecast_and_network_fetch(self):
        e = self.eng; w = e.wxw; f = self._fc(lambda f: f["weather"].get("on")); self.assertEqual((f["weather"]["cover"], f["weather"]["w"]), (0, 0.3)); self.assertEqual(f["weather"]["kwh"]["ai"], f["weather"]["kwh"]["final"])   # 기록이 없으면 AI 그대로
        self.assertRaises(ValueError, w.manual, {"hours": 6}, "시험"); self.assertTrue(w.manual({"sky": "흐림", "hours": 24, "note": "비 올 듯"}, "김상사")["ok"])
        f2 = self._fc(lambda f: f["weather"].get("cover", 0) >= 90); k = f2["weather"]["kwh"]; self.assertTrue(min(k["wx"], k["ai"]) < k["final"] < max(k["wx"], k["ai"]) or k["ai"] == k["wx"] == 0, k)            # 반영값은 날씨 기반과 AI 예측 사이(보통은 흐림 → 날씨 기반이 낮다. 그날의 AI 예측이 이미 더 낮으면 날씨 기반이 높을 수도 있다 — 날짜에 따라 달라지던 판정을 고침)
        self.assertEqual(len(f2["pv"]), 96); self.assertTrue(all(lo <= p + 1e-6 for lo, p in zip(f2["pv_lo"], f2["pv"])))
        v = w.view(); self.assertEqual((v["rows"][0]["src"], v["rows"][0]["who"], v["rows"][0]["use"], v["rows"][0]["cloud"]), ("수기", "김상사", True, 9.0)); self.assertEqual(v["sky"], list(wx.PHONE))
        self.assertTrue(w.manual({"sky": "비", "pop": 80, "temp": 9, "day": 1}, "김상사")["ok"]); r = [x for x in w.view()["rows"] if x["pop"] == 80.0][0]                       # 내일 하루치(날씨 앱의 일별 예보)
        self.assertEqual((r["t0"][11:], r["t1"][11:], r["cloud"]), ("00:00", "00:00", 10.0)); self.assertRaises(ValueError, w.manual, {"sky": "비", "day": 5}, "시험"); self.assertTrue(w.delete(r["at"], "시험")["ok"]); self.assertTrue(os.path.exists(w.path))
        self.assertTrue([x for x in e.rt.events if x["kind"] == "날씨"]); self.assertIsNotNone(e.rt.policy.pv_adjust)                                                             # 운전계획에도 같은 반영이 걸려 있다
        self.assertFalse(w.fetch("시험")["ok"])                                                                                                                                # 주소가 없으면 받지 않는다
        from ifps_ems_rt.hmi.server import serve
        srv = serve(e, "127.0.0.1", 0); port = srv.server_address[1]
        try:
            w.cfg["url"] = f"http://127.0.0.1:{port}/api/archive/weather_sample"; self.assertTrue(w.fetch("시험")["ok"]); v = w.view()
            self.assertEqual((v["net"]["ok"], v["net"]["n"]), (True, 24)); self.assertTrue([r for r in v["rows"] if r["src"] == "통신망"]); use = lambda: [r for r in w.view()["rows"] if r["use"]][0]; self.assertEqual(use()["src"], "수기")   # 받은 뒤에도 지금은 손으로 넣은 것을 쓴다
            self.assertTrue(w.delete(use()["at"], "시험")["ok"]); self.assertEqual(use()["src"], "통신망"); self.assertFalse(w.delete("없음", "시험")["ok"])
            w.cfg["only_garrison"] = True; w.t_fetch = 0.0; n0 = w.net["t"]; w.net["t"] = ""; w.step(e); self.assertEqual(w.net["t"], "")                                           # 작전지에서는 스스로 받지 않는다
            e.rt.set_ops(mode="grid", who="시험"); w.step(e); self.assertTrue(w.net["t"] >= n0 and w.net["ok"])                                                                   # 주둔지에서는 정한 간격으로 받는다
        finally:
            srv.shutdown(); srv.server_close()
        w.cfg["url"] = "http://127.0.0.1:1/none"; self.assertFalse(w.fetch("시험")["ok"]); self.assertEqual(w.view()["net"]["ok"], False); self.assertTrue(e.forecast()["ok"])            # 받기 실패해도 예측·운전은 그대로
        self.assertEqual(w.load_text("2030-01-01 10:00,4\n2030-01-01 11:00,6", "시험")["n"], 2); self.assertRaises(ValueError, w.load_text, "엉터리", "시험")


if __name__ == "__main__":
    unittest.main()
