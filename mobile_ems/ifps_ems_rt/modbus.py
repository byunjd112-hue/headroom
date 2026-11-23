# -*- coding: utf-8 -*-
"""Modbus TCP 클라이언트(표준 라이브러리 socket만 사용).

지원 기능 코드: 01 코일 읽기, 02 접점 입력 읽기, 03 보유 레지스터 읽기, 04 입력 레지스터 읽기, 05 코일 쓰기, 06 레지스터 1개 쓰기, 16 레지스터 여러 개 쓰기.
접속은 허용 목록(allow)에 있는 주소로만 한다. 이름 풀이(DNS)는 하지 않는다.
"""
import ipaddress, math, socket, struct, threading, time


class ModbusError(Exception):
    pass


class DeviceException(ModbusError):
    """장치가 예외 응답을 돌려줌(통신은 살아 있다). code: Modbus 예외 코드."""
    def __init__(self, code, text):
        super().__init__(text); self.code = code


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
            if len(buf) < n and time.monotonic() > getattr(self, "t_end", float("inf")): raise ModbusError("응답 시간 초과(전체 한도)")
        return buf

    def _request(self, pdu):
        with self.lock:
            t0 = time.monotonic(); tr = self.trace; self.t_end = t0 + 2.0 * self.timeout      # 요청 하나의 전체 한도(접속 + 응답). 바이트를 조금씩 흘리는 장치가 수집 주기를 붙잡지 못하게
            try:
                self._open(); self.tid = (self.tid + 1) & 0xFFFF
                frame = struct.pack(">HHHB", self.tid, 0, len(pdu) + 1, self.unit) + pdu
                if tr: tr("TX", frame, None)
                self.sock.sendall(frame)
                head = self._recv(7); tid, proto, length, unit = struct.unpack(">HHHB", head)
                if proto != 0: raise ModbusError(f"응답 프로토콜 식별자 오류 {proto}")
                if not 2 <= length <= 254: raise ModbusError(f"응답 길이 필드 오류 {length}")
                body = self._recv(length - 1)
                if tr: tr("RX", head + body, time.monotonic() - t0)
                if tid != self.tid or unit != self.unit: raise ModbusError("응답 식별 번호 불일치")
                if body[0] & 0x80:
                    code = body[1] if len(body) > 1 else 0
                    raise DeviceException(code, f"장치 예외 응답 {code} ({EXC.get(code, '알 수 없음')})")
                if body[0] != pdu[0]: raise ModbusError(f"응답 기능 코드 불일치 {body[0]} (요청 {pdu[0]})")
                self.n_ok += 1; self.last_rtt = time.monotonic() - t0; self.t_last_ok = time.time()
                return body
            except (OSError, struct.error, ModbusError, IndexError) as e:
                self.n_err += 1; self.close()
                err = e if isinstance(e, ModbusError) else ModbusError(f"{type(e).__name__}: {e}")
                self.last_err = str(err)
                if tr: tr("ERR", str(err), time.monotonic() - t0)
                raise err from e

    def read(self, addr, count, fc=3):
        """레지스터 count개를 읽어 16비트 값 목록으로 돌려준다."""
        if fc not in (3, 4) or not 1 <= count <= 125: raise ModbusError("읽기 인자 오류")
        body = self._request(struct.pack(">BHH", fc, addr, count))
        if len(body) != 2 + 2 * count or body[1] != 2 * count: return self._bad("응답 길이 불일치")
        return list(struct.unpack(f">{count}H", body[2:2 + 2 * count]))

    def _bad(self, text):
        """형식이 틀린 응답: 연결을 닫고(뒤따르는 잔여 바이트 버림) ModbusError 를 낸다."""
        self.n_err += 1; self.last_err = text; self.close()
        if self.trace: self.trace("ERR", text, None)
        raise ModbusError(text)

    def write(self, addr, values, fc=None):
        """레지스터 쓰기. 값이 1개면 06, 여러 개면 16을 쓴다(fc=16이면 1개도 16으로)."""
        values = list(values)
        if not values or len(values) > 123: raise ModbusError("쓰기 인자 오류")
        if len(values) == 1 and fc != 16: self._request(struct.pack(">BHH", 6, addr, values[0] & 0xFFFF))
        else: self._request(struct.pack(">BHHB", 16, addr, len(values), 2 * len(values)) + struct.pack(f">{len(values)}H", *[v & 0xFFFF for v in values]))

    def read_bits(self, addr, count, fc=1):
        """코일(01)·접점 입력(02) 읽기. 반환: 0/1 목록."""
        if fc not in (1, 2) or not 1 <= count <= 2000: raise ModbusError("읽기 인자 오류")
        body = self._request(struct.pack(">BHH", fc, addr, count))
        if len(body) < 2 or len(body) != 2 + body[1] or body[1] < (count + 7) // 8: return self._bad("응답 길이 불일치")
        data = body[2:2 + body[1]]
        return [(data[i // 8] >> (i % 8)) & 1 for i in range(count)]

    def write_coil(self, addr, on):
        self._request(struct.pack(">BHH", 5, addr, 0xFF00 if on else 0))


# ── 자료형 변환(레지스터 ↔ 공학값)
# 16비트: u16 i16 / 32비트: u32 i32 f32 / 64비트: u64 i64 f64
NREG = {"u16": 1, "i16": 1, "u32": 2, "i32": 2, "f32": 2, "u64": 4, "i64": 4, "f64": 4}
_FMT = {"u16": "H", "i16": "h", "u32": "I", "i32": "i", "f32": "f", "u64": "Q", "i64": "q", "f64": "d"}
# 바이트·워드 순서. A가 최상위 바이트. 32비트 값 0x11223344 를 예로
#   ABCD  [0x1122, 0x3344]  상위 워드 먼저, 워드 안은 상위 바이트 먼저(Modbus 표준, Big-endian)
#   CDAB  [0x3344, 0x1122]  하위 워드 먼저(Word swap, Little-endian word order)
#   BADC  [0x2211, 0x4433]  워드 순서는 표준, 워드 안 바이트만 뒤집힘(Byte swap)
#   DCBA  [0x4433, 0x2211]  완전 역순(Little-endian)
# 16비트 값은 워드가 하나라 AB(=ABCD·CDAB) 또는 BA(=BADC·DCBA, 바이트 뒤집힘) 두 가지다.
# 64비트 값의 CDAB·DCBA는 네 워드 전체를 역순으로 둔다.
ORDERS = ("ABCD", "CDAB", "BADC", "DCBA")
ORDER_ALIAS = {"": "ABCD", "AB": "ABCD", "BA": "BADC", "BE": "ABCD", "LE": "DCBA", "BIG": "ABCD", "LITTLE": "DCBA",
               "WORDSWAP": "CDAB", "SWAP": "CDAB", "BYTESWAP": "BADC", "1234": "ABCD", "3412": "CDAB", "2143": "BADC", "4321": "DCBA"}


def norm_order(order):
    """순서 표기를 ABCD/CDAB/BADC/DCBA 중 하나로 바꾼다. 모르는 표기는 ModbusError."""
    o = str(order or "").strip().upper().replace("-", "").replace("_", "").replace(" ", "")
    o = ORDER_ALIAS.get(o, o)
    if o not in ORDERS: raise ModbusError(f"바이트 순서 표기 오류: {order} (ABCD/CDAB/BADC/DCBA)")
    return o


def _swap16(w): return ((w & 0xFF) << 8) | ((w >> 8) & 0xFF)


def to_std(regs, order="ABCD"):
    """장치가 보낸 워드들을 표준(ABCD) 순서로 바꾼다."""
    o = norm_order(order); w = [r & 0xFFFF for r in regs]
    if o in ("BADC", "DCBA"): w = [_swap16(x) for x in w]
    if o in ("CDAB", "DCBA"): w = w[::-1]
    return w


def from_std(regs, order="ABCD"):
    """표준(ABCD) 워드들을 장치 순서로 바꾼다(to_std의 역)."""
    o = norm_order(order); w = [r & 0xFFFF for r in regs]
    if o in ("CDAB", "DCBA"): w = w[::-1]
    if o in ("BADC", "DCBA"): w = [_swap16(x) for x in w]
    return w


def decode(regs, typ, scale=1.0, order="ABCD"):
    if typ not in NREG: raise ModbusError(f"자료형 미지원: {typ}")
    n = NREG[typ]
    if len(regs) < n: raise ModbusError(f"{typ}에 레지스터 {n}개 필요, {len(regs)}개 받음")
    w = to_std(regs[:n], order)
    v = struct.unpack(">" + _FMT[typ], struct.pack(f">{n}H", *w))[0]
    return v if scale == 1 else v * scale          # 배율 1이면 64비트 정수도 정밀도 손실 없이


def encode(value, typ, scale=1.0, order="ABCD"):
    if typ not in NREG: raise ModbusError(f"자료형 미지원: {typ}")
    n = NREG[typ]; f = _FMT[typ]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value): raise ModbusError(f"쓰기 값이 유한한 수가 아님: {value!r}")
    raw = value if scale == 1 else value / scale
    if f in "fd":
        try: b = struct.pack(">" + f, float(raw))
        except (OverflowError, struct.error): raise ModbusError(f"값 {value}이(가) {typ} 범위 밖") from None
    else:
        r = int(round(raw)); bits = 16 * n
        lo, hi = (-(1 << (bits - 1)), (1 << (bits - 1)) - 1) if f.islower() else (0, (1 << bits) - 1)
        if not lo <= r <= hi: raise ModbusError(f"값 {value}이(가) {typ} 범위({lo}~{hi}, 배율 {scale}) 밖")
        b = struct.pack(">" + f, r)
    return from_std(list(struct.unpack(f">{n}H", b)), order)
