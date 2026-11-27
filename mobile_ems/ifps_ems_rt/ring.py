# -*- coding: utf-8 -*-
"""환망(고리 모양 배전) 감시: 구간분전함(FSU)과 휴대용 배전체계(PPDU)의 신호로 구간·마디 상태를 판단하고, 자리마다 읽은 장치 ID 로 배치를 스스로 알아낸다.

  자동 인식(auto, 기본): 작전지마다 장치를 놓는 자리와 대수가 달라지므로, 화면 조작 없이 TPCS 가 배치를 알아낸다.
  · 자리(FSU1‥, PPDU1‥)는 통신 순서 = 고리에서 전원에 가까운 순서다. 자리마다 읽은 ID 가 그 자리에 놓인 장치다 — 이름·회로 구성은 ID 를 따라간다.
  · ID 가 0 인 자리는 비어 있는 것으로 보고 화면·경보에서 뺀다(대수가 달라도 된다). 처음 보는 ID 는 새 장치로 바로 넣는다.
  · 배전체계가 어느 구간분전함에 물렸는지는 PPDUk.up(상위 구간분전함의 ID)으로 안다. 이 신호가 없으면 목록의 값(at)을 쓴다.
  · ID 의 윗자리(0x46 = FSU, 0x50 = PPDU)로 종류를 가린다. ID 체계와 PPDUk.up 신호는 가정이다 — 실제 장치의 사양이 정해지면 맞춘다.

  모선 A ─[RING.sw0]─ FSU1 ─[FSU1.sw]─ FSU2 ─[FSU2.sw]─ … ─ FSUn ─[FSUn.sw]─ 모선 B      (고리의 양 끝이 배전반의 두 모선에 하나씩 물린다)
  · FSU(구간분전함): 고리의 마디. 신호 FSUk.id(장치 ID) · FSUk.v(마디 전압) · FSUk.sw(다음 구간으로 나가는 개폐기: 0 개방 · 1 투입 · 2 차단)
  · PPDU(20 kW급 초경량 휴대용 배전체계, PPDU-20): FSU 에서 받아 시설 부하로 나누어 준다(전력 흐름: ⑥ 배전체계 → FSU → PPDU → 6회로 → 시설 부하).
    주 차단기(MCCB 40 A) 아래 분기 6회로 — CH1·CH2 3상 16 A(10.5 kW), CH3~CH6 단상 20 A(4.4 kW). CH2 는 PPDU 끼리의 환상 연결용.
    신호 PPDUk.id · .v · .kw · .mccb(주 차단기) · .gnd(접지저항 Ω) · .lamp(상태등 0 정상·1 경보·2 고장) · .ch1~.ch6(회로 차단기) · .ch1_kw~.ch6_kw.
    어느 FSU 에 붙이는지, 회로마다 어떤 시설을 물리고 몇 등급 부하인지는 현장에서 고른다(1등급이 물린 PPDU 가 중요 부하).
  · 평소에는 한 구간(상시 개방점, open = 구간 번호)을 열어 둔다. 한 구간이 끊어지면 그 구간을 떼어 내고 상시 개방점을 닫아 반대쪽에서 보낸다.
실제 구간 차단·절체는 보호·배전 자동화 장치가 한다. TPCS 는 대응표의 신호로 상태를 감시하고 경보를 낸다.
이 파일은 통신을 하지 않는 계산 함수와, 가상 장치에서 환망을 흉내 내는 Model 을 담는다.
"""
import re

ID = re.compile(r"^(FSU|PPDU)[1-9][0-9]?$")
V_LIVE = 300.0                   # 이 전압(V) 이상이면 그 마디에 전기가 들어온 것으로 본다
MAX_FSU, MAX_PPDU = 12, 18       # 배전체계 18대는 제안 발표 자료의 PPDU-20 수량
KIND = {0x46: "FSU", 0x50: "PPDU"}       # 장치 ID 의 윗자리로 종류를 가린다(가정)
KNAME = {"FSU": "구간분전함", "PPDU": "배전체계"}
PLAIN = re.compile(r"^배전체계( \d+| \(ID \d+\))$")      # 따로 이름을 붙이지 않은 배전체계 — 부하 앞에 붙으면 그 부하의 이름으로 부른다
RATED_KW = 20.0                  # PPDU-20 정격
FSU_A, FSU_V, FSU_PF, FSU_OUT = 630.0, 380.0, 0.9, 4      # 구간분전함 정격: AC 380 V 3상 4선식 · 630 A · 출력 4회로(제안 발표 원본의 FSU 사양). 역률 0.9 는 kW 로 견주려는 가정
FSU_KVA = round(3 ** 0.5 * FSU_V * FSU_A / 1000.0)        # 약 415 kVA
FSU_KW = round(FSU_KVA * FSU_PF)                          # 약 373 kW — 아래 배전체계 · 부하의 합이 넘으면 과부하
# 정격과 가정값(runtime.json 의 ring.spec 으로 고친다). (기본값, 아래 한계, 위 한계, 근거, 설명) — 근거가 '가정'인 값은 실장비 사양이 정해지면 고친다
SPEC = {"fsu_a": (FSU_A, 50.0, 2000.0, "문서", "구간분전함 · 환망 간선의 정격 전류(A)"), "fsu_v": (FSU_V, 200.0, 480.0, "문서", "정격 전압(V, 3상)"), "fsu_out": (FSU_OUT, 1, 12, "문서", "구간분전함의 출력 회로 수(배전체계 한 대가 하나를 쓴다)"),
        "ppdu_kw": (RATED_KW, 5.0, 100.0, "문서", "배전체계 한 대의 정격(kW)"), "pf": (FSU_PF, 0.7, 1.0, "가정", "전류 정격을 kW 로 견줄 때의 역률"),
        "ppdu_use": (1.0, 0.5, 1.0, "가정", "배전체계를 여러 대 나란히 쓸 때 한 대에 싣는 몫(1 = 정격까지, 0.8 = 정격의 80%까지 — 전류 분담이 고르지 않을 것에 대비한 여유)"),
        "n1": (1, 0, 1, "설계", "1등급 부하 앞에 배전체계를 한 대 더 둔다(N+1: 한 대가 고장 나도 남은 것으로 정격을 감당. 1 = 둔다)"),
        "bypass": (1, 0, 1, "설계", "1등급 부하의 배전체계에 우회 결선(둘째 입력 — 반대쪽 급전의 구간분전함에서, 평소 열림 · 우회 때만 닫힘)을 둔다(1 = 둔다)"),
        "bypass_a": (16.0, 6.0, 125.0, "문서", "우회 결선 한 줄의 회로 정격(A) — PPDU-20 의 환상 연결 회로 CH-2(3상 16 A). kW 로는 역률을 곱해 본다"),
        "sts": (1, 0, 1, "가정", "우회 결선을 STS(10 ms)로 넘기는가(1 = 끊김 없이 넘긴다, 0 = 5초 이내 우회 — 그동안 끊긴다)")}
