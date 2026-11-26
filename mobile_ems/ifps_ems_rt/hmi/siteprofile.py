"""구성 저장 · 불러오기(사용자 요구, Rev66): 장비를 더 놓고 모선 · 부하 · 배치 · 상시 개방점을 바꾼 '최종 환경'을 이름 붙여 저장해 두고 다시 불러온다.

저장하는 것(화면에서 바꿀 수 있는 구성 다섯 가지):
  units  차량 대수(복합전력 · 이동형 ESS · 태양광 · 수소) — 자동 인식한 대수
  bus    모선 구성(전원 한 대마다의 모선)
  loads  부하 목록(종류 · 수량 · 등급 · 물린 구간분전함)
  layout 개요 배치도(그림 자리 · 크기 · 글상자 자리)
  open   환망의 상시 개방점

불러오기는 다섯 가지를 한꺼번에 그 구성으로 돌린다(엔지니어 — 모선 구성이 전기 구성이므로).
대수: 가상 장치는 그 대수로 놓고 뺀다. 실장비는 장치가 응답해야 대수가 바뀌므로 EMS 가 맞추지 못한다 — 저장된 대수와 다르면 알려 주기만 한다(자동 인식 원칙).
상시 개방점은 환망 화면에서 바꿀 때와 같은 길(runtime.json 의 ring.open)로 적는다. 그 밖의 운전 설정은 건드리지 않는다. 파일: state/profiles.json(최대 MAX 개).
"""
import json
import os

from .. import busplan, fsio, loads
from .engdefs import wall_iso
from . import unitctl

MAX = 20
KINDS = ("DG", "ESS", "PV", "FC")


class Profiles:
    def __init__(self, eng):
        self.eng = eng; self.path = os.path.join(eng.rt.state_dir, "profiles.json"); self.book = {}
        try:
            with open(self.path, encoding="utf-8") as f: o = json.load(f)
            if isinstance(o, dict): self.book = {str(k): v for k, v in o.items() if isinstance(v, dict)}
        except (OSError, ValueError): pass

    # ── 지금 구성
    def count(self, k):
        """그 종류의 지금 대수: 가상 장치는 놓인 것(인식을 기다리는 것 포함), 실장비는 인식한 것."""
        eng = self.eng; names = eng.rt.fleet.slots.get(k) or []; drop = eng.__dict__.get("unit_drop", {})
        if eng.sim: return sum(1 for n in names if n not in eng.plant.gone)
        return sum(1 for n in names if n in eng.rt.seen and n not in drop)

    def collect(self):
        eng = self.eng
        return {"units": {k: self.count(k) for k in KINDS if eng.rt.fleet.slots.get(k)}, "bus": dict(eng.busw.assign), "loads": [dict(i) for i in eng.loadw.items],
                "layout": eng.layout().get("items"), "open": eng.ringw.r.get("open") if eng.ringw.r is not None else None}

    @staticmethod
    def brief(p):
        u = p.get("units") or {}; n = sum(int(i.get("n", 1)) for i in p.get("loads") or [])
        return " · ".join([" ".join(f"{k}×{v}" for k, v in u.items()), f"부하 {n}개", "모선 B: " + (", ".join(sorted(k for k, v in (p.get("bus") or {}).items() if v == "B" and not k.startswith("L"))) or "없음")] + ([f"상시 개방점 구간 {p['open']}"] if p.get("open") is not None else []))

    def view(self):
        now = self.collect()
        return {"ok": True, "sim": bool(self.eng.sim), "max": MAX, "now": self.brief(now),
                "items": [{"name": k, "t": v.get("t", ""), "by": v.get("by", ""), "brief": self.brief(v), "same": self._same(v, now)} for k, v in sorted(self.book.items(), key=lambda q: q[1].get("t", ""), reverse=True)]}

    @staticmethod
    def _same(a, b):
        return all(json.dumps(a.get(k), sort_keys=True) == json.dumps(b.get(k), sort_keys=True) for k in ("units", "bus", "loads", "layout", "open"))

    def _write(self):
        fsio.write_json(self.path, self.book, indent=1)

    # ── 저장 · 지우기
    def save(self, name, who):
        name = " ".join(str(name or "").split())[:30]
        if not name: return {"ok": False, "why": "이름을 적으십시오"}
        if name not in self.book and len(self.book) >= MAX: return {"ok": False, "why": f"저장은 {MAX}개까지입니다 — 안 쓰는 것을 지우십시오"}
        over = name in self.book; self.book[name] = dict(self.collect(), t=wall_iso(), by=who)
        try: self._write()
        except OSError as e: return {"ok": False, "why": f"저장 실패: {e}"}
        self.eng.rt.note("구성", f"구성 저장: {name}" + (" (덮어씀)" if over else ""), actor=who)
        return dict(self.view(), msg=f"'{name}' 저장" + (" (덮어씀)" if over else ""))

    def delete(self, name, who):
        if name not in self.book: return {"ok": False, "why": "그런 이름이 없습니다"}
        del self.book[name]
        try: self._write()
        except OSError as e: return {"ok": False, "why": f"저장 실패: {e}"}
        self.eng.rt.note("구성", f"저장한 구성 삭제: {name}", actor=who); return dict(self.view(), msg=f"'{name}' 삭제")

    # ── 불러오기
    def _units(self, want, who, out):
        eng = self.eng
        for k in KINDS:
            if k not in want or not eng.rt.fleet.slots.get(k): continue
            w = max(1, min(int(want[k]), len(eng.rt.fleet.slots[k]))); have = self.count(k)
            if not eng.sim:
                if have != w: out.append(f"{k}: 저장된 구성은 {w}대, 지금 인식한 것은 {have}대 — 실장비는 장치를 연결하거나 철수해야 바뀐다")
                continue
            for _ in range(abs(w - have)):
                r = unitctl.change(eng, k, 1 if w > have else -1, who)
                if not r.get("ok"): out.append(f"{k}: {r.get('why', '')}"); break

    def _loads(self, items, who, out):
        lw = self.eng.loadw; bad = loads.check(items, lw.limit())
        if bad: out.append("부하 목록: " + " / ".join(bad[:2])); return
        lw.items = [dict(i) for i in items]; lw.rev += 1; lw.by = who; lw.t = wall_iso()
        try: fsio.write_json(lw.path, {"rev": lw.rev, "items": lw.items, "by": who, "t": lw.t}, indent=1)
        except OSError as e: out.append(f"부하 목록 저장 실패: {e}")
        lw.apply()

    def _bus(self, assign, who, out):
        bw = self.eng.busw; bw.assign = busplan.settings(assign); bw.by = who; bw.t = wall_iso()
        try: fsio.write_json(bw.path, {"assign": bw.assign, "by": who, "t": bw.t})
        except OSError as e: out.append(f"모선 구성 저장 실패: {e}")
        bw.apply()

    def _rest(self, p, who, out):
        eng = self.eng
        if isinstance(p.get("layout"), list):
            try: eng.save_layout({"items": p["layout"]}, who)
            except (ValueError, KeyError, TypeError, OSError) as e: out.append(f"배치도: {e}")
        elif p.get("layout") is None and eng.layout().get("items") is not None: eng.reset_layout(who)      # 기본 배치로 저장된 구성
        if p.get("open") is not None and eng.ringw.r is not None:
            try: eng.ringw.configure(eng, {"open": int(p["open"])}, who)
            except (ValueError, KeyError, TypeError, OSError) as e: out.append(f"상시 개방점: {e}")

    def apply(self, p, who, parts=("units", "bus", "loads", "rest")):
        """구성 한 묶음을 지금 장치에 적용한다. 반환: 맞추지 못한 것의 목록."""
        out = []
        if "units" in parts: self._units(p.get("units") or {}, who, out)
        if "bus" in parts and isinstance(p.get("bus"), dict): self._bus(p["bus"], who, out)
        if "loads" in parts and isinstance(p.get("loads"), list): self._loads(p["loads"], who, out)
        if "rest" in parts: self._rest(p, who, out)
        return out

    def load(self, name, who):
        p = self.book.get(name)
        if p is None: return {"ok": False, "why": "그런 이름이 없습니다"}
        out = self.apply(p, who)
        self.eng.rt.note("구성", f"구성 불러오기: {name}" + (f" — 맞추지 못한 것 {len(out)}건" if out else ""), actor=who)
        return dict(self.view(), msg=f"'{name}' 구성을 불러왔습니다" + (" — 장비가 인식될 때까지 몇 초 걸립니다" if self.eng.sim else ""), notes=out)


