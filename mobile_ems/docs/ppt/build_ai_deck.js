// IFPS 이동형 EMS — AI 예측 기술자료 (보고자료와 같은 발표 양식). 수치는 ai_paper_eval.json, 입체 그림은 img/ai3d_m_*.jpg(실제 학습 값으로 렌더링), 그래프는 img/aich_*.png
// node build_ai_deck.js [Rev] [작성 연월] [출력.pptx]   — 보통은 docs/build_all.py 가 부른다
// 양식·구성 요소(머리띠, 카드, 표 등)는 build_deck.js 와 같은 것을 쓴다. 양식을 고치면 두 파일을 함께 고친다.
const fs = require("fs"), path = require("path"); const pptxgen = require("pptxgenjs");
const { applyTheme } = require("./apply_theme.js");
const EMS = path.join(__dirname, "..", ".."); const REV = process.argv[2] || "Rev00", YM = process.argv[3] || "2026. 11.";
const OUT = process.argv[4] || path.join(EMS, "docs", "out", `IFPS_EMS_AI예측_기술자료_${REV}.pptx`); const IMG = n => path.join(__dirname, "img", n + ".jpg");
const THEME = { name: "IFPS 제안 발표", headFontFace: "맑은 고딕", bodyFontFace: "맑은 고딕",
  colors: { dk1: "2B2723", lt1: "FFFFFF", dk2: "35302A", lt2: "F9F1E6", accent1: "B59F76", accent2: "7B674F", accent3: "8A7449", accent4: "E0D7C8", accent5: "6F6B68", accent6: "B0392B", hlink: "8A7449", folHlink: "6F6B68" } };
const pres = new pptxgen(); pres.layout = "LAYOUT_WIDE"; pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "IFPS 이동형 EMS AI 예측 기술자료"; pres.author = "한화에어로스페이스㈜ 에너지솔루션사업센터"; pres.company = "한화에어로스페이스㈜"; pres.subject = "EMS AI 예측 기술자료";
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
    { text: { text: "한화에어로스페이스  |  이동형 EMS AI 예측 기술자료", options: { x: 0.45, y: 7.05, w: 7, h: 0.3, fontSize: 8.5, color: GRAY, margin: 0, valign: "middle" } } },
    { placeholder: { options: { name: "secno", type: "body", x: 0.45, y: 0.11, w: 0.42, h: 0.4, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "sec", type: "body", x: 0.98, y: 0.07, w: 6.5, h: 0.28, fontSize: 16, bold: true, color: WHITE, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "secen", type: "body", x: 1.0, y: 0.34, w: 6.5, h: 0.22, fontSize: 9, bold: true, color: TAN, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.78, w: 12.3, h: 0.4, fontSize: 21, bold: true, color: INK, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "sub", type: "body", x: 0.5, y: 1.2, w: 12.3, h: 0.32, fontSize: 12.5, bold: true, color: GOLD, margin: 0, valign: "middle", align: "left" }, text: "" } }],
  slideNumber: { x: 11.83, y: 7.05, w: 1.05, h: 0.3, fontSize: 9.5, bold: true, color: GRAY, align: "right" } });

// ── 구성 요소
const REMAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
const SECS = [["개요", "OVERVIEW"], ["자료 · 특징", "DATA & FEATURES"], ["릿지 회귀 · 예측 구간", "RIDGE REGRESSION & INTERVALS"], ["하늘 카메라 · 주의집중", "SKY CAMERA & ATTENTION"], ["단기 실측 앙상블", "MEASUREMENT-BASED NOWCAST"], ["지속 학습", "CONTINUAL LEARNING"], ["평가", "EVALUATION"], ["한계 · 결론", "LIMITS & CONCLUSIONS"]];
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
}const E = JSON.parse(fs.readFileSync(path.join(__dirname, "ai_paper_eval.json"), "utf8")), LE = JSON.parse(fs.readFileSync(path.join(__dirname, "ai_learn_eval.json"), "utf8"));
const PNG = n => path.join(__dirname, "img", n + ".png"), MATH = "Cambria Math", PV = E.pv, P3 = PV[2], pc = v => v === null || v === undefined ? "—" : Number(v).toFixed(2) + "%", cut = (a, b) => Math.round((1 - b / a) * 100);
// 입체 모델 그림(실제 학습 값으로 렌더링) + 출처 표시
function m3d(s, name, x, y, w, cap) {
  const h = w * 9 / 16; s.addImage({ path: IMG("ai3d_m_" + name), x, y, w, h, altText: cap, objectName: "입체 모델 " + name });
  s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { type: "none" }, line: { color: LINE, width: 1 }, objectName: "그림 테두리" });
  T(s, cap + "  — 위치·크기·굵기는 모두 실제 학습 값(ai_paper_eval.json)", { x, y: y + h + 0.04, w, h: 0.22, fontSize: 8.5, color: GRAY, valign: "middle" }); return h;
}
function chart(s, name, x, y, w) { const h = w * 620 / 1200; s.addImage({ path: PNG("aich_" + name), x, y, w, h, altText: "그래프 " + name, objectName: "그래프 " + name }); s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { type: "none" }, line: { color: LINE, width: 1 }, objectName: "그래프 테두리" }); return h; }
// 수식 카드: 제목 + 수식(여러 줄) + 설명
function fcard(s, x, y, w, h, title, formulas, desc, o = {}) { card(s, x, y, w, h, title, "", { ts: o.ts || 12.5 });
  T(s, formulas.map(t => ({ text: t, options: { fontFace: MATH, fontSize: o.fs || 12.5, bold: true, color: DARK, breakLine: true } })).concat(desc ? [{ text: desc, options: { fontSize: o.ds || 9.8, color: INK } }] : []), { x: x + 0.16, y: y + 0.42, w: w - 0.32, h: h - 0.48, paraSpaceAfter: 3 }); }
const BN = E.bench, BA = BN.agg;
const SYN = "수치는 합성 현장 자료(씨앗 고정) 결과다. 실제 효과는 현장 자료로 다시 재야 한다.";
const foot = (s, t) => T(s, t, { x: 0.5, y: 6.82, w: 12.33, h: 0.2, fontSize: 8.5, color: GRAY, valign: "middle" });