BYPASS_S = 5.0                   # STS 가 없을 때 우회 결선이 닫히기까지(PPDU-20 자료의 '5초 이내 우회')


def spec(r):
    """환망의 정격 · 가정값(설정의 spec 으로 덮어쓴 것)과 거기서 나온 값: fsu_kva · fsu_kw(환망 간선의 한계), ppdu_ok(배전체계 한 대에 싣는 한계 kW)."""
    o = (r or {}).get("spec") if isinstance((r or {}).get("spec"), dict) else {}
    s = {k: (o[k] if _int_in(o.get(k), v[1], v[2]) else v[0]) for k, v in SPEC.items()}
    s["fsu_out"] = int(s["fsu_out"]); s["sts"] = int(s["sts"]); s["n1"] = int(s["n1"]); s["bypass"] = int(s["bypass"]); s["fsu_kva"] = round(3 ** 0.5 * s["fsu_v"] * s["fsu_a"] / 1000.0); s["fsu_kw"] = round(s["fsu_kva"] * s["pf"]); s["ppdu_ok"] = round(s["ppdu_kw"] * s["ppdu_use"], 2); s["bypass_kw"] = round(3 ** 0.5 * s["fsu_v"] * s["bypass_a"] * s["pf"] / 1000.0, 2)      # 16 A · 역률 0.9 → 약 9.5 kW(역률 1 이면 자료의 10.5 kW)
    return s
LOAD_REF = 60.0                  # 가상 장치: 등급별 부하가 이 값(kW)일 때 회로가 정격의 90% 를 쓴다고 본다
GND_LIMIT = 100.0                # 접지저항이 이 값(Ω)을 넘으면 주회로 투입 금지(인터록 IL-1)
CH_SPEC = (("3상 16 A", 10.5), ("3상 16 A", 10.5), ("단상 20 A", 4.4), ("단상 20 A", 4.4), ("단상 20 A", 4.4), ("단상 20 A", 4.4))      # CH1~CH6 정격(형식, kW)
CH_DEFAULT = ((3, ""), (0, "환상 연결"), (1, ""), (1, ""), (2, ""), (3, ""))                                                              # 기본 부하 등급(0 = 환상 연결용·미사용)


def _ch(names):
    return [{"name": n or d[1], "cls": d[0]} for n, d in zip(names, CH_DEFAULT)]


DEFAULT = {"enabled": True, "auto": True, "fsu_slots": 7, "ppdu_slots": 18, "name": "부하 환망", "open": 4, "trip_ms": 100, "close_ms": 2500,      # 선택 차단 100 ms(GOOSE 블로킹) + 절체 2.5초 = 2.6초 — 원본의 '2등급 FDIR 3초 이내 복구' 안
           "fsu": [{"id": f"FSU{k}", "code": 0x4600 + k, "name": f"구간분전함 {k}"} for k in range(1, 8)],
           "ppdu": [{"id": "PPDU1", "code": 0x5001, "at": "FSU2", "name": "배전체계 1", "ch": _ch(("예비 동력", "", "지휘소", "통신소", "상황실 조명", "생활 전열"))},
                    {"id": "PPDU2", "code": 0x5002, "at": "FSU4", "name": "배전체계 2", "ch": _ch(("의무 장비", "", "수술·처치", "의무 통신", "경계 조명", "생활 전열"))},
                    {"id": "PPDU3", "code": 0x5003, "at": "FSU6", "name": "배전체계 3", "ch": _ch(("정비 동력", "", "정비 통신", "공구 충전", "작업 조명", "생활 전열"))}]}


def settings(cfg):
    """설정을 채운다. 없으면 환망을 쓰지 않는다(None)."""
    if not isinstance(cfg, dict) or not cfg.get("enabled", True) or not cfg.get("fsu"): return None
    r = dict(DEFAULT, **cfg)
    for p in r["ppdu"]:
        ch = p.get("ch") if isinstance(p.get("ch"), list) else []
        p["ch"] = [{"name": str((ch[i] if i < len(ch) else {}).get("name", d[1]))[:20], "cls": (ch[i] if i < len(ch) else {}).get("cls", d[0])} for i, d in enumerate(CH_DEFAULT)]
    return r


def _check_units(fsu, ppdu, bad):
    """장치 이름·붙는 곳·부하·ID 검사."""
    ids = [x.get("id") for x in fsu + ppdu]; names = {x.get("id") for x in fsu}
    if any(not isinstance(i, str) or not ID.fullmatch(i) for i in ids) or len(set(ids)) != len(ids): bad.append("ring: 장치 이름은 FSU1·PPDU1 꼴이고 겹치지 않아야 함")
    for p in ppdu:
        if p.get("at") not in names: bad.append(f"ring.ppdu {p.get('id')}: 붙는 곳(at)은 FSU 중 하나")
        ch = p.get("ch", [])
        if not isinstance(ch, list) or len(ch) > 6 or any(not isinstance(c, dict) or c.get("cls", 0) not in (0, 1, 2, 3) for c in ch): bad.append(f"ring.ppdu {p.get('id')}: 회로(ch)는 6개까지, 등급(cls)은 0~3")
    for x in fsu + ppdu:
        c = x.get("code", 0)
        if isinstance(c, bool) or not isinstance(c, int) or not 0 <= c <= 65535: bad.append(f"ring {x.get('id')}: 장치 ID(code)는 0~65535 의 정수")


def _int_in(v, lo, hi):
    return not isinstance(v, bool) and isinstance(v, (int, float)) and lo <= v <= hi