def preset(eng, path):
    """기본 구성(config/site_default.json)을 켤 때 적용한다(실행 스크립트 — 사용자 요구 '기본 구성을 앞으로는 이 구성으로').
    처음 한 번(또는 기본 구성 파일이 바뀌었을 때)만 전부 적용하고, 그 뒤에는 사용자가 바꾼 구성을 둔다. 가상 장치는 켤 때마다 장비가 처음 대수로 돌아가므로 대수만 다시 맞춘다."""
    import hashlib
    try:
        with open(path, encoding="utf-8") as f: txt = f.read()
        p = json.loads(txt)
    except (OSError, ValueError): return None
    w = _book(eng); mark = os.path.join(eng.rt.state_dir, "site_preset.json"); sha = hashlib.sha256(txt.encode()).hexdigest()[:16]; done = False
    try:
        with open(mark, encoding="utf-8") as f: done = json.load(f).get("sha") == sha
    except (OSError, ValueError): pass
    with eng.lock:
        out = w.apply(p, "기본 구성", ("units",) if done else ("units", "bus", "loads", "rest"))
    if not done:
        fsio.write_json(mark, {"sha": sha, "t": wall_iso()}); eng.rt.note("구성", "기본 구성 적용(config/site_default.json)" + (f" — 맞추지 못한 것 {len(out)}건" if out else ""))
    return out


def _book(eng):
    if getattr(eng, "profw", None) is None: eng.profw = Profiles(eng)
    return eng.profw


def http_post(eng, b, sess):
    """POST /api/profile {op: list | save | load | del, name} — 보기 · 저장 · 지우기는 운용자, 불러오기는 엔지니어."""
    op = b.get("op"); w = _book(eng); who = sess["name"]; name = str(b.get("name") or "")
    with eng.lock:
        if op == "list": return w.view()
        if op == "save": return w.save(name, who)
        if op == "del": return w.delete(name, who)
        if op == "load":
            if sess.get("role") != "engineer": return {"ok": False, "why": "엔지니어 권한 필요(모선 구성을 함께 바꾼다)"}
            return w.load(name, who)
    return {"ok": False, "why": f"동작 없음: {op}"}
