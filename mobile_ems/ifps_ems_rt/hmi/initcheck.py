"""설치 점검(초기화): 장비를 설치한 뒤 한 번에 검사하고, 문제가 있으면 고치는 방법을 안내하고, 고친 뒤 다시 검사해 '해결됨'을 확인하는 절차.

검사하는 것
  ① 장비 통신   설정 파일에 적힌 주소(IP · 경로 A · B)로 장비가 응답하는가 — 주소를 훑어 찾지 않는다(설정된 주소만 확인한다).
  ② 종류 · 대수  응답한 장비의 대수가 개요 배치도의 그림 수와 맞는가.
  ③ 환망 순서   구간분전함 · 배전체계의 ID 를 읽어 자리 순서 · 중복 · 누락을 본다.
  ④ 환망 A · B   급전 A 는 모선 A, 급전 B 는 모선 B 에서 받고, 상시 개방점이 한 곳이며, 모든 마디가 급전되는가.
  ⑤ 모선 구성   모선마다 전압을 세울 전원이 있는가(모선 구성 점검), 장비마다의 차단기가 닫혀 있는가.
  ⑥ 부하 경로   부하마다 구간분전함 · 배전체계가 필요한 대수만큼 붙었는가, 한 곳 고장에 끊기는 자리가 있는가.
판정은 지금 읽히는 값으로 한다 — TPCS 는 차단기를 조작해 가며 시험하지 않는다(가상 장치 · 실장비 모두). 한쪽 급전만 살려 보는 시험은 사람이 차단기를 조작한 뒤 다시 검사한다.
결과는 state/initcheck.json 에 남는다(몇 번째 검사에서 무엇이 이상이었고 언제 풀렸는지). 이상(bad)과 주의(warn)가 모두 0 이어야 '설치 점검 완료'다(사용자 결정). 일부러 그런 것 — 가져오지 않은 종류, 일부러 열어 둔 차단기 — 은 사람이 [확인]하면 정상으로 닫힌다(acks).
"""
import json, os
from .. import fleet, fsio
from .engdefs import wall_iso

KIND_NAME = {"DG": "기동형 복합전력(디젤 · PCS)", "ESS": "이동형 ESS", "PV": "이동형 태양광", "FC": "수소 연료전지", "ELZ": "수전해", "MTR": "계측 · 보호 게이트웨이(배전 · 변압)", "GDG": "주둔지 발전기"}
LAY_KIND = ("DG", "ESS", "PV", "FC")                          # 배치도의 그림 종류 = 대수를 세는 장비 종류
KEEP = 20                                                      # 남겨 두는 검사 횟수
G_COMM = ["장비의 전원이 켜져 있는지 본다.", "통신선(경로 A · B)이 장비와 스위치에 꽂혀 있는지 본다.", "장비에 정한 주소가 아래 '설정된 주소'와 같은지 본다 — 다르면 장비의 주소를 맞추거나 설정 편집(엔지니어)에서 주소를 고친다.", "고친 뒤 [이 항목만 다시 검사]를 누른다."]


def _it(iid, area, name, level, text, guide=(), fix=None, **kw):
    """검사 한 줄. ack: 일부러 그런 것이면 사람이 확인해 닫을 수 있는 줄 — 확인 단추에 쓸 글(없으면 고쳐야만 닫힌다).
    short: 요약에 적는 '확인한 사실' 한마디(없으면 text 의 앞부분) — 그냥 '정상'이 아니라 무엇을 보고 정상인지 보이게."""
    return {"id": iid, "area": area, "name": name, "level": level, "text": text, "guide": list(guide), "fix": fix, "ack": kw.get("ack", ""), "short": kw.get("short") or text.split(" — ")[0].split("(")[0].strip()}


def _addr(cfg, n):
    return " · ".join(f"{'AB'[i] if i < 2 else i}: {h}:{p}" for i, (h, p) in enumerate(cfg.get("devices", {}).get(n, {}).get("paths", [])))


