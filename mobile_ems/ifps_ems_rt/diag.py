# -*- coding: utf-8 -*-
"""현장 간편 진단 도구. 제어화면 없이 노트북 한 대로 장비 통신을 단계별로 점검하고 원인·조치를 알려 준다.

  python -m ifps_ems_rt.diag                       차림표(메뉴) 방식. 번호만 누르면 된다
  python -m ifps_ems_rt.diag --auto                전 장비 자동 진단 1회 + 보고서 저장 (종료 코드 0 정상 / 1 주의 / 2 이상)
  python -m ifps_ems_rt.diag --auto --device ESS   한 장비만
  python -m ifps_ems_rt.diag --demo                내장 가상 장치로 시연·교육(실장비 불필요)

자동 진단 단계(경로 A·B 각각): ① 허용 목록 ② TCP 접속 ③ 장치 번호 응답 ④ 대응표 전 점 읽기 ⑤ 값 범위 ⑥ 생존 계수(hb) 증가 ⑦ 경로 A·B 값 일치.
읽기만 한다. 쓰기는 차림표의 [지령 시험]에서만 하고 두 번 확인한다. 접속은 runtime.json allow 안의 사설 주소로만 한다.
"""
import argparse, html, json, os, socket, sys, time, unicodedata
from concurrent.futures import ThreadPoolExecutor
from . import modbus as mb, pointmap as pm

OK, WARN, BAD = "정상", "주의", "이상"
RANK = {OK: 0, WARN: 1, BAD: 2}
COLOR = {OK: "\033[32m", WARN: "\033[33m", BAD: "\033[31m"}
HINTS = [  # (오류 문장에 들어 있는 말, 원인, 조치)
    ("허용 목록 밖", "접속 허용 대역에 없는 주소", "runtime.json 의 allow 에 현장 대역을 넣는다(사설 주소만 가능)"),
    ("ConnectionRefused", "장비가 접속을 거부", "포트 번호(기본 502), 장비의 Modbus TCP 서버 사용 설정, 동시 접속 수(다른 SCADA·노트북 접속 해제)를 확인"),
    ("timed out", "응답 없음(시간 초과)", "IP·서브넷, 케이블·스위치 포트 표시등, 장비 전원을 확인. ping 으로 먼저 확인"),
    ("TimeoutError", "응답 없음(시간 초과)", "IP·서브넷, 케이블·스위치 포트 표시등, 장비 전원을 확인. ping 으로 먼저 확인"),
    ("unreachable", "망 경로 없음", "노트북 IP 가 장비와 같은 대역인지, 케이블이 꽂혀 있는지 확인"),
    ("예외 응답 1 ", "장비가 그 기능 코드를 지원하지 않음", "대응표 fc 를 3↔4 로 바꿔 본다"),
    ("예외 응답 2 ", "없는 주소", "주소가 0부터인지 1부터인지 확인(40001 → addr 0). 주소가 1 차이 나는지 본다"),
    ("예외 응답 3 ", "값·개수 불가", "한 번에 읽는 개수가 장비 한도를 넘는지 확인"),
    ("예외 응답 4 ", "장비 내부 고장", "장비 제작사 확인"),
    ("예외 응답 10 ", "게이트웨이에 그 장치 번호가 없음", "게이트웨이의 Unit ID 등록을 확인"),
    ("예외 응답 11 ", "게이트웨이 뒤 장비 무응답", "RS-485 배선(A/B 극성)·통신 속도·패리티·국번·종단 저항을 확인"),
    ("식별 번호 불일치", "다른 장치 번호가 응답", "runtime.json 의 unit 을 확인"),
    ("연결 끊김", "장비가 연결을 끊음", "장비의 접속 허용 IP·동시 접속 수·무통신 시간 제한을 확인"),
]


def hint(err):
    for key, cause, act in HINTS:
        if key in err: return cause, act
    return "원인 미분류", "프레임 추적(차림표 6)으로 송수신 내용을 확인"


def width(s): return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in str(s))
def pad(s, n): s = str(s); return s + " " * max(0, n - width(s))
def worst(states): return max(states, key=RANK.get, default=OK)


