// SHA-256 · HMAC-SHA256 (MISRA C++:2008 준수 지향: 부호 없는 32비트 연산만 사용)
#include "sha256.h"

namespace ems
{
    namespace crypto
    {
        namespace
        {
            const u32 K[64] = {
                0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U, 0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
                0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU, 0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
                0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U, 0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
                0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U, 0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U, 0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U };

            u32 rotr(u32 x, u32 n)
            {
                return (x >> n) | (x << (32U - n));
            }

            u32 load32(const u8 b[], u32 at)
            {
                return (static_cast<u32>(b[at]) << 24U) | (static_cast<u32>(b[at + 1U]) << 16U) | (static_cast<u32>(b[at + 2U]) << 8U) | static_cast<u32>(b[at + 3U]);
            }

            void store32(u8 b[], u32 at, u32 v)
            {
                b[at] = static_cast<u8>((v >> 24U) & 0xFFU);
                b[at + 1U] = static_cast<u8>((v >> 16U) & 0xFFU);
                b[at + 2U] = static_cast<u8>((v >> 8U) & 0xFFU);
                b[at + 3U] = static_cast<u8>(v & 0xFFU);
            }
        }

        Sha256::Sha256() : m_fill(0U), m_bitsHi(0U), m_bitsLo(0U)
        {
            reset();
        }

        void Sha256::reset()
        {
            m_state[0] = 0x6a09e667U;
            m_state[1] = 0xbb67ae85U;
            m_state[2] = 0x3c6ef372U;
            m_state[3] = 0xa54ff53aU;
            m_state[4] = 0x510e527fU;
            m_state[5] = 0x9b05688cU;
            m_state[6] = 0x1f83d9abU;
            m_state[7] = 0x5be0cd19U;
            for (u32 i = 0U; i < SHA256_BLOCK; ++i)
            {
                m_buffer[i] = 0U;
            }
            m_fill = 0U;
            m_bitsHi = 0U;
            m_bitsLo = 0U;
        }

        void Sha256::compress(const u8 block[])
        {
            u32 w[64];
            for (u32 i = 0U; i < 16U; ++i)
            {
                w[i] = load32(block, 4U * i);
            }
            for (u32 i = 16U; i < 64U; ++i)
            {
                const u32 s0 = rotr(w[i - 15U], 7U) ^ rotr(w[i - 15U], 18U) ^ (w[i - 15U] >> 3U);
                const u32 s1 = rotr(w[i - 2U], 17U) ^ rotr(w[i - 2U], 19U) ^ (w[i - 2U] >> 10U);
                w[i] = w[i - 16U] + s0 + w[i - 7U] + s1;
            }
            u32 v[8];
            for (u32 i = 0U; i < 8U; ++i)
            {
                v[i] = m_state[i];
            }
            for (u32 i = 0U; i < 64U; ++i)
            {
                const u32 s1 = rotr(v[4], 6U) ^ rotr(v[4], 11U) ^ rotr(v[4], 25U);
                const u32 ch = (v[4] & v[5]) ^ ((~v[4]) & v[6]);
                const u32 t1 = v[7] + s1 + ch + K[i] + w[i];
                const u32 s0 = rotr(v[0], 2U) ^ rotr(v[0], 13U) ^ rotr(v[0], 22U);
                const u32 maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
                const u32 t2 = s0 + maj;
                v[7] = v[6];
                v[6] = v[5];
                v[5] = v[4];
                v[4] = v[3] + t1;
                v[3] = v[2];
                v[2] = v[1];
                v[1] = v[0];
                v[0] = t1 + t2;
            }
            for (u32 i = 0U; i < 8U; ++i)
            {
                m_state[i] += v[i];
            }
        }

        void Sha256::update(const u8 data[], u32 len)
        {
            for (u32 i = 0U; i < len; ++i)
            {
                m_buffer[m_fill] = data[i];
                ++m_fill;
                if (m_fill == SHA256_BLOCK)
                {
                    compress(m_buffer);
                    m_fill = 0U;
                }
            }
            const u32 addLo = len << 3U;
            const u32 before = m_bitsLo;
            m_bitsLo += addLo;
            m_bitsHi += (len >> 29U) + ((m_bitsLo < before) ? 1U : 0U);
        }

        void Sha256::finish(u8 digest[])
        {
            const u32 bitsHi = m_bitsHi;
            const u32 bitsLo = m_bitsLo;
            u8 pad[SHA256_BLOCK + 8U];
            const u32 padLen = (m_fill < 56U) ? (56U - m_fill) : (120U - m_fill);
            pad[0] = 0x80U;
            for (u32 i = 1U; i < padLen; ++i)
            {
                pad[i] = 0U;
            }
            store32(pad, padLen, bitsHi);
            store32(pad, padLen + 4U, bitsLo);
            update(pad, padLen + 8U);
            for (u32 i = 0U; i < 8U; ++i)
            {
                store32(digest, 4U * i, m_state[i]);
            }
        }

        void hmacSha256(const u8 key[], u32 keyLen, const u8 msg[], u32 msgLen, u8 mac[])
        {
            u8 k0[SHA256_BLOCK];
            u8 pad[SHA256_BLOCK];
            u8 inner[SHA256_LEN];
            Sha256 h;
            for (u32 i = 0U; i < SHA256_BLOCK; ++i)
            {
                k0[i] = 0U;
            }
            if (keyLen > SHA256_BLOCK)
            {
                h.update(key, keyLen);
                h.finish(k0);                             // 긴 키는 해시로 줄인다
                h.reset();
            }
            else
            {
                for (u32 i = 0U; i < keyLen; ++i)
                {
                    k0[i] = key[i];
                }
            }
            for (u32 i = 0U; i < SHA256_BLOCK; ++i)
            {
                pad[i] = static_cast<u8>(static_cast<u32>(k0[i]) ^ 0x36U);
            }
            h.update(pad, SHA256_BLOCK);
            h.update(msg, msgLen);
            h.finish(inner);
            h.reset();
            for (u32 i = 0U; i < SHA256_BLOCK; ++i)
            {
                pad[i] = static_cast<u8>(static_cast<u32>(k0[i]) ^ 0x5cU);
            }
            h.update(pad, SHA256_BLOCK);
            h.update(inner, SHA256_LEN);
            h.finish(mac);
        }

        bool sameDigest(const u8 a[], const u8 b[])
        {
            u32 diff = 0U;
            for (u32 i = 0U; i < SHA256_LEN; ++i)
            {
                diff |= static_cast<u32>(a[i]) ^ static_cast<u32>(b[i]);
            }
            return diff == 0U;
        }
    }
}
