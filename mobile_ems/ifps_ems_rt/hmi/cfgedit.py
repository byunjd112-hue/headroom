# -*- coding: utf-8 -*-
"""설정 편집기(오프라인). 제어화면에서 운전 설정(runtime.json)과 대응표(pointmap.csv)를 고친다.

원칙
  · 고칠 수 있는 파일은 이 두 개뿐이다(경로를 밖에서 받지 않는다).
  · 저장 전에 반드시 검사한다. 오류가 있으면 저장하지 않는다.
  · 저장할 때마다 이전 판을 config/backup 에 남기고, 임시 파일에 쓴 뒤 바꿔치기한다(쓰는 중 전원이 꺼져도 원본 보존).
  · PIN·키 값은 화면에 '********' 로 가려 보내고, 그대로 돌아오면 기존 값을 유지한다.
  · 저장한 설정은 EMS 를 다시 기동해야 적용된다(운전 중인 값은 바꾸지 않는다).
"""
import csv, difflib, hashlib, io, json, math, os, re, tempfile, time
from .. import pointmap as pm
from .. import opsmode as om
from .. import archive, ring, weather, hybrid
from ..modbus import NREG, ORDERS

MASK = "********"; SECRET = re.compile(r"^(pin_|audit_key)"); KEEP = 20
COLS = ["tag", "device", "fc", "addr", "type", "scale", "unit", "lo", "hi", "rw", "order"]
BAK = re.compile(r"^(runtime|pointmap)\.\d{8}-\d{6}(-\d+)?\.bak$")
# 운전 설정 값 범위(없는 키는 검사하지 않는다)
RANGE = {"scan_s": (0.2, 60), "ctrl_s": (1, 3600), "timeout_s": (0.05, 10), "autonomy_target_h": (1, 720), "g1_kw": (0, 10000)}
AI_RANGE = {"retrain_h": (0.5, 720), "sim_retrain_h": (0.1, 720), "first_min": (0, 1440), "holdout_days": (1, 14), "min_gain": (0, 50), "keep": (2, 100), "max_days": (20, 720),
            "max_gap": (0, 1), "bias_slots": (3, 96), "bias_tau": (1, 96), "nmae_limit": (1, 100)}
SKY_RANGE = {"max_age_s": (10, 3600), "period_s": (2, 600)}
FUEL_RANGE = {"dg_tank_l": (10, 1e6), "warn_pct": (5, 95), "warn_h": (1, 240), "repeat_min": (1, 1440)}
G_RANGE = {"peak_kw": (0, 1e5), "import_min_kw": (0, 1e4), "reserve_soc": (0, 1), "charge_kw": (0, 1e5), "restore_s": (0, 3600), "gdg_kw": (0, 1e5), "gdg_min_load": (0, 1),
           "gdg_delay_s": (0, 3600), "gdg_stop_soc": (0, 1), "gdg_restart_soc": (0, 1), "gdg_tank_l": (0, 1e6), "gdg_l_per_kwh": (0.05, 1), "gdg_min_run_s": (0, 86400)}


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _mask(obj, old=None, restore=False):
    """가릴 때: 비밀 값을 MASK 로. 되돌릴 때(restore): MASK 로 온 값을 기존 값(old)으로."""
    if not isinstance(obj, dict): return obj
    out = {}
    for k, v in obj.items():
        o = old.get(k) if isinstance(old, dict) else None
        if isinstance(v, dict): out[k] = _mask(v, o, restore)
        elif SECRET.match(k) and not restore: out[k] = MASK
        elif SECRET.match(k) and v == MASK and o is not None: out[k] = o
        else: out[k] = v
    return out


def _keep_types(new, old):
    """브라우저를 거치면 60.0 이 60 으로 바뀐다. 값이 같으면 원래 표기(실수)를 유지해 변경 비교에 잡음이 생기지 않게 한다."""
    if isinstance(new, dict) and isinstance(old, dict): return {k: _keep_types(v, old.get(k)) for k, v in new.items()}
    if isinstance(new, list) and isinstance(old, list) and len(new) == len(old): return [_keep_types(a, b) for a, b in zip(new, old)]
    if isinstance(old, float) and isinstance(new, int) and not isinstance(new, bool) and new == old: return old
    return new


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _in(v, lo, hi):
    return _num(v) and lo <= v <= hi