// ═══ 표지 · 목차
pres.addSection({ title: "표지·목차" });
{ const s = pres.addSlide({ masterName: "COVER", sectionTitle: "표지·목차" });
  s.addText("IFPS · Integrated Field Power System", { placeholder: "kicker" }); s.addText("이동형 EMS AI 예측 기술자료", { placeholder: "title" });
  s.addText("Load & PV Forecasting — Baseline Models, Measurement-Based Nowcast, Calibrated Intervals, Validation", { placeholder: "en" });
  s.addText("수식 · 학습된 모델의 입체 그림 · 독립 검증  |  부하·태양광 24시간 예측과 단기 실측 앙상블", { placeholder: "tag" });
  s.addText(`한화에어로스페이스㈜ 에너지솔루션사업센터   |   ${YM}   |   ${REV}`, { placeholder: "org" }); }
{ const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "표지·목차" });
  s.addText("목", { placeholder: "secno" }); s.addText("목차", { placeholder: "sec" }); s.addText("CONTENTS", { placeholder: "secen" }); s.addText("목차", { placeholder: "title" }); s.addText("예측 한 번이 만들어지는 순서대로 설명한다", { placeholder: "sub" });
  SECS.forEach(([k, en], i) => { const x = 0.5 + (i % 4) * 3.1, y = 1.8 + Math.floor(i / 4) * 2.2; card(s, x, y, 2.9, 2.0, `${i + 1}. ${k}`, "", { ts: 14 }); T(s, en, { x: x + 0.16, y: y + 0.42, w: 2.6, h: 0.22, fontSize: 9, bold: true, color: GOLD });
    T(s, ["무엇을 왜 예측하나 · 전체 구조와 규모", "입력 자료 · 원시 관측 표시 · 청천 출력 · 특징", "가중치 구하는 식 · 학습된 평면 · 구간과 변동 여유", "구름량 판독 · 닮은 과거 찾기 · 섞는 비율", "최근 실측 참조 · 결합 식 · 보정량 응답면", "다시 배우고 검증해 통과한 것만 적용", "기본 예측 비교 · 독립 시험 6세트 · 구간 포함률", "합성 자료의 한계 · 현장 검증 계획 · 결론"][i], { x: x + 0.16, y: y + 0.72, w: 2.6, h: 1.1, fontSize: 11.5 }); });
  note(s, 0.5, 6.25, 12.33, 0.55, "그림 읽는 법", ["입체 그림은 꾸민 그림이 아니다. 학습된 값(가중치·거리·비율)과 실제 결합 함수의 출력을 그대로 3차원에 놓고 그렸으며, 그림마다 대응하는 수식 기호를 적었다."]); }

// ═══ 1. 개요
{ const s = page(1, "무엇을, 왜 예측하나", "앞으로 24시간의 부하와 태양광 발전량 — 발전기를 언제 켜고 ESS 를 얼마나 남길지 정하는 근거",
    "EMS 는 앞으로 24시간의 부하와 태양광을 15분 단위로 예측해 운전 계획을 세웁니다. 외부 기상 예보 없이 현장 센서와 하늘 카메라만 씁니다.");
  stat(s, 0.5, 1.72, 2.9, 1.0, "부하 예측 오차 (24시간)", pc(E.load.nmae).replace("%", ""), "%"); stat(s, 3.57, 1.72, 2.9, 1.0, "태양광 예측 오차 (24시간)", pc(P3.nmae).replace("%", ""), "%");
  stat(s, 6.64, 1.72, 2.9, 1.0, "태양광 2시간 이내 오차", pc(P3.near).replace("%", ""), "%"); stat(s, 9.71, 1.72, 3.12, 1.0, "학습되는 값 (태양광 모델)", String(E.cost.params_ridge + E.cost.params_att + E.cost.params_alpha), "개");
  chart(s, "fc_pv", 0.5, 2.92, 6.1); chart(s, "fc_load", 6.73, 2.92, 6.1);
  note(s, 0.5, 6.15, 12.33, 0.62, "조건", ["인터넷·외부 예보 없이 동작(폐쇄망) · 노트북 CPU 로 학습 " + E.cost.train_pv_s + "초, 예측 " + E.cost.predict_s + "초 · 모델 파일 " + E.cost.pv_kb + " KB · 예측이 틀려도 예비력 규칙이 따로 지킨다"]);
  foot(s, `오차는 시험 ${E.data.test_days}일(학습에 쓰지 않음)·${E.data.issues}회 발행 평균. 부하는 평균 부하 대비, 태양광은 설비 용량 대비(낮 구간). ` + SYN); }
{ const s = page(1, "전체 구조 — 블록 수가 실제 개수", "측정값 5종 → 특징 → 릿지 회귀와 주의집중 → 검증된 비율로 섞기 → 청천 출력을 곱해 24시간 예측",
    "태양광 예측 모델 전체를 실제 개수대로 그린 그림입니다. 학습되는 값은 모두 합쳐 158개뿐입니다.");
  m3d(s, "arch", 0.5, 1.72, 8.1, "태양광 예측 모델의 전체 구조");
  legend(s, 8.8, 1.72, 4.03, [[1, "입력 5종", "발전 실적, 구름량(카메라), 기온, 기압, 습도 — 15분 평균"], [2, "릿지 회귀", `선행시간 6구간 × 가중치 21개 = ${E.cost.params_ridge}개`], [3, "주의집중", `기억 ${E.att.memories.toLocaleString()}건에서 닮은 과거를 찾음 · 중요도 ${E.cost.params_att}개`], [4, "섞기 α", `구간별 비율 ${E.cost.params_alpha}개 — 검증에서 도움이 될 때만`], [5, "청천 출력", "태양 위치로 계산(학습 없음) — 밤·계절은 여기서 처리"]], { rh: 0.8, gap: 0.09 });
  foot(s, "부하 예측은 릿지 회귀(특징 18개)만 쓴다. 하늘 카메라와 주의집중은 태양광 예측에만 들어간다."); }

