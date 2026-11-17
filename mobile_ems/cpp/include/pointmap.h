// 대응표(pointmap): 점 정의 검사와 읽기 묶음 계산, CSV 숫자 해석. 파이썬 기준 구현: ifps_ems_rt/pointmap.py (validate, blocks)
#ifndef EMS_POINTMAP_H
#define EMS_POINTMAP_H

#include "ems_types.h"

namespace ems
{
    namespace pm
    {
        const u32 MAX_POINTS = 256U;
        const u32 MAX_TAG = 24U;             // 이름 최대 길이(끝 표시 포함)
        const u32 MAX_BLOCKS = 64U;
        const u32 TYPE_INVALID = 8U;         // 자료형 코드 0~7 은 mb::Type 과 같다
        const u32 ORDER_INVALID = 4U;
        const u32 RW_READ = 0U;
        const u32 RW_WRITE = 1U;
        const u32 UNIT_KW = 0U;              // 단위 코드: 0 kW, 1 kWh, 2 %, 3 V, 4 A, 5 Hz, 6 Nm3, 7 L, 8 degC, 9 없음
        const u32 UNIT_COUNT = 10U;
        const i32 DEVICE_UNDEFINED = -1;

        struct Point
        {
            char tag[MAX_TAG];
            i32 device;                      // 장치 번호(설정의 장치 순서), 정의되지 않은 장치면 DEVICE_UNDEFINED
            u32 fc;
            u32 addr;
            u32 type;
            f64 scale;
            u32 unit;
            bool hasLo;
            f64 lo;
            bool hasHi;
            f64 hi;
            u32 rw;
            u32 order;
        };

        enum ErrorKind { E_DUP_TAG = 0, E_TYPE = 1, E_ORDER = 2, E_FC = 3, E_RW = 4, E_WRITE_FC = 5, E_UNIT = 6, E_SCALE_ZERO = 7, E_RANGE = 8, E_DEVICE = 9, E_OVERLAP = 10, E_KW_UNIT = 11, E_KIND_COUNT = 12 };

        struct Report
        {
            u32 count[E_KIND_COUNT];         // 종류별 오류 수
            u32 total;
            u32 firstIndex;                  // 처음 오류가 난 점의 번호(오류가 없으면 n)
        };

        // 대응표 검사. n 이 MAX_POINTS 를 넘으면 앞의 MAX_POINTS 개만 본다.
        void validate(const Point pts[], u32 n, Report& report);

        struct Block
        {
            u32 fc;
            u32 start;
            u32 count;                       // 레지스터 수
            u32 points;                      // 묶음에 든 점의 수
        };

        // 한 장치의 읽기 점을 연속 주소 묶음으로 나눈다. gap: 묶음 안에 허용하는 빈 주소 수. 반환: 묶음 수.
        u32 blocks(const Point pts[], u32 n, i32 device, u32 gap, u32 maxLen, Block out[]);

        // "123", "-0.5", "0.001" 꼴의 십진수 해석(지수 표기 없음). 형식이 틀리면 false.
        bool parseDecimal(const char text[], u32 len, f64& value);
    }
}

#endif
