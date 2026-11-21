// 이동형 전력체계 EMS 소프트웨어 동적·정적 시험결과 보고서 (입력: test_results.json, static_results.json)
const fs = require("fs"); const L = require("./lib.js"); const { P, H1, H2, NUM, TBL, GAP, CODE } = L;
const D = JSON.parse(fs.readFileSync(__dirname + "/test_results.json", "utf8")), S = JSON.parse(fs.readFileSync(__dirname + "/static_results.json", "utf8"));
const REV = process.argv[2] || "Rev00", DATE = process.argv[3] || "2026. 11. 15.", OUT = process.argv[4] || __dirname + `/out/이동형전력체계EMS_SW시험결과보고서_${REV}.docx`;
const f = (x, d = 2) => x === null || x === undefined ? "실패" : Number(x).toFixed(d);
const mx = a => Math.max(...a.filter(x => x !== null)), avg = a => a.filter(x => x !== null).reduce((s, x) => s + x, 0) / a.filter(x => x !== null).length;
const ok = (c) => c ? { t: "적합", c: "000000" } : { t: "부적합", c: "C00000" };
const b = [];
L.cover(b, "이동형 전력체계 EMS 소프트웨어 시험결과 보고서", "동적 시험(단위·통합·성능·내구) 및 정적 시험(결함·보안·복잡도)",
  [["문서번호", `HAES-IFPS-EMS-TR-001  ${REV} (초안)`], ["작성일", DATE], ["시험 대상", "핵심 프로그램 ifps_ems v0.6.0, 실장치 연동 계층 ifps_ems_rt v0.1.0, 제어화면(HMI)"],
   ["시험 환경", `Python ${D.env.python} · ${D.env.platform} · CPU ${D.env.cpu}코어 · 가상 장치(Modbus TCP 실제 소켓)`], ["관련 문서", "HAES-IFPS-EMS-RT-001 실장치 연동 코드설명서, HAES-IFPS-EMS-SR-001 보안성 검토결과"],
   ["비고", "자동 측정값 기반 초안. 실장비 FAT·HILS 결과로 보완해야 함"]]);

b.push(H1("1. 개요"));
b.push(P("본 보고서는 이동형 전력체계 EMS 소프트웨어의 동적 시험과 정적 시험의 수행 방법과 결과를 기록한다. 모든 수치는 시험 스크립트(tools/measure.py, tools/static_report.py)로 재현할 수 있으며, 측정 원자료는 docs/test_results.json과 docs/static_results.json에 있다."));
b.push(TBL(["구분", "시험", "방법", "도구"], [
  ["동적", "단위·통합 시험", "가상 장치를 로컬 Modbus TCP 서버로 띄우고 실제 소켓 통신으로 기능 확인", "unittest, coverage"],
  ["동적", "요구 성능 시험", "고장 주입(무응답·경로 단절·지령 무시·차단기 트립)과 응답 시간 실측", "tools/measure.py"],
  ["동적", "부하·내구 시험", "웹 API 20 동시 접속 × 100회, 1초 수집 주기 300초 연속 운전", "tools/measure.py"],
  ["정적", "결함 분석", "미사용 이름·정의되지 않은 이름 등", "pyflakes"], ["정적", "보안 약점 분석", "Python 보안 약점 규칙", "bandit"],
  ["정적", "복잡도·유지보수성", "순환 복잡도, 유지보수 지수", "radon"], ["정적", "제어화면 스크립트", "구문 검사, 인라인 이벤트 처리기 검사", "node --check"]], [10, 20, 52, 18], { center: [0] }));
b.push(GAP()); b.push(P("한계: 실장비, 보호 IED 게이트웨이, HILS 연동 시험은 포함하지 않았다. 측정 시각과 장비 사양에 따라 수치는 달라질 수 있으며, 판정은 요구 한도 대비 측정 최댓값으로 했다."));

