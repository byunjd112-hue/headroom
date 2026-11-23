# -*- coding: utf-8 -*-
"""운영 시나리오의 시퀀스 문서를 PowerPoint 로 내고, 회의에서 고친 파일을 다시 읽어 시나리오로 되돌린다.

시나리오마다 ① 시퀀스 그림(장비별 세로선, 지령·응답 화살표, 단계별 누적 시간)  ② 단계 표(고치는 곳) 를 만든다.
다시 올릴 때는 표만 읽는다 — 그림은 보기용이다. 표의 '종류·대상·조건·값·시간' 을 고치거나 줄을 넣고 빼면 반영되고, '의견' 칸의 글은 검토 의견으로 모은다.
읽은 시나리오는 검증기와 같은 규칙으로 검사한다. 틀린 줄이 있으면 그 시나리오는 반영하지 않고 어느 줄이 왜 틀렸는지 알려 준다.
"""
import time
from . import pptx
from .scenario_policy import METRICS

KIND = {"set": "입력", "expect": "판정", "command": "지령", "wait": "대기", "response": "고장 주입", "branch": "분기", "policy": "EMS 정책 실행", "policy_check": "EMS 판단 판정"}
KIND_R = {v: k for k, v in KIND.items()}
OP = {"eq": "=", "ge": "≥", "le": "≤"}
OP_R = {"=": "eq", "==": "eq", "≥": "ge", ">=": "ge", "≤": "le", "<=": "le"}
CTRL = {"auto": "AUTO", "manual": "MANUAL", "immediate": "MANUAL 즉시"}
PLACE = {"island": "작전지", "grid": "주둔지"}
MLABEL = {"executed": "급전 판단 실행", "writes": "쓰기 건수", "tied": "상전 연계", "outage": "정전 감지", "DG": "디젤 목표", "FC": "연료전지 목표", "GDG": "예비 발전기 목표", "ELZ": "수전해 목표", "reserve": "예비력 규칙",
          "ess_target": "ESS 목표 (kW)", "grid_target": "수전 목표 (kW)", "full_hours": "전 부하 자립 예상 (h)"}
RESULT = dict(zip(("pass", "fail", "skip"), ("통과", "실패", "건너뜀")))
HEAD = ["번호", "종류", "대상", "조건", "값", "시간 ms", "누적 ms", "결과", "의견"]
WIDTHS = [5, 11, 22, 6, 10, 8, 8, 12, 18]
ROWS_PER_SLIDE = 15
BROWN, GRAY, RED, GREEN, BLUE = "5B4A34", "6F6B68", "C00000", "2E7D32", "1F5FA8"
GUIDE = [["입력", "신호 이름 (예: LOAD.kw)", "", "넣을 값", "", "가상 장치에 값을 넣는다"], ["판정", "신호 이름", "= ≥ ≤", "기준값", "기다릴 한도(ms). 0 은 바로", "한도 안에 조건이 맞으면 통과"],
         ["지령", "장비 이름 (예: DG)", "", "기동 또는 정지", "", "EMS 가 기동·정지 지령을 낸다"], ["대기", "", "", "", "기다릴 시간(ms)", "시간만 흘려보낸다"],
         ["고장 주입", "장비 이름", "", "", "응답 지연(ms). -1 은 응답 없음", "장비가 늦게 답하거나 답하지 않게 한다"], ["분기", "신호 이름", "= ≥ ≤", "기준값", "조건이 거짓일 때 건너뛸 단계 수", "조건에 따라 다음 단계를 건너뛴다"],
         ["EMS 정책 실행", "AUTO · 작전지 · 평시 처럼 세 가지를 가운뎃점으로", "", "모의 시각(0~23.99, 비워도 됨)", "", "그 운용 장소·태세로 EMS 판단을 한 번 돌린다"], ["EMS 판단 판정", "판단 항목 (예: 디젤 목표)", "= ≥ ≤", "기준값", "", "EMS 가 내린 판단값을 확인한다"]]


def _num(v):
    f = float(v); return int(f) if f.is_integer() else f


