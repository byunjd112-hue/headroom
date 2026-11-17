// Modbus 값 부호화·복호화와 프레임 생성·검증 (MISRA C++:2008 준수 지향: 동적 메모리·예외·매크로·공용체·포인터 형 변환 없음)
// 실수(f32·f64)는 비트 표현을 메모리로 재해석하지 않고 IEEE 754 규칙에 따라 산술로 조립·분해한다(규칙 3-9-3, 5-2-7).
#include "modbus_codec.h"

#include <cfloat>
#include <cmath>
#include <limits>

namespace ems
{
    namespace mb
    {
        namespace
        {
            const f64 TWO16 = 65536.0;
            const f64 TWO32 = 4294967296.0;
            const f64 TWO31 = 2147483648.0;
            const f64 TWO52 = 4503599627370496.0;
            const f64 TWO63 = 9223372036854775808.0;
            const f64 TWO64 = 18446744073709551616.0;
            const f64 TWO23 = 8388608.0;
            const f64 MIN_SCALE = 1.0e-300;

            u16 swap16(u16 w)
            {
                const u32 v = static_cast<u32>(w);
                return static_cast<u16>(((v & 0xFFU) << 8U) | ((v >> 8U) & 0xFFU));
            }

            bool swapsBytes(Order order)
            {
                return (order == O_BADC) || (order == O_DCBA);
            }

            bool reversesWords(Order order)
            {
                return (order == O_CDAB) || (order == O_DCBA);
            }

            bool isFinite(f64 v)
            {
                return (v >= -DBL_MAX) && (v <= DBL_MAX);       // NaN 은 두 비교 모두 거짓
            }

            // 파이썬 round() 와 같은 '가장 가까운 정수, 정확히 중간이면 짝수 쪽'
            f64 roundHalfEven(f64 x)
            {
                const f64 f = std::floor(x);
                const f64 d = x - f;
                const bool odd = std::fabs(std::fmod(f, 2.0)) > 0.5;
                const bool tie = (!(d > 0.5)) && (!(d < 0.5));
                const bool up = (d > 0.5) || (tie && odd);
                return up ? (f + 1.0) : f;
            }

            u32 join32(u16 hi, u16 lo)
            {
                return (static_cast<u32>(hi) << 16U) | static_cast<u32>(lo);
            }

            void split32(u32 v, u16& hi, u16& lo)
            {
                hi = static_cast<u16>((v >> 16U) & 0xFFFFU);
                lo = static_cast<u16>(v & 0xFFFFU);
            }

            // 음이 아닌 정수값 실수(0 ≤ m < 2^64)를 상·하위 32비트로 나눈다.
            void splitMagnitude(f64 m, u32& hi, u32& lo)
            {
                const f64 h = std::floor(m / TWO32);
                hi = static_cast<u32>(h);
                lo = static_cast<u32>(m - (h * TWO32));
            }

            f64 decodeF32(u32 bits)
            {
                const u32 expo = (bits >> 23U) & 0xFFU;
                const u32 man = bits & 0x7FFFFFU;
                const bool neg = (bits & 0x80000000U) != 0U;
                f64 v = 0.0;
                if (expo == 0U)
                {
                    v = std::ldexp(static_cast<f64>(man), -149);
                }
                else if (expo == 0xFFU)
                {
                    v = (man == 0U) ? std::numeric_limits<f64>::infinity() : std::numeric_limits<f64>::quiet_NaN();
                }
                else
                {
                    v = std::ldexp(static_cast<f64>(man) + TWO23, static_cast<i32>(expo) - 150);
                }
                return neg ? (-v) : v;
            }

            f64 decodeF64(u32 hi, u32 lo)
            {
                const u32 expo = (hi >> 20U) & 0x7FFU;
                const f64 man = (static_cast<f64>(hi & 0xFFFFFU) * TWO32) + static_cast<f64>(lo);
                const bool neg = (hi & 0x80000000U) != 0U;
                const bool manZero = ((hi & 0xFFFFFU) == 0U) && (lo == 0U);
                f64 v = 0.0;
                if (expo == 0U)
                {
                    v = std::ldexp(man, -1074);
                }
                else if (expo == 0x7FFU)
                {
                    v = manZero ? std::numeric_limits<f64>::infinity() : std::numeric_limits<f64>::quiet_NaN();
                }
                else
                {
                    v = std::ldexp(man + TWO52, static_cast<i32>(expo) - 1075);
                }
                return neg ? (-v) : v;
            }