// ═══ 2. 자료 · 특징
{ const s = page(2, "입력 자료와 청천 출력", "15분 평균 이력 한 줄 = 부하·태양광·기온·기압·습도·구름량 — 태양광은 '청천 출력 대비 비율'로 바꿔 예측한다",
    "태양광 출력은 밤낮과 계절에 따라 크게 변합니다. 그래서 맑은 날 낼 수 있는 출력으로 나눈 비율을 예측합니다. 이 비율이 구름의 영향입니다.");
  table(s, 0.5, 1.72, 6.0, ["이력 열", "내용", "쓰는 곳"], [["load_kw, p1~p3", "부하 합계와 등급별 부하", "부하 예측"], ["pv_kw", "태양광 출력", "태양광 예측"], ["temp, press, rh", "기온, 기압, 습도", "양쪽"], ["sky", "하늘 카메라 구름량 0~1 (없으면 빈칸)", "태양광 예측"], ["plan, mode", "편성 단계, 운전 방식", "부하 예측"]], [24, 48, 28], { bold: [0], rowH: 0.34, fs: 10.5 });
  note(s, 0.5, 3.95, 6.0, 1.3, "전처리", ["15분 격자로 다시 놓는다(빠진 구간은 앞 값으로, 구름량은 비워 둠). 원래 측정된 값인지 채운 값인지를 따로 표시해 둔다 — 실측 보정과 채점에는 측정된 값만 쓴다.", "최근 120일까지 사용. 값이 멈춘 자료·결측이 많은 자료로는 학습하지 않는다."]);
  note(s, 0.5, 5.4, 6.0, 1.3, "왜 비율로 예측하나", ["출력 자체는 시각·계절에 따라 0~수백 kW 로 변한다. 비율 r 은 0~1 근처에 머물러 날씨만 반영한다.", "밤(청천 출력이 용량의 5% 미만)은 r 을 정의하지 않고 예측도 0 으로 둔다."]);
  fcard(s, 6.7, 1.72, 6.13, 1.55, "① 태양 고도", ["cos θ = sin φ · sin δ + cos φ · cos δ · cos ω"], "φ 위도, δ 태양 적위(날짜로 계산), ω 시간각(균시차·경도 보정한 태양시). 현장 위치와 시각만 있으면 된다");
  fcard(s, 6.7, 3.4, 6.13, 1.55, "② 청천 일사와 청천 출력", ["G = 1098 · cos θ · exp(−0.057 / cos θ)   [W/㎡]", "P_clear = P_kWp · PR · G / 1000"], "G: 구름 없는 날의 전천 일사(Haurwitz 식). PR: 종합 성능계수 " + 0.78 + ", P_kWp: 설비 용량 " + E.data.kwp + " kW");
  fcard(s, 6.7, 5.08, 6.13, 1.62, "③ 청천 지수 — 예측 대상", ["r(t) = clip( P(t) / P_clear(t) ,  0 ,  1.2 )", "P̂(o+h) = r̂(o+h) · P_clear(o+h)"], "o: 예측을 내는 시점, h: 선행시간(1~96구간). r̂ 을 예측해 청천 출력을 곱한다. 이후 장의 수식은 모두 r̂ 을 구하는 방법이다"); }
{ const s = page(2, "특징 — 모델이 보는 것", "태양광 20개, 부하 18개 — 모두 예측 시점까지 측정한 값으로만 만든다",
    "모델에 들어가는 입력 목록입니다. 미래의 값은 쓰지 않습니다.");
  table(s, 0.5, 1.72, 6.05, ["태양광 특징 x (20개)", "수"], [["선행시간 h/96, 목표 시각의 청천 출력, 지금의 청천 출력", 3], ["목표 시각 sin · cos", 2], ["청천 지수: 최근 1시간·3시간 평균, 2시간 표준편차, 24시간 평균, 전일 같은 시각", 5], ["기압: 24시간 평균 대비, 3·12·24시간 변화", 4], ["습도와 6시간 변화, 기온과 24시간 변화", 4], ["구름량(카메라)과 30분 변화", 2]], [86, 14], { center: [1], rowH: 0.42, fs: 10.5 });
  table(s, 6.78, 1.72, 6.05, ["부하 특징 x (18개)", "수"], [["선행시간 h/96, 목표 시각의 1·2·3차 주기(sin · cos)", 7], ["일요일 여부, 편성 단계", 2], ["부하: 지금, 최근 1시간·24시간 평균, 전일·전주 같은 시각, 전일 대비 변화", 6], ["기온, 목표 시각의 기온 추정, 청천 출력 비율", 3]], [86, 14], { center: [1], rowH: 0.42, fs: 10.5 });
  note(s, 6.78, 4.05, 6.05, 1.25, "부하의 예측 대상", ["y = L(o+h) / B(o) — 기준 부하 B 로 나눈 비율. B 는 배치 후 14일까지의 평균 부하(이후 고정)다.", "편성이 바뀌어 부하 수준이 달라져도 같은 모델을 쓸 수 있다."]);
  note(s, 0.5, 4.75, 6.05, 1.0, "카메라가 없을 때", ["구름량 자리에 (1 − 최근 1시간 청천 지수)/0.85 를 넣는다 — 값이 비어도 예측이 멈추지 않는다."]);
  note(s, 0.5, 5.9, 12.33, 0.8, "학습 표본", [`예측 시점 o 를 3구간(45분)마다 옮기며 선행시간 14종(1·2·3·4·6·8·12·16·24·32·48·64·80·96구간)의 (x, y) 를 만든다 → 1시간 이내 구간만 ${E.viz.ridge.n_fit.toLocaleString()}건`]); }

// ═══ 3. 릿지 회귀 · 예측 구간
{ const s = page(3, "릿지 회귀 — 학습된 평면", "선행시간 6구간마다 가중치 w 를 한 번의 식으로 구한다 — 반복 학습이 없어 몇 초면 끝나고 결과가 항상 같다",
    "첫 번째 모델은 릿지 회귀입니다. 그림의 점은 실제 학습 표본이고, 유리판은 학습된 가중치가 만드는 평면입니다.");
  m3d(s, "ridge", 0.5, 1.72, 7.6, "릿지 회귀(1시간 이내 구간)의 학습 표본과 학습된 단면");
  fcard(s, 8.3, 1.72, 4.53, 1.5, "① 표준화와 가중치", ["z = (x − μ) / σ", "w = (ZᵀZ + λI)⁻¹ Zᵀy ,  λ = 3"], "λ 는 가중치가 지나치게 커지는 것을 막는다(절편에는 적용하지 않음)");
  fcard(s, 8.3, 3.35, 4.53, 1.5, "② 예측", ["r̂(릿지) = 0.8 · wᵦᵀz + 0.2 · r(전일 같은 시각)"], "b: 선행시간 구간(≤1·2·4·8·16·24시간). 전일 값을 20% 섞어 입력이 이상할 때의 폭주를 줄인다");
  note(s, 8.3, 4.98, 4.53, 1.72, "그림 읽는 법", [`점: 학습 표본 ${E.viz.ridge.pts.length}개(전체 ${E.viz.ridge.n_fit.toLocaleString()}건 중). 높이 = 실제 청천 지수 y.`, `유리판: ŷ = c + ${E.viz.ridge.a}·x₁ ${E.viz.ridge.b}·x₂ — 구름량이 늘면 내려간다.`, "흰 선: 각 점의 잔차 y − ŷ."]);
  foot(s, "평면은 특징 20개 중 두 개(x₁, x₂)에 대한 단면이다. 나머지 18개는 평균값에 고정했다. 잔차 선은 20개 특징을 모두 쓴 실제 예측값까지의 거리다."); }
{ const s = page(3, "예측 구간 — 얼마나 틀릴 수 있는지도 함께 낸다", "최근 7일의 실제 오차에서 10%·90% 분위수를 구해 80% 구간을 만든다 — 분포를 가정하지 않는다",
    "예측값 하나만 내지 않고 범위를 함께 냅니다. 운전 계획은 부하는 높은 쪽, 태양광은 낮은 쪽을 봐서 보수적으로 세웁니다.");
  m3d(s, "band", 0.5, 1.72, 7.6, "실제 한 번의 태양광 24시간 예측과 80% 구간");
  fcard(s, 8.3, 1.72, 4.53, 1.5, "① 오차 분위수", ["e = r − r̂   (최근 7일, 구간 b 별)", "q₁₀ = Q₁₀(e) ,  q₉₀ = Q₉₀(e)"], "학습에 쓰지 않은 마지막 7일의 오차로 구한다. 학습 주기마다 다시 맞춘다");
  fcard(s, 8.3, 3.35, 4.53, 1.62, "② 변동 여유 — 날씨가 바뀌면 넓힌다", ["s = min{ s ≥ 1 : 포함률(최근 2일 | s·q(앞 5일)) ≥ 80% }", "[ r̂ + s·q₁₀ , r̂ + s·q₉₀ ] × P_clear"], "최근 2일 포함률이 75% 이상이면 s = 1. 아니면 1.15~2.5 중 80%를 덮는 가장 작은 값", { fs: 11, ds: 9.5 });
  note(s, 8.3, 5.1, 4.53, 1.6, "측정 결과 (독립 시험 6세트)", [`24시간 포함률: 한 번 보정 ${BA.pv.cov24_static[0]}~${BA.pv.cov24_static[1]}%(태양광) → 매일 보정+변동 여유 ${BA.pv.cov24[0]}~${BA.pv.cov24[1]}%.`, `부하는 ${BA.load.cov24_static[0]}~${BA.load.cov24_static[1]}% → ${BA.load.cov24[0]}~${BA.load.cov24[1]}%. 운전 계획은 이 구간으로 부하는 위쪽, 태양광은 아래쪽을 본다.`]);
  foot(s, SYN); }

