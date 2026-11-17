// IFPS 이동형 EMS — C++ 핵심부 공통 자료형 (MISRA C++:2008 규칙 3-9-2: 크기가 드러나는 자료형 이름 사용)
#ifndef EMS_TYPES_H
#define EMS_TYPES_H

namespace ems
{
    typedef unsigned char u8;
    typedef unsigned short u16;
    typedef unsigned int u32;
    typedef signed short i16;
    typedef signed int i32;
    typedef float f32;
    typedef double f64;

    // 대상 컴파일러에서 크기가 맞지 않으면 여기서 컴파일이 실패한다(C++03 에는 static_assert 가 없다).
    typedef u8 CheckU8Is1Byte[(sizeof(u8) == 1U) ? 1 : -1];
    typedef u8 CheckU16Is2Bytes[(sizeof(u16) == 2U) ? 1 : -1];
    typedef u8 CheckU32Is4Bytes[(sizeof(u32) == 4U) ? 1 : -1];
    typedef u8 CheckF32Is4Bytes[(sizeof(f32) == 4U) ? 1 : -1];
    typedef u8 CheckF64Is8Bytes[(sizeof(f64) == 8U) ? 1 : -1];
}

#endif
