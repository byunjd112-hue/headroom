// 대응표 검사·읽기 묶음 (MISRA C++:2008 준수 지향)
#include "pointmap.h"
#include "modbus_codec.h"

#include <cmath>

namespace ems
{
    namespace pm
    {
        namespace
        {
            const f64 TINY = 1.0e-300;
            const u32 MAX_USED = MAX_POINTS * mb::MAX_WORDS;

            bool sameTag(const char a[], const char b[])
            {
                bool same = true;
                bool done = false;
                for (u32 i = 0U; (i < MAX_TAG) && (!done); ++i)
                {
                    if (a[i] != b[i])
                    {
                        same = false;
                        done = true;
                    }
                    else if (a[i] == '\0')
                    {
                        done = true;
                    }
                    else
                    {
                        done = false;
                    }
                }
                return same;
            }

            // 이름이 ".kw" 로 끝나는가
            bool endsWithKw(const char tag[])
            {
                u32 len = 0U;
                while ((len < MAX_TAG) && (tag[len] != '\0'))
                {
                    ++len;
                }
                return (len >= 3U) && (tag[len - 3U] == '.') && (tag[len - 2U] == 'k') && (tag[len - 1U] == 'w');
            }

            u32 wordsOf(u32 type)
            {
                return (type < TYPE_INVALID) ? mb::wordCount(static_cast<mb::Type>(type)) : 0U;
            }

            void add(Report& report, ErrorKind kind, u32 index)
            {
                report.count[kind] += 1U;
                report.total += 1U;
                if (index < report.firstIndex)
                {
                    report.firstIndex = index;
                }
            }

            struct Used
            {
                i32 device;
                u32 fc;
                u32 addr;
            };

            // 한 점의 내용 검사(주소 겹침 제외)
            void checkPoint(const Point& p, u32 index, Report& report)
            {
                if (p.order >= ORDER_INVALID) { add(report, E_ORDER, index); }
                if ((p.fc != 3U) && (p.fc != 4U)) { add(report, E_FC, index); }
                if ((p.rw != RW_READ) && (p.rw != RW_WRITE)) { add(report, E_RW, index); }
                if ((p.rw == RW_WRITE) && (p.fc != 3U)) { add(report, E_WRITE_FC, index); }
                if (p.unit >= UNIT_COUNT) { add(report, E_UNIT, index); }
                if (std::fabs(p.scale) < TINY) { add(report, E_SCALE_ZERO, index); }
                if (p.hasLo && p.hasHi && (p.lo >= p.hi)) { add(report, E_RANGE, index); }
                if (p.device == DEVICE_UNDEFINED) { add(report, E_DEVICE, index); }
                if (endsWithKw(p.tag) && (p.unit != UNIT_KW)) { add(report, E_KW_UNIT, index); }
            }
        }

        void validate(const Point pts[], u32 n, Report& report)
        {
            static Used used[MAX_USED];                       // 크기가 커서 스택 대신 정적 저장소에 둔다(호출마다 nUsed 로 초기화)
            u32 nUsed = 0U;
            const u32 count = (n > MAX_POINTS) ? MAX_POINTS : n;
            for (u32 k = 0U; k < static_cast<u32>(E_KIND_COUNT); ++k)
            {
                report.count[k] = 0U;
            }
            report.total = 0U;
            report.firstIndex = count;
            for (u32 i = 0U; i < count; ++i)
            {
                const Point& p = pts[i];
                bool dup = false;
                for (u32 j = 0U; j < i; ++j)
                {
                    dup = dup || sameTag(pts[j].tag, p.tag);
                }
                if (dup) { add(report, E_DUP_TAG, i); }
                const u32 words = wordsOf(p.type);
                if (words == 0U)
                {
                    add(report, E_TYPE, i);                   // 자료형을 모르면 나머지 검사를 할 수 없다
                }
                else
                {
                    checkPoint(p, i, report);
                    for (u32 w = 0U; w < words; ++w)
                    {
                        const u32 a = p.addr + w;
                        bool hit = false;
                        for (u32 u = 0U; u < nUsed; ++u)
                        {
                            hit = hit || ((used[u].device == p.device) && (used[u].fc == p.fc) && (used[u].addr == a));
                        }
                        if (hit)
                        {
                            add(report, E_OVERLAP, i);
                        }
                        else if (nUsed < MAX_USED)
                        {
                            used[nUsed].device = p.device;
                            used[nUsed].fc = p.fc;
                            used[nUsed].addr = a;
                            ++nUsed;
                        }
                        else
                        {
                            // 표가 가득 참 — 도달하지 않는다(MAX_USED = 최대 점 수 × 최대 워드 수)
                        }
                    }
                }
            }
        }