def row_of(step):
    """단계 하나를 표의 [종류, 대상, 조건, 값, 시간] 으로."""
    t = step["type"]
    if t == "set": return [KIND[t], step["tag"], "", step["value"], ""]
    if t == "expect": return [KIND[t], step["tag"], OP[step["op"]], step["value"], step.get("ms", 0)]
    if t == "command": return [KIND[t], step["device"], "", "기동" if step["value"] == 1 else "정지", ""]
    if t == "wait": return [KIND[t], "", "", "", step["ms"]]
    if t == "response": return [KIND[t], step["device"], "", "", step["ms"]]
    if t == "branch": return [KIND[t], step["tag"], OP[step["op"]], step["value"], step.get("skip", 0)]
    if t == "policy": return [KIND[t], f"{CTRL[step['control']]} · {PLACE[step['mode']]} · {step['posture']}", "", step.get("hour", ""), ""]
    return [KIND[t], MLABEL.get(step["metric"], step["metric"]), OP[step["op"]], step["value"], ""]


def _policy(target, value):
    part = [x.strip() for x in target.replace("·", "|").replace("/", "|").split("|") if x.strip()]
    if len(part) != 3: raise ValueError("대상은 'AUTO · 작전지 · 평시' 처럼 세 가지를 적습니다")
    ctrl = {v.upper(): k for k, v in CTRL.items()}.get(part[0].upper()); place = {v: k for k, v in PLACE.items()}.get(part[1])
    if ctrl is None or place is None: raise ValueError("제어 방식(AUTO·MANUAL·MANUAL 즉시)과 운용 장소(작전지·주둔지)를 확인하십시오")
    s = {"type": "policy", "control": ctrl, "mode": place, "posture": part[2]}
    if str(value).strip() != "": s["hour"] = _num(value)
    return s


def _cond(t, target, op, value, ms):
    """조건이 있는 단계(판정 · 분기 · EMS 판단 판정)."""
    if op not in OP_R: raise ValueError("조건은 = ≥ ≤ 중 하나")
    if t == "expect": return {"type": t, "tag": target, "value": _num(value), "op": OP_R[op], "ms": int(float(ms or 0)), "limit": int(float(ms or 0))}
    if t == "branch": return {"type": t, "tag": target, "value": _num(value), "op": OP_R[op], "skip": int(float(ms or 0))}
    metric = {v: k for k, v in MLABEL.items()}.get(target, target)
    if metric not in METRICS: raise ValueError(f"판단 항목 '{target}' 를 모릅니다")
    return {"type": t, "metric": metric, "value": _num(value), "op": OP_R[op]}


def _command(target, value):
    if value not in ("기동", "정지", "1", "2"): raise ValueError("값은 '기동' 또는 '정지'")
    return {"type": "command", "device": target, "value": 1 if value in ("기동", "1") else 2}


SIMPLE = {"set": lambda g, o, v, m: {"type": "set", "tag": g, "value": _num(v)}, "wait": lambda g, o, v, m: {"type": "wait", "ms": int(float(m))}, "response": lambda g, o, v, m: {"type": "response", "device": g, "ms": int(float(m))},
          "command": lambda g, o, v, m: _command(g, v), "policy": lambda g, o, v, m: _policy(g, v)}


def step_of(cells):
    """표의 한 줄 [종류, 대상, 조건, 값, 시간] 을 단계로. 틀리면 ValueError."""
    kind, target, op, value, ms = [str(c).strip() for c in (list(cells) + [""] * 5)[:5]]; t = KIND_R.get(kind)
    if t is None: raise ValueError(f"종류 '{kind}' 를 모릅니다({' · '.join(KIND.values())} 중 하나)")
    try:
        return SIMPLE[t](target, op, value, ms) if t in SIMPLE else _cond(t, target, op, value, ms)
    except (TypeError, ValueError) as e:
        raise ValueError(str(e) if "could not convert" not in str(e) and "invalid literal" not in str(e) else "값·시간 칸에 숫자가 필요합니다") from e


def timeline(case, result=None):
    """단계별 누적 시간(ms). 검증 결과가 있으면 관측값, 없으면 대기 + 판정 한도를 더한 값(가장 늦은 경우)."""
    rows = {r["step"]: r for r in (result or {}).get("rows", [])}; out = []; t = 0
    for i, s in enumerate(case["steps"]):
        if i in rows: t = rows[i].get("elapsed", t)
        elif not rows: t += s.get("ms", 0) if s["type"] in ("wait", "expect") and s.get("ms", 0) > 0 else 0
        out.append(t)
    return out


def _lane(step):
    return step.get("device") or (step["tag"].split(".")[0] if step.get("tag") else "EMS")


