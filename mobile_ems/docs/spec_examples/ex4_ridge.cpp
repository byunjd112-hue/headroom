// 예시 4  예측 추론: 표준화 뒤 가중합, 그리고 10~90 % 구간 (CSC-FCT)
// 학습으로 얻은 평균 mu, 표준편차 sd, 가중치 w(절편 포함)를 모델 파일에서 읽는다.
#include "ems_types.h"

const u16 MAX_FEAT = 32U;

struct RidgeModel
{
    u16 n;                      // 입력 개수(<= MAX_FEAT)
    f64 mu[MAX_FEAT];
    f64 sd[MAX_FEAT];
    f64 w[MAX_FEAT + 1U];       // w[0] = 절편
    f64 q_lo;                   // 잔차의 10 % 분위수 × 변동 여유 배율
    f64 q_hi;                   // 잔차의 90 % 분위수 × 변동 여유 배율
};

struct Forecast { f64 mid; f64 lo; f64 hi; bool ok; };

Forecast ridge_predict(const RidgeModel& m, const f64 x[], u16 nx)
{
    Forecast out = { 0.0, 0.0, 0.0, false };
    if ((nx == m.n) && (m.n <= MAX_FEAT))
    {
        f64 y = m.w[0];
        u16 j = 0U;
        for (j = 0U; j < m.n; ++j)
        {
            const f64 s = (m.sd[j] < 1.0e-9) ? 1.0 : m.sd[j];
            y += m.w[j + 1U] * ((x[j] - m.mu[j]) / s);
        }
        out.mid = y;
        out.lo = y + m.q_lo;
        out.hi = y + m.q_hi;
        out.ok = (y == y);                  // NaN 이면 쓰지 않는다
    }
    return out;
}
