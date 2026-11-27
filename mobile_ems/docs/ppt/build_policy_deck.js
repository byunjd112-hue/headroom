// 이동형 EMS 정책 설명 자료(군 대상, A3 가로 3장). 글은 모두 편집 가능한 글상자, 그림은 EMS 화면의 장비 실사 그림과 화면 캡처, 현장 사진(생성 이미지 — 개념도).
// 문서 작성 공통 규칙: 줄표 · 가운뎃점으로 잇지 않는다, 간결한 개조식, 표 칸 가운데 맞춤. 수치는 측정 파일에서 읽는다(시뮬레이터 검증값이라고 밝힌다).
// 실행: NODE_PATH=docs/ppt/node_modules node docs/ppt/build_policy_deck.js <출력.pptx>
const fs = require("fs"), path = require("path"), pptxgen = require("pptxgenjs");
const ROOT = path.join(__dirname, "..", ".."), J = f => JSON.parse(fs.readFileSync(path.join(ROOT, "docs", f), "utf8"));
const ST = J("static_results.json"), TR = J("test_results.json"), SC = J("scenario_results.json"), BM = J("forecast_benchmark.json"), CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/runtime.json"), "utf8"));
const OUT = process.argv[2] || path.join(ROOT, "IFPS_EMS_정책설명자료_A3.pptx");
const IMG = n => path.join(__dirname, "img", n), PH = n => path.join(ROOT, "ifps_ems_rt/hmi/static/photos", n), PO = n => path.join(__dirname, "img", "policy", n);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, mx = a => Math.max(...a);
const nmae = tg => mean(BM.runs.map(r => r.targets[tg].enhanced["24h"].nmae_pct)).toFixed(1);
const W = 16.535, H = 11.693, F = "맑은 고딕";
const C = { navy: "12305A", navy2: "1D4E89", green: "1F7A4D", teal: "2E6B5E", red: "B3261E", orange: "E07B00", ink: "111111", gray: "5A5A5A", line: "C9D3E0", pale: "F3F6FA", white: "FFFFFF", gold: "C9A227" };
const p = new pptxgen(); p.defineLayout({ name: "A3L", width: W, height: H }); p.layout = "A3L"; p.title = "이동형 EMS 정책 설명 자료";
const TABS = ["01. 필요성", "02. 체계 구성과 운용", "03. 작전 성능과 추진"];