def _check_path(n, p, u, bad, units):
    ok = isinstance(p, list) and len(p) == 2 and isinstance(p[0], str) and re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", p[0]) and isinstance(p[1], int) and 1 <= p[1] <= 65535
    if not ok: bad.append(f"devices.{n}.paths: [\"IP\", 포트] 형식 오류 {p}")
    elif any(int(x) > 255 for x in p[0].split(".")): bad.append(f"devices.{n}.paths: IP 범위 오류 {p[0]}")
    elif (p[0], p[1], u) in units: bad.append(f"devices.{n}: 주소·Unit ID 가 {units[(p[0], p[1], u)]} 과 같음 ({p[0]}:{p[1]} unit {u})")
    else: units[(p[0], p[1], u)] = n


def _check_device(n, d, bad, units):
    if not isinstance(d, dict): bad.append(f"devices.{n}: 객체여야 함"); return
    u = d.get("unit")
    if not (isinstance(u, int) and not isinstance(u, bool) and 0 <= u <= 247): bad.append(f"devices.{n}.unit: 0~247 정수")
    ps = d.get("paths")
    if not (isinstance(ps, list) and 1 <= len(ps) <= 2): bad.append(f"devices.{n}.paths: 경로 1~2개"); ps = []
    for p in ps: _check_path(n, p, u, bad, units)
    if "order" in d and str(d["order"]).upper() not in ORDERS: bad.append(f"devices.{n}.order: {'/'.join(ORDERS)} 중 하나")
    for k in ("done_s", "gap"):
        if k in d and not (_num(d[k]) and d[k] >= 0): bad.append(f"devices.{n}.{k}: 0 이상 숫자")


def _check_top(cfg, bad):
    """최상위 항목: 필수 키, 허용 목록, 대응표 파일 이름, 주기·한도 범위, 운용 모드, 현장 정격."""
    for k in ("pointmap", "devices", "allow"):
        if k not in cfg: bad.append(f"필수 항목 없음: {k}")
    al = cfg.get("allow", [])
    if not (isinstance(al, list) and all(isinstance(a, str) for a in al)): bad.append("allow: 주소 대역 문자열 목록")
    if "pointmap" in cfg and not (isinstance(cfg["pointmap"], str) and re.fullmatch(r"[\w.\-]+\.csv", cfg["pointmap"])): bad.append("pointmap: 같은 폴더의 .csv 파일 이름")
    for k, (lo, hi) in RANGE.items():
        if k in cfg and not _in(cfg[k], lo, hi): bad.append(f"{k}: {lo}~{hi} 범위의 숫자")
    if cfg.get("run_mode", "개발") not in ("개발", "운용"): bad.append("run_mode: '개발' 또는 '운용'")
    for k, v in (cfg.get("site") or {}).items():
        if not isinstance(v, (str, list, dict)) and (not _num(v) or v < 0): bad.append(f"site.{k}: 0 이상 숫자")


def _check_garrison(g, bad):
    if not isinstance(g, dict): bad.append("garrison: 객체여야 함"); return
    for k, (lo, hi) in G_RANGE.items():
        if k in g and not _in(g[k], lo, hi): bad.append(f"garrison.{k}: {lo}~{hi} 범위의 숫자")
    a, b = g.get("gdg_restart_soc"), g.get("gdg_stop_soc")
    if _num(a) and _num(b) and a >= b: bad.append("garrison: 재기동 충전율(gdg_restart_soc)은 정지 충전율(gdg_stop_soc)보다 낮아야 함")
    a, b = g.get("import_min_kw"), g.get("peak_kw")
    if _num(a) and _num(b) and a >= b > 0: bad.append("garrison: 최소 수전(import_min_kw)은 피크 목표(peak_kw)보다 작아야 함")
    if not bad:
        try: om.Garrison.from_cfg(g)
        except (TypeError, ValueError) as e: bad.append(f"garrison: {e}")


def _check_sections(cfg, bad):
    """연료 경보·하늘 카메라·지속 학습 설정의 범위 검사."""
    fu = cfg.get("fuel") or {}
    if not isinstance(fu, dict): bad.append("fuel: 객체여야 함"); fu = {}
    for k, (lo, hi) in FUEL_RANGE.items():
        if k in fu and not _in(fu[k], lo, hi): bad.append(f"fuel.{k}: {lo}~{hi} 범위의 숫자")
    sk = cfg.get("skycam") or {}
    if not isinstance(sk, dict): bad.append("skycam: 객체여야 함"); sk = {}
    for k, (lo, hi) in SKY_RANGE.items():
        if k in sk and not _in(sk[k], lo, hi): bad.append(f"skycam.{k}: {lo}~{hi} 범위의 숫자")
    if "path" in sk and not isinstance(sk["path"], str): bad.append("skycam.path: 문자열(사진 파일 경로, 비우면 state/skycam.png)")
    ai = cfg.get("ai") or {}
    if not isinstance(ai, dict): bad.append("ai: 객체여야 함"); ai = {}
    for k, (lo, hi) in AI_RANGE.items():
        if k in ai and not _in(ai[k], lo, hi): bad.append(f"ai.{k}: {lo}~{hi} 범위의 숫자")
    _check_archive(cfg.get("archive"), bad); ring.check(cfg.get("ring"), bad); weather.check(cfg.get("weather"), bad); hybrid.check(cfg.get("hybrid"), bad)