        u32 blocks(const Point pts[], u32 n, i32 device, u32 gap, u32 maxLen, Block out[])
        {
            u32 nOut = 0U;
            const u32 count = (n > MAX_POINTS) ? MAX_POINTS : n;
            for (u32 fc = 3U; fc <= 4U; ++fc)
            {
                u32 idx[MAX_POINTS];
                u32 m = 0U;
                for (u32 i = 0U; i < count; ++i)              // 대상 점을 고르면서 주소순으로 끼워 넣는다(같은 주소는 입력 순서 유지)
                {
                    const Point& p = pts[i];
                    if ((p.device == device) && (p.fc == fc) && (p.rw == RW_READ) && (wordsOf(p.type) > 0U))
                    {
                        u32 at = m;
                        while ((at > 0U) && (pts[idx[at - 1U]].addr > p.addr))
                        {
                            idx[at] = idx[at - 1U];
                            --at;
                        }
                        idx[at] = i;
                        ++m;
                    }
                }
                const u32 first = nOut;
                u32 end = 0U;                                 // 현재 묶음의 끝 주소(다음 주소)
                for (u32 k = 0U; k < m; ++k)
                {
                    const Point& p = pts[idx[k]];
                    const u32 pEnd = p.addr + wordsOf(p.type);
                    const bool open = nOut > first;
                    const bool joins = open && (p.addr <= (end + gap)) && ((pEnd - out[nOut - 1U].start) <= maxLen);
                    if (joins)
                    {
                        end = pEnd;                           // 파이썬 기준 구현과 같이 끝 주소를 이 점의 끝으로 둔다
                        out[nOut - 1U].count = end - out[nOut - 1U].start;
                        out[nOut - 1U].points += 1U;
                    }
                    else if (nOut < MAX_BLOCKS)
                    {
                        out[nOut].fc = fc;
                        out[nOut].start = p.addr;
                        out[nOut].count = pEnd - p.addr;
                        out[nOut].points = 1U;
                        end = pEnd;
                        ++nOut;
                    }
                    else
                    {
                        end = pEnd;                           // 묶음 표가 가득 참 — 더 만들지 않는다
                    }
                }
            }
            return nOut;
        }

        bool parseDecimal(const char text[], u32 len, f64& value)
        {
            bool ok = len > 0U;
            bool neg = false;
            bool seenDot = false;
            u32 digits = 0U;
            f64 mant = 0.0;
            f64 div = 1.0;
            value = 0.0;
            for (u32 i = 0U; (i < len) && ok; ++i)
            {
                const char c = text[i];
                if ((i == 0U) && ((c == '-') || (c == '+')))
                {
                    neg = (c == '-');
                }
                else if ((c == '.') && (!seenDot))
                {
                    seenDot = true;
                }
                else if ((c >= '0') && (c <= '9'))
                {
                    mant = (mant * 10.0) + static_cast<f64>(static_cast<i32>(c) - static_cast<i32>('0'));
                    div = seenDot ? (div * 10.0) : div;
                    ++digits;
                }
                else
                {
                    ok = false;
                }
            }
            ok = ok && (digits > 0U) && (digits <= 15U);      // 15자리까지는 나눗셈 한 번으로 정확히 반올림된다
            if (ok)
            {
                const f64 v = mant / div;
                value = neg ? (-v) : v;
            }
            return ok;
        }
    }
}
