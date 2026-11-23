# -*- coding: utf-8 -*-
"""시나리오용 추가 설비: 대응표에 아직 없는 급전선·차단기, 변압기, 보호 계전기를 파일 하나(scenario_extra.json)로 정의해 가상 장치에서 동작시킨다.

실제 대응표(pointmap.csv)와 운전 설정은 건드리지 않는다 — 운영 시나리오 검증기 안에서만 쓰는 모의 설비다. 실제로 연결할 때는 같은 신호 이름으로 대응표에 등록한다.
  급전선(feeders)   CB.<id> 차단기, FLT.<id> 고장 코드, <id>.kw 전력. 모선 A·B 에 붙는 부하 또는 전원.
  변압기(transformers) <id>.load_pct 부하율 = 그 급전선의 전력 ÷ (정격 kVA × 역률).
  보호 계전기(relays)  조건이 정한 시간 동안 이어지면 차단기를 트립(2)시키고 고장 코드를 남긴다. 요소(kind) 세 가지:
      oc 과전류   감시 전력(닫힌 급전선들의 합, kW) > 정정값
      gf 지락     그 급전선의 지락 전류 GF.<급전선>(A, 시험에서 넣는 값) > 정정값
      uv 부족전압 모선 전압 BUS.a_v·b_v(V) < 정정값. 한 번 정상 전압을 본 뒤에만 동작한다(기동 전 무전압에서 트립하지 않게)
    시간 특성(curve): dt 정한시(delay_ms) / si·vi·ei 반한시(IEC 60255 표준·강·초 반한시, 배율 tms) — 넘는 정도가 클수록 빨리 동작한다.
    차단 실패 후비(backup·bf_ms): 트립을 냈는데 차단기가 열리지 않으면(STK.<차단기> = 1 로 모사) bf_ms 뒤 후비 차단기를 트립시킨다(고장 코드 50).
보호 협조: 하위 차단기가 먼저 열리면 그 부하가 상위 감시 전력에서 빠진다 → 정정 시간이 맞으면 상위는 동작하지 않는다(선택 차단).
수급 반영(급전선의 ems): 켜 두면 그 급전선의 전력을 EMS 가 보는 부하 합계(LOAD.kw)에 더하거나(부하) 뺀다(전원) → 발전기 기동 같은 급전 판단이 달라진다.
정정값은 시험용 가정값이다. 실제 값은 보호 협조 검토서로 정한다.
"""
import json, os, re, shutil
from .. import fsio

from . import scenring, scenunit

FILE = "scenario_extra.json"
MAX = {"feeders": 12, "transformers": 4, "relays": 16}
ID = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")
# 기본 구성의 급전선: 이름 → 전력 신호(차단기는 CB.<이름>, 없으면 차단기 없음)
BUILTIN = {"GRID": "GRID.kw", "PV": "PV.kw", "DG": "DG.kw", "FC": "FC.kw", "GDG": "GDG.kw", "ESS": "ESS.kw", "L1": "LOAD.p1_kw", "L2": "LOAD.p2_kw", "L3": "LOAD.p3_kw", "ELZ": "ELZ.kw"}
CURVES = {"si": (0.14, 0.02), "vi": (13.5, 1.0), "ei": (80.0, 2.0)}          # IEC 60255 반한시: t = tms × k ÷ (M^α − 1), M = 측정값 ÷ 정정값
PHOTO = re.compile(r"^[a-z0-9_]{1,16}$")
BF_CODE = 50                                   # 차단 실패 후비 동작의 고장 코드
ADDR0 = 400                                    # 모의 신호에 붙이는 주소의 시작(계측·배전 게이트웨이 쪽, 실제 대응표와 겹치지 않게)


def path_for(profile):
    return os.path.join(os.path.dirname(os.path.abspath(str(profile))), FILE)


