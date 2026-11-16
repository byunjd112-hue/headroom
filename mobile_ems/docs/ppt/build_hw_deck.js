// IFPS 이동형 EMS 하드웨어 구성 기술자료 (보고자료와 같은 발표 양식). 그림은 docs/ppt/img/hw_*.jpg (AI 생성 개념도)
// node build_hw_deck.js [Rev] [작성 연월] [출력.pptx]   — 보통은 docs/build_all.py 가 부른다
// 양식·구성 요소(머리띠, 카드, 표 등)는 build_deck.js 와 같은 것을 쓴다. 양식을 고치면 두 파일을 함께 고친다.
const fs = require("fs"), path = require("path"); const pptxgen = require("pptxgenjs");
const { applyTheme } = require("./apply_theme.js");
const EMS = path.join(__dirname, "..", ".."); const REV = process.argv[2] || "Rev00", YM = process.argv[3] || "2026. 11.";
const OUT = process.argv[4] || path.join(EMS, "docs", "out", `IFPS_EMS_하드웨어구성_기술자료_${REV}.pptx`); const IMG = n => path.join(__dirname, "img", n + ".jpg");
const THEME = { name: "IFPS 제안 발표", headFontFace: "맑은 고딕", bodyFontFace: "맑은 고딕",
  colors: { dk1: "2B2723", lt1: "FFFFFF", dk2: "35302A", lt2: "F9F1E6", accent1: "B59F76", accent2: "7B674F", accent3: "8A7449", accent4: "E0D7C8", accent5: "6F6B68", accent6: "B0392B", hlink: "8A7449", folHlink: "6F6B68" } };
const pres = new pptxgen(); pres.layout = "LAYOUT_WIDE"; pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "IFPS 이동형 EMS 하드웨어 구성 기술자료"; pres.author = "한화에어로스페이스㈜ 에너지솔루션사업센터"; pres.company = "한화에어로스페이스㈜"; pres.subject = "EMS 하드웨어 기술자료";
const C = pres.SchemeColor, INK = C.text1, DARK = C.text2, CREAM = C.background2, TAN = C.accent1, BROWN = C.accent2, GOLD = C.accent3, LINE = C.accent4, GRAY = C.accent5, RED = C.accent6, WHITE = C.background1;
const HX = THEME.colors;                                    // 표 테두리·그림자 등 hex 만 받는 곳
const mx = a => Math.max(...a.filter(x => x !== null)), f2 = x => Number(x).toFixed(2), f1 = x => Number(x).toFixed(1);

// ── 레이아웃
pres.defineSlideMaster({ title: "COVER", background: { path: path.join(__dirname, "bg1.jpg") },
  objects: [{ rect: { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: "1B1713", transparency: 45 } } }, { rect: { x: 0.9, y: 2.05, w: 0.07, h: 1.85, fill: { color: TAN } } },
    { placeholder: { options: { name: "kicker", type: "body", x: 1.2, y: 2.0, w: 9, h: 0.35, fontSize: 13, bold: true, color: TAN, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 1.2, y: 2.42, w: 11, h: 0.85, fontSize: 40, bold: true, color: WHITE, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "en", type: "body", x: 1.2, y: 3.28, w: 11, h: 0.4, fontSize: 15, color: "D8CBB4", margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "tag", type: "body", x: 1.2, y: 3.95, w: 11, h: 0.35, fontSize: 12.5, bold: true, color: "E9DFC9", margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "org", type: "body", x: 1.2, y: 6.4, w: 9, h: 0.35, fontSize: 11.5, color: "C9BCA4", margin: 0, valign: "middle" }, text: "" } }] });
pres.defineSlideMaster({ title: "CLOSING", background: { path: path.join(__dirname, "bg23.jpg") },
  objects: [{ rect: { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: "17130F", transparency: 22 } } }, { rect: { x: 1.3, y: 4.1, w: 2.2, h: 0.05, fill: { color: TAN } } },
    { placeholder: { options: { name: "title", type: "title", x: 1.3, y: 2.2, w: 11.55, h: 1.7, fontSize: 36, bold: true, color: WHITE, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "sub", type: "body", x: 1.3, y: 4.35, w: 11, h: 0.4, fontSize: 14, color: "D8CBB4", margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "org", type: "body", x: 1.3, y: 5.5, w: 8, h: 0.45, fontSize: 17, bold: true, color: WHITE, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "date", type: "body", x: 1.3, y: 5.98, w: 8, h: 0.3, fontSize: 11, color: "B8AB94", margin: 0, valign: "middle" }, text: "" } }] });
pres.defineSlideMaster({ title: "CONTENT", background: { color: "FFFFFF" }, margin: [0.5, 0.5, 0.6, 0.5],
  objects: [{ rect: { x: 0, y: 0, w: 13.333, h: 0.62, fill: { color: DARK } } }, { rect: { x: 0.45, y: 0.11, w: 0.42, h: 0.4, fill: { color: TAN } } },
    { text: { text: "한화에어로스페이스  |  이동형 EMS 하드웨어 구성 기술자료", options: { x: 0.45, y: 7.05, w: 7, h: 0.3, fontSize: 8.5, color: GRAY, margin: 0, valign: "middle" } } },
    { placeholder: { options: { name: "secno", type: "body", x: 0.45, y: 0.11, w: 0.42, h: 0.4, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "sec", type: "body", x: 0.98, y: 0.07, w: 6.5, h: 0.28, fontSize: 16, bold: true, color: WHITE, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "secen", type: "body", x: 1.0, y: 0.34, w: 6.5, h: 0.22, fontSize: 9, bold: true, color: TAN, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.78, w: 12.3, h: 0.4, fontSize: 21, bold: true, color: INK, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "sub", type: "body", x: 0.5, y: 1.2, w: 12.3, h: 0.32, fontSize: 12.5, bold: true, color: GOLD, margin: 0, valign: "middle", align: "left" }, text: "" } }],
  slideNumber: { x: 11.83, y: 7.05, w: 1.05, h: 0.3, fontSize: 9.5, bold: true, color: GRAY, align: "right" } });