def _comm(snap, cfg):
    """① 장비 통신: 가져온(인식한) 장비와 종류마다의 첫 장비. 한 번도 응답하지 않은 추가 자리는 '빈 자리'라 검사하지 않는다."""
    out = []
    for n, d in snap["devices"].items():
        if d.get("slot") and d.get("absent"): continue
        k = d.get("kind") or fleet.kind(n) or n; nm = f"{KIND_NAME.get(k, k)} {n}"; ps = d.get("paths") or {}; up = [p for p, v in ps.items() if v.get("alive")]; addr = _addr(cfg, n)
        if d.get("absent"): out.append(_it(f"comm.{n}", "장비 통신", nm, "warn", f"한 번도 응답하지 않았다 — 가져오지 않은 종류면 그대로 둔다. 설정된 주소 {addr}", ["이 종류를 설치했다면:"] + G_COMM + ["가져오지 않았으면 [가져오지 않은 종류로 확인]을 누른다."], ack="가져오지 않은 종류로 확인"))
        elif not up: out.append(_it(f"comm.{n}", "장비 통신", nm, "bad", f"두 경로 모두 응답 없음 — 설정된 주소 {addr}", G_COMM))
        elif len(up) < len(ps): out.append(_it(f"comm.{n}", "장비 통신", nm, "warn", f"경로 {' · '.join(sorted(set(ps) - set(up)))} 응답 없음(경로 {' · '.join(sorted(up))} 로 운전 중) — 설정된 주소 {addr}", ["응답 없는 경로의 통신선과 스위치 포트를 본다.", "한 경로만으로도 운전은 되지만 그 경로가 끊기면 두절된다.", "고친 뒤 [이 항목만 다시 검사]를 누른다."]))
        else: out.append(_it(f"comm.{n}", "장비 통신", nm, "ok", f"경로 {' · '.join(sorted(up))} 응답 — {addr}"))
    return out


def _count(snap, lay):
    """② 종류 · 대수: 인식한 대수와 배치도의 그림 수."""
    out = []; items = (lay or {}).get("items")
    for k in LAY_KIND:
        f = (snap.get("fleet") or {}).get(k)
        if f is None: continue
        n = len(f["units"]); pic = sum(1 for i in items if i.get("kind") == k) if items else 1; nm = KIND_NAME[k]
        if n == 0: out.append(_it(f"count.{k}", "종류 · 대수", nm, "warn", "인식한 장비가 없다(가져오지 않았으면 정상)", ["설치했다면 '장비 통신'의 안내를 따른다.", "가져오지 않았으면 [가져오지 않은 종류로 확인]을 누른다."], ack="가져오지 않은 종류로 확인"))
        elif pic > n: out.append(_it(f"count.{k}", "종류 · 대수", nm, "warn", f"배치도에는 {pic}대, 인식한 것은 {n}대 — 그림 {pic - n}개가 예비 자리로 남아 있다", ["설치한 장비가 더 있으면 그 장비의 전원 · 통신을 본다('장비 통신').", "설치하지 않았으면 개요의 [배치 편집]에서 남는 그림을 지우고 저장한다."], {"label": "개요에서 배치 편집", "act": "goto", "to": "#overview"}))
        else: out.append(_it(f"count.{k}", "종류 · 대수", nm, "ok", f"{n}대 인식" + (f" (슬롯 {f['slots']}자리)" if f.get("slots") else "")))
    return out