// ═══ 4. 하늘 카메라 · 주의집중
{ const s = page(4, "하늘 카메라 — 사진에서 구름량", "맑은 하늘은 푸르고 구름은 희다 — 화소마다 붉은빛과 푸른빛의 비를 보고 구름 화소를 센다",
    "하늘 카메라는 태양을 가리기 전의 구름을 먼저 봅니다. 사진에서 구름량을 숫자로 바꾸는 방법입니다.");
  s.addImage({ path: IMG("ai3d_skycam"), x: 0.5, y: 1.72, w: 5.6, h: 5.6 * 9 / 16, altText: "전천 카메라 설치 예(개념도)", objectName: "그림 하늘 카메라" });
  T(s, "쉘터 지붕의 전천 카메라 설치 예  (개념도 · AI 생성)", { x: 0.5, y: 1.72 + 5.6 * 9 / 16 + 0.04, w: 5.6, h: 0.24, fontSize: 9, color: GRAY, valign: "middle" });
  fcard(s, 6.3, 1.72, 6.53, 1.45, "① 화소별 판정", ["ρ = (R − B) / (R + B + 1)", "구름  ⇔  ρ > −0.12"], "맑은 하늘은 R 이 B 보다 훨씬 작아 ρ 가 크게 음수다. 구름은 R ≈ B 라 0 에 가깝다. 포화된 태양 원반은 세지 않는다");
  fcard(s, 6.3, 3.3, 6.53, 1.3, "② 구름량", ["c = (구름 화소 수) / (하늘 화소 수) ,   0 ≤ c ≤ 1"], "평균 밝기가 낮으면(야간) 판정하지 않는다. 10초마다 읽어 15분 평균을 이력의 sky 열에 남긴다");
  table(s, 6.3, 4.75, 6.53, ["상황", "동작"], [["사진 없음 · 3분 넘게 오래됨 · 읽기 실패", "값을 비우고 낮에는 경보 — 예측은 계속"], ["야간", "값을 비움(경보 없음)"], ["가상 장치 모드", "모의 구름으로 하늘 그림을 만들어 같은 경로로 흘려보냄"]], [46, 54], { rowH: 0.36, fs: 10.5, bold: [0] });
  note(s, 0.5, 5.75, 5.6, 0.95, "연결 방법", ["카메라(또는 카메라 PC)가 최신 사진(PNG)을 정해진 경로에 덮어쓰면 된다. EMS 는 읽기만 한다."]);
  foot(s, "왼쪽 그림은 설치 모습을 보이는 AI 생성 개념도다. 판정 경계(−0.12)는 합성 그림 기준값이며 실제 카메라에서는 현장 사진으로 다시 맞춰야 한다."); }
{ const s = page(4, "주의집중 ① 닮은 과거를 찾아 그 뒤를 본다", "지금 상황 q 와 과거 상황 Kᵢ 의 닮은 정도를 가중치 wᵢ 로 바꾸고, 그때 실제로 일어난 일 Vᵢ 를 가중 평균한다",
    "두 번째 모델은 주의집중입니다. 대형 언어 모델의 핵심 연산과 같은 원리입니다. 그림 가운데가 지금 상황이고, 빛줄기가 굵을수록 많이 참고한 과거입니다.");
  m3d(s, "attn", 0.5, 1.72, 7.6, "한 번의 예측에서 질의 q 주변 기억과 가중치");
  fcard(s, 8.3, 1.72, 4.53, 1.75, "① 가중치(소프트맥스)", ["dᵢ = Σₖ sₖ² ( q̃ₖ − K̃ᵢₖ )²", "wᵢ = mᵢ · e^(−dᵢ) / Σⱼ mⱼ · e^(−dⱼ)"], "q̃, K̃: 표준화한 값. mᵢ: 예측 시점 전에 끝난 기억만 1(미래를 보지 않는다)");
  fcard(s, 8.3, 3.6, 4.53, 1.25, "② 예측", ["r̂(주의집중)(h) = Σᵢ wᵢ · Vᵢ(h)"], "Vᵢ(h): 과거 시점 i 에서 h 구간 뒤에 실제로 나온 청천 지수");
  note(s, 8.3, 4.98, 4.53, 1.72, "이 예측에서", [`가장 닮은 과거 ${E.sample.refs.slice(0, 2).map(r => r[0].slice(5) + " (" + r[1] + "%)").join(", ")}.`, `위 10건의 가중치 합 ${E.sample.top10_share}%, 유효 기억 수 ${E.sample.eff_n}건 — 한두 건에 기대지 않는다.`, `1시간 뒤 예측 ${E.viz.att.pred_1h}, 실측 ${E.viz.att.act_1h}.`]);
  foot(s, "기억은 13차원 공간에 있다. 그림은 중요도가 큰 3개 축만 보인 것이며, 거리는 중요도 sₖ 를 곱한 값이다."); }
{ const s = page(4, "주의집중 ② 무엇을 닮았다고 볼지를 배운다", "특징 13개의 중요도 sₖ 를 가까운 예측과 먼 예측에 따로 학습 — 26개가 전부다",
    "어떤 특징이 닮아야 닮은 것인지를 자료에서 배웁니다. 가까운 예측에서는 카메라 구름량이, 먼 예측에서는 기온과 시각이 중요하게 나왔습니다.");
  m3d(s, "imp", 0.5, 1.72, 7.6, "학습된 특징별 중요도(주황: 2시간 이내, 청록: 2~24시간)");
  fcard(s, 8.3, 1.72, 4.53, 1.6, "① 학습 목표", ["L(s) = (1/N) Σ | r̂ₛ(주의집중) − r |"], "최근 7일의 시점들을 '그 이전 기억만으로' 맞혀 본 평균 절대 오차");
  fcard(s, 8.3, 3.45, 4.53, 1.55, "② 좌표 하강", ["sₖ ← sₖ · m ,  m ∈ {2, ½, 0}", "L 이 줄 때만 받아들임 (2회 반복)"], "한 번에 특징 하나씩. 0 은 그 특징을 보지 않는다는 뜻");
  note(s, 8.3, 5.13, 4.53, 1.57, "학습 결과", ["가까운 예측: " + E.att.top_near.slice(0, 3).map(r => r[0] + " " + r[1]).join(", "), "먼 예측: " + E.att.top_far.slice(0, 3).map(r => r[0] + " " + r[1]).join(", "), "구름이 곧 가릴지는 카메라가, 내일의 수준은 계절·기온이 말해 준다."]);
  foot(s, `상황 벡터 q(13개): ${E.att.names.join(", ")}. 기억은 1시간 간격으로 ${E.att.memories.toLocaleString()}건.`); }
{ const s = page(4, "섞기 — 검증된 만큼만 쓴다", "선행시간 구간마다 릿지와 주의집중을 섞는 비율 α 를 정한다 — 오차가 2% 이상 줄지 않으면 0",
    "두 모델을 섞는 비율입니다. 주의집중이 도움이 되는 구간에서만 쓰고, 그렇지 않은 구간은 릿지 회귀만 씁니다.");
  m3d(s, "alpha", 0.5, 1.72, 7.6, "학습된 구간별 섞는 비율 α");
  fcard(s, 8.3, 1.72, 4.53, 1.5, "① 섞기", ["r̂ = (1 − αᵦ) · r̂(릿지) + αᵦ · r̂(주의집중)"], "b: 선행시간 구간. 주의집중 값이 없으면(기억 부족) 릿지만 쓴다");
  fcard(s, 8.3, 3.35, 4.53, 1.6, "② 비율 정하기", ["αᵦ = argmin_α MAEᵦ(α) ,  α ∈ {0, ¼, ½, ¾, 1}", "MAEᵦ(αᵦ) ≥ 0.98 · MAEᵦ(0)  ⇒  αᵦ = 0"], "학습에 쓰지 않은 마지막 8일에서 잰다. 우연한 차이로는 섞지 않는다");
  table(s, 8.3, 5.08, 4.53, ["구간", "α", "카메라만", "＋주의집중"], E.data.buckets.map((b, i) => ["≤ " + b + "h", Math.round(P3.alpha[i] * 100) + "%", pc(PV[1].by_h[i]), pc(P3.by_h[i])]), [22, 18, 30, 30], { center: [0, 1, 2, 3], rowH: 0.232, fs: 9.2 });
  foot(s, "표의 오차는 시험 14일(설비 용량 대비 %). α 를 정할 때 쓴 구간과 시험 구간은 다르다. " + SYN); }

