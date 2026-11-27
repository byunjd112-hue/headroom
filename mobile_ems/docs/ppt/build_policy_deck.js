// 이동형 EMS 정책 설명 자료(군 대상, 16:9 3장). 글은 모두 편집 가능한 글상자, 그림은 EMS 화면의 장비 실사 그림과 화면 캡처, 현장 사진(생성 이미지 — 개념도).
// 문서 작성 공통 규칙: 줄표 · 가운뎃점으로 잇지 않는다, 간결한 개조식. 수치는 측정 파일에서 읽는다(시뮬레이터 검증값이라고 밝힌다).
// 실행: NODE_PATH=docs/ppt/node_modules node docs/ppt/build_policy_deck.js <출력.pptx>
const fs = require("fs"), path = require("path"), pptxgen = require("pptxgenjs");
const ROOT = path.join(__dirname, "..", ".."), J = f => JSON.parse(fs.readFileSync(path.join(ROOT, "docs", f), "utf8"));
const ST = J("static_results.json"), TR = J("test_results.json"), SC = J("scenario_results.json"), BM = J("forecast_benchmark.json"), CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/runtime.json"), "utf8"));
const OUT = process.argv[2] || path.join(ROOT, "IFPS_EMS_정책설명자료.pptx");
const IMG = n => path.join(__dirname, "img", n), PH = n => path.join(ROOT, "ifps_ems_rt/hmi/static/photos", n), PO = n => path.join(__dirname, "img", "policy", n);
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, mx = a => Math.max(...a);
const nmae = tg => mean(BM.runs.map(r => r.targets[tg].enhanced["24h"].nmae_pct)).toFixed(1);
const W = 13.333, H = 7.5, F = "맑은 고딕";
const C = { navy: "0F2A52", navy2: "1D4E89", sky: "2F6DB5", green: "1F7A4D", teal: "2E6B5E", red: "B3261E", orange: "E07B00", ink: "111111", gray: "5A5A5A", line: "C9D3E0", gold: "FFD27A" };
const p = new pptxgen(); p.defineLayout({ name: "WIDE", width: W, height: H }); p.layout = "WIDE"; p.title = "이동형 EMS 정책 설명 자료";
const TABS = ["01. 필요성", "02. 체계 구성과 운용", "03. 작전 성능과 추진"], X0 = 3.15, CW = 9.95, S = p.ShapeType;
const T = (s, t, x, y, w, h, o) => s.addText(t, Object.assign({ x, y, w, h, fontFace: F, fontSize: 9, color: C.ink, valign: "middle", margin: 2 }, o));
const R = (s, x, y, w, h, fill, o) => s.addShape(S.rect, Object.assign({ x, y, w, h, fill: typeof fill === "string" ? { color: fill } : fill }, o));
const box = (s, x, y, w, h, o) => s.addShape(S.roundRect, Object.assign({ x, y, w, h, rectRadius: 0.04, fill: { color: "FFFFFF", transparency: 4 }, line: { color: C.line, width: 0.75 }, shadow: { type: "outer", color: "8090A8", opacity: 0.25, blur: 3, offset: 1.5, angle: 90 } }, o));
const pic = (s, f, x, y, w, h) => s.addImage({ path: f, x, y, w, h, sizing: { type: "cover", w, h } });
const bar = (s, x, y, w, t, col, sub) => { R(s, x, y, w, 0.32, col || C.navy2); R(s, x, y, 0.07, 0.32, C.gold);
  T(s, sub ? [{ text: t, options: { bold: true } }, { text: "   " + sub, options: { fontSize: 8.5, color: "D6E0EE" } }] : t, x + 0.14, y, w - 0.2, 0.32, { fontSize: 11.5, bold: !sub, color: "FFFFFF" }); };