def _check_archive(ar, bad):
    """기록 보관소: 주기는 정해진 값 중 하나, 보관 기간은 1~5년, 전송 주소는 http(s)."""
    if ar is None: return
    if not isinstance(ar, dict): bad.append("archive: 객체여야 함"); return
    for k, allowed, txt in (("interval_min", archive.INTERVALS, "1·5·15·30·60 중 하나(분)"), ("dev_interval_min", archive.INTERVALS, "1·5·15·30·60 중 하나(분)"), ("ess_interval_s", archive.ESS_STEPS, "60·300·600·900 중 하나(초)")):
        if k in ar and ar[k] not in allowed: bad.append(f"archive.{k}: {txt}")
    rules = (("retain_years", lambda v: _in(v, 1, 5) and float(v).is_integer(), "1~5 의 정수(년)"), ("max_mb", lambda v: _in(v, 16, 8192), "16~8192 범위의 숫자(MB)"), ("enabled", lambda v: isinstance(v, bool), "true 또는 false"),
             ("dev_exclude", lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v), "신호 이름 목록"), ("outbox", lambda v: isinstance(v, str), "문자열(묶음을 둘 폴더, 비우면 state/outbox)"),
             ("server_url", lambda v: isinstance(v, str) and (not v or re.fullmatch(r"https?://[A-Za-z0-9.\-_]+(:\d{1,5})?(/[\w\-./]*)?", v) is not None), "비우거나 http(s)://주소[:포트][/경로]"))
    for k, ok, txt in rules:
        if k in ar and not ok(ar[k]): bad.append(f"archive.{k}: {txt}")


def check_runtime(cfg):
    """운전 설정 구조·범위 검사. 반환: (오류 목록, 주의 목록)"""
    bad, warn = [], []
    if not isinstance(cfg, dict): return ["최상위는 JSON 객체여야 함"], []
    _check_top(cfg, bad)
    devs = cfg.get("devices")
    if not isinstance(devs, dict) or not devs: bad.append("devices: 장치가 하나 이상 있어야 함"); devs = {}
    units = {}
    for n, d in devs.items(): _check_device(n, d, bad, units)
    if "MTR" not in devs: warn.append("MTR(계측 게이트웨이) 장치가 없음 — 부하 계측·부하 자동 차단 불가")
    _check_garrison(cfg.get("garrison") or {}, bad)
    _check_sections(cfg, bad)
    h = cfg.get("hmi") or {}
    if isinstance(h, dict) and str(h.get("bind", "127.0.0.1")) not in ("127.0.0.1", "localhost", "::1"): warn.append(f"제어화면이 {h.get('bind')} 에 열림 — 폐쇄망 내부 단말에서만 사용")
    return bad, warn


def rows_to_csv(rows):
    out = io.StringIO(); w = csv.writer(out, lineterminator="\n"); w.writerow(COLS)
    for r in rows: w.writerow(["" if c is None else str(c).strip() for c in (list(r) + [""] * len(COLS))[:len(COLS)]])
    return out.getvalue()


def _check_row(i, r, bad):
    """한 줄의 글자 형식(숫자 칸·이름 꼴·주소 범위). 내용 검사는 pointmap.validate 가 한다."""
    if not isinstance(r, list) or len(r) < 10: bad.append(f"{i}행: 열 수 부족"); return
    tag = str(r[0]).strip()
    if not re.fullmatch(r"[A-Za-z0-9_]+\.[A-Za-z0-9_]+", tag): bad.append(f"{i}행: 이름은 '장치.항목' 꼴의 영문·숫자 ({tag or '빈 칸'})")
    for j, lab, conv, need in ((2, "기능 코드가", int, True), (3, "주소가", int, True), (5, "배율이", float, True), (7, "하한이", float, False), (8, "상한이", float, False)):
        v = str(r[j]).strip()
        if not v and not need: continue
        try: conv(v)
        except ValueError: bad.append(f"{i}행 {tag}: {lab} 숫자가 아님 ({v})")
    a = str(r[3]).strip()
    if a.lstrip("-").isdigit() and not 0 <= int(a) <= 65535: bad.append(f"{i}행 {tag}: 주소 0~65535")


