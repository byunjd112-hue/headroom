# IFPS 이동형 전력체계 EMS (노트북 실장비 연동판)

군 이동형 마이크로그리드(PV·디젤·수소 연료전지·ESS)를 **노트북 한 대에서** 실장비와 Modbus TCP로 연동해 감시·제어하는 EMS입니다.
외부 CDN·클라우드 없이 폐쇄망에서 동작하며, 의존성은 Python 3.10+ 와 numpy 하나뿐입니다.

| 구성 | 위치 | 기능 |
|---|---|---|
| 핵심 프로그램 `ifps_ems` v0.6.0 | `ifps_ems/` | 부하·PV 24h 예측, 동적계획법 운전계획, N-1 예비력, 통신 감시·지령 판단, 연쇄 HMAC 감사 기록 (통신 모듈 없음) |
| 실장치 연동 계층 `ifps_ems_rt` v0.1.0 | `ifps_ems_rt/` | Modbus TCP(이중 경로 A/B), 대응표, SBO 지령·응답 확인·대체 전원, 1초 실행기 |
| 제어화면(HMI) + 디버그 도구 | `ifps_ems_rt/hmi/` | 웹 제어화면(브라우저), 경보 관리, 추세, 통신 진단, 레지스터 탐색기, 프레임 추적, 고장 주입 |
| 현장 점검 CLI | `ifps_ems_rt/mbtool.py` | probe / read / watch / write / check |

## 빠른 시작
**Windows 노트북**: `run_sim.bat` 더블클릭 → 브라우저가 열리고 가상 장치로 전체 기능 시연.
**실장치**: `config/runtime.json`의 장치 IP(경로 A·B)·unit과 `config/pointmap.csv`의 레지스터 주소를 제작사 자료로 맞춘 뒤 `run_live.bat`. 자료형은 16비트(u16·i16)·32비트(u32·i32·f32)·64비트(u64·i64·f64), 바이트 순서는 `pointmap.csv`의 `order` 열 또는 `runtime.json`의 `devices.<장비>.order`에 ABCD/CDAB/BADC/DCBA로 적는다. 순서 판별은 `python -m ifps_ems_rt.mbtool read <IP> -a <주소> -n 4 --orders`. 상세는 `docs/out/이동형전력체계EMS_실장치통신연동방안서_Rev00.pdf`.

```
pip install -r requirements.txt
python -m ifps_ems verify                                          # 자가 점검
python -m ifps_ems gen-sample results/sample_site_data.csv         # (실측 이력 전) 합성 자료
python -m ifps_ems train results/sample_site_data.csv results      # 예측 모델 학습
python -m ifps_ems_rt.hmi config/runtime.json --sim --plan results --open   # 가상 장치
python -m ifps_ems_rt.hmi config/runtime.json --plan results --open         # 실장치
python -m unittest discover -s tests                               # 시험 28건
```
제어화면: http://127.0.0.1:8080 · 기본 PIN 운용자 `1111`, 엔지니어 `2222`(개발 모드 전용). 운용 모드(`run_mode: "운용"`)는 평문·기본 PIN, 외부 바인드, 가상 장치를 기동 단계에서 거부한다 — `python -m ifps_ems_rt.hmi.pin`으로 해시를 만들어 `pin_operator_hash`/`pin_engineer_hash`에 넣는다

## 제어화면
- **개요**: 발광 헥사곤 단선 결선도와 실시간 전력 흐름 애니메이션, 수급·SOC 눈금 게이지·ESS 상태, 연료/수소 잔량과 운전 가능 시간, N-1 예비력, 자동 제어 상태
- **작전지 배치 편집**(개요 → [배치 편집], 운용자 권한): 장비 대수·막사 수량 추가/복제/삭제, 끌어서 위치 이동, 이름·연결 급전선(1~3등급) 지정. 배전 케이블(FSU 환상망·인입·통신선)은 배치에서 자동 생성되고 실시간 통전·고장 상태가 반영된다. 저장 시 `state/layout.json`(이전본 `.bak`)과 감사 기록에 남는다
- **설비 제어**: IFPS ①~⑥ 체계 구성 기준 8개 설비 카드(① 복합전력 디젤·ESS, ② 이동형 ESS, ③ PV(계통 연결·분리·출력 제한), ④ 연료전지·수전해, ⑤ EMS, ⑥ 배전·계측 게이트웨이), ⑥ 차단기 9개 상태와 2·3등급 부하 차단·복구(SBO), 배치 기준 설비 수량.
  기존 설명: 선택-실행(SBO) 2단계 지령(10초 제한), 연동 조건(두절·수동·중복·잠금) 사전 차단, FC 출력 설정, AUTO/MANUAL 전환, 지령 기록
