// 예시 3  선택 후 실행 지령의 상태 기계 (CSC-CMD)
// 수용 응답(seq_ack)과 운전 완료를 따로 판정한다. 실패하면 취소 쓰기를 요구한다.
#include "ems_types.h"

enum CmdState { CMD_IDLE, CMD_SENT, CMD_ACCEPTED, CMD_DONE, CMD_FAILED };

struct CmdCtx
{
    CmdState state;
    u16 seq;            // 보낸 순번
    f64 t_sent;         // 보낸 시각(단조 시계, s)
    f64 ack_limit_s;    // 수용 응답 한도
    f64 done_limit_s;   // 운전 완료 한도(장치별 설정)
    bool need_cancel;   // 취소 쓰기(cmd = 0)가 필요한가
};

void cmd_step(CmdCtx& c, f64 now, u16 seq_ack, bool hb_alive, bool reached)
{
    const f64 dt = now - c.t_sent;
    if (c.state == CMD_SENT)
    {
        if (!hb_alive)                 { c.state = CMD_FAILED; }
        else if (seq_ack == c.seq)     { c.state = CMD_ACCEPTED; }
        else if (dt > c.ack_limit_s)   { c.state = CMD_FAILED; }
        else                           { /* 계속 기다린다 */ }
    }
    else if (c.state == CMD_ACCEPTED)
    {
        if (reached)                   { c.state = CMD_DONE; }
        else if (dt > c.done_limit_s)  { c.state = CMD_FAILED; }
        else                           { /* 다시 보내지 않고 기다린다 */ }
    }
    else
    {
        /* IDLE · DONE · FAILED: 할 일 없음 */
    }
    c.need_cancel = (c.state == CMD_FAILED);
}