def _check_devices_covered(pts, devices, bad, warn):
    tags = {p["tag"] for p in pts}
    for n in devices:
        mine = [p for p in pts if p["device"] == n]
        if not mine: warn.append(f"장치 {n}: 대응표에 점이 없음")
        if f"{n}.cmd" in tags and not {f"{n}.seq", f"{n}.seq_ack", f"{n}.status"} <= tags: bad.append(f"장치 {n}: 지령(cmd)이 있으면 seq·seq_ack·status 도 있어야 함")
        if mine and f"{n}.hb" not in tags and n != "MTR": warn.append(f"장치 {n}: 생존 계수(hb) 없음 — 제어기 정지를 알 수 없음")
    for p in pts:
        if p["type"] in NREG and NREG[p["type"]] > 1 and not p["order_raw"]: warn.append(f"{p['tag']}: 32·64비트인데 바이트 순서 미지정(ABCD 로 처리)")


def check_pointmap(rows, devices):
    """대응표 검사. rows: 화면의 표(열 순서 COLS). 반환: (오류 목록, 주의 목록, CSV 본문)"""
    bad, warn = [], []
    if not isinstance(rows, list) or not rows: return ["행이 없음"], [], ""
    for i, r in enumerate(rows, 1): _check_row(i, r, bad)
    if bad: return bad, warn, ""
    text = rows_to_csv(rows)
    fd, tmp = tempfile.mkstemp(suffix=".csv")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f: f.write(text)
        pts = pm.load(tmp, devices)
    finally:
        os.unlink(tmp)
    bad += pm.validate(pts, devices)
    _check_devices_covered(pts, devices, bad, warn)
    return bad, warn, text