def _ring_order(disc):
    """③ 환망 순서: 구간분전함 · 배전체계의 ID."""
    if not disc: return []
    bad = [r for r in disc.get("rows", []) if r.get("state") not in ("인식", "정상", "") and r.get("hint")]
    if disc.get("ok"): return [_it("ring.order", "환망 순서", "구간분전함 · 배전체계 ID", "ok", f"구간분전함 {disc.get('fsu', 0)}대 · 배전체계 {disc.get('ppdu', 0)}대를 자리 순서대로 인식", short="ID 가 자리 순서대로")]
    txt = "; ".join(f"{r['name']}: {r['state']}{' — ' + r['hint'] if r.get('hint') else ''}" for r in bad[:4]) or f"{disc.get('bad', 0)}대가 제자리가 아니거나 응답이 없다"
    return [_it("ring.order", "환망 순서", "구간분전함 · 배전체계 ID", "bad", txt, ["환망 화면의 [초기 기동 점검]에서 어느 자리의 ID 가 다른지 본다.", "케이블이 바뀌어 꽂혔으면 바로 꽂는다. 같은 ID 가 둘이면 장치의 ID 설정을 고친다.", "응답이 없는 장치는 전원 · 통신선을 본다.", "고친 뒤 [이 항목만 다시 검사]를 누른다."], {"label": "환망 화면 열기", "act": "goto", "to": "#ring"})]


G_RING = ["환망 화면에서 구간 차단기와 상시 개방점의 상태를 본다.", "급전 A 는 모선 A, 급전 B 는 모선 B 에서 나와야 한다 — 두 급전 케이블이 바뀌지 않았는지 본다.", "고친 뒤 [이 항목만 다시 검사]를 누른다."]
GO_RING = {"label": "환망 화면 열기", "act": "goto", "to": "#ring"}


def _feed_end(r, v, i, bus):
    """급전 한쪽(구간 0 = 급전 A, 구간 n = 급전 B): 급전 차단기가 닫혀 있고 그 모선에 전압이 있는가."""
    n = len(r["fsu"]); s = next((x for x in r["sections"] if x["i"] == i), None); bv = v.get(f"BUS.{bus.lower()}_v"); live = bv is None or bv > 300; closed = s is not None and s["state"] == 1
    ok = closed and live; why = "닫힘 · 모선 전압 있음" if ok else ("급전 차단기가 열려 있다" if not closed else f"모선 {bus} 에 전압이 없다")
    return _it(f"ring.feed{bus}", "환망 A · B", f"급전 {bus}(모선 {bus} → {r['fsu'][0 if bus == 'A' else n - 1]['name']})", "ok" if ok else "bad", why, [] if ok else G_RING, None if ok else GO_RING)


def _nop(sec, want=None):
    """상시 개방점: 열린 구간이 꼭 한 곳이고, 그곳이 설정의 상시 개방점(want)과 같다."""
    opens = [x["i"] for x in sec if x["state"] == 0]
    if len(opens) == 1 and want is not None and opens[0] != want:
        return _it("ring.nop", "환망 A · B", "상시 개방점", "warn", f"설정의 상시 개방점은 구간 {want} 인데 실제로 열린 곳은 구간 {opens[0]} 이다 — 부하가 받는 모선(A · B) 표시가 실제와 다를 수 있다",
                   ["실제 결선이 맞으면 환망 화면의 [배전체계 구성]에서 상시 개방점을 열린 구간으로 맞춘다.", "설정이 맞으면 구간 차단기를 설정대로 조작한다(먼저 열 곳을 열고 닫을 곳을 닫는다 — 고리를 닫은 채 두지 않는다).", "맞춘 뒤 [이 항목만 다시 검사]를 누른다."], GO_RING)
    if len(opens) == 1: return _it("ring.nop", "환망 A · B", "상시 개방점", "ok", f"구간 {opens[0]} 한 곳이 열려 있다(순환 전류 방지)")
    if not opens: return _it("ring.nop", "환망 A · B", "상시 개방점", "bad", "열린 구간이 없다 — 고리가 닫혀 순환 전류가 흐를 수 있다", G_RING, GO_RING)
    return _it("ring.nop", "환망 A · B", "상시 개방점", "warn", f"열린 구간이 {len(opens)}곳({', '.join(map(str, opens))}) — 구간이 끊겼거나 차단기를 열어 둔 것이다", G_RING, GO_RING)


