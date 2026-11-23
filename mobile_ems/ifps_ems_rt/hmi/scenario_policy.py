"""Run EMS policy with virtual-clock measurements and recorded plant outputs."""
import json
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from . import scenunit
from .engine import Engine
from ..runtime import Runtime

METRICS = ("executed", "writes", "tied", "outage", "DG", "FC", "GDG", "ELZ", "reserve", "ess_target", "grid_target", "full_hours")


class ScenarioPolicy:
    _auto_control = Engine._auto_control
    _fc_setpoint = Engine._fc_setpoint  # hybrid.apply is called from _auto_control through the engine module

    def __init__(self, profile, plant, sequences, clock, directory):
        source = Path(profile).resolve()
        cfg = json.loads(source.read_text(encoding="utf-8"))
        cfg["pointmap"] = str(source.parent / cfg["pointmap"])
        cfg["state_dir"] = directory
        cfg["run_mode"] = "개발"
        cfg["allow"] = ["127.0.0.0/8"]
        for device in cfg["devices"].values():
            device["paths"] = [["127.0.0.1", 1]]
        path = Path(directory) / "runtime.json"
        path.write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
        self.rt = Runtime(str(path), clock=clock, wall=lambda: datetime(2026, 3, 21))
        self.plant, self.sequences = plant, sequences
        self.fc_set_written = None
        self.last_decision = None
        self.writes = []
        self.metrics = {}
        for link in self.rt.links.values():
            link.write = self.write

    def write(self, tag, val):
        self.plant.set(tag, val)
        self.writes.append(f"{tag}={val:g}")
        return True

    def _send(self, dev, cmd, who):
        seq = self.sequences.get(dev, 0) + 1
        self.sequences[dev] = seq
        self.write(f"{dev}.seq", seq)
        self.write(f"{dev}.cmd", 1 if cmd == "start" else 2)
        return True, 0.0  # command acceptance and completion are separate plant events

    def pulse(self, step):
        rt = self.rt
        if (rt.mode, rt.posture) != (step["mode"], step["posture"]):
            rt.set_ops(step["mode"], step["posture"], "시나리오")
        rt.auto_enabled = step["control"] == "auto"
        rt.hr_off = step["hour"]
        rt.load_frac = dict(self.plant.save_frac)  # staged load reduction (save supply before shedding) uses the plant's reducible share
        self.writes.clear()
        self.last_decision = None
        rt.val = {p["tag"]: self.plant.get(p["tag"]) for p in rt.pts if p["rw"] == "r"}
        scenunit.fleet_merge(rt, self.plant)  # units placed or removed by UNIT.<device> signals
        for dev, state in rt.dev.items():
            state.on = bool(rt.val.get(f"{dev}.status"))
            state.manual = bool(rt.val.get(f"{dev}.mode"))
        rt.fast_control()
        if rt.auto_enabled or step["control"] == "immediate":
            self._auto_control("시나리오")
        decision = self.last_decision or {}
        want = decision.get("want", {})
        self.metrics = {name: int(want.get(name, False)) for name in ("DG", "FC", "GDG", "ELZ")}
        grid = rt.gar_last or {}
        for name, value in (("executed", bool(decision)), ("writes", len(self.writes)), ("tied", rt.tied()),
                            ("outage", rt.grid_lost), ("reserve", decision.get("reserve", False)),
                            ("ess_target", grid.get("ess")), ("grid_target", grid.get("grid")),
                            ("full_hours", (rt.auto_h or {}).get("full"))):
            self.metrics[name] = value
        return {"why": f"{'실행' if decision else '자동 급전 생략'} · 지령 {len(self.writes)}건",
                "detail": ", ".join(f"{name} {'ON' if on else 'OFF'}" for name, on in want.items()),
                "source": ", ".join(self.writes)}


def run_policy_case(run, case, pts, units, profile):
    with TemporaryDirectory(prefix="ems-scenario-") as directory:
        return run(case, pts, units, profile, directory)
