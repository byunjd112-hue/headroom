# -*- coding: utf-8 -*-
"""현장 Modbus TCP 점검 도구(명령줄). 제어화면 없이 장치 응답·주소·자료형을 확인한다.

  python -m ifps_ems_rt.mbtool probe 192.168.10.11 --units 1-10         응답하는 장치 번호 찾기
  python -m ifps_ems_rt.mbtool read  192.168.10.11 -u 1 -f 3 -a 0 -n 16   레지스터 읽기(HEX/U16/I16/U32/F32 표시)
  python -m ifps_ems_rt.mbtool watch 192.168.10.11 -u 1 -a 4 -n 2 -t f32  주기 감시
  python -m ifps_ems_rt.mbtool read  192.168.10.13 -a 20 -n 8 --orders     32비트 값을 네 가지 순서로 동시 해석(순서 판별)
  python -m ifps_ems_rt.mbtool watch 192.168.10.13 -a 20 -n 2 -t f32 -o CDAB  하위 워드 먼저인 장치
  python -m ifps_ems_rt.mbtool write 192.168.10.11 -u 1 -a 10 -v 1       레지스터 쓰기(확인 질문)
  python -m ifps_ems_rt.mbtool write 192.168.10.13 -a 30 -t f32 -o CDAB --value -12.5   공학값을 자료형·순서로 변환해 쓰기
  python -m ifps_ems_rt.mbtool check config/runtime.json                 대응표 검증 + 전 장치 1회 수집
접속은 사설·루프백 주소만 가능하다(modbus.allowed). --trace를 붙이면 송수신 프레임을 HEX로 보인다.
"""
import argparse, sys, time
from . import modbus as mb

PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"]


def _client(a):
    c = mb.Client(a.host, a.port, a.unit, a.timeout, a.allow.split(",") if a.allow else PRIVATE)
    if a.trace:
        c.trace = lambda d, data, rtt: print(f"  {d:3} " + (data.hex(" ") if isinstance(data, (bytes, bytearray)) else str(data)) + (f"  ({rtt * 1000:.1f}ms)" if rtt else ""), file=sys.stderr)
    return c


def _table(addr, regs, order="ABCD"):
    print(f"{'주소':>6} {'HEX':>6} {'U16':>6} {'I16':>7} {'U32':>11} {'I32':>12} {'F32':>13}   (32비트 = 이 + 다음, 순서 {order})")
    for i, v in enumerate(regs):
        pair = regs[i:i + 2] if i + 1 < len(regs) else None
        u16 = mb.decode([v], "u16", 1, order); i16 = mb.decode([v], "i16", 1, order)
        u32 = f"{mb.decode(pair, 'u32', 1, order):>11}" if pair else ""
        i32 = f"{mb.decode(pair, 'i32', 1, order):>12}" if pair else ""
        f32 = f"{mb.decode(pair, 'f32', 1, order):>13.5g}" if pair else ""
        print(f"{addr + i:>6} 0x{v:04X} {u16:>6} {i16:>7} {u32} {i32} {f32}")


