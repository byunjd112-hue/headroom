// 군 운용 논리 (MISRA C++:2008 준수 지향). 파이썬 기준 구현 ifps_ems_rt/opsmode.py 와 같은 계산을 한다.
// 파이썬 판은 결과를 소수 한 자리로 반올림해 돌려주지만, 여기서는 반올림하지 않은 값을 돌려준다(표시할 때 반올림).
#include "ops_logic.h"

namespace ems
{
    namespace ops
    {
        namespace
        {
            const f64 PLENTY_H = 999.0;          // '충분함'을 뜻하는 지속시간
            const f64 QUARTER = 4.0;             // 15분 동안 쓸 수 있는 전력 = 에너지 × 4

            f64 maxOf(f64 a, f64 b)
            {
                return (a > b) ? a : b;
            }

            f64 minOf(f64 a, f64 b)
            {
                return (a < b) ? a : b;
            }

            bool inBands(const Band bands[], u32 n, f64 hour)
            {
                bool hit = false;
                const u32 count = (n > MAX_BANDS) ? MAX_BANDS : n;
                for (u32 i = 0U; i < count; ++i)
                {
                    if ((bands[i].from <= hour) && (hour < bands[i].to))
                    {
                        hit = true;
                    }
                }
                return hit;
            }

            // 15분 안에 하한(floorSoc)에 닿지 않는 방전 가능 전력
            f64 canDischarge(const Site& site, f64 soc, f64 floorSoc)
            {
                return maxOf(0.0, minOf(site.essKw, (soc - floorSoc) * site.essKwh * site.essEff * QUARTER));
            }

            f64 canCharge(const Site& site, f64 soc)
            {
                return maxOf(0.0, minOf(site.essKw, ((site.socMax - soc) * site.essKwh / site.essEff) * QUARTER));
            }

            f64 hoursFor(f64 loadKw, f64 pvAvgKw, f64 storeKwh)
            {
                f64 h = PLENTY_H;
                if (loadKw > 0.5)
                {
                    const f64 need = loadKw - pvAvgKw;
                    if (need > 0.5)
                    {
                        h = minOf(PLENTY_H, storeKwh / need);
                    }
                }
                return h;
            }

            // 수전 목표(시간대 충·방전, 정전 대비 충전율 회복, 피크 억제, 최소 수전)
            f64 gridTarget(const Garrison& g, BandKind band, f64 net, f64 soc, f64 canDis, f64 canChg)
            {
                const f64 chargeTarget = minOf(g.peakKw, net + minOf(g.chargeKw, canChg));
                f64 target = net;
                if ((band == BAND_PEAK) && (canDis > 0.0))
                {
                    target = g.importMinKw;
                }
                else if ((band == BAND_OFF) && (canChg > 0.0))
                {
                    target = chargeTarget;
                }
                else
                {
                    target = net;
                }
                if ((soc < (g.reserveSoc - 0.02)) && (canChg > 0.0))
                {
                    target = maxOf(target, chargeTarget);
                }
                if ((net > g.peakKw) && (canDis > 0.0))
                {
                    target = minOf(target, g.peakKw);
                }
                return maxOf(target, g.importMinKw);
            }

            ShedWhy firstOf(ShedWhy current, ShedWhy candidate)
            {
                return (current == SHED_NONE) ? candidate : current;
            }
        }

        BandKind bandOf(const Garrison& g, f64 hour)
        {
            BandKind kind = BAND_MID;
            if (inBands(g.peak, g.nPeak, hour))
            {
                kind = BAND_PEAK;
            }
            else if (inBands(g.offPeak, g.nOffPeak, hour))
            {
                kind = BAND_OFF;
            }
            else
            {
                kind = BAND_MID;
            }
            return kind;
        }

