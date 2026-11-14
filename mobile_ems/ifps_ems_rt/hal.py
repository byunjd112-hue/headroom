# -*- coding: utf-8 -*-
"""장치 접속 계층. 장치마다 통신 경로 2개(A·B)를 두고, 대응표에 따라 값을 읽고 지령을 쓴다.

지령 규약(EMS 표준 인터페이스. 제작사 주소는 대응표에서 맞춘다)
  <장치>.status   0 정지·개방, 1 운전·투입
  <장치>.mode     0 자동(EMS 지령 수용), 1 수동(현장 조작)
  <장치>.cmd      0 없음, 1 기동·투입, 2 정지·개방
  <장치>.seq      EMS가 지령과 함께 쓰는 순번
  <장치>.seq_ack  장치가 마지막으로 수용한 순번(장치가 되돌려 씀)
  <장치>.hb       장치가 주기적으로 올리는 생존 계수
"""
import time
from ifps_ems import supervisor as sv
from ifps_ems.config import SUP
from . import modbus as mb
from .pointmap import blocks, NREG

CMD = {"start": 1, "stop": 2, "close": 1, "open": 2}


class DeviceLink:
    """장치 하나의 통신. paths는 [(주소, 포트), (주소, 포트)] 두 경로다."""

    def __init__(self, name, paths, unit, pts, allow, timeout=0.5):
        self.name = name; self.pts = [p for p in pts if p["device"] == name]; self.by_tag = {p["tag"]: p for p in self.pts}
        self.cl = {k: mb.Client(h, pt, unit, timeout, allow) for k, (h, pt) in zip("AB", paths)}
        self.blk = blocks(pts, name); self.alive = {k: False for k in self.cl}; self.err = ""

    def _read_blocks(self, cl):
        vals = {}
        for fc, addr, n, ps in self.blk:
            regs = cl.read(addr, n, fc)
            for p in ps:
                o = p["addr"] - addr; vals[p["tag"]] = mb.decode(regs[o:o + NREG[p["type"]]], p["type"], p["scale"])
        return vals

    def read_all(self):
        """두 경로를 모두 확인한다. 값은 먼저 성공한 경로 것을 쓴다. 반환: 값 사전(둘 다 실패하면 None)."""
        vals = None
        for k, cl in self.cl.items():
            try:
                v = self._read_blocks(cl); self.alive[k] = True
                if vals is None: vals = v
            except mb.ModbusError as e:
                self.alive[k] = False; self.err = str(e)
        return vals

    def write(self, tag, value):
        """지령 쓰기. 살아 있는 경로로 보낸다. 반환: 성공 여부."""
        p = self.by_tag[tag]
        if p["rw"] != "w": raise mb.ModbusError(f"쓰기 금지 점: {tag}")
        for k, cl in self.cl.items():
            try:
                cl.write(p["addr"], mb.encode(value, p["type"], p["scale"])); self.alive[k] = True; return True
            except mb.ModbusError as e:
                self.alive[k] = False; self.err = str(e)
        return False

    def close(self):
        for cl in self.cl.values(): cl.close()


class RtCommander(sv.Commander):
    """실장치 지령. 지령 전 상태 확인(모순·중복·수동·잠금·두절 차단)은 핵심 프로그램 논리를 그대로 쓰고,
    전송·응답 확인만 실제 통신으로 바꾼다. 응답은 장치가 순번을 되돌려 쓰고 상태가 바뀐 것으로 확인한다."""

    def __init__(self, links, devices, fallback=None, clock=time.monotonic, poll_s=0.1):
        super().__init__(devices, fallback); self.links = links; self.clock = clock; self.poll_s = poll_s

    def refresh(self, did):
        """장치의 현재 상태를 읽어 판단 자료를 갱신한다."""
        d = self.dev[did]; v = self.links[did].read_all()
        d.online = v is not None
        if v is not None:
            d.on = int(round(v.get(f"{did}.status", 0))) == 1; d.manual = int(round(v.get(f"{did}.mode", 0))) == 1
            d.last_seq = int(round(v.get(f"{did}.seq_ack", d.last_seq)))
        return v

    def send(self, did, cmd, t=None, ttl=None, _depth=0):
        t0 = self.clock(); self.refresh(did)
        why = self.check(did, cmd)
        if why:
            self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} {cmd} 차단: {why}"}); return False, self.clock() - t0
        d = self.dev[did]; want = cmd in ("start", "close")
        for n in range(1 + SUP["retry"]):
            self.seq = max(self.seq, d.last_seq) + 1
            sent = self.links[did].write(f"{did}.seq", self.seq) and self.links[did].write(f"{did}.cmd", CMD[cmd])
            t_end = self.clock() + SUP["ack_s"]
            while sent and self.clock() < t_end:
                v = self.links[did].read_all()
                if v is not None and int(round(v.get(f"{did}.seq_ack", -1))) == self.seq and (int(round(v.get(f"{did}.status", 0))) == 1) == want:
                    d.on = want; d.last_seq = self.seq
                    self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": True, "text": f"{did} {cmd} 응답 확인(순번 {self.seq}" + (f", 재지령 {n}회" if n else "") + ")"})
                    return True, self.clock() - t0
                time.sleep(self.poll_s)
            if not sent: time.sleep(max(0.0, t_end - self.clock()))
            self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} {cmd} 무응답({SUP['ack_s']:.1f}초)"})
        for alt in self.fallback.get(did, []) if _depth == 0 else []:
            self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} 지령 실패 → 대체 전원 {alt} 지령, 경보"})
            ok, _ = self.send(alt, cmd, _depth=1)
            if ok: return True, self.clock() - t0
        return False, self.clock() - t0