def load(profile):
    """설정 폴더의 추가 설비 정의를 읽는다. 없거나 잘못됐으면 빈 구성(기본 설비만)."""
    try:
        with open(path_for(profile), encoding="utf-8") as f: extra = json.load(f)
        extra = extra if not check(extra, None) else empty()
    except (OSError, ValueError):
        extra = empty()
    extra["ring"] = scenring.config(profile)                      # 환망 정의는 운전 설정(runtime.json 의 ring)에서 온다
    return extra


def empty():
    return {"feeders": [], "transformers": [], "relays": [], "ring": None}


def _num(item, key, lo, hi, bad, where):
    v = item.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi: bad.append(f"{where}.{key}: {lo}~{hi} 범위의 숫자")


def _check_feeder(f, seen, taken, bad):
    where = f"급전선 {f.get('id', '?')}"
    if not isinstance(f.get("id"), str) or not ID.match(f["id"]): bad.append(f"{where}: 이름은 영문 대문자로 시작하는 2~8자(대문자·숫자)"); return
    if f["id"] in seen or f["id"] in BUILTIN or f["id"] in taken: bad.append(f"{where}: 이미 있는 이름")
    seen.add(f["id"])
    if f.get("kind") not in ("load", "src"): bad.append(f"{where}.kind: load(부하) 또는 src(전원)")
    if f.get("bus") not in ("A", "B"): bad.append(f"{where}.bus: A 또는 B")
    if not isinstance(f.get("name"), str) or not 1 <= len(f["name"]) <= 24: bad.append(f"{where}.name: 1~24자")
    _num(f, "kw", 0, 2000, bad, where)
    if f.get("photo") not in (None, "") and not (isinstance(f["photo"], str) and PHOTO.match(f["photo"])): bad.append(f"{where}.photo: 사진 이름(영문 소문자·숫자)")
    if not isinstance(f.get("ems", False), bool): bad.append(f"{where}.ems: 참 또는 거짓")


def _check_transformers(items, feeders, taken, bad):
    for t in items:
        where = f"변압기 {t.get('id', '?') if isinstance(t, dict) else '?'}"
        if not isinstance(t, dict) or not isinstance(t.get("id"), str) or not ID.match(t["id"]) or t["id"] in feeders or t["id"] in taken: bad.append(f"{where}: 이름 형식 오류 또는 중복"); continue
        if t.get("on") not in feeders: bad.append(f"{where}.on: 있는 급전선 이름")
        _num(t, "kva", 10, 5000, bad, where); _num(t, "pf", 0.5, 1.0, bad, where)


def relay_view(r):
    """계전기 정의를 채워서 돌려준다(이전 판의 pickup_kw 만 있는 정의도 읽는다)."""
    kind = r.get("kind", "oc")
    return {"id": r.get("id"), "name": r.get("name", ""), "kind": kind, "cb": r.get("cb"), "sum": r.get("sum") or [], "on": r.get("on"), "bus": r.get("bus"),
            "pickup": r.get("pickup", r.get("pickup_kw")), "curve": r.get("curve", "dt"), "delay_ms": r.get("delay_ms", 0), "tms": r.get("tms", 0.1),
            "code": r.get("code", {"oc": 51, "gf": 64, "uv": 27}.get(kind, 51)), "backup": r.get("backup") or "", "bf_ms": r.get("bf_ms", 300)}


def _check_relay_target(v, feeders, bad, where):
    if v["kind"] == "oc" and (not isinstance(v["sum"], list) or not v["sum"] or any(x not in feeders for x in v["sum"])): bad.append(f"{where}.sum: 감시할 급전선 이름 목록(1개 이상)")
    if v["kind"] == "gf" and v["on"] not in feeders: bad.append(f"{where}.on: 지락을 볼 급전선 이름")
    if v["kind"] == "uv" and v["bus"] not in ("A", "B"): bad.append(f"{where}.bus: A 또는 B")