        void garrisonStep(const Site& site, const Garrison& g, const GarrisonIn& in, GarrisonOut& out)
        {
            const bool elzOn = in.elzKw > 1.0;
            const f64 net = (in.loadKw + in.elzKw) - in.pvKw;
            const BandKind band = bandOf(g, in.hour);
            const f64 canDis = canDischarge(site, in.soc, g.reserveSoc);
            const f64 canChg = canCharge(site, in.soc);
            const f64 target = gridTarget(g, band, net, in.soc, canDis, canChg);
            const f64 ess = maxOf(-canChg, minOf(canDis, net - target));
            const f64 grid = net - ess;
            const f64 surplus = g.importMinKw - grid;                 // ESS 로도 못 받는 남는 전력
            const bool h2Room = in.h2Nm3 < (site.h2Nm3 * 0.95);
            f64 pvLimit = 0.0;
            bool elz = elzOn;
            if (surplus > 0.0)
            {
                if ((!elzOn) && h2Room && (surplus >= (site.elzKw * 0.5)))
                {
                    elz = true;
                }
                pvLimit = maxOf(1.0, in.pvKw - surplus);              // 수전해가 실제로 받기 전까지도 역송이 없게, 기동과 함께 제한한다
            }
            else if (elzOn && ((!h2Room) || ((grid - g.importMinKw) > (site.elzKw * 0.5))))
            {
                elz = false;                                          // 상전을 사서 수소를 만들지는 않는다
            }
            else
            {
                elz = elzOn;
            }
            out.gridKw = (pvLimit > 0.0) ? g.importMinKw : grid;
            out.essKw = ess;
            out.pvLimitKw = pvLimit;
            out.elzRun = elz;
            out.band = band;
        }

        void gdgStep(const Site& site, const Garrison& g, const GdgIn& in, GdgOut& out)
        {
            const f64 canChg = canCharge(site, in.soc);
            const f64 canDis = canDischarge(site, in.soc, site.socMin);
            bool run = false;
            GdgWhy why = GDG_WAIT;
            if (in.running)
            {
                const bool full = (in.soc >= g.gdgStopSoc) && (in.netKw <= canDis);
                const bool sun = (in.netKw <= -20.0) && (in.soc >= (g.gdgRestartSoc + 0.10));
                const bool stop = full || sun;
                run = (!stop) || in.hold;
                if (!stop)
                {
                    why = GDG_RUN;
                }
                else if (in.hold)
                {
                    why = GDG_HOLD;
                }
                else if (full)
                {
                    why = GDG_STOP_FULL;
                }
                else
                {
                    why = GDG_STOP_SUN;
                }
            }
            else
            {
                const bool low = in.soc < g.gdgRestartSoc;
                const bool longOutage = (in.outageS >= g.gdgDelayS) && (in.soc < (g.gdgStopSoc - 0.10)) && (in.netKw > 0.0);
                run = low || longOutage || (in.netKw > canDis);
                if (low)
                {
                    why = GDG_START_LOW;
                }
                else if (run)
                {
                    why = GDG_START_OUTAGE;
                }
                else if (in.netKw <= 0.0)
                {
                    why = GDG_WAIT_SUN;
                }
                else
                {
                    why = GDG_WAIT;
                }
            }
            out.run = run;
            out.why = why;
            out.essKw = 0.0;
            out.gdgKw = 0.0;
            out.essAbsorbs = false;
            if (run)
            {
                const f64 target = minOf(g.gdgKw, maxOf(in.netKw, g.gdgMinLoad * g.gdgKw));     // 발전기에 지울 부하
                const f64 ess = maxOf(-canChg, minOf(canDis, in.netKw - target));
                out.essKw = ess;
                out.gdgKw = maxOf(0.0, in.netKw - ess);
                out.essAbsorbs = ess < -1.0;
            }
        }

        void autonomy(const Site& site, const AutonomyIn& in, AutonomyOut& out)
        {
            const f64 eEss = maxOf(0.0, in.soc - site.socMin) * site.essKwh * site.essEff;
            const f64 eH2 = maxOf(0.0, in.h2Nm3 - (site.h2Nm3 * site.h2Min)) / site.fcNm3PerKwh;
            const f64 eDg = in.quiet ? 0.0 : (maxOf(0.0, in.fuelL) / site.dgLPerKwh);
            const f64 store = eEss + eH2 + eDg + maxOf(0.0, in.extraKwh);
            const f64 pvAvg = maxOf(0.0, in.pvKwhDay) / 24.0;
            out.fullH = hoursFor(in.p1Kw + in.p2Kw + in.p3Kw, pvAvg, store);
            out.shed3H = hoursFor(in.p1Kw + in.p2Kw, pvAvg, store);
            out.p1H = hoursFor(in.p1Kw, pvAvg, store);
            out.storeKwh = store;
        }