def _check_spec(sp, bad):
    """정격 · 가정값(ring.spec)의 범위 검사."""
    if not isinstance(sp, dict) or any(k not in SPEC or not _int_in(v, SPEC[k][1], SPEC[k][2]) for k, v in sp.items()): bad.append("ring.spec: " + ", ".join(f"{k} {v[1]:g}~{v[2]:g}" for k, v in SPEC.items()))


def check(cfg, bad):
    """runtime.json 의 ring 검사."""
    if cfg is None: return
    if not isinstance(cfg, dict): bad.append("ring: 객체여야 함"); return
    fsu, ppdu = cfg.get("fsu", []), cfg.get("ppdu", [])
    if not isinstance(fsu, list) or not isinstance(ppdu, list) or len(fsu) > MAX_FSU or len(ppdu) > MAX_PPDU or not all(isinstance(x, dict) for x in fsu + ppdu): bad.append(f"ring: fsu 는 {MAX_FSU}개, ppdu 는 {MAX_PPDU}개까지의 목록"); return
    _check_units(fsu, ppdu, bad)
    if fsu and not (isinstance(cfg.get("open", 0), int) and _int_in(cfg.get("open", 0), 0, len(fsu))): bad.append("ring.open: 상시 개방점은 0 ~ FSU 개수 사이의 구간 번호")
    _check_spec(cfg.get("spec", {}), bad)
    for k, hi in (("trip_ms", 5000), ("close_ms", 10000)):
        if not _int_in(cfg.get(k, 0), 0, hi): bad.append(f"ring.{k}: 0~{hi} ms")
    if not isinstance(cfg.get("auto", True), bool) or not _int_in(cfg.get("fsu_slots", 1), 1, MAX_FSU) or not _int_in(cfg.get("ppdu_slots", 1), 1, MAX_PPDU): bad.append(f"ring: auto 는 참·거짓, 자리 수(fsu_slots·ppdu_slots)는 1~{MAX_FSU}")


def _slot_units(r, g, kind, n):
    """자리마다 읽은 ID 로 그 자리에 놓인 장치를 정한다. 반환: (장치 목록, 빈 자리 목록).
    값이 아직 없는 자리는 목록의 그 순서 장치를 그대로 둔다(seen 거짓). ID 0 은 빈 자리. 목록에 없는 ID 는 새 장치(new)."""
    lst = r[kind.lower()]; cat = {x.get("code"): x for x in lst}; out = []; empty = []; used = set()
    for k in range(1, n + 1):
        sid = f"{kind}{k}"; raw = g(f"{sid}.id")
        if raw is None:
            if k <= len(lst): out.append(dict(lst[k - 1], id=sid, slot=k, seen=False, new=False, bad=""))
            continue
        code = int(round(raw))
        if code == 0: empty.append(sid); continue
        other = KIND.get(code >> 8); bad = "같은 ID 가 다른 자리에도 있음" if code in used else f"{KNAME[other]}의 ID — 종류가 다른 장치" if other not in (None, kind) else ""
        used.add(code); base = cat.get(code) or {"name": f"{KNAME[kind]} (ID {code})"}
        out.append(dict(base, id=sid, slot=k, code=code, seen=True, new=code not in cat, bad=bad))
    return out, empty


def layout(r, g):
    """지금 놓인 배치(자동 인식). 설정 r 의 fsu·ppdu 는 '아는 장치 목록'이고, 반환값의 fsu·ppdu 는 자리 순서대로 지금 있는 장치다."""
    if r.get("eff") or not r.get("auto", True): return r
    fsu, e1 = _slot_units(r, g, "FSU", r.get("fsu_slots", len(r["fsu"]))); ppdu, e2 = _slot_units(r, g, "PPDU", r.get("ppdu_slots", len(r["ppdu"])))
    by = {f["code"]: f["id"] for f in fsu if f["seen"]}; ids = {f["id"] for f in fsu}
    for p in ppdu:
        up = g(f"{p['id']}.up") if p["seen"] else None
        if up is not None: p["at"] = by.get(int(round(up)), ""); p["at_auto"] = True
        elif p.get("at") not in ids: p["at"] = ""
        if not isinstance(p.get("ch"), list): p["ch"] = _ch(("",) * 6)
    sw = ["RING.sw0"] + [f"{f['id']}.sw" for f in fsu]; want = f"FSU{r['open']}.sw" if r["open"] else "RING.sw0"
    op = sw.index(want) if want in sw else next((i for i, t in enumerate(sw) if g(t) is not None and int(round(g(t))) == 0), len(sw) - 1)     # 상시 개방점 자리가 비었으면 지금 열려 있는 구간을 개방점으로 본다
    return dict(r, fsu=fsu, ppdu=ppdu, open=op, eff=True, empty=e1 + e2)


def sw_tags(r):
    """구간 개폐기 신호 이름: 구간 0 은 전원 쪽(RING.sw0), 구간 k 는 FSUk 다음(FSUk.sw)."""
    return ["RING.sw0"] + [f"{f['id']}.sw" for f in r["fsu"]]


def tags(r):
    """환망이 쓰는 신호 이름 전부(대응표에 있어야 TPCS 가 본다)."""
    out = sw_tags(r) + ["RING.auto"]
    for f in r["fsu"]: out += [f"{f['id']}.id", f"{f['id']}.v"]
    for p in r["ppdu"]: out += [f"{p['id']}.{k}" for k in ("id", "v", "kw", "mccb", "gnd", "lamp") + (("up",) if p.get("at_auto") else ())] + [f"{p['id']}.ch{n}{x}" for n in range(1, 7) for x in ("", "_kw")]
    return out


def meter_tags(r):
    """분기 전력계 신호(구간분전함의 전력 · 전력량, 배전체계와 회로의 전력량). 없어도 감시는 되지만 분기별 전력량과 예측의 정밀도가 떨어진다."""
    return [f"{f['id']}.{k}" for f in r["fsu"] for k in ("kw", "kwh")] + [f"{p['id']}.kwh" for p in r["ppdu"]] + [f"{p['id']}.ch{n}_kwh" for p in r["ppdu"] for n in range(1, 7)]


def _fed(ok, n):
    """구간이 이어졌는지(ok)로 마디마다 전원까지 닿는지: 왼쪽으로든 오른쪽으로든 닿으면 참."""
    return [all(ok[:k + 1]) or all(ok[k + 1:]) for k in range(n)]