def _check_relays(items, feeders, breakers, bad):
    for r in items:
        where = f"계전기 {r.get('id', '?') if isinstance(r, dict) else '?'}"
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not 1 <= len(r["id"]) <= 12: bad.append(f"{where}: 이름 1~12자"); continue
        v = relay_view(r)
        if v["kind"] not in ("oc", "gf", "uv"): bad.append(f"{where}.kind: oc(과전류)·gf(지락)·uv(부족전압)"); continue
        if v["cb"] not in breakers: bad.append(f"{where}.cb: 있는 차단기 이름")
        _check_relay_target(v, feeders, bad, where)
        if v["curve"] not in ("dt",) + tuple(CURVES) or (v["kind"] == "uv" and v["curve"] != "dt"): bad.append(f"{where}.curve: dt·si·vi·ei (부족전압은 dt)")
        if v["backup"] and (v["backup"] not in breakers or v["backup"] == v["cb"]): bad.append(f"{where}.backup: 다른 차단기 이름(없으면 비움)")
        _num(v, "pickup", 1, 5000, bad, where); _num(v, "delay_ms", 0, 10000, bad, where); _num(v, "tms", 0.01, 3.0, bad, where); _num(v, "code", 1, 99, bad, where); _num(v, "bf_ms", 50, 5000, bad, where)


def check(extra, pts):
    """구조·범위 검사. 반환: 오류 목록(없으면 빈 목록). pts 를 주면 실제 대응표의 신호 이름과 겹치는지도 본다."""
    bad = []
    if not isinstance(extra, dict): return ["추가 설비 정의는 객체여야 함"]
    for key, limit in MAX.items():
        if not isinstance(extra.get(key, []), list) or len(extra.get(key, [])) > limit: bad.append(f"{key}: 목록, 최대 {limit}개")
    if bad: return bad
    taken = {p["tag"].split(".")[1] for p in (pts or []) if p["tag"].startswith("CB.")} | {p["tag"].split(".")[0] for p in (pts or [])}
    seen = set()
    for f in extra.get("feeders", []):
        if isinstance(f, dict): _check_feeder(f, seen, taken, bad)
        else: bad.append("급전선: 객체여야 함")
    feeders = set(BUILTIN) | seen
    _check_transformers(extra.get("transformers", []), feeders, taken, bad)
    _check_relays(extra.get("relays", []), feeders, (feeders - {"ELZ"}) | {"TIE", "G1"}, bad)
    return bad


def points(extra):
    """추가 설비의 모의 신호(대응표 한 줄과 같은 모양). 계측·배전 게이트웨이(MTR)의 빈 주소에 차례로 놓는다."""
    out = []; addr = ADDR0
    def add(tag, typ, scale, unit, lo, hi):
        nonlocal addr
        out.append({"tag": tag, "device": "MTR", "fc": 4, "addr": addr, "type": typ, "scale": scale, "unit": unit, "lo": lo, "hi": hi, "rw": "r", "order_raw": "", "order": "ABCD", "virtual": True}); addr += 1
    for f in extra.get("feeders", []):
        add(f"CB.{f['id']}", "u16", 1.0, "", 0.0, 2.0); add(f"FLT.{f['id']}", "u16", 1.0, "", None, None); add(f"{f['id']}.kw", "i16", 0.1, "kW", -3000.0, 3000.0)
    for t in extra.get("transformers", []):
        add(f"{t['id']}.load_pct", "u16", 0.1, "%", 0.0, 1000.0)
    seen = set()
    for r in map(relay_view, extra.get("relays", [])):            # 지락 전류(시험 입력)와 차단 실패 모사 신호는 그것을 쓰는 계전기가 있을 때만 만든다
        for tag, typ, scale, unit, hi in ((f"GF.{r['on']}", "u16", 0.1, "A", 3000.0),) * (r["kind"] == "gf") + ((f"STK.{r['cb']}", "u16", 1.0, "", 1.0),) * bool(r["backup"]):
            if tag not in seen: seen.add(tag); add(tag, typ, scale, unit, 0.0, hi)
    scenring.points(extra.get("ring"), add)                       # 환망(고리 모양 배전)의 구간·마디 신호
    return out