def _label(s, r):
    """화살표 위에 적는 글."""
    t = s["type"]; txt = row_of(s)
    label = {"wait": f"대기 {s.get('ms', 0):,} ms", "command": f"{txt[3]} 지령", "set": f"{s.get('tag')} ← {s.get('value')}", "response": "응답 없음" if s.get("ms") == -1 else f"응답 지연 {s.get('ms')} ms", "policy": txt[1]}.get(t) \
        or f"{txt[1]} {txt[2]} {txt[3]}" + (f"  (한도 {s['ms']:,} ms)" if t == "expect" and s.get("ms") else "")
    if r is not None and r.get("actual") is not None and t in ("expect", "policy_check", "branch"): label += f"  → 관측 {r['actual']}"
    return label + ("" if r is None else " ✕" if r["state"] == "fail" else " (건너뜀)" if r["state"] == "skip" else " ✓")


def _colour(s, r):
    if r is not None and r["state"] != "pass": return RED if r["state"] == "fail" else GRAY
    return BLUE if s["type"] in ("expect", "policy_check", "branch") else "333333"


def _diagram(sl, case, result, times):
    """시퀀스 그림: 왼쪽에 누적 시간, EMS 와 장비의 세로선, 단계마다 화살표."""
    steps = case["steps"]; lanes = ["EMS"] + sorted({_lane(s) for s in steps} - {"EMS"}, key=[_lane(s) for s in steps].index)
    lanes = lanes[:8]; x0, x1, y0, y1 = 2.0, 12.6, 1.95, 7.05; gap = (x1 - x0) / max(len(lanes) - 1, 1); xs = {n: x0 + i * gap for i, n in enumerate(lanes)}; dy = min(0.34, (y1 - y0 - 0.2) / max(len(steps), 1)); fs = 9 if dy >= 0.3 else 7.5
    rows = {r["step"]: r for r in (result or {}).get("rows", [])}
    for n, x in xs.items(): sl.box(x - 0.6, 1.45, 1.2, 0.36, n, 11, True, "FFFFFF", "ctr", BROWN if n == "EMS" else "8A7A5F", None, round_=True).line(x, 1.81, x, y1, "B8AE9C", 1.0, True)
    sl.box(0.35, 1.45, 1.2, 0.36, "누적 시간", 10, True, GRAY, "ctr")
    for i, s in enumerate(steps):
        y = y0 + dy * (i + 0.75); t = s["type"]; xe = xs.get(_lane(s), xs["EMS"]); r = rows.get(i); col = _colour(s, r); label = _label(s, r)
        sl.box(0.35, y - dy * 0.55, 1.2, dy, f"{i + 1}  +{times[i]:,} ms", fs, False, GRAY, "r")
        if t == "wait" or xe == xs["EMS"]: sl.box(xs["EMS"] + 0.08, y - dy * 0.55, 4.6, dy, label, fs, False, col, "l"); continue
        back = t in ("expect", "branch"); a, b = (xe, xs["EMS"]) if back else (xs["EMS"], xe); sl.line(a, y, b, y, RED if t == "response" else col, 1.25, back or t == "response", True)
        sl.box(min(a, b) + 0.06, y - dy * 0.98, abs(b - a) - 0.12, dy * 0.9, label, fs, False, col, "ctr", valign="b")
    sl.box(0.35, 7.08, 12.6, 0.3, "실선 = 지령·입력(EMS → 장비)   점선 = 응답 판정(장비 → EMS)   빨간 점선 = 고장 주입   누적 시간은 " + ("가상 장치 검증에서 관측한 값" if rows else "대기와 판정 한도를 더한 값(가장 늦은 경우)"), 8.5, False, GRAY)


