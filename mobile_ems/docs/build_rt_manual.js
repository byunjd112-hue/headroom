// 이동형 전력체계 EMS 실장치 연동 코드설명서
const fs = require("fs"); const L = require("./lib.js"); const { P, H1, H2, CODE, NUM, KV, TBL, GAP } = L;
const J = JSON.parse(fs.readFileSync(__dirname + "/rt.json", "utf8")); const M = J.meas;
const REV = process.argv[2] || "Rev00", MMDD = process.argv[3] || "1114", DATE = process.argv[4] || "2026. 11. 14.";
const OUT = `/home/claude/out_ems/이동형전력체계EMS_실장치연동_코드설명서_${REV}_${MMDD}.docx`;
const b = []; const f = (x, d = 1) => Number(x).toFixed(d);
L.cover(b, "이동형 전력체계 EMS 실장치 연동 코드설명서", `실장치 연동 계층 v0.1.0 (소스 ${J.loc}행, 시험 ${J.tests.length}건) · 핵심 프로그램 v${J.core.version}`,
  [["문서번호", `HAES-IFPS-EMS-RT-001  ${REV}`], ["작성일", DATE], ["상위 문서", "HAES-IFPS-EMS-TD-001 이동형 전력체계 EMS 상세기술자료"], ["관련 문서", "HAES-IFPS-EMS-CM-001 코드설명서, HAES-IFPS-EMS-LG-001 예측·계산 로직 설명서"], ["작성", "한화에어로스페이스㈜ 에너지솔루션사업센터"]]);

b.push(H1("1. 개요")); b.push(H2("1.1 목적과 범위"));
b.push(P("본 문서는 이동형 전력체계 EMS를 실제 장치에 붙여 운전하기 위한 연동 계층의 소스 구성, 설정, 통신 규약, 처리 순서, 시험 방법을 설명한다. 예측·운전계획·감시 논리는 핵심 프로그램(ifps_ems)에 있고, 본 계층은 그 논리에 실제 통신을 잇는다."));
b.push(P("대상 장치는 전원 제어기(디젤, 연료전지, ESS PCS), 계측기, 쉘터 환경 센서다. 보호 IED는 게이트웨이를 거쳐 상태만 읽는다. 보호 차단, 무순단 절체, 우회 복구는 IED와 절체기가 수행하며 본 계층은 지령하지 않는다."));
b.push(H2("1.2 핵심 프로그램과의 경계"));
b.push(TBL(["구분", "핵심 프로그램 ifps_ems", "실장치 연동 계층 ifps_ems_rt"], [
  ["하는 일", "예측, 운전계획, 품질 검증, 지령 판단, 통신 감시 판정, 자가진단, 감사 기록", "장치 읽기·쓰기, 주기 실행, 응답 확인, 이력 저장"],
  ["통신 모듈", "쓰지 않음(단위 시험으로 확인)", "socket(Modbus TCP)만 사용"],
  ["접속 대상", "해당없음", "폐쇄망 허용 목록 안의 사설 주소"],
  ["의존성", "표준 라이브러리, numpy", "표준 라이브러리, 핵심 프로그램"],
  ["검증", "합성 자료, 논리 모형, 가상 장치", "가상 장치와 실제 통신(로컬)"]], [16, 42, 42], { bold: [0] }));
b.push(GAP()); b.push(P("통신 기능을 핵심 프로그램 밖에 둔 것은 보안 검토 범위를 좁히기 위해서다. 외부로 나갈 수 있는 코드는 modbus.py 한 파일이며, 이 파일은 사설·루프백 주소가 아니면 허용 목록에 있어도 접속을 거부한다."));
b.push(H2("1.3 설계 원칙"));
[["판단과 통신의 분리", "지령을 내도 되는지는 핵심 프로그램의 검사를 그대로 쓰고, 전송과 응답 확인만 실제 통신으로 바꿨다."], ["장치 중립", "제작사마다 다른 레지스터 주소는 대응표에서 맞춘다. 소스는 고치지 않는다."],
 ["실패해도 운전 지속", "통신 실패는 직전 유효값 유지와 지령 중지로, 계획 실패는 규칙 운전으로 넘긴다."], ["기록", "지령과 통신 사건은 연쇄 해시 감사 기록에 남긴다."]].forEach(r => b.push(KV(r[0], r[1])));