function frame(n, label, h1, h2, en, lead, foot) {
  const s = p.addSlide(); s.background = { color: "FFFFFF" };
  s.addImage({ path: PO("field.jpg"), x: 0, y: 0, w: W, h: H, sizing: { type: "cover", w: W, h: H }, transparency: 88 });
  s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.78, fill: { color: C.navy } });
  TABS.forEach((t, i) => { s.addText(t, { x: 4.3 + i * 2.75, y: 0.14, w: 2.6, h: 0.5, fontFace: F, fontSize: 15, bold: i === n - 1, color: i === n - 1 ? "FFD27A" : "D6E0EE", align: "center", valign: "middle" });
    if (i === n - 1) s.addShape(p.ShapeType.rect, { x: 4.75 + i * 2.75, y: 0.66, w: 1.7, h: 0.05, fill: { color: "FFD27A" } }); });
  // 육군 로고 자리: 공식 파일을 받지 못해 자리만 둔다(공식 그림으로 바꿔 넣는다)
  s.addShape(p.ShapeType.ellipse, { x: 12.75, y: 0.1, w: 0.58, h: 0.58, fill: { color: C.navy2 }, line: { color: C.gold, width: 1.5 } });
  s.addText("로고", { x: 12.75, y: 0.1, w: 0.58, h: 0.58, fontFace: F, fontSize: 8, color: "FFFFFF", align: "center", valign: "middle" });
  s.addText([{ text: "대한민국 육군", options: { fontSize: 16, bold: true, breakLine: true } }, { text: "Republic of Korea Army", options: { fontSize: 9 } }], { x: 13.4, y: 0.08, w: 2.0, h: 0.62, fontFace: F, color: "FFFFFF", valign: "middle" });
  s.addText("이동형 전력체계 EMS", { x: 15.0, y: 0.08, w: 1.45, h: 0.62, fontFace: F, fontSize: 9.5, color: "D6E0EE", align: "right", valign: "middle" });
  // 왼쪽 단
  s.addText("0" + n, { x: 0.45, y: 0.95, w: 3.2, h: 1.55, fontFace: "Arial Black", fontSize: 96, bold: true, color: C.teal, valign: "middle" });
  s.addText(label, { x: 0.5, y: 2.45, w: 3.4, h: 0.5, fontFace: F, fontSize: 22, bold: true, color: C.ink });
  s.addShape(p.ShapeType.rect, { x: 0.52, y: 2.98, w: 0.9, h: 0.06, fill: { color: C.orange } });
  s.addText([{ text: h1, options: { color: C.ink, breakLine: true } }, { text: h2, options: { color: C.green } }], { x: 0.5, y: 3.25, w: 3.7, h: 1.5, fontFace: F, fontSize: 30, bold: true, valign: "top" });
  s.addText(en, { x: 0.5, y: 4.8, w: 3.7, h: 0.5, fontFace: "Arial", fontSize: 8.5, color: C.gray, charSpacing: 2 });
  s.addText(lead, { x: 0.5, y: 5.35, w: 3.55, h: 1.5, fontFace: F, fontSize: 13, color: C.ink, valign: "top", lineSpacingMultiple: 1.2 });
  s.addImage({ path: PO("soldier.jpg"), x: 0, y: 7.0, w: 4.1, h: 4.1, sizing: { type: "cover", w: 4.1, h: 4.1 } });
  // 아래 띠
  s.addShape(p.ShapeType.rect, { x: 0, y: H - 0.6, w: W, h: 0.6, fill: { color: C.navy } });
  ["작전지속능력 강화", "피탐 위험 감소", "연료와 인력 절감", "무정전 전력 공급"].forEach((t, i) => s.addText("◆ " + t, { x: 0.5 + i * 2.9, y: H - 0.6, w: 2.8, h: 0.6, fontFace: F, fontSize: 12.5, color: "FFFFFF", valign: "middle" }));
  s.addText(foot, { x: 11.2, y: H - 0.6, w: 5.1, h: 0.6, fontFace: F, fontSize: 12.5, bold: true, color: "FFD27A", align: "right", valign: "middle" });
  return s;
}
const bar = (s, x, y, w, t, col) => s.addText(t, { x, y, w, h: 0.5, shape: p.ShapeType.roundRect, rectRadius: 0.06, fill: { color: col || C.navy2 }, fontFace: F, fontSize: 17, bold: true, color: "FFFFFF", valign: "middle", margin: 8 });
const box = (s, x, y, w, h, o) => s.addShape(p.ShapeType.roundRect, Object.assign({ x, y, w, h, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: C.line, width: 1 } }, o));
const pic = (s, f, x, y, w, h) => s.addImage({ path: f, x, y, w, h, sizing: { type: "cover", w, h } });
function card(s, f, x, y, w, t, sub) { box(s, x, y, w, 3.0); pic(s, f, x + 0.06, y + 0.06, w - 0.12, 1.75);
  s.addText(t, { x, y: 1.88 + y, w, h: 0.42, fontFace: F, fontSize: 15.5, bold: true, color: C.navy, align: "center", valign: "middle" });
  s.addText(sub, { x: x + 0.1, y: 2.28 + y, w: w - 0.2, h: 0.66, fontFace: F, fontSize: 11.5, color: C.ink, align: "center", valign: "top" }); }
const list = (s, items, x, y, w, h, mark, col, fs_) => s.addText(items.map((t, i) => ({ text: mark + " " + t, options: { breakLine: i < items.length - 1 } })), { x, y, w, h, fontFace: F, fontSize: fs_ || 13.5, color: C.ink, valign: "middle", lineSpacingMultiple: 1.25, paraSpaceAfter: 2 });
const quote = (s, y, a, b, c) => s.addText([{ text: "“ " + a, options: { color: C.ink } }, { text: b, options: { color: C.green } }, { text: c + " ”", options: { color: C.ink } }], { x: 4.4, y, w: 11.7, h: 0.62, fontFace: F, fontSize: 22, bold: true, align: "center", valign: "middle" });
const X0 = 4.4, CW = 11.7;

