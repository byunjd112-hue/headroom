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
const REMAP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
const SECS = [["개요", "OVERVIEW"], ["자료 · 특징", "DATA & FEATURES"], ["릿지 회귀 · 예측 구간", "RIDGE REGRESSION & INTERVALS"], ["하늘 카메라 · 주의집중", "SKY CAMERA & ATTENTION"], ["지속 학습", "CONTINUAL LEARNING"], ["평가", "EVALUATION"], ["한계 · 과제", "LIMITS & NEXT STEPS"]];
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
const SYN = "수치는 합성 현장 자료(씨앗 고정) 결과다. 실제 효과는 현장 자료로 다시 재야 한다.";
const foot = (s, t) => T(s, t, { x: 0.5, y: 6.82, w: 12.33, h: 0.2, fontSize: 8.5, color: GRAY, valign: "middle" });

// ═══ 표지 · 목차
pres.addSection({ title: "표지·목차" });
{ const s = pres.addSlide({ masterName: "COVER", sectionTitle: "표지·목차" });
  s.addText("IFPS · Integrated Field Power System", { placeholder: "kicker" }); s.addText("이동형 EMS AI 예측 기술자료", { placeholder: "title" });
  s.addText("Load & PV Forecasting — Ridge Regression, Sky-Camera Cloud Cover, Attention, Continual Learning", { placeholder: "en" });
  s.addText("수식 · 학습된 모델의 입체 그림 · 검증 결과  |  부하·태양광 24시간 예측", { placeholder: "tag" });
  s.addText(`한화에어로스페이스㈜ 에너지솔루션사업센터   |   ${YM}   |   ${REV}`, { placeholder: "org" }); }
{ const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "표지·목차" });
  s.addText("목", { placeholder: "secno" }); s.addText("목차", { placeholder: "sec" }); s.addText("CONTENTS", { placeholder: "secen" }); s.addText("목차", { placeholder: "title" }); s.addText("예측 한 번이 만들어지는 순서대로 설명한다", { placeholder: "sub" });
  SECS.forEach(([k, en], i) => { const x = 0.5 + (i % 4) * 3.1, y = 1.8 + Math.floor(i / 4) * 2.45; card(s, x, y, 2.9, 2.2, `${i + 1}. ${k}`, "", { ts: 14 }); T(s, en, { x: x + 0.16, y: y + 0.42, w: 2.6, h: 0.22, fontSize: 9, bold: true, color: GOLD });
    T(s, ["무엇을 왜 예측하나 · 전체 구조와 규모", "입력 자료 · 청천 출력 · 특징 20개와 18개", "가중치 구하는 식 · 학습된 평면 · 10~90% 구간", "구름량 판독 · 닮은 과거 찾기 · 섞는 비율", "다시 배우고 검증해 통과한 것만 적용", "시험 14일의 오차 · 기준선과 비교", "합성 자료의 한계 · 현장 검증 계획"][i], { x: x + 0.16, y: y + 0.72, w: 2.6, h: 1.3, fontSize: 11.5 }); });
  card(s, 0.5 + 3 * 3.1, 1.8 + 2.45, 2.9, 2.2, "그림 읽는 법", "입체 그림은 꾸민 그림이 아니다. 학습된 값(가중치·거리·비율)을 그대로 3차원에 놓고 그린 것이다. 그림마다 대응하는 수식 기호를 적었다.", { ts: 14, bs: 11, fill: WHITE }); }

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
  note(s, 0.5, 3.95, 6.0, 1.3, "전처리", ["15분 격자로 다시 놓는다(빠진 구간은 앞 값으로, 구름량은 비워 둠).", "최근 120일까지 사용. 값이 멈춘 자료·결측이 많은 자료로는 학습하지 않는다."]);
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
  fcard(s, 8.3, 3.35, 4.53, 1.5, "② 구간과 보수적 계획", ["[ (r̂ + q₁₀) , (r̂ + q₉₀) ] × P_clear", "계획용 = 중앙 ∓ κ · (중앙 − 경계)"], "κ: 배치 초기에 크게, 자료가 쌓이면 작게. 부하는 위쪽, 태양광은 아래쪽 경계를 쓴다");
  note(s, 8.3, 4.98, 4.53, 1.72, "측정 결과", [`80% 구간에 실제 값이 든 비율(시험 ${E.data.test_days}일): 부하 ${E.load.cov}%, 태양광 ${P3.cov}%.`, "목표는 80% 부근 — 낮으면 구간이 좁고(과신), 높으면 넓다(쓸모가 줄어듦)."]);
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