b.push(H1("2. 구성")); b.push(H2("2.1 파일"));
const FN = { modbus: "Modbus TCP 클라이언트, 허용 목록 검사, 자료형 변환", pointmap: "자료 대응표 읽기·검증, 연속 주소 묶음", hal: "장치 접속(경로 2개), 실장치 지령", runtime: "주기 실행기", planlink: "예측·운전계획 연결", simplant: "가상 장치(시험용 서버)" };
b.push(TBL(["파일", "행 수", "기능"], J.mods.map(m => [`ifps_ems_rt/${m.name}.py`, m.lines, FN[m.name]]).concat([["config/runtime.json", "", "실행 설정 예"], ["config/pointmap.csv", J.pm.length - 1, "표준 대응표(점 수)"], ["service/ifps-ems.service", "", "자동 기동 등록 예"], ["tests/test_rt.py", "", `시험 ${J.tests.length}건`]]), [34, 10, 56], { center: [1], mono: [0] }));
b.push(H2("2.2 계층"));
b.push(TBL(["계층", "모듈", "입력", "출력"], [["실행", "runtime.Runtime", "설정, 시각", "주기 실행, 사건 기록, 이력"], ["정책", "planlink.PlanPolicy 또는 규칙", "현재 값, 이력, 모델", "디젤·연료전지·수전해 기동 여부"],
  ["지령", "hal.RtCommander", "장치, 지령", "성공 여부, 소요 시간, 지령 기록"], ["접속", "hal.DeviceLink", "대응표, 경로 2개", "공학값 사전, 경로별 생존"], ["통신", "modbus.Client", "주소, 레지스터", "16비트 값"]], [12, 30, 28, 30], { bold: [0], mono: [1] }));

b.push(H1("3. 설치와 실행")); b.push(H2("3.1 요구 환경"));
b.push(P("Python 3.10 이상과 numpy가 있으면 된다. 핵심 프로그램 폴더와 본 계층 폴더를 PYTHONPATH에 넣는다. 추가 패키지는 없다."));
b.push(H2("3.2 명령"));
["export PYTHONPATH=/opt/ifps_ems:/opt/ifps_ems_rt", "python -m unittest discover -s tests", "python -m ifps_ems_rt config/runtime.json --check", "python -m ifps_ems_rt config/runtime.json"].forEach(t => b.push(CODE(t)));
b.push(GAP()); b.push(TBL(["명령", "동작"], [["unittest", "가상 장치를 로컬에 띄워 실제 통신으로 시험"], ["--check", "대응표 검증, 전 장치 1회 수집, 통신·품질 이상 출력"], ["인자 없음", "주기 운전. 종료 신호를 받으면 마지막 상태를 저장"], ["--scans N", "N주기만 실행(시운전용)"]], [24, 76], { mono: [0] }));
b.push(H2("3.3 설정 파일 runtime.json"));
b.push(TBL(["키", "예", "뜻"], [["allow", JSON.stringify(J.cfg.allow), "접속 허용 대역. 사설·루프백 주소만 유효"], ["scan_s", J.cfg.scan_s, "수집 주기(초)"], ["ctrl_s", J.cfg.ctrl_s, "제어 주기(초)"], ["timeout_s", J.cfg.timeout_s, "통신 응답 대기(초)"],
  ["mode", J.cfg.mode, "운전 방식 grid, direct, island"], ["run_mode", J.cfg.run_mode, "개발 또는 운용. 운용은 검증필 암호모듈이 없으면 기동 거부"], ["g1_kw", J.cfg.g1_kw, "복합전력 계통 형성 용량(예비력 계산)"],
  ["pointmap", J.cfg.pointmap, "대응표 파일"], ["state_dir", J.cfg.state_dir, "상태·이력·감사 기록 폴더"], ["devices", "이름: {paths, unit}", "장치별 통신 경로 A·B의 주소·포트와 장치 번호"], ["site", "{pv_kwp: 400, ...}", "설비 정격(핵심 프로그램 config.Site와 같은 이름)"]], [16, 34, 50], { mono: [0, 1] }));

b.push(H1("4. 자료 대응표")); b.push(H2("4.1 열 구성"));
b.push(TBL(["열", "뜻"], [["tag", "EMS 내부 이름. 장치.항목 형식"], ["device", "runtime.json의 devices에 정의한 장치 이름"], ["fc", "읽기 기능 코드. 3 보유 레지스터, 4 입력 레지스터"], ["addr", "레지스터 주소(0부터)"], ["type", "u16, i16, u32, i32, f32. 32비트는 상위 워드가 앞"],
  ["scale", "레지스터 값에 곱해 공학값을 만드는 배율"], ["unit", "단위. kW, kWh, %, V, A, Hz, Nm3, L, degC"], ["lo, hi", "물리 범위. 벗어난 값은 버리고 직전 유효값 유지"], ["rw", "r 읽기, w 지령 쓰기"]], [16, 84], { mono: [0] }));