/* ───────── 1. 필요성 */
{ const s = frame(1, "필요성", "전력이 끊기면", "작전도 멈춘다", "WITHOUT POWER, THE MISSION STOPS", "지휘통제, 통신, 감시, 의무 시설은\n전력이 끊기는 순간 기능을 잃음.\n전원을 하나로 묶어 통제하는\n체계가 필요함.", "전력 통제가 곧 작전지속능력");
  bar(s, X0, 1.0, CW, "전장의 전력 수요는 늘고, 전력 중단의 대가는 커짐");
  const cw = (CW - 0.45) / 4; [["console.jpg", "지휘통제", "전력 중단 시 상황 공유와\n지휘 결심 지연"], ["night.jpg", "경계와 감시", "야간 감시 장비의\n무중단 전원 필요"], [PH("l2.jpg"), "의무와 통신", "순간 정전도\n허용되지 않는 부하"], [PH("barrack.jpg"), "생활과 정비", "장기 주둔 시\n연료 소모의 대부분 차지"]]
    .forEach((c, i) => card(s, c[0].includes("/") ? c[0] : PO(c[0]), X0 + i * (cw + 0.15), 1.62, cw, c[1], c[2]));
  quote(s, 4.78, "전원이 여럿이어도 ", "통제가 하나", "여야 작전이 이어짐");
  const hw = (CW - 0.5) / 2, y = 5.55, bh = 4.85;
  box(s, X0, y, hw, bh, { line: { color: C.red, width: 1.5 } }); bar(s, X0, y, hw, "현재: 발전기별 개별 운용의 한계", C.red); pic(s, PO("legacy.jpg"), X0 + 0.12, y + 0.62, 2.3, 2.85);
  list(s, ["발전기마다 운용 인원 배치", "1대 고장 시 해당 시설 정전", "소음과 열로 위치 노출", "연료 보급 수송 부담", "태양광, ESS 연계 불가", "부하 우선순위 통제 불가"], X0 + 2.55, y + 0.62, hw - 2.65, 2.85, "✕", C.red, 13.5);
  s.addText("전원이 늘수록 운용 부담과 취약점이 함께 늘어남", { x: X0 + 0.12, y: y + 3.6, w: hw - 0.24, h: 1.1, shape: p.ShapeType.rect, fill: { color: "FBEDEC" }, fontFace: F, fontSize: 15, bold: true, color: C.red, align: "center", valign: "middle" });
  s.addText("▶", { x: X0 + hw + 0.05, y: y + 1.9, w: 0.4, h: 0.6, fontSize: 26, color: C.navy2, align: "center", valign: "middle" });
  const x2 = X0 + hw + 0.5; box(s, x2, y, hw, bh, { line: { color: C.navy2, width: 1.5 } }); bar(s, x2, y, hw, "도입 후: EMS 가 전원 전체를 통합 통제"); pic(s, PO("field.jpg"), x2 + 0.12, y + 0.62, 2.3, 2.85);
  list(s, ["화면 1개로 전체 감시와 지령", "고장 시 대체 전원 자동 기동", "저소음 태세에서 디젤 정지", "예측 기반 연료, 충전 계획", "다종 전원 통합 운용", "부하 등급별 우선 공급"], x2 + 2.55, y + 0.62, hw - 2.65, 2.85, "✓", C.navy2, 13.5);
  s.addText("전원이 늘수록 여유와 생존성이 함께 늘어남", { x: x2 + 0.12, y: y + 3.6, w: hw - 0.24, h: 1.1, shape: p.ShapeType.rect, fill: { color: "EAF1FA" }, fontFace: F, fontSize: 15, bold: true, color: C.navy, align: "center", valign: "middle" });
  s.addText("현장 사진은 이해를 돕기 위한 개념도(생성 이미지)임", { x: X0, y: 10.55, w: CW, h: 0.4, fontFace: F, fontSize: 9.5, color: C.gray, align: "right" }); }

