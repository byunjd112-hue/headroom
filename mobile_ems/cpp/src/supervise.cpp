// 감시·지령 논리 (MISRA C++:2008 준수 지향)
#include "supervise.h"

#include <cfloat>

namespace ems
{
    namespace sv
    {
        ValueGuard::ValueGuard(bool hasLo, f64 lo, bool hasHi, f64 hi)
            : m_hasLo(hasLo), m_lo(lo), m_hasHi(hasHi), m_hi(hi), m_has(false), m_value(0.0), m_time(0.0), m_rejected(0U)
        {
        }

        bool ValueGuard::accept(f64 v, f64 now)
        {
            const bool finite = (v >= -DBL_MAX) && (v <= DBL_MAX);
            const bool aboveLo = (!m_hasLo) || (v >= m_lo);
            const bool belowHi = (!m_hasHi) || (v <= m_hi);
            const bool ok = finite && aboveLo && belowHi;
            if (ok)
            {
                m_has = true;
                m_value = v;
                m_time = now;
            }
            else
            {
                m_rejected += 1U;
            }
            return ok;
        }

        bool ValueGuard::hasValue() const
        {
            return m_has;
        }

        f64 ValueGuard::value() const
        {
            return m_value;
        }

        f64 ValueGuard::ageS(f64 now) const
        {
            return m_has ? (now - m_time) : -1.0;
        }

        u32 ValueGuard::rejected() const
        {
            return m_rejected;
        }

        HeartbeatMonitor::HeartbeatMonitor(f64 freezeS) : m_freezeS(freezeS), m_seen(false), m_last(0U), m_changed(0.0)
        {
        }

        void HeartbeatMonitor::update(u16 hb, f64 now)
        {
            if ((!m_seen) || (hb != m_last))
            {
                m_seen = true;
                m_last = hb;
                m_changed = now;
            }
        }

        bool HeartbeatMonitor::frozen(f64 now) const
        {
            return m_seen && ((now - m_changed) >= m_freezeS);
        }

        Commander::Commander(ICommandPort& port, const CmdConfig& cfg)
            : m_port(port), m_cfg(cfg), m_state(CS_IDLE), m_fail(CF_NONE), m_seq(0U), m_code(0U), m_wantOn(false), m_sent(false), m_acked(false), m_cancelled(false), m_attempts(0U), m_deadline(0.0)
        {
        }

        u16 Commander::nextSeq(u16 seq, u16 deviceLastSeq)
        {
            const u32 base = (static_cast<u32>(seq) > static_cast<u32>(deviceLastSeq)) ? static_cast<u32>(seq) : static_cast<u32>(deviceLastSeq);
            return static_cast<u16>((base % 65535U) + 1U);
        }

        void Commander::send(f64 now)
        {
            m_sent = m_port.writeCommand(m_seq, m_code);
            m_acked = false;
            m_attempts += 1U;
            m_deadline = now + m_cfg.ackS;
            m_state = CS_WAIT_ACK;
        }

        bool Commander::start(bool wantOn, u16 code, u16 deviceLastSeq, f64 now)
        {
            const bool busy = (m_state == CS_WAIT_ACK) || (m_state == CS_WAIT_DONE);
            if (!busy)
            {
                m_wantOn = wantOn;
                m_code = code;
                m_fail = CF_NONE;
                m_cancelled = false;
                m_attempts = 0U;
                m_seq = nextSeq(m_seq, deviceLastSeq);
                send(now);
            }
            return !busy;
        }

        void Commander::expire(f64 now)
        {
            if (m_attempts <= m_cfg.retries)
            {
                m_seq = nextSeq(m_seq, m_seq);                // 재지령은 새 순번으로
                send(now);
            }
            else
            {
                m_fail = m_acked ? CF_NOT_DONE : CF_NO_ACK;
                m_cancelled = m_port.cancel();                // 잔류 지령이 뒤늦게 실행되지 않게 취소해 둔다
                m_state = CS_FAILED;
            }
        }

        void Commander::poll(f64 now, bool fresh, u16 seqAck, bool statusOn)
        {
            const bool waiting = (m_state == CS_WAIT_ACK) || (m_state == CS_WAIT_DONE);
            if (waiting)
            {
                if (now >= m_deadline)
                {
                    expire(now);
                }
                else if (m_sent && fresh)
                {
                    if ((!m_acked) && (seqAck == m_seq))
                    {
                        const f64 doneDeadline = now + m_cfg.doneS;
                        m_acked = true;                       // 수용 확인 → 상태 변화는 장치별 한도까지 기다린다
                        m_deadline = (doneDeadline > m_deadline) ? doneDeadline : m_deadline;
                        m_state = CS_WAIT_DONE;
                    }
                    if (m_acked && (statusOn == m_wantOn))
                    {
                        m_state = CS_OK;
                    }
                }
                else
                {
                    m_state = m_acked ? CS_WAIT_DONE : CS_WAIT_ACK;   // 쓰기 실패나 읽기 실패: 한도까지 기다린다
                }
            }
        }

        CmdState Commander::state() const
        {
            return m_state;
        }

        CmdFail Commander::failure() const
        {
            return m_fail;
        }

        u16 Commander::seq() const
        {
            return m_seq;
        }

        u32 Commander::attempts() const
        {
            return m_attempts;
        }

        bool Commander::cancelled() const
        {
            return m_cancelled;
        }
    }
}
