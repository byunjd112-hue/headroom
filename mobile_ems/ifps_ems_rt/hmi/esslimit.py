"""ESS 충전율 운용 범위(사용자 요구, Rev67): 방전 하한 · 충전 상한을 화면에서 입력한다. 기본 20 % ~ 80 %(설정 파일 runtime.json 의 site.soc_min · soc_max).

TPCS 는 이 범위 안에서 ESS 를 쓴다 — 하한 아래로는 방전 계획을 세우지 않고(가까워지면 발전기 기동 · 부하 절감), 상한 위로는 충전 계획을 세우지 않는다.
저장하면 설정 파일을 바꿔 쓰고(이전 판 보관) 바로 적용한다: 실행기 · 가상 장치 구동부 · 운전계획이 같은 Site 를 보므로 값만 바꾸고, 운전계획의 충전율 격자는 다시 만든다.
배터리 자체의 보호 한계(BMS · PCS)는 장비가 지킨다 — 이 값은 TPCS 의 운용 범위다.
"""
import json

from . import cfgedit

LO = (5, 50); HI = (50, 100); GAP = 20                  # 하한 5~50 %, 상한 50~100 %, 둘 사이 20 %p 이상


def view(eng):
    s = eng.rt.site
    return {"ok": True, "lo": round(s.soc_min * 100, 1), "hi": round(s.soc_max * 100, 1), "lo_range": LO, "hi_range": HI, "gap": GAP}


def check(lo, hi):
    ok = all(isinstance(v, (int, float)) and not isinstance(v, bool) and v == v for v in (lo, hi))
    if not ok: return "숫자를 넣으십시오"
    if not LO[0] <= lo <= LO[1]: return f"방전 하한은 {LO[0]}~{LO[1]} %"
    if not HI[0] <= hi <= HI[1]: return f"충전 상한은 {HI[0]}~{HI[1]} %"
    if hi - lo < GAP: return f"상한과 하한의 차이는 {GAP} %p 이상"
    return ""


def apply(eng, lo, hi):
    s = eng.rt.site; s.soc_min = lo / 100.0; s.soc_max = hi / 100.0
    pol = getattr(eng.rt, "policy", None)
    if pol is not None and hasattr(pol, "pl"):
        from ifps_ems import dispatch as dp                             # pylint: disable=import-outside-toplevel — 운전계획을 쓸 때만
        pol.pl = dp.Planner(s)                                          # 충전율 격자를 새 범위로


def store(eng, lo, hi, who):
    why = check(lo, hi)
    if why: return {"ok": False, "why": why}
    ed = eng.cfged; synced = ed.loaded["runtime"] == cfgedit._sha(ed._text("runtime"))                    # pylint: disable=protected-access
    with open(eng.cfg_path, encoding="utf-8") as f: full = json.load(f)
    full.setdefault("site", {}).update({"soc_min": round(lo / 100.0, 3), "soc_max": round(hi / 100.0, 3)})
    ed._write("runtime", json.dumps(full, ensure_ascii=False, indent=1) + "\n")                            # pylint: disable=protected-access
    if synced: ed.loaded["runtime"] = cfgedit._sha(ed._text("runtime"))                                    # pylint: disable=protected-access — 바로 적용되므로 '재기동 필요'로 보이지 않게
    eng.cfg.setdefault("site", {}).update(full["site"]); apply(eng, lo, hi)
    eng.rt.note("설정", f"ESS 충전율 운용 범위: 방전 하한 {lo:g} % · 충전 상한 {hi:g} %", actor=who)
    return dict(view(eng), msg=f"ESS 충전율 범위 {lo:g} ~ {hi:g} % 로 저장")


def http_post(eng, b, sess):
    """POST /api/esslimit {op: get | set, lo, hi} — 보기는 운용자, 바꾸기는 엔지니어."""
    with eng.lock:
        if b.get("op") != "set": return view(eng)
        if sess.get("role") != "engineer": return {"ok": False, "why": "엔지니어 권한 필요(ESS 운용 범위)"}
        return store(eng, b.get("lo"), b.get("hi"), sess["name"])
