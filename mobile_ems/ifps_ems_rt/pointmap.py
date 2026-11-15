# -*- coding: utf-8 -*-
"""자료 대응표(포인트 맵). 장치의 레지스터 주소와 EMS 내부 이름(tag)을 잇는다.

CSV 열: tag, device, fc, addr, type, scale, unit, lo, hi, rw
  tag     EMS 내부 이름(예: ESS.kw, DG.status, DG.cmd)
  device  장치 이름(runtime.json의 devices 키)
  fc      읽기 기능 코드(3 또는 4)
  addr    레지스터 주소(0부터)
  type    u16 / i16 / u32 / i32 / f32
  scale   레지스터 값에 곱해 공학값을 만드는 배율
  unit    단위(kW, %, V, Hz, 없음 ...)
  lo, hi  공학값의 물리 범위(범위 검사에 사용, 비우면 검사하지 않음)
  rw      r 읽기 전용 / w 쓰기(지령)
  order   (선택) 바이트·워드 순서 ABCD / CDAB / BADC / DCBA. 비우면 장치 기본값
          (runtime.json devices.<장치>.order) → 그것도 없으면 ABCD(Modbus 표준)
  type 16비트: u16 i16 · 32비트: u32 i32 f32 · 64비트: u64 i64 f64 (레지스터 1/2/4개 차지)
"""
import csv
from .modbus import NREG, norm_order, ModbusError

REQUIRED = ("tag", "device", "fc", "addr", "type", "scale", "unit", "lo", "hi", "rw")
UNITS = {"kW", "kWh", "%", "V", "A", "Hz", "Nm3", "L", "degC", ""}


def load(path, devices=None):
    """대응표를 읽는다. devices(runtime.json의 devices)를 주면 장치 기본 order를 채운다."""
    with open(path, encoding="utf-8-sig") as f: rows = [r for r in csv.DictReader(f) if (r.get("tag") or "").strip() and not r["tag"].lstrip().startswith("#")]
    pts = []
    for r in rows:
        pts.append({"tag": r["tag"].strip(), "device": r["device"].strip(), "fc": int(r["fc"]), "addr": int(r["addr"]), "type": r["type"].strip(),
                    "scale": float(r["scale"]), "unit": r["unit"].strip(), "lo": float(r["lo"]) if r["lo"] != "" else None,
                    "hi": float(r["hi"]) if r["hi"] != "" else None, "rw": r["rw"].strip()})
        dev_def = ((devices or {}).get(pts[-1]["device"]) or {}).get("order", "")
        pts[-1]["order_raw"] = (r.get("order") or "").strip() or dev_def
        try: pts[-1]["order"] = norm_order(pts[-1]["order_raw"])
        except ModbusError: pts[-1]["order"] = None          # validate()가 오류로 알린다
    return pts


def validate(pts, devices=None):
    """대응표 오류를 찾는다. 반환: 오류 문장 목록(비어 있으면 정상)."""
    bad = []; seen_tag = set(); used = {}
    for p in pts:
        if p["tag"] in seen_tag: bad.append(f"이름 중복: {p['tag']}")
        seen_tag.add(p["tag"])
        if p["type"] not in NREG: bad.append(f"{p['tag']}: 자료형 오류 {p['type']}"); continue
        if p.get("order", "ABCD") is None: bad.append(f"{p['tag']}: 바이트 순서 오류 {p.get('order_raw')} (ABCD/CDAB/BADC/DCBA)")
        if p["fc"] not in (3, 4): bad.append(f"{p['tag']}: 기능 코드 오류 {p['fc']}")
        if p["rw"] not in ("r", "w"): bad.append(f"{p['tag']}: 읽기·쓰기 구분 오류 {p['rw']}")
        if p["rw"] == "w" and p["fc"] != 3: bad.append(f"{p['tag']}: 지령은 보유 레지스터(03)여야 함")
        if p["unit"] not in UNITS: bad.append(f"{p['tag']}: 단위 오류 {p['unit']}")
        if p["scale"] == 0: bad.append(f"{p['tag']}: 배율 0")
        if p["lo"] is not None and p["hi"] is not None and p["lo"] >= p["hi"]: bad.append(f"{p['tag']}: 범위 하한이 상한 이상")
        if devices is not None and p["device"] not in devices: bad.append(f"{p['tag']}: 정의되지 않은 장치 {p['device']}")
        for a in range(p["addr"], p["addr"] + NREG[p["type"]]):
            key = (p["device"], p["fc"], a)
            if key in used: bad.append(f"주소 겹침: {p['tag']} 과 {used[key]} ({p['device']} {p['fc']}:{a})")
            used[key] = p["tag"]
        if p["tag"].endswith(".kw") and p["unit"] != "kW": bad.append(f"{p['tag']}: 전력 채널 단위가 kW가 아님({p['unit']})")
    return bad


def blocks(pts, device, gap=4, maxlen=100):
    """한 장치의 읽기 점들을 연속 주소 묶음으로 나눈다(통신 횟수를 줄인다). 반환: [(fc, 시작 주소, 개수, [점])]"""
    out = []
    for fc in (3, 4):
        ps = sorted([p for p in pts if p["device"] == device and p["fc"] == fc and p["rw"] == "r"], key=lambda p: p["addr"])
        cur = None
        for p in ps:
            end = p["addr"] + NREG[p["type"]]
            if cur and p["addr"] - cur[2] <= gap and end - cur[1] <= maxlen:
                cur[2] = end; cur[3].append(p)
            else:
                cur = [fc, p["addr"], end, [p]]; out.append(cur)
    return [(fc, a, e - a, ps) for fc, a, e, ps in out]