b.push(H1("2. 결과 요약"));
const sum = [
  ["단위·통합 시험", "전 항목 통과", `${S.n_tests}건 중 ${S.tests_ok ? S.n_tests : "일부"}건 통과`, ok(S.tests_ok)],
  ["코드 실행률(문장 / 분기)", "신뢰성 시험 결과서(RL-001) 기준", `${f(S.stmt.pct, 1)}% / ${f(S.branch.pct, 1)}%`, ok(S.stmt.pct >= 90)],
  ["통신 두절 감지", "3.0초 이내", `최대 ${f(mx(D.comm_lost_s))}초 (${D.comm_lost_s.length}회)`, ok(mx(D.comm_lost_s) <= 3.0)],
  ["무응답 → 대체 전원 지령", "5.0초 이내", `최대 ${f(mx(D.fallback_s))}초, 성공 ${D.fallback_s.filter(x => x !== null).length}/${D.fallback_s.length}`, ok(mx(D.fallback_s) <= 5.0 && D.fallback_s.every(x => x !== null))],
  ["수집 주기", "1초, 주기 초과 0회", `평균 ${f(D.soak.avg_ms)}ms, 최대 ${f(D.soak.max_ms)}ms, 초과 ${D.soak.overruns}회`, ok(D.soak.overruns === 0)],
  ["24시간 예측 오차(부하/PV)", "15% 이하", `${D.forecast_acc.load_nmae}% / ${D.forecast_acc.pv_nmae}%`, ok(D.forecast_acc.load_nmae <= 15 && D.forecast_acc.pv_nmae <= 15)],
  ["예측 구간 포함률", "70% 이상", `${D.forecast_acc.load_cov}% / ${D.forecast_acc.pv_cov}%`, ok(D.forecast_acc.load_cov >= 70 && D.forecast_acc.pv_cov >= 70)],
  ["웹 API 부하", "오류 0, p95 200ms 이하", `${D.http.requests}회, 오류 ${D.http.errors}, p95 ${D.http.p95_ms}ms`, ok(D.http.errors === 0 && D.http.p95_ms <= 200)],
  ["메모리 증가(300초)", "증가 없음", `${D.soak.rss_mb_start} → ${D.soak.rss_mb_end} MB`, ok(D.soak.rss_mb_end - D.soak.rss_mb_start < 5)],
  ["감사 기록 무결성", "검증 통과", D.audit.verify[1], ok(D.audit.verify[0])],
  ["정적 결함(pyflakes)", "0건", `${S.pyflakes.length}건`, ok(S.pyflakes.length === 0)],
  ["보안 약점(bandit)", "중간 이상 0건", `${S.bandit.results.length}건 (사유 기재 예외 ${S.bandit_nosec.length}건)`, ok(S.bandit.results.filter(r => r[1] !== "LOW").length === 0)],
  ["제어화면 스크립트", "구문 오류·인라인 처리기 0", `${S.js.filter(j => j[2]).length}/${S.js.length} 통과, 인라인 ${S.inline_handlers}건`, ok(S.js.every(j => j[2]) && S.inline_handlers === 0)],
];
b.push(TBL(["항목", "요구·기준", "측정", "판정"], sum, [30, 22, 34, 14], { center: [3], bold: [0] }));
b.push(GAP()); b.push(P(`시험 중 결함 ${5}건을 발견해 모두 수정하고 회귀 시험으로 확인했다(6장). 위 표는 수정 후 최종 측정값이다.`));

