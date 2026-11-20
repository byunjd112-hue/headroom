# -*- coding: utf-8 -*-
"""기록 보관소 조회 API(화면과 별도 뷰어가 같이 쓴다). 기간은 단위에 맞춰 잡는다: 시간 → 하루, 일 → 한 달, 월 → 한 해, 년 → 전체."""
import csv, io
from datetime import datetime, timedelta

NEXT_UNIT = {"hour": "day", "day": "month", "month": "year", "year": "all", "raw": "day"}      # 그 단위로 볼 때 한 화면에 담는 범위
LABELS = {"k": "구간", "load_kwh": "부하 kWh", "pv_kwh": "태양광 kWh", "dg_kwh": "디젤 kWh", "fc_kwh": "연료전지 kWh", "gdg_kwh": "주둔지 발전기 kWh", "grid_in_kwh": "수전 kWh", "grid_out_kwh": "역송 kWh",
          "ess_chg_kwh": "ESS 충전 kWh", "ess_dis_kwh": "ESS 방전 kWh", "elz_kwh": "수전해 kWh", "load_max": "최대 부하 kW", "grid_max": "최대 수전 kW", "pv_max": "최대 태양광 kW", "soc": "충전율 %",
          "h2": "수소 Nm³", "fuel": "디젤 연료 L", "va": "모선 A 전압 V", "vb": "모선 B 전압 V", "hz": "주파수 Hz", "temp": "기온 ℃", "cum_load": "누적 부하 kWh", "cum_pv": "누적 태양광 kWh",
          "cum_gen": "누적 발전기 kWh", "cum_grid_in": "누적 수전 kWh", "cum_grid_out": "누적 역송 kWh", "n": "기록 수"}
CSV = "text/csv; charset=utf-8"


def span(unit, at):
    """단위와 기준 날짜(YYYY-MM-DD, 비우면 오늘)로 조회 구간 [t0, t1) 과 제목을 정한다."""
    d = datetime.strptime(at, "%Y-%m-%d") if at else datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    scope = NEXT_UNIT.get(unit, "day")
    if scope == "day": a = d; b = d + timedelta(days=1); title = d.strftime("%Y년 %m월 %d일")
    elif scope == "month": a = d.replace(day=1); b = (a + timedelta(days=32)).replace(day=1); title = a.strftime("%Y년 %m월")
    elif scope == "year": a = d.replace(month=1, day=1); b = a.replace(year=a.year + 1); title = a.strftime("%Y년")
    else: a = datetime(2000, 1, 1); b = datetime(2100, 1, 1); title = "전체 기간"
    return a.timestamp(), b.timestamp(), title


def _range(q):
    """from·to(YYYY-MM-DD)를 주면 그 구간, 아니면 단위·기준 날짜로."""
    if q.get("from") and q.get("to"):
        a = datetime.strptime(q["from"], "%Y-%m-%d"); b = datetime.strptime(q["to"], "%Y-%m-%d") + timedelta(days=1)
        return a.timestamp(), b.timestamp(), f"{q['from']} ~ {q['to']}"
    return span(q.get("unit", "hour"), q.get("at", ""))


def to_csv(rows):
    if not rows: return "﻿자료 없음\n"
    keys = [k for k in rows[0] if k not in ("ts", "demo") and not k.endswith(("_min", "_hi"))]; out = io.StringIO(); w = csv.writer(out)
    w.writerow([LABELS.get(k, k) for k in keys]); [w.writerow([r[k] for k in keys]) for r in rows]
    return "﻿" + out.getvalue()


def dev_csv(d):
    tags = [s["tag"] for s in d["signals"]]; out = io.StringIO(); w = csv.writer(out); w.writerow(["구간"] + [f"{t} {k}" for t in tags for k in ("평균", "최소", "최대")])
    for r in d["rows"]: w.writerow([r["k"]] + [x for t in tags for x in r["v"].get(t, ["", "", ""])])
    return "﻿" + out.getvalue()


def ess_csv(d):
    out = io.StringIO(); w = csv.writer(out); one = bool(d["rows"]) and all(r["n"] == 1 for r in d["rows"])
    w.writerow(["구간"] + ([i["label"] for i in d["items"]] if one else [f"{i['label']} {k}" for i in d["items"] for k in ("평균", "최소", "최대")]))
    for r in d["rows"]: w.writerow([r["k"]] + [x for i in d["items"] for x in (r["v"][i["key"]][:1] if one else r["v"][i["key"]])])
    return "﻿" + out.getvalue()


def _archive(st, p, q):
    """검침·상황·점검 기록"""
    arch = st.arch
    if p == "/api/archive/info": return dict(arch.info(), **st.dev.info(), server_url=st.url, outbox=st.xfer.outbox), None, None
    if p in ("/api/archive/series", "/api/archive/series.csv"):
        unit = q.get("unit", "hour"); t0, t1, title = _range(q); rows = arch.series(unit, t0, t1)
        if p.endswith(".csv"): return to_csv(rows), CSV, {"Content-Disposition": f"attachment; filename=ems_archive_{unit}.csv"}
        return {"ok": True, "unit": unit, "title": title, "rows": rows, "labels": LABELS}, None, None
    if p == "/api/archive/events":
        t0, t1, title = _range(q)
        return {"ok": True, "title": title, "rows": arch.events(t0, t1, q.get("q", "").strip()[:60], q.get("kind", "").strip()[:20], int(q.get("limit", 500)))}, None, None
    if p == "/api/archive/inspect":
        t0, t1, title = _range(dict(q, unit=q.get("unit", "year")))
        return {"ok": True, "title": title, "rows": arch.inspects(t0, t1)}, None, None
    return None


def get(st, p, q):
    """조회 경로 처리. st: 보관소 한 벌(arch · dev · xfer · url). 반환: (본문, 형식, 덧붙일 머리줄) 또는 None(이 모듈이 맡는 경로가 아님)"""
    if p == "/api/archive/devices": return {"ok": True, "rows": st.dev.devices()}, None, None
    if p in ("/api/archive/device", "/api/archive/device.csv"):
        dev = q.get("dev", "")[:16]; unit = q.get("unit", "hour"); t0, t1, title = _range(q); d = st.dev.dev_series(dev, unit, t0, t1)
        if p.endswith(".csv"): return dev_csv(d), CSV, {"Content-Disposition": f"attachment; filename=ems_device_{''.join(c for c in dev if c.isalnum())}_{unit}.csv"}
        return dict(d, ok=True, title=title, dev=dev), None, None
    if p in ("/api/archive/ess", "/api/archive/ess.csv"):
        unit = q.get("unit", "hour"); t0, t1, title = _range(q); d = st.dev.ess_series(unit, t0, t1)
        if p.endswith(".csv"): return ess_csv(d), CSV, {"Content-Disposition": f"attachment; filename=ems_ess_safety_{unit}.csv"}
        return dict(d, ok=True, title=title), None, None
    if p == "/api/archive/xfer": return dict(st.xfer.history(), ok=True, server_url=st.url, outbox=st.xfer.outbox, read_only=st.arch.ro), None, None
    return _archive(st, p, q)
