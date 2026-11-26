// 예시 1  N-1 예비력 (CSC-CTL)
// 병렬 중인 전원 정격의 합에서 가장 큰 한 대를 빼고 1 · 2등급 부하를 뺀다.
#include "ems_types.h"

f64 reserve_margin_kw(const f64 rated_kw[], u16 n, f64 load12_kw)
{
    f64 sum = 0.0;
    f64 biggest = 0.0;
    f64 margin = 0.0;
    u16 i = 0U;
    for (i = 0U; i < n; ++i)
    {
        sum += rated_kw[i];
        if (rated_kw[i] > biggest)
        {
            biggest = rated_kw[i];
        }
    }
    margin = (sum - biggest) - load12_kw;   // n = 0 이면 -load12_kw
    return margin;
}