            // 유한한 f32 값의 IEEE 754 단정도 비트열
            u32 encodeF32(f32 fv)
            {
                const f64 a = std::fabs(static_cast<f64>(fv));
                u32 bits = 0U;
                if (a > 0.0)
                {
                    i32 e = 0;
                    const f64 m = std::frexp(a, &e);                    // a = m × 2^e, 0.5 ≤ m < 1
                    if (e >= -125)
                    {
                        const u32 expo = static_cast<u32>(e + 126);
                        const u32 man = static_cast<u32>(((m * 2.0) - 1.0) * TWO23);
                        bits = (expo << 23U) | man;
                    }
                    else
                    {
                        bits = static_cast<u32>(std::ldexp(a, 149));     // 비정규 수
                    }
                    if (fv < 0.0F)
                    {
                        bits |= 0x80000000U;
                    }
                }
                return bits;
            }

            void encodeF64(f64 dv, u32& hi, u32& lo)
            {
                const f64 a = std::fabs(dv);
                hi = 0U;
                lo = 0U;
                if (a > 0.0)
                {
                    i32 e = 0;
                    const f64 m = std::frexp(a, &e);
                    if (e >= -1021)
                    {
                        const f64 frac = ((m * 2.0) - 1.0) * TWO52;
                        splitMagnitude(frac, hi, lo);
                        hi |= static_cast<u32>(e + 1022) << 20U;
                    }
                    else
                    {
                        splitMagnitude(std::ldexp(a, 1074), hi, lo);
                    }
                    if (dv < 0.0)
                    {
                        hi |= 0x80000000U;
                    }
                }
            }

            // 표준 순서 워드 → 원시값
            f64 rawValue(const u16 w[], Type typ)
            {
                f64 v = 0.0;
                switch (typ)
                {
                case T_U16:
                    v = static_cast<f64>(w[0]);
                    break;
                case T_I16:
                    v = (w[0] >= 0x8000U) ? (static_cast<f64>(w[0]) - TWO16) : static_cast<f64>(w[0]);
                    break;
                case T_U32:
                    v = static_cast<f64>(join32(w[0], w[1]));
                    break;
                case T_I32:
                    v = static_cast<f64>(join32(w[0], w[1]));
                    v = (v >= TWO31) ? (v - TWO32) : v;
                    break;
                case T_F32:
                    v = decodeF32(join32(w[0], w[1]));
                    break;
                case T_U64:
                    v = (static_cast<f64>(join32(w[0], w[1])) * TWO32) + static_cast<f64>(join32(w[2], w[3]));
                    break;
                case T_I64:
                {
                    const u32 hi = join32(w[0], w[1]);
                    const u32 lo = join32(w[2], w[3]);
                    if ((hi & 0x80000000U) != 0U)
                    {
                        v = -((static_cast<f64>(~hi) * TWO32) + static_cast<f64>(~lo) + 1.0);     // 2의 보수
                    }
                    else
                    {
                        v = (static_cast<f64>(hi) * TWO32) + static_cast<f64>(lo);
                    }
                    break;
                }
                case T_F64:
                    v = decodeF64(join32(w[0], w[1]), join32(w[2], w[3]));
                    break;
                default:
                    v = 0.0;
                    break;
                }
                return v;
            }

            // 64비트 정수: 반올림한 값 r 을 표준 순서 워드 4개로
            Status wideWords(f64 r, Type typ, u16 w[])
            {
                Status st = ST_OK;
                u32 hi = 0U;
                u32 lo = 0U;
                const bool isSigned = (typ == T_I64);
                const bool inRange = isSigned ? ((r >= -TWO63) && (r < TWO63)) : ((r >= 0.0) && (r < TWO64));
                if (!inRange)
                {
                    st = ST_ERR_RANGE;
                }
                else
                {
                    splitMagnitude(std::fabs(r), hi, lo);
                    if (r < 0.0)
                    {
                        lo = (~lo) + 1U;                                // 2의 보수
                        hi = (~hi) + ((lo == 0U) ? 1U : 0U);
                    }
                    split32(hi, w[0], w[1]);
                    split32(lo, w[2], w[3]);
                }
                return st;
            }

