# -*- coding: utf-8 -*-
"""Modbus TCP 클라이언트(표준 라이브러리 socket만 사용).

지원 기능 코드: 01 코일 읽기, 02 접점 입력 읽기, 03 보유 레지스터 읽기, 04 입력 레지스터 읽기, 05 코일 쓰기, 06 레지스터 1개 쓰기, 16 레지스터 여러 개 쓰기.
접속은 허용 목록(allow)에 있는 주소로만 한다. 이름 풀이(DNS)는 하지 않는다.
"""
import ipaddress, socket, struct, threading, time


class ModbusError(Exception):
    pass


EXC = {1: "기능 코드 불가", 2: "주소 불가", 3: "값 불가", 4: "장치 고장", 5: "수락·처리 중", 6: "장치 바쁨", 10: "게이트웨이 경로 없음", 11: "게이트웨이 대상 무응답"}


def allowed(host, allow):
    """host가 허용 목록(주소 또는 대역 문자열 목록)에 들어 있는지 본다. 사설·루프백 주소가 아니면 목록에 있어도 거부한다."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False                                     # 이름은 받지 않는다
    if not (ip.is_private or ip.is_loopback):
        return False
    return any(ip in ipaddress.ip_network(a, strict=False) for a in allow)


class Client:
    """장치 하나(주소·포트·장치 번호)에 대한 연결. 실패하면 닫고 다음 호출 때 다시 연다."""

    def __init__(self, host, port=502, unit=1, timeout=0.5, allow=("127.0.0.0/8",)):
        if not allowed(host, allow):
            raise ModbusError(f"허용 목록 밖 주소: {host}")
        self.host, self.port, self.unit, self.timeout = host, port, unit, timeout
        self.sock = None; self.tid = 0; self.n_ok = 0; self.n_err = 0; self.last_rtt = None; self.last_err = ""; self.t_last_ok = None
        self.lock = threading.RLock()      # 수집·지령·디버그 도구가 같은 연결을 함께 쓴다
        self.trace = None                  # 프레임 추적 콜백 trace(방향, 바이트|문장, 왕복 시간). 디버그 도구가 연결한다
        self.tag = (host, "")              # (장치 이름, 경로) — 추적 표시용

    def _open(self):
        if self.sock is None:
            self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def close(self):
        if self.sock is not None:
            try: self.sock.close()
            finally: self.sock = None

    def _recv(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk: raise ModbusError("연결 끊김")
            buf += chunk
        return buf

    def _request(self, pdu):
        with self.lock:
            t0 = time.monotonic(); tr = self.trace
            try:
                self._open(); self.tid = (self.tid + 1) & 0xFFFF
                frame = struct.pack(">HHHB", self.tid, 0, len(pdu) + 1, self.unit) + pdu
                if tr: tr("TX", frame, None)
                self.sock.sendall(frame)
                head = self._recv(7); tid, proto, length, unit = struct.unpack(">HHHB", head)
                if not 2 <= length <= 254: raise ModbusError(f"응답 길이 필드 오류 {length}")
                body = self._recv(length - 1)
                if tr: tr("RX", head + body, time.monotonic() - t0)
                if tid != self.tid or unit != self.unit: raise ModbusError("응답 식별 번호 불일치")
                if body[0] & 0x80: raise ModbusError(f"장치 예외 응답 {body[1]} ({EXC.get(body[1], '알 수 없음')})")
                self.n_ok += 1; self.last_rtt = time.monotonic() - t0; self.t_last_ok = time.time()
                return body
            except (OSError, struct.error, ModbusError, IndexError) as e:
                self.n_err += 1; self.close()
                err = e if isinstance(e, ModbusError) else ModbusError(f"{type(e).__name__}: {e}")
                self.last_err = str(err)
                if tr: tr("ERR", str(err), time.monotonic() - t0)
                raise err

    def read(self, addr, count, fc=3):
        """레지스터 count개를 읽어 16비트 값 목록으로 돌려준다."""
        if fc not in (3, 4) or not 1 <= count <= 125: raise ModbusError("읽기 인자 오류")
        body = self._request(struct.pack(">BHH", fc, addr, count))
        if body[1] != 2 * count: raise ModbusError("응답 길이 불일치")
        return list(struct.unpack(f">{count}H", body[2:2 + 2 * count]))

    def write(self, addr, values, fc=None):
        """레지스터 쓰기. 값이 1개면 06, 여러 개면 16을 쓴다(fc=16이면 1개도 16으로)."""
        values = list(values)
        if not values or len(values) > 123: raise ModbusError("쓰기 인자 오류")
        if len(values) == 1 and fc != 16: self._request(struct.pack(">BHH", 6, addr, values[0] & 0xFFFF))
        else: self._request(struct.pack(">BHHB", 16, addr, len(values), 2 * len(values)) + struct.pack(f">{len(values)}H", *[v & 0xFFFF for v in values]))

    def read_bits(self, addr, count, fc=1):
        """코일(01)·접점 입력(02) 읽기. 반환: 0/1 목록."""
        if fc not in (1, 2) or not 1 <= count <= 2000: raise ModbusError("읽기 인자 오류")
        body = self._request(struct.pack(">BHH", fc, addr, count)); data = body[2:2 + body[1]]
        return [(data[i // 8] >> (i % 8)) & 1 for i in range(count)]

    def write_coil(self, addr, on):
        self._request(struct.pack(">BHH", 5, addr, 0xFF00 if on else 0))


# ── 자료형 변환(레지스터 ↔ 공학값)
NREG = {"u16": 1, "i16": 1, "u32": 2, "i32": 2, "f32": 2}


def decode(regs, typ, scale=1.0):
    if typ == "u16": v = regs[0]
    elif typ == "i16": v = struct.unpack(">h", struct.pack(">H", regs[0]))[0]
    elif typ == "u32": v = (regs[0] << 16) | regs[1]
    elif typ == "i32": v = struct.unpack(">i", struct.pack(">HH", *regs[:2]))[0]
    elif typ == "f32": v = struct.unpack(">f", struct.pack(">HH", *regs[:2]))[0]
    else: raise ModbusError(f"자료형 미지원: {typ}")
    return v * scale


def encode(value, typ, scale=1.0):
    raw = value / scale
    if typ == "u16": return [int(round(raw)) & 0xFFFF]
    if typ == "i16": return list(struct.unpack(">H", struct.pack(">h", int(round(raw)))))
    if typ == "u32": r = int(round(raw)); return [(r >> 16) & 0xFFFF, r & 0xFFFF]
    if typ == "i32": return list(struct.unpack(">HH", struct.pack(">i", int(round(raw)))))
    if typ == "f32": return list(struct.unpack(">HH", struct.pack(">f", float(raw))))
    raise ModbusError(f"자료형 미지원: {typ}")