// ═══ 5. 지속 학습
{ const s = page(5, "지속 학습 — 다시 배우고, 검증해서, 통과한 것만", "현장이 바뀌면 모델도 바뀌어야 한다 — 그러나 검증 없이 바꾸지는 않는다",
    "운용하면서 자료가 쌓이면 다시 학습합니다. 새 모델은 학습에 쓰지 않은 최근 3일로 현재 모델과 겨뤄서 이길 때만 적용합니다.");
  steps(s, 0.5, 1.72, 12.33, 1.5, [["자료 점검", "행 수·결측·값 고정 비율이 기준에 못 미치면 학습하지 않는다"], ["도전 모델 학습", "최근 3일을 빼고 학습(릿지·주의집중·α 모두)"], ["검증", "그 3일에서 현재 모델과 같은 방법으로 채점"], ["적용 판단", "부하·태양광 따로. 이긴 종류만 전체 자료로 다시 학습해 적용"], ["보관·되돌리기", "이전 판 10개 보관, 한 번에 되돌림"]]);
  fcard(s, 0.5, 3.38, 4.0, 1.5, "① 검증 점수", ["NMAE = (1/N) Σ | ŷₜ − yₜ | / S"], "S: 부하는 평균 부하, 태양광은 설비 용량(낮 구간만). 6시간 간격으로 24시간 예측을 발행해 잰다", { ds: 9.5 });
  fcard(s, 4.665, 3.38, 4.0, 1.5, "② 교체 규칙", ["교체  ⇔  NMAE(새) ≤ NMAE(현재) − δ", "NMAE(적용 중) > 15%  ⇒  규칙 운전"], "δ: 최소 개선 폭(기본 0). 한도를 넘으면 계획 운전을 쉬고 경보", { ds: 9.5 });
  fcard(s, 8.83, 3.38, 4.0, 1.5, "③ 최근 오차 보정", ["ŷ′(h) = ŷ(h) + b · e^(−(h−1)/τ)        (부하)", "ŷ′(h) = ŷ(h) · (1 + (ρ−1) · e^(−(h−1)/τ))   (태양광)"], "b, ρ: 직전 2시간의 오차 평균·비율. τ = 2시간. 검증에서 도움이 될 때만 켠다", { fs: 11, ds: 9.5 });
  const C2 = LE.cycles, DR = LE.drift, row = (lab, k, kn) => [lab, kn, pc(k.current), pc(k.new), k.better ? "교체" : "유지"];
  table(s, 0.5, 5.05, 8.17, ["상황 (합성 자료)", "종류", "현재 모델", "새 모델", "판단"], [row("45일째 주기", C2[1].kinds.load, "부하"), row("45일째 주기", C2[1].kinds.pv, "태양광"), row("60일째 주기", C2[2].kinds.load, "부하"), row("부하 30% 증가 뒤", DR.kinds.load, "부하")], [30, 14, 19, 19, 18], { bold: [0], center: [1, 2, 3, 4], rowH: 0.3, fs: 10 });
  note(s, 8.83, 5.05, 4.0, 1.5, "안전장치", ["학습은 별도 프로세스 — 제어 주기를 방해하지 않는다.", "학습이 실패해도 현재 모델을 그대로 쓴다."]);
  foot(s, "표는 docs/ppt/ai_learn_eval.py 의 결과(자료가 30·45·60일로 쌓일 때의 학습 주기와, 부하가 30% 늘어난 경우). " + SYN); }