b.push(H1("3. 동적 시험")); b.push(H2("3.1 단위·통합 시험"));
b.push(P(`총 ${S.n_tests}건, 소요 ${S.unittest_s}초. 가상 장치는 Modbus TCP 서버로 동작하므로 모의 객체가 아니라 실제 프레임이 오간다.`));
b.push(TBL(["시험 항목", "결과"], S.tests.map(t => { const [n, r] = t.split(" | "); return [n.trim(), r === "ok" ? "통과" : r]; }), [80, 20], { mono: [0], center: [1] }));
b.push(H2("3.2 코드 커버리지"));
b.push(P(`문장 실행률 ${f(S.stmt.pct, 1)}%, 분기 실행률 ${f(S.branch.pct, 1)}%(상세와 미실행 사유는 HAES-IFPS-EMS-RL-001). 낮은 모듈은 명령줄 도구·기동 스크립트처럼 시험 대상 밖의 실행 경로가 많은 파일이다.`));
b.push(TBL(["모듈", "문장 수", "커버리지(%)"], S.coverage_files.map(x => [x[0], x[2], f(x[1], 1)]), [64, 18, 18], { mono: [0], center: [1, 2] }));
b.push(H2("3.3 요구 성능 시험(고장 주입)"));
const row = (n, a, lim, how) => [n, a.map(x => f(x)).join(", "), f(avg(a)), f(mx(a)), lim, how];
b.push(TBL(["항목", "측정값(초)", "평균", "최대", "한도", "방법"], [
  row("통신 두절 감지", D.comm_lost_s, "3.0", "장치 무응답 주입 → '두절' 판정"), row("경로 저하 감지", D.path_degraded_s, "—", "경로 A 단절 → '경로 저하'"),
  row("복구·재조회", D.recovery_s, "—", "응답 복귀 → 재조회 → '정상'"), row("SBO 지령 응답", D.sbo_ack_s, "1.5", "실행 → 순번 되돌림·상태 확인"),
  row("대체 전원 지령", D.fallback_s, "5.0", "DG 지령 무시 → 재지령 → FC"), row("차단기 트립 → 경보", D.trip_alarm_s, "—", "보호 IED 트립 모사 → 경보 발생"),
  row("운전계획 연산(96구간)", D.plan_s, "—", "동적계획법 1회")], [20, 26, 9, 9, 8, 28], { center: [2, 3, 4] }));
b.push(GAP()); b.push(P(`예측 정밀도(최근 7일 백테스트 ${D.forecast_acc.n_issue}회): 부하 nMAE ${D.forecast_acc.load_nmae}%, PV ${D.forecast_acc.pv_nmae}%(설비용량 대비), 80% 예측 구간 포함률 ${D.forecast_acc.load_cov}% / ${D.forecast_acc.pv_cov}%. 백테스트 연산 ${f(D.forecast_backtest_s)}초. 합성 현장 자료 기준이며 현장 실측 이력으로 재평가해야 한다.`));
b.push(H2("3.4 부하 시험(웹 API)"));
b.push(TBL(["요청 수", "오류", "처리량(회/초)", "p50(ms)", "p95(ms)", "최대(ms)"], [[D.http.requests, D.http.errors, D.http.rps, D.http.p50_ms, D.http.p95_ms, D.http.max_ms]], [16, 12, 18, 18, 18, 18], { center: [0, 1, 2, 3, 4, 5] }));
b.push(GAP()); b.push(P("20개 클라이언트가 동시에 /api/snapshot을 100회씩 요청했다. 실제 운용은 노트북 1~3대 접속, 1초 주기 조회로 이보다 훨씬 가볍다."));
b.push(H2("3.5 내구 시험(연속 운전)"));
b.push(TBL(["운전 시간(초)", "수집 횟수", "주기 초과", "평균(ms)", "p95(ms)", "최대(ms)", "메모리(MB)"], [[D.soak.seconds, D.soak.scans, D.soak.overruns, D.soak.avg_ms, D.soak.p95_ms, D.soak.max_ms, `${D.soak.rss_mb_start} → ${D.soak.rss_mb_end}`]], [14, 13, 12, 12, 12, 12, 25], { center: [0, 1, 2, 3, 4, 5, 6] }));
b.push(GAP()); b.push(P("전 장치·경로(6대 × 2경로)를 병렬로 읽으므로 1초 주기 대비 사용률은 1% 미만이다. 72시간 내구 시험은 FAT에서 수행한다."));
b.push(H2("3.6 감사 기록 무결성"));
b.push(P(`시험 중 생성된 감사 기록 ${D.audit.seq}건의 연쇄 HMAC 검증 결과: ${D.audit.verify[1]}. 중간 행 변조·삭제 검출은 단위 시험 test_audit_detects_tampering으로 확인했다.`));

