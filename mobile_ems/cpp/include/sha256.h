// SHA-256 과 HMAC-SHA256 (감사 기록 연쇄 서명용). FIPS 180-4 · RFC 2104. 파이썬 기준: hashlib.sha256, hmac
#ifndef EMS_SHA256_H
#define EMS_SHA256_H

#include "ems_types.h"

namespace ems
{
    namespace crypto
    {
        const u32 SHA256_LEN = 32U;
        const u32 SHA256_BLOCK = 64U;

        class Sha256
        {
        public:
            Sha256();
            void reset();
            void update(const u8 data[], u32 len);
            void finish(u8 digest[]);                 // digest 는 SHA256_LEN 바이트 이상. 호출 뒤에는 reset() 해야 다시 쓸 수 있다.

        private:
            void compress(const u8 block[]);
            u32 m_state[8];
            u8 m_buffer[SHA256_BLOCK];
            u32 m_fill;                               // 버퍼에 찬 바이트 수
            u32 m_bitsHi;                             // 지금까지 넣은 길이(비트)의 상·하위 32비트
            u32 m_bitsLo;
        };

        void hmacSha256(const u8 key[], u32 keyLen, const u8 msg[], u32 msgLen, u8 mac[]);
        // 두 MAC 을 길이와 무관한 시간으로 비교한다(시간차 공격 방지)
        bool sameDigest(const u8 a[], const u8 b[]);
    }
}

#endif
