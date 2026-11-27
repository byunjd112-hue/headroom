# -*- coding: utf-8 -*-
"""명령줄 도구·기동 절차·자료 입출력 시험(핵심 명령, mbtool, 실행기 명령, 제어화면 기동, PIN 해시 도구)."""
import contextlib, getpass, io, json, os, runpy, sys, threading, time, unittest, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, HERE)
import numpy as np
from ifps_ems import __main__ as core, dataio, models
from ifps_ems.config import Site
from ifps_ems.forecast import LoadForecaster, PVForecaster
from ifps_ems_rt import mbtool, modbus as mb, runtime
from ifps_ems_rt.hmi import __main__ as hmi_main
from test_rt import Base


def quiet(fn, *a, **k):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf): r = fn(*a, **k)
    return r, buf.getvalue()


class TestCoreCommands(Base):
    def test_verify_gen_sample_train_and_model_io(self):
        r, txt = quiet(core.main, ["verify"]); self.assertEqual(r, 0); self.assertIn("정상", txt)
        csvp = os.path.join(self.td, "s.csv"); r, txt = quiet(core.main, ["gen-sample", csvp, "--days", "20"]); self.assertEqual(r, 0); self.assertIn("1920행", txt)
        out = os.path.join(self.td, "m"); r, txt = quiet(core.main, ["train", csvp, out]); self.assertEqual(r, 0)
        site = Site(); fl = LoadForecaster(site); fp = PVForecaster(site)
        self.assertTrue(dataio.load_model(os.path.join(out, "model_load.npz"), fl)); self.assertTrue(dataio.load_model(os.path.join(out, "model_pv.npz"), fp))
        self.assertFalse(dataio.load_model(os.path.join(out, "none.npz"), LoadForecaster(site)))
        d = dataio.load_csv(csvp, site); self.assertEqual(d["n"], 1920); self.assertTrue(np.all(np.isfinite(d["load"])))

    def test_history_with_gaps_is_forward_filled(self):
        p = os.path.join(self.td, "h.csv")
        with open(p, "w", encoding="utf-8") as f:
            f.write(",".join(dataio.HIST_COLS) + "\n2026-07-01 00:00,,1,2,3,,20,1013,50,1,2\n2026-07-01 00:15,80,x,2,3,0,,1013,50,1,2\n2026-07-01 00:30,,1,2,3,5,21,,50,1,2\n")
        d = dataio.load_csv(p, Site()); self.assertEqual(list(d["load"]), [80.0, 80.0, 80.0]); self.assertEqual(list(d["pv"]), [0.0, 0.0, 5.0]); self.assertEqual(d["load_p"][1, 0], 1.0)
        with open(p, "w", encoding="utf-8") as f: f.write(",".join(dataio.HIST_COLS) + "\n")
        d = dataio.load_csv(p, Site()); self.assertEqual(d["n"], 0); self.assertEqual(d["load_p"].shape, (0, 3))

    def test_ridge_and_quantiles(self):
        X = np.arange(40, dtype=float).reshape(20, 2); y = X @ np.array([2.0, -1.0]) + 3
        m = models.Ridge(lam=1e-6).fit(X, y); self.assertAlmostEqual(float(m.predict([4.0, 5.0])[0]), 6.0, places=2)
        m2 = models.Ridge().from_arrays(m.to_arrays("a_"), "a_"); self.assertTrue(np.allclose(m2.predict(X), m.predict(X)))
        self.assertEqual(models.quantiles([0.1, np.nan]), (-0.15, 0.15)); lo, hi = models.quantiles(np.linspace(-1, 1, 101)); self.assertLess(lo, hi)


class TestMbtool(Base):
    def run_tool(self, *args):
        return quiet(mbtool.main, list(args))

    def test_read_write_probe_check(self):
        a = ["127.0.0.1", "-p", str(self.pa), "--allow", "127.0.0.0/8"]
        r, txt = self.run_tool("read", *a, "-u", "1", "-a", "0", "-n", "5", "--trace"); self.assertEqual(r, 0); self.assertIn("0x0000", txt); self.assertIn("TX", txt)
        r, txt = self.run_tool("write", *a, "-u", "3", "-a", "44", "-t", "f32", "-o", "CDAB", "--value", "3.75", "-y"); self.assertEqual(r, 0)
        r, txt = self.run_tool("read", *a, "-u", "3", "-a", "44", "-n", "2", "-t", "f32", "-o", "CDAB"); self.assertIn("3.75", txt)
        r, txt = self.run_tool("read", *a, "-u", "3", "-a", "44", "-n", "2", "--orders"); self.assertIn("CDAB F32", txt); self.assertIn("3.75", txt)
        r, txt = self.run_tool("write", *a, "-u", "3", "-a", "50", "-v", "0x10", "7", "-y"); self.assertEqual(r, 0)
        c = mb.Client("127.0.0.1", self.pa, 3, 0.3); self.assertEqual(c.read(50, 2), [16, 7]); c.close()
        r, txt = self.run_tool("write", *a, "-a", "1", "--coil", "--value", "1", "-y"); self.assertEqual(r, 2)
        r, txt = self.run_tool("write", *a, "-a", "1", "--coil", "-v", "1", "-y"); self.assertEqual(r, 2); self.assertIn("통신 오류", txt)      # 가상 장치는 코일 미지원
        r, txt = self.run_tool("read", *a, "-f", "1", "-a", "0", "-n", "4"); self.assertEqual(r, 2)
        r, txt = self.run_tool("probe", *a, "--units", "1-2"); self.assertEqual(r, 0); self.assertIn("[1, 2]", txt)
        r, txt = self.run_tool("probe", "127.0.0.1", "-p", "1", "--allow", "127.0.0.0/8", "--units", "1", "--timeout", "0.2"); self.assertEqual(r, 1)
        r, txt = self.run_tool("read", *a, "-o", "ZZZZ"); self.assertEqual(r, 2)
        r, txt = self.run_tool("check", self.cfgp); self.assertEqual(r, 0); self.assertIn("통신 이상 없음", txt)

    def test_write_asks_confirmation_and_watch_stops_on_interrupt(self):
        a = ["127.0.0.1", "-p", str(self.pa), "--allow", "127.0.0.0/8", "-u", "3"]; import builtins
        orig = builtins.input; builtins.input = lambda *_: "n"
        try: r, txt = self.run_tool("write", *a, "-a", "52", "-v", "9"); self.assertEqual(r, 1); self.assertIn("취소", txt)
        finally: builtins.input = orig
        n = [0]; real = time.sleep
        def fake(s):
            n[0] += 1
            if n[0] >= 2: raise KeyboardInterrupt
            real(0.01)
        mbtool.time.sleep = fake
        try: r, txt = self.run_tool("watch", *a, "-a", "4", "-n", "1", "-t", "i16", "-s", "0.1", "-i", "0.05"); self.assertEqual(r, 0); self.assertIn("33.3", txt)      # 부족분 40 kW 가운데 이동형 ESS 의 몫(복합전력 ESS 200 kWh 와 용량 비율로 나눔: 40 × 1000 / 1200)
        finally: mbtool.time.sleep = real