b.push(H2("3.7 운전 시나리오 검증"));
{ const SC = JSON.parse(fs.readFileSync(__dirname + "/scenario_results.json", "utf8")), ch = SC.changes[0];
  b.push(P(`화면의 운영 시나리오 검증기(가상 장치 모드 전용)로 기본 시나리오 ${SC.total}건을 돌렸다. 시나리오는 정상 운전(운전 모드 조합 ${SC.mode_total}건: 자동·수동 × 작전지·주둔지 × 평시·저소음·자립, 장비 시퀀스), 고장 대응(FMEA 의 고장 모드에 대응), 보호 협조로 나뉜다. 건마다 독립된 가상 장치와 가상 시각을 써서 시험끼리 상태가 섞이지 않는다.`));
  b.push(TBL(["분류", "건수", "재시험 통과"], Object.entries(SC.cats).map(([k, v]) => [k, v[0], v[1]]), [60, 20, 20], { bold: [0], center: [1, 2] })); b.push(GAP());
  b.push(P("고장 대응 시나리오는 가상 장치에 고장 조건(지령 무응답, 현장 수동, 수소·충전율 부족, 상전 개방 등)을 넣고 EMS 의 판단과 장치 상태를 본다. 각 시나리오에는 근거가 되는 FMEA 번호와, 실장비 연동시험(FAT)에서 확인할 내용(FMEA 의 검증 방법)을 붙였다."));
  b.push(TBL(["고장 대응 시나리오", "FMEA", "결과", "실장비 시험(FAT)에서 확인할 것"], SC.results.map((r, i) => [r, i]).filter(x => /고장 대응/.test(x[0].cat)).map(([r, i]) => [r.name, r.ref, SC.retest[i].ok ? "통과" : { t: "실패", c: "C00000" }, r.fat]), [34, 9, 9, 48], { center: [1, 2] })); b.push(GAP());
  b.push(TBL(["구분", "결과"], [["운전 모드 조합", `${SC.mode_pass} / ${SC.mode_total} 통과`], ["전체(최초 실행)", `${SC.first_pass} / ${SC.total} 통과`], ["대기 시간 조정 후 재시험", `${SC.retest_pass} / ${SC.total} 통과`]], [40, 60], { bold: [0] })); b.push(GAP());
  b.push(TBL(["번호", "시나리오", "단계 수", "최초", "재시험"], SC.results.map((r, i) => [i + 1, r.name, r.steps, r.ok ? "통과" : { t: `실패(단계 ${r.fail_step + 1})`, c: "C00000" }, SC.retest[i].ok ? "통과" : { t: "실패", c: "C00000" }]), [8, 52, 12, 16, 12], { center: [0, 2, 3, 4] })); b.push(GAP());
  b.push(P(ch ? `최초 실행에서 실패한 한 건(${ch.name})은 일부러 넣은 고장 시험이다. 장치의 상태 전환을 늦춘 뒤 지령의 '수용 응답(seq_ack)'과 '운전 완료(status)'를 따로 판정하며, 대기 ${ch.before} ms 에서 실패하고 검증기가 제안한 ${ch.after} ms 로 다시 돌려 통과했다. 이 값은 가상 시험의 대기 시간일 뿐이며 현장의 보호 설정이나 완료 한도(done_s)에 그대로 쓰지 않는다.` : "실패한 시나리오는 없었다."));
  b.push(P("보호 협조 시나리오는 시나리오용 추가 설비(config/scenario_extra.json — 수전 변압기 1대, 계전기 6개: 과전류 4·지락 1·부족전압 1)로 돌린다. 반한시 특성은 IEC 60255 의 표준·강·초 반한시 식을 쓰고, 차단 실패는 차단기가 열리지 않는 상태를 모사해 후비 차단기의 동작을 본다. 계전기 정정값은 시험용 가정값이며 실제 값은 보호 협조 검토서로 정한다."));
  b.push(P("검증 범위: 모의 시험은 화면부의 급전 판단과 가상 장치의 응답을 대상으로 한다. 실장비의 통신·절체 성능은 FAT·SAT 결과가 필요하다. 재현: python -m tools.scenario_report")); }
