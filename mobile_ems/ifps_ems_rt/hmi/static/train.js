"use strict";
/* 교육 창: 실제 EMS 화면 위에 단원 · 과제 · 확인 문제를 얹는다. 과제는 화면의 실제 상태(운용 장소·태세·경보·열어 본 화면)를 보고 스스로 ✔ 한다.
   ① 교육용 가상 화면 묶음(녹화한 값) ② 실제 EMS 의 가상 장치 모드 — 두 곳에서 같은 창을 쓴다. 실장비 모드에서는 열리지 않는다. */
const TRAIN = {
  on: false, cur: 0, seen: new Set(), did: new Set(), ans: {}, who: { name: "", unit: "" }, KEY: "ems.train.v1",
  L: [
    { t: "1. 화면 둘러보기", d: "왼쪽 차림표로 화면을 옮겨 다닌다. 개요는 전체 수급, 결선도는 전기가 흐르는 길, 발전·예측은 앞으로의 태양광과 부하를 보여 준다. 위쪽 줄에는 운용 장소·태세, 자동 제어, 통신 상태가 있다.",
      k: [["개요 화면 열기", c => c.seen.has("overview")], ["결선도 열기", c => c.seen.has("sld")], ["발전·예측 열기", c => c.seen.has("energy")], ["추세 열기", c => c.seen.has("trends")]],
      q: [["ESS 충전율(SOC)은 무엇을 뜻하는가?", ["발전기 회전 속도", "배터리에 전기가 얼마나 차 있는지(%)", "태양광 출력"], 1, "충전율은 배터리가 찬 정도다. 낮으면 발전기가 필요해진다."], ["결선도에서 볼 수 있는 것은?", ["전기가 흐르는 길과 차단기 상태", "장병 근무표", "연료 단가"], 0, "모선·차단기·장치가 어떻게 이어졌는지 본다."]] },
    { t: "2. 로그인과 권한", d: "보기만 할 때는 로그인이 필요 없다. 지령·경보 확인·태세 변경은 운용자, 설정과 고장 주입은 엔지니어 권한이 필요하다. 오른쪽 위 [로그인]을 누른다.",
      k: [["로그인하기(운용자 이상)", c => c.role !== "viewer"]],
      q: [["장치에 기동 지령을 내려면 최소 어떤 권한이 필요한가?", ["조회", "운용자", "권한 없음"], 1, "지령·경보 확인·태세 변경은 운용자부터 할 수 있다."]] },
    { t: "3. 운용 장소와 태세", d: "운용 장소는 작전지(상전 없이 자체 전원)와 주둔지(상전 연계)다. 태세는 평시 · 저소음(디젤 금지, 연료전지 허용, 디젤 없이 버틸 시간이 모자랄 때만 3등급 부하를 절감 → 차단) · 자립(외부 보급 없이 목표 시간 버티기)이다. 설비 제어 화면에서 바꾼다.",
      k: [["설비 제어 화면 열기", c => c.seen.has("control")], ["태세를 저소음으로 바꾸기", c => c.posture === "저소음"], ["저장량이 넉넉하면 3등급 부하가 그대로 공급되는지 확인", c => c.posture === "저소음" && !c.shed.includes("L3")], ["태세를 평시로 되돌리기", c => c.did.has("quiet") && c.posture === "평시"]],
      q: [["저소음 태세에서 EMS 가 하는 일은?", ["디젤을 더 많이 돌린다", "디젤을 쓰지 않고, 버틸 시간이 모자랄 때만 3등급 부하를 줄인다", "모든 부하를 끈다"], 1, "소리를 줄이려고 디젤을 금지한다. 디젤 없이 버틸 시간이 목표에 못 미칠 때만 낮은 등급 부하를 먼저 절감하고, 그래도 모자라면 끊는다."], ["가장 나중까지 지키는 부하는?", ["3등급", "2등급", "1등급"], 2, "1등급이 가장 중요하다. 차단은 3등급부터 한다."]] },
    { t: "4. 자동 제어와 수동 지령", d: "평소에는 자동 제어가 급전을 맡는다. 수동으로 장치를 켤 때는 '선택 → 실행' 두 번 확인한다(SBO). 선택 창에서 조건을 읽고 [실행]을 눌러야 지령이 나간다.",
      k: [["자동 제어를 해제(수동)하기", c => c.auto === false], ["디젤발전기 기동을 선택 → 실행하기", c => c.dg], ["자동 제어를 다시 켜기", c => c.did.has("manual") && c.auto === true]],
      q: [["'선택 → 실행' 두 단계로 하는 까닭은?", ["화면을 예쁘게 하려고", "잘못 누른 지령이 바로 나가지 않게 하려고", "통신을 빠르게 하려고"], 1, "선택한 대상과 조건을 한 번 더 확인하게 해 오조작을 막는다."]] },
    { t: "5. 주둔지 운전과 상전 상실", d: "주둔지에서는 상전에 연계해 최대부하 시간에 ESS 로 수전을 깎고, 역송은 하지 않는다. 주둔지 자립은 전시·유사시 상전 상실을 뜻한다 — ESS 가 끊김 없이 전압을 만들고 발전기가 붙는다.",
      k: [["운용 장소를 주둔지로 바꾸기", c => c.mode === "grid"], ["태세를 자립으로 바꾸어 상전 상실 상태 보기", c => c.mode === "grid" && (c.posture === "자립" || c.outage)], ["결선도에서 수전 차단기 상태 확인", c => c.did.has("grid") && c.seen.has("sld2")], ["작전지 · 평시로 되돌리기", c => c.did.has("grid") && c.mode === "island" && c.posture === "평시"]],
      q: [["주둔지 '자립' 태세는 어떤 상황인가?", ["전시·유사시 상전 상실", "전기 요금 할인 시간", "장비 점검일"], 0, "상전이 끊긴 상황에서 자체 전원으로 버틴다."], ["상전이 끊긴 순간 전압을 이어 주는 것은?", ["ESS", "수전해", "하늘 카메라"], 0, "ESS 가 바로 전압을 만들어 끊김이 없다."]] },
    { t: "6. 경보와 조치 안내", d: "경보 화면에서 등급 · 발생 시각 · 내용을 보고 [확인]을 누른다. [조치 안내]를 누르면 이상의 종류, 안전 주의, 점검 순서, 도구, 부품이 나온다. 연습을 위해 디버그 화면의 가상 장치 조작으로 고장을 넣을 수 있다.",
      k: [["경보 화면 열기", c => c.seen.has("alarms")], ["경보의 [조치 안내] 열어 보기", c => c.did.has("guide")], ["경보 확인하기(미확인 0건)", c => c.did.has("guide") && c.unack === 0]],
      q: [["차단기 트립 경보가 떴다. 먼저 할 일은?", ["바로 다시 투입한다", "보호 요소와 원인을 확인한다", "경보를 지운다"], 1, "원인을 모른 채 재투입하면 사고가 커진다."], ["전원이 살아 있는 반을 만지기 전 순서는?", ["개방 → 검전 → 접지", "접지 → 투입", "그냥 작업"], 0, "차단기를 열고, 전압이 없는지 재고, 접지한 뒤 작업한다."]] },
    { t: "7. 기록 · 보고서", d: "기록·보고서 화면에서 검침 누적값과 운전 실적을 시간 · 일 · 월 · 년으로 찾아본다. ESS 안전 운영정보는 1분마다 쌓아 주둔지 서버로 넘긴다. [보고서 출력]으로 Word 보고서를 받는다.",
      k: [["기록·보고서 화면 열기", c => c.seen.has("archive")], ["'ESS 안전 기록' 탭 보기", c => c.tabs.has("ess")], ["'장치별 자료' 탭 보기", c => c.tabs.has("device")], ["'서버 전달' 탭 보기", c => c.tabs.has("xfer")]],
      q: [["ESS 안전 운영정보를 현장에 쌓아 두는 까닭은?", ["인터넷으로 보낼 수 없어서 보관했다가 주둔지 서버로 넘기려고", "화면을 채우려고", "배터리를 충전하려고"], 0, "군 시설은 인터넷 전송이 안 되므로 보관 후 전달한다."]] },
    { t: "8. 운영 시나리오와 도움말", d: "운영 시나리오 화면은 운전 순서를 미리 시험하고 시퀀스 문서(PPT)로 내는 곳이다. 모르는 화면에서는 제목 줄의 [? 도움말]을 누르면 그 화면의 사용법이 나온다.",
      k: [["운영 시나리오 화면 열기", c => c.seen.has("scenarios")], ["도움말 열기", c => c.seen.has("help")]],
      q: [["시나리오 검증의 시간 값은 무엇인가?", ["실장비에서 잰 값", "가상 장치에서 본 값(실장비는 시험으로 확인)", "법으로 정한 값"], 1, "가상 장치의 값이다. 실장비 성능은 시험으로 확인한다."]] },
  ],
  FINAL: [["3등급 부하가 자동 차단되는 태세는?", ["평시", "저소음", "없다"], 1], ["연료 경보가 뜨는 기준은?", ["잔량 50% 이하 또는 남은 시간 8시간 이하", "잔량 5% 이하만", "매일 정오"], 0], ["수동 지령의 순서는?", ["실행 → 선택", "선택 → 실행", "선택만"], 1],
    ["통신 두절된 장치에 대해 EMS 는?", ["지령을 막고 마지막 값을 유지한다", "계속 지령을 낸다", "값을 0 으로 만든다"], 0], ["주둔지 평시 운전에서 하지 않는 것은?", ["피크 억제", "역송", "경부하 시간 충전"], 1], ["차단은 어느 등급부터 하는가?", ["1등급", "2등급", "3등급"], 2],
    ["조치 안내 창에서 가장 먼저 읽을 칸은?", ["부품", "안전", "인쇄"], 1], ["ESS 안전 운영정보의 기본 저장 주기는?", ["1분", "1시간", "하루"], 0], ["자립 태세의 목적은?", ["외부 보급 없이 목표 시간 버티기", "전기 요금 절감", "소음 줄이기"], 0], ["경보를 본 뒤 [확인]을 누르는 뜻은?", ["고장이 고쳐졌다", "운용자가 그 경보를 알았다", "경보를 지운다"], 1]],

  /* ── 화면·항목 따라가기: 지금 보는 화면과 탭, 방금 누른 항목에 맞는 설명을 교육 창 위쪽에 보여 주고, 그 화면에 맞는 단원으로 옮긴다 */
  PAGE: {
    overview: ["개요", "전체 수급을 한눈에 본다. 위쪽 타일은 부하 · 태양광 · ESS 충전율 · 발전기 · 수소 · 예비력, 가운데 배치도는 장치와 전력 흐름(움직이는 선), 오른쪽은 전원 구성 비율이다. 배치도의 장치를 누르면 그 장치 정보가 뜬다.", 0],
    sld: ["결선도", "전기가 흐르는 길이다. 굵은 가로선이 모선 A · B, 작은 네모가 차단기(초록 투입 · 회색 개방 · 빨강 트립)다. 선이 밝으면 전기가 흐르는 중이다. 장치나 차단기를 누르면 상세 값이 나온다.", 0],
    ring: ["환망", "고리 모양 배전을 감시한다. 동그라미는 구간분전함(FSU), 그 아래 네모는 휴대용 배전체계(PPDU-20)(부하 바로 앞에 붙고, 20 kW 보다 큰 부하는 여러 대를 병렬로)와 그 부하(개요 · 결선도와 같은 부하 목록), 사이의 작은 네모는 구간 개폐기다. 초록은 공급 · 투입, 회색은 개방, 빨강은 차단 · 정전이다. 장치를 어느 자리에 몇 대 놓든 EMS 가 ID 를 읽어 스스로 이 그림을 만든다. [초기 기동 점검]은 그 인식 결과를 순서대로 보여 주고, [배전체계 구성]은 회로별 시설과 중요 부하를 고른다.", 5],
    energy: ["발전 · 예측", "오늘 발전량과 앞으로 24시간의 부하 · 태양광 예측을 본다. 띠는 예측 구간(이 안에 들어올 가능성이 높은 범위)이다. 하늘 카메라의 구름량과 지속 학습 상태도 여기서 본다.", 0],
    trends: ["추세", "부하 · 태양광 · 디젤 · 연료전지 · ESS · 충전율이 시간에 따라 어떻게 변했는지 본다. 위의 구간 단추로 보는 길이를 바꾸고 CSV 로 내려받는다.", 0],
    loads: ["부하 관리", "부하의 종류와 수량을 늘리고 줄이는 화면이다. 위쪽 세 칸은 등급별(1 · 2 · 3등급) 지금 전력 · 정격 합 · 공급 상태(공급 · 절감 공급 · 차단)다. 아래 목록에서 − · ＋ 로 수량을 바꾸고, [＋ 부하 추가]로 새 종류를 넣고, [고치기]로 등급 · 정격 · 절감 비율을 바꾼다. 바꾸면 개요 · 결선도 · 환망 · 운영 시나리오에 함께 반영된다. 공급이 부하를 따라가지 못하면 EMS 가 3등급 절감 → 3등급 차단 → 2등급 절감 → 2등급 차단 순서로 내려간다.", 8],
    control: ["설비 제어", "장치마다 카드가 있다. 카드에서 출력 · 상태 · 통신을 보고 [기동] [정지]로 지령한다(선택 → 실행). 오른쪽 '자동 제어' 칸에서 AUTO/MANUAL, 운용 장소, 운용 태세를 바꾼다.", 2],
    scenarios: ["운영 시나리오", "운전 순서를 가상 장치로 미리 시험한다. 왼쪽에서 장비 · 신호를 골라 단계를 만들고, [검증]으로 통과 여부와 시간을 본다. [시나리오 고르기]에서 분류(정상 운전 · 고장 대응(FMEA) · 보호 협조)를 골라 연다. 시퀀스 · 구성도 · 실시간 보기를 바꿔 볼 수 있고 PPT 로 내보낸다.", 7],
    alarms: ["경보", "발생한 이상을 등급순으로 본다. [확인]은 '알았다'는 표시이고, [조치 안내]는 점검 방법을 보여 준다. 탭으로 경보 이력 · 감사 기록 · 조치 안내 전체 목록을 본다.", 5],
    archive: ["기록 · 보고서", "쌓아 둔 기록을 시간 · 일 · 월 · 년으로 찾아본다. 탭마다 운전 실적 · 장치별 자료 · ESS 안전 기록 · 상황 기록 · 점검 기록 · 서버 전달 · 수집 항목 · 보관 상태가 있다. [보고서 출력]으로 Word 보고서를 받는다.", 6],
    comm: ["통신 진단", "장치마다 두 통신 경로(A · B)의 상태, 응답 시간, 재시도 수를 본다. 한쪽만 죽으면 '경로 저하', 둘 다 죽으면 '두절'이다. 두절된 장치는 지령이 막힌다.", 5],
    eng: ["디버그", "시운전과 고장 분석 도구다. 레지스터 탐색기(장치 값을 직접 읽기), 통신 추적, 점 목록, 가상 장치 조작(고장 넣기), 설정 편집이 있다. 엔지니어 권한이 필요한 기능이 많다.", 5],
    help: ["도움말", "사용자 설명서를 화면에서 읽는다. 왼쪽에서 절을 고르거나 글자로 찾는다.", 7],
  },
  SUB: { "archive:meter": "운전 실적 · 검침 — 구간 전력량과 검침 누적값(구간 시작 · 끝 지침, 사용량). 줄을 누르면 아래 단위로 들어간다.", "archive:device": "장치별 자료 — 장치를 고르면 신호별 평균 · 최소 · 최대가 나온다. 발전기 · 수소 · 태양광을 따로 찾아볼 때 쓴다.",
    "archive:ess": "ESS 안전 기록 — 운영 환경 · 배터리 · PCS · 보호 이벤트를 1분마다 쌓은 기록. 기록률이 100% 에 가까워야 한다. 회색은 아직 신호가 없는 항목이다.", "archive:events": "상황 기록 — 사건과 경보의 발생 · 복귀를 글자로 찾는다.",
    "archive:inspect": "점검 기록 — 절연저항 · 접지저항처럼 사람이 잰 값을 적는다. 보존 기간은 4년이다.", "archive:xfer": "서버 전달 — 기록을 구간 묶음으로 만들어 주둔지 서버로 넘기고 이력을 남긴다. '아직 넘기지 않은 기간'을 줄이는 것이 할 일이다.",
    "archive:collect": "수집 항목 — 관리자가 ESS 항목, 장치별 신호, 주기, 보관 기간을 고친다.", "archive:store": "보관 상태 — 저장 주기, 보관 기간, 쌓인 줄 수, 파일 크기를 본다.",
    "alarms:list": "경보 목록 — 미확인 경보는 왼쪽에 빨간 줄이 있다. 등급 1 이 가장 급하다.", "alarms:journal": "경보 이력 — 발생 · 복귀 · 확인이 시간순으로 남는다.", "alarms:audit": "감사 기록 — 누가 언제 무슨 지령 · 설정 변경을 했는지 남는다. [무결성 검증]으로 고쳐진 흔적이 없는지 본다.", "alarms:guide": "조치 안내 — 이상의 종류별 점검 순서 · 도구 · 부품 전체 목록." },
  TIPS: [[/ESS|충전율|SOC|배터리|PCS/, "ESS(에너지 저장 장치)", "큰 배터리다. 전기가 남으면 충전(−), 모자라면 방전(+)한다. 충전율(SOC)은 찬 정도(%)이고, 너무 낮으면 발전기가 켜진다. 상전이 끊기면 ESS 가 먼저 전압을 만든다."],
    [/주둔지.*발전기|GDG/, "주둔지 발전기", "주둔지에 원래 있던 큰 디젤발전기다. 상전이 끊기고 정전이 길어지면 자동으로 붙는다. 저소음 태세에서는 쓰지 않는다."],
    [/디젤|DG/, "디젤발전기", "경유로 발전한다. 소리가 커서 저소음 태세에서는 켜지 않는다. 연료가 절반 이하이거나 남은 시간이 8시간 이하이면 연료 경보가 뜬다."],
    [/연료전지|FC\b/, "연료전지", "수소로 발전한다. 조용해서 저소음 태세에서도 쓴다. 수소 잔량이 낮으면 경보가 뜬다."], [/수전해|ELZ/, "수전해", "남는 전기로 물을 분해해 수소를 만든다. 태양광이 남을 때 돌린다."], [/수소|H2/, "수소 저장", "연료전지가 쓰는 수소의 남은 양(Nm³)이다."],
    [/태양광|PV|일사|하늘 카메라|구름/, "태양광", "햇빛으로 발전한다. 구름이 끼면 급히 줄어들 수 있어, 하늘 카메라의 구름량을 예측에 쓴다. ESS 가 가득 차면 출력을 제한할 수 있다."],
    [/차단기|CB-|트립|투입|개방/, "차단기", "전기 길을 열고 닫는 스위치다. 투입(닫힘) · 개방(열림) · 트립(보호 동작으로 끊김). 트립이면 원인을 찾기 전에는 다시 넣지 않는다."], [/모선|BUS|전압|주파수/, "모선", "전원과 부하가 모이는 굵은 전선이다. A · B 두 개가 있고 전압 · 주파수가 정상 범위에 있어야 한다."],
    [/PPDU|배전체계|CH[1-6]|회로/, "휴대용 배전체계(PPDU-20)", "구간분전함에서 받아 시설 부하로 나누어 주는 20 kW급 휴대용 배전함이다. 주 차단기 아래 6회로(3상 2 · 단상 4)가 있고 회로마다 보호 · 계측을 한다. 회로에 물린 시설과 부하 등급은 [배전체계 구성]에서 고른다. ★ 는 1등급(중요) 부하가 물린 곳이다."],
    [/FSU|구간분전함/, "구간분전함(FSU)", "환망의 마디다. 전압으로 전기가 들어오는지 알고, 다음 구간으로 나가는 개폐기를 가진다. 장치마다 ID 가 있어 설치 뒤 자리를 확인한다."],
    [/DG2|ESS2|PV2|FC2|× ?\d대|미설치/, "같은 종류 여러 대 · 미설치", "같은 종류 장치를 더 놓으면 EMS 가 스스로 알아내 이 화면에 한 대씩 더 그린다. 값은 있는 장치의 합이고, 기동 · 정지는 모두에게 간다. 가져오지 않은 종류는 '미설치'로 흐리게 나온다 — 고장이 아니다."],
    [/날씨|운량|하늘|통신망/, "날씨 입력", "본 하늘 상태를 넣으면 태양광 예측에 섞인다. 실측이 나오면 AI 예측과 견주어, 더 정확한 쪽의 비율이 스스로 올라간다. 주둔지에서는 군 통신망의 날씨 자료를 받아 같은 방식으로 쓴다."],
    [/디젤 가동|재생에너지 활용률/, "디젤 가동 · 재생에너지 활용률", "개요 맨 위 칸이다. 디젤 가동: 지금 출력, 운전 대수와 소모량(L/h — 출력 × 설정 소비율로 셈한 추정값), 오늘 쓴 연료. 저소음 태세면 '금지'. 재생에너지 활용률: 부하 가운데 태양광이 맡은 비율(지금 · 오늘 누적)."],
    [/설치 점검|다시 검사|해결됨|자동 보완/, "설치 점검(초기화)", "장비를 설치한 뒤 누른다. 설치한 모양대로 그린 그림에 ✔ 정상 · ! 주의 · ✕ 이상 표가 붙는다(EMS → 장비 → 모선 A · B → 환망 → 부하). 왼쪽 이름표가 검사 여섯 가지(장비 통신 · 종류 · 대수 · 환망 순서 · 환망 A · B · 모선 구성 · 부하 경로)다. ! · ✕ 가 붙은 그림을 누르면 고치는 방법이 나온다. 고친 뒤 [이 항목만 다시 검사]를 누르면 '해결됨'이 붙는다. 이상 · 주의가 모두 0 이어야 완료다. 가져오지 않은 종류나 일부러 열어 둔 차단기는 [확인]으로 닫는다."],
    [/CB-|차단기|호기|한 대/, "장비마다 차단기 · 한 대 = 그림 하나", "결선도는 장비 한 대마다 그림 하나다. 그림을 왼쪽(모선 A) · 오른쪽(모선 B)으로 끌면 그 한 대의 모선이 바뀐다. 장비마다 차단기가 있어(추가 장비는 CB-ESS2 처럼 장치 이름) 한 대의 차단기가 열리면 그 한 대만 떨어진다. 복합전력 차량은 발전기와 ESS 가 따로다."],
    [/FMEA|FAT/, "FMEA · FAT 내보내기", "기록 · 보고서 화면의 단추로 지금 구성(장비 대수 · 모선 · 환망 · 부하)에 맞춘 FMEA 펼침과 FAT 점검표를 HTML · Excel 로 받는다. 번호는 기존 것을 쓰고 점수는 새로 매기지 않는다."],
    [/초기 기동 점검|ID/, "초기 기동 점검", "EMS 가 자리마다 장치 ID 를 읽어 알아낸 배치를 전원에서 가까운 순서로 보여 준다. 장치를 바꿔 놓거나 대수가 달라도 화면이 스스로 맞춰지므로 따로 맞출 것이 없다. '확인 필요'만 살피면 된다."],
    [/환망|구간|상시 개방점|마디|단선/, "환망(고리 모양 배전)", "전원에서 나가 부하 마디를 돌아 다시 전원으로 오는 고리다. 평소 한 구간(상시 개방점)을 열어 둔다. 어느 구간이 끊어지면 그 구간을 양 끝에서 떼어 내고 상시 개방점을 닫아 반대쪽에서 전기를 보낸다."],
    [/부하|등급|차단 중/, "부하와 등급", "전기를 쓰는 장비다. 1등급이 가장 중요하고, 전기가 모자라면 3등급 → 2등급 순으로 자동 차단하고 여유가 생기면 되돌린다."], [/예비력|N-1/, "예비력", "가장 큰 전원 하나가 꺼져도 1 · 2등급 부하를 감당할 수 있는 여유다. 부족하면 경보가 뜬다."],
    [/저소음/, "저소음 태세", "디젤을 쓰지 않고 연료전지 · ESS 로 버틴다. 3등급 부하는 자동 차단한다."], [/자립/, "자립", "외부 보급 없이 목표 시간을 버티는 운전이다. 주둔지에서는 전시 · 유사시 상전 상실을 뜻한다. '자립 지속'은 지금 자원으로 버틸 수 있는 시간이다."],
    [/작전지|주둔지|운용 장소|상전|수전/, "운용 장소", "작전지는 상전 없이 자체 전원으로, 주둔지는 상전에 연계해 운전한다. 주둔지에서는 역송하지 않고 최대부하 시간에 ESS 로 수전을 깎는다."],
    [/AUTO|MANUAL|자동 제어|수동/, "자동 · 수동 제어", "AUTO 는 EMS 가 급전을 맡고, MANUAL 은 운용자가 직접 지령한다. 수동 지령은 '선택 → 실행' 두 번 확인한다."], [/기동|정지|실행|선택|SBO/, "지령(선택 → 실행)", "단추를 누르면 선택 창이 뜬다. 대상과 조건을 읽고 [실행]을 눌러야 지령이 나간다. 일정 시간 안에 실행하지 않으면 취소된다."],
    [/통신|경로|LINK|두절|hb|생존/, "통신 상태", "장치마다 두 경로(A · B)로 통신한다. 둘 다 끊기면 '두절'이고 그 장치는 지령이 막히며 화면 값은 마지막 값에 멈춘다."], [/예측|구간|정확도|학습/, "예측", "지난 자료로 앞으로의 부하와 태양광을 미리 계산한다. 띠는 예측 구간이다. 오차가 커지면 계획 운전을 쉬고 규칙 운전으로 돈다."],
    [/경보|확인|미확인|조치/, "경보", "이상을 알리는 표시다. [확인]은 운용자가 알았다는 뜻이고 고쳐졌다는 뜻이 아니다. [조치 안내]에서 점검 순서를 본다."], [/검침|누적|지침|전력량/, "검침 누적값", "EMS 가 계측값을 더해 만든 전력량 지침이다. 구간 끝 − 시작 = 사용량."], [/보고서|Word/, "보고서 출력", "현재 현황 · 최근 운영 현황 · 상황 기록 · 운전 시퀀스 · 점검 기록을 Word 문서로 받는다."],
    [/시퀀스|시나리오|검증|단계/, "시나리오", "운전 순서를 단계로 적어 가상 장치에서 시험한다. 실선은 지령 · 입력, 점선은 응답 판정이다."], [/추세|CSV/, "추세", "값이 시간에 따라 변한 모습이다."]],
  sub() { const pg = (location.hash || "#overview").slice(1); try { if (pg === "archive") return "archive:" + ARC.tab; if (pg === "alarms") return "alarms:" + P_ALM.tab; } catch (e) { /* 아직 안 열린 화면 */ } return ""; },
  tip(el) {
    if (!el || !el.closest || el.closest("#train")) return;
    const blk = el.closest("nav a, .tabs button, .chip, .seg button, g.cbk, path.bus, text.buslbl, g.node, g.cbk, g.meq, .spt, .scard, .tile, .dev, .srow, tr, .arc-tile, .panel, .btn"); if (!blk || blk.matches("nav a, .tabs button")) return;      // 화면·탭 이동은 '이 화면' 설명이 맡는다
    const head = blk.matches(".panel") ? (blk.querySelector(".hd h3, .hd") || blk) : blk, txt = (head.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90); const kind = blk.matches("g.cbk") ? "차단기" : blk.matches("path.bus, text.buslbl") ? "모선" : ""; if (!txt && !kind) return;
    const hit = (kind && this.TIPS.find(t => t[1] === kind)) || this.TIPS.find(t => t[0].test(txt));      // 모양으로 알 수 있는 것(차단기·모선)은 글자보다 먼저
    this.item = hit ? { title: hit[1], text: hit[2], seen: txt } : { title: txt.slice(0, 40), text: "", seen: "" }; this.paint(true);
  },
  load() { try { const j = JSON.parse(localStorage.getItem(this.KEY) || "{}"); this.cur = j.cur || 0; this.seen = new Set(j.seen || []); this.did = new Set(j.did || []); this.ans = j.ans || {}; this.who = j.who || this.who; this.tabs = new Set(j.tabs || []); } catch (e) { this.tabs = new Set(); } if (!this.tabs) this.tabs = new Set(); },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify({ cur: this.cur, seen: [...this.seen], did: [...this.did], ans: this.ans, who: this.who, tabs: [...this.tabs] })); } catch (e) { /* 저장 못 해도 계속 */ } },
  ctx() {
    const s = S.snap || {}, o = s.ops || {}, pg = (location.hash || "#overview").slice(1); this.seen.add(pg); if (s.mode === "grid" && pg === "sld") this.seen.add("sld2");
    if (o.posture === "저소음") this.did.add("quiet"); if (s.auto === false) this.did.add("manual"); if (s.mode === "grid") this.did.add("grid");
    if (pg === "archive" && typeof ARC !== "undefined") this.tabs.add(ARC.tab);
    return { seen: this.seen, did: this.did, tabs: this.tabs, role: S.me.role, mode: s.mode, posture: o.posture, shed: o.shed || [], outage: !!o.outage, auto: s.auto, dg: kOn("DG"), unack: (s.alarms || []).filter(a => !a.acked).length };
  },
  done(i, c) { return this.L[i].k.every(k => k[1](c)) && this.L[i].q.every((q, j) => this.ans[`${i}.${j}`] === q[2]); },
  /* ── 작은 화면(휴대전화·태블릿): 실제 화면판(1920×1080)은 그대로 두고 손가락으로 밀어 보며, 확대·축소 단추를 쓴다. 교육 창은 아래에 붙는다 */
  small() { const touch = matchMedia("(pointer: coarse)").matches; return innerWidth < 1100 || (touch && (innerHeight < 820 || Math.min(screen.width, screen.height) < 820)); },
  fit() {
    const app = document.getElementById("app"); if (!app) return;
    if (!this.small()) {                    // PC: 교육 창을 오른쪽에 나란히 두고 화면판을 그 옆에 맞춘다(서로 가리지 않게). 접으면 화면판이 원래 크기로 돌아온다
      const H = document.documentElement.classList; H.remove("tr-m"); const sp = document.getElementById("trSpace"); if (sp) sp.remove(); H.toggle("tr-d", !this.min); if (this.min) return this._fit();
      const w = innerWidth - 408, sc = Math.min(w / CANVAS_W, innerHeight / CANVAS_H); S.scale = sc; app.style.transform = `translate(${((w - CANVAS_W * sc) / 2).toFixed(1)}px, ${((innerHeight - CANVAS_H * sc) / 2).toFixed(1)}px) scale(${sc})`;
      ["modal", "toast", "stale"].forEach(id => { const e = document.getElementById(id); if (e && e.parentElement !== app) app.appendChild(e); }); return;
    }
    document.documentElement.classList.remove("tr-d");
    document.documentElement.classList.add("tr-m"); const base = innerWidth / CANVAS_W, s = Math.min(1.2, Math.max(base, this.zoom || Math.max(base, innerWidth > innerHeight ? 0.45 : 0.55))); this.zoom = s; S.scale = s;
    app.style.transform = `scale(${s})`; let sp = document.getElementById("trSpace"); if (!sp) { sp = document.createElement("div"); sp.id = "trSpace"; document.body.appendChild(sp); }
    sp.style.width = CANVAS_W * s + "px"; sp.style.height = CANVAS_H * s + (this.el ? this.el.offsetHeight : 0) + 12 + "px";
    ["modal", "toast", "stale"].forEach(id => { const e = document.getElementById(id); if (e && e.parentElement !== app) app.appendChild(e); });
  },
  zoomBy(k) { this.zoom = k === 0 ? innerWidth / CANVAS_W : (this.zoom || 0.5) * k; this.fit(); },
  watch() {                 /* 작은 화면에서는 확인 창·알림이 화면 밖에 뜰 수 있어 그쪽으로 옮겨 주고, 알림 글은 교육 창에도 보여 준다 */
    const m = document.getElementById("modal"), t = document.getElementById("toast");
    if (m) new MutationObserver(() => { if (this.small() && m.classList.contains("on")) { const b = document.getElementById("modalBox"); if (b) b.scrollIntoView({ block: "center", inline: "center" }); } }).observe(m, { attributes: true, attributeFilter: ["class"] });
    if (t) new MutationObserver(r => { const n = r.flatMap(x => [...x.addedNodes])[0]; if (n && this.small()) { this.msg = n.textContent; this.paint(true); clearTimeout(this._mt); this._mt = setTimeout(() => { this.msg = ""; this.paint(true); }, 4500); } }).observe(t, { childList: true });
  },
  start() {
    if (this.on) return; this.on = true; this.load();
    const el = document.createElement("div"); el.id = "train"; el.className = "train"; document.body.appendChild(el); this.el = el;
    if (typeof TS !== "undefined") { const o = TS.open.bind(TS); TS.open = a => { this.did.add("guide"); return o(a); }; }
    document.addEventListener("click", e => this.tip(e.target), true); this.follow = true;
    addEventListener("hashchange", () => { this.item = null; const pg = (location.hash || "#overview").slice(1), m = this.PAGE[pg]; if (this.follow && m && this.cur !== this.L.length) this.cur = m[2]; this.paint(true); });
    this._fit = fitCanvas; fitCanvas = () => this.fit(); addEventListener("orientationchange", () => setTimeout(() => this.fit(), 200)); this.watch();      // eslint-disable-line no-global-assign — 화면판 맞춤을 교육 창이 맡는다
    this.min = this.small() && innerHeight < 500;                      // 가로로 든 휴대전화는 화면이 낮아 교육 창을 접은 채로 시작한다
    setInterval(() => this.paint(), 1000); this.paint(true); this.fit();
  },
  paint(force) {
    const c = this.ctx(), n = this.L.length, fin = this.cur === n, pg = (location.hash || "#overview").slice(1), sub = this.sub(), key = JSON.stringify([this.cur, this.min, this.msg, pg, sub, this.item, this.follow, fin ? this.ans : this.L[this.cur].k.map(k => k[1](c)), Object.keys(this.ans).length, this.L.map((_, i) => this.done(i, c))]);
    if (!force && key === this._key) return; this._key = key; this.save();
    const tabs = this.L.map((l, i) => `<button class="tr-tab ${i === this.cur ? "on" : ""} ${this.done(i, c) ? "ok" : ""}" data-l="${i}" title="${esc(l.t)}">${i + 1}</button>`).join("") + `<button class="tr-tab ${fin ? "on" : ""}" data-l="${n}" title="종합 평가">평가</button>`;
    const off = window.EMS_TRAIN && EMS_TRAIN.offline;
    let body;
    if (fin) {
      const sc = this.FINAL.filter((q, j) => this.ans["f." + j] === q[2]).length, all = this.FINAL.every((q, j) => this.ans["f." + j] !== undefined), tasks = this.L.filter((_, i) => this.done(i, c)).length;
      body = `<h4>종합 평가</h4><p class="tr-d">열 문제를 풀고 결과표를 인쇄한다.</p><div class="tr-who"><input class="in sm" id="trName" placeholder="이름" value="${esc(this.who.name)}"><input class="in sm" id="trUnit" placeholder="소속" value="${esc(this.who.unit)}"></div>
        ${this.FINAL.map((q, j) => this.quiz("f." + j, q, j)).join("")}<p class="tr-score">${all ? `점수 ${sc} / ${this.FINAL.length} · 단원 완료 ${tasks} / ${n}` : "모든 문제에 답하면 점수가 나온다"}</p><button class="btn sm" id="trPrint" ${all ? "" : "disabled"}>결과표 인쇄</button>`;
    } else {
      const l = this.L[this.cur];
      body = `<h4>${esc(l.t)}</h4><p class="tr-d">${esc(l.d)}</p><div class="tr-k">${l.k.map(k => `<div class="${k[1](c) ? "ok" : ""}"><i>${k[1](c) ? "✔" : "□"}</i>${esc(k[0])}</div>`).join("")}</div>${l.q.map((q, j) => this.quiz(`${this.cur}.${j}`, q, j)).join("")}`;
    }
    this.el.classList.toggle("min", !!this.min);
    this.el.innerHTML = `<div class="tr-hd"><b>교육</b><span class="sub">${off ? "가상 화면(녹화한 값)" : "가상 장치 모드"}</span><div class="spacer"></div><span class="tr-zoom"><button class="btn sm" id="trZo" title="축소">－</button><button class="btn sm" id="trZf" title="화면 너비에 맞춤">맞춤</button><button class="btn sm" id="trZi" title="확대">＋</button></span><button class="btn sm ghost" id="trMin">${this.min ? "펼치기" : "접기"}</button><button class="btn sm ghost" id="trReset" title="진행 상황 지우기">처음부터</button></div>
      ${this.msg ? `<div class="tr-msg">${esc(this.msg)}</div>` : ""}
      <div class="tr-ctx"><div class="tr-ctx-h"><b>이 화면 · ${esc((this.PAGE[pg] || [pg])[0])}</b><label class="tr-fol" title="화면을 옮기면 그 화면에 맞는 단원으로 바꾼다"><input type="checkbox" id="trFol" ${this.follow ? "checked" : ""}> 화면 따라가기</label></div>
        <p>${esc((this.PAGE[pg] || ["", "이 화면의 설명은 도움말에서 본다."])[1])}</p>${this.SUB[sub] ? `<p class="tr-sub">▸ ${esc(this.SUB[sub])}</p>` : ""}
        ${this.item ? `<div class="tr-item"><b>누른 항목 · ${esc(this.item.title)}</b>${this.item.text ? `<p>${esc(this.item.text)}</p>` : `<p class="sub">이 항목의 설명은 [? 도움말]에서 찾아본다.</p>`}${this.item.seen ? `<p class="sub">화면의 글: ${esc(this.item.seen)}</p>` : ""}</div>` : `<p class="sub">화면의 장치 · 칸 · 단추를 누르면 그 항목의 설명이 여기에 나온다.</p>`}</div>
      <div class="tr-tabs">${tabs}</div><div class="tr-bd">${body}</div><div class="tr-ft"><button class="btn sm" id="trPrev" ${this.cur ? "" : "disabled"}>◀ 앞</button><button class="btn sm pri" id="trNext" ${fin ? "disabled" : ""}>다음 ▶</button></div>`;
    const q = s => this.el.querySelector(s);
    this.el.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { this.cur = +b.dataset.l; this.paint(true); }); q("#trFol").onchange = e => { this.follow = e.target.checked; this.paint(true); };
    this.el.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { this.ans[b.dataset.q] = +b.dataset.a; this.paint(true); });
    q("#trMin").onclick = () => { this.min = !this.min; this.paint(true); this.fit(); }; q("#trZo").onclick = () => this.zoomBy(1 / 1.25); q("#trZi").onclick = () => this.zoomBy(1.25); q("#trZf").onclick = () => this.zoomBy(0); q("#trPrev").onclick = () => { this.cur--; this.paint(true); }; q("#trNext").onclick = () => { this.cur++; this.paint(true); };
    q("#trReset").onclick = () => { if (!confirm("교육 진행 상황을 지우고 처음부터 합니까?")) return; this.seen = new Set(); this.did = new Set(); this.tabs = new Set(); this.ans = {}; this.cur = 0; this.paint(true); };
    if (fin) { q("#trName").onchange = e => { this.who.name = e.target.value.trim().slice(0, 20); this.save(); }; q("#trUnit").onchange = e => { this.who.unit = e.target.value.trim().slice(0, 30); this.save(); }; q("#trPrint").onclick = () => this.print(c); }
  },
  quiz(id, q, j) {
    const a = this.ans[id], ok = a === q[2];
    return `<div class="tr-q"><p>문제 ${j + 1}. ${esc(q[0])}</p>${q[1].map((o, i) => `<button class="tr-o ${a === i ? (ok ? "ok" : "bad") : ""}" data-q="${id}" data-a="${i}">${"①②③"[i]} ${esc(o)}</button>`).join("")}${a !== undefined && q[3] ? `<p class="tr-x ${ok ? "ok" : "bad"}">${ok ? "맞다. " : "다시 생각해 보자. "}${ok ? esc(q[3]) : ""}</p>` : ""}</div>`;
  },
  print(c) {
    const sc = this.FINAL.filter((q, j) => this.ans["f." + j] === q[2]).length, w = window.open("", "_blank"); if (!w) { this.msg = `결과: ${this.who.name || "이름 없음"} · 평가 ${sc}/${this.FINAL.length} · 단원 ${this.L.filter((_, i) => this.done(i, c)).length}/${this.L.length} — 이 화면을 갈무리(캡처)해 제출하십시오`; return this.paint(true); }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>EMS 교육 결과표</title><style>body{font-family:"맑은 고딕",sans-serif;margin:40px;color:#000}table{border-collapse:collapse;width:100%}td,th{border:1px solid #666;padding:6px 10px;text-align:left}h1{font-size:22px}</style>
      <h1>IFPS 이동형 EMS 교육 결과표</h1><table><tr><th>이름</th><td>${esc(this.who.name)}</td><th>소속</th><td>${esc(this.who.unit)}</td></tr><tr><th>일시</th><td>${new Date().toLocaleString("ko-KR")}</td><th>교육 자료</th><td>${esc((S.snap && S.snap.version && S.snap.version.pkg) || "")}</td></tr>
      <tr><th>종합 평가</th><td>${sc} / ${this.FINAL.length}</td><th>단원 완료</th><td>${this.L.filter((_, i) => this.done(i, c)).length} / ${this.L.length}</td></tr></table><h3>단원별</h3><table>${this.L.map((l, i) => `<tr><td>${esc(l.t)}</td><td>${this.done(i, c) ? "완료" : "미완료"}</td></tr>`).join("")}</table>
      <p style="margin-top:30px">확인자: ____________________ (서명)</p>`); w.document.close(); w.print();
  },
};
/* 교육 창 켜기: 교육용 묶음에서는 바로, 실제 EMS 에서는 가상 장치 모드일 때 위쪽 줄의 [교육] 단추로 */
(function () {
  const boot = () => {
    if (window.EMS_TRAIN && EMS_TRAIN.offline) return TRAIN.start();
    const t = setInterval(() => { if (!S.snap) return; clearInterval(t); if (!S.snap.sim) return;
      const b = h(`<button class="btn sm" id="trOpen" title="화면을 보며 따라 하는 교육 창(가상 장치 모드 전용)">교육</button>`); const u = document.querySelector("#user"); if (u && u.parentNode) u.parentNode.insertBefore(b, u); b.onclick = () => { TRAIN.start(); b.remove(); };
      if (/[?&]train=1/.test(location.search)) b.click(); }, 500);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