// ═══ 5. 단기 실측 앙상블
{ const s = page(5, "단기 실측 앙상블 — 어디에 들어가나", "기본 예측(릿지·주의집중·최근 오차 보정) 위에, 방금 잰 값으로 만든 참조를 4시간 이내에만 결합한다",
    "가장 가까운 미래는 방금 잰 값이 가장 잘 알려 줍니다. 그래서 최근 실측으로 만든 참조값을 가까운 구간에만 섞습니다. 먼 구간은 기존 예측 그대로입니다.");
  steps(s, 0.5, 1.72, 12.33, 1.45, [["기본 예측 ŷ", "릿지 회귀 + 주의집중(태양광) + 최근 오차 보정"], ["실측 참조 R", "부하: 최신 부하 + 전일 곡선 / 태양광: 최근 청천 지수 × 미래 청천 출력"], ["유효 판정 M", "원래 측정된 값이 있을 때만 1. 채운 값·저일사는 0"], ["결합", "구간 가중치 w 와 감쇠 t 로 ŷ 를 R 쪽으로 옮김(구간도 함께)"], ["계획 연동", "화면과 운전 계획이 같은 가중치를 쓴다"]]);
  table(s, 0.5, 3.35, 7.6, ["항목", "부하", "태양광"], [["참조에 쓰는 실측", "최근 45분 부하와 전일 같은 시각", "최근 45분 청천 지수(낮에만)"], ["적용 범위", "0~1 / 1~2 / 2~4시간", "0~1 / 1~2 / 2~4시간 · 첫 1시간 감쇠"], ["4시간 이후", "기존 예측 그대로", "기존 예측 그대로"], ["실측이 없을 때", "기존 예측 그대로", "기존 예측 그대로"]], [26, 37, 37], { bold: [0], rowH: 0.36, fs: 10.5 });
  fcard(s, 8.3, 3.35, 4.53, 1.6, "가중치 채택 조건", ["w_b ∈ {0, ¼, ½, ¾, 1}", "MAE ≥ 2% 감소  ∧  포함률 하락 ≤ 2%p"], "검증 표본 40개 이상. 조건을 통과한 후보 중 오차가 가장 작은 값. 없으면 0", { ds: 9.5 });
  note(s, 0.5, 5.3, 12.33, 1.4, "독립 시험 요약 (6세트)", [`부하 15분 오차 ${BA.load.nmae15[0]}% → ${BA.load.nmae15[1]}% (세트별 ${BA.load.cut15_min}~${BA.load.cut15_max}% 감소, ${BA.load.used}/${BA.load.n}세트에서 채택). 태양광 ${BA.pv.nmae15[0]}% → ${BA.pv.nmae15[1]}% (${BA.pv.cut15_min}~${BA.pv.cut15_max}% 감소, ${BA.pv.used}/${BA.pv.n}세트).`, `24시간 전체는 거의 같다(부하 ${BA.load.nmae24[0]} → ${BA.load.nmae24[1]}%, 태양광 ${BA.pv.nmae24[0]} → ${BA.pv.nmae24[1]}%). 효과는 가까운 구간에만 있다.`]);
  foot(s, "코드: ifps_ems/nowcast.py (reference · blend · select), ifps_ems/learner.py (predict · select_nowcast). " + SYN); }
{ const s = page(5, "참조 모델 — 부하와 태양광", "부하는 '방금 잰 값에서 출발해 전일 곡선으로 옮겨 가고', 태양광은 '지금의 맑은 정도가 이어진다'고 본다",
    "참조값을 만드는 식입니다. 부하는 최신 실측에서 시작해 선행시간이 길어질수록 전일 같은 시각 곡선을 더 따릅니다. 태양광은 최근 청천 지수에 미래 청천 출력을 곱합니다.");
  fcard(s, 0.5, 1.72, 6.05, 1.55, "① 부하 — 전일 곡선의 수준 보정", ["Δ = clip( median( Lₒ₋ⱼ − Lₒ₋ⱼ₋₉₆ ) ,  ±0.3·B )"], "최근 유효 3개 구간(j = 0, 1, 2)의 '오늘 − 어제' 차이의 중앙값. B: 설정 기준 부하. 한 번 튄 값에 끌려가지 않게 중앙값을 쓴다");
  fcard(s, 0.5, 3.4, 6.05, 1.7, "② 부하 참조", ["a = e^(−(h−1)/3) ,   q = e^(−(h−1)/12)", "R_L(h) = max( 0 ,  a·Lₒ + (1−a)·( Lₒ₊ₕ₋₉₆ + q·Δ ) )"], "a: 최신 실측의 몫(45분 뒤 약 1/3). q: 수준 보정의 몫(3시간 뒤 약 1/3)");
  fcard(s, 6.78, 1.72, 6.05, 1.55, "③ 태양광 — 유효한 청천 지수", ["rᵢ = clip( Pᵢ / Cᵢ ,  0 ,  1.1 )"], "현재 실측이 유효하고 청천 출력 Cₒ 가 정격의 8% 이상일 때만 계산한다(해 뜰 무렵·질 무렵의 불안정한 비율 제외)");
  fcard(s, 6.78, 3.4, 6.05, 1.7, "④ 태양광 참조", ["R_P(h) = clip( Cₒ₊ₕ · ( 0.7·rₒ + 0.3·median(r) ) ,  0 ,  P정격 )"], "최근 3개 구간 중 조건을 통과한 값만 쓴다. 미래 청천 출력이 정격의 2% 미만인 구간(밤)은 보정하지 않는다", { fs: 12 });
  note(s, 0.5, 5.25, 12.33, 1.42, "왜 이렇게 단순한가", ["가까운 미래에 대해서는 '방금 잰 값이 이어진다'는 가정이 가장 강한 기준선이다. 복잡한 모델을 더하기보다 이 기준선을 검증된 비율로 섞는 편이 자료가 적은 현장에서 안전하다.", "참조는 발행 시점까지의 측정값만 쓴다(미래를 보지 않는다 — 시험으로 확인)."]);
  foot(s, "h 는 15분 단위 선행 구간(1~96). 식의 상수(3, 12, 0.7, 0.3, 8%, 2%)는 코드의 고정값이며 현장 자료로 다시 맞출 수 있다."); }
{ const s = page(5, "결합 식과 보정량 응답면", "예측과 참조의 차이에 가중치와 감쇠를 곱한 만큼 예측을 옮긴다 — 예측 구간도 같은 양만큼 함께 옮긴다",
    "결합 식과, 실제 결합 함수의 출력으로 그린 응답면입니다. 왼쪽이 부하, 오른쪽이 태양광입니다. 태양광은 첫 1시간 동안 영향이 빠르게 줄도록 감쇠를 둡니다.");
  m3d(s, "now", 0.5, 1.72, 7.6, "보정량 δ 의 응답면(부하·태양광)");
  fcard(s, 8.3, 1.72, 4.53, 1.6, "① 보정량", ["βₕ = Mₕ · w_b · tₕ", "δₕ = βₕ · ( Rₕ − ŷₕ )"], "M: 실측 유효(0/1), w: 구간 가중치, t: 태양광 첫 4구간 감쇠 1·0.6·0.3·0.15(그 밖은 1)");
  fcard(s, 8.3, 3.45, 4.53, 1.5, "② 중앙값과 구간", ["ŷ′ₕ = clip( ŷₕ + δₕ ,  0 ,  상한 )", "[ lo + δ ,  hi + δ ]  → 물리 범위로 제한"], "상한은 태양광 정격(부하는 없음). 옮긴 중앙값이 구간 안에 오도록 맞춘다");
  note(s, 8.3, 5.08, 4.53, 1.62, "그림 읽는 법", [`부하 w = [${E.viz.nowcast.load.w.join(", ")}], 태양광 w = [${E.viz.nowcast.pv.w.join(", ")}] (첫 시험 세트에서 채택된 값).`, "R = ŷ 이면 보정 0(회색 면). 구간 경계에서 면이 꺾인다."]);
  foot(s, "응답면은 nowcast.blend 에 기존 예측 100 kW, 참조 차이 −50~+50 kW 를 넣어 계산한 값이다(15분~4시간)."); }

