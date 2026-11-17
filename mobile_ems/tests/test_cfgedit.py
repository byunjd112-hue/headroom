# -*- coding: utf-8 -*-
"""설정 편집기: 검사 없이는 저장되지 않고, 저장하면 이전 판이 남으며, 비밀 값은 화면으로 나가지 않는다."""
import json, os, shutil, tempfile, unittest
from ifps_ems_rt.hmi import cfgedit as ce

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestConfigEditor(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        for f in ("runtime.json", "pointmap.csv"): shutil.copy(os.path.join(ROOT, "config", f), self.d)
        self.notes = []; self.ed = ce.ConfigEditor(os.path.join(self.d, "runtime.json"), note=lambda k, t, actor="": self.notes.append((k, t, actor)))

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def cfg(self):
        with open(os.path.join(self.d, "runtime.json"), encoding="utf-8") as f: return json.load(f)

    def test_read_masks_secrets_and_lists_choices(self):
        r = self.ed.read(); t = json.loads(r["runtime"]["text"])
        self.assertEqual(t["hmi"]["pin_operator"], ce.MASK); self.assertEqual(t["hmi"]["pin_engineer"], ce.MASK); self.assertNotIn("1111", r["runtime"]["text"])
        self.assertEqual(r["pointmap"]["cols"], ce.COLS); self.assertGreater(len(r["pointmap"]["rows"]), 60); self.assertEqual(r["pending"], []); self.assertIn("GDG", r["choices"]["device"])

    def test_pointmap_errors_block_save(self):
        r = self.ed.read(); rows = [x[:] for x in r["pointmap"]["rows"]]; before = open(os.path.join(self.d, "pointmap.csv"), encoding="utf-8").read()
        bad = [x[:] for x in rows]; bad[1][3] = bad[0][3]                                        # 주소 겹침
        out = self.ed.save("pointmap", {"rows": bad, "sha": r["pointmap"]["sha"]}, "시험"); self.assertFalse(out["ok"]); self.assertTrue(any("주소 겹침" in e for e in out["errors"]))
        for i, v, word in ((3, "abc", "숫자가 아님"), (4, "u99", "자료형"), (1, "NOPE", "정의되지 않은 장치"), (0, "한글이름", "영문"), (3, "70000", "0~65535"), (10, "XYZW", "바이트 순서")):
            b = [x[:] for x in rows]; b[5][i] = v; e = self.ed.check("pointmap", {"rows": b})["errors"]; self.assertTrue(any(word in x for x in e), (word, e))
        b = [x for x in rows if x[0] != "DG.seq_ack"]; self.assertTrue(any("seq·seq_ack·status" in x for x in self.ed.check("pointmap", {"rows": b})["errors"]))
        self.assertEqual(self.ed.check("pointmap", {"rows": []})["errors"], ["행이 없음"]); self.assertFalse(self.ed.check("pointmap", {"rows": [["a.b"]]})["ok"])
        self.assertEqual(before, open(os.path.join(self.d, "pointmap.csv"), encoding="utf-8").read()); self.assertEqual(self.ed.backups(), [])

    def test_pointmap_save_backup_pending_and_restore(self):
        r = self.ed.read(); rows = [x[:] for x in r["pointmap"]["rows"]]; i = next(k for k, x in enumerate(rows) if x[0] == "DG.fuel_l"); rows[i][5] = "0.1"
        rows.append(["DG.kwh", "DG", "3", "40", "u32", "0.1", "kWh", "", "", "r", "CDAB"])
        c = self.ed.check("pointmap", {"rows": rows}); self.assertTrue(c["ok"]); self.assertGreaterEqual(c["changed"], 3); self.assertTrue(any(l.startswith("+DG.kwh") for l in c["diff"]))
        self.assertFalse(self.ed.save("pointmap", {"rows": rows, "sha": "000000000000"}, "시험")["ok"])            # 불러온 뒤 파일이 바뀐 경우
        s = self.ed.save("pointmap", {"rows": rows, "sha": r["pointmap"]["sha"]}, "김상사"); self.assertTrue(s["saved"]); self.assertTrue(s["restart"])
        self.assertIn("DG.kwh,DG,3,40,u32,0.1,kWh,,,r,CDAB", open(os.path.join(self.d, "pointmap.csv"), encoding="utf-8").read())
        r2 = self.ed.read(); self.assertEqual(r2["pending"], ["pointmap"]); self.assertEqual(len(r2["backups"]), 1); self.assertEqual(self.notes[-1][2], "김상사"); self.assertIn("재기동", self.notes[-1][1])
        self.assertFalse(self.ed.save("pointmap", {"rows": rows}, "시험")["ok"])                                    # 바뀐 내용 없음
        self.assertFalse([f for f in os.listdir(self.d) if f.endswith(".tmp")])
        back = self.ed.restore(r2["backups"][0]["name"], "김상사"); self.assertTrue(back["ok"]); self.assertEqual(self.ed.read()["pending"], [])
        self.assertNotIn("DG.kwh", open(os.path.join(self.d, "pointmap.csv"), encoding="utf-8").read()); self.assertEqual(len(self.ed.backups()), 2)
        for bad in ("../runtime.json", "pointmap.csv", "runtime.20260101-000000.bak", None):
            with self.assertRaises(ValueError): self.ed.restore(bad, "시험")

    def test_runtime_validation_and_secret_kept(self):
        r = self.ed.read(); t = json.loads(r["runtime"]["text"]); pin = self.cfg()["hmi"]["pin_operator"]
        chk = lambda o: self.ed.check("runtime", {"text": json.dumps(o)})["errors"]
        self.assertTrue(any("JSON 문법" in e for e in self.ed.check("runtime", {"text": "{bad"})["errors"])); self.assertTrue(chk([1]))
        for path, v, word in ((("devices", "DG", "unit"), 300, "0~247"), (("devices", "DG", "paths"), [["999.1.1.1", 502]], "IP 범위"), (("devices", "DG", "paths"), [["a", 1]], "형식 오류"),
                              (("devices", "FC", "order"), "QQQQ", "중 하나"), (("garrison", "reserve_soc"), 1.5, "범위"), (("garrison", "gdg_restart_soc"), 0.9, "낮아야"),
                              (("ctrl_s",), 0, "범위"), (("run_mode",), "시험", "run_mode"), (("site", "dg_kw"), -1, "0 이상"), (("pointmap",), "../x.csv", "pointmap")):
            o = json.loads(json.dumps(t)); x = o
            for k in path[:-1]: x = x[k]
            x[path[-1]] = v; e = chk(o); self.assertTrue(any(word in s for s in e), (word, e))
        o = json.loads(json.dumps(t)); o["devices"]["FC"]["paths"] = o["devices"]["DG"]["paths"]; o["devices"]["FC"]["unit"] = o["devices"]["DG"]["unit"]; self.assertTrue(any("같음" in s for s in chk(o)))
        o = json.loads(json.dumps(t)); del o["devices"]["GDG"]; self.assertTrue(any("대응표와 맞지 않음" in s for s in chk(o)))                 # 대응표가 쓰는 장치를 지움
        o = json.loads(json.dumps(t)); o["pointmap"] = "other.csv"; self.assertTrue(any("바꿀 수 없음" in s for s in chk(o)))
        o = json.loads(json.dumps(t)); o["garrison"]["peak_kw"] = 180; o["devices"]["DG"]["done_s"] = 8
        c = self.ed.check("runtime", {"text": json.dumps(o)}); self.assertTrue(c["ok"]); self.assertFalse(any(pin in l for l in c["diff"])); self.assertGreaterEqual(c["changed"], 3); self.assertLessEqual(c["changed"], 5)      # 60.0 → 60 같은 표기 차이는 변경으로 세지 않는다
        s = self.ed.save("runtime", {"text": json.dumps(o), "sha": r["runtime"]["sha"]}, "김상사"); self.assertTrue(s["saved"])
        n = self.cfg(); self.assertEqual(n["garrison"]["peak_kw"], 180); self.assertEqual(n["devices"]["DG"]["done_s"], 8); self.assertEqual(n["hmi"]["pin_operator"], pin)      # 가려진 값은 그대로 유지
        self.assertEqual(self.ed.read()["pending"], ["runtime"]); self.assertTrue(self.ed.restore(self.ed.backups()[0]["name"], "김상사")["ok"]); self.assertEqual(self.cfg()["garrison"]["peak_kw"], 150)
        with self.assertRaises(ValueError): self.ed.check("other", {})

    def test_backups_are_pruned_and_broken_backup_refused(self):
        r = self.ed.read(); rows = r["pointmap"]["rows"]; i = next(k for k, x in enumerate(rows) if x[0] == "DG.fuel_l")
        for n in range(ce.KEEP + 3):
            b = [x[:] for x in rows]; b[i][8] = str(2001 + n); self.assertTrue(self.ed.save("pointmap", {"rows": b}, "시험").get("saved"))
        self.assertEqual(len([b for b in self.ed.backups() if b["kind"] == "pointmap"]), ce.KEEP)
        os.makedirs(self.ed.bdir, exist_ok=True)
        with open(os.path.join(self.ed.bdir, "runtime.20200101-000000.bak"), "w", encoding="utf-8") as f: f.write("{broken")
        out = self.ed.restore("runtime.20200101-000000.bak", "시험"); self.assertFalse(out["ok"]); self.assertEqual(self.cfg()["garrison"]["peak_kw"], 150)


if __name__ == "__main__":
    unittest.main()