            // 정수 자료형: 반올림한 값 r 을 표준 순서 워드로. 범위를 벗어나면 ST_ERR_RANGE.
            Status integerWords(f64 r, Type typ, u16 w[])
            {
                Status st = ST_OK;
                switch (typ)
                {
                case T_U16:
                    if ((r < 0.0) || (r > 65535.0)) { st = ST_ERR_RANGE; } else { w[0] = static_cast<u16>(static_cast<u32>(r)); }
                    break;
                case T_I16:
                    if ((r < -32768.0) || (r > 32767.0)) { st = ST_ERR_RANGE; } else { w[0] = static_cast<u16>(static_cast<u32>(static_cast<i32>(r)) & 0xFFFFU); }
                    break;
                case T_U32:
                    if ((r < 0.0) || (r >= TWO32)) { st = ST_ERR_RANGE; } else { split32(static_cast<u32>(r), w[0], w[1]); }
                    break;
                case T_I32:
                    if ((r < -TWO31) || (r >= TWO31))
                    {
                        st = ST_ERR_RANGE;
                    }
                    else
                    {
                        const u32 bits = (r < 0.0) ? ((~static_cast<u32>(-r)) + 1U) : static_cast<u32>(r);
                        split32(bits, w[0], w[1]);
                    }
                    break;
                case T_U64:
                case T_I64:
                    st = wideWords(r, typ, w);
                    break;
                default:
                    st = ST_ERR_TYPE;
                    break;
                }
                return st;
            }

            void putU16(u8 adu[], u32 at, u16 v)
            {
                adu[at] = static_cast<u8>((static_cast<u32>(v) >> 8U) & 0xFFU);
                adu[at + 1U] = static_cast<u8>(static_cast<u32>(v) & 0xFFU);
            }

            u16 getU16(const u8 adu[], u32 at)
            {
                return static_cast<u16>((static_cast<u32>(adu[at]) << 8U) | static_cast<u32>(adu[at + 1U]));
            }

            void putHeader(u8 adu[], u16 tid, u16 pduLenPlusUnit, u8 unit)
            {
                putU16(adu, 0U, tid);
                putU16(adu, 2U, 0U);                    // 프로토콜 식별자 0 = Modbus
                putU16(adu, 4U, pduLenPlusUnit);
                adu[6] = unit;
            }

            // 응답 공통 검증. 정상 응답이면 ST_OK, 예외 응답이면 ST_ERR_EXCEPTION.
            Status checkHeader(const u8 adu[], u32 len, u16 tid, u8 unit, u8 fc, u8& exceptionCode)
            {
                Status st = ST_OK;
                exceptionCode = 0U;
                bool headerOk = len >= 9U;                             // 길이가 모자라면 뒤 칸을 읽지 않는다
                if (headerOk)
                {
                    const bool idsOk = (getU16(adu, 0U) == tid) && (getU16(adu, 2U) == 0U) && (adu[6] == unit);
                    headerOk = idsOk && ((static_cast<u32>(getU16(adu, 4U)) + 6U) == len);
                }
                const u8 excFc = static_cast<u8>(static_cast<u32>(fc) | 0x80U);
                const bool isException = headerOk && (adu[7] == excFc);
                const bool isNormal = headerOk && (adu[7] == fc);
                if (isException)
                {
                    exceptionCode = adu[8];
                    st = (len == 9U) ? ST_ERR_EXCEPTION : ST_ERR_FRAME;
                }
                else
                {
                    st = isNormal ? ST_OK : ST_ERR_FRAME;
                }
                return st;
            }
        }

        u32 wordCount(Type typ)
        {
            u32 n = 0U;
            switch (typ)
            {
            case T_U16:
            case T_I16:
                n = 1U;
                break;
            case T_U32:
            case T_I32:
            case T_F32:
                n = 2U;
                break;
            case T_U64:
            case T_I64:
            case T_F64:
                n = 4U;
                break;
            default:
                n = 0U;
                break;
            }
            return n;
        }

        Status toStd(const u16 in[], u32 n, Order order, u16 out[])
        {
            Status st = ST_OK;
            if ((n == 0U) || (n > MAX_WORDS))
            {
                st = ST_ERR_LENGTH;
            }
            else
            {
                for (u32 i = 0U; i < n; ++i)
                {
                    const u32 src = reversesWords(order) ? ((n - 1U) - i) : i;
                    out[i] = swapsBytes(order) ? swap16(in[src]) : in[src];
                }
            }
            return st;
        }

        Status fromStd(const u16 in[], u32 n, Order order, u16 out[])
        {
            return toStd(in, n, order, out);           // 뒤집기와 바이트 교환은 서로 독립이라 같은 변환이 역변환이다
        }

        Status decode(const u16 regs[], u32 nRegs, Type typ, f64 scale, Order order, f64& value)
        {
            Status st = ST_OK;
            const u32 n = wordCount(typ);
            value = 0.0;
            if (n == 0U)
            {
                st = ST_ERR_TYPE;
            }
            else if (nRegs < n)
            {
                st = ST_ERR_LENGTH;
            }
            else
            {
                u16 w[MAX_WORDS] = { 0U, 0U, 0U, 0U };
                st = toStd(regs, n, order, w);
                if (st == ST_OK)
                {
                    value = rawValue(w, typ) * scale;
                }
            }
            return st;
        }