// ═══ 6. 지속 학습
{ const s = page(6, "지속 학습 — 다시 배우고, 검증해서, 통과한 것만", "현장이 바뀌면 모델도 바뀌어야 한다 — 그러나 검증 없이 바꾸지는 않는다",
    "운용하면서 자료가 쌓이면 다시 학습합니다. 새 모델은 학습에 쓰지 않은 최근 3일로 현재 모델과 겨뤄서 이길 때만 적용합니다.");
  steps(s, 0.5, 1.72, 12.33, 1.5, [["자료 점검", "행 수·결측·값 고정 비율이 기준에 못 미치면 학습하지 않는다"], ["도전 모델 학습", "최근 3일을 빼고 학습(릿지·주의집중·α 모두)"], ["검증", "그 3일에서 현재 모델과 같은 방법으로 채점"], ["적용 판단", "부하·태양광 따로. 이긴 종류만 적용. 단기 실측 가중치도 이때 함께 정해 판(버전)에 기록"], ["보관·되돌리기", "이전 판 10개 보관, 한 번에 되돌림"]]);
  fcard(s, 0.5, 3.38, 4.0, 1.5, "① 검증 점수", ["NMAE = (1/N) Σ | ŷₜ − yₜ | / S"], "S: 부하는 평균 부하, 태양광은 설비 용량(낮 구간만). 6시간 간격으로 24시간 예측을 발행해 잰다", { ds: 9.5 });
  fcard(s, 4.665, 3.38, 4.0, 1.5, "② 교체 규칙", ["교체  ⇔  NMAE(새) ≤ NMAE(현재) − δ", "NMAE(적용 중) > 15%  ⇒  규칙 운전"], "δ: 최소 개선 폭(기본 0). 한도를 넘으면 계획 운전을 쉬고 경보", { ds: 9.5 });
  fcard(s, 8.83, 3.38, 4.0, 1.5, "③ 최근 오차 보정", ["ŷ′(h) = ŷ(h) + b · e^(−(h−1)/τ)        (부하)", "ŷ′(h) = ŷ(h) · (1 + (ρ−1) · e^(−(h−1)/τ))   (태양광)"], "b, ρ: 직전 2시간의 오차 평균·비율. τ = 2시간. 검증에서 도움이 될 때만 켠다", { fs: 11, ds: 9.5 });
  const C2 = LE.cycles, DR = LE.drift, row = (lab, k, kn) => [lab, kn, pc(k.current), pc(k.new), k.better ? "교체" : "유지"];
  table(s, 0.5, 5.05, 8.17, ["상황 (합성 자료)", "종류", "현재 모델", "새 모델", "판단"], [row("45일째 주기", C2[1].kinds.load, "부하"), row("45일째 주기", C2[1].kinds.pv, "태양광"), row("60일째 주기", C2[2].kinds.load, "부하"), row("부하 30% 증가 뒤", DR.kinds.load, "부하")], [30, 14, 19, 19, 18], { bold: [0], center: [1, 2, 3, 4], rowH: 0.3, fs: 10 });
  note(s, 8.83, 5.05, 4.0, 1.5, "안전장치", ["학습은 별도 프로세스. 실패하면 현재 모델 유지.", "모델을 다시 읽으면 운전 계획도 반드시 다시 계산.", "가중치 기록이 없는 이전 판 모델은 기존 예측 사용."]);
  foot(s, "표는 docs/ppt/ai_learn_eval.py 의 결과(자료가 30·45·60일로 쌓일 때의 학습 주기와, 부하가 30% 늘어난 경우). " + SYN); }