class ConfigEditor:
    def __init__(self, cfg_path, note=None, wall=time.localtime):
        self.cfg_path = os.path.abspath(cfg_path); self.dir = os.path.dirname(self.cfg_path); self.bdir = os.path.join(self.dir, "backup")
        self.note = note or (lambda *a, **k: None); self.wall = wall
        self.loaded = {k: _sha(self._text(k)) for k in ("runtime", "pointmap")}        # 기동 때의 판(재기동 필요 여부 판단)

    def _cfg(self):
        with open(self.cfg_path, encoding="utf-8") as f: return json.load(f)

    def _path(self, kind):
        if kind == "runtime": return self.cfg_path
        if kind == "pointmap": return os.path.join(self.dir, os.path.basename(self._cfg()["pointmap"]))
        raise ValueError(f"편집 대상 아님: {kind}")

    def _text(self, kind):
        with open(self._path(kind), encoding="utf-8-sig") as f: return f.read()

    def _rows(self):
        rd = list(csv.reader(io.StringIO(self._text("pointmap")))); head = [h.strip() for h in rd[0]]; ix = [head.index(c) if c in head else None for c in COLS]
        return [[(r[i].strip() if i is not None and i < len(r) else "") for i in ix] for r in rd[1:] if r and (r[0] or "").strip() and not r[0].lstrip().startswith("#")]

    def backups(self):
        if not os.path.isdir(self.bdir): return []
        fs = sorted((f for f in os.listdir(self.bdir) if BAK.match(f)), reverse=True)
        return [{"name": f, "kind": f.split(".")[0], "size": os.path.getsize(os.path.join(self.bdir, f)), "time": f.split(".")[1][:15]} for f in fs]

    def read(self):
        cfg = self._cfg(); cur = {k: _sha(self._text(k)) for k in ("runtime", "pointmap")}
        return {"ok": True, "runtime": {"text": json.dumps(_mask(cfg), ensure_ascii=False, indent=1), "sha": cur["runtime"], "file": os.path.basename(self.cfg_path)},
                "pointmap": {"cols": COLS, "rows": self._rows(), "sha": cur["pointmap"], "file": os.path.basename(self._path("pointmap"))},
                "choices": {"type": list(NREG), "order": [""] + list(ORDERS), "unit": sorted(pm.UNITS), "rw": ["r", "w"], "fc": ["3", "4"], "device": list(cfg["devices"])},
                "pending": [k for k in cur if cur[k] != self.loaded[k]], "backups": self.backups(), "mask": MASK}

    def _prepare(self, kind, body):
        """검사하고 저장할 본문을 만든다. 반환: (오류, 주의, 새 본문, 옛 본문)"""
        old = self._text(kind)
        if kind == "runtime":
            try: new = json.loads(str(body.get("text", "")))
            except ValueError as e: return [f"JSON 문법 오류: {e}"], [], "", old
            cur = self._cfg(); new = _keep_types(_mask(new, cur, restore=True), cur) if isinstance(new, dict) else new
            bad, warn = check_runtime(new)
            if not bad:
                if os.path.basename(new["pointmap"]) != os.path.basename(cur["pointmap"]): bad.append("pointmap 파일 이름은 이 화면에서 바꿀 수 없음")
                else: bad += [f"대응표와 맞지 않음 — {e}" for e in pm.validate(pm.load(self._path("pointmap"), new["devices"]), new["devices"])]
            return bad, warn, (json.dumps(new, ensure_ascii=False, indent=1) + "\n") if not bad else "", old
        bad, warn, text = check_pointmap(body.get("rows"), self._cfg()["devices"])
        return bad, warn, text, old

    def check(self, kind, body):
        bad, warn, new, old = self._prepare(kind, body)
        if kind == "runtime" and new: old = json.dumps(self._cfg(), ensure_ascii=False, indent=1) + "\n"      # 서식 차이는 비교에서 뺀다
        if kind == "pointmap": old = rows_to_csv(self._rows())
        diff = [ln for ln in difflib.unified_diff(old.splitlines(), new.splitlines(), "저장된 판", "편집본", lineterm="", n=1)][2:] if new else []
        diff = [re.sub(r'("(?:pin_|audit_key)\w*": )"[^"]*"', r'\1"' + MASK + '"', ln) for ln in diff]
        return {"ok": not bad, "errors": bad, "warnings": warn, "diff": diff[:400], "changed": sum(1 for d in diff if d[:1] in "+-")}

    def _write(self, kind, text):
        os.makedirs(self.bdir, exist_ok=True); path = self._path(kind); stamp = time.strftime("%Y%m%d-%H%M%S", self.wall()); n = 0
        while True:
            bak = os.path.join(self.bdir, f"{kind}.{stamp}{'-' + str(n) if n else ''}.bak")
            if not os.path.exists(bak): break
            n += 1
        with open(path, "rb") as f, open(bak, "wb") as g: g.write(f.read())
        fd, tmp = tempfile.mkstemp(dir=self.dir, prefix=".cfg-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f: f.write(text); f.flush(); os.fsync(f.fileno())
            os.replace(tmp, path)
        except OSError:
            if os.path.exists(tmp): os.unlink(tmp)
            raise
        old = [b["name"] for b in self.backups() if b["kind"] == kind][KEEP:]
        for b in old: os.unlink(os.path.join(self.bdir, b))
        return os.path.basename(bak)

    def save(self, kind, body, who):
        if body.get("sha") and body["sha"] != _sha(self._text(kind)): return {"ok": False, "errors": ["불러온 뒤에 파일이 바뀌었음 — 다시 불러온 뒤 편집하십시오"], "warnings": []}
        r = self.check(kind, body)
        if not r["ok"]: return r
        if not r["changed"]: return dict(r, ok=False, errors=["바뀐 내용이 없음"])
        _, _, new, _ = self._prepare(kind, body); bak = self._write(kind, new)
        self.note("설정", f"설정 편집 저장: {os.path.basename(self._path(kind))} ({r['changed']}줄 변경, 이전 판 {bak}) — 재기동 후 적용", actor=who)
        return dict(r, saved=True, backup=bak, restart=True)

    def restore(self, name, who):
        if not BAK.match(str(name)) or not os.path.isfile(os.path.join(self.bdir, name)): raise ValueError("백업 없음")
        kind = name.split(".")[0]
        with open(os.path.join(self.bdir, name), encoding="utf-8-sig") as f: text = f.read()
        if kind == "runtime":
            try: bad, _ = check_runtime(json.loads(text))
            except ValueError as e: bad = [f"JSON 문법 오류: {e}"]
        else:
            rows = [r for r in list(csv.reader(io.StringIO(text)))[1:] if r and r[0].strip() and not r[0].lstrip().startswith("#")]
            bad = check_pointmap([(r + [""] * 11)[:11] for r in rows], self._cfg()["devices"])[0]
        if bad: return {"ok": False, "errors": ["이 백업은 현재 설정과 맞지 않아 되돌릴 수 없음"] + bad[:10], "warnings": []}
        bak = self._write(kind, text)
        self.note("설정", f"설정 되돌리기: {name} → {os.path.basename(self._path(kind))} (되돌리기 전 판 {bak}) — 재기동 후 적용", actor=who)
        return {"ok": True, "saved": True, "backup": bak, "restart": True}