// ── 구성 요소
const REMAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
const SECS = [["개요", "OVERVIEW"], ["구성", "CONFIGURATION"], ["기구 설계", "MECHANICAL DESIGN"], ["EMP · 전원", "EMP PROTECTION & POWER"], ["연산 · 통신", "COMPUTING & NETWORK"], ["WBS", "WORK BREAKDOWN STRUCTURE"], ["시험 · 과제", "VERIFICATION & OPEN ISSUES"]];
let curSec = 0, sub = 0;
function page(sec, title, subtitle, notes) {
  sec = REMAP[sec];
  if (sec !== curSec) { curSec = sec; sub = 0; pres.addSection({ title: `${sec}. ${SECS[sec - 1][0]}` }); } sub++;
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: `${sec}. ${SECS[sec - 1][0]}` });
  s.addText(String(sec), { placeholder: "secno" }); s.addText(SECS[sec - 1][0], { placeholder: "sec" }); s.addText(SECS[sec - 1][1], { placeholder: "secen" });
  s.addText(`${sec}-${sub}.  ${title}`, { placeholder: "title" }); s.addText(subtitle, { placeholder: "sub" }); if (notes) s.addNotes(notes); return s;
}
const T = (s, text, o) => s.addText(text, Object.assign({ isTextBox: true, margin: 0, color: INK, fontSize: 12, valign: "top" }, o));
function card(s, x, y, w, h, title, body, o = {}) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: o.fill || CREAM }, line: { color: LINE, width: 1 }, objectName: "카드 " + title });
  T(s, title, { x: x + 0.16, y: y + 0.1, w: w - 0.32, h: 0.28, fontSize: o.ts || 14, bold: true, color: o.tc || DARK, valign: "middle" });
  if (body) T(s, body, { x: x + 0.16, y: y + 0.42, w: w - 0.32, h: h - 0.5, fontSize: o.bs || 12, color: o.bc || INK, paraSpaceAfter: 3 });
}
function stat(s, x, y, w, h, label, value, unit) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "수치 " + label });
  T(s, label, { x, y: y + 0.09, w, h: 0.26, fontSize: 12, color: "EFE6D8", align: "center", valign: "middle" });
  T(s, [{ text: value, options: { fontSize: 26, bold: true, color: WHITE } }, { text: unit ? " " + unit : "", options: { fontSize: 13, color: "F0E4CE" } }], { x, y: y + 0.36, w, h: h - 0.44, align: "center", valign: "middle" });
}
function tag(s, x, y, text, w) {
  w = w || 0.3 + text.length * 0.17; s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.28, rectRadius: 0.05, fill: { color: GOLD }, line: { color: GOLD, width: 1 }, objectName: "꼬리표 " + text });
  T(s, text, { x, y, w, h: 0.28, fontSize: 11, bold: true, color: WHITE, align: "center", valign: "middle" });
}
function table(s, x, y, w, head, rows, colW, o = {}) {
  const bd = { type: "solid", pt: 0.75, color: HX.accent4 }, fs = o.fs || 11;
  const cell = (t, hd, i) => ({ text: String(t), options: { fontSize: fs, bold: hd || (o.bold || []).includes(i), color: hd ? WHITE : INK, fill: { color: hd ? BROWN : (o.zebra && false ? CREAM : WHITE) }, align: hd || (o.center || []).includes(i) ? "center" : "left", valign: "middle", border: [bd, bd, bd, bd], margin: [0.03, 0.08, 0.03, 0.08] } });
  const sum = colW.reduce((a, b) => a + b, 0);
  s.addTable([head.map((h, i) => cell(h, true, i))].concat(rows.map(r => r.map((c, i) => cell(c, false, i)))), { x, y, w, colW: colW.map(c => c / sum * w), rowH: o.rowH || 0.3, objectName: o.name || "표" });
}
// 화면 그림 + 번호 표식(px 좌표는 1920×1080 기준)
function shot(s, name, x, y, w, marks = [], srcW = 1920, srcH = 1080) {
  const h = w * srcH / srcW; s.addImage({ path: IMG(name), x, y, w, h, altText: "화면: " + name, objectName: "화면 " + name });
  s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { type: "none" }, line: { color: LINE, width: 1 }, objectName: "화면 테두리" });
  marks.forEach(([n, px, py]) => { const cx = x + px / srcW * w, cy = y + py / srcH * h, d = 0.27;
    s.addShape(pres.ShapeType.ellipse, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: TAN }, line: { color: WHITE, width: 1.25 }, objectName: "표식 " + n });
    T(s, String(n), { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fontSize: 10.5, bold: true, color: WHITE, align: "center", valign: "middle" }); });
  return h;
}
// 번호 설명 목록
function legend(s, x, y, w, items, o = {}) {
  const rh = o.rh || 0.72, gap = o.gap === undefined ? 0.1 : o.gap;
  items.forEach(([n, title, desc], i) => { const yy = y + i * (rh + gap);
    s.addShape(pres.ShapeType.roundRect, { x, y: yy, w, h: rh, rectRadius: 0.05, fill: { color: CREAM }, line: { color: LINE, width: 1 }, objectName: "설명 " + n });
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.12, y: yy + 0.11, w: 0.3, h: 0.3, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "번호 " + n });
    T(s, String(n), { x: x + 0.12, y: yy + 0.11, w: 0.3, h: 0.3, fontSize: 11, bold: true, color: WHITE, align: "center", valign: "middle" });
    T(s, title, { x: x + 0.52, y: yy + 0.07, w: w - 0.64, h: 0.26, fontSize: 12.5, bold: true, color: DARK, valign: "middle" });
    T(s, desc, { x: x + 0.52, y: yy + 0.33, w: w - 0.64, h: rh - 0.37, fontSize: 10.5, color: INK }); });
}
function note(s, x, y, w, h, title, lines) {                           // 흰 바탕 강조 상자(참고 PPT의 '해결 방향' 상자)
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05, fill: { color: WHITE }, line: { color: GOLD, width: 1.25 }, objectName: "강조 " + title });
  T(s, title, { x: x + 0.16, y: y + 0.08, w: w - 0.32, h: 0.28, fontSize: 13, bold: true, color: GOLD, valign: "middle" });
  T(s, lines.map((t, i) => ({ text: t, options: { breakLine: i < lines.length - 1 } })), { x: x + 0.16, y: y + 0.4, w: w - 0.32, h: h - 0.46, fontSize: 11.5, paraSpaceAfter: 3 });
}
function steps(s, x, y, w, h, items) {                                // 가로 절차(번호 상자 + 화살표)
  const n = items.length, gap = 0.22, bw = (w - gap * (n - 1)) / n;
  items.forEach(([title, desc], i) => { const xx = x + i * (bw + gap);
    s.addShape(pres.ShapeType.roundRect, { x: xx, y, w: bw, h, rectRadius: 0.05, fill: { color: CREAM }, line: { color: LINE, width: 1 }, objectName: "절차 " + (i + 1) });
    s.addShape(pres.ShapeType.rect, { x: xx, y, w: bw, h: 0.34, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "절차 머리 " + (i + 1) });
    T(s, `${i + 1}  ${title}`, { x: xx + 0.1, y, w: bw - 0.2, h: 0.34, fontSize: 12, bold: true, color: WHITE, valign: "middle" });
    T(s, desc, { x: xx + 0.1, y: y + 0.42, w: bw - 0.2, h: h - 0.48, fontSize: 10.5 });
    if (i < n - 1) T(s, "▶", { x: xx + bw, y: y + h / 2 - 0.12, w: gap, h: 0.24, fontSize: 9, color: GOLD, align: "center", valign: "middle" }); });
}

// 실사형 그림(AI 생성 개념도) + 설명 띠
function pic(s, name, x, y, w, cap) {
  const h = w * 688 / 1024; s.addImage({ path: IMG(name), x, y, w, h, altText: cap || name, objectName: "그림 " + name });
  s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { type: "none" }, line: { color: LINE, width: 1 }, objectName: "그림 테두리" });
  if (cap) T(s, cap + "  (개념도 · AI 생성)", { x, y: y + h + 0.04, w, h: 0.24, fontSize: 9, color: GRAY, valign: "middle" });
  return h;
}
const REF = "제품명은 참고 예시다. 사양·수급·국산화·단종 여부는 견적 단계에서 확인한다.";

