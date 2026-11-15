# -*- coding: utf-8 -*-
"""가상 장치(Modbus TCP 서버). 실장치가 오기 전에 연동 계층을 통신 수준에서 시험한다.

장치 번호(unit)마다 레지스터 묶음을 두고, 지령 규약(hal.py)에 따라 응답한다. 한 프로세스가 통신 경로 A·B 두 포트를 연다.
시험용 조작: mute(장치) 무응답, noack(장치) 지령을 받고도 동작하지 않음, path_down(경로) 경로 단절.
"""
import math, socketserver, struct, threading, time
from . import modbus as mb


class Plant:
    def __init__(self, pts, units, ack_delay=0.2):
        self.pts = pts; self.units = units; self.rev = {u: d for d, u in units.items()}
        self.reg = {d: {} for d in units}; self.lock = threading.Lock(); self.ack_delay = ack_delay
        self.muted = set(); self.no_ack = set(); self.down = set(); self.pending = {}; self.srv = []; self.run = False
        self.slow = {}             # {장치: 초} 지령 수용(seq_ack) 뒤 상태가 바뀌기까지 걸리는 시간(기동이 느린 장비 모사)
        self.later = {}            # {장치: (시각, 상태)} 예약된 상태 변화
        self.by_tag = {p["tag"]: p for p in pts}
        for p in pts:                                                     # 대응표에 있는 주소만 존재한다(그 밖의 주소를 읽으면 예외 02)
            for i in range(mb.NREG[p["type"]]): self.reg[p["device"]][(p["fc"], p["addr"] + i)] = 0
        for tag, v in {"LOAD.kw": 80.0, "LOAD.p1_kw": 30.0, "LOAD.p2_kw": 30.0, "LOAD.p3_kw": 20.0, "PV.kw": 40.0, "ESS.soc": 60.0, "ESS.status": 1,
                       "H2.nm3": 700.0, "DG.fuel_l": 900.0, "ENV.temp": 20.0, "ENV.press": 1013.0, "ENV.rh": 50.0, "BUS.hz": 60.0,
                       "PV.status": 1, **{f"CB.{f}": 1 for f in ("PV", "DG", "FC", "ESS", "G1", "TIE", "L1", "L2", "L3")}}.items():
            if tag in self.by_tag: self.set(tag, v)

    # 공학값 접근
    def set(self, tag, value):
        p = self.by_tag[tag]
        with self.lock:
            for i, r in enumerate(mb.encode(value, p["type"], p["scale"], p.get("order", "ABCD"))): self.reg[p["device"]][(p["fc"], p["addr"] + i)] = r

    def get(self, tag):
        p = self.by_tag[tag]
        with self.lock:
            regs = [self.reg[p["device"]].get((p["fc"], p["addr"] + i), 0) for i in range(mb.NREG[p["type"]])]
        return mb.decode(regs, p["type"], p["scale"], p.get("order", "ABCD"))

    # 장치 거동
    def tick(self, dt):
        now = time.monotonic()
        for dev in self.units:
            if f"{dev}.hb" in self.by_tag: self.set(f"{dev}.hb", (int(round(self.get(f"{dev}.hb"))) + 1) % 60000)   # 지령 없는 장치(ESS)도 생존 계수는 올린다
            if f"{dev}.cmd" in self.by_tag: self._tick_cmd(dev, now)
        self._tick_shed(); self._tick_power(now, dt)

    def _tick_cmd(self, dev, now):
        """지령 처리: 순번·지령을 받으면 ack_delay 뒤 수용(seq_ack), slow 만큼 더 지나 상태 변화."""
        cmd = int(round(self.get(f"{dev}.cmd"))); seq = int(round(self.get(f"{dev}.seq")))
        if not cmd: self.pending = {k: v for k, v in self.pending.items() if k[0] != dev}          # 취소(cmd=0)된 지령은 버린다
        if cmd and dev not in self.no_ack and int(round(self.get(f"{dev}.mode"))) == 0:
            due = self.pending.setdefault((dev, seq), now + self.ack_delay)
            if now >= due:
                self.later[dev] = (now + self.slow.get(dev, 0.0), 1 if cmd == 1 else 0)
                self.set(f"{dev}.seq_ack", seq); self.set(f"{dev}.cmd", 0); self.pending.pop((dev, seq), None)
        if dev in self.later and now >= self.later[dev][0]: self.set(f"{dev}.status", self.later.pop(dev)[1])

    def _tick_shed(self):
        """EMS 부하 차단(2)·복구(1) 지령 → 보호 IED가 차단기 조작."""
        for f in ("L2", "L3"):
            t = f"LDS.{f}"
            if t in self.by_tag and int(round(self.get(t))) in (1, 2):
                self.set(f"CB.{f}", 1 if int(round(self.get(t))) == 1 else 0); self.set(f"FLT.{f}", 0); self.set(t, 0)

    def _g(self, t): return self.get(t) if t in self.by_tag else 0.0
    def _cb(self, f): return (int(round(self.get(f"CB.{f}"))) == 1) if f"CB.{f}" in self.by_tag else True     # 차단기 투입(1)일 때만 모선과 연결
    def _put(self, pairs):
        for tag, v in pairs:
            if tag in self.by_tag: self.set(tag, v)

    def _tick_power(self, now, dt):
        """전력 수지: 디젤·연료전지·수전해 출력과 ESS 충·방전(나머지), 모선 전압·주파수."""
        g, cb = self._g, self._cb
        dg = 90.0 * g("DG.status") * cb("DG"); fc = (100.0 * g("FC.status") * 0.05 if g("FC.kw_set") == 0 else g("FC.kw_set") * g("FC.status")) * cb("FC")
        elz = 150.0 * g("ELZ.status")                                         # 수전해 소비(150kW, 30Nm³/h)
        self._put((("ELZ.kw", elz), ("ELZ.h2_rate", 30.0 * g("ELZ.status")), ("PV.lim", g("PV.lim_set") or 400.0)))
        ess = (g("LOAD.kw") + elz - g("PV.kw") - dg - fc) * cb("ESS")
        if "BUS.a_v" in self.by_tag: self._tick_bus(now)
        self._put((("DG.kw", dg), ("FC.kw", fc), ("ESS.kw", ess)))
        if "ESS.soc" in self.by_tag: self.set("ESS.soc", min(90.0, max(10.0, g("ESS.soc") - ess * dt / 3600 / 1000.0 * 100)))

    def _tick_bus(self, now):
        g, cb = self._g, self._cb
        src_a = (cb("DG") and g("DG.status") > 0.5) or (cb("FC") and g("FC.status") > 0.5)
        a_live = src_a or (cb("TIE") and (cb("ESS") or cb("G1")))
        b_live = (cb("ESS") and g("ESS.status") > 0.5) or cb("G1") or (cb("TIE") and a_live)
        self.set("BUS.a_v", 440.0 + (abs(math.sin(now)) * 1.5) if a_live else 0.0); self.set("BUS.b_v", 440.0 + abs(math.cos(now)) * 1.5 if b_live else 0.0)
        self.set("BUS.hz", 60.0 + math.sin(now / 7) * 0.03 if (a_live or b_live) else 0.0)

    def start(self, ports, host="127.0.0.1", tick_s=0.05):
        plant = self

        class H(socketserver.BaseRequestHandler):
            def handle(self):
                path = "AB"[plant.srv.index(self.server)] if self.server in plant.srv else "A"
                self.request.settimeout(1.0)
                try:
                    while plant.run:
                        try: head = self.request.recv(7)
                        except OSError: continue
                        if len(head) < 7: return
                        tid, _, length, unit = struct.unpack(">HHHB", head); pdu = b""
                        while len(pdu) < length - 1:
                            c = self.request.recv(length - 1 - len(pdu))
                            if not c: return
                            pdu += c
                        dev = plant.rev.get(unit)
                        if path in plant.down: return
                        if dev is None or dev in plant.muted: continue          # 무응답(시간 초과 유도)
                        out = plant.serve(dev, pdu)
                        self.request.sendall(struct.pack(">HHHB", tid, 0, len(out) + 1, unit) + out)
                except OSError:
                    return

        class Srv(socketserver.ThreadingTCPServer):
            allow_reuse_address = True; daemon_threads = True; request_queue_size = 64      # 동시 접속(진단 도구 병렬 점검)에도 접속 대기열이 넘치지 않게
        self.run = True
        for p in ports:
            s = Srv((host, p), H); self.srv.append(s); threading.Thread(target=s.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

        def loop():
            while self.run:
                self.tick(tick_s); time.sleep(tick_s)
        threading.Thread(target=loop, daemon=True).start()
        return [s.server_address[1] for s in self.srv]

    def serve(self, dev, pdu):
        fc = pdu[0]
        with self.lock:
            bank = self.reg[dev]
            if fc in (3, 4):
                addr, n = struct.unpack(">HH", pdu[1:5])
                if any((fc, addr + i) not in bank for i in range(n)): return struct.pack(">BB", fc | 0x80, 2)      # 정의되지 않은 주소 → 예외 02 (실장비와 같게)
                return struct.pack(">BB", fc, 2 * n) + struct.pack(f">{n}H", *[bank[(fc, addr + i)] for i in range(n)])
            if fc == 6:
                addr, v = struct.unpack(">HH", pdu[1:5]); bank[(3, addr)] = v; return pdu[:5]
            if fc == 16:
                addr, n, _ = struct.unpack(">HHB", pdu[1:6])
                for i, v in enumerate(struct.unpack(f">{n}H", pdu[6:6 + 2 * n])): bank[(3, addr + i)] = v
                return pdu[:5]
        return struct.pack(">BB", fc | 0x80, 1)

    def stop(self):
        self.run = False
        for s in self.srv: s.shutdown(); s.server_close()
        self.srv = []
