"""Deterministic scenario tests against the existing in-memory plant model."""
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from copy import deepcopy
import json
import math
import operator
from pathlib import Path

from .. import hybrid, modbus, pointmap
from ..simplant import Plant
from . import scenextra
from .scenario_policy import METRICS, ScenarioPolicy, run_policy_case

MAX_CASES = 64
MAX_STEPS = 30
TICK_MS = 50
MAX_MS = 10000
# 구성도 재생용으로 단계마다 남기는 상태: 차단기·고장 코드·부하 차단·모선, 장비의 운전 상태·출력·충전율
SNAP_PREFIX = ("CB.", "FLT.", "LDS.", "BUS.", "LOAD.", "GF.", "STK.", "RING.", "BRK.", "FSU", "PPDU", "UNIT.")
SNAP_SUFFIX = (".status", ".kw", ".soc", ".load_pct")
OPS = {"eq": lambda a, b: math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9),
       "ge": operator.ge, "le": operator.le}


def catalog(pts, devices):
    tags = {p["tag"] for p in pts}
    commands = [dev for dev in devices if all(
        f"{dev}.{suffix}" in tags for suffix in ("cmd", "seq", "seq_ack", "mode", "status"))]
    return {"devices": list(devices), "commands": commands,
            "points": [{k: p[k] for k in ("tag", "device", "rw", "unit", "lo", "hi")} for p in pts]}


def compatible_presets(presets, pts, commands):
    """Return built-in cases that the active point map can represent."""
    tags = {p["tag"]: p for p in pts}
    available = []
    for case in presets:
        steps = case["steps"]
        try:
            for index, step in enumerate(steps):
                validate_step(step, tags, commands, len(steps) - index - 1)
        except (ValueError, modbus.ModbusError):
            continue
        available.append(case)
    return available


def number(step, key, lower, upper, default=None, integer=False):
    value = step.get(key, default)
    valid = type(value) in (float, int) and lower <= value <= upper
    if not valid or (integer and type(value) is not int):
        raise ValueError(f"{key} 허용 범위 {lower}~{upper}")
    return value


def evaluate(cases, pts, devices, profile=None):
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise ValueError(f"시나리오를 1~{MAX_CASES}개 선택하세요")
    extra = scenextra.load(profile) if profile else scenextra.empty()      # 추가 설비(모의 급전선·변압기·계전기)
    pts = scenextra.merge(pts, extra)
    runner = partial(run_case, extra=extra)
    by_tag = {p["tag"]: p for p in pts}
    commands = catalog(pts, devices)["commands"]
    for case in cases:
        if not isinstance(case.get("name"), str) or not case["name"].strip() or len(case["name"]) > 80:
            raise ValueError("시나리오 이름은 1~80자여야 합니다")
        steps = case.get("steps")
        if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
            raise ValueError(f"{case['name']} · 단계는 1~{MAX_STEPS}개여야 합니다")
        for index, step in enumerate(steps):
            try:
                validate_step(step, by_tag, commands, len(steps) - index - 1)
            except (ValueError, modbus.ModbusError) as exc:
                raise ValueError(f"{case['name']} · {index + 1}단계: {exc}") from exc
    units = {name: d["unit"] for name, d in devices.items()}
    def run(case):
        if any(step["type"] == "policy" for step in case["steps"]):
            if profile is None:
                raise ValueError("EMS 운전 정책 검증에는 runtime.json이 필요합니다")
            return run_policy_case(runner, case, pts, units, profile)
        return runner(case, pts, units)

    with ThreadPoolExecutor(max_workers=min(4, len(cases))) as pool:
        return list(pool.map(run, cases))


def _validate_policy(step, tags):
    if step.get("mode") not in ("island", "grid") or step.get("posture") not in ("평시", "저소음", "자립"):
        raise ValueError("운용 장소와 태세를 선택하세요")
    if step.get("mode") == "grid" and not {"CB.GRID", "GRID.kw"} <= tags.keys():
        raise ValueError("수전점 계측 신호가 필요합니다")
    if step.get("control") not in ("auto", "manual", "immediate"):
        raise ValueError("제어 방식을 선택하세요")
    number(step, "hour", 0, 23.99)


