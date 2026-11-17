// Modbus 값 부호화·복호화와 프레임 생성·검증. 동적 메모리·예외를 쓰지 않는다(결과는 상태값으로 돌려준다).
// 파이썬 기준 구현: ifps_ems_rt/modbus.py (decode, encode, to_std, from_std)
#ifndef EMS_MODBUS_CODEC_H
#define EMS_MODBUS_CODEC_H

#include "ems_types.h"

namespace ems
{
    namespace mb
    {
        enum Type { T_U16 = 0, T_I16 = 1, T_U32 = 2, T_I32 = 3, T_F32 = 4, T_U64 = 5, T_I64 = 6, T_F64 = 7, T_COUNT = 8 };
        // 바이트·워드 순서. 0x11223344 → ABCD [1122,3344] / CDAB [3344,1122] / BADC [2211,4433] / DCBA [4433,2211]
        enum Order { O_ABCD = 0, O_CDAB = 1, O_BADC = 2, O_DCBA = 3 };
        enum Status { ST_OK = 0, ST_ERR_TYPE = 1, ST_ERR_LENGTH = 2, ST_ERR_RANGE = 3, ST_ERR_NOT_FINITE = 4, ST_ERR_FRAME = 5, ST_ERR_EXCEPTION = 6, ST_ERR_ARG = 7 };

        const u32 MAX_WORDS = 4U;          // 값 하나가 차지하는 최대 레지스터 수(64비트)
        const u32 MAX_READ = 125U;         // 한 번에 읽는 최대 레지스터 수(규격)
        const u32 MAX_WRITE = 123U;        // 한 번에 쓰는 최대 레지스터 수(규격)
        const u32 MAX_ADU = 260U;          // Modbus TCP 프레임 최대 길이
        const u8 FC_READ_HOLDING = 3U;
        const u8 FC_READ_INPUT = 4U;
        const u8 FC_WRITE_MULTI = 16U;

        // 자료형이 차지하는 레지스터 수. 모르는 자료형이면 0.
        u32 wordCount(Type typ);
        // 장치 순서의 워드를 표준(ABCD) 순서로 / 그 반대로. n 은 1~MAX_WORDS.
        Status toStd(const u16 in[], u32 n, Order order, u16 out[]);
        Status fromStd(const u16 in[], u32 n, Order order, u16 out[]);
        // 레지스터 → 공학값(= 원시값 × 배율)
        Status decode(const u16 regs[], u32 nRegs, Type typ, f64 scale, Order order, f64& value);
        // 공학값 → 레지스터. 범위를 벗어나거나 유한하지 않으면 쓰지 않고 오류를 돌려준다.
        Status encode(f64 value, Type typ, f64 scale, Order order, u16 regs[], u32& nRegs);

        // 읽기 요청(FC 03·04) 프레임. adu 는 MAX_ADU 바이트 이상.
        Status buildRead(u16 tid, u8 unit, u8 fc, u16 addr, u16 count, u8 adu[], u32& len);
        // 여러 레지스터 쓰기(FC 16) 프레임.
        Status buildWriteMulti(u16 tid, u8 unit, u16 addr, const u16 regs[], u32 n, u8 adu[], u32& len);
        // 읽기 응답 검증·해석: 길이, 프로토콜 식별자, 거래 번호, 장치 번호, 기능 코드, 바이트 수를 모두 확인한다.
        // 장치가 예외로 답하면 ST_ERR_EXCEPTION 과 exceptionCode 를 돌려준다.
        Status parseReadResponse(const u8 adu[], u32 len, u16 tid, u8 unit, u8 fc, u16 count, u16 regs[], u8& exceptionCode);
        // 쓰기 응답 검증: 요청한 주소·개수를 그대로 되돌렸는지 확인한다.
        Status parseWriteResponse(const u8 adu[], u32 len, u16 tid, u8 unit, u16 addr, u16 n, u8& exceptionCode);
    }
}

#endif
