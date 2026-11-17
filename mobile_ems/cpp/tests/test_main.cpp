// C++ 핵심부 시험. (1) 파이썬 기준 구현과의 동등성: tools/gen_vectors.py 가 만든 벡터를 그대로 넣어 결과를 비교한다.
// (2) 프레임·오류 경로 단위 시험. 시험 코드는 MISRA 적용 대상이 아니다(표준 입출력·문자열 사용).
#include "modbus_codec.h"
#include "ops_logic.h"

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

using namespace ems;

static int g_checks = 0;
static int g_fail = 0;
static std::string g_case;

static void check(bool ok, const std::string& what)
{
    ++g_checks;
    if (!ok)
    {
        ++g_fail;
        if (g_fail <= 30) { std::cout << "  실패 [" << g_case << "] " << what << "\n"; }
    }
}

static bool nearly(f64 a, f64 b, f64 tol) { return std::fabs(a - b) <= tol; }

static std::vector<std::vector<std::string> > load(const std::string& dir, const std::string& name)
{
    std::vector<std::vector<std::string> > rows;
    std::ifstream f((dir + "/" + name).c_str());
    std::string line;
    while (std::getline(f, line))
    {
        std::istringstream is(line);
        std::vector<std::string> r;
        std::string tok;
        while (is >> tok) { r.push_back(tok); }
        if (!r.empty()) { rows.push_back(r); }
    }
    if (rows.empty()) { std::cout << "  벡터 없음: " << name << "\n"; ++g_fail; }
    return rows;
}

static f64 num(const std::string& s) { return std::strtod(s.c_str(), 0); }
static int integer(const std::string& s) { return std::atoi(s.c_str()); }

static void testDecode(const std::string& dir)
{
    g_case = "decode 동등성";
    const std::vector<std::vector<std::string> > rows = load(dir, "decode.txt");
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        u16 regs[4];
        for (int k = 0; k < 4; ++k) { regs[k] = static_cast<u16>(integer(r[3 + k])); }
        f64 v = 0.0;
        const mb::Status st = mb::decode(regs, 4U, static_cast<mb::Type>(integer(r[0])), num(r[2]), static_cast<mb::Order>(integer(r[1])), v);
        check(st == mb::ST_OK, "상태");
        if (r[7] == "nan") { check(v != v, "NaN"); }
        else { check(v == num(r[7]), "값 불일치 줄 " + r[0] + " " + r[1] + " " + r[7]); }
    }
}

static void testEncode(const std::string& dir)
{
    g_case = "encode 동등성";
    const std::vector<std::vector<std::string> > rows = load(dir, "encode.txt");
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        u16 regs[4] = { 0U, 0U, 0U, 0U };
        u32 n = 0U;
        const mb::Type t = static_cast<mb::Type>(integer(r[0]));
        const mb::Status st = mb::encode(num(r[3]), t, num(r[2]), static_cast<mb::Order>(integer(r[1])), regs, n);
        const bool ok = integer(r[4]) == 1;
        check((st == mb::ST_OK) == ok, "수용·거부 불일치 형 " + r[0] + " 값 " + r[3]);
        if (ok && (st == mb::ST_OK))
        {
            check(n == mb::wordCount(t), "레지스터 수");
            for (u32 k = 0U; k < n; ++k) { check(static_cast<int>(regs[k]) == integer(r[5 + k]), "레지스터 불일치 형 " + r[0] + " 순서 " + r[1] + " 값 " + r[3]); }
            f64 back = 0.0;                                                     // 되읽기: 쓴 것을 읽으면 같은 값
            check(mb::decode(regs, n, t, 1.0, static_cast<mb::Order>(integer(r[1])), back) == mb::ST_OK, "되읽기");
        }
    }
}

static ops::Site loadSite(const std::string& dir)
{
    const std::vector<std::string> r = load(dir, "site.txt")[0];
    ops::Site s;
    s.essKwh = num(r[0]); s.essKw = num(r[1]); s.socMin = num(r[2]); s.socMax = num(r[3]); s.essEff = num(r[4]);
    s.dgLPerKwh = num(r[5]); s.fcNm3PerKwh = num(r[6]); s.elzKw = num(r[7]); s.h2Nm3 = num(r[8]); s.h2Min = num(r[9]);
    return s;
}

