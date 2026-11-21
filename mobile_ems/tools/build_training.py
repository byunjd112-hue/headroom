# -*- coding: utf-8 -*-
"""교육용 가상 화면 묶음을 만든다: 실제 EMS 화면 파일(static) + 가상 장치에서 녹화한 응답 + 교육 창.

  python -m tools.build_training <출력 폴더> [리비전]
묶음의 index.html 을 두 번 누르면 브라우저에서 열린다(설치·서버 불필요). 화면은 실제 EMS 와 같은 파일이다.
값은 가상 장치를 장면별로 돌려 녹화한 것이라, 운용 장소·태세·지령·고장은 '녹화해 둔 장면을 바꾸는' 식으로 움직인다(새로 계산하지 않는다).
"""
import base64, json, mimetypes, os, re, shutil, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from ifps_ems_rt.hmi.engine import Engine          # noqa: E402
from ifps_ems_rt.hmi import server                  # noqa: E402

STATIC = os.path.join(ROOT, "ifps_ems_rt", "hmi", "static")
FRAMES, GAP_S, SETTLE_S = 6, 1.2, 9.0
SCENE_GET = ["/api/trend?since=0", "/api/forecast", "/api/energy", "/api/journal?n=300", "/api/points", "/api/archive/info", "/api/archive/devices", "/api/archive/events?unit=day", "/api/archive/inspect?unit=year", "/api/archive/xfer"] \
    + [f"/api/archive/{k}?unit={u}" for k in ("series", "ess") for u in ("hour", "day", "month", "year")] + ["/api/archive/ess?unit=raw"]
GLOBAL_GET = ["/api/layout", "/api/photos", "/api/info", "/api/ai", "/api/audit?n=200", "/api/audit/verify", "/api/config", "/api/scenarios/catalog", "/api/archive/collect"]