b.push(H2("3.8 예측 독립 시험"));
{ const FB = JSON.parse(fs.readFileSync(__dirname + "/forecast_benchmark.json", "utf8")), g = (k, h, i) => { const v = FB.runs.map(r => r.targets[k][i ? "enhanced" : "baseline"][h]); return [Math.min(...v.map(x => x.nmae_pct)), Math.max(...v.map(x => x.nmae_pct)), Math.min(...v.map(x => x.coverage_pct)), Math.max(...v.map(x => x.coverage_pct))]; }, r2 = (a, i) => `${a[i].toFixed(2)} ~ ${a[i + 1].toFixed(2)}`;
  b.push(P(`합성 자료 ${FB.runs.length}세트(세트마다 학습 ${FB.fit_days}일, 가중치 선택 ${FB.tune_days}일, 시험 ${FB.test_days}일)로 단기 실측 앙상블 적용 전후를 비교했다. 합성 하늘 카메라 열은 미래 정보를 담고 있어 이 시험에서는 뺐다. 예측 구간은 운용과 같이 하루에 한 번 다시 보정했다.`));
  b.push(TBL(["대상", "15분 NMAE(%) 적용 전", "적용 후", "24시간 NMAE(%) 적용 전", "적용 후", "24시간 포함률(%)"], [["부하", r2(g("load", "15m", 0), 0), r2(g("load", "15m", 1), 0), r2(g("load", "24h", 0), 0), r2(g("load", "24h", 1), 0), r2(g("load", "24h", 1), 2)], ["태양광", r2(g("pv", "15m", 0), 0), r2(g("pv", "15m", 1), 0), r2(g("pv", "24h", 0), 0), r2(g("pv", "24h", 1), 0), r2(g("pv", "24h", 1), 2)]], [12, 19, 16, 20, 16, 17], { bold: [0], center: [1, 2, 3, 4, 5] })); b.push(GAP());
  b.push(P("값은 세트별 최소 ~ 최대다. 세부 수치와 해석은 AI 예측 논문 5.4절에 있다. 재현: python -m tools.forecast_benchmark --out docs/forecast_benchmark.json")); }

b.push(H2("3.9 기록 보관 · 보고서 출력"));
b.push(P("운전 기록 보관소(archive.db, SQLite)와 조회 API, Word 보고서, 별도 기록 조회기를 tests/test_archive.py 로 확인했다. ESS 안전 운영정보(1분)와 장치별 자료, 주둔지 서버 전달도 여기에 든다."));
b.push(TBL(["확인 항목", "방법", "결과"], [["전력량 적산·누적 검침값", "60 kW 부하를 30분 동안 1초마다 넣고 15분 구간 2줄, 구간 15 kWh, 누적 30 kWh 확인", "통과"], ["재기동 뒤 누적값 이어 쓰기", "보관소를 닫았다 열어 누적 지침이 이어지는지 확인", "통과"],
  ["시간·일·월·년 묶음", "400일치 15분 자료(38,400줄)를 넣고 일 31줄, 월 6줄, 연도 2줄 확인", "통과"], ["보관 기간·용량 한도", "보관 1년 설정에서 500일 전 자료와 점검 기록이 지워지고, 한도를 넘기면 오래된 달부터 줄어드는지 확인", "통과"],
  ["상황 기록 옮겨 적기·찾기", "같은 사건을 두 번 넘겨도 한 번만 적고, 글자·종류로 찾는지 확인", "통과"], ["설정 범위 검사", "주기 7분·보관 6년·한도 1 MB·문자열 참값을 거부", "통과"],
  ["장치별 자료", "30분 동안 디젤 출력을 넣고(한 번 40 kW) 15분 줄의 평균 · 최소 30 · 최대 40, 지령 신호 제외 확인", "통과"], ["ESS 안전 운영정보 1분 기록", "30분에 30줄, 신호가 없는 항목은 0, 기록률 100% 확인", "통과"],
  ["전달 묶음과 이력", "묶음의 파일별 SHA-256 검사, 수신기로 올려 '전달 완료', 죽은 주소는 '전송 실패', 수동 완료 기록, 보관 기간 정리 뒤에도 이력 유지", "통과"], ["수신기의 거부", "잘못된 파일 이름 · SHA-256 불일치 · 압축 파일이 아닌 본문을 400 으로 거부하고 저장하지 않음", "통과"],
  ["Word 문서 형식", "만든 파일의 압축 구조와 XML 문법, 특수문자 처리 확인", "통과"], ["기록 조회기(읽기 전용)", "쓰기 요청 403, 다른 파일 404, 보고서에 검침 누적값·점검 기록 절이 있는지 확인", "통과"]], [26, 58, 16], { center: [2] })); b.push(GAP());