# ───────────────────────── 진단
def tcp_check(host, port, timeout):
    """TCP 접속만 본다(Modbus 이전 단계). 반환: (성공, 걸린 ms 또는 오류 문장)"""
    t0 = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout): return True, round((time.monotonic() - t0) * 1000, 1)
    except OSError as e:
        return False, f"{type(e).__name__}: {e}"


def tiny(p, v):
    """실수형에서 0이 아닌데 지나치게 작은 값(순서가 틀린 실수의 전형: 1e-40 등)."""
    return p["type"] in ("f32", "f64") and v != 0 and abs(v) < 1e-12


def suggest(p, regs):
    """범위를 벗어난 값에 대해 다른 순서·자료형·배율로 해석하면 범위 안에 드는지 찾아 준다."""
    lo, hi = p["lo"], p["hi"]
    if lo is None or hi is None: return ""
    fit = lambda v: v == v and lo <= v <= hi and not tiny(p, v)
    for o in mb.ORDERS:
        if o != p["order"] and fit(mb.decode(regs, p["type"], p["scale"], o)) and mb.to_std(regs, o) != mb.to_std(regs, p["order"]):
            return f"순서를 {o} 로 해석하면 {mb.decode(regs, p['type'], p['scale'], o):.6g} (범위 안) → order 열 확인"
    alt = {"u16": "i16", "i16": "u16", "u32": "i32", "i32": "u32"}.get(p["type"])
    if alt and fit(mb.decode(regs, alt, p["scale"], p["order"])): return f"자료형을 {alt} 로 해석하면 범위 안 → type 열 확인"
    for k in (0.1, 10, 0.01, 100, 0.001, 1000):
        if fit(mb.decode(regs, p["type"], p["scale"] * k, p["order"])): return f"배율을 {p['scale'] * k:g} 로 하면 범위 안 → scale 열 확인"
    return "실제 값이 범위를 벗어났거나 lo·hi 가 좁다"


def read_point(cl, p):
    """점 하나를 읽어 판정한다."""
    n = mb.NREG[p["type"]]; row = {"tag": p["tag"], "fc": p["fc"], "addr": p["addr"], "type": p["type"], "order": p["order"], "unit": p["unit"], "rw": p["rw"], "state": OK, "note": ""}
    try:
        regs = cl.read(p["addr"], n, p["fc"])
    except mb.ModbusError as e:
        cause, act = hint(str(e)); row.update(state=BAD, raw="", value=None, note=f"{e} — {cause}. {act}"); return row
    v = mb.decode(regs, p["type"], p["scale"], p["order"]); row.update(raw=" ".join(f"{r:04X}" for r in regs), value=v)
    if v != v: row.update(state=BAD, note="NaN — " + suggest(p, regs))
    elif tiny(p, v): row.update(state=WARN, note=f"0 에 가까운 비정상 실수({v:.3g}) — 바이트 순서 의심. " + suggest(p, regs))
    elif (p["lo"] is not None and v < p["lo"]) or (p["hi"] is not None and v > p["hi"]): row.update(state=WARN, note=f"범위 {p['lo']}~{p['hi']} 밖. " + suggest(p, regs))
    return row