// ═══ 6. 평가
{ const s = page(6, "평가 방법과 결과", `앞 ${E.data.train_days}일로 학습, 뒤 ${E.data.test_days}일로 시험 — 2시간마다 24시간 예측을 ${E.data.issues}회 발행`,
    "학습에 쓰지 않은 14일로 잰 결과입니다. 가장 단순한 방법인 전일 같은 시각과 비교했습니다.");
  table(s, 0.5, 1.72, 12.33, ["대상", "방법", "24시간 오차", "2시간 이내 오차", "기준선 대비(24시간)", "기준선 대비(2시간 이내)", "80% 구간 포함률"],
    [["부하", "전일 같은 시각 (기준선)", pc(E.load.base), pc(E.load.base_near), "—", "—", "—"], ["부하", "릿지 회귀", pc(E.load.nmae), pc(E.load.near), cut(E.load.base, E.load.nmae) + "% 감소", cut(E.load.base_near, E.load.near) + "% 감소", E.load.cov + "%"],
     ["태양광", "전일 같은 시각 (기준선)", pc(PV[0].base), pc(PV[0].base_near), "—", "—", "—"]].concat(PV.map(p => ["태양광", p.name, pc(p.nmae), pc(p.near), cut(p.base, p.nmae) + "% 감소", cut(p.base_near, p.near) + "% 감소", p.cov + "%"])), [9, 23, 13, 14, 15, 15, 11], { bold: [0], center: [2, 3, 4, 5, 6], rowH: 0.3, fs: 10.5 });
  chart(s, "pv_h", 0.5, 4.0, 5.3); chart(s, "load_h", 5.93, 4.0, 5.3);
  note(s, 11.36, 4.0, 1.47, 2.74, "요점", ["가까울수록 효과가 크다.", "반나절 뒤는 차이가 작다."]);
  foot(s, "오차 = 평균 절대 오차 ÷ 기준값(부하: 평균 부하 " + E.data.mean_load + " kW, 태양광: 설비 용량 " + E.data.kwp + " kW, 낮 구간만). " + SYN); }
{ const s = page(6, "결과 읽기 — 어디서 좋아지고 어디서 그대로인가", "카메라와 주의집중은 2시간 이내를 줄인다 — 하루 뒤의 날씨는 하늘 사진만으로 알 수 없다",
    "결과를 과장 없이 정리했습니다. 가까운 예측은 분명히 좋아지지만 먼 예측은 거의 그대로입니다.");
  chart(s, "att_w", 0.5, 1.72, 6.1);
  table(s, 6.8, 1.72, 6.03, ["태양광 2시간 이내 오차", "값", "앞 단계 대비"], PV.map((p, i) => [p.name, pc(p.near), i === 0 ? "기준선 대비 " + cut(p.base_near, p.near) + "% 감소" : cut(PV[i - 1].near, p.near) + "% 감소"]), [42, 20, 38], { bold: [0], center: [1, 2], rowH: 0.36, fs: 10.5 });
  note(s, 6.8, 3.35, 6.03, 1.52, "좋아지는 곳", [`1시간 이내: ${pc(PV[0].by_h[0])} → ${pc(P3.by_h[0])} (${cut(PV[0].by_h[0], P3.by_h[0])}% 감소). 2시간 이내: ${pc(PV[0].by_h[1])} → ${pc(P3.by_h[1])}.`, "ESS 충·방전과 발전기 기동 판단은 바로 이 구간의 예측에 기댄다."]);
  note(s, 6.8, 5.0, 6.03, 1.7, "그대로인 곳", [`4시간 이후는 차이가 없다(24시간 전체 ${pc(PV[0].nmae)} → ${pc(P3.nmae)}).`, "α 가 0 인 구간에서는 주의집중을 쓰지 않으므로 나빠지지도 않는다.", "먼 예측을 줄이려면 외부 기상 예보가 필요하다 — 폐쇄망 조건에서는 받을 수 없다."]);
  T(s, "왼쪽: 한 번의 예측에서 가중치가 큰 기억 40건. 가중치가 고르게 퍼져 있어 한두 건의 특이한 날에 끌려가지 않는다.", { x: 0.5, y: 4.95, w: 6.1, h: 0.5, fontSize: 10.5, color: INK });
  table(s, 0.5, 5.55, 6.1, ["비용 (노트북 CPU)", "값"], [["태양광 모델 학습", E.cost.train_pv_s + "초"], ["24시간 예측 한 번(부하+태양광)", E.cost.predict_s + "초"], ["모델 파일", `부하 ${E.cost.load_kb} KB · 태양광 ${E.cost.pv_kb} KB`]], [60, 40], { rowH: 0.29, fs: 10, center: [1] });
  foot(s, SYN); }