def merge(pts, extra):
    """실제 대응표의 신호 목록에 모의 신호를 덧붙인다(이미 있는 이름은 건너뛴다 — 여러 번 불러도 같다)."""
    have = {p["tag"] for p in pts}
    add = [p for p in points(extra) if p["tag"] not in have and "MTR" in {q["device"] for q in pts}]
    more = scenunit.points(pts, max([p["addr"] for p in add], default=ADDR0) + 1) if "MTR" in {q["device"] for q in pts} else []      # 장치 놓기 · 빼기 신호(대수 변화 시나리오)
    return list(pts) + add + [p for p in more if p["tag"] not in have]


def save(profile, extra, pts):
    """검사한 뒤 저장한다(임시 파일 후 교체, 직전 파일은 .bak). 반환: 오류 목록"""
    bad = check(extra, pts)
    if bad: return bad
    clean = {k: extra.get(k, []) for k in MAX}; pth = path_for(profile)
    if os.path.exists(pth): shutil.copyfile(pth, pth + ".bak")
    fsio.write_json(pth, clean, indent=1)
    return []


def catalog(pts, devices, profile, presets_path):
    """화면에 주는 목록: 모의 신호를 합친 장비·신호 목록, 추가 설비 정의, 지금 구성에서 돌릴 수 있는 기본 시나리오."""
    from . import scenarios
    extra = load(profile); merged = merge(pts, extra); data = scenarios.catalog(merged, devices); data["extra"] = extra
    with open(presets_path, encoding="utf-8") as source: data["presets"] = scenarios.compatible_presets(json.load(source), merged, data["commands"])
    return data


def store(eng, extra, who):
    """화면에서 보낸 추가 설비 정의를 저장한다(실제 대응표는 바꾸지 않는다). 반환: 응답 사전"""
    bad = save(eng.cfg_path, extra, eng.rt.pts)
    if bad: return {"ok": False, "why": " / ".join(bad[:4])}
    eng.rt.note("시나리오", "시나리오용 추가 설비 구성 저장", actor=who)
    return {"ok": True}