b.push(P("범위: 가상 장치 모드의 첫 기동 때 넣는 과거 자료 400일치는 합성값이며 화면과 보고서에 * 로 표시한다. 누적 지침은 EMS 가 계측값을 적산한 값으로, 정산용 계량기와의 오차는 실장비에서 대조해야 한다. 저장 주기를 정한 법령 조항은 확인하지 못했고, 점검 결과 기록 보존 기간(4년)만 전기안전관리법 시행규칙에 근거한다. ESS 안전 운영정보의 1분 주기는 전기안전공사 통합관리시스템의 전송 주기에 맞춘 것이며, 항목 구성은 공개된 분류에 맞춘 초안이다(공사의 정식 연계 명세 미확보). 현재 대응표로 수집되는 항목은 29개 중 7개이고 나머지는 배터리 관리 장치 · PCS 신호가 대응표에 들어와야 채워진다."));

b.push(H2("3.10 시퀀스 문서(PPT) · 수집 항목 관리 · 조치 안내"));
b.push(TBL(["확인 항목", "방법", "결과"], [["PPT 쓰기 · 읽기", "글상자 · 선 · 표가 든 파일을 만들어 압축 구조와 XML 문법을 검사하고 다시 읽어 글과 표가 같은지 확인. 압축 파일이 아니거나 8 MB 를 넘으면 거부", "통과"],
  ["시퀀스 문서 왕복", "기본 시나리오 전부를 PPT 로 냈다가 다시 읽어 단계가 원래와 같은지 확인", "통과"], ["고친 문서 반영 · 거부", "표를 고친 안은 반영되고 '의견' 칸이 설명에 붙는지, 대응표에 없는 신호 · 범위 밖 시간 · 모르는 종류는 그 시나리오만 빼고 이유를 돌려주는지 확인", "통과"],
  ["누적 시간 계산", "대기 100 ms + 판정 한도 500 · 600 ms 가 1,200 ms 로 더해지는지 확인(검증 결과가 있으면 관측값을 쓴다)", "통과"],
  ["수집 주기 · 제외 신호", "장치별 1분 · ESS 5분으로 바꾸면 줄 수가 그에 맞고, 뺀 신호는 쌓이지 않는지 확인", "통과"], ["수집 항목 검사", "겹치는 이름표, 형식이 틀린 이름표, 빈 항목 이름, 대응표에 없는 신호, 범위 밖 주기 · 보관 기간, 120개 초과를 거부", "통과"]], [26, 58, 16], { center: [2] })); b.push(GAP());
b.push(P("화면에서의 동작(시퀀스 문서 내보내기 → 그대로 올리면 모두 '같음', 수집 항목 저장 뒤 바로 적용, 차단기 트립 경보의 조치 안내 창)은 브라우저 자동 조작으로 확인했다. 조치 안내의 내용(26종)은 일반 점검 절차를 글로 적은 것으로 시험 대상이 아니며, 제작사 정비 교범과 대조해 보완해야 한다. 교육 창과 교육용 가상 화면 묶음은 실제 화면 파일을 그대로 쓴다. 묶음의 값은 가상 장치에서 녹화한 장면이다(새로 계산하지 않음)."));

b.push(H1("4. 정적 시험")); b.push(H2("4.1 결함·보안 약점"));
b.push(TBL(["도구", "결과", "비고"], [["pyflakes", `${S.pyflakes.length}건`, S.pyflakes.length ? S.pyflakes.join("; ") : "미사용 import 5건 수정 후 0건"],
  ["bandit", `${S.bandit.results.length}건`, `코드 ${S.bandit.totals.loc}행 검사. 사유를 기재한 예외(nosec) ${S.bandit_nosec.length}건: ` + S.bandit_nosec.map(r => `${r[0]} ${r[2]}:${r[3]}`).join(", ")],
  ["node --check", `${S.js.filter(j => j[2]).length}/${S.js.length} 통과`, `제어화면 스크립트 ${S.js.reduce((a, j) => a + j[1], 0)}행, 인라인 이벤트 처리기 ${S.inline_handlers}건`]], [18, 16, 66], { bold: [0] }));
