# -*- coding: utf-8 -*-
"""시나리오용 추가 설비: 대응표에 아직 없는 급전선·차단기, 변압기, 보호 계전기를 파일 하나(scenario_extra.json)로 정의해 가상 장치에서 동작시킨다.

실제 대응표(pointmap.csv)와 운전 설정은 건드리지 않는다 — 운영 시나리오 검증기 안에서만 쓰는 모의 설비다. 실제로 연결할 때는 같은 신호 이름으로 대응표에 등록한다.
  급전선(feeders)   CB.<id> 차단기, FLT.<id> 고장 코드, <id>.kw 전력. 모선 A·B 에 붙는 부하 또는 전원.
  변압기(transformers) <id>.load_pct 부하율 = 그 급전선의 전력 ÷ (정격 kVA × 역률).
  보호 계전기(relays)  감시 전력(닫힌 급전선들의 합)이 정정값을 정한 시간 동안 넘으면 차단기를 트립(2)시키고 고장 코드를 남긴다(정한시 과전류).
보호 협조: 하위 차단기가 먼저 열리면 그 부하가 상위 감시 전력에서 빠진다 → 정정 시간이 맞으면 상위는 동작하지 않는다(선택 차단).
정정값은 시험용 가정값이다. 실제 값은 보호 협조 검토서로 정한다.
"""
import json, os, re

FILE = "scenario_extra.json"
MAX = {"feeders": 12, "transformers": 4, "relays": 16}
ID = re.compile(r"^[A-Z][A-Z0-9]{1,7}$")
# 기본 구성의 급전선: 이름 → 전력 신호(차단기는 CB.<이름>, 없으면 차단기 없음)
BUILTIN = {"GRID": "GRID.kw", "PV": "PV.kw", "DG": "DG.kw", "FC": "FC.kw", "GDG": "GDG.kw", "ESS": "ESS.kw", "L1": "LOAD.p1_kw", "L2": "LOAD.p2_kw", "L3": "LOAD.p3_kw", "ELZ": "ELZ.kw"}
ADDR0 = 400                                    # 모의 신호에 붙이는 주소의 시작(계측·배전 게이트웨이 쪽, 실제 대응표와 겹치지 않게)


def path_for(profile):
    return os.path.join(os.path.dirname(os.path.abspath(str(profile))), FILE)


def load(profile):
    """설정 폴더의 추가 설비 정의를 읽는다. 없거나 잘못됐으면 빈 구성(기본 설비만)."""
    try:
        with open(path_for(profile), encoding="utf-8") as f: extra = json.load(f)
        return extra if not check(extra, None) else empty()
    except (OSError, ValueError):
        return empty()


def empty():
    return {"feeders": [], "transformers": [], "relays": []}


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


def _check_transformers(items, feeders, taken, bad):
    for t in items:
        where = f"변압기 {t.get('id', '?') if isinstance(t, dict) else '?'}"
        if not isinstance(t, dict) or not isinstance(t.get("id"), str) or not ID.match(t["id"]) or t["id"] in feeders or t["id"] in taken: bad.append(f"{where}: 이름 형식 오류 또는 중복"); continue
        if t.get("on") not in feeders: bad.append(f"{where}.on: 있는 급전선 이름")
        _num(t, "kva", 10, 5000, bad, where); _num(t, "pf", 0.5, 1.0, bad, where)


def _check_relays(items, feeders, breakers, bad):
    for r in items:
        where = f"계전기 {r.get('id', '?') if isinstance(r, dict) else '?'}"
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not 1 <= len(r["id"]) <= 12: bad.append(f"{where}: 이름 1~12자"); continue
        if r.get("cb") not in breakers: bad.append(f"{where}.cb: 있는 차단기 이름")
        if not isinstance(r.get("sum"), list) or not r["sum"] or any(x not in feeders for x in r["sum"]): bad.append(f"{where}.sum: 감시할 급전선 이름 목록(1개 이상)")
        _num(r, "pickup_kw", 1, 5000, bad, where); _num(r, "delay_ms", 0, 10000, bad, where); _num(r, "code", 1, 99, bad, where)


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
    return out


def merge(pts, extra):
    """실제 대응표의 신호 목록에 모의 신호를 덧붙인다(이미 있는 이름은 건너뛴다 — 여러 번 불러도 같다)."""
    have = {p["tag"] for p in pts}
    return list(pts) + [p for p in points(extra) if p["tag"] not in have and "MTR" in {q["device"] for q in pts}]


def save(profile, extra, pts):
    """검사한 뒤 저장한다(임시 파일 후 교체, 직전 파일은 .bak). 반환: 오류 목록"""
    bad = check(extra, pts)
    if bad: return bad
    clean = {k: extra.get(k, []) for k in MAX}; pth = path_for(profile); tmp = pth + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(clean, f, ensure_ascii=False, indent=1)
    if os.path.exists(pth): os.replace(pth, pth + ".bak")
    os.replace(tmp, pth)
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
    """가상 장치 위에서 추가 설비를 움직인다: 처음 값 넣기, 변압기 부하율 계산, 보호 계전기 동작."""

    def __init__(self, extra, plant):
        self.x = extra or empty(); self.p = plant; self.t0 = {}
        self.kw = dict(BUILTIN); self.kw.update({f["id"]: f"{f['id']}.kw" for f in self.x["feeders"]})
        for f in self.x["feeders"]:
            if f"CB.{f['id']}" in plant.by_tag: plant.set(f"CB.{f['id']}", 1); plant.set(f"{f['id']}.kw", f["kw"])

    def _has(self, tag): return tag in self.p.by_tag

    def flow(self, name):
        """그 급전선에 흐르는 전력(kW, 크기). 차단기가 열려 있으면 0."""
        tag = self.kw.get(name)
        if not tag or not self._has(tag): return 0.0
        if self._has(f"CB.{name}") and int(round(self.p.get(f"CB.{name}"))) != 1: return 0.0
        return abs(self.p.get(tag))

    def tick(self, now):
        for t in self.x["transformers"]:
            if self._has(f"{t['id']}.load_pct"): self.p.set(f"{t['id']}.load_pct", min(1000.0, 100.0 * self.flow(t["on"]) / (t["kva"] * t["pf"])))
        for r in self.x["relays"]:
            cb = f"CB.{r['cb']}"
            if not self._has(cb) or int(round(self.p.get(cb))) != 1 or sum(self.flow(n) for n in r["sum"]) <= r["pickup_kw"]:
                self.t0.pop(r["id"], None); continue                    # 정정값 아래로 내려가면 시간 재기를 처음부터
            if now - self.t0.setdefault(r["id"], now) >= r["delay_ms"] / 1000.0:
                self.p.set(cb, 2); self.t0.pop(r["id"], None)
                if self._has(f"FLT.{r['cb']}"): self.p.set(f"FLT.{r['cb']}", r["code"])