def _orders(addr, regs):
    """32비트 순서 판별표: 같은 두 레지스터를 ABCD/CDAB/BADC/DCBA 로 각각 해석한다. 정격값에 맞는 열이 그 장치의 순서다."""
    print(f"{'주소':>6} {'HEX':>11} " + " ".join(f"{o + ' F32':>13} {o + ' U32':>11}" for o in mb.ORDERS))
    for i in range(0, len(regs) - 1, 2):
        pr = regs[i:i + 2]
        print(f"{addr + i:>6} {pr[0]:04X} {pr[1]:04X} " + " ".join(f"{mb.decode(pr, 'f32', 1, o):>13.5g} {mb.decode(pr, 'u32', 1, o):>11}" for o in mb.ORDERS))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="mbtool", description="Modbus TCP 현장 점검 도구")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("read", "watch", "write", "probe"):
        p = sub.add_parser(name); p.add_argument("host"); p.add_argument("-p", "--port", type=int, default=502); p.add_argument("-u", "--unit", type=int, default=1)
        p.add_argument("--timeout", type=float, default=0.8); p.add_argument("--allow", help="허용 대역(쉼표). 기본: 사설 대역 전체"); p.add_argument("--trace", action="store_true")
        if name in ("read", "watch"):
            p.add_argument("-f", "--fc", type=int, default=3, choices=(1, 2, 3, 4)); p.add_argument("-a", "--addr", type=int, default=0); p.add_argument("-n", "--count", type=int, default=10)
            p.add_argument("-t", "--type", choices=tuple(mb.NREG)); p.add_argument("-s", "--scale", type=float, default=1.0)
            p.add_argument("-o", "--order", default="ABCD", help="바이트·워드 순서 ABCD/CDAB/BADC/DCBA (기본 ABCD)")
            p.add_argument("--orders", action="store_true", help="32비트 값을 네 순서로 모두 해석해 보인다")
        if name == "watch": p.add_argument("-i", "--interval", type=float, default=1.0)
        if name == "write":
            p.add_argument("-a", "--addr", type=int, required=True); g = p.add_mutually_exclusive_group(required=True)
            g.add_argument("-v", "--values", type=lambda x: int(x, 0), nargs="+", help="원시 레지스터 값(0x 가능)")
            g.add_argument("--value", type=float, help="공학값. -t 자료형·-s 배율·-o 순서로 변환해 쓴다")
            p.add_argument("-t", "--type", choices=tuple(mb.NREG), default="u16"); p.add_argument("-s", "--scale", type=float, default=1.0); p.add_argument("-o", "--order", default="ABCD")
            p.add_argument("--coil", action="store_true"); p.add_argument("-y", "--yes", action="store_true")
        if name == "probe": p.add_argument("--units", default="1-10"); p.add_argument("-a", "--addr", type=int, default=0)
    c = sub.add_parser("check"); c.add_argument("config")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "check":
            from .runtime import main as rtmain
            return rtmain([a.config, "--check"])
        if a.cmd == "probe":
            lo, _, hi = a.units.partition("-"); found = []
            for u in range(int(lo), int(hi or lo) + 1):
                a.unit = u; cl = _client(a); t0 = time.monotonic()
                try:
                    cl.read(a.addr, 1, 3); found.append(u); print(f"  unit {u:>3}: 응답 ({(time.monotonic() - t0) * 1000:.1f}ms)")
                except mb.ModbusError as e:
                    print(f"  unit {u:>3}: {e}")
                finally:
                    cl.close()
            print("응답 장치 번호:", found or "없음"); return 0 if found else 1
        cl = _client(a)
        if a.cmd == "write":
            if a.value is not None:
                if a.coil: print("--coil 에는 -v 0/1 을 쓰십시오", file=sys.stderr); return 2
                a.values = mb.encode(a.value, a.type, a.scale, a.order)
            what = f"{a.host}:{a.port} unit {a.unit} {'coil' if a.coil else 'reg'} {a.addr} ← {a.values}"
            if not a.yes and input(f"{what}\n실장치에 씁니다. 계속(y/N)? ").strip().lower() != "y": print("취소"); return 1
            cl.write_coil(a.addr, bool(a.values[0])) if a.coil else cl.write(a.addr, a.values, fc=16 if len(a.values) > 1 else None); print("완료:", what); return 0
        a.order = mb.norm_order(a.order)
        while True:
            t0 = time.monotonic(); regs = cl.read_bits(a.addr, a.count, a.fc) if a.fc in (1, 2) else cl.read(a.addr, a.count, a.fc)
            rtt = (time.monotonic() - t0) * 1000
            if a.type:
                n = mb.NREG[a.type]; vals = [mb.decode(regs[i:i + n], a.type, a.scale, a.order) for i in range(0, len(regs) - n + 1, n)]
                print(time.strftime("%H:%M:%S"), f"({rtt:.1f}ms)", " ".join(f"{v:.6g}" for v in vals))
            elif a.fc in (1, 2): print(time.strftime("%H:%M:%S"), "".join(str(b) for b in regs))
            elif a.orders: _orders(a.addr, regs)
            else: _table(a.addr, regs, a.order)
            if a.cmd != "watch": return 0
            time.sleep(max(0.0, a.interval - (time.monotonic() - t0)))
    except mb.ModbusError as e:
        print("통신 오류:", e, file=sys.stderr); return 2
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
