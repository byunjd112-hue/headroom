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
        self.by_tag = {p["tag"]: p for p in pts}
        for tag, v in {"LOAD.kw": 80.0, "LOAD.p1_kw": 30.0, "LOAD.p2_kw": 30.0, "LOAD.p3_kw": 20.0, "PV.kw": 40.0, "ESS.soc": 60.0, "ESS.status": 1,
                       "H2.nm3": 700.0, "DG.fuel_l": 900.0, "ENV.temp": 20.0, "ENV.press": 1013.0, "ENV.rh": 50.0, "BUS.hz": 60.0,
                       **{f"CB.{f}": 1 for f in ("PV", "DG", "FC", "ESS", "G1", "TIE", "L1", "L2", "L3")}}.items():
            if tag in self.by_tag: self.set(tag, v)

    # 공학값 접근
    def set(self, tag, value):
        p = self.by_tag[tag]
        with self.lock:
            for i, r in enumerate(mb.encode(value, p["type"], p["scale"])): self.reg[p["device"]][(p["fc"], p["addr"] + i)] = r

    def get(self, tag):
        p = self.by_tag[tag]
        with self.lock:
            regs = [self.reg[p["device"]].get((p["fc"], p["addr"] + i), 0) for i in range(mb.NREG[p["type"]])]
        return mb.decode(regs, p["type"], p["scale"])

    # 장치 거동
    def tick(self, dt):
        now = time.monotonic()
        for dev in self.units:
            if f"{dev}.cmd" not in self.by_tag: continue
            cmd = int(round(self.get(f"{dev}.cmd"))); seq = int(round(self.get(f"{dev}.seq")))
            if cmd and dev not in self.no_ack and int(round(self.get(f"{dev}.mode"))) == 0:
                due = self.pending.setdefault((dev, seq), now + self.ack_delay)
                if now >= due:
                    self.set(f"{dev}.status", 1 if cmd == 1 else 0); self.set(f"{dev}.seq_ack", seq); self.set(f"{dev}.cmd", 0); self.pending.pop((dev, seq), None)
            if f"{dev}.hb" in self.by_tag: self.set(f"{dev}.hb", (int(round(self.get(f"{dev}.hb"))) + 1) % 60000)
        g = lambda t: self.get(t) if t in self.by_tag else 0.0
        cb = lambda f: (int(round(self.get(f"CB.{f}"))) == 1) if f"CB.{f}" in self.by_tag else True     # 차단기 투입(1)일 때만 모선과 연결
        dg = 90.0 * g("DG.status") * cb("DG"); fc = (100.0 * g("FC.status") * 0.05 if g("FC.kw_set") == 0 else g("FC.kw_set") * g("FC.status")) * cb("FC")
        ess = (g("LOAD.kw") - g("PV.kw") - dg - fc) * cb("ESS")
        if "BUS.a_v" in self.by_tag:
            a_live = cb("DG") and g("DG.status") > 0.5 or cb("FC") and g("FC.status") > 0.5 or (cb("TIE") and (cb("ESS") or cb("G1")))
            b_live = (cb("ESS") and g("ESS.status") > 0.5) or cb("G1") or (cb("TIE") and a_live)
            self.set("BUS.a_v", 440.0 + (abs(math.sin(now)) * 1.5) if a_live else 0.0); self.set("BUS.b_v", 440.0 + abs(math.cos(now)) * 1.5 if b_live else 0.0)
            self.set("BUS.hz", 60.0 + math.sin(now / 7) * 0.03 if (a_live or b_live) else 0.0)
        for tag, v in (("DG.kw", dg), ("FC.kw", fc), ("ESS.kw", ess)):
            if tag in self.by_tag: self.set(tag, v)
        if "ESS.soc" in self.by_tag: self.set("ESS.soc", min(90.0, max(10.0, g("ESS.soc") - ess * dt / 3600 / 1000.0 * 100)))

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

        socketserver.ThreadingTCPServer.allow_reuse_address = True; socketserver.ThreadingTCPServer.daemon_threads = True
        self.run = True
        for p in ports:
            s = socketserver.ThreadingTCPServer((host, p), H); self.srv.append(s); threading.Thread(target=s.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()

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
                addr, n = struct.unpack(">HH", pdu[1:5]); return struct.pack(">BB", fc, 2 * n) + struct.pack(f">{n}H", *[bank.get((fc, addr + i), 0) for i in range(n)])
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
