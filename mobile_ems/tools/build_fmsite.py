"""현장 구성 FMEA 펼침 · FAT 점검표를 문서 묶음용 파일로 만든다(docs/fmea_site.json — 가상 장치의 기본 구성에서 받아 둔 자료).

  python tools/build_fmsite.py Rev64              docs/out 에 FAT 점검표(HTML) · 현장 구성 FMEA · FAT(Excel)를 쓴다
  python tools/build_fmsite.py --fetch [주소]     띄워 둔 EMS(기본 http://127.0.0.1:8088, 가상 장치)에서 지금 구성을 받아 docs/fmea_site.json 을 고친다
EMS 화면의 [기록 · 보고서] → [현재 구성으로 FMEA · FAT 내보내기]가 만드는 것과 같은 양식이다(ifps_ems_rt/hmi/fmexport.py).
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from ifps_ems_rt.hmi import fmexport   # noqa: E402

SITE = os.path.join(ROOT, "docs", "fmea_site.json")


def fetch(base):
    post = urllib.request.Request(base + "/api/login", data=json.dumps({"pin": "1111", "name": "빌드"}).encode(), method="POST")
    with urllib.request.urlopen(post, timeout=10) as r: tok = json.load(r)["token"]
    with urllib.request.urlopen(urllib.request.Request(base + "/api/archive/fmexport?doc=site&fmt=json", headers={"X-EMS-Token": tok}), timeout=20) as r: data = json.load(r)
    with open(SITE, "w", encoding="utf-8") as f: json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"saved {SITE}  FMEA {len(data['fmea'])}줄 · FAT {len(data['fat'])}줄")
    return 0


def main(argv=None):
    a = argv or sys.argv[1:]
    if a and a[0] == "--fetch": return fetch(a[1] if len(a) > 1 else "http://127.0.0.1:8088")
    if not os.path.exists(SITE): print("docs/fmea_site.json 없음 — 건너뜀"); return 0
    rev = a[0] if a else fmexport._rev()                                    # pylint: disable=protected-access
    with open(SITE, encoding="utf-8") as f: data = json.load(f)
    out = os.path.join(ROOT, "docs", "out"); os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, f"IFPS_EMS_FAT점검표_{rev}.html"), "w", encoding="utf-8") as f: f.write(fmexport.fat_html(data, rev))
    with open(os.path.join(out, f"IFPS_EMS_현장구성_FMEA_FAT_{rev}.xlsx"), "wb") as f: f.write(fmexport.site_xlsx(data, rev))
    print(f"saved FAT 점검표(HTML) · 현장 구성 FMEA · FAT(Excel) {rev}  FMEA {len(data['fmea'])}줄 · FAT {len(data['fat'])}줄")
    return 0


if __name__ == "__main__":
    sys.exit(main())