class TestRuntimeCommands(Base):
    def test_check_scans_and_module_entry(self):
        r, txt = quiet(runtime.main, [self.cfgp, "--check"]); self.assertEqual(r, 0); self.assertIn("통신 이상 없음", txt)
        self.plant.muted.add("PV"); r, txt = quiet(runtime.main, [self.cfgp, "--check"]); self.assertEqual(r, 1); self.plant.muted.clear()
        argv = sys.argv; sys.argv = ["ifps_ems_rt", self.cfgp, "--check"]
        try:
            with self.assertRaises(SystemExit) as cm: quiet(runpy.run_module, "ifps_ems_rt", run_name="__main__")
            self.assertEqual(cm.exception.code, 0)
        finally: sys.argv = argv


class TestHmiStartup(Base):
    def test_start_serve_and_stop_by_signal(self):
        cfg = json.load(open(os.path.join(ROOT, "config", "runtime.json"), encoding="utf-8")); cfg["pointmap"] = os.path.join(ROOT, "config", "pointmap.csv"); cfg["state_dir"] = os.path.join(self.td, "st")
        cfg.setdefault("hmi", {}).update(port=0, bind="127.0.0.1"); p = os.path.join(self.td, "hmi.json"); json.dump(cfg, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        handlers = []; real_signal = hmi_main.signal.signal; hmi_main.signal.signal = lambda sig, h: handlers.append(h); seen = {}
        def poke():
            for _ in range(100):
                if handlers: break
                time.sleep(0.05)
            time.sleep(0.3); seen["out"] = buf.getvalue(); url = [w for w in seen["out"].split() if w.startswith("http://")]
            try: seen["code"] = urllib.request.urlopen(url[0], timeout=3).status if url else None
            finally: handlers[0]()
        buf = io.StringIO(); threading.Thread(target=poke, daemon=True).start()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf): r = hmi_main.main([p, "--sim", "--port", "0"])
        finally: hmi_main.signal.signal = real_signal
        self.assertEqual(r, 0); self.assertEqual(seen.get("code"), 200); self.assertIn("가상 장치(SIM)", buf.getvalue()); self.assertIn("마지막 상태 저장", buf.getvalue())

    def test_start_failures_return_codes(self):
        r, txt = quiet(hmi_main.main, [os.path.join(self.td, "none.json"), "--sim"]); self.assertEqual(r, 2); self.assertIn("기동 실패", txt)

    def test_pin_tool_hashes_and_rejects_mismatch(self):
        from ifps_ems_rt.hmi.engdefs import pin_verify
        real = getpass.getpass; seq = iter(["4821-ops", "4821-ops", "1", "2"]); getpass.getpass = lambda *_: next(seq)
        try:
            _, txt = quiet(runpy.run_module, "ifps_ems_rt.hmi.pin", run_name="__main__"); self.assertTrue(pin_verify("4821-ops", txt.strip()))
            with self.assertRaises(SystemExit): quiet(runpy.run_module, "ifps_ems_rt.hmi.pin", run_name="__main__")
        finally: getpass.getpass = real



class TestLegacyLayout(unittest.TestCase):
    def test_old_central_control_name_is_read_as_current(self):
        """예전 판에서 저장한 배치(중앙제어 장비 종류가 옛 이름)를 읽으면 지금 이름으로 바뀌어 그림이 그대로 나온다."""
        from ifps_ems_rt.hmi.eng_tools import ToolsMixin
        old = "E" + "MS"
        lay = ToolsMixin._legacy({"rev": 3, "items": [{"uid": "d5", "kind": old, "bind": old, "name": "⑤ " + old, "x": 1, "y": 2}, {"uid": "a", "kind": "DG", "bind": "G1", "name": "발전기", "x": 3, "y": 4}]})
        self.assertEqual((lay["items"][0]["kind"], lay["items"][0]["bind"], lay["items"][0]["name"]), ("TPCS", "TPCS", "⑤ TPCS"))
        self.assertEqual(lay["items"][1]["kind"], "DG"); self.assertEqual(ToolsMixin._legacy({"items": None}), {"items": None})

if __name__ == "__main__":
    unittest.main()