// ═══ 표지 · 목차
pres.addSection({ title: "표지·목차" });
{ const s = pres.addSlide({ masterName: "COVER", sectionTitle: "표지·목차" });
  s.addText("IFPS · Integrated Field Power System", { placeholder: "kicker" }); s.addText("이동형 EMS 하드웨어 구성 기술자료", { placeholder: "title" });
  s.addText("Mobile EMS Hardware — Mechanical, Shock & Vibration, PLS Transport, EMP Protection", { placeholder: "en" });
  s.addText("쉘터 탑재형 구성  ·  이동·충격·진동·PLS 운용  ·  EMP/EMI 방호  ·  추천 제품 기준 WBS", { placeholder: "tag" });
  s.addText(`한화에어로스페이스㈜ 에너지솔루션사업센터   |   ${YM}   |   ${REV}`, { placeholder: "org" }); }
{ const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "표지·목차" });
  s.addText("", { placeholder: "secno" }); s.addText("목 차", { placeholder: "sec" }); s.addText("CONTENTS", { placeholder: "secen" }); s.addText("보고 순서", { placeholder: "title" }); s.addText("요구 조건 → 구성 → 기구 설계 → EMP·전원 → 연산·통신 → WBS → 시험·과제", { placeholder: "sub" });
  const D2 = ["운용 환경과 설계 요구, 적용 규격", "하드웨어 구성도와 쉘터 내부 배치", "PLS 적재·하역, 충격·진동 방진, 환경 대책", "EMP/EMI 방호 구성과 전원 계통", "서버 이중화, 제어망, 외부 접속반", "추천 제품을 참조한 하드웨어 분해 구조", "시험·검증 계획, FMEA 연계, 미결 사항"];
  SECS.forEach(([k, e], i) => { const x = 0.5 + (i % 4) * 3.1, y = 1.85 + Math.floor(i / 4) * 2.45;
    s.addShape(pres.ShapeType.roundRect, { x, y, w: 2.95, h: 2.2, rectRadius: 0.06, fill: { color: CREAM }, line: { color: LINE, width: 1 }, objectName: "목차 " + (i + 1) });
    s.addShape(pres.ShapeType.rect, { x, y, w: 2.95, h: 0.5, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "목차 머리 " + (i + 1) });
    T(s, `${i + 1}  ${k}`, { x: x + 0.14, y, w: 2.7, h: 0.5, fontSize: 15, bold: true, color: WHITE, valign: "middle" });
    T(s, e, { x: x + 0.14, y: y + 0.6, w: 2.7, h: 0.26, fontSize: 9, bold: true, color: GOLD, valign: "middle" }); T(s, D2[i], { x: x + 0.14, y: y + 0.92, w: 2.7, h: 1.2, fontSize: 12 }); });
  T(s, `이 자료는 EMS 소프트웨어 ${REV} 과 같은 리비전의 하드웨어 구성(안)이다. 수치와 제품은 설계 착수용 제안값이며 차량·쉘터 제원과 발주처 요구로 확정한다.`, { x: 0.5, y: 6.62, w: 12.33, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }

// ═══ 1. 개요
{ const s = page(1, "목적과 설계 방향", "노트북에서 검증한 EMS 를 야전에서 이동하며 쓸 수 있는 쉘터 탑재형 하드웨어로 — 이동·충격·진동·EMP 를 처음부터 고려",
    "EMS 소프트웨어는 노트북에서 검증했습니다. 이 자료는 그것을 야전에서 운용할 하드웨어 구성안입니다.");
  pic(s, "hw_pls", 0.5, 1.72, 6.0, "PLS 차량으로 적재·하역하는 EMS 쉘터");
  card(s, 6.75, 1.72, 6.08, 1.3, "구성 방향", "EMS 서버·제어망·전원·운용 콘솔을 EMI 차폐 쉘터 한 동에 넣고, PLS(팔레트 적재 체계) 차량의 플랫랙에 실어 이동한다. 내려놓은 뒤에는 외부 접속반에 전원·광케이블만 연결하면 운용할 수 있게 한다.", { bs: 11 });
  table(s, 6.75, 3.15, 6.08, ["고려 사항", "설계 대응"], [["이동 (PLS·철도·항공)", "ISO 규격 치수·모서리 쇠, 플랫랙 고박, 무게중심 관리"], ["충격·진동", "쉘터–랙–장비 3단계 방진, 러기드 장비, 풀림 방지 체결"], ["EMP·전자파", "차폐 쉘터, 관통부 필터·광케이블, 단일 접지점"], ["환경", "냉난방기, 방수·방진, 결로·염무 대책"], ["전원", "상전·발전기·차량 전원 입력, 무정전 전원"], ["신뢰성", "서버·제어망 이중화(FMEA 단일 고장점 해소)"]], [30, 70], { bold: [0], rowH: 0.33, fs: 10.5 });
  note(s, 6.75, 5.6, 6.08, 1.15, "전제", ["쉘터 크기와 EMP 방호 수준은 발주처 요구로 확정(7장)", "보호 차단·계통 형성은 장치가 수행 — EMS 고장이 곧 정전은 아님"]); }
{ const s = page(1, "운용 환경과 적용 규격", "어떤 조건을 견뎌야 하는지와 그것을 확인할 시험 규격 — 수준(등급·시험 조건)은 발주처 요구와 차량 제원으로 확정",
    "적용 규격은 미군 표준을 기준으로 잡았고, 국내 국방규격 적용 여부는 확인이 필요합니다.");
  table(s, 0.5, 1.72, 12.33, ["구분", "운용 조건", "적용 규격 (기준안)", "설계 반영"], [
    ["차량 이동 진동", "야지·비포장 주행 중 쉘터 탑재 상태", "MIL-STD-810H 시험법 514.8 (진동)", "방진 랙, 장비 고정, 커넥터 잠금, 케이블 고박"],
    ["충격", "PLS 적재·하역 착지, 험지 주행, 취급 낙하", "MIL-STD-810H 시험법 516.8 (충격)", "와이어로프 방진기, 러기드 서버·SSD, 여유 변위 확보"],
    ["철도 수송", "화차 연결 충격", "MIL-STD-810H 시험법 526.2 (철도 충격)", "전후 방향 고박 강도, 랙 전후 방진 행정"],
    ["온도·습도", "혹서·혹한 운용과 보관, 결로", "MIL-STD-810H 501.7 · 502.7 · 507.6", "냉난방기, 단열, 기동 전 예열, 방습 처리"],
    ["비·먼지·염무", "야외 설치, 강우·분진", "MIL-STD-810H 506.6 · 510.7 · 509.7", "출입문·접속반 방수, 필터 환기, 도장·방청"],
    ["전자파 (EMI)", "주변 통신·레이더 장비와 공존", "MIL-STD-461G (RE102 · RS103 · CE102 · CS114 등)", "차폐 쉘터, 필터, 차폐 케이블"],
    ["고고도 전자기파 (HEMP)", "EMP 후에도 기능 유지 또는 신속 복구", "MIL-STD-188-125-2 (이동형 지상 체계)", "차폐·관통부 보호, 광케이블 인입, 예비품 차폐 보관"],
    ["수송 규격", "PLS·트레일러·선박", "ISO 668 · ISO 1496-1 (컨테이너 치수·강도), STANAG 2413 (후크 인터페이스)", "모서리 쇠, 플랫랙 A 프레임, 고박 고리"],
    ["전원", "상전·발전기·차량 28 V", "MIL-STD-1275E (차량 28 V 전원 특성)", "입력 선택, 서지 보호, 무정전 전원"]],
    [14, 26, 30, 30], { bold: [0], rowH: 0.47, fs: 10 });
  T(s, "※ 규격 번호는 기준안이다. 시험 수준(가속도·시간·전계 강도)은 수송 수단 제원과 발주처 요구 등급으로 정한다. 국내 국방규격·방위사업청 기준 적용 여부를 계약 단계에서 확인한다.", { x: 0.5, y: 6.5, w: 12.33, h: 0.4, fontSize: 10, color: GRAY }); }

// ═══ 2. 구성
{ const s = page(2, "하드웨어 구성도", "쉘터 안은 방호 구역 — 전원·신호는 모두 접속반의 필터나 광케이블을 거쳐 들어온다",
    "모든 전원과 신호가 접속반 한 곳으로만 들어오게 해서 전자파 방호와 정비를 쉽게 했습니다.");
  const box = (x, y, w, h, t, sub, fill) => { s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.05, fill: { color: fill || CREAM }, line: { color: LINE, width: 1 }, objectName: "블록 " + t });
    T(s, t, { x: x + 0.08, y: y + 0.06, w: w - 0.16, h: 0.26, fontSize: 11.5, bold: true, color: fill ? WHITE : DARK, align: "center", valign: "middle" }); if (sub) T(s, sub, { x: x + 0.08, y: y + 0.34, w: w - 0.16, h: h - 0.4, fontSize: 9.5, color: fill ? "F0E4CE" : INK, align: "center" }); };
  const arrow = (x1, y1, x2, y2) => s.addShape(pres.ShapeType.line, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), line: { color: HX.accent2, width: 1.5, endArrowType: "triangle" }, flipH: x2 < x1, flipV: y2 < y1, objectName: "연결선" });
  s.addShape(pres.ShapeType.rect, { x: 3.55, y: 1.75, w: 9.28, h: 4.55, fill: { color: "FFFFFF" }, line: { color: HX.accent3, width: 2, dashType: "dash" }, objectName: "차폐 쉘터 경계" });
  T(s, "EMI 차폐 쉘터 (방호 구역)", { x: 3.7, y: 1.8, w: 4, h: 0.26, fontSize: 11, bold: true, color: GOLD, valign: "middle" });
  box(0.5, 1.95, 2.3, 0.8, "외부 전원", "상전 · 발전기 · 차량 28 V", BROWN); box(0.5, 3.25, 2.3, 0.8, "전력 장비 7종", "ESS · PV · 발전기 · 계측 등", BROWN); box(0.5, 4.55, 2.3, 0.8, "상위 지휘 체계", "(선택) 상태 보고", BROWN); box(0.5, 5.5, 2.3, 0.7, "GPS 안테나", "시각 동기", BROWN);
  box(3.75, 2.2, 1.75, 3.9, "외부 접속반", "전원 필터\n서지 보호\n\n광케이블 관통\n(도파관)\n\n신호 필터\n\n접지 단자");
  box(5.85, 2.2, 2.05, 0.95, "전원부", "절체 · 무정전 전원 · 분전"); box(5.85, 3.45, 2.05, 1.1, "제어망 스위치 A · B", "광 포트, 전원 분리"); box(5.85, 4.85, 2.05, 1.25, "게이트웨이 · 시각 서버", "직렬 변환, GPS 시각");
  box(8.25, 2.2, 2.1, 1.35, "EMS 서버 (주)", "수집 · 제어 · 기록"); box(8.25, 3.8, 2.1, 1.35, "EMS 서버 (예비)", "상시 대기, 자동 전환"); box(8.25, 5.4, 2.1, 0.7, "냉난방기 제어", "온도 · 결로 감시");
  box(10.7, 2.2, 1.95, 1.9, "운용 콘솔", "표시기 2대\n러기드 노트북\n(화면 · 지령)"); box(10.7, 4.4, 1.95, 1.7, "방진 랙", "쉘터–랙–장비\n3단계 방진");
  arrow(2.8, 2.35, 3.75, 2.6); arrow(2.8, 3.65, 3.75, 3.9); arrow(2.8, 4.95, 3.75, 4.9); arrow(2.8, 5.85, 3.75, 5.6); arrow(5.5, 2.7, 5.85, 2.7); arrow(5.5, 4.0, 5.85, 4.0); arrow(5.5, 5.4, 5.85, 5.4); arrow(7.9, 4.0, 8.25, 3.0); arrow(7.9, 4.0, 8.25, 4.5); arrow(10.35, 2.9, 10.7, 3.0); arrow(10.35, 4.5, 10.7, 3.6);
  T(s, "장비와의 통신은 광케이블(경로 A·B)로 인입해 전자파 유입 경로를 없앤다. 구리선이 꼭 필요한 신호는 접속반의 필터를 거친다.  ·  주 서버가 멈추면 예비 서버가 이어받는다(소프트웨어 이중화 기능은 개발 필요 — 7장).", { x: 0.5, y: 6.42, w: 12.33, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(2, "쉘터 내부 배치", "한쪽은 방진 랙, 한쪽은 운용 콘솔 — 정비 통로와 무게중심을 함께 고려",
    "무거운 장비는 아래쪽과 차량 진행 방향 앞쪽에 두어 무게중심을 낮춥니다.");
  pic(s, "hw_interior", 0.5, 1.72, 6.0, "쉘터 내부(방진 랙과 운용 콘솔)");
  table(s, 6.75, 1.72, 6.08, ["구역", "탑재 장비", "배치 원칙"], [["방진 랙 1", "EMS 서버 주·예비, 시각 서버, KVM", "무거운 장비는 아래 칸, 전면 고정 바"], ["방진 랙 2", "제어망 스위치 A·B, 게이트웨이, 무정전 전원·배터리", "배터리는 가장 아래, 스위치 A·B 전원 분리"], ["운용 콘솔", "표시기 2대, 러기드 노트북, 키보드", "이동 중 고정 장치, 좌석 안전띠"], ["접속반 (벽면)", "전원·광·신호 관통부, 접지 단자", "외부에서 연결, 덮개 방수"], ["환경·안전", "냉난방기, 소화기, 등화관제 조명, 비상 정지", "출입문 열림 시 조명 차단"]], [18, 44, 38], { bold: [0], rowH: 0.52, fs: 10 });
  card(s, 6.75, 5.0, 2.95, 1.75, "무게중심", "무거운 것(배터리·무정전 전원·서버)을 바닥 가까이, 좌우 균형을 맞춘다. PLS 적재 시 허용 무게중심 범위는 차량 제원으로 확인한다.", { bs: 10.5 });
  card(s, 9.88, 5.0, 2.95, 1.75, "정비성", "랙 전면에서 모든 장비를 뺄 수 있게 하고(레일), 케이블은 길이 여유와 꼬리표를 둔다. 예비품은 차폐 보관함에 넣는다.", { bs: 10.5 }); }

// ═══ 3. 기구 설계
{ const s = page(3, "이동 설계 ① PLS 적재·하역", "플랫랙에 실린 쉘터를 후크 암으로 끌어올리고 내린다 — 기울어짐과 착지 충격이 설계 조건",
    "PLS 운용에서는 적재와 하역 때 쉘터가 크게 기울고, 내려놓을 때 충격이 생깁니다.");
  pic(s, "hw_pls", 0.5, 1.72, 6.0, "후크 암으로 플랫랙을 끌어올리는 모습");
  table(s, 6.75, 1.72, 6.08, ["항목", "설계 내용"], [["치수·강도", "ISO 20 ft(1C) 외형 6,058 × 2,438 mm 와 모서리 쇠 — 플랫랙·트레일러·선박 공용"], ["후크 인터페이스", "플랫랙 A 프레임 후크 바(STANAG 2413 계열 높이 기준 — 운용 차량으로 확인)"], ["기울어짐", "적재·하역 중 큰 기울기에서 장비·서랍·문이 움직이지 않게 잠금, 액체(배터리 전해액 등) 없는 구성"], ["착지 충격", "방진 랙 변위 여유 확보, 착지 시 전원 차단 절차(운용 중 이동 금지)"], ["고박", "모서리 쇠 잠금(트위스트 록) + 고박 고리, 내부 장비는 레일 잠금과 전면 고정 바"], ["중량", "쉘터 총중량과 무게중심을 플랫랙·차량 허용 범위 안으로(중량 예산 관리)"]], [22, 78], { bold: [0], rowH: 0.5, fs: 10 });
  note(s, 6.75, 5.4, 6.08, 1.35, "운용 절차에 넣을 것", ["이동 전: 서버 정상 종료 → 전원 차단 → 케이블 분리·접속반 덮개 → 장비 잠금 확인", "하역 후: 수평 확인 → 접지 → 전원·광케이블 연결 → 기동 점검(시각·통신)"]);
  T(s, "후크 바 높이, 허용 중량·무게중심, 적재 각도는 운용할 PLS 차량의 제원서로 확정한다.", { x: 0.5, y: 6.05, w: 6.0, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(3, "이동 설계 ② 고박과 수송 수단", "도로·야지·철도·선박 — 수송 수단마다 다른 하중 방향을 고박과 구조로 받는다",
    "고박은 쉘터 외부와 내부 두 단계로 합니다.");
  pic(s, "hw_tiedown", 0.5, 1.72, 6.0, "모서리 쇠 잠금과 고박 체인");
  table(s, 6.75, 1.72, 6.08, ["수송 수단", "주된 하중", "대응"], [["PLS 차량 (야지)", "상하 진동, 좌우 흔들림, 적재·하역 기울기", "모서리 쇠 잠금, 방진 랙, 장비 잠금"], ["트레일러 (도로)", "제동·가속, 노면 진동", "전후 고박, 케이블 고정"], ["철도", "화차 연결 시 전후 충격", "전후 방향 고박 강도, 랙 전후 행정"], ["선박·항공", "장시간 저주파 흔들림, 기압 변화", "고박 고리, 밀폐부 압력 평형"], ["지게차·크레인", "인양 하중, 내려놓는 충격", "인양 고리, 지게 구멍, 바닥 보강"]], [24, 38, 38], { bold: [0], rowH: 0.47, fs: 10 });
  card(s, 6.75, 4.72, 2.95, 2.03, "외부 고박", "모서리 쇠 4곳 잠금이 기본이다. 고박 고리와 체인은 보조 수단으로 쓰고, 허용 하중을 쉘터 표지판에 표시한다.", { bs: 10.5 });
  card(s, 9.88, 4.72, 2.95, 2.03, "내부 고박", "랙 장착 장비는 레일 잠금 + 전면 고정 바, 노트북·표시기는 잠금 받침, 서랍·문은 이중 걸쇠, 케이블은 일정 간격으로 묶는다.", { bs: 10.5 }); }
{ const s = page(3, "충격·진동 설계", "쉘터 – 랙 – 장비 3단계로 나눠 줄인다 — 방진기 선정과 시험으로 확정",
    "충격과 진동은 한 곳에서 다 막지 않고 세 단계로 나눠서 줄입니다.");
  pic(s, "hw_rack", 0.5, 1.72, 6.0, "와이어로프 방진기로 매단 19인치 랙");
  steps(s, 6.75, 1.72, 6.08, 1.5, [["쉘터", "차량·플랫랙의 현가장치와 쉘터 구조가 1차로 흡수"], ["방진 랙", "와이어로프 방진기로 랙 전체를 매달아 충격과 진동을 줄임"], ["장비", "러기드 서버·SSD·잠금 커넥터로 남은 진동을 견딤"]]);
  table(s, 6.75, 3.4, 6.08, ["항목", "설계 기준(안)"], [["방진기 형식", "와이어로프 방진기 — 전 방향 방진, 온도·노화에 강함"], ["고유 진동수", "차량 주요 진동 대역과 겹치지 않게 선정(탑재 중량으로 계산 후 시험 확정)"], ["변위 여유", "방진 행정만큼 랙 주위 공간과 케이블 여유 길이 확보"], ["저장 장치", "회전 디스크 금지 — SSD 만 사용"], ["체결", "풀림 방지 너트·나사 고정제, 커넥터 잠금, 기판 보강"], ["접지", "랙이 떠 있으므로 편조 접지선으로 쉘터와 연결"]], [24, 76], { bold: [0], rowH: 0.37, fs: 10 });
  T(s, "방진기를 지나치게 무르게 하면 변위가 커지고, 딱딱하게 하면 충격이 전달된다. 탑재 중량·무게중심으로 계산한 뒤 진동·충격 시험으로 확정한다.", { x: 0.5, y: 6.05, w: 6.0, h: 0.5, fontSize: 10.5, color: GRAY });
  T(s, "랙 대신 운반 상자형(방진 랙 케이스)으로 꾸미면 쉘터 없이도 옮길 수 있다 — 소규모 구성의 대안(6장).", { x: 6.75, y: 6.1, w: 6.08, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(3, "환경 설계", "혹서·혹한·비·먼지·결로 — 쉘터 안을 장비가 견디는 조건으로 유지",
    "환경 대책의 핵심은 냉난방기와 결로 방지입니다.");
  table(s, 0.5, 1.72, 7.6, ["환경", "영향", "설계 대응"], [["고온", "서버 과열·수명 단축, 배터리 열화", "냉난방기(예비 포함 검토), 발열량 기준 풍량, 온도 경보"], ["저온", "기동 불량, 배터리 용량 저하, 결로", "기동 전 예열, 저온 사양 장비, 히터"], ["습도·결로", "기판 부식·누설", "제습, 방습 처리(코팅), 온도 변화 완만하게"], ["비·눈", "접속반·출입문 침수", "방수 덮개, 물받이, 케이블 인입부 아래 방향"], ["먼지·모래", "필터 막힘, 팬 고장", "필터 환기, 벌집 환기구 청소 주기, 밀폐형 장비"], ["염무·부식", "외판·커넥터 부식", "도장·방청, 스테인리스 체결, 커넥터 덮개"], ["태양 복사", "쉘터 내부 온도 상승", "단열, 밝은 색 지붕 또는 차양"]], [14, 36, 50], { bold: [0], rowH: 0.47, fs: 10 });
  card(s, 8.35, 1.72, 4.48, 1.55, "열 설계", "장비 발열량(전력 예산)과 일사 부하로 냉방 용량을 정한다. 냉난방기가 멈춰도 일정 시간 버티도록 온도 경보와 단계적 장비 정지를 둔다.", { bs: 10.5 });
  card(s, 8.35, 3.42, 4.48, 1.55, "EMS 와 연계", "쉘터 온도·습도·출입문·냉난방기 상태를 EMS 화면의 환경 값으로 보이고 경보를 낸다(현재 화면의 온도·습도 표시 확장).", { bs: 10.5 });
  note(s, 8.35, 5.12, 4.48, 1.63, "확인할 것", ["운용 온도 범위(혹한기 기준)와 보관 온도 범위", "냉난방기 전원 용량 — 무정전 전원에 넣을지 여부"]); }

// ═══ 4. EMP · 전원
{ const s = page(4, "EMP/EMI 방호 설계", "차폐 구역을 만들고, 그 벽을 지나는 모든 것을 보호한다 — 전원은 필터, 신호는 광케이블",
    "EMP 방호의 원칙은 차폐 구역을 만들고 그 구역을 지나는 선을 모두 보호하는 것입니다.");
  pic(s, "hw_emp", 0.5, 1.72, 6.0, "접속반의 전원 필터·벌집 환기구·광 관통부·접지");
  table(s, 6.75, 1.72, 6.08, ["요소", "설계 내용"], [["차폐 구역", "용접·가스켓으로 이어진 금속 쉘터 — 틈과 이음매가 성능을 좌우"], ["출입문", "핑거 스톡 또는 전도성 가스켓, 닫힘 확인 스위치"], ["전원 인입", "HEMP 용 전원 필터 + 서지 보호기, 접속반에 직접 접지"], ["신호 인입", "광케이블을 도파관(차단 주파수 이하 관)으로 관통 — 구리선 최소화"], ["환기구", "벌집형 도파관 환기구"], ["접지·본딩", "단일 접지점, 짧고 굵은 편조선, 장비–랙–쉘터 본딩"], ["내부 장비", "차폐 구역 안에서는 일반 러기드 장비 사용 가능"]], [22, 78], { bold: [0], rowH: 0.42, fs: 10 });
  note(s, 6.75, 5.15, 6.08, 1.6, "방호 수준은 발주처 요구로 정한다", ["기준 규격: MIL-STD-188-125-2(이동형) — 차폐 효과·관통부 보호 요구", "대안: 일부 방호 + 예비품 차폐 보관 + 신속 복구(비용·중량과 절충)"]);
  T(s, "쉘터 밖의 전력 장비(PCS·발전기 제어기 등)의 EMP 방호는 각 장비의 몫이다. EMS 쪽은 광케이블 인입으로 유입 경로를 끊는다.", { x: 0.5, y: 6.05, w: 6.0, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(4, "전원 설계", "입력은 세 가지 중 선택, 내부는 무정전 — 외부 전원이 끊겨도 감시·제어를 유지",
    "EMS 가 감시하는 전력 체계가 정전돼도 EMS 자신은 켜져 있어야 합니다.");
  pic(s, "hw_power", 0.5, 1.72, 6.0, "무정전 전원·배터리·분전·절체 구성");
  table(s, 6.75, 1.72, 6.08, ["항목", "설계 내용"], [["입력", "상전(AC) · 이동형 전력 체계 모선(AC) · 차량 28 V(DC) 중 선택 또는 자동 절체"], ["무정전 전원", "온라인 이중 변환 방식 — 입력 전원 품질과 무관하게 일정한 출력"], ["지속 시간", "외부 전원 상실 뒤 EMS 필수 부하를 목표 시간 동안 유지(목표값은 발주처와 협의)"], ["분전", "서버·스위치 A·B 를 서로 다른 분기 회로로(공통 원인 고장 방지)"], ["서지 보호", "접속반 1차 + 분전반 2차"], ["정상 종료", "배터리 잔량이 낮으면 EMS 가 기록을 닫고 정상 종료"]], [22, 78], { bold: [0], rowH: 0.45, fs: 10 });
  card(s, 6.75, 5.0, 2.95, 1.75, "전력 예산 (추정)", "서버 2 · 스위치 2 · 콘솔 · 시각 서버 등 연산·통신부 1 kW 안팎, 냉난방기는 별도. 장비 확정 후 다시 계산한다.", { bs: 10.5 });
  card(s, 9.88, 5.0, 2.95, 1.75, "FMEA 연계", "노트북 전원 상실(FM-47), 스위치 전원 공유(C-07)를 무정전 전원과 분기 회로 분리로 낮춘다.", { bs: 10.5 }); }

// ═══ 5. 연산 · 통신
{ const s = page(5, "연산·제어망 설계", "서버 주·예비, 제어망 A·B — 소프트웨어가 이미 가진 경로 이중화를 하드웨어로 완성",
    "소프트웨어는 장치마다 두 경로를 쓰도록 되어 있습니다. 하드웨어도 두 벌로 나눕니다.");
  pic(s, "hw_compute", 0.5, 1.72, 6.0, "러기드 서버·제어망 스위치·게이트웨이·시각 서버");
  table(s, 6.75, 1.72, 6.08, ["구성품", "요구 사양(안)", "비고"], [["EMS 서버 주·예비", "러기드 랙형, SSD 이중화, 팬 필터, 넓은 온도 범위", "현 소프트웨어는 노트북 1대로 동작 — 여유 충분"], ["운용 콘솔", "러기드 노트북 + 표시기 2대(1920×1080)", "화면은 웹 방식이라 단말 교체가 쉬움"], ["제어망 스위치 A·B", "산업용 관리형, 광 포트, 전원 이중 입력, 포트 보안", "경로 A(…10.x) · 경로 B(…10.1xx) 분리"], ["직렬 게이트웨이", "Modbus RTU → TCP", "계측·기존 발전기 제어반용"], ["시각 서버", "GPS 수신, NTP 제공", "폐쇄망 시각 오류(FM-11) 대책"], ["보안", "미사용 포트 차단, 접속 단말 고정", "보안성 검토 대상(FM-50)"]], [24, 42, 34], { bold: [0], rowH: 0.5, fs: 9.5 });
  note(s, 6.75, 5.45, 6.08, 1.3, "소프트웨어 쪽에 필요한 일", ["서버 주·예비 자동 전환(상태 동기·감시자) 기능은 아직 없다 — 개발 과제", "지금도 예비 서버를 꺼 둔 채 두었다가 교체하는 방식(수동 전환)은 가능하다"]);
  T(s, "장비 통신은 Modbus TCP(1초 주기, 장치 7종)로 부하가 작다. 사양은 성능보다 환경 내구성과 수급 안정성으로 고른다.", { x: 0.5, y: 6.05, w: 6.0, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(5, "외부 접속반과 케이블", "내려놓고 바로 연결 — 군용 원형 커넥터와 야전용 광케이블로 오결선을 막는다",
    "외부 연결은 접속반 한 곳에서 끝나게 합니다.");
  pic(s, "hw_panel", 0.5, 1.72, 6.0, "외부 접속반과 야전용 광케이블 릴");
  table(s, 6.75, 1.72, 6.08, ["접속", "커넥터(안)", "설계 내용"], [["전원 입력", "군용 원형 전원 커넥터", "입력별 다른 규격·키로 오결선 방지"], ["제어망 A · B", "야전용 광 커넥터(확장 빔 방식)", "먼지에 강함, 경로별 색·키 구분"], ["직렬·접점", "군용 원형 커넥터(MIL-DTL-38999 계열)", "필터 내장형 또는 접속반 필터"], ["GPS 안테나", "동축 + 서지 보호기", "안테나는 쉘터 지붕 또는 외부 거치"], ["접지", "접지 단자 + 접지봉", "설치 후 가장 먼저 연결"]], [20, 36, 44], { bold: [0], rowH: 0.47, fs: 10 });
  card(s, 6.75, 4.72, 2.95, 2.03, "케이블", "광케이블은 릴에 감아 싣고, 장비별 길이와 꼬리표를 정한다. 경로 A·B 는 다른 길로 포설해 한 번의 손상으로 둘 다 끊기지 않게 한다.", { bs: 10.5 });
  card(s, 9.88, 4.72, 2.95, 2.03, "오결선 방지", "커넥터 키·색·꼬리표를 장치별로 다르게 하고, 연결 뒤에는 EMS 현장 진단 도구(자동 진단 7단계)로 확인한다.", { bs: 10.5 }); }

// ═══ 6. WBS
{ const s = page(6, "WBS ① 기구 · EMP · 전원", "추천 제품을 참조한 하드웨어 분해 구조 — 제품은 사양을 정하기 위한 참고 예시",
    "WBS 는 추천 제품을 참조로 작성했습니다. 제품은 확정이 아니라 사양의 기준입니다.");
  table(s, 0.5, 1.72, 12.33, ["WBS", "품목", "수량", "주요 요구", "참조 제품 (예시)"], [
    ["1.1.1", "EMI 차폐 쉘터 (ISO 20 ft 또는 10 ft)", "1", "ISO 모서리 쇠, 차폐, 단열, 출입문 가스켓", "국내 군용 쉘터 제작사의 차폐 쉘터 — 실적 업체 조사"],
    ["1.1.2", "플랫랙 · 후크 인터페이스", "1", "운용 PLS 차량 규격 적합", "운용 차량 지정 플랫랙"],
    ["1.1.3", "방진 랙 (19인치)", "2", "와이어로프 방진, 전면 고정 바, 레일", "방진기: ITT Enidine 와이어로프 아이솔레이터 계열 / 케이스형 대안: Pelican-Hardigg 방진 랙 케이스"],
    ["1.1.4", "냉난방기", "1~2", "군용 쉘터용, 저온 기동, 차폐 관통 처리", "군용 쉘터 냉난방기(ECU) 계열"],
    ["1.1.5", "내부 설비", "1식", "등화관제 조명, 소화기, 좌석·고정 장치", "—"],
    ["1.2.1", "HEMP 전원 필터", "입력별", "MIL-STD-188-125 대응 품, 정격 전류 여유", "MPE 사 HEMP 필터 / ETS-Lindgren 필터 계열"],
    ["1.2.2", "벌집 환기구 · 광 관통 도파관", "1식", "차단 주파수 설계, 방수", "차폐 전문 업체 표준품"],
    ["1.2.3", "서지 보호기 · 접지 자재", "1식", "전원·동축·신호선별", "—"],
    ["1.3.1", "무정전 전원 + 배터리", "1~2", "온라인 방식, 랙형, 넓은 온도 범위", "러기드: Acumentrics 러기드 UPS 계열 / 상용 대안: Eaton 9PX 계열"],
    ["1.3.2", "절체 · 분전반", "1", "입력 선택, 분기 회로 분리", "제작품"],
    ["1.3.3", "28 V DC 입력 변환기", "1", "MIL-STD-1275 대응", "군용 DC-AC / DC-DC 변환기 계열"]],
    [7, 24, 6, 28, 35], { bold: [0], center: [0, 2], rowH: 0.385, fs: 9.5 });
  T(s, REF, { x: 0.5, y: 6.52, w: 12.33, h: 0.3, fontSize: 10, color: GRAY, valign: "middle" }); }
{ const s = page(6, "WBS ② 연산 · 통신 · 접속", "장비는 상용 러기드 제품을 우선 검토 — 차폐 구역 안에 두므로 선택 폭이 넓다",
    "차폐 쉘터 안에 넣기 때문에 장비 자체는 상용 러기드 제품을 쓸 수 있습니다.");
  table(s, 0.5, 1.72, 12.33, ["WBS", "품목", "수량", "주요 요구", "참조 제품 (예시)"], [
    ["1.4.1", "EMS 서버", "2", "러기드 짧은 깊이 랙형, SSD 이중화, 넓은 온도 범위", "Dell PowerEdge XR 계열(XR4000 · XR12) / Crystal Group RS 계열"],
    ["1.4.2", "운용 콘솔 (러기드 노트북)", "1~2", "완전 러기드, 햇빛 아래 시인성", "Getac X600 / Panasonic TOUGHBOOK 40 / Dell Latitude Rugged Extreme 계열"],
    ["1.4.3", "표시기", "2", "1920×1080, 랙 또는 벽 고정, 야간 밝기 조절", "러기드 표시기 계열"],
    ["1.4.4", "시각 서버", "1", "GPS 수신, NTP", "Meinberg LANTIME 계열 / Microchip SyncServer 계열"],
    ["1.5.1", "제어망 스위치", "2", "관리형, 광 포트, 전원 이중 입력, 포트 보안", "Moxa PT-7528 · EDS-G500E 계열 / Cisco Catalyst IE3400 Heavy Duty"],
    ["1.5.2", "직렬 게이트웨이", "2~", "Modbus RTU → TCP, 절연", "Moxa MGate MB3000 계열"],
    ["1.5.3", "광 변환기 · 패치", "1식", "장비 쪽 구리 → 광 변환", "산업용 미디어 컨버터 계열"],
    ["1.6.1", "외부 접속반", "1", "군용 원형 커넥터, 방수 덮개", "Amphenol · Glenair 의 MIL-DTL-38999 계열"],
    ["1.6.2", "야전용 광케이블 · 릴", "장비별", "확장 빔 커넥터, 인장·압착에 강한 케이블", "Amphenol TFOCA 계열"],
    ["1.7", "예비품 · 공구", "1식", "서버·스위치 예비, 차폐 보관함", "—"]],
    [7, 22, 6, 30, 35], { bold: [0], center: [0, 2], rowH: 0.41, fs: 9.5 });
  T(s, REF + " 보안 인증(국내 CC·보안 적합성)이 필요한 품목(스위치 등)은 별도로 확인한다.", { x: 0.5, y: 6.42, w: 12.33, h: 0.45, fontSize: 10, color: GRAY }); }
{ const s = page(6, "구성 대안 비교", "쉘터 탑재형이 기본안 — 규모와 방호 수준에 따라 더 가벼운 구성도 가능",
    "요구 수준에 따라 세 가지 구성 중에서 고를 수 있습니다.");
  table(s, 0.5, 1.72, 12.33, ["구분", "① 쉘터 탑재형 (기본안)", "② 방진 랙 케이스형", "③ 러기드 노트북형 (현 검증 형태)"], [
    ["구성", "차폐 쉘터 + 방진 랙 2 + 콘솔", "운반 상자형 방진 랙 2~3개", "러기드 노트북 1~2대 + 소형 스위치"],
    ["이동", "PLS · 트레일러", "소형 차량, 인력 운반(2~4인)", "휴대"],
    ["충격·진동", "3단계 방진", "케이스 방진", "노트북 자체 내구성"],
    ["EMP 방호", "쉘터 차폐로 가능", "별도 차폐 텐트·보관함 필요", "예비품 차폐 보관 + 교체"],
    ["환경", "냉난방 가능", "설치 장소에 의존", "설치 장소에 의존"],
    ["이중화", "서버·스위치·전원 이중화", "가능(부피 증가)", "예비 노트북 교체(수동)"],
    ["적합한 경우", "장기 운용, 지휘소급, EMP 요구 있음", "중간 규모, 신속 전개", "소규모·시범 운용, 초기 실증"]],
    [14, 30, 28, 28], { bold: [0], rowH: 0.5, fs: 10.5 });
  note(s, 0.5, 5.85, 12.33, 0.95, "권고", ["초기 실증은 ③으로 시작해 장비 연동을 검증하고, 본 사업은 ①을 기본으로 하되 EMP 요구 수준이 낮으면 ②를 검토한다. 소프트웨어는 세 구성에서 같다."]); }

// ═══ 7. 시험 · 과제
{ const s = page(7, "시험·검증 계획", "부품 → 랙 → 쉘터 → 차량 탑재 순으로 올라가며 확인",
    "시험은 작은 단위에서 큰 단위로 올라가며 합니다.");
  table(s, 0.5, 1.72, 12.33, ["단계", "시험", "기준(안)", "판정"], [
    ["장비 단위", "러기드 장비 성적서 확인(온도·진동·충격)", "제조사 MIL-STD-810 시험 성적", "요구 조건 충족 여부 서류 확인"],
    ["랙 단위", "진동·충격 시험(탑재 상태)", "MIL-STD-810H 514.8 · 516.8", "시험 중·후 EMS 정상 동작, 풀림·손상 없음"],
    ["쉘터 단위", "차폐 효과 측정, 방수 시험", "MIL-STD-188-125-2 부속 시험법, 810H 506.6", "요구 차폐 효과, 누수 없음"],
    ["쉘터 단위", "전자파 시험", "MIL-STD-461G", "방사·전도 한계 이내, 내성 시험 중 정상 동작"],
    ["체계 단위", "고·저온 운용, 전원 절체, 무정전 지속", "810H 501.7 · 502.7", "전 구간 EMS 정상, 목표 지속 시간 충족"],
    ["차량 탑재", "PLS 적재·하역 반복, 야지 주행", "운용 차량, 주행 시험장", "반복 뒤 기동 점검 통과, 고박 이상 없음"],
    ["연동", "실장비 연동시험(FAT)·현장 시운전(SAT)", "EMS 시험 절차서", "소프트웨어 문서의 시험 항목 통과"]],
    [12, 34, 28, 26], { bold: [0], rowH: 0.47, fs: 10 });
  T(s, "시험 수준과 판정 기준은 발주처 요구 등급으로 확정한다. 차폐 효과·EMP 시험은 전문 시험 기관이 필요하다.", { x: 0.5, y: 6.3, w: 12.33, h: 0.4, fontSize: 10.5, color: GRAY }); }
{ const s = page(7, "FMEA 연계와 미결 사항", "하드웨어 구성으로 낮추는 고장모드와, 설계 전에 정해야 할 것",
    "같은 리비전의 FMEA 에서 찾은 단일 고장점을 하드웨어로 줄입니다.");
  table(s, 0.5, 1.72, 6.6, ["고장모드 (FMEA " + REV + ")", "하드웨어 대응"], [["FM-46 노트북 고장 (단일)", "서버 주·예비, 예비품"], ["FM-47 전원 상실", "무정전 전원, 입력 절체"], ["FM-03 · C-07 통신 공통 고장", "스위치 A·B 전원·위치 분리"], ["FM-11 시각 오류", "GPS 시각 서버"], ["FM-50 비인가 접속", "포트 보안, 차폐 쉘터 출입 통제"], ["FM-01 경로 단선", "광케이블 A·B 분리 포설, 예비 케이블"], ["C-06 발전기 통신 미지원", "직렬 게이트웨이, 접점 백업"]], [48, 52], { bold: [0], rowH: 0.42, fs: 10.5 });
  table(s, 7.35, 1.72, 5.48, ["미결 사항", "정할 주체"], [["쉘터 크기(10 ft / 20 ft)와 구성 대안", "발주처 · 체계통합"], ["EMP 방호 수준(완전 / 일부 + 복구)", "발주처"], ["운용 PLS 차량 제원(후크·중량·무게중심)", "발주처"], ["운용·보관 온도 범위", "발주처"], ["무정전 지속 시간 목표", "발주처 · 체계통합"], ["서버 자동 전환 기능 개발 범위", "EMS 개발"], ["국내 국방규격·보안 인증 적용", "발주처"]], [66, 34], { bold: [0], rowH: 0.42, fs: 10.5 });
  note(s, 0.5, 5.35, 12.33, 1.4, "이 자료의 한계", ["하드웨어는 구성안이며 제작·시험하지 않았다. 중량·전력·치수는 장비 확정 뒤 다시 계산한다.", "그림은 이해를 돕는 AI 생성 개념도다. 제품명은 사양 기준을 잡기 위한 참고 예시이며 최신 사양을 견적 단계에서 확인해야 한다.", "EMS 소프트웨어는 가상 장치로만 검증했다(같은 리비전의 시험 결과 보고서 참조)."]); }

// ═══ 맺음
pres.addSection({ title: "맺음" });
{ const s = pres.addSlide({ masterName: "CLOSING", sectionTitle: "맺음" });
  s.addText("옮겨도, 흔들려도, 전자기파에도\n멈추지 않는 EMS", { placeholder: "title" }); s.addText("쉘터 탑재 · 3단계 방진 · 차폐와 광 인입 · 이중화", { placeholder: "sub" });
  s.addText("한화에어로스페이스㈜ 에너지솔루션사업센터", { placeholder: "org" }); s.addText(`${YM}  ·  ${REV}`, { placeholder: "date" }); }
pres.writeFile({ fileName: OUT }).then(async () => { await applyTheme(OUT, THEME); console.log("saved", OUT); });