const icon = (s, x, y, d, shape, col) => { s.addShape(S.ellipse, { x, y, w: d, h: d, fill: { color: col }, line: { color: "FFFFFF", width: 1.5 } }); s.addShape(shape, { x: x + d * 0.24, y: y + d * 0.24, w: d * 0.52, h: d * 0.52, fill: { color: "FFFFFF" }, line: { color: "FFFFFF", width: 0 } }); };
const list = (s, items, x, y, w, h, mark, fs_) => T(s, items.map((t, i) => ({ text: mark + " " + t, options: { breakLine: i < items.length - 1 } })), x, y, w, h, { fontSize: fs_ || 8.8, lineSpacingMultiple: 1.18 });
const quote = (s, y, a, b, c) => T(s, [{ text: "“ " + a, options: { color: C.ink } }, { text: b, options: { color: C.green } }, { text: c + " ”", options: { color: C.ink } }], X0, y, CW, 0.4, { fontSize: 15, bold: true, align: "center" });
function card(s, f, x, y, w, h, ih, t, sub, ic) { box(s, x, y, w, h); pic(s, f, x + 0.04, y + 0.04, w - 0.08, ih);
  if (ic) icon(s, x + w / 2 - 0.19, y + ih - 0.15, 0.38, ic[0], ic[1]);
  T(s, t, x, y + ih + (ic ? 0.24 : 0.06), w, 0.24, { fontSize: 10.5, bold: true, color: C.navy, align: "center" });
  T(s, sub, x + 0.04, y + ih + (ic ? 0.47 : 0.29), w - 0.08, h - ih - (ic ? 0.5 : 0.32), { fontSize: 8, align: "center", valign: "top", lineSpacingMultiple: 1.1 }); }

function frame(n, label, h1, h2, en, lead, foot) {
  const s = p.addSlide(); s.background = { color: "FFFFFF" };
  pic(s, PO("sky.jpg"), 0, 0, W, H); R(s, 0, 0, W, H, { color: "FFFFFF", transparency: 30 }); R(s, 0, 0.5, 3.0, H - 0.92, { color: "FFFFFF", transparency: 35 });
  R(s, 0, 0, W, 0.5, C.navy); R(s, 0, 0.5, W, 0.03, C.gold);
  TABS.forEach((t, i) => { T(s, t, 3.3 + i * 2.2, 0.06, 2.1, 0.38, { fontSize: 10.5, bold: i === n - 1, color: i === n - 1 ? C.gold : "C9D6E8", align: "center" }); if (i === n - 1) R(s, 3.65 + i * 2.2, 0.42, 1.4, 0.04, C.gold); });
  // 육군 로고 자리: 공식 파일을 받지 못해 자리만 둔다(공식 그림으로 바꿔 넣는다)
  s.addShape(S.ellipse, { x: 10.55, y: 0.07, w: 0.36, h: 0.36, fill: { color: C.navy2 }, line: { color: C.gold, width: 1.25 } }); T(s, "로고", 10.55, 0.07, 0.36, 0.36, { fontSize: 6, color: "FFFFFF", align: "center", margin: 0 });
  T(s, [{ text: "대한민국 육군", options: { fontSize: 11.5, bold: true, breakLine: true } }, { text: "Republic of Korea Army", options: { fontSize: 6.5 } }], 10.95, 0.04, 1.35, 0.42, { color: "FFFFFF" });
  T(s, "이동형 전력체계 EMS", 12.2, 0.04, 1.05, 0.42, { fontSize: 7, color: "C9D6E8", align: "right" });
  T(s, "0" + n, 0.28, 0.6, 2.4, 1.0, { fontFace: "Arial Black", fontSize: 64, bold: true, color: C.teal, margin: 0 });
  T(s, label, 0.3, 1.58, 2.6, 0.32, { fontSize: 15, bold: true }); R(s, 0.33, 1.92, 0.6, 0.045, C.orange);
  T(s, [{ text: h1, options: { color: C.ink, breakLine: true } }, { text: h2, options: { color: C.green } }], 0.3, 2.05, 2.75, 0.95, { fontSize: 20.5, bold: true, valign: "top" });
  T(s, en, 0.32, 3.02, 2.7, 0.22, { fontFace: "Arial", fontSize: 6.3, color: C.gray, charSpacing: 1.5 });
  T(s, lead, 0.3, 3.26, 2.65, 1.1, { fontSize: 9.5, valign: "top", lineSpacingMultiple: 1.22 });
  pic(s, PO("soldier.jpg"), 0, 4.42, 2.95, 2.66); R(s, 0, 4.42, 2.95, 0.03, C.gold);
  R(s, 0, H - 0.42, W, 0.42, C.navy); R(s, 0, H - 0.45, W, 0.03, C.gold);
  [["작전지속능력 강화", S.lightningBolt], ["피탐 위험 감소", S.moon], ["연료와 인력 절감", S.gear6], ["무정전 전력 공급", S.plus]].forEach((t, i) => { icon(s, 0.35 + i * 2.25, H - 0.35, 0.28, t[1], C.sky); T(s, t[0], 0.68 + i * 2.25, H - 0.42, 1.9, 0.42, { fontSize: 9, color: "FFFFFF" }); });
  T(s, foot, 9.3, H - 0.42, 3.9, 0.42, { fontSize: 9.5, bold: true, color: C.gold, align: "right" });
  return s;
}