static ops::Garrison defaultGarrison()
{
    ops::Garrison g;
    g.peakKw = 150.0; g.importMinKw = 5.0; g.reserveSoc = 0.50; g.chargeKw = 150.0;
    g.peak[0].from = 10.0; g.peak[0].to = 12.0; g.peak[1].from = 13.0; g.peak[1].to = 17.0; g.nPeak = 2U;
    g.offPeak[0].from = 23.0; g.offPeak[0].to = 24.0; g.offPeak[1].from = 0.0; g.offPeak[1].to = 9.0; g.nOffPeak = 2U;
    for (u32 i = 2U; i < ops::MAX_BANDS; ++i) { g.peak[i].from = 0.0; g.peak[i].to = 0.0; g.offPeak[i].from = 0.0; g.offPeak[i].to = 0.0; }
    g.gdgKw = 1000.0; g.gdgMinLoad = 0.30; g.gdgDelayS = 30.0; g.gdgStopSoc = 0.85; g.gdgRestartSoc = 0.35;
    return g;
}

// 파이썬 판은 소수 한 자리로 반올림해 돌려준다 → 차이가 반올림 오차(0.05) 이내인지 본다
static const f64 TOL1 = 0.05 + 1.0e-9;

static void testOps(const std::string& dir)
{
    const ops::Site site = loadSite(dir);
    const ops::Garrison g = defaultGarrison();
    g_case = "주둔지 제어 동등성";
    std::vector<std::vector<std::string> > rows = load(dir, "garrison.txt");
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        ops::GarrisonIn in; in.hour = num(r[0]); in.loadKw = num(r[1]); in.pvKw = num(r[2]); in.elzKw = num(r[3]); in.soc = num(r[4]); in.h2Nm3 = num(r[5]);
        ops::GarrisonOut o;
        ops::garrisonStep(site, g, in, o);
        check(nearly(o.gridKw, num(r[6]), TOL1), "수전"); check(nearly(o.essKw, num(r[7]), TOL1), "ESS"); check(nearly(o.pvLimitKw, num(r[8]), TOL1), "PV 제한");
        check((o.elzRun ? 1 : 0) == integer(r[9]), "수전해"); check(static_cast<int>(o.band) == integer(r[10]), "시간대");
        check(o.gridKw >= (g.importMinKw - 1.0e-9), "역송 없음(최소 수전 유지)");
    }
    g_case = "주둔지 발전기 동등성";
    rows = load(dir, "gdg.txt");
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        ops::GdgIn in; in.outageS = num(r[0]); in.soc = num(r[1]); in.running = integer(r[2]) == 1; in.netKw = num(r[3]); in.hold = integer(r[4]) == 1;
        ops::GdgOut o;
        ops::gdgStep(site, g, in, o);
        check((o.run ? 1 : 0) == integer(r[5]), "기동 판단"); check(nearly(o.essKw, num(r[6]), TOL1), "ESS"); check(nearly(o.gdgKw, num(r[7]), TOL1), "발전기 부하");
        check(static_cast<int>(o.why) == integer(r[8]), "사유 " + r[8]); check((o.essAbsorbs ? 1 : 0) == integer(r[9]), "부하율 유지 표시");
    }
    g_case = "자립 지속시간 동등성";
    rows = load(dir, "autonomy.txt");
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        ops::AutonomyIn in; in.soc = num(r[0]); in.h2Nm3 = num(r[1]); in.fuelL = num(r[2]); in.p1Kw = num(r[3]); in.p2Kw = num(r[4]); in.p3Kw = num(r[5]);
        in.pvKwhDay = num(r[6]); in.quiet = integer(r[7]) == 1; in.extraKwh = num(r[8]);
        ops::AutonomyOut o;
        ops::autonomy(site, in, o);
        check(nearly(o.fullH, num(r[9]), TOL1), "전 부하"); check(nearly(o.shed3H, num(r[10]), TOL1), "3등급 차단"); check(nearly(o.p1H, num(r[11]), TOL1), "1등급"); check(nearly(o.storeKwh, num(r[12]), 0.5 + 1.0e-9), "저장량");
    }
    g_case = "부하 차단 판단 동등성";
    rows = load(dir, "shedwant.txt");
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        ops::ShedIn in; in.posture = static_cast<ops::Posture>(integer(r[0])); in.soc = num(r[1]); in.hasSupply = integer(r[2]) == 1; in.supplyKw = num(r[3]); in.load12Kw = num(r[4]); in.loadKw = num(r[5]);
        in.hasAutonomy = integer(r[6]) == 1; in.fullH = num(r[7]); in.shed3H = num(r[8]); in.targetH = num(r[9]);
        ops::ShedWhy w[ops::FEEDER_COUNT];
        ops::shedWant(site, in, w);
        check(static_cast<int>(w[ops::FEEDER_L3]) == integer(r[10]), "3등급 사유"); check(static_cast<int>(w[ops::FEEDER_L2]) == integer(r[11]), "2등급 사유");
    }
    g_case = "부하 차단·복구 순서 동등성";
    rows = load(dir, "shedseq.txt");
    ops::LoadShedder sd(3.0, 60.0);
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const std::vector<std::string>& r = rows[i];
        if (r[0] == "reset") { sd = ops::LoadShedder(3.0, 60.0); continue; }
        ops::ShedWhy w[ops::FEEDER_COUNT]; w[ops::FEEDER_L3] = (integer(r[1]) == 1) ? ops::SHED_SOC : ops::SHED_NONE; w[ops::FEEDER_L2] = (integer(r[2]) == 1) ? ops::SHED_SOC : ops::SHED_NONE;
        i32 cb[ops::FEEDER_COUNT]; cb[ops::FEEDER_L3] = integer(r[3]); cb[ops::FEEDER_L2] = integer(r[4]);
        ops::ShedAction a[ops::FEEDER_COUNT];
        const u32 n = sd.step(num(r[0]), w, cb, integer(r[5]) == 1, num(r[6]), site.socMin, a);
        check(static_cast<int>(n) == integer(r[7]), "조치 수");
        for (u32 k = 0U; (k < n) && (static_cast<int>(n) == integer(r[7])); ++k) { check((static_cast<int>(a[k].feeder) == integer(r[8 + 2 * k])) && (static_cast<int>(a[k].act) == integer(r[9 + 2 * k])), "조치 순서"); }
    }
    check(!sd.isMine(ops::FEEDER_L2) || sd.isMine(ops::FEEDER_L2), "상태 조회"); check(sd.isMine(ops::FEEDER_L3) == sd.isMine(ops::FEEDER_L3), "상태 조회");
    g_case = "시간대";
    check(ops::bandOf(g, 10.0) == ops::BAND_PEAK, "10시 최대부하"); check(ops::bandOf(g, 12.0) == ops::BAND_MID, "12시 중간"); check(ops::bandOf(g, 23.5) == ops::BAND_OFF, "23.5시 경부하");
    ops::Garrison many = g; many.nPeak = 99U;                                           // 개수가 한도를 넘어도 배열 밖을 읽지 않는다
    check(ops::bandOf(many, 10.5) == ops::BAND_PEAK, "한도 초과 개수 방어");
}