def check_path(host, port, unit, pts, allow, timeout, hb_wait):
    """경로 하나를 단계별로 점검한다."""
    r = {"host": host, "port": port, "steps": [], "points": [], "state": OK}
    step = lambda name, state, text: r["steps"].append({"name": name, "state": state, "text": text})
    if not mb.allowed(host, allow):
        step("① 허용 목록", BAD, f"{host} 가 allow {list(allow)} 밖 — " + hint("허용 목록 밖")[1]); r["state"] = BAD; return r
    step("① 허용 목록", OK, "허용 대역 안")
    ok, res = tcp_check(host, port, timeout)
    if not ok:
        cause, act = hint(res); step("② TCP 접속", BAD, f"{res} — {cause}. {act}"); r["state"] = BAD; return r
    step("② TCP 접속", OK if res < 100 else WARN, f"{res} ms" + ("" if res < 100 else " (느림: 망 상태 확인)"))
    cl = mb.Client(host, port, unit, timeout, allow)
    try:
        rd = [p for p in pts if p["rw"] == "r"] or pts
        try:
            t0 = time.monotonic(); cl.read(rd[0]["addr"], 1, rd[0]["fc"]); step("③ 장치 번호 응답", OK, f"unit {unit} 응답 {(time.monotonic() - t0) * 1000:.1f} ms")
        except mb.ModbusError as e:
            cause, act = hint(str(e)); bad = "예외 응답" not in str(e)             # 예외 응답이라도 장치는 살아 있다
            step("③ 장치 번호 응답", BAD if bad else WARN, f"unit {unit}: {e} — {cause}. {act}")
            if bad: r["state"] = BAD; return r
        r["points"] = [read_point(cl, p) for p in pts]
        nb = sum(x["state"] == BAD for x in r["points"]); nw = sum(x["state"] == WARN for x in r["points"])
        step("④ 전 점 읽기", BAD if nb else OK, f"{len(pts) - nb}/{len(pts)}점 읽음" + (f", 실패 {nb}점" if nb else ""))
        step("⑤ 값 범위", WARN if nw else OK, f"범위 밖 {nw}점" if nw else "모두 범위 안")
        step("⑥ 생존 계수", *hb_check(cl, pts, hb_wait))
    finally:
        cl.close()
    r["state"] = worst(s["state"] for s in r["steps"]); return r


def hb_check(cl, pts, wait):
    hb = next((p for p in pts if p["tag"].endswith(".hb")), None)
    if hb is None: return OK, "hb 점 없음(계측 전용 장비)"
    try:
        a = cl.read(hb["addr"], 1, hb["fc"])[0]; time.sleep(wait); b = cl.read(hb["addr"], 1, hb["fc"])[0]
    except mb.ModbusError as e:
        return BAD, f"hb 읽기 실패: {e}"
    if a == b: return BAD, f"{wait:.1f}초 동안 hb 가 {a} 에서 변하지 않음 — 장비 제어기 정지 또는 hb 미구현. EMS 는 5초 정지 시 지령을 막는다"
    return OK, f"hb {a} → {b} ({wait:.1f}초)"


def _path_diff(A, B):
    """⑦ 두 경로에서 읽은 값이 다른 점(생존 계수·순번처럼 계속 변하는 점은 제외)."""
    out = []
    for a, b in zip(A, B):
        if a["value"] is None or b["value"] is None or a["tag"].endswith((".hb", ".seq_ack")): continue
        if abs(a["value"] - b["value"]) > max(1.0, 0.05 * abs(a["value"])): out.append(a["tag"])
    return out


def _missing_protocol(name, mine):
    """지령을 받는 장비(cmd 점이 있음)인데 지령 규약 점이 빠진 것."""
    tags = {p["tag"] for p in mine}
    if f"{name}.cmd" not in tags: return []
    return [s for s in ("status", "mode", "hb", "cmd", "seq", "seq_ack") if f"{name}.{s}" not in tags]


def _hb_stopped(path):
    return any(s["name"] == "⑥ 생존 계수" and s["state"] == BAD for s in path["steps"])


def diagnose_device(name, dcfg, pts, allow, timeout=0.8, hb_wait=2.2):
    """장비 하나를 점검한다. 반환: {name, unit, paths:{A:…,B:…}, state, summary}"""
    mine = [p for p in pts if p["device"] == name]
    d = {"name": name, "unit": dcfg["unit"], "order": dcfg.get("order", "ABCD"), "paths": {}, "notes": []}
    for k, (host, port) in zip("AB", dcfg["paths"]): d["paths"][k] = check_path(host, port, dcfg["unit"], mine, allow, timeout, hb_wait)
    if len(d["paths"]) == 2 and all(x["points"] for x in d["paths"].values()):
        diff = _path_diff(d["paths"]["A"]["points"], d["paths"]["B"]["points"])
        if diff: d["notes"].append(f"⑦ 경로 A·B 값이 다름: {', '.join(diff[:6])} — 두 경로가 같은 장비인지(IP 충돌) 확인")
    need = _missing_protocol(name, mine)
    if need: d["notes"].append(f"지령 규약 점 누락: {', '.join(need)} — 대응표에 추가")
    return _judge(d)