/* ───────── 1. 필요성 */
{ const s = frame(1, "필요성", "전력이 끊기면", "작전도 멈춘다", "WITHOUT POWER, THE MISSION STOPS", "지휘통제, 통신, 감시, 의무 시설은\n전력이 끊기는 순간 기능을 잃음.\n전원이 늘어난 만큼 이를 하나로\n묶어 통제하는 체계가 필요함.", "전력 통제가 곧 작전지속능력");
  bar(s, X0, 0.62, CW, "변화하는 전장: 전력 수요는 늘고, 전력 중단의 대가는 커짐");
  const cw = (CW - 0.4) / 5; [["cp.jpg", "지휘통제 고도화", "상황 공유와 지휘 결심이\n전력에 의존", S.star5, C.navy2], ["comms.jpg", "통신과 감시 확대", "위성, 전술통신, 감시 장비의\n무중단 전원 필요", S.lightningBolt, C.sky], ["drone.jpg", "무인체계 운용", "드론과 로봇의\n충전 전력 수요 증가", S.gear6, C.teal], ["medic.jpg", "의무와 생존 지원", "순간 정전도\n허용되지 않는 부하", S.plus, C.red], ["garrison.jpg", "장기 주둔과 정비", "연료 소모의\n대부분을 차지", S.sun, C.orange]]
    .forEach((c, i) => card(s, PO(c[0]), X0 + i * (cw + 0.1), 1.0, cw, 1.98, 1.05, c[1], c[2], [c[3], c[4]]));
  quote(s, 3.0, "전원이 여럿이어도 ", "통제가 하나", "여야 작전이 이어짐");
  const chips = [["작전지속능력", S.lightningBolt, C.navy2], ["생존성 향상", S.moon, C.teal], ["군수 부담 경감", S.gear6, C.orange], ["지휘통제 무중단", S.star5, C.sky], ["재생에너지 활용", S.sun, C.green]], chw = CW / 5;
  chips.forEach((c, i) => { icon(s, X0 + i * chw + 0.25, 3.44, 0.3, c[1], c[2]); T(s, c[0], X0 + i * chw + 0.6, 3.42, chw - 0.65, 0.34, { fontSize: 9.5, bold: true, color: C.navy }); });
  const hw = (CW - 0.36) / 2, y = 3.86, bh = 2.82, x2 = X0 + hw + 0.36;
  box(s, X0, y, hw, bh, { line: { color: C.red, width: 1.25 } }); bar(s, X0, y, hw, "현재", C.red, "발전기별 개별 운용의 한계");
  pic(s, PO("legacy.jpg"), X0 + 0.08, y + 0.4, 1.95, 1.0); pic(s, PO("convoy.jpg"), X0 + 0.08, y + 1.44, 1.95, 0.86);
  list(s, ["발전기마다 운용 인원 배치", "1대 고장 시 해당 시설 정전", "소음과 열로 위치 노출", "연료 보급 수송 부담", "태양광, ESS 연계 불가", "부하 우선순위 통제 불가"], X0 + 2.12, y + 0.4, hw - 2.2, 1.9, "✕", 9.3);
  T(s, "전원이 늘수록 운용 부담과 취약점이 함께 늘어남", X0 + 0.08, y + 2.37, hw - 0.16, 0.37, { fontSize: 10, bold: true, color: C.red, align: "center", fill: { color: "FBEDEC" } });
  s.addShape(S.rightArrow, { x: X0 + hw + 0.04, y: y + 1.1, w: 0.28, h: 0.5, fill: { color: C.navy2 }, line: { color: C.navy2, width: 0 } });
  box(s, x2, y, hw, bh, { line: { color: C.navy2, width: 1.25 } }); bar(s, x2, y, hw, "도입 후", C.navy2, "EMS 가 전원 전체를 통합 통제");
  pic(s, PO("field.jpg"), x2 + 0.08, y + 0.4, 1.95, 1.0); pic(s, PO("console.jpg"), x2 + 0.08, y + 1.44, 1.95, 0.86);
  list(s, ["화면 1개로 전체 감시와 지령", "고장 시 대체 전원 자동 기동", "저소음 태세에서 디젤 정지", "예측 기반 연료, 충전 계획", "다종 전원 통합 운용", "부하 등급별 우선 공급"], x2 + 2.12, y + 0.4, hw - 2.2, 1.9, "✓", 9.3);
  T(s, "전원이 늘수록 여유와 생존성이 함께 늘어남", x2 + 0.08, y + 2.37, hw - 0.16, 0.37, { fontSize: 10, bold: true, color: C.navy, align: "center", fill: { color: "EAF1FA" } });
  T(s, "현장 사진은 이해를 돕기 위한 개념도(생성 이미지)임", X0, 6.72, CW, 0.22, { fontSize: 6.5, color: C.gray, align: "right" }); }