def _validate_point(step, kind, tags, remaining):
    point = tags.get(step.get("tag"))
    if point is None:
        raise ValueError("포인트 맵에 있는 신호를 선택하세요")
    value = number(step, "value", -1e12, 1e12)
    if kind == "set":
        for bound, cmp in (("lo", operator.lt), ("hi", operator.gt)):
            if point[bound] is not None and cmp(value, point[bound]):
                raise ValueError(f"{point['tag']} 범위 {point['lo']}~{point['hi']}")
        modbus.encode(value, point["type"], point["scale"], point["order"])
    else:
        if step.get("op") not in OPS:
            raise ValueError("비교 조건을 선택하세요")
        if kind == "expect":
            timeout = number(step, "ms", 0, MAX_MS, integer=True)
            number(step, "limit", timeout, MAX_MS, timeout, integer=True)
        else:
            number(step, "skip", 0, remaining, integer=True)


def validate_step(step, tags, commands, remaining):
    kind = step.get("type")
    if kind == "wait":
        number(step, "ms", 0, MAX_MS, integer=True)
    elif kind in ("command", "response"):
        if step.get("device") not in commands:
            raise ValueError("기동·정지 규약을 지원하는 장비를 선택하세요")
        if kind == "command":
            number(step, "value", 1, 2, integer=True)
        else:
            number(step, "ms", -1, MAX_MS, integer=True)
    elif kind == "policy":
        _validate_policy(step, tags)
    elif kind == "policy_check":
        if step.get("metric") not in METRICS or step.get("op") not in OPS:
            raise ValueError("EMS 판단 항목과 비교 조건을 선택하세요")
        number(step, "value", -1e12, 1e12)
    elif kind in ("set", "expect", "branch"):
        _validate_point(step, kind, tags, remaining)
    else:
        raise ValueError("지원하지 않는 단계 유형입니다")


def _set_response(plant, step):
    """장치의 응답 방식을 바꾼다: 음수면 무응답, 아니면 그 시간만큼 지연."""
    dev = step["device"]
    if step["ms"] < 0:
        plant.no_ack.add(dev)
        plant.slow.pop(dev, None)
    else:
        plant.no_ack.discard(dev)
        plant.slow[dev] = step["ms"] / 1000


def _send_command(plant, step, sequences):
    dev = step["device"]
    seq = sequences.get(dev, 0) + 1
    sequences[dev] = seq
    plant.set(f"{dev}.seq", seq)
    plant.set(f"{dev}.cmd", step["value"])
    return seq


def _watch(pts):
    return [p["tag"] for p in pts if p["tag"].startswith(SNAP_PREFIX) or p["tag"].endswith(SNAP_SUFFIX)]


def _snapshot(plant, watch):
    return {tag: round(plant.get(tag), 2) for tag in watch}


def run_case(case, pts, units, profile=None, directory=None, extra=None):
    plant = Plant(pts, units)
    if profile:  # hybrid PCS mode codes follow the profile's settings
        with open(profile, encoding="utf-8") as source:
            plant.set_hybrid(hybrid.settings(json.load(source).get("hybrid"))["code"])
    model = scenextra.Model(extra, plant)
    plant.slow["GDG"] = 5.0
    elapsed = 0
    sequences = {}
    policy = ScenarioPolicy(profile, plant, sequences, lambda: elapsed / 1000, directory) if profile else None
    rows = []
    skip = 0
    watch = _watch(pts)

    def advance(ms):
        nonlocal elapsed
        end = elapsed + ms
        while elapsed < end:
            delta = min(TICK_MS, end - elapsed)
            elapsed += delta
            plant.tick(delta / 1000, now=elapsed / 1000)
            model.tick(elapsed / 1000)

    try:
        for index, step in enumerate(case["steps"]):
            kind = step["type"]
            row = {"step": index, "state": "pass"}
            if skip:
                skip -= 1
                row["state"] = "skip"
            elif kind == "wait":
                advance(step["ms"])
            elif kind == "set":
                plant.set(step["tag"], step["value"])
                row["actual"] = plant.get(step["tag"])
            elif kind == "response":
                _set_response(plant, step)
            elif kind == "command":
                row["actual"] = _send_command(plant, step, sequences)
            elif kind == "branch":
                actual = plant.get(step["tag"])
                match = OPS[step["op"]](actual, step["value"])
                skip = 0 if match else step["skip"]
                row.update(actual=actual, expected=step["value"], why=f"조건 {'참' if match else '거짓'} · {skip}단계 건너뜀")
            elif kind == "policy":
                row.update(policy.pulse(step))
            elif kind == "policy_check":
                actual = policy.metrics.get(step["metric"]) if policy else None
                target = step["value"]
                row.update(actual=actual, expected=target)
                if actual is None or not OPS[step["op"]](actual, target):
                    row.update(state="fail", why="EMS 판단값이 없거나 기준과 다릅니다")
            elif kind == "expect":
                row.update(check_expectation(plant, step, advance, sequences))
            row["elapsed"] = elapsed
            row["snap"] = _snapshot(plant, watch)
            rows.append(row)
            if row["state"] == "fail":
                break
        return {"name": case["name"], "ok": all(row["state"] != "fail" for row in rows), "rows": rows}

    finally:
        if policy is not None:
            policy.rt.close()