b.push(H2("4.2 검증 항목"));
["이름 중복", "같은 장치·기능 코드에서 주소 겹침(32비트 점의 둘째 워드 포함)", "자료형, 기능 코드, 읽기·쓰기 구분, 단위 오류", "배율 0, 범위 하한이 상한 이상", "정의되지 않은 장치", "전력 채널(.kw) 단위가 kW가 아닌 경우(kW·W 혼동 방지)"].forEach(t => b.push(NUM(t)));
b.push(P("오류가 하나라도 있으면 실행기는 기동하지 않는다. 전개지에서 대응표를 고친 뒤에는 --check로 먼저 확인한다."));
b.push(H2("4.3 표준 대응표"));
b.push(TBL(J.pm[0], J.pm.slice(1), [16, 9, 5, 7, 7, 8, 8, 8, 8, 5], { mono: [0], center: [1, 2, 3, 4, 5, 6, 7, 8, 9] }));
b.push(GAP()); b.push(P("위 주소는 가상 장치 기준이다. 실장치는 제작사 통신 사양서의 주소·자료형·배율로 바꾼다. 이름(tag)은 그대로 둔다."));

b.push(H1("5. 통신과 지령 규약")); b.push(H2("5.1 Modbus TCP"));
b.push(TBL(["기능 코드", "용도", "함수"], [["03", "보유 레지스터 읽기", "Client.read(addr, n, 3)"], ["04", "입력 레지스터 읽기", "Client.read(addr, n, 4)"], ["05", "코일 쓰기", "Client.write_coil(addr, on)"], ["06", "레지스터 1개 쓰기", "Client.write(addr, [v])"], ["16", "레지스터 여러 개 쓰기", "Client.write(addr, [v1, v2])"]], [16, 40, 44], { center: [0], mono: [2] }));
b.push(GAP()); b.push(P("응답의 거래 번호와 장치 번호가 요청과 다르거나, 길이가 맞지 않거나, 장치가 예외 응답을 보내면 ModbusError를 낸다. 오류가 나면 연결을 닫고 다음 호출 때 다시 연다. 한 장치의 읽기 점은 연속 주소끼리 묶어 한 번에 읽는다."));
b.push(H2("5.2 지령 규약"));
b.push(TBL(["이름", "방향", "값"], [["장치.status", "장치 → EMS", "0 정지·개방, 1 운전·투입"], ["장치.mode", "장치 → EMS", "0 자동(지령 수용), 1 수동(현장 조작)"], ["장치.cmd", "EMS → 장치", "0 없음, 1 기동·투입, 2 정지·개방"], ["장치.seq", "EMS → 장치", "지령 순번"], ["장치.seq_ack", "장치 → EMS", "장치가 마지막으로 수용한 순번"], ["장치.hb", "장치 → EMS", "생존 계수(주기 증가)"]], [22, 20, 58], { mono: [0] }));
b.push(H2("5.3 지령 한 건의 처리 순서"));
["장치 상태를 새로 읽는다(운전 여부, 수동 모드, 마지막 수용 순번).", "지령 전 검사를 한다. 통신 두절, 수동 모드, 작업 잠금, 이미 운전 중인 장치에 기동, 정지 중인 장치에 정지는 보내지 않는다.", "순번을 올려 seq와 cmd를 쓴다.",
 `장치가 seq_ack에 같은 순번을 되돌려 쓰고 status가 바뀔 때까지 기다린다. 한도는 ${J.core.sup.ack_s}초다.`, `한도 안에 확인되지 않으면 ${J.core.sup.retry}회 다시 지령한다.`, "그래도 실패하면 대체 전원(디젤과 연료전지는 서로 대체)에 같은 지령을 내고 경보한다.", "모든 단계를 지령 기록과 감사 기록에 남긴다."].forEach(t => b.push(NUM(t)));
b.push(P("장치가 순번을 되돌려 쓰지 않는 제작사 장비는 seq_ack 점을 대응표에서 status와 같은 주소로 둘 수 없다. 이 경우 게이트웨이에서 순번 되돌림을 구현하거나 hal.RtCommander의 응답 확인 조건을 상태 변화만으로 바꾼다."));