def _unit(x, g, fed=None):
    """장치 하나의 읽은 값: 전압·공급 여부·ID."""
    v = g(f"{x['id']}.v"); idr = g(f"{x['id']}.id"); idr = None if idr is None else int(round(idr))
    ok = None if idr is None else (not x["bad"] if "seen" in x else idr == x.get("code", 0))                # 자동 인식이면 읽은 ID 가 곧 그 장치다(겹치거나 종류가 다를 때만 문제)
    return {"id": x["id"], "name": x.get("name", x["id"]), "v": v, "live": None if v is None else v >= V_LIVE, "id_read": idr, "code": x.get("code", 0), "id_ok": ok, "fed": fed, "new": bool(x.get("new")), "bad": x.get("bad", "")}


def _ppdus(r, g, fsu_live):
    """배전체계(PPDU)들의 읽은 값: 주 차단기·접지저항·상태등·회로 6개, 붙은 구간분전함이 살아 있는지."""
    out = []
    for p in r["ppdu"]:
        st = lambda t, i=p["id"]: None if g(f"{i}.{t}") is None else int(round(g(f"{i}.{t}")))
        ch = [{"n": n + 1, "name": c["name"], "cls": c["cls"], "type": CH_SPEC[n][0], "limit": CH_SPEC[n][1], "cb": st(f"ch{n + 1}"), "kw": g(f"{p['id']}.ch{n + 1}_kw"), "kwh": g(f"{p['id']}.ch{n + 1}_kwh")} for n, c in enumerate(p["ch"])]
        kw = g(f"{p['id']}.kw"); gnd = g(f"{p['id']}.gnd")
        out.append(dict(_unit(p, g), at=p["at"], at_auto=bool(p.get("at_auto")), kw=kw, kwh=g(f"{p['id']}.kwh"), mccb=st("mccb"), gnd=gnd, lamp=st("lamp"), ch=ch, vital=any(c["cls"] == 1 for c in p["ch"]), at_live=fsu_live.get(p["at"]),
                        over=None if kw is None else kw > spec(r)["ppdu_kw"], gnd_bad=None if gnd is None else gnd > GND_LIMIT))
    return out


def _fsus(r, g, fed):
    """구간분전함들의 읽은 값. kw · kwh 는 그 구간분전함의 분기 전력계다."""
    return [dict(_unit(f, g, fed[k]), kw=g(f"{f['id']}.kw"), kwh=g(f"{f['id']}.kwh"), over=None if g(f"{f['id']}.kw") is None else g(f"{f['id']}.kw") > spec(r)["fsu_kw"]) for k, f in enumerate(r["fsu"])]


def _recog(r, units):
    """자동 인식 요약: 쓰는지, 빈 자리, 처음 보는 장치."""
    return {"auto": bool(r.get("eff")), "empty": r.get("empty", []), "new": [x["id"] for x in units if x["new"]]}


def _comm(secs, fsu):
    """구간분전함마다 통신이 닿는지(comm)를 적는다. 통신선은 전력 케이블과 같은 경로의 고리다: 차단된(끊긴) 구간만 막히고 상시 개방점은 지나간다."""
    n = len(fsu); link = _fed([s["state"] != 2 for s in secs], n) if all(s["state"] is not None for s in secs) else [None] * n
    for k, f in enumerate(fsu): f["comm"] = link[k]


def status(r, val, lost=False):
    """지금 상태. val: 신호 값(없으면 None). lost: 그 신호를 가져오는 통신이 끊겼는지.
    반환: {sections: [{i, tag, state, open}], fsu: [{id, name, v, live, id_read, id_ok, fed}], ppdu: [...], ok, switched, isolated, missing}"""
    g = (lambda t: None) if lost else val.get; r = layout(r, g); n = len(r["fsu"]); sw = sw_tags(r)
    secs = [{"i": i, "tag": t, "state": None if g(t) is None else int(round(g(t))), "open": i == r["open"]} for i, t in enumerate(sw)]
    fed = _fed([s["state"] == 1 for s in secs], n) if all(s["state"] is not None for s in secs) else [None] * n
    fsu = _fsus(r, g, fed); auto = g("RING.auto")
    _comm(secs, fsu)
    ppdu = _ppdus(r, g, {f["id"]: f["live"] for f in fsu})
    return {"name": r["name"], "sections": secs, "fsu": fsu, "ppdu": ppdu, "open": r["open"], "auto": None if auto is None else auto > 0.5,
            "ok": n > 0 and all(f["live"] for f in fsu), "switched": bool(secs) and secs[r["open"]]["state"] == 1,
            "isolated": [f["id"] for f in fsu if f["live"] is False], "cut": [s["i"] for s in secs if s["state"] == 2], "missing": [t for t in tags(r) if val.get(t) is None], "meters_missing": [t for t in meter_tags(r) if val.get(t) is None], "eff": r, "recog": _recog(r, fsu + ppdu)}


def _found(s):
    """자동 인식 결과: 자리 순서대로 지금 있는 장치와 빈 자리."""
    out = []
    def row(kind, u, where):
        st = "무응답" if u["id_read"] is None else "확인 필요" if u["bad"] else "인식"
        out.append({"seq": len(out) + 1, "kind": kind, "id": u["id"], "name": u["name"], "where": where, "expect": None, "read": u["id_read"], "state": st, "hint": u["bad"] or ("처음 보는 장치 — 바로 넣었습니다" if u["new"] else ""), "v": u["v"]})
    for k, f in enumerate(s["fsu"]):
        row("FSU", f, f"고리의 {k + 1}번째 마디")
        for p in s["ppdu"]:
            if p["at"] == f["id"]: row("PPDU", p, f"{f['name']}({f['id']})에 연결" + (" · 1등급 부하 있음" if p["vital"] else ""))
    for p in s["ppdu"]:
        if not p["at"]: row("PPDU", dict(p, bad=p["bad"] or "어느 구간분전함에 물렸는지 알 수 없음"), "연결 미확인")
    for sid in s["recog"]["empty"]: out.append({"seq": len(out) + 1, "kind": "FSU" if sid.startswith("FSU") else "PPDU", "id": sid, "name": "", "where": "", "expect": None, "read": 0, "state": "비어 있음", "hint": "", "v": None})
    live = [x for x in out if x["state"] != "비어 있음"]; bad = sum(1 for x in live if x["state"] != "인식")
    return {"rows": out, "ok": bad == 0 and bool(live), "n": len(live), "bad": bad, "auto": True, "fsu": len(s["fsu"]), "ppdu": len(s["ppdu"]), "empty": len(s["recog"]["empty"])}