def _judge(d):
    """경로별 결과를 모아 장비 판정과 한 줄 요약을 낸다."""
    states = [x["state"] for x in d["paths"].values()]
    live = [k for k, x in d["paths"].items() if any(p["state"] != BAD for p in x["points"])]     # 점을 하나라도 읽은 경로
    hb_stop = bool(live) and all(_hb_stopped(d["paths"][k]) for k in live)
    degraded = BAD in states or WARN in states or bool(d["notes"])
    d["state"] = BAD if (not live or hb_stop) else WARN if degraded else OK
    d["summary"] = ("모든 경로 통신 불가" if not live else f"경로 {'·'.join(live)} 통신 가능" + ("" if len(live) == len(states) else " (경로 저하)")) + (" · 생존 계수 정지(지령 불가)" if hb_stop else "")
    return d


def diagnose_all(cfg, pts, only=None, timeout=None, hb_wait=2.2):
    devs = {n: d for n, d in cfg["devices"].items() if only in (None, n)}
    res = {"when": time.strftime("%Y-%m-%d %H:%M:%S"), "site": (cfg.get("site") or {}).get("name", ""), "map_errors": pm.validate(pts, cfg["devices"]),
           "devices": []}
    to = timeout or max(0.8, cfg.get("timeout_s", 0.5))
    with ThreadPoolExecutor(max_workers=max(1, len(devs))) as ex:                              # 장비별 병렬(hb 대기 시간이 겹치게)
        res["devices"] = list(ex.map(lambda nd: diagnose_device(nd[0], nd[1], pts, cfg["allow"], to, hb_wait), devs.items()))
    res["state"] = worst([d["state"] for d in res["devices"]] + ([BAD] if res["map_errors"] else []))
    return res


# ───────────────────────── 출력·보고서
def paint(state, tty): return f"{COLOR[state]}[{state}]\033[0m" if tty else f"[{state}]"


def print_result(res, out=sys.stdout, detail=False):
    tty = out.isatty(); w = lambda s="": out.write(s + "\n")
    w(f"\n═══ 통신 진단 {res['when']}  {res['site']} ═══")
    for e in res["map_errors"]: w(f"  {paint(BAD, tty)} 대응표 오류: {e}")
    for d in res["devices"]:
        w(f"\n■ {d['name']} (unit {d['unit']}, 기본 순서 {d['order']})  {paint(d['state'], tty)} {d['summary']}")
        for k, x in d["paths"].items():
            w(f"  경로 {k}  {x['host']}:{x['port']}")
            for s in x["steps"]: w(f"    {paint(s['state'], tty)} {pad(s['name'], 18)} {s['text']}")
            for p in x["points"]:
                if detail or p["state"] != OK:
                    val = "—" if p["value"] is None else f"{p['value']:.6g}"
                    w(f"      {paint(p['state'], tty)} {pad(p['tag'], 14)} fc{p['fc']} @{p['addr']:<5} {pad(p['type'], 4)} {pad(p['order'], 5)} {pad(p.get('raw', ''), 20)} {pad(val + ' ' + p['unit'], 14)} {p['note']}")
        for n in d["notes"]: w(f"  {paint(WARN, tty)} {n}")
    w(f"\n종합: {paint(res['state'], tty)}  " + {OK: "모든 장비 통신 정상", WARN: "통신은 되나 확인할 항목이 있음", BAD: "통신 불가 장비 또는 대응표 오류가 있음"}[res["state"]])


CSS = "body{font-family:'Malgun Gothic',sans-serif;margin:24px;color:#111}h1{font-size:20px}h2{font-size:16px;margin-top:22px;border-bottom:2px solid #555;padding-bottom:4px}" \
      "table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0 12px}th,td{border:1px solid #999;padding:3px 6px;text-align:left}th{background:#e4e4e4}" \
      ".정상{color:#0a6b2d;font-weight:bold}.주의{color:#a15c00;font-weight:bold}.이상{color:#b00020;font-weight:bold}td.m{font-family:Consolas,monospace}@media print{h2{page-break-after:avoid}}"