b.push(H1("6. 실행기 처리 순서")); b.push(H2("6.1 한 주기"));
["수집: 장치마다 경로 A로 읽고 실패하면 B로 읽는다. 두 경로를 모두 확인해 경로별 생존을 기록한다.", "통신 감시: 두 경로 모두 응답이 없으면 두절, 한 경로만 살아 있으면 경로 저하로 판정한다. 두절 장치에는 지령하지 않는다.", "복구 처리: 두절에서 돌아온 장치는 전 상태를 다시 읽어 달라진 값을 반영한 뒤 제어를 재개한다.",
 "품질 확인: 대응표 범위를 벗어난 값은 표식하고 직전 유효값을 유지한다. 갱신이 한도보다 늦은 값도 표식한다.", "제어: 제어 주기가 되면 전원 투입을 정하고 현재 상태와 다른 장치에만 지령한다.", "기록: 15분 평균을 history.csv에 쌓는다. 이 파일은 핵심 프로그램의 학습·예측 입력 형식과 같다."].forEach(t => b.push(NUM(t)));
b.push(H2("6.2 전원 투입 결정"));
b.push(P("policy가 연결돼 있으면 예측 기반 계획을, 없으면 충전율 문턱값 규칙을 쓴다. 자립 운전에서는 그 결과에 N-1 순동 예비력 규칙을 더한다. 병렬 중인 전원에서 가장 큰 1대를 뺀 용량이 현재 1·2등급 부하보다 작으면 연료전지를 기동한다."));
b.push(H2("6.3 예측·운전계획 연결"));
["history.csv가 8일(768행) 이상 쌓였는지 확인한다.", "부하와 PV의 24시간 예측을 낸다.", "부하는 예측 구간 상한 쪽, PV는 하한 쪽으로 보수 계수만큼 옮긴다. 전개 첫 7일은 계수 1.0, 이후 0.5다.", "동적계획법으로 96구간 가치함수를 계산한다.", "현재 실측 상태(충전율, 수소 잔량, 디젤 운전 여부)에서 다음 구간 가치함수로 결정을 고른다.", "15분 자료가 4개 더 쌓이면 다시 계획한다.", "어느 단계든 실패하면 규칙 운전으로 넘어가고 사유를 남긴다."].forEach(t => b.push(NUM(t)));
["from ifps_ems_rt.runtime import Runtime", "from ifps_ems_rt.planlink import PlanPolicy", "rt = Runtime('config/runtime.json')", "rt.policy = PlanPolicy(rt.site, 'config/state/history.csv', 'models', days_since_deploy=3)", "rt.run()"].forEach(t => b.push(CODE(t)));
b.push(H2("6.4 저장 파일"));
b.push(TBL(["파일", "내용"], [["state/last.json", "마지막 값, 통신 상태, 전원 운전 상태. 임시 파일에 쓰고 바꿔치기해 전원이 끊겨도 앞 파일이 남는다"], ["state/history.csv", "15분 평균 이력. 학습·예측 입력"], ["state/audit.log", "지령·통신·주기 사건. 줄마다 앞 줄의 해시를 포함"]], [28, 72], { mono: [0] }));

b.push(H1("7. 모듈별 설명"));
J.mods.forEach((m, i) => { b.push(H2(`7.${i + 1} ${m.name}.py`)); b.push(P(m.doc + ".")); b.push(TBL(["이름", "인자", "설명"], m.items.map(it => [it.name, it.args || "없음", it.desc]), [30, 26, 44], { mono: [0, 1] })); b.push(GAP()); });

b.push(H1("8. 시험")); b.push(H2("8.1 방법"));
b.push(P("시험은 가상 장치(simplant.Plant)를 로컬 주소에 Modbus TCP 서버로 띄우고 실행기를 실제 소켓으로 접속시켜 수행한다. 모의 객체가 아니라 통신 프레임이 오가므로 프레임 조립, 시간 초과, 재접속, 경로 절체가 함께 확인된다."));
const TD = { test_roundtrip_and_types: "레지스터 쓰기·읽기, i16·f32 변환", test_allowlist_rejects_outside_addresses: "공인 주소, 이름, 목록 밖 사설 주소 접속 거부", test_pointmap_validation: "표준 대응표 무오류, 중복·단위·자료형 오류 검출",
  test_scan_reads_values_within_period: "한 주기 수집 값과 소요 시간", test_range_check_keeps_last_good_value: "범위 밖 값 표식과 직전 유효값 유지", test_command_ack: "지령 응답 확인, 중복 지령 차단", test_no_ack_falls_back_to_alternate_source: "무응답 시 재지령 뒤 대체 전원 기동",
  test_manual_mode_blocks_command: "수동 모드 장치 지령 차단", test_one_path_down_keeps_control_both_down_blocks: "한 경로 단절 시 제어 유지, 두 경로 단절 시 두절 판정과 지령 중지, 복구 뒤 재조회", test_reserve_rule_starts_fuel_cell: "예비력 규칙에 따른 연료전지 기동",
  test_run_loop_and_audit: "주기 실행, 주기 초과 0회, 상태 저장, 감사 기록 검증", test_unverified_crypto_refused_in_operation_mode: "운용 모드에서 미검증 암호 모듈 기동 거부", test_plan_policy_decides_from_history_and_falls_back: "이력과 모델로 계획 결정, 이력 부족 시 규칙 운전" };