def export(cases, results=None, rev="", site=""):
    """시퀀스 문서(pptx) 바이트. results 는 검증 결과(scenarios.verify 의 results) — 있으면 관측 시간·통과 여부가 들어간다."""
    d = pptx.Deck(); res = {r["name"]: r for r in (results or [])}; s = d.slide()
    s.box(0, 0, 13.333, 7.5, "", fill="F6F2EA").box(0.8, 2.3, 11.7, 0.9, "운영 시나리오 시퀀스 문서", 34, True, BROWN).box(0.8, 3.2, 11.7, 0.5, f"IFPS 이동형 전력체계 EMS  ·  {site}  ·  {rev}  ·  {time.strftime('%Y-%m-%d %H:%M')}  ·  시나리오 {len(cases)}건", 14, False, GRAY)
    s.box(0.8, 4.0, 11.7, 1.2, "회의에서 단계 표를 고친 뒤 화면의 [PPT 올리기]로 다시 올리면 시나리오에 반영된다. 시간은 가상 장치로 검증한 값이며 실장비 성능은 시험(FAT·SAT)으로 확인한다.", 13, False, "333333", valign="t")
    g = d.slide(); g.box(0.35, 0.3, 12.6, 0.6, "고치는 방법", 24, True, BROWN)
    g.box(0.35, 0.95, 12.6, 0.9, "① 시나리오마다 '단계 표' 장의 표만 고친다(그림은 다시 올릴 때 읽지 않는다). ② 줄을 넣거나 지워도 된다 — 번호는 다시 매긴다. ③ '누적 ms'·'결과' 칸은 참고용이라 읽지 않는다.\n④ '의견' 칸에 적은 글은 검토 의견으로 모아 시나리오 설명에 붙인다. ⑤ 시나리오 이름(시나리오: …)을 바꾸면 새 시나리오로 들어간다. ⑥ 새 시나리오는 '단계 표' 장을 복제해서 만든다.", 11.5, False, "333333", valign="t")
    g.table(0.35, 2.0, 12.6, ["종류", "대상", "조건", "값", "시간 ms", "하는 일"], GUIDE, [12, 26, 7, 16, 20, 30], 10, 0.42, "guide")
    g.box(0.35, 5.95, 12.6, 1.2, "예) 판정 | DG.status | = | 1 | 600  →  디젤이 600 ms 안에 운전 상태가 되는지 본다.\n검증 한계: 단계는 시나리오마다 30개, 시간은 10,000 ms 까지. 신호·장비 이름은 대응표에 있는 것만 쓴다(틀리면 그 시나리오는 반영하지 않고 이유를 알려 준다).", 11, False, GRAY, valign="t")
    for n, c in enumerate(cases):
        r = res.get(c["name"]); times = timeline(c, r); state = "" if r is None else ("  —  검증 통과" if r["ok"] else "  —  검증 실패"); rows = {x["step"]: x for x in (r or {}).get("rows", [])}
        tag = " · ".join(x for x in (c.get("cat", ""), c.get("ref", "")) if x); fat = f"  ▸ 실장비 시험(FAT)에서 확인할 것: {c['fat']}" if c.get("fat") else ""
        s = d.slide(); s.box(0.35, 0.25, 12.6, 0.55, f"{n + 1}. {c['name']}{state}", 22, True, BROWN if r is None or r["ok"] else RED).box(0.35, 0.82, 12.6, 0.55, (f"[{tag}] " if tag else "") + c.get("note", "") + fat, 10.5, False, GRAY, valign="t"); _diagram(s, c, r, times)
        body = []
        for i, st in enumerate(c["steps"]):
            x = rows.get(i); out = "" if x is None else (RESULT[x["state"]] + (f" · 관측 {x['actual']}" if x.get("actual") is not None else ""))
            body.append([i + 1] + row_of(st) + [f"{times[i]:,}", out, ""])
        for k in range(0, len(body), ROWS_PER_SLIDE):
            t = d.slide(); t.box(0.35, 0.25, 12.6, 0.5, f"시나리오: {c['name']}", 18, True, BROWN, name="scn-name").box(0.35, 0.78, 12.6, 0.5, f"설명: {c.get('note', '')}", 10.5, False, GRAY, name="scn-note", valign="t")
            t.table(0.35, 1.4, 12.6, HEAD, body[k:k + ROWS_PER_SLIDE], WIDTHS, 10, 0.35, "scn-steps"); t.box(0.35, 7.05, 12.6, 0.3, f"단계 표 {k // ROWS_PER_SLIDE + 1} / {(len(body) - 1) // ROWS_PER_SLIDE + 1}  ·  이 표를 고쳐서 다시 올린다", 9, False, GRAY)
    return d.to_bytes()


def _rows(case, tab, errors, comments):
    """단계 표 하나를 읽어 시나리오에 붙인다."""
    for r in tab[1:]:
        cells = [c.strip() for c in r] + [""] * 9
        if not any(cells[1:6]): continue
        try: case["steps"].append(step_of(cells[1:6]))
        except ValueError as e: errors.append({"name": case["name"], "row": len(case["steps"]) + 1, "why": str(e)}); case["steps"].append(None)
        if cells[8]: comments.append({"name": case["name"], "step": len(case["steps"]), "text": cells[8][:300]})