/* ───────── 2. 체계 구성과 운용 */
{ const s = frame(2, "체계 구성과 운용", "모든 전원을", "화면 하나로 통제", "ONE SCREEN, ALL POWER SOURCES", "차량형 전원 4종과 배전 장비를\nEMS 가 통신으로 연결함.\n장비를 연결하면 자동으로 인식하여\n화면을 스스로 구성함.", "연결하면 인식하고, 인식하면 통제함");
  bar(s, X0, 0.62, CW, "체계 구성", C.navy2, "이동형 전원 4종, 배전 장비, EMS 중앙제어");
  const eq = [["dg.jpg", "① 기동형 복합전력", "발전기 90 kW, ESS 200 kWh"], ["ess.jpg", "② 이동형 ESS", "1000 kWh, 500 kW"], ["pv.jpg", "③ 이동형 태양광", "400 kWp(80 kWp × 5)"], ["fc.jpg", "④ 수소 생성 및 발전", "연료전지 100 kW"], ["dist.jpg", "⑥ 배전 및 변압", "모선 A, B, 연계 차단기"], ["fsu.jpg", "구간분전함", "환망 구성, 부하 직전 배전"]];
  const ew = (CW - 0.5) / 6; eq.forEach((e, i) => { const x = X0 + i * (ew + 0.1); box(s, x, 1.0, ew, 1.42); pic(s, PH(e[0]), x + 0.04, 1.04, ew - 0.08, 0.86);
    T(s, e[1], x, 1.92, ew, 0.23, { fontSize: 9, bold: true, color: C.navy, align: "center" }); T(s, e[2], x, 2.14, ew, 0.24, { fontSize: 7.5, align: "center" }); });
  R(s, X0, 2.5, CW, 0.27, C.navy); icon(s, X0 + 0.08, 2.52, 0.23, S.lightningBolt, C.sky);
  T(s, [{ text: "통신 연결  ", options: { bold: true, color: C.gold } }, { text: "이중 경로 통신으로 전 장비를 EMS 에 연결. 연결하면 종류와 수량을 자동 인식. 정격은 설계 표준안이며 제작사 제원으로 확정", options: { color: "FFFFFF" } }], X0 + 0.36, 2.5, CW - 0.4, 0.27, { fontSize: 8.3 });
  const lw = 5.95, y = 2.87, bh = 3.82; box(s, X0, y, lw, bh, { line: { color: C.navy2, width: 1.25 } }); bar(s, X0, y, lw, "⑤ EMS 중앙제어 운용 화면", C.navy2, "실제 화면");
  pic(s, IMG("overview.jpg"), X0 + 0.08, y + 0.4, 3.95, 2.22); T(s, "운전 개요: 전원, 부하, 경보를 한눈에", X0 + 0.08, y + 2.62, 3.95, 0.2, { fontSize: 7.5, bold: true, color: C.navy, align: "center" });
  [["fleet_sld.jpg", "단선 결선도"], ["ring_ok.jpg", "환망 배전 감시"], ["energy.jpg", "예측과 운전계획"]].forEach((t, i) => { const yy = y + 0.4 + i * 1.13; pic(s, IMG(t[0]), X0 + 4.12, yy, 1.74, 0.93); R(s, X0 + 4.12, yy + 0.75, 1.74, 0.18, { color: C.navy, transparency: 15 }); T(s, t[1], X0 + 4.12, yy + 0.75, 1.74, 0.18, { fontSize: 7.3, bold: true, color: "FFFFFF", align: "center", margin: 0 }); });
  pic(s, PH("ems.jpg"), X0 + 0.08, y + 2.86, 1.25, 0.88); list(s, ["전체 전원과 부하 상태를 한 화면에 표시", "선택 후 실행 2단계 지령으로 오조작 방지", "경보 발생 시 조치 방법을 함께 안내"], X0 + 1.4, y + 2.86, 2.65, 0.88, "✓", 8.3);
  const rx = X0 + lw + 0.12, rw = CW - lw - 0.12; box(s, rx, y, rw, bh, { line: { color: C.green, width: 1.25 } }); bar(s, rx, y, rw, "운용 개념", C.green, "장소와 태세별 자동 운전");
  [["field.jpg", "평시", C.navy2, "작전지: 태양광과 ESS 우선, 부족 시 디젤 자동 기동", "주둔지: 상전 수전 최소화, 피크 억제"], ["night.jpg", "저소음", C.green, `작전지: 디젤 정지, ${CFG.quiet_target_h}시간 유지 목표`, "주둔지: 디젤 정지, ESS 와 수전으로 운전"], ["garrison.jpg", "자립", C.orange, "작전지: 목표 시간 유지, 3등급부터 절감 공급", "주둔지: 상전 상실 가정, 정전 논리로 전환"]].forEach((t, i) => { const yy = y + 0.4 + i * 0.82;
    pic(s, PO(t[0]), rx + 0.08, yy, 1.1, 0.74); R(s, rx + 0.08, yy, 0.55, 0.2, t[2]); T(s, t[1], rx + 0.08, yy, 0.55, 0.2, { fontSize: 8, bold: true, color: "FFFFFF", align: "center", margin: 0 });
    T(s, [{ text: t[3], options: { breakLine: true } }, { text: t[4] }], rx + 1.24, yy, rw - 1.3, 0.74, { fontSize: 8.2, lineSpacingMultiple: 1.2 }); });
  R(s, rx + 0.08, y + 2.88, rw - 0.16, 0.012, C.line);
  list(s, ["1등급 부하(지휘통제, 의무)는 차단 대상에서 제외", "전력 부족 시 3등급부터 절감 후 순차 차단", "환망 한 구간 단선 시 반대쪽에서 공급 유지"], rx + 0.08, y + 2.93, rw - 0.16, 0.82, "✓", 8.3); }