// ═══ 7. 평가
{ const s = page(7, "기본 예측기의 평가 방법과 결과", `앞 ${E.data.train_days}일로 학습, 뒤 ${E.data.test_days}일로 시험 — 2시간마다 24시간 예측을 ${E.data.issues}회 발행`,
    "학습에 쓰지 않은 14일로 잰 결과입니다. 가장 단순한 방법인 전일 같은 시각과 비교했습니다.");
  table(s, 0.5, 1.72, 12.33, ["대상", "방법", "24시간 오차", "2시간 이내 오차", "기준선 대비(24시간)", "기준선 대비(2시간 이내)", "80% 구간 포함률"],
    [["부하", "전일 같은 시각 (기준선)", pc(E.load.base), pc(E.load.base_near), "—", "—", "—"], ["부하", "릿지 회귀", pc(E.load.nmae), pc(E.load.near), cut(E.load.base, E.load.nmae) + "% 감소", cut(E.load.base_near, E.load.near) + "% 감소", E.load.cov + "%"],
     ["태양광", "전일 같은 시각 (기준선)", pc(PV[0].base), pc(PV[0].base_near), "—", "—", "—"]].concat(PV.map(p => ["태양광", p.name, pc(p.nmae), pc(p.near), cut(p.base, p.nmae) + "% 감소", cut(p.base_near, p.near) + "% 감소", p.cov + "%"])), [9, 23, 13, 14, 15, 15, 11], { bold: [0], center: [2, 3, 4, 5, 6], rowH: 0.3, fs: 10.5 });
  chart(s, "pv_h", 0.5, 4.0, 5.3); chart(s, "load_h", 5.93, 4.0, 5.3);
  note(s, 11.36, 4.0, 1.47, 2.74, "요점", ["가까울수록 효과가 크다.", "반나절 뒤는 차이가 작다."]);
  foot(s, "오차 = 평균 절대 오차 ÷ 기준값(부하: 평균 부하 " + E.data.mean_load + " kW, 태양광: 설비 용량 " + E.data.kwp + " kW, 낮 구간만). " + SYN); }
{ const s = page(7, "기본 예측기 결과 읽기 — 어디서 좋아지고 어디서 그대로인가", "카메라와 주의집중은 2시간 이내를 줄인다 — 하루 뒤의 날씨는 하늘 사진만으로 알 수 없다",
    "결과를 과장 없이 정리했습니다. 가까운 예측은 분명히 좋아지지만 먼 예측은 거의 그대로입니다.");
  chart(s, "att_w", 0.5, 1.72, 6.1);
  table(s, 6.8, 1.72, 6.03, ["태양광 2시간 이내 오차", "값", "앞 단계 대비"], PV.map((p, i) => [p.name, pc(p.near), i === 0 ? "기준선 대비 " + cut(p.base_near, p.near) + "% 감소" : cut(PV[i - 1].near, p.near) + "% 감소"]), [42, 20, 38], { bold: [0], center: [1, 2], rowH: 0.36, fs: 10.5 });
  note(s, 6.8, 3.35, 6.03, 1.52, "좋아지는 곳", [`1시간 이내: ${pc(PV[0].by_h[0])} → ${pc(P3.by_h[0])} (${cut(PV[0].by_h[0], P3.by_h[0])}% 감소). 2시간 이내: ${pc(PV[0].by_h[1])} → ${pc(P3.by_h[1])}.`, "ESS 충·방전과 발전기 기동 판단은 바로 이 구간의 예측에 기댄다."]);
  note(s, 6.8, 5.0, 6.03, 1.7, "그대로인 곳", [`4시간 이후는 차이가 없다(24시간 전체 ${pc(PV[0].nmae)} → ${pc(P3.nmae)}).`, "α 가 0 인 구간에서는 주의집중을 쓰지 않으므로 나빠지지도 않는다.", "먼 예측을 줄이려면 외부 기상 예보가 필요하다 — 폐쇄망 조건에서는 받을 수 없다."]);
  T(s, "왼쪽: 한 번의 예측에서 가중치가 큰 기억 40건. 가중치가 고르게 퍼져 있어 한두 건의 특이한 날에 끌려가지 않는다.", { x: 0.5, y: 4.95, w: 6.1, h: 0.5, fontSize: 10.5, color: INK });
  table(s, 0.5, 5.55, 6.1, ["비용 (노트북 CPU)", "값"], [["태양광 모델 학습", E.cost.train_pv_s + "초"], ["24시간 예측 한 번(부하+태양광)", E.cost.predict_s + "초"], ["모델 파일", `부하 ${E.cost.load_kb} KB · 태양광 ${E.cost.pv_kb} KB`]], [60, 40], { rowH: 0.29, fs: 10, center: [1] });
  foot(s, SYN); }

{ const s = page(7, "단기 실측 앙상블의 독립 시험", `합성 자료 ${BN.seeds.length}세트 · 학습 ${BN.fit_days}일, 가중치 선택 ${BN.tune_days}일, 시험 ${BN.test_days}일(${BN.origins}회 발행) — 합성 카메라 열은 빼고 쟀다`,
    "가중치를 고른 구간과 시험 구간을 나눠 여섯 세트로 다시 쟀습니다. 합성 카메라 열은 미래 구름을 참조해 만든 것이라 이 시험에서는 뺐습니다.");
  const nm = k => k === "pv" ? "태양광" : "부하", f3 = v => v.toFixed(2), rows = [...BN.rows].sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.seed - b.seed);
  table(s, 0.5, 1.72, 6.55, ["시드 · 대상", "가중치", "15분", "1시간 누적", "24시간 누적", "15분 변화"], rows.map(r => [`${r.seed} · ${nm(r.kind)}`, r.w.join(" / "), `${f3(r.nmae["15m"][0])} → ${f3(r.nmae["15m"][1])}`, `${f3(r.nmae["1h"][0])} → ${f3(r.nmae["1h"][1])}`, `${f3(r.nmae["24h"][0])} → ${f3(r.nmae["24h"][1])}`, r.nmae["15m"][0] === r.nmae["15m"][1] ? "미적용" : cut(r.nmae["15m"][0], r.nmae["15m"][1]) + "% 감소"]), [17, 19, 17, 17, 17, 13], { bold: [0], center: [1, 2, 3, 4, 5], rowH: 0.31, fs: 9.2 });
  chart(s, "bench15", 7.23, 1.72, 5.6);
  note(s, 7.23, 4.75, 5.6, 1.92, "재점검 결과", [`15분 오차: 부하 평균 ${BA.load.cut15_mean}%(${BA.load.cut15_min}~${BA.load.cut15_max}%), 태양광 평균 ${BA.pv.cut15_mean}%(${BA.pv.cut15_min}~${BA.pv.cut15_max}%) 감소. 나빠진 세트는 없다.`, "부하 한 세트는 조건을 통과한 가중치가 없어 적용하지 않았다(0%) — 도움이 안 되면 쓰지 않는다.", "24시간 누적은 사실상 같다."]);
  foot(s, "NMAE(%): 부하는 시험 기간 평균 부하, 태양광은 설비 용량 400 kW 기준(낮 구간만). 재현: python -m tools.forecast_benchmark --out 결과.json. " + SYN); }
{ const s = page(7, "예측 구간 포함률 — 재점검과 개선", "한 번 보정한 구간은 날씨가 바뀌면 좁아졌다 — 운용처럼 매일 다시 맞추고 변동 여유를 주면 80% 부근으로 모인다",
    "예측 구간이 실제 값을 얼마나 덮는지 다시 쟀습니다. 학습 때 한 번만 보정하면 세트에 따라 50%대까지 떨어졌습니다. 매일 다시 보정하고 변동 여유를 주어 80% 부근으로 맞췄습니다.");
  chart(s, "cov24", 0.5, 1.72, 7.0);
  table(s, 7.7, 1.72, 5.13, ["24시간 포함률", "한 번 보정", "매일 보정 + 변동 여유"], [["부하 (최소~최대)", `${BA.load.cov24_static[0]} ~ ${BA.load.cov24_static[1]}%`, `${BA.load.cov24[0]} ~ ${BA.load.cov24[1]}%`], ["부하 (평균)", BA.load.cov24_static[2] + "%", BA.load.cov24[2] + "%"], ["태양광 (최소~최대)", `${BA.pv.cov24_static[0]} ~ ${BA.pv.cov24_static[1]}%`, `${BA.pv.cov24[0]} ~ ${BA.pv.cov24[1]}%`], ["태양광 (평균)", BA.pv.cov24_static[2] + "%", BA.pv.cov24[2] + "%"], ["넓힌 배율 s (세트 평균)", "1", `부하 ${BA.load.scale[0]}~${BA.load.scale[1]} · 태양광 ${BA.pv.scale[0]}~${BA.pv.scale[1]}`]], [34, 28, 38], { bold: [0], center: [1, 2], rowH: 0.36, fs: 10 });
  note(s, 7.7, 4.02, 5.13, 1.5, "무엇을 고쳤나", ["원인 ①: 시험은 학습 8~22일 뒤의 구간을 쟀다. 실제 운용은 학습 주기(24시간)마다 구간을 다시 맞춘다 → 시험도 그렇게 재도록 고쳤다.", "원인 ②: 날씨 성질이 바뀌는 시기에는 지난 오차로 만든 구간이 좁다 → 변동 여유 s 를 넣었다."]);
  note(s, 7.7, 5.62, 5.13, 1.1, "남은 점", ["가까운 구간(15분~1시간)의 태양광 포함률은 90% 안팎으로 넓게 나온다 — 넓은 쪽이라 운전에는 보수적이다."]);
  foot(s, `1회 예측 계산 시간(중앙값): 부하 ${Math.max(...BN.rows.filter(r => r.kind === "load").map(r => r.ms)).toFixed(0)} ms 이하, 태양광 ${Math.max(...BN.rows.filter(r => r.kind === "pv").map(r => r.ms)).toFixed(0)} ms 이하(주의집중은 카메라 열이 없으면 쉬는 경우가 많다). ` + SYN); }

