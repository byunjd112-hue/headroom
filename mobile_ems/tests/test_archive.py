# -*- coding: utf-8 -*-
"""기록 보관소·조회 API·Word 보고서·기록 조회기 시험."""
import io, json, os, shutil, sys, tempfile, time, unittest, urllib.request, zipfile
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ifps_ems_rt import archdev, archive, archrecv, archview, archxfer   # noqa: E402
from ifps_ems_rt import pointmap                                  # noqa: E402
from ifps_ems_rt.hmi import archapi, archcfg, archwatch, cfgedit, docx, pptx, report, seqppt   # noqa: E402

INST = {"load": 60.0, "pv": 20.0, "dg": 30.0, "fc": 10.0, "gdg": 0.0, "grid_in": 0.0, "grid_out": 0.0, "ess_chg": 0.0, "ess_dis": 0.0, "elz": 0.0, "grid": 0.0, "soc": 55.0, "h2": 500.0, "fuel": 800.0, "va": 380.0, "vb": 381.0, "hz": 60.0, "temp": 20.0}


class Clock:
    """보관소가 쓰는 시계(time.monotonic)를 시험이 정한 값으로 바꾼다."""
    def __init__(self): self.t = 1000.0; self.real = archive.time.monotonic
    def __enter__(self): archive.time.monotonic = lambda: self.t; return self
    def __exit__(self, *a): archive.time.monotonic = self.real


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(); self.path = os.path.join(self.dir, "archive.db")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_settings_range(self):
        c = archive.settings({"interval_min": 7, "retain_years": 9, "max_mb": 1})
        self.assertEqual((c["interval_min"], c["retain_years"], c["max_mb"]), (15, 5, 16))
        self.assertEqual(archive.settings({"retain_years": 0})["retain_years"], 1); self.assertEqual(archive.settings(None)["retain_years"], archive.LEGAL_YEARS)

    def test_tick_integrates_energy_and_cumulative(self):
        a = archive.Archive(self.path, {"interval_min": 15}); t0 = datetime(2026, 3, 2, 10, 0).timestamp()
        with Clock() as ck:
            for i in range(1800):                      # 30분 동안 1초마다
                a.tick(INST, t0 + i); ck.t += 1.0
        a.close(); a = archive.Archive(self.path, read_only=True)
        rows = a.series("raw", t0 - 1, t0 + 3600); self.assertEqual(len(rows), 2)
        self.assertAlmostEqual(rows[0]["load_kwh"], 15.0, delta=0.05); self.assertAlmostEqual(rows[0]["pv_kwh"], 5.0, delta=0.02); self.assertEqual(rows[0]["load_max"], 60.0); self.assertEqual(rows[0]["soc"], 55.0)
        self.assertAlmostEqual(rows[1]["cum_load"], 30.0, delta=0.1); self.assertAlmostEqual(rows[1]["cum_gen"], 20.0, delta=0.1)       # 발전기 = 디젤 + 연료전지
        hour = a.series("hour", t0 - 1, t0 + 3600); self.assertEqual(len(hour), 1); self.assertAlmostEqual(hour[0]["load_kwh"], 30.0, delta=0.1); self.assertEqual(hour[0]["k"], "2026-03-02 10:00")
        self.assertRaises(ValueError, a.series, "week", 0, 1); self.assertRaises(ValueError, a.add_inspect, "접지저항", "3", "Ω", "", "t"); a.close()

    def test_cumulative_survives_restart(self):
        a = archive.Archive(self.path, {"interval_min": 1}); t0 = datetime(2026, 3, 2, 10, 0).timestamp()
        with Clock() as ck:
            for i in range(121): a.tick(INST, t0 + i); ck.t += 1.0
            a.close(); a = archive.Archive(self.path, {"interval_min": 1}); self.assertAlmostEqual(a.cum["load"], 2.0, delta=0.05)
            for i in range(121, 241): a.tick(INST, t0 + i); ck.t += 1.0
        a.close(); a = archive.Archive(self.path, read_only=True); self.assertAlmostEqual(a.series("raw", 0, 4e9)[-1]["cum_load"], 4.0, delta=0.1); a.close()

    def test_group_by_day_month_year_and_seed_flag(self):
        a = archive.Archive(self.path); now = datetime(2026, 6, 15, 12, 0).timestamp()
        n = a.seed([(now - 86400 * 400 + 900 * i, {"load": 40.0, "pv": 10.0, "va": 380.0}) for i in range(96 * 400)]); self.assertEqual(n, 38400)
        days = a.series("day", *archapi.span("day", "2026-05-20")[:2]); self.assertEqual(len(days), 31); self.assertAlmostEqual(days[0]["load_kwh"], 960.0, delta=0.1); self.assertTrue(days[0]["demo"])
        self.assertEqual(len(a.series("month", *archapi.span("month", "2026-01-01")[:2])), 6); self.assertEqual([r["k"] for r in a.series("year", *archapi.span("year", "")[:2])], ["2025", "2026"])
        self.assertEqual(a.info()["demo_rows"], 38400); a.close()

    def test_retention_and_size_cap(self):
        a = archive.Archive(self.path, {"retain_years": 1, "max_mb": 16}); now = time.time()
        a.seed([(now - 86400 * 500 + 3600 * i, {"load": 1.0}) for i in range(24 * 500)]); a.add_inspect("접지저항", "3", "Ω", "오래됨", "t", now - 86400 * 450); a.add_inspect("접지저항", "4", "Ω", "", "t", now - 86400)
        self.assertGreater(a.purge(now), 0); i = a.info(); self.assertEqual(i["inspects"], 1); self.assertGreaterEqual(datetime.strptime(i["first"], "%Y-%m-%d %H:%M").timestamp(), now - 86400 * 366 - 3600)
        a.cfg["max_mb"] = 0.0001; before = a.info()["rows"]; a.purge(now); self.assertLess(a.info()["rows"], before); a.close()          # 한도를 넘으면 오래된 달부터 지운다

    def test_events_sync_search_and_inspect(self):
        a = archive.Archive(self.path); wall = time.strftime("%Y-%m-%d %H:%M:%S")
        ev = [{"id": 1, "wall": wall, "kind": "지령", "text": "DG 기동 지령", "actor": "ems"}, {"id": 2, "wall": wall, "kind": "운용", "text": "태세 변경 → 저소음", "actor": "운용자"}]
        al = [{"t": time.time() + 1, "ev": "발생", "prio": 1, "src": "DG", "text": "DG 트립"}]
        a.sync(ev, al); a.sync(ev, al); t0, t1, _ = archapi.span("hour", "")                      # 두 번 불러도 한 번만 적는다
        self.assertEqual(len(a.events(t0, t1 + 86400)), 3); self.assertEqual([r["text"] for r in a.events(t0, t1 + 86400, q="트립")], ["DG 트립"]); self.assertEqual(len(a.events(t0, t1 + 86400, kind="지령")), 1)
        self.assertRaises(ValueError, a.add_inspect, " ", "1", "", "", "t"); a.add_inspect("절연저항", "500", "MΩ", "양호", "점검자"); self.assertEqual(a.inspects(t0, t1 + 86400)[0]["item"], "절연저항"); a.close()

    def test_api_csv_and_range(self):
        st = archwatch.open_store(self.path); a = st; st.arch.seed([(datetime(2026, 5, 1, 0, 0).timestamp() + 900 * i, {"load": 40.0}) for i in range(96)])
        body, ctype, head = archapi.get(a, "/api/archive/series.csv", {"unit": "hour", "at": "2026-05-01"}); self.assertTrue(body.startswith("﻿구간,")); self.assertIn("부하 kWh", body.splitlines()[0]); self.assertEqual(len(body.strip().splitlines()), 25); self.assertIn("csv", ctype); self.assertIn("attachment", head["Content-Disposition"])
        r = archapi.get(a, "/api/archive/series", {"unit": "day", "from": "2026-05-01", "to": "2026-05-01"})[0]; self.assertEqual(len(r["rows"]), 1); self.assertIsNone(archapi.get(a, "/api/other", {}))
        self.assertRaises(ValueError, archapi.get, a, "/api/archive/series", {"unit": "hour", "at": "어제"}); st.arch.close()

    def test_config_check(self):
        bad = []; cfgedit._check_archive({"interval_min": 7, "retain_years": 6, "max_mb": 1, "enabled": "yes"}, bad); self.assertEqual(len(bad), 4)
        bad = []; cfgedit._check_archive({"interval_min": 15, "retain_years": 1, "max_mb": 512, "enabled": True, "server_url": "http://10.0.0.5:8092/recv", "outbox": ""}, bad); self.assertEqual(bad, [])
        bad = []; cfgedit._check_archive({"server_url": "ftp://x", "outbox": 3}, bad); self.assertEqual(len(bad), 2); self.assertEqual(archive.settings({"server_url": "file:///etc"})["server_url"], "")

    def test_docx_is_valid_package(self):
        d = docx.Doc(); d.h1("제목 <&>").p("본문").table(["가", "나"], [[1, "값 & 값"]], [30, 70]); z = zipfile.ZipFile(io.BytesIO(d.to_bytes()))
        self.assertIsNone(z.testzip()); x = z.read("word/document.xml").decode("utf-8"); self.assertIn("제목 &lt;&amp;&gt;", x); self.assertIn("값 &amp; 값", x)
        import xml.dom.minidom as md
        for n in z.namelist():
            if n.endswith((".xml", ".rels")): md.parseString(z.read(n))

    def test_viewer_is_read_only_and_reports(self):
        a = archive.Archive(self.path); now = time.time(); a.seed([(now - 86400 * 3 + 900 * i, {"load": 40.0, "pv": 10.0, "va": 380.0, "hz": 60.0}) for i in range(96 * 3)]); archwatch.demo_inspects(a); a.close()
        httpd, arch = archview.serve(self.path, 0); base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            self.assertIn("archive.js", urllib.request.urlopen(base + "/").read().decode("utf-8")); i = json.loads(urllib.request.urlopen(base + "/api/archive/info").read()); self.assertTrue(i["read_only"]); self.assertEqual(i["rows"], 288)
            self.assertGreaterEqual(len(json.loads(urllib.request.urlopen(base + "/api/archive/series?unit=day").read())["rows"]), 1)
            with self.assertRaises(urllib.error.HTTPError) as e: urllib.request.urlopen(urllib.request.Request(base + "/api/archive/inspect", data=b"{}"))
            self.assertEqual(e.exception.code, 403)
            with self.assertRaises(urllib.error.HTTPError) as e: urllib.request.urlopen(base + "/app.js")
            self.assertEqual(e.exception.code, 404)
            x = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(base + "/api/report.docx?days=7").read())).read("word/document.xml").decode("utf-8")
            for s in ("운영 보고서", "2. 최근 운영 현황", "5. 전기안전 점검 기록", "검침 누적값", "6. ESS 안전 운영정보", "7. 장치별 자료", "8.2 주둔지 서버 전달 이력", "절연저항"): self.assertIn(s, x)
        finally:
            httpd.shutdown(); httpd.server_close(); arch.close()

    # ── 장치별 자료 · ESS 안전 운영정보 · 주둔지 서버 전달
    def _store(self, **cfg):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); pts = pointmap.load(os.path.join(root, "config", "pointmap.csv"))
        return archwatch.open_store(self.path, dict({"interval_min": 15}, **cfg), pts, archdev.load_items(os.path.join(root, "config", "ess_safety.csv")))

    def _fill(self, st, t0, secs=1800):
        val = {"DG.kw": 30.0, "FC.kw": 10.0, "PV.kw": 20.0, "ESS.kw": -5.0, "ESS.soc": 55.0, "ESS.status": 1.0, "H2.nm3": 500.0, "BUS.a_v": 380.0, "BUS.hz": 60.0, "ENV.temp": 21.0, "ENV.rh": 40.0}
        with Clock() as ck:
            for i in range(secs):
                val["DG.kw"] = 30.0 + (10.0 if i == 100 else 0.0); st.arch.tick(INST, t0 + i); st.dev.tick(val, t0 + i); ck.t += 1.0
        st.dev.close(); st.arch._flush()

    def test_items_file(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); it = archdev.load_items(os.path.join(root, "config", "ess_safety.csv")); pts = {p["tag"] for p in pointmap.load(os.path.join(root, "config", "pointmap.csv"))}
        self.assertGreaterEqual(len(it), 25); self.assertEqual(len({i["key"] for i in it}), len(it)); self.assertTrue(all(i["tag"] in pts for i in it if i["tag"]))       # 연결한 신호는 대응표에 있어야 한다
        self.assertEqual({i["group"] for i in it}, {"운영 환경", "배터리", "PCS", "보호 이벤트"}); self.assertEqual(archdev.load_items(os.path.join(self.dir, "none.csv")), [])

    def test_device_series_avg_min_max(self):
        st = self._store(); t0 = datetime(2026, 3, 2, 10, 0).timestamp(); self._fill(st, t0)
        names = [d["dev"] for d in st.dev.devices()]; self.assertIn("DG", names); self.assertIn("H2", names); self.assertIn("PV", names)
        d = st.dev.dev_series("DG", "raw", t0 - 1, t0 + 3600); self.assertEqual(len(d["rows"]), 2); v = d["rows"][0]["v"]["DG.kw"]; self.assertAlmostEqual(v[0], 30.011, delta=0.01); self.assertEqual(v[1:], [30.0, 40.0])
        h = st.dev.dev_series("DG", "hour", t0 - 1, t0 + 3600); self.assertEqual(len(h["rows"]), 1); self.assertEqual(h["rows"][0]["v"]["DG.kw"][2], 40.0); self.assertNotIn("DG.cmd", h["rows"][0]["v"])
        self.assertEqual(st.dev.dev_series("없는장치", "day", 0, 4e9)["rows"], []); self.assertRaises(ValueError, st.dev.dev_series, "DG", "week", 0, 1); st.arch.close()

    def test_ess_safety_one_minute_and_missing_as_zero(self):
        st = self._store(); t0 = datetime(2026, 3, 2, 10, 0).timestamp(); self._fill(st, t0)
        r = st.dev.ess_series("raw", t0, t0 + 1800); self.assertEqual(len(r["rows"]), 30); v = r["rows"][0]["v"]; self.assertEqual(v["soc"][0], 55.0); self.assertEqual(v["room_temp"][0], 21.0); self.assertEqual(v["cell_v_max"][0], 0.0)      # 미수집은 0
        h = st.dev.ess_series("hour", t0, t0 + 3600); self.assertEqual(h["recorded"], 30); self.assertEqual(h["expected"], 30); self.assertEqual(h["rate"], 100.0)
        i = st.dev.info(); self.assertEqual(i["ess_rows"], 30); self.assertLess(i["ess_mapped"], i["ess_items"]); st.arch.close()

    def test_purge_covers_device_and_ess_tables(self):
        st = self._store(retain_years=1); now = time.time(); rows = [(now - 86400 * 500 + 3600 * i, {"load": 1.0, "pv": 1.0, "soc": 50.0}) for i in range(24 * 500)]; st.arch.seed(rows); st.dev.seed(rows, ess_days=500)
        before = st.dev.info(); st.arch.purge(now); after = st.dev.info(); self.assertLess(after["dev_rows"], before["dev_rows"]); self.assertLess(after["ess_rows"], before["ess_rows"]); st.arch.close()

    def test_transfer_bundle_send_mark_and_history(self):
        st = self._store(); t0 = datetime(2026, 3, 2, 10, 0).timestamp(); self._fill(st, t0); st.arch.add_inspect("접지저항", "3.9", "Ω", "", "t", t0 + 60)
        self.assertRaises(ValueError, st.xfer.make, t0 + 86400, t0 + 2 * 86400, "t"); self.assertRaises(ValueError, st.xfer.make, t0, t0 + 200 * 86400, "t")
        r = st.xfer.make(t0, t0 + 3600, "운용자", "IFPS-FOB-01"); self.assertEqual(r["status"], "대기"); self.assertTrue(r["exists"])
        with open(os.path.join(st.xfer.outbox, r["file"]), "rb") as f: body = f.read()
        man = archxfer.verify(body); self.assertEqual(man["rows"], r["rows"]); z = zipfile.ZipFile(io.BytesIO(body)); names = z.namelist()
        for n in ("ess_safety.csv", "ess_items.csv", "meter.csv", "events.csv", "inspect.csv", "device_DG.csv", "device_H2.csv"): self.assertIn(n, names)
        self.assertEqual(len(z.read("ess_safety.csv").decode("utf-8-sig").strip().splitlines()), 31); self.assertRaises(ValueError, archxfer.verify, self._corrupt(body))
        inbox = os.path.join(self.dir, "inbox"); httpd = archrecv.serve(inbox, port=0); url = f"http://127.0.0.1:{httpd.server_address[1]}/"
        try:
            bad = st.xfer.send(r["id"], "http://127.0.0.1:9/", "운용자", timeout=2); self.assertEqual(bad["status"], "전송 실패")
            ok = st.xfer.send(r["id"], url, "운용자"); self.assertEqual(ok["status"], "전달 완료"); self.assertTrue(os.path.isfile(os.path.join(inbox, r["file"])))
            with open(os.path.join(inbox, "received.csv"), encoding="utf-8-sig") as f: self.assertIn(r["sha256"], f.read())
        finally:
            httpd.shutdown(); httpd.server_close()
        h = st.xfer.history(); self.assertEqual(h["pending"], 0); self.assertEqual(h["covered_ts"], t0 + 3600)
        r2 = st.xfer.make(t0 + 900, t0 + 1800, "운용자"); m = st.xfer.mark(r2["id"], "운용자", "보안 USB"); self.assertEqual((m["status"], m["method"], m["note"]), ("전달 완료", "수동", "보안 USB"))
        self.assertRaises(ValueError, st.xfer.get, 999); self.assertRaises(ValueError, st.xfer.send, r["id"], "", "t"); st.arch.purge(time.time()); self.assertEqual(len(st.xfer.history()["rows"]), 2); st.arch.close()      # 전달 이력은 보관 기간 정리로 지우지 않는다

    @staticmethod
    def _corrupt(body):
        src = zipfile.ZipFile(io.BytesIO(body)); out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            for n in src.namelist(): z.writestr(n, src.read(n) + (b"x" if n == "meter.csv" else b""))
        return out.getvalue()

    def test_receiver_rejects_bad_upload(self):
        httpd = archrecv.serve(os.path.join(self.dir, "inbox"), port=0); url = f"http://127.0.0.1:{httpd.server_address[1]}/"
        try:
            for head, body in (({"X-TPCS-File": "../x.zip"}, b"zz"), ({"X-TPCS-File": "TPCS_bundle_202603021000-202603021100.zip", "X-TPCS-SHA256": "00"}, b"zz"), ({"X-TPCS-File": "TPCS_bundle_202603021000-202603021100.zip"}, b"not a zip")):
                with self.assertRaises(urllib.error.HTTPError) as e: urllib.request.urlopen(urllib.request.Request(url, data=body, headers=head))
                self.assertEqual(e.exception.code, 400)
            self.assertEqual(os.listdir(os.path.join(self.dir, "inbox")), [])
        finally:
            httpd.shutdown(); httpd.server_close()

    def test_api_device_ess_xfer_routes(self):
        st = self._store(); t0 = datetime(2026, 3, 2, 10, 0).timestamp(); self._fill(st, t0); q = {"unit": "hour", "at": "2026-03-02"}
        self.assertIn("DG", [d["dev"] for d in archapi.get(st, "/api/archive/devices", {})[0]["rows"]]); self.assertEqual(len(archapi.get(st, "/api/archive/device", dict(q, dev="FC"))[0]["rows"]), 1)
        self.assertIn("DG.kw 평균", archapi.get(st, "/api/archive/device.csv", dict(q, dev="DG"))[0].splitlines()[0]); self.assertIn("충전율(SOC)", archapi.get(st, "/api/archive/ess.csv", {"unit": "raw", "at": "2026-03-02"})[0].splitlines()[0])
        self.assertEqual(archapi.get(st, "/api/archive/ess", q)[0]["recorded"], 30); i = archapi.get(st, "/api/archive/info", {})[0]; self.assertEqual(i["ess_rows"], 30); self.assertEqual(i["server_url"], "")
        r = archwatch.http_post(st, "/api/archive/xfer/make", {"from": "2026-03-02", "to": "2026-03-02"}, "운용자", "S"); self.assertTrue(r["ok"]); self.assertEqual(archapi.get(st, "/api/archive/xfer", {})[0]["pending"], 1)
        self.assertTrue(archwatch.http_post(st, "/api/archive/xfer/mark", {"id": r["row"]["id"], "note": "USB"}, "운용자")["ok"]); self.assertRaises(KeyError, archwatch.http_post, st, "/api/archive/zzz", {}, "t"); st.arch.close()

    def test_collect_intervals_and_exclude(self):
        st = self._store(dev_interval_min=1, ess_interval_s=300, dev_exclude=["DG.kw"]); t0 = datetime(2026, 3, 2, 10, 0).timestamp(); self._fill(st, t0, 600)
        d = st.dev.dev_series("FC", "raw", t0 - 1, t0 + 3600); self.assertEqual(len(d["rows"]), 10)       # 1분 줄
        self.assertNotIn("DG.kw", [s["tag"] for s in st.dev.groups["DG"]]); self.assertEqual(st.dev.dev_series("DG", "raw", t0 - 1, t0 + 3600)["rows"], [])       # 뺀 신호는 쌓지 않는다
        self.assertEqual(st.dev.ess_series("raw", t0, t0 + 3600)["rows"].__len__(), 2); self.assertEqual(st.dev.info()["ess_step_s"], 300); st.arch.close()

    def test_collect_check_rejects_bad_items(self):
        class E:                                         # 검사에 필요한 것만 가진 대역
            pass
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); e = E(); e.rt = E(); e.rt.pts = pointmap.load(os.path.join(root, "config", "pointmap.csv"))
        ok = {"items": [{"key": "soc", "group": "배터리", "label": "충전율", "unit": "%", "tag": "ESS.soc"}, {"key": "cell_v", "group": "배터리", "label": "셀 전압", "unit": "V", "tag": ""}], "cfg": {"interval_min": 5, "dev_interval_min": 1, "ess_interval_s": 60, "retain_years": 5, "max_mb": 1024}, "dev_exclude": ["DG.hb"]}
        bad, items, part = archcfg.check(e, ok); self.assertEqual(bad, []); self.assertEqual(len(items), 2); self.assertEqual(part["dev_exclude"], ["DG.hb"]); self.assertIn("key,group,label,unit,tag", archcfg.items_csv(items))
        for change in ({"items": [{"key": "Bad Key", "label": "x"}]}, {"items": [{"key": "a", "label": "x"}, {"key": "a", "label": "y"}]}, {"items": [{"key": "a", "label": "x", "tag": "NO.tag"}]}, {"items": [{"key": "a", "label": ""}]},
                       {"cfg": {"ess_interval_s": 7}}, {"cfg": {"retain_years": 9}}, {"dev_exclude": ["NO.tag"]}, {"items": [{"key": f"k{i}", "label": "x"} for i in range(200)]}):
            self.assertTrue(archcfg.check(e, dict(ok, **change))[0], change)

    # ── 시퀀스 문서(PPT)
    @staticmethod
    def _json(path):
        with open(path, encoding="utf-8") as f: return json.load(f)

    def _cases(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); rd = lambda *a: self._json(os.path.join(root, *a)); cfg = rd("config", "runtime.json"); pts = pointmap.load(os.path.join(root, "config", "pointmap.csv"), cfg["devices"])
        return rd("ifps_ems_rt", "hmi", "static", "scenario_presets.json"), pts, cfg["devices"], os.path.join(root, "config", "runtime.json")

    def test_pptx_writer_reader(self):
        d = pptx.Deck(); s = d.slide(); s.box(0.5, 0.5, 5, 0.5, "시나리오: 가 <&> 나", name="scn-name").line(1, 2, 5, 2, arrow=True, dash=True).table(0.5, 3, 12, ["번호", "종류"], [[1, "대기"], [2, "입력 & 값"]]); body = d.to_bytes()
        z = zipfile.ZipFile(io.BytesIO(body)); self.assertIsNone(z.testzip())
        import xml.dom.minidom as md
        for n in z.namelist(): md.parseString(z.read(n))
        r = pptx.read(body); self.assertEqual(r[0]["texts"], [("scn-name", "시나리오: 가 <&> 나")]); self.assertEqual(r[0]["tables"][0][2], ["2", "입력 & 값"])
        self.assertRaises(ValueError, pptx.read, b"not a zip"); self.assertRaises(ValueError, pptx.read, b"x" * (pptx.MAX_FILE + 1))

    def test_sequence_ppt_round_trip_all_presets(self):
        cases, pts, devices, prof = self._cases(); body = seqppt.export(cases, None, "RevXX", "S"); r = seqppt.import_(body, pts, devices, prof)
        self.assertEqual((r["found"], len(r["cases"]), r["errors"]), (len(cases), len(cases), [])); strip = lambda c: [{k: v for k, v in s.items() if k != "limit"} for s in c["steps"]]
        for a, b in zip(r["cases"], cases): self.assertEqual(a["name"], b["name"]); self.assertEqual(strip(a), strip(b))

    def test_sequence_ppt_edit_and_errors(self):
        cases, pts, devices, prof = self._cases(); one = [c for c in cases if c["name"] == "작전지 · PV 급감과 디젤 인수"]; tl = seqppt.timeline(one[0]); self.assertEqual(tl[2], 100); self.assertEqual(tl[-1], 1200)        # 대기 100 + 판정 한도 500 + 600
        self.assertEqual(seqppt.step_of(["판정", "DG.status", "≥", "1", "700"]), {"type": "expect", "tag": "DG.status", "value": 1, "op": "ge", "ms": 700, "limit": 700}); self.assertEqual(seqppt.step_of(["지령", "DG", "", "정지", ""])["value"], 2)
        self.assertEqual(seqppt.step_of(["TPCS 정책 실행", "AUTO · 주둔지 · 자립", "", "13", ""]), {"type": "policy", "control": "auto", "mode": "grid", "posture": "자립", "hour": 13})
        for bad in (["모름", "", "", "", ""], ["판정", "DG.status", "?", "1", "0"], ["대기", "", "", "", "abc"], ["지령", "DG", "", "켜라", ""], ["TPCS 정책 실행", "AUTO · 작전지", "", "", ""]): self.assertRaises(ValueError, seqppt.step_of, bad)
        d = pptx.Deck(); s = d.slide(); s.box(0, 0, 5, 0.5, "시나리오: 회의 수정안").box(0, 1, 5, 0.5, "설명: 전문가 검토")
        s.table(0, 2, 12, seqppt.HEAD, [[1, "입력", "LOAD.kw", "", "120", "", "", "", ""], [2, "대기", "", "", "", "200", "", "", "여유 필요"], [3, "판정", "ESS.kw", "≥", "0", "0", "", "", ""]])
        s2 = d.slide(); s2.box(0, 0, 5, 0.5, "시나리오: 틀린 안"); s2.table(0, 2, 12, seqppt.HEAD, [[1, "입력", "NO.tag", "", "1", "", "", "", ""]])
        s3 = d.slide(); s3.box(0, 0, 5, 0.5, "시나리오: 범위 밖"); s3.table(0, 2, 12, seqppt.HEAD, [[1, "대기", "", "", "", "999999", "", "", ""]])
        r = seqppt.import_(d.to_bytes(), pts, devices, prof); self.assertEqual([c["name"] for c in r["cases"]], ["회의 수정안"]); self.assertEqual(len(r["cases"][0]["steps"]), 3); self.assertIn("[검토 의견] 2단계: 여유 필요", r["cases"][0]["note"])
        self.assertEqual(sorted(e["name"] for e in r["errors"]), ["범위 밖", "틀린 안"]); self.assertRaises(ValueError, seqppt.import_, pptx.Deck().to_bytes(), pts, devices, prof)

    def test_report_period(self):
        a, b = report._period({"from": "2026-01-01", "to": "2026-01-31"}); self.assertEqual((b - a).days, 31); a, b = report._period({"days": "99999"}); self.assertEqual((b - a).days, 1830)


if __name__ == "__main__":
    unittest.main()
