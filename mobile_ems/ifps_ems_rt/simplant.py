# -*- coding: utf-8 -*-
"""가상 장치(Modbus TCP 서버). 실장치가 오기 전에 연동 계층을 통신 수준에서 시험한다.

장치 번호(unit)마다 레지스터 묶음을 두고, 지령 규약(hal.py)에 따라 응답한다. 한 프로세스가 통신 경로 A·B 두 포트를 연다.
시험용 조작: mute(장치) 무응답, noack(장치) 지령을 받고도 동작하지 않음, path_down(경로) 경로 단절.
"""
import math, socket, socketserver, struct, threading, time
from . import modbus as mb, fleet, busplan


class Plant:
    def __init__(self, pts, units, ack_delay=0.2):
        self.pts = pts; self.units = units; self.rev = {u: d for d, u in units.items()}
        self.reg = {d: {} for d in units}; self.lock = threading.Lock(); self.ack_delay = ack_delay
        self.gone = {d for d in units if fleet.is_slot(d)}                # 놓지 않은 장치(접속을 바로 끊는다). 같은 종류 추가 자리는 처음에 비어 있다
        self.bus = dict(busplan.DEFAULT)                                  # 모선 구성(화면부의 모선 구성이 넣는다)
        self.save = set(); self.save_frac = {"L2": 0.3, "L3": 0.3}; self.load_scale = {1: 1.0, 2: 1.0, 3: 1.0}      # 절감 공급 중인 급전선 · 절감 비율 · 부하 배율(부하 목록이 넣는다)
        self.muted = set(); self.no_ack = set(); self.down = set(); self.pending = {}; self.srv = []; self.run = False; self._exp_t = None
        self.slow = {}             # {장치: 초} 지령 수용(seq_ack) 뒤 상태가 바뀌기까지 걸리는 시간(기동이 느린 장비 모사)
        self.later = {}            # {장치: (시각, 상태)} 예약된 상태 변화
        self.by_tag = {p["tag"]: p for p in pts}
        for p in pts:                                                     # 대응표에 있는 주소만 존재한다(그 밖의 주소를 읽으면 예외 02)
            for i in range(mb.NREG[p["type"]]): self.reg[p["device"]][(p["fc"], p["addr"] + i)] = 0
        for tag, v in {"LOAD.kw": 80.0, "LOAD.p1_kw": 30.0, "LOAD.p2_kw": 30.0, "LOAD.p3_kw": 20.0, "PV.kw": 40.0, "ESS.soc": 60.0, "ESS.status": 1,
                       "H2.nm3": 700.0, "DG.fuel_l": 900.0, "GDG.fuel_pct": 85.0, "ENV.temp": 20.0, "ENV.press": 1013.0, "ENV.rh": 50.0, "BUS.hz": 60.0,
                       "PV.status": 1, **{f"CB.{f}": 1 for f in ("PV", "DG", "FC", "ESS", "G1", "TIE", "L1", "L2", "L3")}}.items():
            if tag in self.by_tag: self.set(tag, v)
        for d in units:                                                   # 추가 자리의 장치도 첫 장치와 같은 처음 값
            for suf, v in (("soc", 60.0), ("status", 1 if fleet.kind(d) in ("ESS", "PV") else 0), ("fuel_l", 900.0)):
                if fleet.is_slot(d) and f"{d}.{suf}" in self.by_tag: self.set(f"{d}.{suf}", v)
            for suf, v in (("ess_soc", 70.0), ("mode_set", 3)):               # 복합전력 PCS: 처음에는 ESS 방전 모드(계통 형성), 충전율 70%
                if fleet.kind(d) == "DG" and f"{d}.{suf}" in self.by_tag: self.set(f"{d}.{suf}", v)

    hy = {"stop": 0, "gen": 1, "charge": 2, "ess": 3}                 # 복합전력 PCS 의 모드 값(hybrid.CODE 와 같다). 설정에서 바꾸면 set_hybrid 로 맞춘다

    def set_hybrid(self, code):
        """복합전력 PCS 의 모드 값을 설정대로 맞추고, 놓인 PCS 를 'ESS 방전' 모드로 둔다(가상 장치의 처음 상태)."""
        self.hy = dict(code)
        for d in self.units:
            if fleet.kind(d) == "DG" and f"{d}.mode_set" in self.by_tag: self.set(f"{d}.mode_set", self.hy["ess"])

    def us(self, k):
        """그 종류의 놓인 장치 이름들."""
        return [d for d in self.units if fleet.kind(d) == k and d not in self.gone and f"{d}.status" in self.by_tag]

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
    def tick(self, dt, *, now=None):
        now = time.monotonic() if now is None else now
        for dev in self.units:
            if dev in self.gone: continue
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
        """EMS 부하 지령 → 복구(1) · 차단(2)은 보호 IED 가 차단기를 조작하고, 절감 공급(3)은 그 급전선의 줄일 수 있는 부하만 줄인다(차단기는 그대로)."""
        for f, tag in (("L2", "LOAD.p2_kw"), ("L3", "LOAD.p3_kw")):
            t = f"LDS.{f}"; v = int(round(self.get(t))) if t in self.by_tag else 0
            if v not in (1, 2, 3): continue
            was = f in self.save; now = v == 3; fr = self.save_frac.get(f, 0.0)
            if now != was and tag in self.by_tag and 0 < fr < 1:        # 절감에 들어가거나 풀릴 때 그 급전선의 부하를 한 번 바꾼다(가상 장치 구동기가 있으면 그쪽이 매초 다시 계산한다)
                p = self.get(tag); q = p * (1 - fr) if now else p / (1 - fr); self.set(tag, q)
                if "LOAD.kw" in self.by_tag: self.set("LOAD.kw", max(0.0, self.get("LOAD.kw") + q - p))
            (self.save.add if now else self.save.discard)(f)
            if v != 3: self.set(f"CB.{f}", 1 if v == 1 else 0); self.set(f"FLT.{f}", 0)
            self.set(t, 0)

    def _g(self, t): return self.get(t) if t in self.by_tag else 0.0
    def _cb(self, f): return (int(round(self.get(f"CB.{f}"))) == 1) if f"CB.{f}" in self.by_tag else True     # 차단기 투입(1)일 때만 모선과 연결
    def _put(self, pairs):
        for tag, v in pairs:
            if tag in self.by_tag: self.set(tag, v)

    def _tick_power(self, now, dt):
        """전력 수지: 디젤·연료전지·수전해 출력과 ESS 충·방전(나머지), 모선 전압·주파수."""
        g = self._g; ess_u = self.us("ESS"); n_e = max(1, len(ess_u)); self._dt = dt; dg, fc, elz = self._tick_units()
        ess_set = sum(g(f"{u}.kw_set") for u in ess_u); soc_avg = sum(g(f"{u}.soc") for u in ess_u) / n_e
        net = g("LOAD.kw") + elz - g("PV.kw") - dg - fc
        self._tick_tied(now, dt, net, ess_u, ess_set, soc_avg)

    def _tick_units(self):
        """장치마다 출력을 낸다(같은 종류가 여러 대면 대마다). 반환: (디젤 합, 연료전지 합, 수전해 합) kW"""
        g, cb = self._g, self._cb; dg = fc = elz = 0.0
        for u in self.us("DG"): dg += self._tick_hybrid(u, cb("DG"))
        for u in self.us("FC"): x = (100.0 * g(f"{u}.status") * 0.05 if g(f"{u}.kw_set") == 0 else g(f"{u}.kw_set") * g(f"{u}.status")) * cb("FC"); self._put(((f"{u}.kw", x),)); fc += x
        for u in self.us("ELZ"): x = 150.0 * g(f"{u}.status"); self._put(((f"{u}.kw", x), (f"{u}.h2_rate", 30.0 * g(f"{u}.status")))); elz += x      # 수전해 소비(150kW, 30Nm³/h)
        self._put([(f"{u}.lim", g(f"{u}.lim_set") or 400.0) for u in self.us("PV")])
        return dg, fc, elz

    def _tick_hybrid(self, u, closed):
        """복합전력 PCS 한 대: 발전기 90 kW, ESS 200 kWh. 모드 2 는 발전기가 20 kW 로 ESS 를 충전한다. 모드 3(ESS 방전)의 방전 전력은 _hybrid_cover 가 정한다. 반환: 모선으로 나가는 전력(kW)"""
        g = self._g; on = g(f"{u}.status") > 0.5; gen = 90.0 * on * closed
        if f"{u}.mode_set" not in self.by_tag: self._put(((f"{u}.kw", gen),)); return gen
        want = int(round(g(f"{u}.mode_set"))); soc = g(f"{u}.ess_soc"); c = self.hy
        key = ("charge" if want == c["charge"] else "gen") if on else ("ess" if want == c["ess"] else "stop"); mode = c[key]      # 충전은 충전 모드 지령을 받았을 때만(지령 없이 발전기만 돌면 발전기 단독)
        ess = (-20.0 if soc < 100.0 else 0.0) if key == "charge" else 0.0
        ess *= closed; dt = self._dt
        self._put(((f"{u}.kw", gen), (f"{u}.ess_kw", ess), (f"{u}.pcs_mode", mode), (f"{u}.ess_soc", min(100.0, max(0.0, soc - ess * dt / 3600.0 / 200.0 * 100.0)))))
        return gen + ess

    def _hybrid_cover(self, short, dt):
        """자립 운전에서 이동형 ESS(②)가 맡지 못한 부족분을 'ESS 방전' 모드의 복합전력 ESS 가 방전해 메운다(대마다 100 kW 까지, 충전율 5% 위에서).
        이동형 ESS 가 있으면 그쪽이 먼저 부담하는 것으로 단순화했다(실제 분담은 두 PCS 의 수하 특성에 따른다 — 가정)."""
        g = self._g; us = [u for u in self.us("DG") if f"{u}.pcs_mode" in self.by_tag and int(round(g(f"{u}.pcs_mode"))) == self.hy["ess"] and g(f"{u}.ess_soc") > 5.0 and self._cb("G1")]
        for u in us:
            x = min(100.0, max(0.0, short) / len(us)); self._put(((f"{u}.ess_kw", x), (f"{u}.ess_soc", max(0.0, g(f"{u}.ess_soc") - x * dt / 3600.0 / 200.0 * 100.0))))

    def _tick_tied(self, now, dt, net, ess_u, ess_set, soc_avg):
        """상전·주둔지 발전기·ESS 가 나머지 전력을 나누어 맡는다."""
        g, cb = self._g, self._cb; n_e = max(1, len(ess_u))
        tied = "CB.GRID" in self.by_tag and int(round(self.get("CB.GRID"))) == 1
        if tied and "GDG.status" in self.by_tag:
            self.set("GDG.kw", 0.0)
            if int(round(g("CB.GDG"))) != 2: self.set("CB.GDG", 0)
        if tied:                                                             # 상전 연계: ESS 는 EMS 지령대로(충전율 한계 안에서), 나머지는 상전이 메운다
            soc = soc_avg; sp = ess_set; ess = (min(sp, 500.0 * n_e) if soc > 10.5 else min(sp, 0.0)) if sp >= 0 else (max(sp, -500.0 * n_e) if soc < 89.5 else 0.0)
            ess *= cb("ESS"); grid = net - ess
            self._exp_t = self._exp_t if (grid < -20 and self._exp_t is not None) else now
            if now - self._exp_t > 3.0: self.set("CB.GRID", 2); self.set("FLT.GRID", 32)        # 역송 3초 지속 → 역전력 보호(32) 트립
        else:
            gdg = 0.0
            if "GDG.status" in self.by_tag:                                   # 주둔지 디젤발전기: 운전 중이면 차단기 투입, ESS 지령을 뺀 나머지를 부담
                on = g("GDG.status") > 0.5 and int(round(g("CB.GDG"))) != 2
                self.set("CB.GDG", 2 if int(round(g("CB.GDG"))) == 2 else int(on))
                if on: gdg = min(1000.0, max(0.0, net - max(-500.0 * n_e, min(500.0 * n_e, ess_set))))
                self.set("GDG.kw", gdg); self.set("GDG.fuel_pct", max(0.0, g("GDG.fuel_pct") - gdg * 0.26 / 5000.0 * 100.0 * dt / 3600.0))
            ess = (net - gdg) * cb("ESS"); grid = 0.0; self._hybrid_cover((net - gdg) - (ess if ess_u else 0.0), dt); self._exp_t = now                        # 연계가 아닐 때는 역송 시간을 세지 않는다(재투입 직후 곧바로 트립하지 않게)
        if "BUS.a_v" in self.by_tag: self._tick_bus(now)
        self._put((("GRID.kw", grid),))
        for u in ess_u: self._put(((f"{u}.kw", ess / n_e), (f"{u}.soc", min(90.0, max(10.0, g(f"{u}.soc") - ess / n_e * dt / 3600 / 1000.0 * 100)))))     # 여러 대면 똑같이 나누어 부담

    def _tick_bus(self, now):
        g, cb = self._g, self._cb
        on = lambda k: any(g(f"{u}.status") > 0.5 for u in self.us(k))
        up = {u for n in ("DG", "FC", "ESS") if cb(n) for u in self.us(n) if g(f"{u}.status") > 0.5} | {n for n in ("GDG", "GRID") if f"CB.{n}" in self.by_tag and int(round(self.get(f"CB.{n}"))) == 1}      # 운전 중인 장치 하나하나(호기마다 물린 모선이 다를 수 있다)
        if cb("G1"): up.add("G1")
        a_live, b_live = busplan.live(self.bus, up, cb("TIE"))            # 모선 구성(어느 전원이 어느 모선에 물렸는지)대로
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
                        except socket.timeout: continue                   # 조용한 접속: 계속 기다린다
                        except OSError: return                            # 끊긴 접속(상대가 닫음 · 재설정): 붙잡고 헛돌지 않는다 — 헛도는 스레드가 쌓이면 모든 장치의 응답이 늦어진다
                        if len(head) < 7: return
                        tid, _, length, unit = struct.unpack(">HHHB", head); pdu = b""
                        while len(pdu) < length - 1:
                            c = self.request.recv(length - 1 - len(pdu))
                            if not c: return
                            pdu += c
                        dev = plant.rev.get(unit)
                        if path in plant.down or dev in plant.gone: return
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