def html_report(res):
    e = html.escape; st = lambda s: f'<span class="{s}">{s}</span>'; h = [f"<!doctype html><meta charset='utf-8'><title>통신 진단 {e(res['when'])}</title><style>{CSS}</style>",
        f"<h1>IFPS EMS 현장 통신 진단 보고서</h1><p>일시 {e(res['when'])} · 현장 {e(res['site'])} · 종합 {st(res['state'])}</p>"]
    if res["map_errors"]: h.append("<h2>대응표 오류</h2><ul>" + "".join(f"<li>{e(x)}</li>" for x in res["map_errors"]) + "</ul>")
    h.append("<h2>요약</h2><table><tr><th>장비</th><th>unit</th><th>판정</th><th>요약</th><th>확인 사항</th></tr>" + "".join(
        f"<tr><td>{e(d['name'])}</td><td>{d['unit']}</td><td>{st(d['state'])}</td><td>{e(d['summary'])}</td><td>{e(' / '.join(d['notes']))}</td></tr>" for d in res["devices"]) + "</table>")
    for d in res["devices"]:
        h.append(f"<h2>{e(d['name'])} — {st(d['state'])} {e(d['summary'])}</h2>")
        for k, x in d["paths"].items():
            h.append(f"<p><b>경로 {k}</b> {e(x['host'])}:{x['port']}</p><table><tr><th style='width:16%'>단계</th><th style='width:8%'>판정</th><th>내용</th></tr>" + "".join(
                f"<tr><td>{e(s['name'])}</td><td>{st(s['state'])}</td><td>{e(s['text'])}</td></tr>" for s in x["steps"]) + "</table>")
            if x["points"]:
                h.append("<table><tr><th>tag</th><th>fc</th><th>addr</th><th>type</th><th>order</th><th>원시값(HEX)</th><th>공학값</th><th>판정</th><th>비고</th></tr>" + "".join(
                    f"<tr><td class='m'>{e(p['tag'])}</td><td>{p['fc']}</td><td>{p['addr']}</td><td>{p['type']}</td><td>{p['order']}</td><td class='m'>{e(p.get('raw', ''))}</td>"
                    f"<td>{'' if p['value'] is None else format(p['value'], '.6g')} {e(p['unit'])}</td><td>{st(p['state'])}</td><td>{e(p['note'])}</td></tr>" for p in x["points"]) + "</table>")
    h.append("<h2>확인</h2><table><tr><th style='width:25%'>시험자</th><td></td><th style='width:25%'>입회자(제작사)</th><td></td></tr></table>")
    return "\n".join(h)