        void shedWant(const Site& site, const ShedIn& in, ShedWhy want[])
        {
            ShedWhy l3 = SHED_NONE;
            ShedWhy l2 = SHED_NONE;
            if (in.posture == POSTURE_QUIET)
            {
                l3 = SHED_QUIET;
            }
            if ((in.posture == POSTURE_AUTONOMY) && in.hasAutonomy)
            {
                if (in.fullH < in.targetH)
                {
                    l3 = SHED_AUTONOMY;
                }
                if (in.shed3H < (in.targetH * 0.5))
                {
                    l2 = SHED_AUTONOMY;
                }
            }
            if (in.soc < (site.socMin + 0.06))
            {
                l3 = firstOf(l3, SHED_SOC);
            }
            if (in.soc < (site.socMin + 0.03))
            {
                l2 = firstOf(l2, SHED_SOC);
            }
            if (in.hasSupply && (in.loadKw > (in.supplyKw + 1.0)))
            {
                l3 = firstOf(l3, SHED_CAPACITY);
            }
            if (in.hasSupply && (in.load12Kw > (in.supplyKw + 1.0)))
            {
                l2 = firstOf(l2, SHED_CAPACITY);
            }
            if ((l2 != SHED_NONE) && (l3 == SHED_NONE))
            {
                l3 = l2;                                              // 2등급을 끊을 상황이면 3등급은 당연히 끊는다
            }
            want[FEEDER_L3] = l3;
            want[FEEDER_L2] = l2;
        }

        LoadShedder::LoadShedder(f64 holdS, f64 restoreS) : m_holdS(holdS), m_restoreS(restoreS)
        {
            for (u32 i = 0U; i < static_cast<u32>(FEEDER_COUNT); ++i)
            {
                m_hasBad[i] = false;
                m_tBad[i] = 0.0;
                m_hasOk[i] = false;
                m_tOk[i] = 0.0;
                m_mine[i] = false;
            }
        }

        bool LoadShedder::isMine(Feeder f) const
        {
            return (f == FEEDER_L2) ? m_mine[FEEDER_L2] : m_mine[FEEDER_L3];
        }

        u32 LoadShedder::step(f64 t, const ShedWhy want[], const i32 cb[], bool hasSoc, f64 soc, f64 socMin, ShedAction acts[])
        {
            u32 n = 0U;
            // 조치 순서: 3등급을 먼저 보므로 차단은 3→2등급 순이 된다. 2등급이 아직 끊겨 있으면 3등급을 복구하지 않으므로(orderOk)
            // 한 주기에 두 급전선이 함께 복구되는 일은 없다 — 따로 정렬하지 않는다.
            for (u32 f = 0U; f < static_cast<u32>(FEEDER_COUNT); ++f)        // 3등급 → 2등급 순으로 본다
            {
                if (want[f] != SHED_NONE)
                {
                    m_hasOk[f] = false;
                    if (!m_hasBad[f])
                    {
                        m_hasBad[f] = true;
                        m_tBad[f] = t;
                    }
                    if ((cb[f] == 1) && ((t - m_tBad[f]) >= m_holdS))
                    {
                        acts[n].feeder = (f == static_cast<u32>(FEEDER_L2)) ? FEEDER_L2 : FEEDER_L3;
                        acts[n].act = ACT_SHED;
                        ++n;
                        m_mine[f] = true;
                    }
                }
                else
                {
                    m_hasBad[f] = false;
                    if (m_mine[f])
                    {
                        if (cb[f] == 1)
                        {
                            m_mine[f] = false;                                // 운용자가 이미 살렸다
                        }
                        else
                        {
                            if (!m_hasOk[f])
                            {
                                m_hasOk[f] = true;
                                m_tOk[f] = t;
                            }
                            const bool ready = (!hasSoc) || (soc > (socMin + 0.10));
                            const bool orderOk = (f == static_cast<u32>(FEEDER_L2)) || (!m_mine[FEEDER_L2]) || (cb[FEEDER_L2] == 1);
                            if (ready && ((t - m_tOk[f]) >= m_restoreS) && orderOk)
                            {
                                acts[n].feeder = (f == static_cast<u32>(FEEDER_L2)) ? FEEDER_L2 : FEEDER_L3;
                                acts[n].act = ACT_RESTORE;
                                ++n;
                                m_hasOk[f] = false;
                            }
                        }
                    }
                }
            }
            return n;
        }
    }
}
