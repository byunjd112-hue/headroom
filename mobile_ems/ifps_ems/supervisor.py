# -*- coding: utf-8 -*-
"""운영 감시 판정: 통신 감시(LinkMonitor), 지령 판단(Commander), 주·예비 서버 판정(Redundancy),
프로세스 감시(Watchdog), 재병입 동기 판정(sync_check), 시각 유지(TimeSync). 로직 설명서 11장.

이 모듈은 통신을 하지 않는다. 판단 자료만 받아 결정을 돌려준다. 실제 전송은 ifps_ems_rt.hal.RtCommander가 맡는다.
"""
from .config import SUP

NORMAL, DEGRADED, LOST, RESYNC = "정상", "경로 저하", "두절", "재조회 대기"


class Device:
    """지령 대상 장치의 판단 자료."""

    def __init__(self, name, on=False, manual=False, online=True, locked=False):
        self.name = name; self.on = on; self.manual = manual; self.online = online; self.locked = locked
        self.last_seq = 0

    def as_dict(self):
        return {"name": self.name, "on": self.on, "manual": self.manual, "online": self.online, "locked": self.locked, "last_seq": self.last_seq}


class Commander:
    """지령 전 상태 확인(모순·중복·수동·잠금·두절 차단)과 응답 확인 뼈대.

    send()는 통신 없는 논리 모형이다(장치가 곧바로 응답한다고 본다). 실장치는 하위 클래스가 send를 바꾼다.
    fallback: 지령 실패 시 대체 전원. 기본은 디젤과 연료전지가 서로 대체.
    """

    def __init__(self, devices, fallback=None):
        self.dev = devices
        fb = {"DG": ["FC"], "FC": ["DG"]} if fallback is None else fallback
        self.fallback = {k: [a for a in v if a in devices] for k, v in fb.items() if k in devices}
        self.seq = 0; self.log = []

    def check(self, did, cmd):
        """보내면 안 되는 이유를 돌려준다. 빈 문자열이면 보내도 된다."""
        if did not in self.dev: return "정의되지 않은 장치"
        if cmd not in ("start", "stop", "close", "open"): return f"정의되지 않은 지령 {cmd}"
        d = self.dev[did]
        if not d.online: return "통신 두절"
        if d.locked: return "작업 잠금"
        if d.manual: return "현장 수동 모드"
        want = cmd in ("start", "close")
        if want and d.on: return "이미 운전·투입 상태(중복 지령)"
        if not want and not d.on: return "이미 정지·개방 상태(중복 지령)"
        return ""

    def send(self, did, cmd, t=0.0, ttl=None, _depth=0):
        why = self.check(did, cmd)
        if why:
            self.log.append({"t": t, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} {cmd} 차단: {why}"}); return False, 0.0
        self.seq += 1; d = self.dev[did]; d.on = cmd in ("start", "close"); d.last_seq = self.seq
        self.log.append({"t": t, "dev": did, "cmd": cmd, "ok": True, "text": f"{did} {cmd} 응답 확인(순번 {self.seq})"})
        return True, 0.0


class LinkMonitor:
    """장치별 통신 경로(A·B) 감시. 두 경로 모두 comm_s 넘게 무응답이면 두절, 한 경로만 살아 있으면 경로 저하.
    두절에서 응답이 돌아오면 '재조회 대기'로 두고, 전 상태를 다시 읽어 반영(resync)한 뒤 정상으로 되돌린다."""

    def __init__(self, names, paths=("A", "B"), comm_s=None):
        self.paths = tuple(paths); self.comm_s = SUP["comm_s"] if comm_s is None else comm_s
        self.last = {n: {p: 0.0 for p in self.paths} for n in names}
        self.state = {n: NORMAL for n in names}; self.since = {n: 0.0 for n in names}

    def heartbeat(self, name, t, path="A"):
        self.last[name][path] = t

    def alive_paths(self, name, t):
        return [p for p, tl in self.last[name].items() if t - tl <= self.comm_s]

    def check(self, t):
        """상태를 갱신한다. 반환: 이번에 바뀐 장치의 새 상태 {이름: 상태}."""
        changed = {}
        for n, st in self.state.items():
            k = len(self.alive_paths(n, t)); new = st
            if st in (NORMAL, DEGRADED):
                new = LOST if k == 0 else (DEGRADED if k < len(self.paths) else NORMAL)
            elif st == LOST:
                if k > 0: new = RESYNC
            elif st == RESYNC:
                if k == 0: new = LOST
            if new != st:
                self.state[n] = new; self.since[n] = t; changed[n] = new
        return changed

    def resync(self, name, new_vals, old_vals, t):
        """복구 뒤 첫 수집 값과 직전 값을 비교한다. 반환: 달라진 이름 목록."""
        diff = [k for k, v in new_vals.items() if old_vals.get(k) is None or abs(float(v) - float(old_vals[k])) > 1e-9]
        self.state[name] = NORMAL if len(self.alive_paths(name, t)) == len(self.paths) else DEGRADED; self.since[name] = t
        return diff

    def controllable(self, name):
        return self.state[name] in (NORMAL, DEGRADED)


class Watchdog:
    """프로세스 생존 감시. 이름마다 kick 간격이 wd_s를 넘으면 정지로 판정한다."""

    def __init__(self, names, wd_s=None):
        self.wd_s = SUP["wd_s"] if wd_s is None else wd_s; self.last = {n: None for n in names}

    def kick(self, name, t):
        self.last[name] = t

    def check(self, t):
        return [n for n, tl in self.last.items() if tl is not None and t - tl > self.wd_s]


class Redundancy:
    """주·예비 서버 판정. 예비 서버는 감시 2경로 모두에서 주 서버 무응답을 확인할 때만 지령권을 인수한다
    (회선 하나만 끊긴 경우에는 절체하지 않아 두 서버가 동시에 지령권을 갖지 않는다)."""

    def __init__(self, role="primary"):
        self.role = role; self.last = {"A": 0.0, "B": 0.0}; self.t_lost = None; self.active = role == "primary"

    def peer_heartbeat(self, path, t):
        self.last[path] = t

    def step(self, t):
        if self.role == "primary": return self.active
        lost = all(t - tl > SUP["failover_detect_s"] for tl in self.last.values())
        if not lost: self.t_lost = None; self.active = False; return False
        if self.t_lost is None: self.t_lost = t
        if t - self.t_lost >= SUP["failover_take_s"]: self.active = True
        return self.active


def sync_check(df_hz, dv_pct, dph_deg):
    """재병입 동기 판정. 위상 차는 차단기 투입 시간 동안 미끄러지는 각도를 더해 본다. 반환: (투입 허용, 사유)."""
    u = SUP["sync_use"]; slip = 360 * abs(df_hz) * SUP["cb_close_s"]; ph = abs(dph_deg) + slip
    bad = []
    if abs(df_hz) > SUP["sync_df_hz"] * u: bad.append(f"주파수 차 {abs(df_hz):.3f}Hz")
    if abs(dv_pct) > SUP["sync_dv_pct"] * u: bad.append(f"전압 차 {abs(dv_pct):.2f}%")
    if ph > SUP["sync_dph_deg"] * u: bad.append(f"위상 차 {ph:.1f}°(보정 포함)")
    return (not bad), ("허용" if not bad else "거부: " + ", ".join(bad))


class TimeSync:
    """시각 기준 상실 후 유지 시간 추정. 오차 = 경과 시간 × 발진기 편차."""

    def __init__(self):
        self.t_sync = 0.0

    def synced(self, t):
        self.t_sync = t

    def error_ms(self, t):
        return (t - self.t_sync) * SUP["ts_drift_ppm"] * 1e-3

    def ok(self, t):
        return self.error_ms(t) <= SUP["ts_err_ms"]
