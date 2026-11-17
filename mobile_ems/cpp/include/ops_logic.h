// 군 운용 논리: 주둔지(상전 연계) 제어, 주둔지 기존 발전기 운용, 자립 지속시간, 부하 우선순위 자동 차단·복구.
// 통신을 하지 않는 순수 계산이다. 파이썬 기준 구현: ifps_ems_rt/opsmode.py
#ifndef EMS_OPS_LOGIC_H
#define EMS_OPS_LOGIC_H

#include "ems_types.h"

namespace ems
{
    namespace ops
    {
        const u32 MAX_BANDS = 4U;

        struct Site
        {
            f64 essKwh;          // ESS 용량
            f64 essKw;           // ESS 정격 출력
            f64 socMin;          // 충전율 하한(0~1)
            f64 socMax;          // 충전율 상한(0~1)
            f64 essEff;          // 편도 효율
            f64 dgLPerKwh;       // 디젤 연료 소비율
            f64 fcNm3PerKwh;     // 연료전지 수소 소비율
            f64 elzKw;           // 수전해 정격
            f64 h2Nm3;           // 수소 저장 용량
            f64 h2Min;           // 수소 저장 하한 비율
        };

        struct Band
        {
            f64 from;            // 시작 시각(시, 포함)
            f64 to;              // 끝 시각(시, 제외)
        };

        struct Garrison
        {
            f64 peakKw;          // 수전 전력 상한 목표
            f64 importMinKw;     // 최소 수전 전력(역송 방지)
            f64 reserveSoc;      // 정전 대비 충전율 하한
            f64 chargeKw;        // 경부하 시간대 충전 전력
            Band peak[MAX_BANDS];
            u32 nPeak;
            Band offPeak[MAX_BANDS];
            u32 nOffPeak;
            f64 gdgKw;           // 주둔지 발전기 정격
            f64 gdgMinLoad;      // 최소 부하율
            f64 gdgDelayS;       // 정전 지속 기동 지연
            f64 gdgStopSoc;      // 정지 충전율
            f64 gdgRestartSoc;   // 재기동 충전율
        };

        enum BandKind { BAND_MID = 0, BAND_PEAK = 1, BAND_OFF = 2 };
        BandKind bandOf(const Garrison& g, f64 hour);

        // 주둔지 상전 연계 한 주기의 목표값
        struct GarrisonIn
        {
            f64 hour;
            f64 loadKw;
            f64 pvKw;
            f64 elzKw;
            f64 soc;
            f64 h2Nm3;
        };
        struct GarrisonOut
        {
            f64 gridKw;          // 목표 수전 전력
            f64 essKw;           // ESS 지령(+방전 / −충전)
            f64 pvLimitKw;       // 태양광 출력 제한(0 = 제한 없음)
            bool elzRun;         // 수전해 기동 여부
            BandKind band;
        };
        void garrisonStep(const Site& site, const Garrison& g, const GarrisonIn& in, GarrisonOut& out);

        // 주둔지 정전 중 기존 디젤발전기 운용 판단
        enum GdgWhy { GDG_WAIT = 0, GDG_WAIT_SUN = 1, GDG_START_LOW = 2, GDG_START_OUTAGE = 3, GDG_RUN = 4, GDG_HOLD = 5, GDG_STOP_FULL = 6, GDG_STOP_SUN = 7 };
        struct GdgIn
        {
            f64 outageS;         // 정전 지속 시간(초)
            f64 soc;
            bool running;
            f64 netKw;           // 부하 + 수전해 − 태양광 − 이동형 전원 출력
            bool hold;           // 최소 운전 시간이 지나지 않음
        };
        struct GdgOut
        {
            bool run;
            f64 essKw;
            f64 gdgKw;
            GdgWhy why;
            bool essAbsorbs;     // ESS 충전으로 발전기 부하율을 올리는 중
        };
        void gdgStep(const Site& site, const Garrison& g, const GdgIn& in, GdgOut& out);

        // 자립 지속시간(시간). 999 는 '충분함'을 뜻한다.
        struct AutonomyIn
        {
            f64 soc;
            f64 h2Nm3;
            f64 fuelL;
            f64 p1Kw;
            f64 p2Kw;
            f64 p3Kw;
            f64 pvKwhDay;
            bool quiet;          // 저소음 태세(디젤 연료를 세지 않는다)
            f64 extraKwh;        // 주둔지 발전기 연료 환산
        };
        struct AutonomyOut
        {
            f64 fullH;
            f64 shed3H;
            f64 p1H;
            f64 storeKwh;
        };
        void autonomy(const Site& site, const AutonomyIn& in, AutonomyOut& out);

        // 부하 자동 차단
        enum Posture { POSTURE_NORMAL = 0, POSTURE_QUIET = 1, POSTURE_AUTONOMY = 2 };
        enum ShedWhy { SHED_NONE = 0, SHED_QUIET = 1, SHED_AUTONOMY = 2, SHED_SOC = 3, SHED_CAPACITY = 4 };
        enum Feeder { FEEDER_L3 = 0, FEEDER_L2 = 1, FEEDER_COUNT = 2 };
        struct ShedIn
        {
            Posture posture;
            f64 soc;
            bool hasSupply;      // 공급 능력을 알고 있는가
            f64 supplyKw;
            f64 load12Kw;
            f64 loadKw;
            bool hasAutonomy;
            f64 fullH;
            f64 shed3H;
            f64 targetH;
        };
        void shedWant(const Site& site, const ShedIn& in, ShedWhy want[]);

        enum ShedAct { ACT_SHED = 0, ACT_RESTORE = 1 };
        struct ShedAction
        {
            Feeder feeder;
            ShedAct act;
        };

        // 차단 조건이 holdS 이어지면 차단, 해소 상태가 restoreS 이어지면 복구. EMS 가 끊은 급전선만 되살린다.
        class LoadShedder
        {
        public:
            LoadShedder(f64 holdS, f64 restoreS);
            // cb[f]: 차단기 상태 0 개방 / 1 투입 / 2 트립 / −1 모름. 반환: 조치 수(0~2). 차단은 3→2등급, 복구는 2→3등급 순.
            u32 step(f64 t, const ShedWhy want[], const i32 cb[], bool hasSoc, f64 soc, f64 socMin, ShedAction acts[]);
            bool isMine(Feeder f) const;

        private:
            f64 m_holdS;
            f64 m_restoreS;
            bool m_hasBad[FEEDER_COUNT];
            f64 m_tBad[FEEDER_COUNT];
            bool m_hasOk[FEEDER_COUNT];
            f64 m_tOk[FEEDER_COUNT];
            bool m_mine[FEEDER_COUNT];
        };
    }
}

#endif