class Client:
    def __init__(self, base):
        self.base = base; self.tok = ""

    def call(self, path, body=None):
        req = urllib.request.Request(self.base + path, data=None if body is None else json.dumps(body).encode("utf-8"), headers={"X-EMS-Token": self.tok, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode("utf-8"))          # nosec B310 — 자기 자신(127.0.0.1)의 가상 장치 서버만 부른다


def _key(path):
    """녹화 열쇠: 경로 + unit(+dev). 날짜 같은 나머지 조건은 뺀다(교육 화면은 어느 날짜를 골라도 같은 녹화를 보여 준다)."""
    p, _, q = path.partition("?"); kv = dict(x.split("=", 1) for x in q.split("&") if "=" in x)
    return p + (f"?unit={kv['unit']}" if "unit" in kv and "/archive/" in p else "") + (f"&dev={kv['dev']}" if "dev" in kv else "")


def record(c, devs):
    time.sleep(SETTLE_S); frames = []
    for _ in range(FRAMES): frames.append(c.call("/api/snapshot")); time.sleep(GAP_S)
    get = {_key(p): c.call(p) for p in SCENE_GET}
    for d in devs: get[_key(f"/api/archive/device?dev={d}&unit=hour")] = c.call(f"/api/archive/device?dev={d}&unit=hour")
    return {"frames": frames, "get": get}


def scenes(c):
    """장면: 운용 장소 × 태세 6가지 + 상전 정전 + 고장(2등급 트립·연료전지 통신 두절) + 수동 디젤 기동."""
    sim = lambda b: c.call("/api/sim", b); out = {}; devs = [d["dev"] for d in c.call("/api/archive/devices")["rows"]]
    def reset(mode, posture):
        sim({"action": "scenario", "name": "normal"}); c.call("/api/auto", {"on": True}); c.call("/api/ops", {"mode": mode}); c.call("/api/ops", {"posture": posture}); sim({"action": "clock", "hour": 13})
    for mode in ("island", "grid"):
        for posture in ("평시", "저소음", "자립"): reset(mode, posture); out[f"{mode}|{posture}"] = record(c, devs)
    reset("grid", "평시"); sim({"action": "scenario", "name": "grid_outage"}); out["outage"] = record(c, devs); sim({"action": "scenario", "name": "grid_restore"})
    reset("island", "평시"); sim({"action": "fault", "target": "L2", "code": 51}); sim({"action": "mute", "target": "FC", "on": True}); out["fault"] = record(c, devs); sim({"action": "scenario", "name": "normal"}); sim({"action": "mute", "target": "FC", "on": False})
    reset("island", "평시"); time.sleep(4); c.call("/api/auto", {"on": False}); sel = c.call("/api/select", {"dev": "DG", "cmd": "start"})
    if sel.get("sid"): c.call("/api/operate", {"sid": sel["sid"]})
    out["dg_on"] = record(c, devs)
    return out, sel


def _data_uri(path):
    with open(path, "rb") as f: return f"data:{mimetypes.guess_type(path)[0] or 'application/octet-stream'};base64," + base64.b64encode(f.read()).decode("ascii")


def single_file(folder, dest):
    """묶음 폴더를 파일 하나로 만든다(휴대전화·태블릿용): 글꼴 없는 CSS·스크립트·그림을 모두 한 HTML 안에 넣는다. 설명서 그림(manual/)은 커서 뺀다."""
    with open(os.path.join(folder, "index.html"), encoding="utf-8") as f: html = f.read()
    with open(os.path.join(folder, "style.css"), encoding="utf-8") as f: css = f.read()
    css = re.sub(r"url\((['\"]?)([^'\")]+)\1\)", lambda m: f'url("{_data_uri(os.path.join(folder, m.group(2)))}")' if not m.group(2).startswith("data:") and os.path.isfile(os.path.join(folder, m.group(2))) else m.group(0), css)
    assets = {f"{d}/{n}": _data_uri(os.path.join(folder, d, n)) for d in ("photos", "sprites") if os.path.isdir(os.path.join(folder, d)) for n in sorted(os.listdir(os.path.join(folder, d))) if os.path.isfile(os.path.join(folder, d, n))}
    def script(m):
        with open(os.path.join(folder, m.group(1)), encoding="utf-8") as f: return "<script>" + f.read().replace("</script", "<\\/script") + "</script>"
    html = re.sub(r'<link[^>]+href="style\.css"[^>]*>', lambda m: "<style>" + css + "</style>", html, count=1)
    html = html.replace('<script src="train_data.js"></script>', '<script>window.TRAIN_ASSETS = ' + json.dumps(assets) + ';</script>\n<script src="train_data.js"></script>', 1)
    html = re.sub(r'<script src="([\w.]+\.js)"></script>', script, html)
    with open(dest, "w", encoding="utf-8") as f: f.write(html)
    return os.path.getsize(dest)


def build(out, rev):
    d = tempfile.mkdtemp()
    try:
        shutil.copytree(os.path.join(ROOT, "config"), os.path.join(d, "config"), ignore=shutil.ignore_patterns("state*", "backup"))
        eng = Engine(os.path.join(d, "config", "runtime.json"), sim=True, plan_dir=os.path.join(ROOT, "results")); eng.start(); httpd = server.serve(eng, port=0)
        try:
            c = Client(f"http://127.0.0.1:{httpd.server_address[1]}"); c.tok = c.call("/api/login", {"pin": eng.cfg["hmi"].get("pin_engineer", ""), "name": "교육생"})["token"]; time.sleep(6)
            sc, sel = scenes(c); glob = {_key(p): c.call(p) for p in GLOBAL_GET}; cat = glob["/api/scenarios/catalog"]; cases = cat.get("presets") or []
            ver = {r["name"]: r for r in c.call("/api/scenarios/verify", {"cases": cases[:32]}).get("results", [])} if cases else {}
        finally:
            httpd.shutdown(); eng.stop()
        files = {}
        for n in ("manual.json", "troubleshoot.json", "scenario_presets.json"):
            with open(os.path.join(STATIC, n), encoding="utf-8") as f: files[n] = json.load(f)
        if os.path.isdir(out): shutil.rmtree(out)
        shutil.copytree(STATIC, out, ignore=shutil.ignore_patterns("viewer.*"))
        with open(os.path.join(out, "train_data.js"), "w", encoding="utf-8") as f:
            f.write("window.TRAIN_DATA = " + json.dumps({"rev": rev, "made": time.strftime("%Y-%m-%d %H:%M"), "scenes": sc, "global": glob, "select": sel, "verify": ver, "files": files}, ensure_ascii=False, separators=(",", ":")) + ";\n")
        with open(os.path.join(out, "index.html"), encoding="utf-8") as f: html = f.read()
        html = html.replace('<script src="core.js"></script>', '<script src="train_data.js"></script>\n<script src="train_mock.js"></script>\n<script src="core.js"></script>', 1)
        with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f: f.write(html)
        with open(os.path.join(out, "읽어보기.txt"), "w", encoding="utf-8") as f:
            f.write(f"IFPS 이동형 EMS 교육용 가상 화면 ({rev})\n\nPC: index.html 을 두 번 눌러 브라우저(Edge·Chrome)로 연다. 설치나 서버가 필요 없다.\n휴대전화·태블릿: 같이 나온 '_모바일.html' 파일 하나를 기기에 넣어 브라우저로 연다(화면을 밀어서 보고, 교육 창의 －·맞춤·＋ 로 크기를 바꾼다).\n화면은 실제 EMS 와 같은 파일이다. 값은 가상 장치에서 녹화한 가상값이며,\n운용 장소·태세·지령·고장은 녹화해 둔 장면을 바꾸는 식으로 움직인다(새로 계산하지 않는다).\n값이 실제로 계산되는 연습은 EMS 의 가상 장치 모드(run_sim.bat)에서 '교육' 단추를 눌러 한다.\n")
        size = sum(os.path.getsize(os.path.join(dp, n)) for dp, _, fs in os.walk(out) for n in fs)
        one = single_file(out, out + "_모바일.html")
        print(f"교육용 가상 화면: {out} (장면 {len(sc)}개, 묶음 {size / 1048576:.1f} MB, 파일 하나짜리 {one / 1048576:.1f} MB)")
    finally:
        shutil.rmtree(d, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "Rev00"))