class Model:
    """가상 장치 위에서 추가 설비를 움직인다: 처음 값 넣기, 변압기 부하율, 보호 계전기(과전류·지락·부족전압, 정한시·반한시, 차단 실패 후비), 수급 반영."""

    def __init__(self, extra, plant):
        self.x = dict(empty(), **(extra or {})); self.p = plant; self.acc = {}; self.armed = set(); self.bf = {}; self.t_last = None; self.wrote = None; self.base = None
        self.relays = [relay_view(r) for r in self.x["relays"]]
        self.kw = dict(BUILTIN); self.kw.update({f["id"]: f"{f['id']}.kw" for f in self.x["feeders"]})
        for f in self.x["feeders"]:
            if f"CB.{f['id']}" in plant.by_tag: plant.set(f"CB.{f['id']}", 1); plant.set(f"{f['id']}.kw", f["kw"])
        self.ring = scenring.Ring(self.x.get("ring"), plant); scenunit.start(plant)

    def _has(self, tag): return tag in self.p.by_tag
    def _is(self, tag, value): return self._has(tag) and int(round(self.p.get(tag))) == value

    def flow(self, name):
        """그 급전선에 흐르는 전력(kW, 크기). 차단기가 열려 있으면 0."""
        tag = self.kw.get(name)
        if not tag or not self._has(tag): return 0.0
        if self._has(f"CB.{name}") and not self._is(f"CB.{name}", 1): return 0.0
        return abs(self.p.get(tag))

    def _ratio(self, r):
        """정정값 대비 배수 M(1 을 넘으면 동작 조건). 부족전압은 정정값 ÷ 전압."""
        if r["kind"] == "oc": return sum(self.flow(n) for n in r["sum"]) / r["pickup"]
        if r["kind"] == "gf": return (self.p.get(f"GF.{r['on']}") if self._has(f"GF.{r['on']}") else 0.0) / r["pickup"]
        tag = f"BUS.{r['bus'].lower()}_v"
        if not self._has(tag): return 0.0
        v = self.p.get(tag)
        if v >= r["pickup"]: self.armed.add(r["id"])                       # 정상 전압을 한 번 본 뒤에만 부족전압을 판정한다
        return (r["pickup"] / max(v, 1e-6)) if r["id"] in self.armed and v < r["pickup"] else 0.0

    @staticmethod
    def _time(r, m):
        """그 배수에서의 동작 시간(초)."""
        if r["curve"] == "dt": return r["delay_ms"] / 1000.0
        k, a = CURVES[r["curve"]]
        return r["tms"] * k / max(m ** a - 1.0, 1e-9)

    def _trip(self, r, now):
        cb = r["cb"]
        if self._has(f"FLT.{cb}"): self.p.set(f"FLT.{cb}", r["code"])
        if self._is(f"STK.{cb}", 1):                                     # 차단 실패: 차단기가 열리지 않는다 → 후비 시간을 잰다
            if r["backup"]: self.bf.setdefault(r["id"], now)
            return
        self.p.set(f"CB.{cb}", 2)

    def _relay(self, r, now, dt):
        cb = f"CB.{r['cb']}"
        if not self._is(cb, 1): self.acc.pop(r["id"], None); self.bf.pop(r["id"], None); return
        m = self._ratio(r)
        if m <= 1.0: self.acc.pop(r["id"], None); self.bf.pop(r["id"], None); return        # 조건이 풀리면 처음부터 다시 잰다
        if r["id"] in self.bf:
            if now - self.bf[r["id"]] >= r["bf_ms"] / 1000.0 and self._is(f"CB.{r['backup']}", 1):
                self.p.set(f"CB.{r['backup']}", 2)
                if self._has(f"FLT.{r['backup']}"): self.p.set(f"FLT.{r['backup']}", BF_CODE)
            return
        t = self._time(r, m); self.acc[r["id"]] = self.acc.get(r["id"], 0.0) + (dt / t if t > 0 else 1.0)      # 반한시는 동작 시간의 역수를 쌓는다
        if self.acc[r["id"]] >= 1.0 - 1e-9 or t <= 0: self.acc.pop(r["id"], None); self._trip(r, now)

    def _balance(self):
        """수급 반영: ems 를 켠 급전선의 전력을 EMS 가 보는 부하 합계(LOAD.kw)에 반영한다. 시험이 LOAD.kw 를 새로 넣으면 그 값을 새 기준으로 삼는다."""
        if not self._has("LOAD.kw"): return
        adj = sum((1 if f["kind"] == "load" else -1) * self.flow(f["id"]) for f in self.x["feeders"] if f.get("ems"))
        cur = self.p.get("LOAD.kw")
        if self.wrote is None or abs(cur - self.wrote) > 0.06: self.base = cur
        if not adj and self.wrote is None: return
        self.p.set("LOAD.kw", max(0.0, self.base + adj)); self.wrote = self.p.get("LOAD.kw")

    def tick(self, now):
        dt = 0.0 if self.t_last is None else max(0.0, now - self.t_last); self.t_last = now
        for t in self.x["transformers"]:
            if self._has(f"{t['id']}.load_pct"): self.p.set(f"{t['id']}.load_pct", min(1000.0, 100.0 * self.flow(t["on"]) / (t["kva"] * t["pf"])))
        for r in self.relays: self._relay(r, now, dt)
        scenunit.tick(self.p); self.ring.tick(now); self._balance()