b.push(H2("4.2 복잡도·유지보수성"));
b.push(P(`함수·메서드 ${S.cc_n}개의 평균 순환 복잡도 ${S.cc_avg}. 등급 분포: ` + Object.entries(S.cc_rank).map(([k, v]) => `${k} ${v}`).join(", ") + `. Python 코드 ${S.loc_py.files}개 파일 ${S.loc_py.sloc}행(주석 ${S.loc_py.comments}행).`));
b.push(TBL(["파일", "함수", "복잡도", "등급"], S.cc_top.map(x => [x[0], x[1], x[2], x[3]]), [44, 34, 11, 11], { mono: [0, 1], center: [2, 3] }));
b.push(GAP()); b.push(TBL(["파일", "유지보수 지수", "등급"], S.mi.slice(0, 6).map(x => [x[0], x[1], x[2]]), [60, 22, 18], { mono: [0], center: [1, 2] }));
b.push(GAP()); b.push(P("권고: 제어화면 엔진(engine.py)은 경보·지령·배치·가상 장치 기능이 한 파일에 모여 유지보수 지수가 낮다. 운용 전 기능별 모듈로 분리하고, 복잡도 D 등급 함수(가상 장치 동작, 상태 요약, 경보 판정)를 나누는 것을 권한다."));

b.push(H1("5. 시험 환경과 재현 방법"));
["pip install -r requirements.txt coverage bandit pyflakes radon", "python -m unittest discover -s tests", "python tools/measure.py docs/test_results.json --soak 300", "python tools/static_report.py", "node docs/build_test_report.js"].forEach(t => b.push(CODE(t)));

b.push(H1("6. 시험 중 발견 결함과 조치"));
b.push(TBL(["번호", "결함", "원인", "조치", "확인"], [
  ["D-01", "통신 두절 감지 2.5~3.5초(한도 3.0초 초과 3/5회)", "두절 판정을 1초 수집 주기에서만 수행", "0.5초 통신 감시 주기 분리(설계값 2.0+0.5초)", `수정 후 최대 ${f(mx(D.comm_lost_s))}초`],
  ["D-02", "무응답 지령이 장치 회복 후 뒤늦게 실행(디젤 의도치 않은 기동)", "실패한 지령의 cmd 레지스터를 남겨 둠", "최종 실패 시 cmd=0 취소 쓰기, 결과 기록", "회귀 시험 추가(수정 전 실패 확인)"],
  ["D-03", "동시 접속 시 일부 응답 1.5~2.3초 지연", "웹 서버 접속 대기열 5", "대기열 64", `최대 ${D.http.max_ms}ms`],
  ["D-04", "로그인·로그아웃·대화상자 버튼, 배치도 마커 미동작", "CSP(script-src 'self')가 인라인 onclick 차단", "이벤트 위임(data-act)으로 전환", "브라우저 자동 시험"],
  ["D-05", "미사용 import 등 정적 결함 5건", "정리 누락", "제거", "pyflakes 0건"],
  ["D-06", "Rev16 독립 검토에서 찾은 결함 42건(통신·제어·서버 22, 화면 20)", "신뢰성 시험 결과서 7장", "전 건 조치", "재발 방지 시험 18건 외"]], [9, 27, 22, 24, 18], { center: [0] }));

b.push(H1("7. 한계와 후속 시험"));
["실장비 FAT: 제작사 레지스터 주소·지령 규약·응답 시간 확인", "보호 IED 게이트웨이 연동: 차단기 상태·보호요소 코드 주소 검증", "HILS: 고장 시나리오별 EMS 판단과 보호 협조 검증", "72시간 내구 시험과 전원 차단·재기동 시험(상태 파일 원자적 저장 확인)", "현장 실측 이력 8일 이상 확보 후 예측 모델 재학습·재평가", "다중 단말 동시 운용(운용자·엔지니어 동시 접속) 시험"].forEach(t => b.push(NUM(t)));
fs.mkdirSync(require("path").dirname(OUT), { recursive: true });
L.save(b, OUT, "이동형 전력체계 EMS SW 시험결과 보고서");