        Status encode(f64 value, Type typ, f64 scale, Order order, u16 regs[], u32& nRegs)
        {
            Status st = ST_OK;
            const u32 n = wordCount(typ);
            u16 w[MAX_WORDS] = { 0U, 0U, 0U, 0U };
            nRegs = 0U;
            if (n == 0U)
            {
                st = ST_ERR_TYPE;
            }
            else if (!isFinite(value))
            {
                st = ST_ERR_NOT_FINITE;
            }
            else if (std::fabs(scale) < MIN_SCALE)
            {
                st = ST_ERR_ARG;
            }
            else
            {
                const f64 raw = value / scale;
                if (typ == T_F32)
                {
                    if (std::fabs(raw) > static_cast<f64>(FLT_MAX))
                    {
                        st = ST_ERR_RANGE;
                    }
                    else
                    {
                        split32(encodeF32(static_cast<f32>(raw)), w[0], w[1]);
                    }
                }
                else if (typ == T_F64)
                {
                    if (!isFinite(raw))
                    {
                        st = ST_ERR_RANGE;
                    }
                    else
                    {
                        u32 hi = 0U;
                        u32 lo = 0U;
                        encodeF64(raw, hi, lo);
                        split32(hi, w[0], w[1]);
                        split32(lo, w[2], w[3]);
                    }
                }
                else
                {
                    st = isFinite(raw) ? integerWords(roundHalfEven(raw), typ, w) : ST_ERR_RANGE;
                }
            }
            if (st == ST_OK)
            {
                st = fromStd(w, n, order, regs);
                nRegs = (st == ST_OK) ? n : 0U;
            }
            return st;
        }

        Status buildRead(u16 tid, u8 unit, u8 fc, u16 addr, u16 count, u8 adu[], u32& len)
        {
            Status st = ST_OK;
            len = 0U;
            if ((fc != FC_READ_HOLDING) && (fc != FC_READ_INPUT))
            {
                st = ST_ERR_ARG;
            }
            else if ((count == 0U) || (static_cast<u32>(count) > MAX_READ) || ((static_cast<u32>(addr) + static_cast<u32>(count)) > 65536U))
            {
                st = ST_ERR_RANGE;
            }
            else
            {
                putHeader(adu, tid, 6U, unit);
                adu[7] = fc;
                putU16(adu, 8U, addr);
                putU16(adu, 10U, count);
                len = 12U;
            }
            return st;
        }

        Status buildWriteMulti(u16 tid, u8 unit, u16 addr, const u16 regs[], u32 n, u8 adu[], u32& len)
        {
            Status st = ST_OK;
            len = 0U;
            if ((n == 0U) || (n > MAX_WRITE) || ((static_cast<u32>(addr) + n) > 65536U))
            {
                st = ST_ERR_RANGE;
            }
            else
            {
                putHeader(adu, tid, static_cast<u16>(7U + (2U * n)), unit);
                adu[7] = FC_WRITE_MULTI;
                putU16(adu, 8U, addr);
                putU16(adu, 10U, static_cast<u16>(n));
                adu[12] = static_cast<u8>(2U * n);
                for (u32 i = 0U; i < n; ++i)
                {
                    putU16(adu, 13U + (2U * i), regs[i]);
                }
                len = 13U + (2U * n);
            }
            return st;
        }

        Status parseReadResponse(const u8 adu[], u32 len, u16 tid, u8 unit, u8 fc, u16 count, u16 regs[], u8& exceptionCode)
        {
            Status st = checkHeader(adu, len, tid, unit, fc, exceptionCode);
            if (st == ST_OK)
            {
                const u32 n = static_cast<u32>(count);
                if ((n == 0U) || (n > MAX_READ) || (static_cast<u32>(adu[8]) != (2U * n)) || (len != (9U + (2U * n))))
                {
                    st = ST_ERR_FRAME;
                }
                else
                {
                    for (u32 i = 0U; i < n; ++i)
                    {
                        regs[i] = getU16(adu, 9U + (2U * i));
                    }
                }
            }
            return st;
        }

        Status parseWriteResponse(const u8 adu[], u32 len, u16 tid, u8 unit, u16 addr, u16 n, u8& exceptionCode)
        {
            Status st = checkHeader(adu, len, tid, unit, FC_WRITE_MULTI, exceptionCode);
            if (st == ST_OK)
            {
                if ((len != 12U) || (getU16(adu, 8U) != addr) || (getU16(adu, 10U) != n))
                {
                    st = ST_ERR_FRAME;
                }
            }
            return st;
        }
    }
}