def _ring_feed(snap, v):
    """④ 환망 A · B: 양쪽 급전, 상시 개방점 한 곳, 모든 마디 급전."""
    r = snap.get("ring")
    if not r or not r.get("fsu"): return []
    n = len(r["fsu"]); dead = [f["name"] for f in r["fsu"] if f.get("live") is False]
    fed = _it("ring.fed", "환망 A · B", "구간분전함 급전", "bad", f"정전: {', '.join(dead)}", G_RING, GO_RING) if dead else _it("ring.fed", "환망 A · B", "구간분전함 급전", "ok", f"{n}개 모두 급전")
    return [_feed_end(r, v, 0, "A"), _feed_end(r, v, n, "B"), _nop(r["sections"], r.get("open")), fed]


def _bus(snap, v):
    """⑤ 모선 구성 점검과 장비마다의 차단기."""
    b = snap.get("bus") or {}; out = []; iss = b.get("issues", [])
    for k, it in enumerate(iss):
        out.append(_it(f"bus.{it.get('bus', '')}{k}", "모선 구성", f"모선 {it.get('bus', '')}", "bad" if it.get("level") == "bad" else "warn", it.get("text", ""),
                       ["모선 구성 창에서 장비 한 대 한 대가 물린 모선을 실제 결선과 맞춘다.", "고칠 수 있는 약점은 [자동 보완]으로 고친다(실제 결선도 같이 바꿔야 한다)."], {"label": "자동 보완", "act": "bus_auto"} if it.get("fix") else {"label": "모선 구성 열기", "act": "busplan"}))
    if not iss: out.append(_it("bus.ok", "모선 구성", "모선 A · B", "ok", "두 모선 모두 전압을 세울 전원이 있다", short="두 모선에 전원 있음"))
    for s in b.get("sources", []):
        if not s.get("present") or s["kind"] in ("GRID", "GDG"): continue
        c = v.get(f"CB.{s['id']}")
        if c is None or int(round(c)) == 1: continue
        out.append(_it(f"cb.{s['id']}", "모선 구성", f"{s['name']} 차단기(CB-{s['id']})", "warn", "트립" if int(round(c)) == 2 else "개방 — 이 장비는 모선에서 떨어져 있다", ["일부러 연 것이 아니면 차단기를 닫는다(트립이면 보호 동작 원인을 먼저 없앤다).", "닫은 뒤 [이 항목만 다시 검사]를 누른다.", "일부러 열어 둔 것이면 [일부러 열어 둔 것으로 확인]을 누른다."], ack="일부러 열어 둔 것으로 확인"))
    return out


def _loads(snap):
    """⑥ 부하 공급 경로와 무정전 점검."""
    out = []; go = {"label": "부하 관리 열기", "act": "goto", "to": "#loads"}
    for i in (snap.get("loads") or {}).get("items", []):
        if i.get("n", 0) <= 0: continue
        have = len(i.get("ppdus") or []); nm = i["name"] + (f" ×{i['n']}" if i["n"] > 1 else "")
        if not i.get("fsu"): out.append(_it(f"load.{i['id']}", "부하 경로", nm, "bad", "물릴 구간분전함이 없다", ["부하 관리에서 공급 경로(구간분전함)를 고른다."], go))
        elif have < i.get("need", 0) or i.get("fsu_over") or i.get("out_over"):
            out.append(_it(f"load.{i['id']}", "부하 경로", nm, "warn", f"{i.get('fsu_name')} · 배전체계 {have}대(필요 {i.get('need', 0)}대)" + (" · 구간분전함 정격 또는 출력 회로 초과" if i.get("fsu_over") or i.get("out_over") else ""),
                           ["배전체계를 더 놓거나(자리 18개), 부하를 다른 구간분전함으로 옮긴다."], go))
        else: out.append(_it(f"load.{i['id']}", "부하 경로", nm, "ok", f"{i.get('fsu_name')} → 배전체계 {have}대 · {i['grade']}등급", short=f"{i.get('fsu_name')} · 배전체계 {have}대"))
    for k, it in enumerate(((snap.get("ring") or {}).get("n1") or {}).get("items", [])):
        if it.get("level") != "info": out.append(_it(f"n1.{k}", "부하 경로", f"무정전 점검 · {it.get('area', '')}", "warn", it.get("text", ""), [it.get("fix") or "환망 화면의 무정전 점검 표를 본다."], {"label": "환망 화면 열기", "act": "goto", "to": "#ring"}))
    return out