b.push(TBL(["분류", "시험", "확인 내용"], J.tests.map(t => [t[0].replace("Test", ""), t[1], TD[t[1]] || ""]), [12, 44, 44], { mono: [1] }));
b.push(H2("8.2 측정값"));
b.push(TBL(["항목", "측정값", "한도", "조건"], [["한 주기 수집 시간(평균, 최대)", `${f(M.scan_ms_mean, 1)}ms, ${f(M.scan_ms_max, 1)}ms`, "1,000ms", `장치 ${M.devices}대, 점 ${M.points}개, 로컬`], ["지령 응답 확인", `${f(M.ack_s, 2)}초`, `${J.core.sup.ack_s}초`, "가상 장치 응답 지연 0.2초"],
  ["무응답 시 대체 전원 기동", `${f(M.fallback_s, 2)}초`, "5초", "재지령 1회 포함"], ["두 경로 단절 감지", `${f(M.link_detect_s, 2)}초`, "3초", "수집 간격 0.1초"]], [34, 22, 14, 30], { center: [1, 2] }));
b.push(GAP()); b.push(P("측정값은 같은 장비 안의 로컬 통신 기준이다. 실제 통신망과 장치의 응답 시간은 포함되지 않았으므로 FAT에서 다시 잰다."));

b.push(H1("9. 실장치 적용 절차"));
["제작사 통신 사양서에서 장치별 주소, 장치 번호, 레지스터 주소, 자료형, 배율을 받아 대응표를 작성한다.", "runtime.json의 devices에 통신 경로 A·B의 주소를 넣고 allow에 EMS 통신망 대역만 넣는다.", "--check로 대응표 검증과 전 장치 수집을 확인한다. 값이 물리 범위 밖이면 배율·자료형부터 본다.",
 "장치를 수동 모드로 둔 채 수집만 24시간 돌려 history.csv와 품질 표식을 확인한다.", "장치 1대씩 자동 모드로 바꿔 기동·정지 지령과 응답 확인 시간을 잰다.", "통신 케이블을 한 경로씩 뽑아 경로 저하·두절·복구 판정을 확인한다.", "8일 뒤 예측·운전계획을 연결하고 규칙 운전과 견준다.",
 "자동 기동 등록(service/ifps-ems.service)을 적용한다. 기동 전 무결성 검증을 수행하고, 통신 대역을 운영체제에서도 제한한다."].forEach(t => b.push(NUM(t)));

b.push(H1("10. 보안"));
[["접속 제한", "허용 목록에 있는 사설·루프백 주소로만 접속한다. 이름 풀이는 하지 않는다. 자동 기동 등록 예에서 운영체제 수준의 주소 제한을 함께 건다."], ["받는 통신 없음", "실행기는 접속을 받는 포트를 열지 않는다. 가상 장치(simplant)만 포트를 열며 운용 장비에는 넣지 않는다."],
 ["암호 모듈", "운용 모드에서는 검증필 암호모듈이 아니면 기동하지 않는다. 개발용 키는 반입 전에 제거한다."], ["자료", "실측 자료와 이력은 폐쇄망 안에만 둔다. 본 소스는 합성 값과 공개 수준 사양으로 작성했다."], ["Modbus의 한계", "Modbus TCP는 인증과 암호화가 없다. 물리적으로 분리된 EMS 전용 통신망과 광 케이블 인입을 전제로 한다."]].forEach(r => b.push(KV(r[0], r[1])));

b.push(H1("11. 한계와 후속 작업"));
["가상 장치로만 시험했다. 실장치 응답 시간과 레지스터 사양은 FAT에서 확인한다.", "보호 IED는 게이트웨이를 거친 상태 읽기만 전제했다. IEC 61850 직접 연동은 넣지 않았다.", "주·예비 서버 사이의 상호 감시 통신과 상태 동기는 이 판에 없다. 판정 논리만 핵심 프로그램에 있다.",
 "수전해 지령과 연료전지 출력 지령(kw_set)은 대응표에 자리만 두었다.", "차단기 상태를 읽어 계통 상태로 바꾸는 부분과 화면은 이 판에 없다.", "운영체제 수준의 실시간성(주기 지터)은 측정하지 않았다."].forEach(t => b.push(NUM(t)));
L.save(b, OUT, "이동형 전력체계 EMS 실장치 연동 코드설명서");
