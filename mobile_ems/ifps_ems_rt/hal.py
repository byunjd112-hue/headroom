# -*- coding: utf-8 -*-
"""장치 접속 계층. 장치마다 통신 경로 2개(A·B)를 두고, 대응표에 따라 값을 읽고 지령을 쓴다.

지령 규약(TPCS 표준 인터페이스. 제작사 주소는 대응표에서 맞춘다)
  <장치>.status   0 정지·개방, 1 운전·투입
  <장치>.mode     0 자동(TPCS 지령 수용), 1 수동(현장 조작)
  <장치>.cmd      0 없음, 1 기동·투입, 2 정지·개방
  <장치>.seq      TPCS가 지령과 함께 쓰는 순번
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

    def __init__(self, name, paths, unit, pts, allow, timeout=0.5, gap=0):
        self.name = name; self.pts = [p for p in pts if p["device"] == name]; self.by_tag = {p["tag"]: p for p in self.pts}
        self.cl = {k: mb.Client(h, pt, unit, timeout, allow) for k, (h, pt) in zip("AB", paths)}
        self.blk = blocks(pts, name, gap); self.alive = {k: False for k in self.cl}; self.err = ""; self.miss = []      # miss: 장치가 '없는 주소'라고 답해 읽지 못한 점 이름

    def read_blocks(self, cl):
        vals = {}; miss = []; t0 = time.monotonic()
        for fc, addr, n, ps in self.blk:
            if time.monotonic() - t0 > 2.0 * cl.timeout: raise mb.ModbusError("장치 응답 지연(읽기 전체 한도 초과)")
            try: regs = cl.read(addr, n, fc)
            except mb.DeviceException as e:
                if e.code not in (1, 2, 3): raise                  # 장치 고장 · 게이트웨이 무응답은 통신 실패로 본다
                miss += [p["tag"] for p in ps]; continue           # 없는 주소 · 기능: 그 블록만 빼고 나머지는 읽는다(장치는 살아 있다)
            for p in ps:
                o = p["addr"] - addr; vals[p["tag"]] = mb.decode(regs[o:o + NREG[p["type"]]], p["type"], p["scale"], p.get("order", "ABCD"))
        if miss and not vals: raise mb.ModbusError("장치 예외 응답(모든 블록) — 주소 대응표 확인")
        self.miss = miss; return vals

    def read_all(self):
        """두 경로를 모두 확인한다. 값은 먼저 성공한 경로 것을 쓴다. 반환: 값 사전(둘 다 실패하면 None)."""
        vals = None
        for k, cl in self._order():
            try:
                v = self.read_blocks(cl); self.alive[k] = True
                if vals is None: vals = v
            except mb.ModbusError as e:
                self.alive[k] = False; self.err = str(e)
        return vals

    def _order(self):
        """살아 있는 경로를 먼저 쓴다(죽은 경로의 시간 초과를 지령 응답 대기에 얹지 않는다)."""
        return sorted(self.cl.items(), key=lambda kc: not self.alive[kc[0]])

    def write_regs(self, addr, regs):
        """원시 레지스터 쓰기(여러 개면 한 프레임 FC16). 반환: 성공 여부."""
        for k, cl in self._order():
            try:
                cl.write(addr, regs, fc=16 if len(regs) > 1 else None); self.alive[k] = True; return True
            except mb.ModbusError as e:
                self.alive[k] = False; self.err = str(e)
        return False

    def write(self, tag, value):
        """지령 쓰기. 살아 있는 경로로 보낸다. 반환: 성공 여부."""
        p = self.by_tag[tag]
        if p["rw"] != "w": raise mb.ModbusError(f"쓰기 금지 점: {tag}")
        try: regs = mb.encode(value, p["type"], p["scale"], p.get("order", "ABCD"))
        except mb.ModbusError as e: self.err = f"{tag}: {e}"; return False     # 범위 밖 값은 보내지 않는다(경로는 정상)
        return self.write_regs(p["addr"], regs)

    def close(self):
        for cl in self.cl.values(): cl.close()


class RtCommander(sv.Commander):
    """실장치 지령. 지령 전 상태 확인(모순·중복·수동·잠금·두절 차단)은 핵심 프로그램 논리를 그대로 쓰고,
    전송·응답 확인만 실제 통신으로 바꾼다. 응답은 장치가 순번을 되돌려 쓰고 상태가 바뀐 것으로 확인한다."""

    def __init__(self, links, devices, fallback=None, clock=time.monotonic, poll_s=0.1):
        super().__init__(devices, fallback); self.links = links; self.clock = clock; self.poll_s = poll_s
        self.gate = None       # gate(장치) → 지령 가능 여부. 실행기가 통신 상태·생존 계수 판정을 연결한다
        self.tick = None       # 응답 대기 중 주기적으로 부르는 함수(프로세스 감시 갱신)
        self.done_s = {}       # 장치별 상태 변화 완료 한도(초). 없으면 done_default. 기동에 시간이 걸리는 장비용
        self.done_default = 0.0   # 장치별 값이 없을 때의 완료 한도(초). 실행기가 설정(done_s, 기본 20초)에서 넣는다
        self.took = {}         # 장치별 지령 완료에 걸린 가장 긴 시간(초) — 완료 한도를 정하는 근거로 화면에 보인다

    def refresh(self, did):
        """장치의 현재 상태를 읽어 판단 자료를 갱신한다."""
        d = self.dev[did]; v = self.links[did].read_all()
        d.online = v is not None and (self.gate is None or bool(self.gate(did)))     # 수집 쪽 판정(재조회 대기·hb 정지)을 덮어쓰지 않는다
        if v is not None:
            d.on = int(round(v.get(f"{did}.status", 0))) == 1; d.manual = int(round(v.get(f"{did}.mode", 0))) == 1
            d.last_seq = int(round(v.get(f"{did}.seq_ack", d.last_seq)))
        return v

    def _write_cmd(self, did, code):
        """순번과 지령을 쓴다. 두 주소가 이웃한 16비트 점이면 한 프레임(FC16)으로 써서 장치가 새 순번과 옛 지령을 함께 보는 틈을 없앤다."""
        lk = self.links[did]; pc, ps = lk.by_tag[f"{did}.cmd"], lk.by_tag[f"{did}.seq"]
        if ps["addr"] == pc["addr"] + 1 and pc["type"] == ps["type"] == "u16" and pc["scale"] == ps["scale"] == 1:
            o = pc.get("order", "ABCD"); return lk.write_regs(pc["addr"], mb.encode(code, "u16", 1, o) + mb.encode(self.seq, "u16", 1, ps.get("order", o)))
        return lk.write(f"{did}.seq", self.seq) and lk.write(f"{did}.cmd", code)

    def _idle(self, t_end):
        """쓰기 실패: 응답 대기와 같은 시간만큼 기다렸다 다시 보낸다(기다리는 동안에도 프로세스 감시를 갱신)."""
        while self.clock() < t_end:
            if self.tick: self.tick()
            time.sleep(self.poll_s)

    def _cancel(self, did, cmd, t0):
        """응답 없이 끝난 지령은 취소(cmd=0)해 둔다. 남겨 두면 장치가 늦게 회복될 때 잔류 지령이 뒤늦게 실행된다."""
        if self.tick: self.tick()
        cancelled = self.links[did].write(f"{did}.cmd", 0)
        self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} {cmd} 지령 취소(cmd=0) {'완료' if cancelled else '실패 — 현장 확인 필요'}"})

    def send(self, did, cmd, t=None, ttl=None, _depth=0):
        t0 = self.clock(); self.refresh(did)
        why = self.check(did, cmd)
        if why:
            self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} {cmd} 차단: {why}"}); return False, self.clock() - t0
        d = self.dev[did]; want = cmd in ("start", "close")
        for n in range(1 + SUP["retry"]):
            self.seq = max(self.seq, d.last_seq) % 65535 + 1     # 1~65535 순환(u16)
            t_try = self.clock(); sent = self._write_cmd(did, CMD[cmd])
            t_end = self.clock() + SUP["ack_s"]; acked = False
            while sent and self.clock() < t_end:
                if self.tick: self.tick()
                v = self.links[did].read_all()
                if v is not None and not acked and int(round(v.get(f"{did}.seq_ack", -1))) == self.seq:
                    acked = True; t_end = max(t_end, self.clock() + self.done_s.get(did, self.done_default))        # 수용 확인 → 상태 변화는 완료 한도까지 기다린다
                if v is not None and acked and (int(round(v.get(f"{did}.status", 0))) == 1) == want:
                    d.on = want; d.last_seq = self.seq; self.took[did] = max(self.took.get(did, 0.0), self.clock() - t_try)
                    self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": True, "text": f"{did} {cmd} 응답 확인(순번 {self.seq}" + (f", 재지령 {n}회" if n else "") + ")"})
                    return True, self.clock() - t0
                time.sleep(self.poll_s)
            if not sent: self._idle(t_end)
            self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} {cmd} " + (f"수용했으나 상태 미변화({self.clock() - t_try:.1f}초)" if acked else f"무응답({SUP['ack_s']:.1f}초)")})
            if acked: break                                          # 받아들인 장치에는 같은 지령을 다시 보내지 않는다(완료 한도까지 기다렸다)
        self._cancel(did, cmd, t0)
        for alt in self.fallback.get(did, []) if _depth == 0 and cmd == "start" else []:      # 대체는 기동 실패 때만(정지 실패를 다른 전원의 정지로 바꾸지 않는다)
            self.log.append({"t": self.clock() - t0, "dev": did, "cmd": cmd, "ok": False, "text": f"{did} 지령 실패 → 대체 전원 {alt} 지령, 경보"})
            ok, _ = self.send(alt, cmd, _depth=1)
            if ok: return True, self.clock() - t0
        return False, self.clock() - t0