static void testCodecUnits()
{
    g_case = "부호화 단위 시험";
    u16 w[4] = { 0x1122U, 0x3344U, 0U, 0U }; u16 o[4]; f64 v = 0.0; u32 n = 0U; u16 regs[4];
    check(mb::toStd(w, 2U, mb::O_CDAB, o) == mb::ST_OK && o[0] == 0x3344U && o[1] == 0x1122U, "CDAB");
    check(mb::toStd(w, 2U, mb::O_BADC, o) == mb::ST_OK && o[0] == 0x2211U && o[1] == 0x4433U, "BADC");
    check(mb::toStd(w, 2U, mb::O_DCBA, o) == mb::ST_OK && o[0] == 0x4433U && o[1] == 0x2211U, "DCBA");
    check(mb::fromStd(o, 2U, mb::O_DCBA, regs) == mb::ST_OK && regs[0] == 0x1122U && regs[1] == 0x3344U, "역변환");
    check(mb::toStd(w, 0U, mb::O_ABCD, o) == mb::ST_ERR_LENGTH && mb::toStd(w, 5U, mb::O_ABCD, o) == mb::ST_ERR_LENGTH, "길이 오류");
    check(mb::wordCount(mb::T_COUNT) == 0U && mb::wordCount(mb::T_F64) == 4U && mb::wordCount(mb::T_I32) == 2U, "레지스터 수");
    check(mb::decode(w, 2U, mb::T_COUNT, 1.0, mb::O_ABCD, v) == mb::ST_ERR_TYPE, "자료형 오류");
    check(mb::decode(w, 1U, mb::T_U32, 1.0, mb::O_ABCD, v) == mb::ST_ERR_LENGTH, "레지스터 부족");
    check(mb::decode(w, 2U, mb::T_U32, 1.0, mb::O_ABCD, v) == mb::ST_OK && v == 287454020.0, "u32");
    const u16 inf32[2] = { 0x7F80U, 0U }; const u16 ninf32[2] = { 0xFF80U, 0U }; const u16 den32[2] = { 0U, 1U };
    check(mb::decode(inf32, 2U, mb::T_F32, 1.0, mb::O_ABCD, v) == mb::ST_OK && v > 1.0e300, "f32 +무한대");
    check(mb::decode(ninf32, 2U, mb::T_F32, 1.0, mb::O_ABCD, v) == mb::ST_OK && v < -1.0e300, "f32 −무한대");
    check(mb::decode(den32, 2U, mb::T_F32, 1.0, mb::O_ABCD, v) == mb::ST_OK && v > 0.0 && v < 1.0e-44, "f32 비정규");
    const u16 inf64[4] = { 0x7FF0U, 0U, 0U, 0U }; const u16 nan64[4] = { 0x7FF8U, 0U, 0U, 1U }; const u16 den64[4] = { 0U, 0U, 0U, 1U };
    check(mb::decode(inf64, 4U, mb::T_F64, 1.0, mb::O_ABCD, v) == mb::ST_OK && v > 1.0e300, "f64 무한대");
    check(mb::decode(nan64, 4U, mb::T_F64, 1.0, mb::O_ABCD, v) == mb::ST_OK && v != v, "f64 NaN");
    check(mb::decode(den64, 4U, mb::T_F64, 1.0, mb::O_ABCD, v) == mb::ST_OK && v > 0.0 && v < 1.0e-320, "f64 비정규");
    const f64 zero = 0.0;
    check(mb::encode(1.0 / zero, mb::T_U16, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_NOT_FINITE && n == 0U, "무한대 거부");
    check(mb::encode(zero / zero, mb::T_F32, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_NOT_FINITE, "NaN 거부");
    check(mb::encode(1.0, mb::T_U16, 0.0, mb::O_ABCD, regs, n) == mb::ST_ERR_ARG, "배율 0 거부");
    check(mb::encode(1.0, mb::T_COUNT, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_TYPE, "자료형 오류");
    check(mb::encode(70000.0, mb::T_U16, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE && mb::encode(-1.0, mb::T_U16, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE, "u16 범위");
    check(mb::encode(40000.0, mb::T_I16, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE && mb::encode(5.0e9, mb::T_U32, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE, "i16·u32 범위");
    check(mb::encode(3.0e9, mb::T_I32, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE && mb::encode(-1.0, mb::T_U64, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE, "i32·u64 범위");
    check(mb::encode(1.0e19, mb::T_I64, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE && mb::encode(1.0e39, mb::T_F32, 1.0, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE, "i64·f32 범위");
    check(mb::encode(1.0e300, mb::T_F64, 1.0e-10, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE && mb::encode(1.0e300, mb::T_U16, 1.0e-10, mb::O_ABCD, regs, n) == mb::ST_ERR_RANGE, "배율 적용 뒤 넘침");
    check(mb::encode(-2147483648.0, mb::T_I32, 1.0, mb::O_ABCD, regs, n) == mb::ST_OK && regs[0] == 0x8000U && regs[1] == 0U, "i32 최솟값");
    check(mb::encode(-1.0, mb::T_I64, 1.0, mb::O_ABCD, regs, n) == mb::ST_OK && regs[0] == 0xFFFFU && regs[3] == 0xFFFFU, "i64 −1");
    check(mb::encode(-4294967296.0, mb::T_I64, 1.0, mb::O_ABCD, regs, n) == mb::ST_OK && regs[1] == 0xFFFFU && regs[2] == 0U && regs[3] == 0U, "i64 올림 전파");
    check(mb::encode(-2.5, mb::T_F64, 1.0, mb::O_ABCD, regs, n) == mb::ST_OK && regs[0] == 0xC004U, "f64 음수");
    check(mb::encode(4.9e-324, mb::T_F64, 1.0, mb::O_ABCD, regs, n) == mb::ST_OK && regs[3] == 1U && regs[0] == 0U, "f64 비정규");

    g_case = "프레임";
    u8 adu[mb::MAX_ADU]; u32 len = 0U; u8 ex = 0U; u16 rr[mb::MAX_READ];
    check(mb::buildRead(0x1234U, 7U, mb::FC_READ_HOLDING, 10U, 2U, adu, len) == mb::ST_OK && len == 12U, "읽기 요청 길이");
    const u8 want[12] = { 0x12U, 0x34U, 0U, 0U, 0U, 6U, 7U, 3U, 0U, 10U, 0U, 2U };
    bool same = true; for (u32 i = 0U; i < 12U; ++i) { same = same && (adu[i] == want[i]); }
    check(same, "읽기 요청 내용");
    check(mb::buildRead(1U, 1U, 6U, 0U, 1U, adu, len) == mb::ST_ERR_ARG && len == 0U, "기능 코드 거부");
    check(mb::buildRead(1U, 1U, mb::FC_READ_INPUT, 0U, 0U, adu, len) == mb::ST_ERR_RANGE && mb::buildRead(1U, 1U, 4U, 0U, 126U, adu, len) == mb::ST_ERR_RANGE && mb::buildRead(1U, 1U, 4U, 65535U, 2U, adu, len) == mb::ST_ERR_RANGE, "개수·주소 범위");
    const u16 cmd[2] = { 1U, 0x0102U };
    check(mb::buildWriteMulti(9U, 3U, 10U, cmd, 2U, adu, len) == mb::ST_OK && len == 17U && adu[5] == 11U && adu[7] == 16U && adu[12] == 4U && adu[15] == 1U && adu[16] == 2U, "쓰기 요청");
    check(mb::buildWriteMulti(9U, 3U, 10U, cmd, 0U, adu, len) == mb::ST_ERR_RANGE && mb::buildWriteMulti(9U, 3U, 10U, cmd, 124U, adu, len) == mb::ST_ERR_RANGE && mb::buildWriteMulti(9U, 3U, 65535U, cmd, 2U, adu, len) == mb::ST_ERR_RANGE, "쓰기 범위");
    u8 rsp[13] = { 0x12U, 0x34U, 0U, 0U, 0U, 7U, 7U, 3U, 4U, 0xABU, 0xCDU, 0U, 5U };
    check(mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_OK && rr[0] == 0xABCDU && rr[1] == 5U, "정상 응답");
    check(mb::parseReadResponse(rsp, 8U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "짧은 응답");
    check(mb::parseReadResponse(rsp, 13U, 0x1235U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "거래 번호 불일치");
    check(mb::parseReadResponse(rsp, 13U, 0x1234U, 8U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "장치 번호 불일치");
    check(mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 4U, 2U, rr, ex) == mb::ST_ERR_FRAME, "기능 코드 불일치");
    check(mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 3U, rr, ex) == mb::ST_ERR_FRAME && mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 0U, rr, ex) == mb::ST_ERR_FRAME && mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 200U, rr, ex) == mb::ST_ERR_FRAME, "개수 불일치");
    rsp[3] = 1U; check(mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "프로토콜 식별자"); rsp[3] = 0U;
    rsp[5] = 9U; check(mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "길이 필드 불일치"); rsp[5] = 7U;
    rsp[8] = 6U; check(mb::parseReadResponse(rsp, 13U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "바이트 수 불일치"); rsp[8] = 4U;
    const u8 exc[9] = { 0x12U, 0x34U, 0U, 0U, 0U, 3U, 7U, 0x83U, 2U };
    check(mb::parseReadResponse(exc, 9U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_EXCEPTION && ex == 2U, "예외 응답(주소 없음)");
    const u8 exc2[10] = { 0x12U, 0x34U, 0U, 0U, 0U, 4U, 7U, 0x83U, 2U, 0U };
    check(mb::parseReadResponse(exc2, 10U, 0x1234U, 7U, 3U, 2U, rr, ex) == mb::ST_ERR_FRAME, "길이가 틀린 예외 응답");
    u8 wr[12] = { 0U, 9U, 0U, 0U, 0U, 6U, 3U, 16U, 0U, 10U, 0U, 2U };
    check(mb::parseWriteResponse(wr, 12U, 9U, 3U, 10U, 2U, ex) == mb::ST_OK, "쓰기 응답");
    check(mb::parseWriteResponse(wr, 12U, 9U, 3U, 11U, 2U, ex) == mb::ST_ERR_FRAME && mb::parseWriteResponse(wr, 12U, 9U, 3U, 10U, 3U, ex) == mb::ST_ERR_FRAME, "쓰기 응답 주소·개수 불일치");
    const u8 wex[9] = { 0U, 9U, 0U, 0U, 0U, 3U, 3U, 0x90U, 4U };
    check(mb::parseWriteResponse(wex, 9U, 9U, 3U, 10U, 2U, ex) == mb::ST_ERR_EXCEPTION && ex == 4U, "쓰기 예외 응답");
    wr[5] = 7U; const u8 wlong[13] = { 0U, 9U, 0U, 0U, 0U, 7U, 3U, 16U, 0U, 10U, 0U, 2U, 0U };
    check(mb::parseWriteResponse(wlong, 13U, 9U, 3U, 10U, 2U, ex) == mb::ST_ERR_FRAME, "쓰기 응답 길이 초과");
}

int main(int argc, char* argv[])
{
    const std::string dir = (argc > 1) ? argv[1] : "build/vec";
    testCodecUnits();
    testDecode(dir);
    testEncode(dir);
    testOps(dir);
    std::cout << "확인 " << g_checks << "건, 실패 " << g_fail << "건\n";
    return (g_fail == 0) ? 0 : 1;
}
