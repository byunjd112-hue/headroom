"""현장 구성 반영(FMEA 펼침 · FAT 점검표)과 내보내기 파일."""
import io, json, os, unittest, zipfile
from xml.dom import minidom

from ifps_ems_rt import fmsite
from ifps_ems_rt.hmi import fmexport, xlsxw

HERE = os.path.dirname(os.path.abspath(__file__))


def snap():
    fsu = [{"id": f"FSU{k}", "name": f"구간분전함 {k}"} for k in range(1, 5)]
    return {"fleet": {"ESS": {"units": [{"id": "ESS"}, {"id": "ESS2"}]}, "PV": {"units": [{"id": "PV"}]}, "DG": {"units": [{"id": "DG"}]}},
            "bus": {"sources": [{"id": "PV", "kind": "PV", "name": "태양광", "bus": "A", "present": True}, {"id": "DG", "kind": "DG", "name": "디젤 발전기", "bus": "A", "present": True},
                                {"id": "ESS", "kind": "ESS", "name": "이동형 ESS 1호기", "bus": "B", "present": True}, {"id": "ESS2", "kind": "ESS", "name": "이동형 ESS 2호기", "bus": "A", "present": True},
                                {"id": "FC", "kind": "FC", "name": "연료전지", "bus": "A", "present": False}],
                    "loads": [{"id": "c2", "name": "지휘통제(C2)", "bus": "A"}, {"id": "brk", "name": "막사", "bus": "B"}], "issues": []},
            "ring": {"fsu": fsu, "ppdu": [{"id": "PPDU1"}], "open": 2, "sections": [{"i": i} for i in range(5)], "n1": {"items": [{"area": "공급 경로", "level": "warn", "text": "약점", "fix": "고친다"}]}},
            "loads": {"items": [{"id": "c2", "name": "지휘통제(C2)", "grade": 1, "n": 1, "rated": 30.0, "fsu": "FSU2", "fsu_name": "구간분전함 2", "ppdus": ["PPDU1"], "need": 4, "alt_name": "구간분전함 3", "save_pct": 0},
                                {"id": "brk", "name": "막사", "grade": 2, "n": 2, "rated": 24.0, "fsu": "FSU3", "fsu_name": "구간분전함 3", "ppdus": ["PPDU5", "PPDU6"], "need": 2, "save_pct": 30},
                                {"id": "x", "name": "뺀 부하", "grade": 3, "n": 0, "rated": 0.0}]}}