- **경보**: ISA-18.2 형식 4단계 우선순위, 발생/복귀/확인, 경보 이력, 감사 기록 무결성 검증
- **추세**: 1초 표본 4시간, 5분~4시간 창, CSV 내보내기 · **통신 진단**: 장치×경로 RTT/오류율, 수집 주기 분포, 워치독
- **디버그**: 레지스터 탐색기(FC01~04 읽기, U16/I16/U32/F32 동시 해석, 직접 IP 접속), 레지스터 쓰기(엔지니어), Modbus 프레임 추적(HEX·MBAP/PDU 해석·저장), 포인트 맵 실시간 값/품질, 가상 장치 고장 주입(무응답·지령 무시·수동 모드·경로 단절·시나리오), 시스템 정보
- 화면 색: 주간(올리브·흑녹·카키, 육군 디지털 전투복 계열) / 야간(MIL-STD-3009 NVIS 취지의 저휘도 청록) / 네이비. 메뉴는 계측·제어·관리로 구분
- KO/EN 전환, DTG(Zulu) 시각, 서버 응답 없음 화면 경고

## 장비 이미지
- **실사 스프라이트**(`static/sprites/*.webp`, 투명 배경·등각 시점, 11종 772KB): 작전지 배치도와 단선결선도 타일에 사용. 운전 상태는 필터로 표시(정지·개방 = 채도·밝기 낮춤, 트립·두절 = 적색 착색), 배치 편집 그대로 가능
- **실사 사진**(`static/photos/*.jpg`, 11종): 설비 제어·발전·예측의 장비 카드에 사용
- 두 이미지는 AI(Higgsfield)로 장비 묘사 텍스트만 입력해 생성(제안서 이미지 미사용). 파일이 없으면 자체 벡터 일러스트로 자동 대체. 실물 사진이 생기면 같은 이름으로 교체

## 시험·보안 문서
```
python tools/measure.py docs/test_results.json --soak 300   # 동적 시험(요구 시간·부하·내구) 측정
python tools/static_report.py                               # 단위시험+커버리지, pyflakes, bandit, radon
node docs/build_test_report.js                              # → docs/out/…SW시험결과보고서_Rev00.docx
node docs/build_security_review.js                          # → docs/out/…보안성검토결과_Rev00.docx
node docs/build_interface_guide.js                          # → docs/out/…실장치통신연동방안서_Rev00.docx
python -m ifps_ems_rt.hmi.pin                               # PIN 해시 생성(운용 모드 필수)
```

## 보안·신뢰성
- 접속은 사설·루프백 주소의 허용 목록만(공인 주소·DNS 이름 거부), HMI 기본 바인드 127.0.0.1, CSP·토큰 권한(조회/운용자/엔지니어)
- 모든 로그인·지령·레지스터 쓰기·고장 주입을 연쇄 HMAC 감사 기록에 남김. 운용 모드는 검증필 암호모듈이 아니면 기동 거부
- 전 장치·경로 병렬 수집: 응답 없는 장치가 있어도 주기 초과 없음. 지령 응답 대기는 별도 스레드라 수집을 막지 않음
- systemd `Type=notify` + `WatchdogSec`: 수집·제어가 모두 살아 있을 때만 감시 신호 (`service/ifps-ems.service`)

## 받은 패키지(Rev00) 대비 변경
- 누락된 핵심 프로그램 `ifps_ems`를 로직 설명서(식·상수) 기준으로 구현 — 원래 시험 13건 그대로 통과
- 제어 주기 전 워치독 미갱신으로 '제어 정지'가 오검출되던 문제 수정, 감사 기록 다중 스레드 보호
- 원 서비스 파일은 `WatchdogSec`에 알림이 없어 10초마다 강제 재기동되는 구성이었음 → sd_notify 구현
- Modbus: 연결 잠금, 프레임 추적 훅, FC01/02 읽기, 예외 코드 해석, 길이 필드 검증

## 한계
가상 장치와 합성 자료로만 시험했습니다. 실장치 주소·지령 규약은 FAT에서 확인해야 하며, 시간 상수는 설계 표준값(안)입니다.
보호 차단·우회 복구는 보호 IED가 수행합니다. 주·예비 서버 상호 감시 통신은 판정 논리(`Redundancy`)만 있습니다.
