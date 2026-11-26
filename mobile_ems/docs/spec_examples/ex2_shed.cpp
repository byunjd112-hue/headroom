// 예시 2  저소음 태세의 3등급 부하 판단 (CSC-LDM)
// 디젤 없이 버틸 시간이 목표에 못 미칠 때만 줄인다. 먼저 절감, 그다음 차단.
#include "ems_types.h"

enum ShedAction { SHED_KEEP = 0, SHED_REDUCE = 1, SHED_OPEN = 2 };

struct QuietInput
{
    f64 hours_now;      // 지금 부하로 디젤 없이 버틸 시간(h)
    f64 target_h;       // 목표 시간(h), 설정값
    f64 soc;            // ESS 충전율(0~1)
    f64 soc_min;        // 방전 하한(0~1), 설정값
    bool reduced;       // 이미 절감 공급 중인가
    bool soc_valid;     // 충전율을 제때 읽었는가
};

ShedAction quiet_class3(const QuietInput& in)
{
    ShedAction act = SHED_KEEP;
    if (!in.soc_valid)
    {
        act = SHED_KEEP;                    // 못 읽은 값으로 끊지 않는다
    }
    else if (in.soc <= (in.soc_min + 0.03))
    {
        act = SHED_OPEN;                    // 하한에 가까우면 바로 차단
    }
    else if (in.hours_now < in.target_h)
    {
        act = in.reduced ? SHED_OPEN : SHED_REDUCE;
    }
    else
    {
        act = SHED_KEEP;
    }
    return act;
}