/* ───────── 2. 체계 구성과 운용 */
{ const s = frame(2, "체계 구성과 운용", "모든 전원을", "화면 하나로 통제", "ONE SCREEN, ALL POWER SOURCES", "차량형 전원 4종과 배전 장비를\nEMS 가 통신으로 연결함.\n장비를 연결하면 자동으로 인식하여\n화면을 구성함.", "연결하면 인식하고, 인식하면 통제함");
  bar(s, X0, 1.0, CW, "체계 구성: 이동형 전원 4종, 배전 장비, EMS 중앙제어");
  const eq = [["dg.jpg", "① 기동형 복합전력", "발전기 90 kW\nESS 200 kWh"], ["ess.jpg", "② 이동형 ESS", "1000 kWh\n500 kW"], ["pv.jpg", "③ 이동형 태양광", "400 kWp\n80 kWp × 5"], ["fc.jpg", "④ 수소 생성 및 발전", "연료전지 100 kW\n수전해 150 kW"], ["dist.jpg", "⑥ 배전 및 변압", "모선 A, B\n연계 차단기"], ["fsu.jpg", "구간분전함", "환망 구성\n부하 직전 배전"]];
  const ew = (CW - 0.5) / 6; eq.forEach((e, i) => { const x = X0 + i * (ew + 0.1); box(s, x, 1.62, ew, 2.55); pic(s, PH(e[0]), x + 0.05, 1.67, ew - 0.1, 1.2);
    s.addText(e[1], { x, y: 2.9, w: ew, h: 0.4, fontFace: F, fontSize: 12.5, bold: true, color: C.navy, align: "center", valign: "middle" });
    s.addText(e[2], { x, y: 3.3, w: ew, h: 0.8, fontFace: F, fontSize: 11, color: C.ink, align: "center", valign: "top" }); });
  s.addText("정격은 설계 표준안이며 제작사 제원으로 확정함", { x: X0, y: 4.18, w: CW, h: 0.3, fontFace: F, fontSize: 9.5, color: C.gray, align: "right" });
  // EMS 화면
  const lw = 7.0; box(s, X0, 4.55, lw, 5.9, { line: { color: C.navy2, width: 1.5 } }); bar(s, X0, 4.55, lw, "⑤ EMS 중앙제어 운용 화면(실제 화면)");
  pic(s, IMG("overview.jpg"), X0 + 0.1, 5.15, lw - 0.2, 3.85); pic(s, PH("ems.jpg"), X0 + 0.1, 9.08, 1.9, 1.28);
  list(s, ["전체 전원과 부하 상태를 한 화면에 표시", "선택 후 실행 2단계 지령으로 오조작 방지", "경보 발생 시 조치 방법을 함께 안내"], X0 + 2.1, 9.08, lw - 2.25, 1.28, "✓", C.navy2, 12.5);
  // 운용 개념
  const rx = X0 + lw + 0.2, rw = CW - lw - 0.2; box(s, rx, 4.55, rw, 5.9); bar(s, rx, 4.55, rw, "운용 개념: 장소와 태세별 자동 운전", C.green);
  const hd = { bold: true, color: "FFFFFF", fill: { color: C.navy2 }, align: "center", valign: "middle", fontFace: F, fontSize: 12 }, td = (t, o) => ({ text: t, options: Object.assign({ align: "center", valign: "middle", fontFace: F, fontSize: 11.5, color: C.ink }, o) });
  s.addTable([[{ text: "태세", options: hd }, { text: "작전지(상전 없음)", options: hd }, { text: "주둔지(상전 연계)", options: hd }],
    [td("평시", { bold: true }), td("태양광과 ESS 우선\n부족 시 디젤 자동 기동"), td("상전 수전 최소화\n피크 억제")],
    [td("저소음", { bold: true, color: C.green }), td(`디젤 정지\n${CFG.quiet_target_h}시간 유지 목표`), td("디젤 정지\nESS 와 수전으로 운전")],
    [td("자립", { bold: true }), td("목표 시간 유지\n3등급부터 절감 공급"), td("상전 상실 가정\n정전 논리로 전환")]], { x: rx + 0.12, y: 5.18, w: rw - 0.24, colW: [0.75, (rw - 0.99) / 2, (rw - 0.99) / 2], rowH: [0.45, 0.88, 0.88, 0.88], border: { type: "solid", color: C.line, pt: 1 } });
  list(s, ["1등급 부하는 차단 대상에서 제외", "부족 시 3등급부터 절감 후 차단", "환망 단선 시 반대쪽에서 공급", "장비 추가와 철수 자동 인식"], rx + 0.15, 8.45, rw - 0.3, 1.9, "✓", C.green, 13); }