// ═══ 7. 한계 · 과제
{ const s = page(7, "한계와 다음 단계", "지금까지는 합성 자료로 확인했다 — 실제 효과는 현장 자료로 다시 재야 한다",
    "이 자료의 한계를 분명히 밝힙니다.");
  table(s, 0.5, 1.72, 12.33, ["한계", "내용", "다음 단계"], [
    ["합성 자료", "모든 수치는 씨앗을 고정한 합성 현장 자료 결과다. 실제 부하·날씨는 더 불규칙하다.", "시험 운용 자료로 같은 평가를 다시 수행"],
    ["카메라 가정", "합성 자료에는 '카메라가 15~30분 뒤 구름을 미리 본다'는 가정이 들어 있다. 실제 선행 시간은 구름 높이·풍속에 따라 다르다.", "현장 카메라 사진으로 선행 시간과 효과 측정"],
    ["구름 판정", "붉은빛·푸른빛 비율과 고정 경계값만 쓴다. 태양 주변 눈부심·렌즈 오염·박무에 약하다.", "현장 사진으로 경계값 보정, 태양 주변 가림 처리"],
    ["먼 예측", "외부 기상 예보를 쓰지 않으므로 반나절 이후는 계절·최근 추세 수준이다.", "보안 절차가 허용하면 예보 자료 입력 경로 검토"],
    ["모델 규모", "가벼운 통계 모델이다(학습 값 158개). 대형 신경망이 아니며 글·영상을 이해하지 않는다.", "현장 자료가 충분히 쌓인 뒤 필요성 재검토"]], [14, 54, 32], { bold: [0], rowH: 0.62, fs: 10.5 });
  note(s, 0.5, 5.75, 12.33, 0.95, "그래도 안전한 이유", ["예측이 틀려도 예비력 규칙(N-1)과 충전율 하한이 따로 동작한다. 정확도가 한도(15%)를 넘으면 계획 운전을 쉬고 규칙 운전으로 넘어가며 경보를 낸다."]); }

// ═══ 맺음
pres.addSection({ title: "맺음" });
{ const s = pres.addSlide({ masterName: "CLOSING", sectionTitle: "맺음" });
  s.addText("작고, 설명할 수 있고,\n검증된 만큼만 쓰는 예측", { placeholder: "title" }); s.addText("릿지 회귀 · 하늘 카메라 · 주의집중 · 지속 학습", { placeholder: "sub" });
  s.addText("한화에어로스페이스㈜ 에너지솔루션사업센터", { placeholder: "org" }); s.addText(`${YM}  ·  ${REV}`, { placeholder: "date" }); }
pres.writeFile({ fileName: OUT }).then(async () => { await applyTheme(OUT, THEME); console.log("saved", OUT); });
