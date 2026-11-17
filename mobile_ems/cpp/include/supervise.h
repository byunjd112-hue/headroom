// 감시·지령 논리: 값 범위 감시, 생존 계수 감시, 지령 응답 처리(순번 확인 → 상태 변화 확인 → 재지령 → 취소).
// 통신은 ICommandPort 로 추상화한다(실제 전송은 플랫폼 계층이 맡는다). 파이썬 기준: ifps_ems_rt/hal.py (RtCommander.send), runtime.py
#ifndef EMS_SUPERVISE_H
#define EMS_SUPERVISE_H

#include "ems_types.h"

namespace ems
{
    namespace sv
    {
        // 범위 안의 유한한 값만 받아들이고, 아니면 직전 값을 유지한다.
        class ValueGuard
        {
        public:
            ValueGuard(bool hasLo, f64 lo, bool hasHi, f64 hi);
            bool accept(f64 v, f64 now);              // 받아들였으면 true
            bool hasValue() const;
            f64 value() const;                        // 마지막으로 받아들인 값
            f64 ageS(f64 now) const;                  // 마지막 수용 뒤 지난 시간. 값이 없으면 음수
            u32 rejected() const;

        private:
            bool m_hasLo;
            f64 m_lo;
            bool m_hasHi;
            f64 m_hi;
            bool m_has;
            f64 m_value;
            f64 m_time;
            u32 m_rejected;
        };

        // 생존 계수(hb)가 freezeS 동안 바뀌지 않으면 '정지'로 본다(통신은 되지만 제어기가 멈춘 상태).
        class HeartbeatMonitor
        {
        public:
            explicit HeartbeatMonitor(f64 freezeS);
            void update(u16 hb, f64 now);
            bool frozen(f64 now) const;

        private:
            f64 m_freezeS;
            bool m_seen;
            u16 m_last;
            f64 m_changed;
        };

        class ICommandPort
        {
        public:
            virtual ~ICommandPort() {}
            virtual bool writeCommand(u16 seq, u16 code) = 0;     // 순번과 지령을 함께 쓴다. 성공하면 true
            virtual bool cancel() = 0;                            // 지령 취소(cmd = 0)
        };

        enum CmdState { CS_IDLE = 0, CS_WAIT_ACK = 1, CS_WAIT_DONE = 2, CS_OK = 3, CS_FAILED = 4 };
        enum CmdFail { CF_NONE = 0, CF_NO_ACK = 1, CF_NOT_DONE = 2 };

        struct CmdConfig
        {
            f64 ackS;                 // 수용(순번 되돌림) 확인 한도
            f64 doneS;                // 수용 뒤 상태 변화 완료 한도(기동에 시간이 걸리는 장비)
            u32 retries;              // 재지령 횟수
        };

        // 지령 한 건의 진행을 관리한다. 블로킹하지 않는다: start() 뒤 수집 주기마다 poll() 을 부른다.
        class Commander
        {
        public:
            Commander(ICommandPort& port, const CmdConfig& cfg);
            // 지령 시작. 진행 중이면 false. deviceLastSeq: 장치가 마지막으로 되돌린 순번.
            bool start(bool wantOn, u16 code, u16 deviceLastSeq, f64 now);
            // fresh: 이번 주기에 장치 값을 새로 읽었는가. seqAck·statusOn: 읽은 값.
            void poll(f64 now, bool fresh, u16 seqAck, bool statusOn);
            CmdState state() const;
            CmdFail failure() const;
            u16 seq() const;
            u32 attempts() const;
            bool cancelled() const;                   // 실패 뒤 취소 쓰기가 성공했는가
            static u16 nextSeq(u16 seq, u16 deviceLastSeq);   // 1~65535 순환

        private:
            Commander(const Commander&);              // 복사 금지
            Commander& operator=(const Commander&);
            void send(f64 now);
            void expire(f64 now);
            ICommandPort& m_port;
            CmdConfig m_cfg;
            CmdState m_state;
            CmdFail m_fail;
            u16 m_seq;
            u16 m_code;
            bool m_wantOn;
            bool m_sent;
            bool m_acked;
            bool m_cancelled;
            u32 m_attempts;
            f64 m_deadline;
        };
    }
}

#endif