/* ───────── 3. 작전 성능과 추진 */
{ const s = frame(3, "작전 성능과 추진", "조용히, 오래,", "끊김 없이", "QUIET, ENDURING, UNINTERRUPTED", "소음과 연료를 줄이고 정전을 막는 것이\nEMS 의 작전 성능임.\n수치는 시뮬레이터 검증 결과이며\n실장비 시험에서 확정함.", "검증된 설계를 전력화로 연결");
  bar(s, X0, 1.0, CW, "작전 성능: 무엇이 좋아지는가");
  const k = [["저소음 지속 목표", `${CFG.quiet_target_h}시간`, "디젤 정지 상태 유지\n부족 시 3등급부터 절감", C.green], ["고장 감지 시간", `${mx(TR.comm_lost_s).toFixed(1)}초`, "통신 두절 판정 후\n대체 전원 자동 기동", C.navy2], ["지령 응답", `${mx(TR.sbo_ack_s).toFixed(2)}초`, "선택 후 실행 지령의\n수용 응답 시간", C.navy2],
    ["24시간 예측 오차", `${nmae("load")} %`, `부하 기준, 태양광 ${nmae("pv")} %\n합성 자료로 검증`, C.teal], ["무정전 구성", "N-1", "전원 1대 상실에도\n1, 2등급 부하 공급", C.green], ["운용 인원", "화면 1개", "전원별 배치 대신\n중앙 통제", C.orange]];
  const kw = (CW - 0.5) / 6; k.forEach((t, i) => { const x = X0 + i * (kw + 0.1); box(s, x, 1.62, kw, 2.3); s.addShape(p.ShapeType.rect, { x, y: 1.62, w: kw, h: 0.09, fill: { color: t[3] } });
    s.addText(t[0], { x, y: 1.75, w: kw, h: 0.4, fontFace: F, fontSize: 13, bold: true, color: C.gray, align: "center", valign: "middle" });
    s.addText(t[1], { x, y: 2.15, w: kw, h: 0.75, fontFace: F, fontSize: 26, bold: true, color: t[3], align: "center", valign: "middle" });
    s.addText(t[2], { x: x + 0.05, y: 2.92, w: kw - 0.1, h: 0.92, fontFace: F, fontSize: 11, color: C.ink, align: "center", valign: "top" }); });
  quote(s, 4.05, "소음을 줄이면 ", "생존성", "이, 연료를 줄이면 지속능력이 올라감");
  const hw = (CW - 0.3) / 2, y = 4.82;
  box(s, X0, y, hw, 2.75); bar(s, X0, y, hw, "작전 효과"); pic(s, PO("night.jpg"), X0 + 0.12, y + 0.62, 2.3, 2.0);
  list(s, ["야간 디젤 정지로 소음, 열 노출 감소", "재생에너지 우선으로 연료 소요 감소", "전원 1대 상실에도 지휘통제 유지", "자동 설치 점검으로 전개 시간 단축"], X0 + 2.55, y + 0.62, hw - 2.65, 2.0, "✓", C.navy2, 12.5);
  const x2 = X0 + hw + 0.3; box(s, x2, y, hw, 2.75); bar(s, x2, y, hw, "검증 현황(참조 구현 기준)", C.green); pic(s, PO("console.jpg"), x2 + 0.12, y + 0.62, 2.3, 2.0);
  list(s, [`자동 시험 ${ST.n_tests}건 통과`, `운영 시나리오 ${SC.total}건 검증`, `1초 주기 300회 연속 운전, 지연 ${TR.soak.overruns}건`, "고장모드 분석과 시나리오 연결"], x2 + 2.55, y + 0.62, hw - 2.65, 2.0, "✓", C.green, 12.5);
  // 추진 일정
  bar(s, X0, 7.72, CW, "추진 방안: 48개월 단계별 개발과 검증");
  const st = [["1", "착수와 분석", "요구사항 확정"], ["2", "설계", "구조와 화면 설계"], ["3", "구현 1차", "제어와 화면 핵심"], ["4", "구현 2차와 통합", "AI, 기록, 보안"], ["5", "인수 시험", "공장과 현장 시험"], ["6", "안정화와 준공", "시범 운용 지원"]];
  const sw = (CW - 0.5) / 6; st.forEach((t, i) => { const x = X0 + i * (sw + 0.1);
    s.addText([{ text: t[0] + "단계", options: { fontSize: 11, color: "FFD27A", breakLine: true } }, { text: t[1], options: { fontSize: 13.5, bold: true, breakLine: true } }, { text: t[2], options: { fontSize: 10.5 } }], { x, y: 8.32, w: sw, h: 1.0, shape: p.ShapeType.homePlate, fill: { color: i < 4 ? C.navy2 : C.green }, fontFace: F, color: "FFFFFF", align: "center", valign: "middle" }); });
  s.addText([{ text: "건의  ", options: { bold: true, color: "FFD27A" } }, { text: "EMS 중앙제어를 전력화 소요에 반영하고, 실장비 연동 시험으로 작전 성능을 확정할 것을 건의함", options: { color: "FFFFFF" } }], { x: X0, y: 9.48, w: CW, h: 0.72, shape: p.ShapeType.roundRect, rectRadius: 0.06, fill: { color: C.navy }, fontFace: F, fontSize: 15, bold: true, align: "center", valign: "middle" });
  s.addText("수치는 시뮬레이터와 합성 자료에서 측정한 값임. 선택 차단, 절체 등 보호 동작은 보호 및 배전 자동화 장치가 수행하며 EMS 는 감시와 지령을 담당함. 현장 사진은 개념도(생성 이미지)임", { x: X0, y: 10.3, w: CW, h: 0.6, fontFace: F, fontSize: 9.5, color: C.gray, valign: "top" }); }

p.writeFile({ fileName: OUT }).then(f => console.log("saved", f));