def discover(r, val, lost=False):
    """초기 기동 점검: 전원에서 가까운 순서(고리 순서)로 FSU 를 확인하고, FSU 마다 거기 붙은 PPDU 를 확인한다.
    자동 인식이면 자리마다 읽은 ID 로 알아낸 배치를 돌려준다(state: 인식 · 확인 필요 · 무응답 · 비어 있음).
    고정 배치(auto 거짓)면 [{seq, kind, id, name, where, expect, read, state}] — state: 일치 · 불일치 · 무응답. 불일치이고 다른 장치의 ID 와 같으면 '자리 바뀜'으로 알려 준다."""
    s = status(r, val, lost); codes = {x["code"]: x["id"] for x in s["fsu"] + s["ppdu"]}; out = []
    if s["recog"]["auto"]: return _found(s)
    def row(kind, u, where):
        st = "무응답" if u["id_read"] is None or u["id_read"] == 0 else "일치" if u["id_ok"] else "불일치"
        hint = f" — {codes[u['id_read']]} 의 ID 입니다(자리가 바뀌었는지 확인)" if st == "불일치" and u["id_read"] in codes else ""
        out.append({"seq": len(out) + 1, "kind": kind, "id": u["id"], "name": u["name"], "where": where, "expect": u["code"], "read": u["id_read"], "state": st, "hint": hint, "v": u["v"]})
    for k, f in enumerate(s["fsu"]):
        row("FSU", f, f"고리의 {k + 1}번째 마디")
        for p in s["ppdu"]:
            if p["at"] == f["id"]: row("PPDU", p, f"{f['id']} 에 연결" + (" · 1등급 부하 있음" if p["vital"] else ""))
    return {"rows": out, "ok": all(x["state"] == "일치" for x in out), "n": len(out), "bad": sum(1 for x in out if x["state"] != "일치")}


def _dead_text(p):
    return f"{p['name']}({p['id']}) 무전압 — " + (f"{p['at']} 는 살아 있음. " if p["at_live"] else "") + "입력 케이블·주 차단기 확인"


def _id_text(u):
    return f"{u['id']} 자리의 장치 ID {u['id_read']} — {u['bad']}" if u["bad"] else f"{u['id']} 장치 ID 불일치(기대 {u['code']}, 읽음 {u['id_read']}) — 설치 위치 확인"


def _vital(s, f):
    """그 구간분전함에 중요 부하(1등급)가 물렸는지: 부하 목록의 표시(vital)나 물린 배전체계의 표시."""
    return bool(f.get("vital")) or any(p["vital"] for p in s["ppdu"] if p["at"] == f["id"])


def _fsu_alarms(s, f):
    """구간분전함 한 대의 경보."""
    out = []
    vital = _vital(s, f); sts = f["live"] is False and any(p["vital"] and p["live"] for p in s["ppdu"] if p["at"] == f["id"])      # 1등급 부하의 배전체계가 우회 결선으로 살아 있는가
    out.append((f"ring.dead.{f['id']}", f["live"] is False, 1 if vital else 2, f["id"], f"{f['name']}({f['id']}) 무전압 — 이 마디의 부하 정전" + (" [중요 부하]" if vital else "") + (" — 1등급 부하는 우회 결선으로 공급 중" if sts else "")))
    out.append((f"ring.comm.{f['id']}", f.get("comm") is False, 2, f["id"], f"{f['name']}({f['id']}) 통신 고립 — 양쪽 구간이 모두 끊겨 환형 통신으로도 닿지 않음(값은 마지막 값). 끊긴 구간 가운데 하나를 먼저 복구"))
    out.append((f"ring.id.{f['id']}", f["id_ok"] is False and f["id_read"] not in (None, 0), 3, f["id"], _id_text(f)))
    out.append((f"ring.over.{f['id']}", bool(f.get("over")), 2, f["id"], f"{f['name']}({f['id']}) 과부하 {f.get('kw') or 0:.1f} kW — 정격 {spec(s.get('eff'))['fsu_a']:.0f} A(약 {spec(s.get('eff'))['fsu_kw']:.0f} kW) 초과. 부하 일부를 다른 구간분전함으로 옮기십시오"))
    return out


def alarms(r, s):
    """경보 목록: [(열쇠, 발생 여부, 등급, 대상, 글)]. 값이 없는 신호는 따지지 않는다(통신 경보가 따로 난다)."""
    out = []; r = s.get("eff", r)
    for sec in s["sections"]:
        a = "전원" if sec["i"] == 0 else r["fsu"][sec["i"] - 1]["id"]; b = "전원" if sec["i"] == len(r["fsu"]) else r["fsu"][sec["i"]]["id"]
        out.append((f"ring.cut.{sec['i']}", sec["state"] == 2, 2, "환망", f"환망 구간 {sec['i']}({a} ↔ {b}) 차단 — 그 구간의 케이블·접속부 점검"))
    out.append(("ring.switched", bool(s["switched"]), 3, "환망", "환망 상시 개방점이 닫혀 있음 — 반대쪽 공급 중(다음 고장에 여유 없음). 고장 구간 복구 뒤 원래대로 되돌리십시오"))
    for f in s["fsu"]: out += _fsu_alarms(s, f)
    for p in s["ppdu"]:
        i = p["id"]; top = 1 if p["vital"] else 2
        out.append((f"ring.dead.{i}", p["live"] is False and p["at_live"] is not False, top, i, _dead_text(p)))      # 물린 구간분전함이 정전이면 그쪽 경보 하나로 충분하다
        out.append((f"ring.id.{i}", p["id_ok"] is False and p["id_read"] not in (None, 0), 3, i, _id_text(p)))
        out.append((f"ring.at.{i}", p["at_auto"] and not p["at"], 3, i, f"{p['name']}({i}) 가 어느 구간분전함에 물렸는지 알 수 없음 — 입력 케이블·통신 확인"))
        out.append((f"ring.mccb.{i}", p["mccb"] == 2, top, i, f"{p['name']}({i}) 주 차단기 트립 — 6회로 모두 정전. 단락·과부하 원인 확인"))
        out.append((f"ring.over.{i}", bool(p["over"]), 2, i, f"{p['name']}({i}) 과부하 {p['kw'] or 0:.1f} kW — 정격 {spec(r)['ppdu_kw']:.0f} kW 초과. 낮은 등급 회로부터 줄이십시오"))
        out.append((f"ring.gnd.{i}", bool(p["gnd_bad"]), 2, i, f"{p['name']}({i}) 접지저항 {p['gnd'] or 0:.0f} Ω — {GND_LIMIT:.0f} Ω 초과(주회로 투입 금지 조건). 접지봉·접지선 보강"))
        for c in p["ch"]:
            out.append((f"ring.ch.{i}.{c['n']}", c["cb"] == 2 and c["cls"] > 0, c["cls"] or 3, i, f"{p['name']}({i}) CH{c['n']} {c['name']} 회로 트립 — {c['cls']}등급 부하 정전"))
    return out