// ═══ 8. 한계 · 결론
{ const s = page(8, "한계와 다음 단계", "지금까지는 합성 자료로 확인했다 — 실제 효과는 현장 자료로 다시 재야 한다",
    "이 자료의 한계를 분명히 밝힙니다.");
  table(s, 0.5, 1.72, 12.33, ["한계", "내용", "다음 단계"], [
    ["합성 자료", "모든 수치는 씨앗을 고정한 합성 현장 자료 결과다. 실제 부하·날씨는 더 불규칙하다.", "시험 운용 자료로 같은 평가를 다시 수행"],
    ["카메라 가정", "합성 자료에는 '카메라가 15~30분 뒤 구름을 미리 본다'는 가정이 들어 있다. 실제 선행 시간은 구름 높이·풍속에 따라 다르다.", "현장 카메라 사진으로 선행 시간과 효과 측정"],
    ["구름 판정", "붉은빛·푸른빛 비율과 고정 경계값만 쓴다. 태양 주변 눈부심·렌즈 오염·박무에 약하다.", "현장 사진으로 경계값 보정, 태양 주변 가림 처리"],
    ["먼 예측", "외부 기상 예보를 쓰지 않으므로 반나절 이후는 계절·최근 추세 수준이다.", "보안 절차가 허용하면 예보 자료 입력 경로 검토"],
    ["운전 효과", "예측 정확도만 쟀다. 연료 소비·발전기 기동 횟수·ESS 여유에 주는 효과는 재지 않았다.", "모의 운전과 현장 시험에서 기동 횟수·ESS 여유·계획 실패 후 복귀 측정"],
    ["모델 규모", "가벼운 통계 모델이다(학습 값 158개). 대형 신경망이 아니며 글·영상을 이해하지 않는다.", "현장 자료가 충분히 쌓인 뒤 필요성 재검토"]], [14, 54, 32], { bold: [0], rowH: 0.54, fs: 10.2 });
  note(s, 0.5, 5.82, 12.33, 0.9, "그래도 안전한 이유", ["예측이 틀려도 예비력 규칙(N-1)과 충전율 하한이 따로 동작한다. 정확도가 한도(15%)를 넘으면 계획 운전을 쉬고 규칙 운전으로 넘어가며 경보를 낸다."]); }

{ const s = page(8, "결론과 운전 적용 기준", "가까운 예측은 분명히 좋아졌고, 구간은 믿을 만해졌다 — 먼 예측과 현장 효과는 실측으로 확인할 일이다",
    "결론입니다. 15분에서 2시간 사이의 예측이 좋아졌고 예측 구간이 목표 부근으로 맞춰졌습니다. 하루 뒤의 예측은 그대로이며, 실제 효과는 현장 자료로 확인해야 합니다.");
  stat(s, 0.5, 1.72, 2.9, 1.05, "부하 15분 오차 감소(평균)", String(BA.load.cut15_mean), "%"); stat(s, 3.57, 1.72, 2.9, 1.05, "태양광 15분 오차 감소(평균)", String(BA.pv.cut15_mean), "%");
  stat(s, 6.64, 1.72, 2.9, 1.05, "태양광 24시간 포함률", `${BA.pv.cov24[0]}~${BA.pv.cov24[1]}`, "%"); stat(s, 9.71, 1.72, 3.12, 1.05, "24시간 오차 변화", "거의 없음", "");
  table(s, 0.5, 3.0, 12.33, ["운전 적용 기준", "내용"], [["예측의 역할", "예측값은 운전 계획의 입력이다. 예비력(N-1)과 충전율 제약은 예측과 무관하게 기존 운전 논리가 지킨다."], ["실측 보정의 범위", "선행 4시간까지만. 최근 실측이 없거나 검증을 통과한 가중치가 없으면 기존 예측을 쓴다."], ["구간의 쓰임", "운전 계획은 구간의 보수적인 쪽(부하 위, 태양광 아래)을 본다. 구간은 학습 주기마다 다시 맞춘다."], ["정확도 한도", "적용 중인 모델의 오차가 15%를 넘으면 계획 운전을 쉬고 규칙 운전으로 넘어가며 경보를 낸다."], ["다음 검증", "현장 이력으로 기간을 나눠 같은 기준으로 재시험. 시간대·계절별 오차와 포함률, 발전기·ESS 의 실제 효과 확인."]], [20, 80], { bold: [0], rowH: 0.52, fs: 10.8 });
  foot(s, SYN); }

// ═══ 맺음
pres.addSection({ title: "맺음" });
{ const s = pres.addSlide({ masterName: "CLOSING", sectionTitle: "맺음" });
  s.addText("작고, 설명할 수 있고,\n검증된 만큼만 쓰는 예측", { placeholder: "title" }); s.addText("릿지 회귀 · 하늘 카메라 · 주의집중 · 단기 실측 앙상블 · 지속 학습", { placeholder: "sub" });
  s.addText("한화에어로스페이스㈜ 에너지솔루션사업센터", { placeholder: "org" }); s.addText(`${YM}  ·  ${REV}`, { placeholder: "date" }); }
pres.writeFile({ fileName: OUT }).then(async () => { await applyTheme(OUT, THEME); console.log("saved", OUT); });