def save_report(res, out_dir):
    os.makedirs(out_dir, exist_ok=True); base = os.path.join(out_dir, "diag_" + res["when"].replace("-", "").replace(":", "").replace(" ", "_"))
    with open(base + ".html", "w", encoding="utf-8") as f: f.write(html_report(res))
    with open(base + ".json", "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, indent=1)
    return base + ".html"


# ───────────────────────── 차림표 기능
def client_for(cfg, name, path="A", timeout=0.8, trace=False, out=sys.stdout):
    d = cfg["devices"][name]; host, port = d["paths"]["AB".index(path)]
    cl = mb.Client(host, port, d["unit"], timeout, cfg["allow"])
    if trace: cl.trace = lambda way, data, rtt: out.write(f"      {way:3} " + (data.hex(" ") if isinstance(data, (bytes, bytearray)) else str(data)) + (f"  ({rtt * 1000:.1f} ms)" if rtt else "") + "\n")
    return cl


def watch(cfg, pts, name, path="A", period=1.0, count=None, out=sys.stdout, trace=False):
    """한 장비의 전 점을 주기적으로 읽어 표로 보인다(Ctrl+C 로 끝). 바뀐 값에는 * 표시."""
    mine = [p for p in pts if p["device"] == name]; cl = client_for(cfg, name, path, trace=trace, out=out); prev = {}; n = 0
    try:
        while count is None or n < count:
            t0 = time.monotonic(); rows = [read_point(cl, p) for p in mine]; n += 1
            if out.isatty(): out.write("\033[2J\033[H")
            out.write(f"{name} 경로 {path} {cl.host}:{cl.port} unit {cl.unit}   {time.strftime('%H:%M:%S')}   #{n}  (Ctrl+C 종료)\n")
            for r in rows:
                val = "—" if r["value"] is None else f"{r['value']:.6g}"; ch = "*" if prev.get(r["tag"]) not in (None, r["value"]) else " "
                out.write(f" {ch} {pad(r['tag'], 14)} @{r['addr']:<5} {pad(r.get('raw', ''), 20)} {pad(val + ' ' + r['unit'], 16)} {'' if r['state'] == OK else '[' + r['state'] + '] ' + r['note']}\n")
                prev[r["tag"]] = r["value"]
            out.flush(); time.sleep(max(0.0, period - (time.monotonic() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        cl.close()
    return n


def scan_addresses(cl, fc=3, start=0, end=99, out=sys.stdout):
    """주소 범위를 하나씩 읽어 응답하는 주소를 찾는다(사양서가 없거나 주소 기준이 불확실할 때). 반환: {주소: 값}"""
    found = {}
    for a in range(start, end + 1):
        try: found[a] = cl.read(a, 1, fc)[0]
        except mb.ModbusError as e:
            if "예외 응답" not in str(e): out.write(f"  @{a}: {e} — 중단\n"); break
    runs = []
    for a in sorted(found):
        if runs and a == runs[-1][1] + 1: runs[-1][1] = a
        else: runs.append([a, a])
    out.write(f"  fc{fc} 응답 주소 {len(found)}개: " + (", ".join(f"{a}" if a == b2 else f"{a}~{b2}" for a, b2 in runs) or "없음") + "\n")
    for a in sorted(found): out.write(f"    @{a:<5} 0x{found[a]:04X} {found[a]:>6} {found[a] - 65536 if found[a] > 32767 else found[a]:>7}\n")
    return found


def _wait_ack(rd, tags, seq, want, wait):
    """seq_ack 와 status 가 바뀌는 데 걸린 시간을 잰다. 반환: (수용 시간, 상태 변화 시간) — 안 바뀌면 None"""
    t0 = time.monotonic(); t_ack = t_st = None
    while time.monotonic() - t0 < wait and (t_ack is None or t_st is None):
        if t_ack is None and int(rd(tags["seq_ack"])) == seq: t_ack = time.monotonic() - t0
        if t_st is None and int(rd(tags["status"])) == want: t_st = time.monotonic() - t0
        time.sleep(0.05)
    return t_ack, t_st


def _handshake(cl, by, tags, cmd, wait, out):
    rd = lambda t: mb.decode(cl.read(by[t]["addr"], mb.NREG[by[t]["type"]], by[t]["fc"]), by[t]["type"], by[t]["scale"], by[t]["order"])
    wr = lambda t, v: cl.write(by[t]["addr"], mb.encode(v, by[t]["type"], by[t]["scale"], by[t]["order"]))
    st, mode, ack = int(rd(tags["status"])), int(rd(tags["mode"])), int(rd(tags["seq_ack"])); want = 1 if cmd == "start" else 0
    out.write(f"  현재 status={st} mode={mode} seq_ack={ack}\n")
    if mode == 1: out.write("  [주의] 현장 수동 모드(mode=1) — 장비가 지령을 거부해야 정상. 시험 중단\n"); return False
    if st == want: out.write(f"  [주의] 이미 {'운전' if want else '정지'} 상태 — 반대 지령으로 시험하십시오\n"); return False
    seq = ack % 65535 + 1; wr(tags["seq"], seq); wr(tags["cmd"], 1 if cmd == "start" else 2)
    t_ack, t_st = _wait_ack(rd, tags, seq, want, wait); f = lambda t: "응답 없음" if t is None else f"{t:.2f}초"
    out.write(f"  seq={seq} 지령 → seq_ack {f(t_ack)}, status {f(t_st)} (EMS 한도 1.5초)\n")
    if t_ack is None or t_st is None:
        wr(tags["cmd"], 0); out.write("  [이상] 응답 미확인 → cmd=0 으로 취소함. 장비 쪽 seq_ack 되돌림·인터록을 확인\n"); return False
    if max(t_ack, t_st) > 1.5:
        out.write("  [주의] 응답은 있으나 1.5초 초과 — 기동이 느린 장비면 runtime.json devices.<장비>.done_s 로 완료 한도를 늘린다\n"); return False
    out.write("  [정상] 지령 규약 적합\n"); return True


def command_test(cfg, pts, name, cmd, path="A", wait=3.0, out=sys.stdout):
    """지령 규약 시험: seq·cmd 를 쓰고 seq_ack·status 가 바뀌는 시간을 잰다. 실패하면 cmd=0 으로 취소한다. 반환: 성공 여부"""
    by = {p["tag"]: p for p in pts if p["device"] == name}; tags = {s: f"{name}.{s}" for s in ("status", "mode", "seq_ack", "cmd", "seq")}
    miss = [t for t in tags.values() if t not in by]
    if miss: out.write(f"  지령 규약 점 없음: {', '.join(miss)}\n"); return False
    cl = client_for(cfg, name, path, trace=True, out=out)
    try:
        return _handshake(cl, by, tags, cmd, wait, out)
    except mb.ModbusError as e:
        cause, act = hint(str(e)); out.write(f"  [이상] {e} — {cause}. {act}\n"); return False
    finally:
        cl.close()


MENU = """
──────── IFPS EMS 현장 진단 ────────
 1  전 장비 자동 진단 + 보고서 저장
 2  장비 하나 자동 진단(상세)
 3  실시간 감시(장비의 전 점)
 4  레지스터 읽기(32비트 네 순서 동시 해석)
 5  주소 탐색(응답하는 주소 찾기)
 6  프레임 추적 켜기/끄기 (현재: {trace})
 7  지령 규약 시험(쓰기 — 제작사 입회 후)
 8  대응표 검증
 0  끝
번호> """


def ask(prompt, default=None, cast=str, inp=input):
    s = inp(f"{prompt}{' [' + str(default) + ']' if default is not None else ''}: ").strip()
    if not s: return default
    try: return cast(s)
    except ValueError: print("  입력 형식 오류 — 기본값 사용"); return default


def pick_device(cfg, inp=input):
    names = list(cfg["devices"]); print("  장비: " + "  ".join(f"{i + 1}){n}" for i, n in enumerate(names)))
    s = (inp("  장비 번호 또는 이름: ").strip() or "1")
    return names[int(s) - 1] if s.isdigit() and 1 <= int(s) <= len(names) else s.upper() if s.upper() in names else names[0]


def menu(cfg, pts, report_dir, inp=input, out=sys.stdout):
    trace = False
    while True:
        try: c = inp(MENU.format(trace="켬" if trace else "끔")).strip()
        except (EOFError, KeyboardInterrupt): return 0
        try:
            if c == "0": return 0
            elif c == "1":
                res = diagnose_all(cfg, pts); print_result(res, out); out.write(f"보고서: {save_report(res, report_dir)}\n")
            elif c == "2":
                res = diagnose_all(cfg, pts, only=pick_device(cfg, inp)); print_result(res, out, detail=True); out.write(f"보고서: {save_report(res, report_dir)}\n")
            elif c == "3":
                watch(cfg, pts, pick_device(cfg, inp), ask("  경로 A/B", "A", str.upper, inp), ask("  주기(초)", 1.0, float, inp), out=out, trace=trace)
            elif c in ("4", "5"):
                cl = client_for(cfg, pick_device(cfg, inp), ask("  경로 A/B", "A", str.upper, inp), trace=trace, out=out)
                try:
                    fc = ask("  기능 코드 3/4", 3, int, inp); a = ask("  시작 주소", 0, int, inp)
                    if c == "4":
                        from .mbtool import _orders, _table
                        regs = cl.read(a, ask("  개수", 8, int, inp), fc); _table(a, regs); _orders(a, regs)
                    else: scan_addresses(cl, fc, a, ask("  끝 주소", a + 49, int, inp), out)
                finally: cl.close()
            elif c == "6": trace = not trace
            elif c == "7":
                name = pick_device(cfg, inp); cmd = "start" if ask("  지령 1 기동 / 2 정지", 1, int, inp) == 1 else "stop"
                out.write(f"  ※ 실제 장비 {name} 에 {'기동' if cmd == 'start' else '정지'} 지령을 씁니다. 부하 분리·현장 비상정지 대기·제작사 입회를 확인하십시오.\n")
                if inp(f"  장비 이름 {name} 을(를) 그대로 입력하면 실행: ").strip().upper() == name and inp("  정말 실행합니까? (yes): ").strip().lower() == "yes": command_test(cfg, pts, name, cmd, out=out)
                else: out.write("  취소\n")
            elif c == "8":
                bad = pm.validate(pts, cfg["devices"]); out.write("  대응표 정상\n" if not bad else "".join(f"  [이상] {b}\n" for b in bad))
        except (mb.ModbusError, IndexError, KeyError, ValueError) as e:
            out.write(f"  [이상] {e}\n")


def _enable_ansi():
    """Windows 콘솔에서 색 표시(ANSI)를 켠다. 실패해도 무시한다(색 없이 표시)."""
    if os.name != "nt": return
    try:
        import ctypes
        k = getattr(ctypes, "windll").kernel32; h = k.GetStdHandle(-11); mode = ctypes.c_uint32(0)
        if k.GetConsoleMode(h, ctypes.byref(mode)): k.SetConsoleMode(h, mode.value | 0x0004)
    except (OSError, AttributeError, ValueError):
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(prog="diag", description="IFPS EMS 현장 간편 진단 도구")
    ap.add_argument("config", nargs="?", default=os.path.join("config", "runtime.json")); ap.add_argument("--auto", action="store_true", help="자동 진단 1회 후 종료")
    ap.add_argument("--device", help="한 장비만"); ap.add_argument("--detail", action="store_true", help="정상 점도 모두 표시"); ap.add_argument("--report", help="보고서 폴더(기본: <state_dir>/diag)")
    ap.add_argument("--demo", action="store_true", help="내장 가상 장치로 시연"); ap.add_argument("--timeout", type=float)
    a = ap.parse_args(argv)
    _enable_ansi()
    if not os.path.exists(a.config): print(f"설정 파일 없음: {a.config}", file=sys.stderr); return 2
    with open(a.config, encoding="utf-8") as f: cfg = json.load(f)
    base = os.path.dirname(os.path.abspath(a.config)); pts = pm.load(os.path.join(base, cfg["pointmap"]), cfg["devices"])
    if a.device and a.device not in cfg["devices"]: print(f"장비 없음: {a.device} (가능: {', '.join(cfg['devices'])})", file=sys.stderr); return 2
    plant = None
    if a.demo:
        from .simplant import Plant
        plant = Plant(pts, {n: d["unit"] for n, d in cfg["devices"].items()}); pa, pb = plant.start([0, 0]); cfg["allow"] = ["127.0.0.0/8"]
        for d in cfg["devices"].values(): d["paths"] = [["127.0.0.1", pa], ["127.0.0.1", pb]]
        print(f"[시연] 내장 가상 장치 기동 (127.0.0.1:{pa}, {pb})")
    report_dir = a.report or os.path.join(base, cfg.get("state_dir", "state"), "diag")
    try:
        if not a.auto: return menu(cfg, pts, report_dir)
        res = diagnose_all(cfg, pts, only=a.device, timeout=a.timeout); print_result(res, detail=a.detail); print("보고서:", save_report(res, report_dir))
        return RANK[res["state"]]
    finally:
        if plant: plant.stop()


if __name__ == "__main__":
    sys.exit(main())