def check_expectation(plant, step, advance, sequences):
    tag, timeout = step["tag"], step["ms"]
    matches = OPS[step["op"]]
    target = step["value"]
    actual = plant.get(tag)
    waited = 0
    while waited < timeout and not matches(actual, target):
        delta = min(TICK_MS, timeout - waited)
        advance(delta)
        waited += delta
        actual = plant.get(tag)
    row = {"actual": actual, "expected": target, "waited": waited}
    if matches(actual, target):
        return row
    row.update(state="fail", why="즉시 검사에서 조건 불일치" if not timeout else "대기 한도 내 예상값 미도달")
    limit = step.get("limit", timeout)
    while waited < limit:
        delta = min(TICK_MS, limit - waited)
        advance(delta)
        waited += delta
        if matches(plant.get(tag), target):
            row["suggest_ms"] = waited
            row["why"] = f"대기 한도 초과 · 허용 상한 내 {waited} ms에서 도달"
            break
    point = plant.by_tag[tag]
    dev = point["device"]
    if dev in sequences and tag in (f"{dev}.status", f"{dev}.seq_ack"):
        ack = plant.get(f"{dev}.seq_ack")
        row["detail"] = f"{dev} · 최근 지령 순번 {sequences[dev]} / 수용 순번 {ack}"
        if dev in plant.no_ack:
            row["detail"] += " · 무응답 주입 중"
        elif plant.get(f"{dev}.mode") != 0:
            row["detail"] += " · 로컬 모드"
        row["source"] = "ifps_ems_rt/simplant.py · Plant._tick_cmd"
    else:
        row["source"] = "config/pointmap.csv · " + tag
    return row


def verify(cases, pts, devices, improve=False, profile=None):
    original = evaluate(cases, pts, devices, profile)
    result = {"ok": True, "results": original}
    if not improve:
        return result
    candidate = deepcopy(cases)
    changes = []
    for i, run in enumerate(original):
        for row in run["rows"]:
            if "suggest_ms" in row:
                step = candidate[i]["steps"][row["step"]]
                changes.append({"case": i, "step": row["step"], "before": step["ms"], "after": row["suggest_ms"]})
                step["ms"] = row["suggest_ms"]
    if changes:
        retest = evaluate(candidate, pts, devices, profile)
        result.update(changes=changes, retest=retest)
        if all(run["ok"] for run in retest):
            result["candidate"] = candidate
    return result


def regression_source(cases, pts, devices, profile=None):
    evaluate(cases, pts, devices, profile)
    payload = repr(json.dumps(cases, ensure_ascii=True, allow_nan=False))
    return f"""import json
from pathlib import Path
import unittest

from ifps_ems_rt.hmi.scenarios import load_profile, evaluate

CASES = json.loads({payload})


class ScenarioRegression(unittest.TestCase):
    def test_scenarios(self):
        root = Path(__file__).resolve().parents[1]
        profile = root / "config" / "runtime.json"
        points, devices = load_profile(profile)
        for result in evaluate(CASES, points, devices, profile):
            with self.subTest(scenario=result["name"]):
                self.assertTrue(result["ok"], result["rows"])


if __name__ == "__main__":
    unittest.main()
"""


def load_profile(path):
    path = Path(path)
    config = json.loads(path.read_text(encoding="utf-8"))
    devices = config["devices"]
    pts = pointmap.load(path.parent / config["pointmap"], devices)
    return scenextra.merge(pts, scenextra.load(path)), devices