/* ───────── 3. 작전 성능과 추진 */
{ const s = frame(3, "작전 성능과 추진", "조용히, 오래,", "끊김 없이", "QUIET, ENDURING, UNINTERRUPTED", "소음과 연료를 줄이고 정전을 막는\n것이 EMS 의 작전 성능임.\n수치는 시뮬레이터 검증 결과이며\n실장비 시험에서 확정함.", "검증된 설계를 전력화로 연결");
  bar(s, X0, 0.62, CW, "작전 성능", C.navy2, "무엇이 좋아지는가");
  const k = [["저소음 지속 목표", `${CFG.quiet_target_h}시간`, "디젤 정지 상태 유지\n부족 시 3등급부터 절감", C.green, S.moon], ["고장 감지 시간", `${mx(TR.comm_lost_s).toFixed(1)}초`, "통신 두절 판정 후\n대체 전원 자동 기동", C.navy2, S.lightningBolt], ["지령 응답", `${mx(TR.sbo_ack_s).toFixed(2)}초`, "선택 후 실행 지령의\n수용 응답 시간", C.sky, S.star5],
    ["24시간 예측 오차", `${nmae("load")} %`, `부하 기준, 태양광 ${nmae("pv")} %\n합성 자료로 검증`, C.teal, S.sun], ["무정전 구성", "N-1", "전원 1대 상실에도\n1, 2등급 부하 공급", C.green, S.plus], ["운용 통제", "화면 1개", "전원별 배치 대신\n중앙 통제", C.orange, S.gear6]];
  const kw = (CW - 0.5) / 6; k.forEach((t, i) => { const x = X0 + i * (kw + 0.1); box(s, x, 1.0, kw, 1.28); R(s, x, 1.0, kw, 0.06, t[3]); icon(s, x + 0.07, 1.11, 0.26, t[4], t[3]);
    T(s, t[0], x + 0.34, 1.1, kw - 0.36, 0.28, { fontSize: 8.5, bold: true, color: C.gray }); T(s, t[1], x, 1.38, kw, 0.42, { fontSize: 19, bold: true, color: t[3], align: "center" });
    T(s, t[2], x + 0.03, 1.8, kw - 0.06, 0.44, { fontSize: 7.5, align: "center", valign: "top", lineSpacingMultiple: 1.1 }); });
  quote(s, 2.3, "소음을 줄이면 ", "생존성", "이, 연료를 줄이면 지속능력이 올라감");
  bar(s, X0, 2.74, CW, "작전 효과", C.green, "현장에서 달라지는 것");
  const fw = (CW - 0.3) / 4; [["night.jpg", "피탐 위험 감소", "야간 디젤 정지로\n소음과 열 노출 감소"], ["convoy.jpg", "보급 부담 경감", "재생에너지 우선 사용으로\n연료 수송 소요 감소"], ["cp.jpg", "지휘통제 무중단", "전원 1대 상실에도\n1등급 부하 전력 유지"], ["field.jpg", "전개 시간 단축", "설치 직후 자동 점검과\n장비 자동 인식"]]
    .forEach((c, i) => card(s, PO(c[0]), X0 + i * (fw + 0.1), 3.12, fw, 1.62, 0.88, c[1], c[2]));
  const vw = 4.3, y = 4.84; box(s, X0, y, vw, 1.2, { line: { color: C.navy2, width: 1.25 } }); bar(s, X0, y, vw, "검증 현황", C.navy2, "참조 구현 기준");
  [[`${ST.n_tests}건`, "자동 시험 통과"], [`${SC.total}건`, "운영 시나리오 검증"], [`${TR.soak.overruns}건`, "300회 연속 운전 지연"], ["FMEA", "고장모드와 시나리오 연결"]].forEach((t, i) => { const w = (vw - 0.12) / 4, x = X0 + 0.06 + i * w;
    T(s, t[0], x, y + 0.38, w, 0.4, { fontSize: 15, bold: true, color: C.navy2, align: "center" }); T(s, t[1], x, y + 0.78, w, 0.36, { fontSize: 7.3, align: "center", valign: "top" }); });
  const px = X0 + vw + 0.12, pw = CW - vw - 0.12; box(s, px, y, pw, 1.2, { line: { color: C.green, width: 1.25 } }); bar(s, px, y, pw, "추진 방안", C.green, "48개월 단계별 개발과 검증");
  const st = [["1", "착수와 분석"], ["2", "설계"], ["3", "구현 1차"], ["4", "구현 2차, 통합"], ["5", "인수 시험"], ["6", "안정화, 준공"]], sw = (pw - 0.12) / 6;
  st.forEach((t, i) => T(s, [{ text: t[0] + "단계", options: { fontSize: 6.8, color: C.gold, breakLine: true } }, { text: t[1], options: { fontSize: 7.8, bold: true } }], px + 0.06 + i * sw, y + 0.42, sw + 0.06, 0.68, { shape: S.homePlate, fill: { color: i < 4 ? C.navy2 : C.green }, line: { color: "FFFFFF", width: 1 }, color: "FFFFFF", align: "center", margin: 0 }));
  T(s, [{ text: "건의   ", options: { bold: true, color: C.gold } }, { text: "EMS 중앙제어를 전력화 소요에 반영하고, 실장비 연동 시험으로 작전 성능을 확정할 것을 건의함", options: { color: "FFFFFF" } }], X0, 6.12, CW, 0.38, { fontSize: 10.5, bold: true, align: "center", fill: { color: C.navy } });
  T(s, "수치는 시뮬레이터와 합성 자료에서 측정한 값임. 보호 동작(선택 차단, 절체)은 보호 및 배전 자동화 장치가 수행하며 EMS 는 감시와 지령을 담당함. 현장 사진은 개념도(생성 이미지)임", X0, 6.55, CW, 0.4, { fontSize: 6.5, color: C.gray, valign: "top" }); }

p.writeFile({ fileName: OUT }).then(f => console.log("saved", f));