def parse(body):
    """고친 pptx 에서 시나리오를 읽는다. 반환: {cases: [{name, note, steps}], errors: [{name, row, why}], comments: [{name, step, text}]}"""
    cases = {}; errors = []; comments = []
    for sl in pptx.read(body):
        name = next((t.split(":", 1)[1].strip() for _, t in sl["texts"] if t.startswith("시나리오:")), None); note = next((t.split(":", 1)[1].strip() for _, t in sl["texts"] if t.startswith("설명:")), "")
        tabs = [t for t in sl["tables"] if t and len(t[0]) >= 6 and t[0][0].strip() == "번호" and t[0][1].strip() == "종류"]
        if not name or not tabs: continue
        case = cases.setdefault(name[:80], {"name": name[:80], "note": note[:400], "steps": []})
        for tab in tabs: _rows(case, tab, errors, comments)
    return {"cases": list(cases.values()), "errors": errors, "comments": comments}


def import_(body, pts, devices, profile=None):
    """읽고 검사한다. 틀린 시나리오는 빼고 이유를 돌려준다."""
    from . import scenarios, scenextra                 # pylint: disable=import-outside-toplevel — scenarios 가 engine 을 부르는 돌려 부르기를 피한다
    d = parse(body); allp = scenextra.merge(pts, scenextra.load(profile) if profile else scenextra.empty()); by = {p["tag"]: p for p in allp}; cmds = scenarios.catalog(allp, devices)["commands"]; bad = {e["name"] for e in d["errors"]}; good = []
    if not d["cases"]: raise ValueError("시나리오 단계 표를 찾지 못했습니다. EMS 가 낸 시퀀스 문서(pptx)인지 확인하십시오")
    for c in d["cases"]:
        if c["name"] in bad: continue
        if not 1 <= len(c["steps"]) <= scenarios.MAX_STEPS: d["errors"].append({"name": c["name"], "row": 0, "why": f"단계는 1~{scenarios.MAX_STEPS}개여야 합니다"}); continue
        try:
            for i, s in enumerate(c["steps"]):
                try: scenarios.validate_step(s, by, cmds, len(c["steps"]) - i - 1)
                except Exception as e: raise ValueError(f"{i + 1}|{e}") from e          # pylint: disable=broad-except — 통신 부호화 오류(ModbusError)도 같은 식으로 알린다
        except ValueError as e:
            row, why = str(e).split("|", 1); d["errors"].append({"name": c["name"], "row": int(row), "why": why}); continue
        notes = [f"[검토 의견] {m['step']}단계: {m['text']}" for m in d["comments"] if m["name"] == c["name"]]
        if notes: c["note"] = (c["note"] + " " + " ".join(notes))[:400]
        good.append(c)
    return {"ok": True, "cases": good[:scenarios.MAX_CASES * 2], "errors": d["errors"], "comments": d["comments"], "found": len(d["cases"])}


def http_post(hd, eng, p):
    """POST /api/scenarios/pptx (JSON → pptx) · /api/scenarios/import (pptx 원본 → JSON). 가상 장치 모드의 엔지니어 권한."""
    from . import scenarios                            # pylint: disable=import-outside-toplevel
    if not eng.sim: return hd._err(403, "시나리오는 가상 장치 모드에서 다룹니다")          # pylint: disable=protected-access
    if hd._sess("engineer") is None: return None                                         # pylint: disable=protected-access
    n = int(hd.headers.get("Content-Length") or 0)
    if not 0 < n <= pptx.MAX_FILE: return hd._err(413, "본문 길이 오류(8 MB 까지)")        # pylint: disable=protected-access
    raw = hd.rfile.read(n)
    if p.endswith("/import"): return hd._send(200, import_(raw, eng.rt.pts, eng.cfg["devices"], eng.cfg_path))     # pylint: disable=protected-access
    import json                                        # pylint: disable=import-outside-toplevel
    b = json.loads(raw.decode("utf-8")); cases = b["cases"]; res = None
    if b.get("verify") is True: res = scenarios.verify(cases, eng.rt.pts, eng.cfg["devices"], profile=eng.cfg_path)["results"]
    else: scenarios_check(cases)
    from .engdefs import PKG_REV                        # pylint: disable=import-outside-toplevel
    return hd._send(200, export(cases, res, PKG_REV, eng.rt.site.name), "application/vnd.openxmlformats-officedocument.presentationml.presentation", {"Content-Disposition": "attachment; filename=EMS_sequence.pptx"})     # pylint: disable=protected-access


def scenarios_check(cases):
    if not isinstance(cases, list) or not 1 <= len(cases) <= 64: raise ValueError("시나리오를 1~64개 고르십시오")
    for c in cases:
        if not isinstance(c.get("name"), str) or not isinstance(c.get("steps"), list) or not all(isinstance(s, dict) and s.get("type") in KIND for s in c["steps"]): raise ValueError("시나리오 형식 오류")