class Model:
    """가상 장치에서 환망을 움직인다(시연·교육·시나리오 검증용). 단선은 brk 에 구간 번호를 넣어 만든다(또는 모의 신호 BRK.<번호>).
    place 가 '어느 자리에 어떤 장치가 놓였는지'다 — 장치를 빼고 넣고 섞어서 자동 인식을 연습한다."""
    def __init__(self, r, plant, kw=None):
        self.r = r if r and "RING.sw0" in plant.by_tag else None; self.p = plant; self.kw = kw or {"L1": "LOAD.p1_kw", "L2": "LOAD.p2_kw", "L3": "LOAD.p3_kw"}
        self.e = {}; self.dt = 0.0; self.t_last = None                 # 분기 전력량계의 누적값 · 걸음 길이
        self.branch = None; self.w = None; self.live = {}; self.want = None; self.want_sig = None; self.alive = {}; self.t_by = {}; self.by = set()      # by: 지금 우회 결선으로 받는 배전체계              # 부하 목록의 분기별 몫(화면부가 넣는다) — 있으면 분기 전력계가 '그 자리에 물린 부하'를 따른다
        self.brk = set(); self.t_brk = {}; self.t_trip = None; self.init = set(); self.armed = False; self.swap = None; self.place = {}; self.zero = set(); self.t_fix = {}
        if self.r is None: return
        self._place0(); self._ids(); e = self.eff()
        for i, t in enumerate(sw_tags(e)): plant.set(t, 0 if i == e["open"] else 1)
        plant.set("RING.auto", 1); self._update(e)

    def _place0(self):
        """처음 배치: 목록의 순서대로 자리에 놓는다."""
        num = lambda t: int(re.sub(r"\D", "", str(t)) or 0)
        self.place = {"fsu": {k + 1: f.get("code", 0) for k, f in enumerate(self.r["fsu"])}, "ppdu": {k + 1: [p.get("code", 0), num(p.get("at"))] for k, p in enumerate(self.r["ppdu"])}}

    def _n(self, kind):
        return max(self.r.get(f"{kind}_slots", 0), len(self.r[kind]))

    def _ids(self):
        """자리마다 장치 ID 를 낸다. 빈 자리는 0. 배전체계는 물린 구간분전함의 ID(up)도 낸다."""
        f = dict(self.place["fsu"]); pp = {k: v[0] for k, v in self.place["ppdu"].items()}; put = lambda t, v: self.p.set(t, v) if t in self.p.by_tag else None
        if self.swap:                                                                    # 두 자리의 장치를 맞바꾼 상황
            (ka, a), (kb, b) = [("fsu" if x.startswith("FSU") else "ppdu", int(re.sub(r"\D", "", x))) for x in self.swap]; da, db = (f if ka == "fsu" else pp), (f if kb == "fsu" else pp); da[a], db[b] = db.get(b, 0), da.get(a, 0)
        for k in range(1, self._n("fsu") + 1): put(f"FSU{k}.id", f.get(k, 0))
        for k in range(1, self._n("ppdu") + 1): put(f"PPDU{k}.id", pp.get(k, 0)); put(f"PPDU{k}.up", f.get(self.place["ppdu"][k][1], 0) if pp.get(k) else 0)

    def eff(self):
        """지금 놓인 배치(가상 장치의 신호로 자동 인식한 결과)."""
        return layout(self.r, lambda t: self.p.get(t) if t in self.p.by_tag else None)

    def _broken(self, i):
        return i in self.brk or (f"BRK.{i}" in self.p.by_tag and self.p.get(f"BRK.{i}") > 0.5)

    def _fsu_live(self, e):
        """구간 개폐기와 단선으로 구간분전함마다 전기가 들어오는지 계산해 전압을 넣는다. 반환: {FSU: 공급 여부}"""
        sw = sw_tags(e); bus = lambda t: t not in self.p.by_tag or self.p.get(t) > V_LIVE; a, b = bus("BUS.a_v"), bus("BUS.b_v")       # 왼쪽 끝은 모선 A, 오른쪽 끝은 모선 B
        self.armed = self.armed or a or b; a, b = (a, b) if self.armed else (True, True)                                              # 모선 전압을 한 번 본 뒤부터 전원 정전을 따진다
        ok = [int(round(self.p.get(t))) == 1 and not self._broken(i) for i, t in enumerate(sw)]; live = {}
        for k, f in enumerate(e["fsu"]): live[f["id"]] = (a and all(ok[:k + 1])) or (b and all(ok[k + 1:]))
        for k in range(1, self._n("fsu") + 1):
            if f"FSU{k}.v" in self.p.by_tag: self.p.set(f"FSU{k}.v", 380.0 if live.get(f"FSU{k}") else 0.0)
        return live

    def _bypass(self, live, here):
        """우회 결선이 닫혀 있어야 하는 배전체계(self.by)를 정한다: 제 구간분전함은 죽었고 우회 쪽 구간분전함은 살아 있을 때만. 제 쪽이 돌아오면 다시 연다(두 급전을 함께 잇지 않는다).
        STS 가 있으면 바로, 없으면 BYPASS_S 뒤에 닫힌다."""
        sp = spec(self.r); alt = {x: w["alt"] for w in (self.w or []) if w.get("alt") for x in w["ppdus"]} if sp["bypass"] else {}; now = self.t_last or 0.0; on = set()
        for i, a in alt.items():
            if i not in here or live.get(here[i]["at"], False) or not live.get(a, False): self.t_by.pop(i, None); continue
            if sp["sts"] or now - self.t_by.setdefault(i, now) >= BYPASS_S: on.add(i)
        self.by = on

    def _clear(self, i):
        """빈 자리의 배전체계 신호를 0 으로."""
        if i not in self.init and i in self.zero: return                              # 이미 비운 자리는 다시 쓰지 않는다
        self.init.discard(i); self.zero.add(i)
        for t in ("v", "kw", "mccb", "gnd", "lamp") + tuple(f"ch{n}{x}" for n in range(1, 7) for x in ("", "_kw")):
            if f"{i}.{t}" in self.p.by_tag: self.p.set(f"{i}.{t}", 0)

    def _one(self, p, fed):
        """배전체계 한 대: 전압·회로별 전력·상태등."""
        i = p["id"]; P = self.p
        if i not in self.init: self.init.add(i); self.zero.discard(i); P.set(f"{i}.mccb", 1); P.set(f"{i}.gnd", 35.0); [P.set(f"{i}.ch{n}", 1) for n in range(1, 7)]
        on = fed and int(round(P.get(f"{i}.mccb"))) == 1; tot = 0.0; bad = int(round(P.get(f"{i}.mccb"))) == 2
        if f"{i}.v" in P.by_tag: P.set(f"{i}.v", 380.0 if fed else 0.0)
        mine = None if self.w is None else self._split(p)
        for n, c in enumerate(p["ch"]):
            tag = self.kw.get(f"L{c['cls']}"); closed = int(round(P.get(f"{i}.ch{n + 1}"))) == 1; bad = bad or int(round(P.get(f"{i}.ch{n + 1}"))) == 2
            if mine is not None: kw = mine[n] if on and closed else 0.0                                                                 # 부하 목록에서 이 배전체계에 물린 부하의 몫
            else: kw = CH_SPEC[n][1] * 0.9 * min(1.2, P.get(tag) / LOAD_REF) if on and closed and c["cls"] and tag in P.by_tag else 0.0      # 부하 목록이 없을 때(시나리오 검증): 그 등급 부하의 크기에 비례
            P.set(f"{i}.ch{n + 1}_kw", round(kw, 1)); tot += kw; self._meter(f"{i}.ch{n + 1}_kwh", kw)
        self._meter(f"{i}.kwh", tot); P.set(f"{i}.kw", round(tot, 1)); P.set(f"{i}.lamp", 2 if bad else 1 if tot > spec(self.r)["ppdu_kw"] or P.get(f"{i}.gnd") > GND_LIMIT or not fed else 0)

    def _feeder(self, g):
        t = self.kw.get(f"L{g}"); return self.p.get(t) if t in self.p.by_tag else 0.0

    def _split(self, p):
        """이 배전체계에 물린 부하의 전력을 회로 6개에 나눈다: 등급이 같은 회로에 회로 정격 비율로 싣고, 그 회로들의 정격을 넘는 몫은 쓰는 회로 전체에 정격 비율로 싣는다(가상 장치의 가정)."""
        out = [0.0] * len(p["ch"]); used = [n for n, c in enumerate(p["ch"]) if c["cls"] > 0] or [0]; cap = lambda ns: sum(CH_SPEC[n][1] for n in ns)
        for g in (1, 2, 3):
            kw = sum(self._feeder(g) * w["frac"] / max(1, sum(1 for x in w["ppdus"] if self.alive.get(x))) for w in self.w if p["id"] in w["ppdus"] and w["grade"] == g)      # 부하 앞에 여러 대면 살아 있는 것끼리 고르게 나눠 싣는다(한 대가 빠지면 남은 것이 떠안는다)
            if kw <= 0: continue
            tg = [n for n, c in enumerate(p["ch"]) if c["cls"] == g] or used; a = min(kw, cap(tg))
            for n in tg: out[n] += a * CH_SPEC[n][1] / cap(tg)
            for n in used: out[n] += (kw - a) * CH_SPEC[n][1] / cap(used)
        return out

    def _meter(self, tag, kw):
        """분기 전력량계(누적 kWh)를 한 걸음 올린다."""
        if tag not in self.p.by_tag: return
        self.e[tag] = self.e.get(tag, self.p.get(tag)) + max(0.0, kw) * self.dt / 3600.0; self.p.set(tag, self.e[tag])

    def _fsu_meters(self, e):
        """구간분전함의 분기 전력계: 그 구간분전함에 물린 배전체계 전력의 합 + 배전체계 없이 직결한 부하."""
        for f in e["fsu"]:
            if f"{f['id']}.kw" not in self.p.by_tag: continue
            kw = sum(self.p.get(f"{p['id']}.kw") for p in e["ppdu"] if p["at"] == f["id"] and f"{p['id']}.kw" in self.p.by_tag)
            if self.w is not None and self.live.get(f["id"]): kw += sum(self._feeder(w["grade"]) * w["frac"] for w in self.w if w["fsu"] == f["id"] and not w["ppdus"])
            self.p.set(f"{f['id']}.kw", round(kw, 1)); self._meter(f"{f['id']}.kwh", kw)

    def _update(self, e):
        """구간분전함 전압 → 배전체계(PPDU) 전압·주 차단기·회로별 전력. 회로 전력은 그 등급 부하(LOAD.pN_kw)의 크기에 비례하는 것으로 본다(가상 장치의 가정)."""
        live = self._fsu_live(e); here = {p["id"]: p for p in e["ppdu"]}; self.live = live; self.w = self.branch() if self.branch else None
        self._bypass(live, here)                                         # 1등급 부하 앞의 배전체계: 제 구간분전함이 죽으면 우회 결선(평소 열림)을 닫아 반대쪽에서 받는다
        fed = {i: bool(live.get(p["at"], False) or i in self.by) for i, p in here.items()}
        self.alive = {i: fed[i] and (i not in self.init or int(round(self.p.get(f"{i}.mccb"))) == 1) for i in here if f"{i}.mccb" in self.p.by_tag}      # 전기가 들어오고 주 차단기가 투입된 배전체계
        for k in range(1, self._n("ppdu") + 1):
            i = f"PPDU{k}"
            if f"{i}.mccb" not in self.p.by_tag: continue
            if i in here: self._one(here[i], fed[i])
            else: self._clear(i)
        self._fsu_meters(e)

    def tick(self, now):
        if self.r is None: return
        self.dt = 0.0 if self.t_last is None else min(60.0, max(0.0, now - self.t_last)); self.t_last = now
        self._follow(); self._ids(); e = self.eff(); sw = sw_tags(e); auto = self.p.get("RING.auto") > 0.5
        for i, t in enumerate(sw):
            if not self._broken(i) or int(round(self.p.get(t))) != 1: self.t_brk.pop(i, None); continue
            if not auto: continue
            t0 = self.t_brk.setdefault(i, now)
            if now - t0 >= e["trip_ms"] / 1000.0: self.p.set(t, 2); self.t_brk.pop(i, None); self.t_trip = now                 # 구간 차단
        if auto and self.t_trip is not None and now - self.t_trip >= e["close_ms"] / 1000.0:
            no = e["open"]
            if int(round(self.p.get(sw[no]))) == 0 and not self._broken(no): self.p.set(sw[no], 1)                              # 상시 개방점 투입 → 반대쪽에서 공급
            self.t_trip = None
        if auto: self._repair(e, sw, now)
        self._update(e)

    def _follow(self):
        """부하 목록이 바뀌면 배전체계를 그 목록대로 다시 놓는다(부하 앞에 필요한 대수만큼). 자리가 모자라면 앞에서부터 놓는다."""
        ws = self.want() if self.want else None
        if ws is None or tuple(ws) == self.want_sig: return
        self.want_sig = tuple(ws); fs = self.place["fsu"]; nos = [int(re.sub(r"\D", "", f) or 0) for f in ws][:self._n("ppdu")]
        self.place["ppdu"] = {k + 1: [0x5001 + k, no if no in fs else min(fs)] for k, no in enumerate(nos)}; self.init.clear()

    def _repair(self, e, sw, now):
        """복구 절차: 단선이 없어진(고친) 차단 구간을 close_ms 뒤에 다시 잇고, 고리가 모두 이어지면 상시 개방점을 다시 연다(평소 상태로)."""
        st = [int(round(self.p.get(t))) for t in sw]; no = e["open"]
        for i, t in enumerate(sw):
            if st[i] != 2 or self._broken(i): self.t_fix.pop(i, None); continue
            if now - self.t_fix.setdefault(i, now) >= e["close_ms"] / 1000.0: self.p.set(t, 0 if i == no else 1); st[i] = 0 if i == no else 1; self.t_fix.pop(i, None)
        if st[no] == 1 and all(x == 1 for x in st) and not any(self._broken(i) for i in range(len(sw))) and self.t_trip is None: self.p.set(sw[no], 0)      # 모두 이어졌으면 개방점을 되돌린다

    def remove(self, sid):
        """그 자리의 장치를 뺀다. 빼는 구간분전함의 개폐기가 열려 있었으면(상시 개방점) 앞 구간을 대신 연다."""
        kind = "fsu" if sid.startswith("FSU") else "ppdu"; k = int(re.sub(r"\D", "", sid))
        if k not in self.place[kind]: raise ValueError("그 자리에 장치가 없습니다")
        if kind == "fsu":
            if len(self.place["fsu"]) <= 1: raise ValueError("구간분전함은 한 대 이상 있어야 합니다")
            sw = sw_tags(self.eff()); i = sw.index(f"FSU{k}.sw") if f"FSU{k}.sw" in sw else 0
            if i and int(round(self.p.get(sw[i]))) == 0: self.p.set(sw[i - 1], 0)
        del self.place[kind][k]

    def add(self, kind, at=0):
        """빈 자리에 새 장치를 놓는다(처음 보는 ID). 배전체계는 at 번째 자리의 구간분전함에 물린다."""
        pl = self.place[kind]; k = next((i for i in range(1, self._n(kind) + 1) if i not in pl), None)
        if k is None: raise ValueError("빈 자리가 없습니다")
        used = set(self.place["fsu"].values()) | {v[0] for v in self.place["ppdu"].values()}; base = 0x4600 if kind == "fsu" else 0x5000; code = next(c for c in range(base + 21, base + 250) if c not in used)
        if kind == "fsu": pl[k] = code; self.p.set(f"FSU{k}.sw", 1)
        else: pl[k] = [code, at if at in self.place["fsu"] else min(self.place["fsu"])]

    def shuffle(self):
        """놓인 자리를 뒤섞는다: 구간분전함은 순서를 거꾸로, 배전체계는 한 자리씩 민다(이름·회로 구성이 ID 를 따라가는지 보는 연습)."""
        f = self.place["fsu"]; ks = sorted(f); f.update(dict(zip(ks, [f[k] for k in reversed(ks)])))
        pp = self.place["ppdu"]; ks = sorted(pp); codes = [pp[k][0] for k in ks]
        for k, c in zip(ks, codes[1:] + codes[:1]): pp[k][0] = c
        self.init.clear()

    def move_open(self):
        """상시 개방점 설정이 바뀌었을 때: 고장(단선 · 차단)이 없으면 새 상시 개방점만 열고 나머지 구간을 닫는다. 고장 중이면 건드리지 않는다(복구 뒤 restore 가 맞춘다)."""
        if self.r is None or self.brk: return
        e = self.eff()
        for i, t in enumerate(sw_tags(e)): self.p.set(t, 0 if i == e["open"] else 1)

    def restore(self):
        """고장을 없애고 처음 상태(처음 배치, 상시 개방점만 열림)로 되돌린다."""
        if self.r is None: return
        self.brk.clear(); self.swap = None; self.t_trip = None; self.want_sig = None; self.t_brk.clear(); self.t_fix.clear(); self._place0(); self._ids(); e = self.eff()
        for i, t in enumerate(sw_tags(e)): self.p.set(t, 0 if i == e["open"] else 1)
        self.p.set("RING.auto", 1); self.init.clear()