class Site(unittest.TestCase):
    def test_rows_follow_the_configuration(self):
        """장비 한 대 · 구간 · 구간분전함 · 부하마다 줄이 생기고, 번호는 기존 번호만 쓰며, 구성 때문에 달라지는 줄만 재검토로 표시한다."""
        d = fmsite.build(snap(), {"trip_ms": 100, "close_ms": 2500}, "2026-01-01 00:00"); fm, fat = d["fmea"], d["fat"]
        self.assertTrue(all(len(r) == len(fmsite.FM_HEAD) for r in fm) and all(len(r) == len(fmsite.FAT_HEAD) for r in fat))
        self.assertEqual({r[0] for r in fm}, {"FM-02", "FM-74", "C-11", "FM-75", "C-12"})                         # 새 번호를 짓지 않는다
        unit = {r[1]: r for r in fm if r[0] == "FM-02"}; self.assertEqual(len(unit), 4); self.assertNotIn("연료전지", " ".join(unit))        # 없는 종류는 빠진다
        self.assertIn("2대 가운데 1대", unit["이동형 ESS 1호기 · 모선 B"][3]); self.assertEqual(unit["이동형 ESS 1호기 · 모선 B"][5], "재검토")   # 모선 B 의 전압을 세우는 전원이 이것뿐
        self.assertEqual(unit["태양광 · 모선 A"][5], "")
        sec = [r for r in fm if r[0] == "C-11"]; self.assertEqual(len(sec), 5); self.assertIn("구간분전함 2", sec[1][3]); self.assertIn("지휘통제(C2)(1등급)", sec[1][3]); self.assertIn("2.6초", sec[1][3])
        self.assertIn("상시 개방점", sec[2][3]); self.assertIn("구간분전함 3", sec[3][3])                         # 구간 3 이 끊기면 구간분전함 3 을 반대쪽에서
        f75 = [r for r in fm if r[0] == "FM-75"]; self.assertIn("우회 결선으로 구간분전함 3", f75[0][3]); self.assertEqual(f75[2][5], "재검토")      # 배전체계 1대(필요 4대)
        self.assertEqual(fm[-1][0], "C-12")
        self.assertTrue(all(r[0] == "" and r[7] == "" and r[8] == "" for r in fat))                               # 번호 · 결과 · 비고는 빈칸
        txt = json.dumps(fat, ensure_ascii=False); [self.assertIn(w, txt) for w in ("이동형 ESS 2호기", "막사 ×2", "절감하면 약 30%", "1등급 무정전", "구간 1 (구간분전함 1 ↔ 구간분전함 2)")]
        self.assertNotIn("뺀 부하", txt); self.assertEqual(dict(map(tuple, d["summary"]))["부하"].split(" · ")[0], "3개")

    def test_files_are_valid(self):
        """Excel 은 열리는 꾸러미(시트 3장, XML 정상), FAT · FMEA HTML 은 구성의 이름을 담는다."""
        d = fmsite.build(snap(), {}, "2026-01-01 00:00"); z = zipfile.ZipFile(io.BytesIO(fmexport.site_xlsx(d, "RevX")))
        for n in z.namelist(): minidom.parseString(z.read(n))
        self.assertEqual(len([n for n in z.namelist() if "worksheets/" in n]), 3); self.assertIn("이동형 ESS 2호기", z.read("xl/worksheets/sheet2.xml").decode("utf-8"))
        self.assertIn("22_FAT점검표", z.read("xl/workbook.xml").decode("utf-8"))
        x = xlsxw.write([("a[b]:c", [["#머리", 1.5], ["글 <&> \x01", None, True]], None)]); s = zipfile.ZipFile(io.BytesIO(x)).read("xl/worksheets/sheet1.xml").decode("utf-8")
        self.assertIn("<v>1.5</v>", s); self.assertIn("&lt;&amp;&gt;", s); self.assertNotIn("\x01", s); self.assertRaises(ValueError, xlsxw.write, [])
        h = fmexport.fat_html(d, "RevX"); self.assertIn("막사 ×2", h); self.assertIn("FAT 점검표", h)
        w = fmexport.fmea_html(d, "RevX"); self.assertIn("현장 구성·FAT 점검표", w); self.assertIn("이동형 ESS 2호기", w); self.assertIn("22_FAT점검표", w)


class InitRows(unittest.TestCase):
    def test_open_point_must_match_the_setting(self):
        """설치 점검의 상시 개방점: 한 곳만 열려 있어도 설정과 다른 구간이면 주의(부하의 모선 표시가 실제와 달라진다). 열린 곳이 없으면 이상."""
        from ifps_ems_rt.hmi import initcheck                                         # pylint: disable=import-outside-toplevel
        sec = lambda o: [{"i": i, "state": 0 if i in o else 1} for i in range(5)]
        self.assertEqual(initcheck._nop(sec({2}), 2)["level"], "ok"); w = initcheck._nop(sec({3}), 2); self.assertEqual(w["level"], "warn"); self.assertIn("구간 2", w["text"]); self.assertIn("구간 3", w["text"]); self.assertTrue(w["guide"])
        self.assertEqual(initcheck._nop(sec(set()), 2)["level"], "bad"); self.assertEqual(initcheck._nop(sec({1, 3}), 2)["level"], "warn")


if __name__ == "__main__":
    unittest.main()