def _pic(i, snap):
    """그 줄을 나타내는 그림 종류(화면이 장비 · 부하 그림을 붙인다)."""
    a, _, x = i["id"].partition(".")
    if a == "comm": return (snap["devices"].get(x) or {}).get("kind") or fleet.kind(x) or x
    if a == "count": return x
    if a == "cb": return "G1" if x.startswith("G1") else fleet.kind(x) or x
    if a == "load": return next((q.get("spr") for q in (snap.get("loads") or {}).get("items", []) if q["id"] == x), "L2")
    return {"ring": "FSU", "bus": "DIST", "n1": "FSU"}.get(a, "DIST")


def inspect(snap, cfg, lay, disc, val):
    """지금 상태로 검사한 줄들(순서: 통신 → 대수 → 환망 순서 → 환망 A · B → 모선 → 부하). val: 읽은 값(신호 이름 → 값)."""
    out = _comm(snap, cfg) + _count(snap, lay) + _ring_order(disc) + _ring_feed(snap, val) + _bus(snap, val) + _loads(snap)
    for i in out: i["pic"] = _pic(i, snap)
    return out


class InitCheck:
    """검사 결과와 이력(state/initcheck.json)."""
    def __init__(self, eng):
        self.eng = eng; self.path = os.path.join(eng.rt.state_dir, "initcheck.json"); self.runs = []; self.last = None; self.acks = set()
        try:
            with open(self.path, encoding="utf-8") as f: o = json.load(f)
            self.runs = list(o.get("runs", []))[-KEEP:]; self.last = o.get("last"); self.acks = set(o.get("acks", []))
        except (OSError, ValueError): pass

    def _now(self):
        eng = self.eng; snap = eng.snapshot(); rw = getattr(eng, "ringw", None)
        disc = rw.view(eng).get("discover") if rw is not None and snap.get("ring") else None
        out = inspect(snap, eng.cfg, eng.layout(), disc, dict(eng.rt.val)); self.acks &= {i["id"] for i in out if i["ack"]}      # 사정이 바뀐 줄(장비가 응답함 · 차단기를 닫음)의 확인은 지운다
        for i in out:
            if i["id"] in self.acks: i.update(level="ok", text=i["text"] + " — 사람이 확인함", guide=[], fix=None, ack="", acked=True, short="사람이 확인함")
        return out

    def confirm(self, who, iid):
        """일부러 그런 줄을 사람이 확인해 닫는다(그 줄이 확인할 수 있는 줄일 때만)."""
        it = next((i for i in (self.last or {}).get("items", []) if i["id"] == iid), None)
        if it is None or not it.get("ack"): return {"ok": False, "why": "확인으로 닫을 수 없는 항목입니다 — 고친 뒤 다시 검사하십시오"}
        self.acks.add(iid); self.eng.rt.note("설치 점검", f"확인으로 닫음: {it['name']} — {it['ack']}", actor=who)
        return self.run(who, iid)

    def _merge(self, new, only):
        """한 줄만 다시 검사: 직전 결과에서 그 줄만 새 결과로 바꾼다(그 줄이 직전에 없었으면 덧붙인다)."""
        if not (only and self.last): return new
        pick = {i["id"]: i for i in new}; had = {i["id"] for i in self.last["items"]}
        gone = lambda i: dict(i, level="ok", text="지금은 이 문제가 없다", guide=[], fix=None, short="문제 없음")                 # 그 줄이 이번 검사에 없으면(약점 · 열린 차단기가 사라짐) 풀린 것이다
        return [(pick[i["id"]] if i["id"] in pick else gone(i)) if i["id"] == only else i for i in self.last["items"]] + [i for i in new if i["id"] == only and only not in had]

    @staticmethod
    def _mark(new, old, only):
        """직전에 주의 · 이상이던 줄이 정상이 되면 '해결됨'(was). 다시 보지 않은 줄은 직전 표시를 그대로 둔다."""
        for i in new:
            if only and i["id"] != only: continue
            o = old.get(i["id"]); i["was"] = o["level"] if o and o["level"] != "ok" and i["level"] == "ok" else None

    def run(self, who, only=None):
        """검사한다. only: 그 줄만 다시 검사(나머지는 직전 결과를 둔다)."""
        old = {i["id"]: i for i in (self.last or {}).get("items", [])}; new = self._merge(self._now(), only); self._mark(new, old, only); ids = {i["id"] for i in new}
        gone = [o["name"] for k, o in old.items() if o["level"] != "ok" and k not in ids]                    # 직전에 문제였는데 이번에는 줄 자체가 없어진 것(뺀 장비 등)
        bad = sum(1 for i in new if i["level"] == "bad"); warn = sum(1 for i in new if i["level"] == "warn")
        self.last = {"t": wall_iso(), "by": who, "n": len(self.runs) + 1, "items": new, "bad": bad, "warn": warn, "done": bad == 0 and warn == 0, "cleared": gone, "only": only}
        self.runs = (self.runs + [{"t": self.last["t"], "by": who, "bad": bad, "warn": warn, "only": only, "fixed": [i["name"] for i in new if i.get("was")] + gone, "open": [i["name"] for i in new if i["level"] == "bad"]}])[-KEEP:]
        try: fsio.write_json(self.path, {"last": self.last, "runs": self.runs, "acks": sorted(self.acks)})
        except OSError: pass
        self.eng.rt.note("설치 점검", f"{self.last['n']}차 검사{'(한 항목)' if only else ''}: 이상 {bad}건 · 주의 {warn}건" + (" — 설치 점검 완료" if bad == 0 and warn == 0 else ""), actor=who)
        return self.view()

    def brief(self):
        """스냅샷에 싣는 한 줄: 개요의 단추가 '미완료 · 남은 이상 n건'을 보인다."""
        la = self.last
        return {"ran": la is not None, "done": bool(la and la["done"]), "bad": la["bad"] if la else None, "warn": la["warn"] if la else None, "t": la["t"] if la else None}

    def view(self):
        return {"ok": True, "last": self.last, "runs": self.runs[::-1], "sim": bool(self.eng.sim)}


def http_get(hd, eng, q):
    """GET /api/archive/initcheck[?run=1[&only=<줄>] | ?ack=<줄>] — 보기는 누구나, 검사 · 확인은 운용자."""
    if eng is None: return hd._err(403, "기록 조회기에서는 검사할 수 없습니다")              # pylint: disable=protected-access
    if q.get("run"):
        s = hd._sess("operator")                                                           # pylint: disable=protected-access
        if s is None: return None
        with eng.lock: return hd._send(200, eng.initw.run(s["name"], q.get("only") or None))   # pylint: disable=protected-access
    if q.get("ack"):
        s = hd._sess("operator")                                                           # pylint: disable=protected-access
        if s is None: return None
        with eng.lock: return hd._send(200, eng.initw.confirm(s["name"], q["ack"]))          # pylint: disable=protected-access
    with eng.lock: return hd._send(200, eng.initw.view())                                  # pylint: disable=protected-access

