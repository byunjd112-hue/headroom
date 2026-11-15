// IFPS 이동형 전력체계 EMS SW — 화면 구성·사용 설명 보고자료 (참고 PPT「작전지 종합전력공급체계」디자인 준용)
// node build_deck.js [Rev] [작성 연월] [출력.pptx]   — 보통은 docs/build_all.py 가 부른다
const fs = require("fs"), path = require("path"); const pptxgen = require("pptxgenjs");
const { applyTheme } = require("./apply_theme.js");
const EMS = path.join(__dirname, "..", ".."); const REV = process.argv[2] || "Rev00", YM = process.argv[3] || "2026. 11."; const ST = JSON.parse(fs.readFileSync(EMS + "/docs/static_results.json", "utf8")), DY = JSON.parse(fs.readFileSync(EMS + "/docs/test_results.json", "utf8"));
const OUT = process.argv[4] || path.join(EMS, "docs", "out", `IFPS_EMS_SW_화면구성_사용설명_보고자료_${REV}.pptx`); const IMG = n => path.join(__dirname, "img", n + ".jpg");
const THEME = { name: "IFPS 제안 발표", headFontFace: "맑은 고딕", bodyFontFace: "맑은 고딕",
  colors: { dk1: "2B2723", lt1: "FFFFFF", dk2: "35302A", lt2: "F9F1E6", accent1: "B59F76", accent2: "7B674F", accent3: "8A7449", accent4: "E0D7C8", accent5: "6F6B68", accent6: "B0392B", hlink: "8A7449", folHlink: "6F6B68" } };
const pres = new pptxgen(); pres.layout = "LAYOUT_WIDE"; pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "IFPS 이동형 전력체계 EMS SW 화면 구성 및 사용 설명"; pres.author = "한화에어로스페이스㈜ 에너지솔루션사업센터"; pres.company = "한화에어로스페이스㈜"; pres.subject = "EMS SW 보고자료";
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
    { text: { text: "한화에어로스페이스  |  이동형 전력체계 EMS SW 화면 구성·사용 설명", options: { x: 0.45, y: 7.05, w: 7, h: 0.3, fontSize: 8.5, color: GRAY, margin: 0, valign: "middle" } } },
    { placeholder: { options: { name: "secno", type: "body", x: 0.45, y: 0.11, w: 0.42, h: 0.4, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "sec", type: "body", x: 0.98, y: 0.07, w: 6.5, h: 0.28, fontSize: 16, bold: true, color: WHITE, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "secen", type: "body", x: 1.0, y: 0.34, w: 6.5, h: 0.22, fontSize: 9, bold: true, color: TAN, margin: 0, valign: "middle" }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.78, w: 12.3, h: 0.4, fontSize: 21, bold: true, color: INK, margin: 0, valign: "middle", align: "left" }, text: "" } },
    { placeholder: { options: { name: "sub", type: "body", x: 0.5, y: 1.2, w: 12.3, h: 0.32, fontSize: 12.5, bold: true, color: GOLD, margin: 0, valign: "middle", align: "left" }, text: "" } }],
  slideNumber: { x: 11.83, y: 7.05, w: 1.05, h: 0.3, fontSize: 9.5, bold: true, color: GRAY, align: "right" } });

// ── 구성 요소
const AI = JSON.parse(fs.readFileSync(__dirname + "/ai_eval.json", "utf8"));
const REMAP = { 1: 1, ai: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7 };
const SECS = [["개요", "OVERVIEW"], ["오프라인 학습 AI", "OFFLINE-TRAINED AI FORECAST"], ["화면 구성", "SCREEN COMPOSITION"], ["사용 방법", "OPERATION"], ["디버깅", "DEBUGGING TOOLS"], ["장치 연결", "DEVICE INTEGRATION"], ["신뢰성 결과", "RELIABILITY RESULTS"]];
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

// ═══ 표지 · 목차
pres.addSection({ title: "표지·목차" });
{ const s = pres.addSlide({ masterName: "COVER", sectionTitle: "표지·목차" });
  s.addText("작전지 종합전력공급체계(IFPS) ⑤ 이동형 전력체계 EMS", { placeholder: "kicker" }); s.addText("EMS SW 화면 구성 및 사용 설명", { placeholder: "title" });
  s.addText("Mobile EMS Software — Screens, Operation, Debugging, Integration, Reliability", { placeholder: "en" }); s.addText("오프라인 학습 AI 예측  ·  전개지·주둔지 겸용  ·  제어화면 8종  ·  현장 디버깅 도구  ·  실장비 연결 방법  ·  신뢰성 시험 결과", { placeholder: "tag" });
  [["대상 판", REV], ["제어화면", "8개 화면"], ["자동 시험", `${ST.n_tests}건 통과`]].forEach(([l, v], i) => { const x = 1.2 + i * 3.0;
    s.addShape(pres.ShapeType.rect, { x, y: 4.75, w: 2.75, h: 0.85, fill: { color: "FFFFFF", transparency: 88 }, line: { color: "FFFFFF", width: 0.75, transparency: 60 }, objectName: "표지 수치 " + l });
    T(s, l, { x, y: 4.83, w: 2.75, h: 0.26, fontSize: 9.5, color: "D8CBB4", align: "center", valign: "middle" }); T(s, v, { x, y: 5.09, w: 2.75, h: 0.42, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle" }); });
  s.addText(YM + "   한화에어로스페이스㈜  에너지솔루션사업센터", { placeholder: "org" });
  s.addNotes("이동형 전력체계 EMS 소프트웨어 " + REV + "의 화면 구성, 사용 방법, 디버깅 도구, 장치 연결 방법, 신뢰성 시험 결과를 보고합니다."); }
{ const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "표지·목차" });
  s.addText("", { placeholder: "secno" }); s.addText("목 차", { placeholder: "sec" }); s.addText("CONTENTS", { placeholder: "secen" }); s.addText("보고 순서", { placeholder: "title" }); s.addText("개요 → 오프라인 학습 AI → 화면 → 사용 → 디버깅 → 장치 연결 → 신뢰성 순으로 설명", { placeholder: "sub" });
  const D2 = ["EMS SW 구성과 특징", "현장 센서만으로 학습하는 24시간 예측과 정확도", "제어화면 8종의 구성과 보는 법", "설치·실행, 권한, 지령 절차", "화면 내 디버그 도구와 현장 간편 진단 도구", "설정 파일 2개, 지령·응답 규약, 시운전 절차", "정적·동적 시험 결과, 결함 보완, 후속 계획"];
  SECS.forEach(([nm], i) => { const cx = i % 2, r = Math.floor(i / 2), x = 0.75 + cx * 6.1, y = 1.78 + r * 1.22, hh = 1.02;
    s.addShape(pres.ShapeType.rect, { x, y, w: 0.72, h: hh, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "목차 번호 " + (i + 1) });
    T(s, String(i + 1), { x, y, w: 0.72, h: hh, fontSize: 26, bold: true, color: WHITE, align: "center", valign: "middle" });
    s.addShape(pres.ShapeType.rect, { x: x + 0.72, y, w: 4.98, h: hh, fill: { color: CREAM }, line: { color: LINE, width: 1 }, objectName: "목차 " + nm });
    T(s, nm, { x: x + 0.95, y: y + 0.16, w: 4.6, h: 0.36, fontSize: 17, bold: true, valign: "middle" }); T(s, D2[i], { x: x + 0.95, y: y + 0.55, w: 4.6, h: 0.3, fontSize: 11.5, color: GRAY, valign: "middle" }); }); }

// ═══ 1. 개요
{ const s = page(1, "EMS SW 한눈에 보기", "노트북 한 대로 실장비를 Modbus TCP 로 감시·제어 — 폐쇄망 단독 동작, 추가 설치는 Python 과 numpy 뿐",
    "EMS는 노트북 한 대에서 돌아가며 장비와는 Modbus TCP로 통신합니다. 외부망 없이 동작하고 의존성은 Python과 numpy뿐입니다.");
  [["감시 주기", "1", "초"], ["통신 두절 감지", f2(mx(DY.comm_lost_s)), "초 (한도 3.0)"], ["지령 응답 확인", f2(mx(DY.sbo_ack_s)), "초 (한도 1.5)"], ["연동 장비", "6", "종"]].forEach(([l, v, u], i) => stat(s, 0.5 + i * 3.1, 1.72, 2.95, 1.05, l, v, u));
  card(s, 0.5, 3.0, 4.0, 1.75, "감시", "장비 6종의 상태·전력·차단기를 1초마다 수집. 통신 경로 A·B 이중화, 범위 밖 값은 버리고 직전 값 유지. 경보는 4단계 우선순위로 발생·복귀·확인 관리.");
  card(s, 4.67, 3.0, 4.0, 1.75, "제어", "부하·태양광 24시간 예측으로 디젤·연료전지·수전해 투입을 계획(동적계획법). N-1 예비력 확보. 운용자 지령은 선택 후 실행(SBO) 2단계.");
  card(s, 8.83, 3.0, 4.0, 1.75, "기록·보안", "모든 로그인·지령·쓰기를 변조 검출이 되는 감사 기록에 남김. 접속은 허용 목록 안의 사설 주소만. 권한 3단계(조회·운용자·엔지니어).");
  tag(s, 0.5, 4.98, "함께 제공하는 것", 1.7);
  table(s, 0.5, 5.32, 12.33, ["구성", "용도", "실행"], [["제어화면(웹)", "운용·감시·지령·경보·디버그 8개 화면", "run_sim.bat(시연) / run_live.bat(실장비) → 브라우저"], ["현장 간편 진단 도구", "제어화면 없이 장비 통신을 7단계로 점검, 원인·조치 안내", "diag.bat"], ["현장 점검 명령(mbtool)", "레지스터 읽기·쓰기·주기 감시·장치 번호 찾기", "python -m ifps_ems_rt.mbtool …"], ["가상 장치", "장비 없이 전 기능 시연·교육·시험, 고장 주입", "--sim / --demo"]], [22, 44, 34], { bold: [0], rowH: 0.29 }); }
{ const s = page(1, "소프트웨어 구성", "판단(핵심 프로그램)과 통신(연동 계층)을 분리 — 장비마다 다른 내용은 설정 파일에서만 맞춤",
    "장비와 직접 통신하는 코드는 한 파일뿐이라 보안 검토 범위가 좁습니다. 장비가 바뀌어도 소스는 고치지 않고 설정 파일만 고칩니다.");
  const L = [["운용자 · 엔지니어", "브라우저(1920×1080 한 화면, 창 크기에 맞춰 통째로 축소)", CREAM, INK], ["제어화면 서버 · 실행 엔진", "화면 자료 제공, 권한·SBO, 경보 관리, 추세, 감사 기록, 디버그 도구", CREAM, INK],
    ["실장치 연동 계층  ifps_ems_rt", "1초 수집 · 0.5초 통신 감시 · 지령 전송과 응답 확인 · 대체 전원 · 이력 저장", BROWN, WHITE], ["핵심 프로그램  ifps_ems", "예측(부하·태양광) · 운전계획 · N-1 예비력 · 지령 전 검사 · 통신 판정 (통신 코드 없음)", BROWN, WHITE]];
  L.forEach(([t, d, fill, tc], i) => { const y = 1.75 + i * 0.86;
    s.addShape(pres.ShapeType.roundRect, { x: 0.5, y, w: 7.6, h: 0.72, rectRadius: 0.05, fill: { color: fill }, line: { color: fill === CREAM ? LINE : BROWN, width: 1 }, objectName: "계층 " + t });
    T(s, t, { x: 0.7, y: y + 0.07, w: 7.2, h: 0.28, fontSize: 13.5, bold: true, color: tc, valign: "middle" }); T(s, d, { x: 0.7, y: y + 0.36, w: 7.2, h: 0.28, fontSize: 10.5, color: tc === WHITE ? "EFE6D8" : GRAY, valign: "middle" });
    if (i < 3) T(s, "▼", { x: 4.1, y: y + 0.72, w: 0.4, h: 0.14, fontSize: 8, color: GOLD, align: "center", valign: "middle" }); });
  T(s, "Modbus TCP  ·  경로 A / 경로 B", { x: 0.5, y: 5.2, w: 7.6, h: 0.26, fontSize: 11, bold: true, color: GOLD, align: "center", valign: "middle" });
  ["DG\n디젤", "FC\n연료전지", "ESS\nPCS", "MTR\n계측·보호", "ELZ\n수전해", "PV\n인버터"].forEach((t, i) => { const x = 0.5 + i * 1.28;
    s.addShape(pres.ShapeType.roundRect, { x, y: 5.52, w: 1.2, h: 0.78, rectRadius: 0.05, fill: { color: WHITE }, line: { color: BROWN, width: 1.25 }, objectName: "장비 " + i });
    T(s, t, { x, y: 5.52, w: 1.2, h: 0.78, fontSize: 11, bold: true, color: DARK, align: "center", valign: "middle" }); });
  tag(s, 8.4, 1.75, "설정 파일 2개", 1.45);
  card(s, 8.4, 2.1, 4.43, 1.2, "config/runtime.json", "장비 IP·포트·장치 번호, 경로 A·B, 접속 허용 대역, 수집 주기, 장비별 바이트 순서·완료 한도", { bs: 11 });
  card(s, 8.4, 3.42, 4.43, 1.2, "config/pointmap.csv", "레지스터 주소, 기능 코드, 자료형(16/32/64비트), 배율, 단위, 정상 범위, 읽기·쓰기", { bs: 11 });
  note(s, 8.4, 4.8, 4.43, 1.5, "설계 원칙", ["① 통신 실패는 직전 값 유지와 지령 중지로", "② 계획 실패는 규칙 운전으로", "③ 어떤 내부 오류에도 감시 주기는 계속"]);
  T(s, "보호 차단·무순단 절체는 보호 IED 와 절체기가 수행한다. EMS 는 결과를 읽고 운전 지령만 낸다.", { x: 0.5, y: 6.5, w: 12.33, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }


// ═══ 2. 오프라인 학습 AI
const HL = ["1시간 이내", "1~2시간", "2~4시간", "4~8시간", "8~16시간", "16~24시간"]; const imp = (m, b) => Math.round((1 - m / b) * 100);
const chartOpt = (title, o = {}) => Object.assign({ barDir: "col", barGapWidthPct: 55, chartColors: [HX.accent2, HX.accent4], showTitle: true, title, titleFontSize: 12, titleColor: HX.dk1, titleFontFace: "+mn-lt",
  showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 9, dataLabelColor: HX.dk1, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0.0", catAxisLabelColor: HX.accent5, valAxisLabelColor: HX.accent5, catAxisLabelFontSize: 9.5, valAxisLabelFontSize: 9.5,
  catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valGridLine: { color: HX.accent4, size: 0.75 }, catGridLine: { style: "none" }, showLegend: true, legendPos: "b", legendFontSize: 10, legendColor: HX.accent5, legendFontFace: "+mn-lt" }, o);
{ const s = page("ai", "오프라인 학습 AI 한눈에", "외부 기상 예보·클라우드 없이 현장 센서 자료만으로 학습 — 24시간 앞의 부하와 태양광 발전을 15분 단위로 예측",
    "이 EMS의 예측 기능은 현장에서 쌓인 자료만으로 학습합니다. 외부망이 필요 없어 폐쇄망 작전 환경에 맞습니다.");
  [["예측 범위", "24", "시간 · 96구간"], ["부하 예측 오차", f1(AI.load.nmae), "% (24시간 평균)"], ["태양광 예측 오차", f1(AI.pv.nmae), "% (설비용량 대비)"], ["모델 크기", f1(AI.model_kb[0]), "KB × 2개"]].forEach(([l, v, u], i) => stat(s, 0.5 + i * 3.1, 1.72, 2.95, 1.05, l, v, u));
  card(s, 0.5, 3.0, 4.0, 2.0, "왜 '오프라인' 인가", "작전지는 폐쇄망이다. 기상청 예보도, 클라우드 연산도 쓸 수 없다. 그래서 학습과 예측을 모두 EMS 노트북 안에서 한다. 입력은 현장 계측값(부하, 태양광, 기온, 기압, 습도)뿐이다.", { bs: 11.5 });
  card(s, 4.67, 3.0, 4.0, 2.0, "무엇을 학습하나", "그 부대의 생활 주기(주간·야간, 요일, 작전 계획 단계)에 따른 부하 변화와, 그 지역 날씨 흐름(기압·습도 변화)에 따른 태양광 출력 변화. 현장마다 다시 학습해 그 현장에 맞춘다.", { bs: 11.5 });
  card(s, 8.83, 3.0, 4.0, 2.0, "어디에 쓰나", "예측값은 운전계획의 입력이다. 디젤·연료전지·수전해를 언제 넣고 뺄지를 24시간 앞까지 계산해 연료 소모와 야간 디젤 운전을 줄인다. 예측은 지령을 직접 내지 않는다.", { bs: 11.5 });
  table(s, 0.5, 5.22, 7.6, ["항목", "값", "뜻"], [["학습 시간", `${f1(AI.t_train_s)}초`, `${AI.train_days}일치(${AI.n_train_rows.toLocaleString()}줄) 기준, 노트북 CPU`], ["예측 1회 계산", `${Math.round(AI.t_pred_ms)} ms`, "부하·태양광 96구간, GPU 불필요"], ["필요 이력", "8일 이상", "그 전에는 전일 동시각 기준과 규칙 운전"]], [22, 18, 60], { bold: [0], center: [1], rowH: 0.36 });
  note(s, 8.35, 5.22, 4.48, 1.5, "기술 성격", ["기계학습(선형 회귀 계열) 기반 경량 모델", "심층 신경망이 아니어서 작고 빠르며 판단 근거를 설명할 수 있다", "수치는 합성 현장 자료 기준(2-3 참조)"]); }
{ const s = page("ai", "기술 구조", "15분 이력 → 특징 추출 → 선행시간 구간별 회귀 모델 → 전일 동시각과 결합 → 예측 구간 → 운전계획",
    "선행시간을 여섯 구간으로 나눠 구간마다 모델을 따로 학습합니다. 한 시간 뒤와 하루 뒤는 중요한 정보가 다르기 때문입니다.");
  steps(s, 0.5, 1.72, 12.33, 1.62, [["이력 수집", "1초 계측값을 15분 평균으로 쌓음(history.csv). 빈 구간은 15분 격자로 채움"], ["특징 추출", `부하 ${AI.n_feat.load}개 · 태양광 ${AI.n_feat.pv}개. 시각 주기, 최근 추이, 전일·전주 동시각, 기상 변화량`], ["구간별 회귀", "선행시간 6구간(1·2·4·8·16·24시간)마다 릿지 회귀 모델 1개씩"], ["결합", "모델 예측 80% + 전일 동시각 20% — 모델이 틀려도 크게 벗어나지 않게"], ["예측 구간", "최근 7일 오차의 10%~90% 분위수로 상·하한(분포 가정 없음)"]]);
  table(s, 0.5, 3.55, 6.07, ["부하 모델의 입력", "예"], [["시각 주기", "하루 주기의 sin·cos(3개 주파수), 일요일 여부"], ["최근 추이", "현재 부하, 최근 1시간·24시간 평균, 전일 대비 변화"], ["같은 시각", "전일·전주 동시각 부하"], ["외부 요인", "기온(현재·예상), 작전 계획 단계, 일사 가능량"]], [26, 74], { bold: [0], rowH: 0.36, fs: 10.5 });
  table(s, 6.76, 3.55, 6.07, ["태양광 모델의 입력", "예"], [["맑은 날 가능량", "위도·날짜·시각으로 계산한 출력(물리 모형)"], ["청천 지수", "실제 출력 ÷ 맑은 날 가능량. 최근 1·3시간·하루 평균과 변동"], ["기압 변화", "3·12·24시간 기압 변화 — 날씨가 바뀌는 조짐"], ["습도 · 기온", "현재값과 변화량"]], [26, 74], { bold: [0], rowH: 0.36, fs: 10.5 });
  card(s, 0.5, 5.55, 6.07, 1.2, "부하: 비율로 학습", "'기준 부하 대비 몇 배인가'를 학습한다. 부대 규모가 달라도 같은 구조를 쓰고, 현장 자료로 기준만 다시 잡는다.", { bs: 11 });
  card(s, 6.76, 5.55, 6.07, 1.2, "태양광: 물리 모형 × 학습", "해의 위치로 정해지는 부분은 계산하고, 구름·날씨로 달라지는 부분(청천 지수)만 학습한다. 적은 자료로도 안정적이다.", { bs: 11 }); }
{ const s = page("ai", "예측 정확도", `학습에 쓰지 않은 ${Math.round(AI.test_days)}일로 시험 — 6시간마다 ${AI.n_issue}회 발행한 24시간 예측을 실제값과 비교`,
    "정확도는 학습에 쓰지 않은 기간으로 평가했습니다. 비교 기준은 '어제 같은 시각과 같다'고 보는 단순 방법입니다.");
  s.addChart(pres.charts.BAR, [{ name: "학습 모델", labels: HL, values: AI.load.by_h }, { name: "전일 동시각(기준)", labels: HL, values: AI.load.base_by_h }], Object.assign({ x: 0.5, y: 1.72, w: 6.07, h: 3.0, objectName: "부하 오차 차트" }, chartOpt("부하 예측 오차 (평균 부하 대비 %)")));
  s.addChart(pres.charts.BAR, [{ name: "학습 모델", labels: HL, values: AI.pv.by_h }, { name: "전일 동시각(기준)", labels: HL, values: AI.pv.base_by_h }], Object.assign({ x: 6.76, y: 1.72, w: 6.07, h: 3.0, objectName: "태양광 오차 차트" }, chartOpt("태양광 예측 오차 (설비용량 대비 %, 주간)")));
  table(s, 0.5, 4.9, 7.9, ["지표", "부하", "태양광", "뜻"], [["24시간 평균 오차", `${AI.load.nmae}% (기준 ${AI.load.base}%)`, `${AI.pv.nmae}% (기준 ${AI.pv.base}%)`, "작을수록 정확"], ["기준 대비 개선", `${imp(AI.load.nmae, AI.load.base)}%`, `${imp(AI.pv.nmae, AI.pv.base)}% (1시간 이내 ${imp(AI.pv.by_h[0], AI.pv.base_by_h[0])}%)`, "전일 동시각 방법보다 줄어든 비율"],
    ["하루 전력량 오차", `${AI.load.day}% (기준 ${AI.load.day_base}%)`, `${AI.pv.day}% (기준 ${AI.pv.day_base}%)`, "24시간 합계의 오차"], ["예측 구간 포함률", `${AI.load.cov}%`, `${AI.pv.cov}%`, "실제값이 상·하한 안에 든 비율(목표 80%)"]], [22, 26, 28, 24], { bold: [0], center: [1, 2], rowH: 0.37, fs: 10.5 });
  note(s, 8.65, 4.9, 4.18, 1.86, "읽는 법과 한계", ["부하는 전 구간에서 기준보다 정확", "태양광은 가까운 시간일수록 이득이 크다. 하루 합계는 기준과 비슷한 수준", "합성 현장 자료(120일) 기준이다. 실제 현장 이력으로 다시 평가해야 한다"]); }
{ const s = page("ai", "예측이 운전에 주는 효과", `같은 ${AI.sim.rule.days}일을 규칙 운전과 예측 계획 운전으로 모의 — 연료 ${imp(AI.sim.plan.fuel_l, AI.sim.rule.fuel_l)}% 절감, 야간 디젤 운전 0시간`,
    "예측이 있으면 미리 충전해 두고 야간에는 디젤을 돌리지 않는 계획을 세울 수 있습니다.");
  const SM = AI.sim;
  s.addChart(pres.charts.BAR, [{ name: "디젤 연료 (L/일)", labels: ["규칙 운전", "예측 계획 운전", "완전 예측(참고 상한)"], values: [SM.rule.fuel_l_day, SM.plan.fuel_l_day, SM.perfect.fuel_l_day] }], Object.assign({ x: 0.5, y: 1.72, w: 5.6, h: 3.3, objectName: "연료 비교 차트" }, chartOpt("하루 평균 디젤 연료 소모 (L)", { chartColors: [HX.accent2], showLegend: false, dataLabelFormatCode: "0.0", valAxisMinVal: 0 })));
  table(s, 6.35, 1.72, 6.48, ["지표", "규칙 운전", "예측 계획", "완전 예측"], [["디젤 연료 합계", `${SM.rule.fuel_l.toLocaleString()} L`, `${SM.plan.fuel_l.toLocaleString()} L`, `${SM.perfect.fuel_l.toLocaleString()} L`], ["야간(20~06시) 디젤 운전", `${SM.rule.dg_silent_h} 시간`, `${SM.plan.dg_silent_h} 시간`, `${SM.perfect.dg_silent_h} 시간`], ["디젤 기동 횟수", `${SM.rule.dg_starts}회`, `${SM.plan.dg_starts}회`, `${SM.perfect.dg_starts}회`],
    ["부하 차단", `${SM.rule.shed_kwh} kWh`, `${SM.plan.shed_kwh} kWh`, `${SM.perfect.shed_kwh} kWh`], ["끝 시점 ESS 충전율", `${Math.round(SM.rule.soc_end * 100)}%`, `${Math.round(SM.plan.soc_end * 100)}%`, `${Math.round(SM.perfect.soc_end * 100)}%`]], [34, 22, 22, 22], { bold: [0], center: [1, 2, 3], rowH: 0.4, fs: 10.5 });
  card(s, 6.35, 4.3, 6.48, 0.98, "왜 줄어드나", "낮에 태양광이 남을 것을 알면 그 전에 디젤을 돌리지 않고, 밤 부하를 알면 해 지기 전에 충전해 둔다. 규칙 운전은 충전율이 떨어진 뒤에야 반응한다.", { bs: 10.5 });
  note(s, 0.5, 5.25, 5.6, 1.5, "예측 품질의 값어치", [`완전 예측 대비 연료 ${imp(SM.perfect.fuel_l, SM.plan.fuel_l) === 0 ? "차이 없음" : "+" + Math.round((SM.plan.fuel_l / SM.perfect.fuel_l - 1) * 100) + "%"} — 예측 오차가 운전에 주는 손실이 작다`, "예측 구간 상한(부하)·하한(태양광) 쪽으로 보수적으로 계획"]);
  note(s, 6.35, 5.45, 6.48, 1.3, "조건과 한계", ["논리 모형 모의(장비 동특성 없음), 합성 현장 자료, 계획은 1시간마다 재계산", `디젤 기동 횟수는 늘었다(${SM.rule.dg_starts} → ${SM.plan.dg_starts}회). 기동 손실은 비용에 반영했으나 정비 주기 영향은 별도 검토 필요`]); }
{ const s = page("ai", "학습·갱신 절차와 안전장치", "현장에서 명령 한 줄로 다시 학습 — 모델이 없거나 틀려도 운전은 계속되도록 여러 겹으로 보호",
    "학습은 현장에서 명령 한 줄로 합니다. 예측이 실패해도 규칙 운전으로 넘어가므로 운전은 멈추지 않습니다.");
  steps(s, 0.5, 1.72, 12.33, 1.5, [["이력 축적", "EMS 가 운전 중 15분 평균을 자동 저장. 8일부터 사용 가능"], ["학습", "python -m ifps_ems train <이력> <모델 폴더>  — 수 초"], ["모델 교체", "model_load.npz · model_pv.npz 두 파일. 다음 기동부터 적용"], ["확인", "발전·예측 화면의 예측 정밀도, 예측 vs 실측 그림"], ["주기적 갱신", "계절·부대 규모·작전 단계가 바뀌면 다시 학습"]]);
  table(s, 0.5, 3.45, 7.6, ["상황", "EMS 동작"], [["실측 이력 8일 미만(전개 직후)", "실장비는 규칙 운전. 예측 계획은 쓰지 않음"], ["모델 파일 없음", "전일 동시각 값으로 예측"], ["예측·계획 계산 실패", "그 주기는 규칙 운전으로 넘어가고 사건 기록"], ["예측이 크게 빗나감", "매 15분 실측 상태로 다시 판단, 충전율 하한 근처면 디젤 강제 기동"], ["전개 첫 7일", "보수 계수를 높여 부하는 더 높게, 태양광은 더 낮게 잡음"], ["이력에 빈 구간·깨진 줄", "15분 격자로 다시 놓고 읽을 수 없는 줄은 버림"]], [36, 64], { bold: [0], rowH: 0.37, fs: 10.5 });
  note(s, 8.35, 3.45, 4.48, 1.55, "보안·검증 관점", ["모델 파일은 숫자 배열만 담는다(실행 코드 없음)", "선형 모델이라 어떤 입력이 예측을 올렸는지 계수로 확인 가능", "예측은 운전계획의 입력일 뿐, 지령 전 검사·보호는 그대로 적용"]);
  note(s, 8.35, 5.15, 4.48, 1.6, "앞으로", ["현장 실측 이력으로 재학습·재평가", "태양광 하루 합계 정확도 개선(구름량 계측 추가 검토)", "예측 정확도 저하 시 자동 경보"]);
  T(s, "예측 정확도는 제어화면 [발전·예측] 에서 최근 7일 기준으로 항상 다시 계산해 보여 준다.", { x: 0.5, y: 6.25, w: 7.6, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }

// ═══ 3. 화면 구성
{ const s = page(2, "화면 체계", "계측 · 제어 · 관리 3묶음 8개 화면 — 모든 화면이 스크롤 없이 한 화면, 창을 줄이면 글과 그림이 같은 비율로 축소",
    "왼쪽 메뉴는 계측, 제어, 관리로 묶여 있습니다. 머리줄에는 운전 상태와 경보 수가 항상 보입니다.");
  shot(s, "overview", 0.5, 1.72, 6.9, [[1, 38, 300], [2, 640, 28], [3, 1175, 28], [4, 1500, 28], [5, 1640, 28], [6, 900, 1062]]);
  legend(s, 0.5, 5.72, 6.9 / 3 - 0.07, [[1, "왼쪽 메뉴", "계측 4 · 제어 1 · 관리 3, 미확인 경보 수"]], { rh: 0.74 });
  legend(s, 0.5 + 6.9 / 3 + 0.035, 5.72, 6.9 / 3 - 0.07, [[2, "운전 상태 칩", "운전 방식, 자동/수동, 통신, 운용 모드"]], { rh: 0.74 });
  legend(s, 0.5 + 2 * (6.9 / 3) + 0.07, 5.72, 6.9 / 3 - 0.07, [[3, "경보 수", "4단계. 누르면 경보 화면으로 이동"]], { rh: 0.74 });
  T(s, "④ 화면 색(주간·야간·네이비)   ⑤ 사용자·권한·로그인   ⑥ 최신 경보 띠와 서버 연결 상태", { x: 0.5, y: 6.55, w: 6.9, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" });
  table(s, 7.65, 1.72, 5.18, ["묶음", "화면", "용도"], [["계측", "개요", "전체 수급·배치·경보를 한눈에"], ["계측", "결선도", "모선·차단기·급전선 상태와 전력 흐름"], ["계측", "발전·예측", "24시간 예측, 예측 정확도, 일별 전력량"], ["계측", "추세", "전력·충전율·예비력 시간 그래프"], ["제어", "설비 제어", "장비 기동·정지·설정, 자동/수동, 부하 차단"], ["관리", "경보", "경보 목록·이력, 감사 기록"], ["관리", "통신 진단", "장비·경로별 통신 상태와 응답 시간"], ["관리", "디버그", "레지스터 읽기·쓰기, 통신 추적, 고장 주입"]], [14, 24, 62], { bold: [1], center: [0], rowH: 0.42, fs: 10.5 });
  note(s, 7.65, 5.72, 5.18, 1.0, "화면 공통", ["값 대신 #### 이 보이면 그 장비와 통신이 끊긴 것", "3.5초 넘게 갱신이 없으면 '서버 응답 없음' 경고"]); }
{ const s = page(2, "개요 화면", "지금 전력이 얼마나 쓰이고 만들어지는지, 어디에 문제가 있는지를 한 화면에서 확인",
    "개요 화면은 위쪽 지표 6개, 가운데 작전지 배치도, 오른쪽 현황 3개로 되어 있습니다.");
  shot(s, "overview", 0.5, 1.72, 7.9, [[1, 480, 165], [2, 760, 620], [3, 1690, 330], [4, 1690, 590], [5, 1690, 900]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "핵심 지표 6개", "총 부하, 태양광, ESS 충전율, 연료·수소 잔량, N-1 예비력, 자동 제어 상태와 다음 제어까지 남은 시간"], [2, "작전지 전개 현황", "장비·막사·배전함 배치와 케이블. 초록 운전, 회색 정지, 빨강 고장·두절. 흐르는 점선은 전력 흐름"],
    [3, "발전원 구성", "지금 부하를 어느 전원이 감당하는지와 재생에너지 비율"], [4, "발전·부하 현황", "전원별 출력과 최근 추이, ESS 충·방전 방향"], [5, "경보 매트릭스", "장비 × 우선순위별 경보 수. 숫자가 있는 칸이 살펴볼 곳"]], { rh: 0.8, gap: 0.08 });
  T(s, "지표 카드 아래 가는 선은 최근 추이다. N-1 예비력이 음수면 가장 큰 전원 하나가 빠질 때 1·2등급 부하를 감당하지 못한다는 뜻으로, EMS 가 연료전지를 병렬한다.", { x: 0.5, y: 6.28, w: 7.9, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(2, "결선도 화면", "전원 → 모선 A·B → 부하로 이어지는 단선결선도 — 차단기 상태, 전력 흐름, 보호 동작을 그대로 표시",
    "결선도는 전기 담당이 가장 익숙한 형태입니다. 차단기가 트립하면 빨간 표시와 보호요소 번호가 뜹니다.");
  shot(s, "sld", 0.5, 1.72, 7.9, [[1, 640, 480], [2, 700, 720], [3, 760, 610], [4, 1700, 300], [5, 1700, 640], [6, 1700, 960]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "전원 타일", "장비 그림, 현재 출력, 운전 상태. 정지는 흐리게, 고장은 붉게"], [2, "모선 A · B", "선이 밝으면 전압이 살아 있음. 가운데 연계 차단기로 두 모선을 묶음"], [3, "차단기 표시", "■ 투입 / □ 개방 / ✕ 트립. 트립이면 ANSI 보호요소(예: 51 한시 과전류) 표시"],
    [4, "모선 상태", "전압, 주파수, 발전·부하 합계, ESS 충·방전"], [5, "차단기 목록", "급전선별 상태. 부하 차단·복구는 설비 제어 화면에서"], [6, "전력 추세", "최근 15분 부하·전원별 출력"]], { rh: 0.68, gap: 0.07 });
  T(s, "보호 차단은 보호 IED 가 수행한다. EMS 는 게이트웨이를 통해 결과를 읽어 표시하고 경보를 낸다.", { x: 0.5, y: 6.3, w: 7.9, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(2, "발전·예측 화면", "24시간 앞의 부하와 태양광을 예측하고, 지난 예측이 얼마나 맞았는지 함께 보여 줌",
    "예측은 운전계획의 입력입니다. 예측 정확도는 과거 자료로 다시 계산해 본 결과입니다.");
  shot(s, "energy", 0.5, 1.72, 7.9, [[1, 900, 150], [2, 400, 420], [3, 1020, 420], [4, 1640, 420], [5, 400, 880], [6, 1330, 880]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "오늘 전력량", "태양광·디젤·연료전지 발전량, 부하, ESS 충·방전, 재생에너지 비율"], [2, "부하 예측", "굵은 선이 예측, 띠가 예측 구간, 세로선이 현재"], [3, "태양광 예측", "맑은 날 가능량 대비 예측"],
    [4, "예측 정밀도", `24시간 오차 부하 ${DY.forecast_acc.load_nmae}% · 태양광 ${DY.forecast_acc.pv_nmae}%, 구간 포함률`], [5, "예측 vs 실측", "점이 대각선에 가까울수록 정확"], [6, "시간대별·일별", "오늘 시간대별 전원 구성, 최근 14일 발전·부하"]], { rh: 0.68, gap: 0.07 });
  T(s, "실측 이력이 8일 미만이면 실장비에서는 예측 계획 대신 규칙 운전(충전율 기준)을 한다. 합성 자료로 세운 계획은 시연 모드에서만 쓴다.", { x: 0.5, y: 6.28, w: 7.9, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(2, "추세 화면", "1초 간격으로 4시간까지 보관 — 구간을 바꿔 보고 CSV 로 내보내기",
    "추세 화면은 사후 분석에 씁니다. 그래프 위에 마우스를 올리면 그 시각의 값이 나옵니다.");
  shot(s, "trends", 0.5, 1.72, 7.9, [[1, 1560, 88], [2, 900, 400], [3, 900, 860], [4, 1840, 88]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "구간 선택", "5분 · 15분 · 1시간 · 4시간"], [2, "전력 그래프", "부하(선)와 태양광·디젤·연료전지·ESS(면). 마우스를 올리면 값 표시"], [3, "충전율 · 예비력", "ESS 충전율(%)과 N-1 예비력 여유(kW)"], [4, "CSV 내보내기", "보관 중인 전체 추세를 표 파일로 저장"]], { rh: 0.78, gap: 0.09 });
  note(s, 8.65, 5.3, 4.18, 1.45, "이렇게 씁니다", ["고장 뒤: 발생 시각 전후의 전력·충전율 변화 확인", "시운전: 지령 뒤 출력이 따라오는 시간 확인", "보고: CSV 를 받아 표·그래프 작성"]);
  T(s, "15분 평균 이력은 history.csv 에 따로 쌓여 예측 모델 학습에 쓰인다.", { x: 0.5, y: 6.3, w: 7.9, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(2, "설비 제어 화면", "IFPS 6개 서브시스템의 8개 설비 카드 — 상태 확인과 지령을 한 화면에서",
    "설비 제어 화면은 장비 카드 8개와 오른쪽의 자동 제어, 차단기·부하 관리, 최근 지령으로 구성됩니다.");
  shot(s, "control", 0.5, 1.72, 7.9, [[1, 420, 300], [2, 250, 500], [3, 420, 780], [4, 1690, 250], [5, 1690, 640], [6, 1690, 960]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "설비 카드", "복합전력·ESS·PV·연료전지·수전해·EMS·배전 계측. 그림 위 띠가 운전 상태"], [2, "지령 단추", "기동·정지, 계통 연결·분리, 출력 설정. 누르면 선택-실행 창이 뜸"], [3, "상세 값", "모드(자동/수동), 연료, 지령 순번, 생존 신호, 통신 경로"],
    [4, "자동 제어", "AUTO/MANUAL 전환, 운전 정책, 다음 제어 시각, 최근 결정"], [5, "차단기 · 부하 관리", "2·3등급 부하 차단·복구. 1등급은 차단 불가"], [6, "최근 지령", "누가 언제 무엇을 지령했고 성공했는지"]], { rh: 0.68, gap: 0.07 });
  T(s, "지령 단추가 흐리면 지금 보낼 수 없는 상태다(통신 두절, 생존 신호 정지, 현장 수동, 이미 그 상태). 이유는 카드 아래에 표시된다.", { x: 0.5, y: 6.28, w: 7.9, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(2, "경보 화면", "ISA-18.2 형식 — 발생·복귀·확인을 구분하고 우선순위 순으로 정렬",
    "경보는 발생, 복귀, 확인 세 상태를 가집니다. 확인은 운용자 권한이 필요하고 감사 기록에 남습니다.");
  shot(s, "alarms", 0.5, 1.72, 7.9, [[1, 150, 132], [2, 150, 200], [3, 760, 290], [4, 1840, 200]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "탭", "경보 목록 · 경보 이력(최근 300건) · 감사 기록(무결성 검증)"], [2, "거르기", "전체 · 미확인 · 발생 중"], [3, "경보 줄", "우선순위, 발생 시각, 장치, 내용, 상태(발생/복귀), 확인자"], [4, "확인", "선택 확인 · 전체 확인(운용자 이상)"]], { rh: 0.7, gap: 0.08 });
  table(s, 8.65, 4.9, 4.18, ["우선", "뜻", "예"], [["1 긴급", "즉시 조치", "통신 두절, 차단기 트립, 모선 정전"], ["2 높음", "빠른 조치", "지령 실패, 수소 잔량 낮음"], ["3 보통", "확인 필요", "경로 저하, 값 범위 밖, 예비력 부족"], ["4 낮음", "참고", "현장 수동 모드, 자동 제어 해제"]], [18, 22, 60], { bold: [0], rowH: 0.36, fs: 10 });
  T(s, "같은 내용의 사건 경보가 되풀이되면 줄이 늘지 않고 횟수(×N)만 올라간다. 장비가 두절이면 점마다 경보를 내지 않고 '통신 두절' 하나로 알린다.", { x: 0.5, y: 6.28, w: 7.9, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(2, "통신 진단 화면", "장비 × 경로(A·B)별 통신 상태 — 어느 장비의 어느 경로가 문제인지 바로 확인",
    "통신 진단 화면은 현장에서 케이블이나 스위치 문제를 찾을 때 먼저 보는 화면입니다.");
  shot(s, "fault_comm", 0.5, 1.72, 7.9, [[1, 250, 330], [2, 900, 330], [3, 1690, 300], [4, 1690, 640], [5, 1690, 900]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "장치 판정", "정상 · 경로 저하 · 두절 · 재조회 대기"], [2, "경로별 상세", "주소, 응답 여부, 왕복 시간, 성공·오류 횟수, 마지막 오류 내용"], [3, "수집 주기 성능", "평균·최대 수집 시간, 주기 초과 횟수, 분포"], [4, "프로세스 감시", "수집·제어 과정이 살아 있는지"], [5, "판정 기준", "두 경로 모두 2초 무응답이면 두절"]], { rh: 0.68, gap: 0.08 });
  table(s, 8.65, 5.58, 4.18, ["판정", "EMS 동작"], [["경로 저하", "운전·지령 유지, 3등급 경보"], ["두절", "지령 차단, 직전 값 유지, 1등급 경보"], ["재조회 대기", "복구 뒤 전 상태를 다시 읽고 정상 복귀"]], [30, 70], { bold: [0], rowH: 0.3, fs: 10 });
  T(s, "그림은 연료전지 제어기 응답을 끊은 상황이다.", { x: 0.5, y: 6.3, w: 7.9, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(2, "고장이 나면 화면이 어떻게 바뀌나", "예: 2등급 부하 급전선 과전류 트립 + 연료전지 통신 두절 — 개요와 결선도가 동시에 반응",
    "가상 장치에 고장을 넣어 화면 반응을 확인한 예입니다. 교육에 그대로 쓸 수 있습니다.");
  shot(s, "fault_overview", 0.5, 1.72, 6.07, [[1, 1160, 28], [2, 1090, 520], [3, 720, 800], [4, 1690, 900]]); shot(s, "fault_sld", 6.76, 1.72, 6.07, [[5, 1010, 660], [6, 640, 400]]);
  const it = [[1, "머리줄 경보 수", "긴급 2건으로 증가, 깜박임"], [2, "두절 장비", "배치도에서 붉게, 값은 ####"], [3, "정전 구간", "트립된 급전선의 시설이 붉게"], [4, "경보 매트릭스", "해당 장비 칸에 숫자"], [5, "트립 표시", "✕ 와 '51 한시 과전류'"], [6, "두절 표시", "전원 타일 '통신 두절'"]];
  it.forEach((x, i) => legend(s, 0.5 + (i % 3) * 4.14, 5.28 + Math.floor(i / 3) * 0.72, 4.05, [x], { rh: 0.62 })); }
{ const s = page(2, "작전지 배치 편집", "전개 상황에 맞춰 운용자가 장비 대수·막사 수량·위치를 화면에서 직접 수정",
    "배치 편집은 운용자 권한으로 개요 화면에서 합니다. 저장하면 감사 기록에 남습니다.");
  shot(s, "layedit", 0.5, 1.72, 7.9, [[1, 1420, 245], [2, 700, 560], [3, 300, 1005], [4, 760, 1005], [5, 1380, 1005]]);
  legend(s, 8.65, 1.72, 4.18, [[1, "배치 편집 단추", "개요 화면 → [배치 편집] (운용자 이상)"], [2, "끌어서 이동", "장비를 누르면 선택, 끌면 위치 이동. 케이블은 자동으로 다시 그려짐"], [3, "추가", "장비·막사·시설·배전함(FSU) 종류를 골라 추가"], [4, "선택 항목", "이름, 연결 급전선(1~3등급), 복제, 삭제"], [5, "저장 · 기본값", "저장하면 모든 단말에 반영. 기본 배치 복원 가능"]], { rh: 0.78, gap: 0.08 });
  T(s, "다른 화면으로 넘어가면 편집은 자동으로 끝난다(저장하지 않은 변경은 버림). 삭제는 개요 화면에서 장비를 선택했을 때만 된다.", { x: 0.5, y: 6.28, w: 7.9, h: 0.5, fontSize: 10.5, color: GRAY }); }

// ═══ 3. 사용 방법
{ const s = page(3, "설치와 실행", "압축을 풀고 실행 파일을 더블클릭 — 가상 장치 모드로 먼저 익힌 뒤 실장비 모드로",
    "설치는 압축을 푸는 것이 전부입니다. 먼저 가상 장치 모드로 화면을 익히기를 권합니다.");
  steps(s, 0.5, 1.75, 12.33, 1.55, [["준비", "Windows 10 이상 노트북, Python 3.10 이상 설치(설치 때 'Add to PATH' 선택)"], ["압축 풀기", "IFPS_Mobile_EMS_" + REV + ".zip 을 한글·공백 없는 폴더에 풀기 (예: C:\\IFPS_EMS)"], ["시연 실행", "run_sim.bat 더블클릭 → 브라우저가 열리고 가상 장치로 전 기능 동작"], ["실장비 설정", "runtime.json 에 장비 IP, pointmap.csv 에 레지스터 주소 (5장)"], ["실장비 실행", "diag.bat 로 통신 확인 → run_live.bat"]]);
  table(s, 0.5, 3.55, 7.3, ["실행 파일", "하는 일"], [["run_sim.bat", "가상 장치 + 제어화면. 장비 없이 시연·교육·시험"], ["run_live.bat", "자가 점검 → 장비 접속 확인 → 제어화면(실장비)"], ["diag.bat", "현장 간편 진단 도구(번호 차림표)"], ["diag.bat --demo", "진단 도구 연습(내장 가상 장치)"]], [28, 72], { bold: [0], rowH: 0.36 });
  note(s, 8.05, 3.55, 4.78, 1.82, "접속", ["제어화면: http://127.0.0.1:8080", "다른 단말에서 보려면 runtime.json 의 hmi.bind 를 EMS 의 망 주소로 (운용 모드는 별도 허용 설정 필요)", "끝낼 때: 실행 창에서 Ctrl+C (마지막 상태 저장)"]);
  card(s, 0.5, 5.55, 12.33, 1.2, "개발 모드와 운용 모드", "개발 모드는 기본 PIN(운용자 1111, 엔지니어 2222)과 가상 장치를 허용한다. 운용 모드(run_mode: \"운용\")는 기동 때 보안 점검을 해서 기본·평문 PIN, 가상 장치, 허용하지 않은 원격 접속, 검증되지 않은 암호 모듈이면 기동을 거부한다. PIN 은 python -m ifps_ems_rt.hmi.pin 으로 해시를 만들어 설정한다.", { bs: 11 }); }
{ const s = page(3, "로그인과 권한", "보는 것은 누구나, 지령은 운용자, 직접 쓰기와 고장 주입은 엔지니어 — 모든 인증·지령은 감사 기록에",
    "권한은 3단계입니다. 로그인하지 않아도 화면은 볼 수 있지만 지령은 낼 수 없습니다.");
  shot(s, "login", 0.5, 1.72, 6.2, [[1, 1750, 28], [2, 960, 520]]);
  T(s, "① 머리줄의 [로그인] → ② 이름·직책과 PIN 입력. 5회 틀리면 60초 잠금. 30분 동안 조작이 없으면 자동 로그아웃.", { x: 0.5, y: 5.3, w: 6.2, h: 0.5, fontSize: 11 });
  table(s, 6.95, 1.72, 5.88, ["할 수 있는 일", "조회", "운용자", "엔지니어"], [["전 화면 보기, 추세 내보내기", "●", "●", "●"], ["경보 확인", "", "●", "●"], ["기동·정지·설정 지령(SBO)", "", "●", "●"], ["자동/수동 전환, 부하 차단·복구", "", "●", "●"], ["작전지 배치 편집", "", "●", "●"], ["감사 기록 열람, 레지스터 읽기", "", "●", "●"], ["레지스터 직접 쓰기", "", "", "●"], ["가상 장치 고장 주입", "", "", "●"]], [52, 14, 16, 18], { center: [1, 2, 3], rowH: 0.36 });
  note(s, 6.95, 5.2, 5.88, 1.5, "감사 기록", ["로그인·지령·설정·쓰기·배치 변경을 한 줄씩 기록", "각 줄이 앞 줄의 인증값을 품어 중간을 고치거나 지우면 검출", "경보 화면 → 감사 기록 → [무결성 검증]"]);
  T(s, "감사 기록은 쓸 때마다 디스크에 반영하고 8MB 에서 새 파일로 넘긴다. 전원이 끊겨 끝줄이 잘려도 다음 기동 때 격리하고 이어 쓴다.", { x: 0.5, y: 5.95, w: 6.2, h: 0.6, fontSize: 10.5, color: GRAY }); }
{ const s = page(3, "지령 절차 — 선택 후 실행(SBO)", "한 번 눌러서는 실행되지 않음: 선택 → 내용 확인 → 실행의 2단계, 10초 안에 실행하지 않으면 취소",
    "지령은 두 단계입니다. 잘못 누른 지령이 그대로 나가는 것을 막습니다.");
  shot(s, "sbo", 0.5, 1.72, 6.2, [[1, 960, 500], [2, 1140, 610]]);
  T(s, "① 지령 내용·대상·연동 조건 확인   ② [실행] 을 누르면 지령 전송. 남은 시간이 막대로 표시된다.", { x: 0.5, y: 5.3, w: 6.2, h: 0.3, fontSize: 11, valign: "middle" });
  steps(s, 6.95, 1.72, 5.88, 1.5, [["선택", "지령 단추 → EMS 가 보낼 수 있는지 먼저 검사"], ["실행", "10초 안에 [실행] → 순번과 지령을 장비에 씀"], ["응답 확인", "장비가 순번을 되돌리고 상태가 바뀌는지 확인"]]);
  table(s, 6.95, 3.45, 5.88, ["보내기 전에 막는 경우", "화면 표시"], [["통신 두절 · 생존 신호 정지", "통신 두절"], ["장비가 현장 수동 모드", "현장 수동 모드"], ["이미 운전 중인데 기동(중복)", "이미 운전·투입 상태"], ["작업 잠금", "작업 잠금"], ["1등급 부하 차단", "단추 없음"]], [62, 38], { rowH: 0.31, fs: 10.5 });
  note(s, 6.95, 5.45, 5.88, 1.3, "응답이 없으면", ["1.5초 안에 확인되지 않으면 1회 다시 보냄", "그래도 안 되면 지령을 취소(늦게 실행되는 것 방지)하고 대체 전원(디젤 ↔ 연료전지)에 지령, 경보"]);
  T(s, "선택한 사람과 실행하는 사람이 다르면 실행되지 않는다.", { x: 0.5, y: 5.7, w: 6.2, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(3, "자동 제어와 수동 운전", "AUTO 에서는 EMS 가 60초마다 전원 투입을 결정 — MANUAL 에서는 운용자 지령만",
    "자동 제어는 예측 기반 계획이나 규칙으로 디젤, 연료전지, 수전해 투입을 정합니다.");
  shot(s, "control", 0.5, 1.72, 6.2, [[1, 1560, 215], [2, 1690, 330], [3, 1690, 640]], 1920, 1080);
  T(s, "① AUTO / MANUAL 전환   ② 운전 정책·다음 제어 시각·최근 결정   ③ 부하 차단·복구", { x: 0.5, y: 5.3, w: 6.2, h: 0.3, fontSize: 11, valign: "middle" });
  card(s, 6.95, 1.72, 2.86, 1.7, "예측 계획 운전", "24시간 예측으로 연료·수소 소모가 가장 적은 투입 순서를 계산. 1시간마다 다시 계획.", { bs: 10.5 });
  card(s, 9.97, 1.72, 2.86, 1.7, "규칙 운전", "충전율 문턱값으로 디젤·연료전지 기동. 이력 부족·계산 실패 때 자동 전환.", { bs: 10.5 });
  table(s, 6.95, 3.62, 5.88, ["EMS 가 자동으로 하는 일", "조건"], [["디젤·연료전지 기동·정지", "계획 또는 충전율 규칙"], ["연료전지 병렬(순동 예비 대기)", "N-1 예비력 부족"], ["수전해 기동", "잉여 전력이 있고 디젤 정지 중"], ["대체 전원 지령", "지령 무응답"]], [56, 44], { rowH: 0.33, fs: 10.5 });
  note(s, 6.95, 5.5, 5.88, 1.25, "주의", ["현장 수동 모드인 장비에는 자동 지령이 나가지 않는다", "[제어 즉시 실행] 은 60초를 기다리지 않고 지금 한 번 판단"]);
  T(s, "야간 정숙 시간대에는 디젤 기동을 피하도록 계획한다.", { x: 0.5, y: 5.7, w: 6.2, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }

{ const s = page(3, "운용 장소와 운용 태세", "전개지와 주둔지를 같은 EMS 로 — 상황에 따라 평시 · 저소음 · 자립 태세를 운용자가 선택",
    "군 이동형 EMS 고유 기능입니다. 운용 장소와 태세는 설비 제어 화면에서 바꾸고 재기동해도 유지됩니다.");
  shot(s, "r18_ctl_quiet", 0.5, 1.72, 6.2, [[1, 300, 28], [2, 1690, 250], [3, 1690, 470], [4, 1690, 880]]);
  T(s, "① 머리줄: 운용 장소·태세·부하 차단   ② 운용 장소·태세 전환   ③ 자립 지속시간·자동 차단 사유   ④ 차단기 상태", { x: 0.5, y: 5.3, w: 6.2, h: 0.5, fontSize: 10.5 });
  table(s, 6.95, 1.72, 5.88, ["운용 태세", "EMS 동작"], [["평시", "예측 계획 또는 규칙으로 연료 소모 최소화"], ["저소음", "디젤 금지(연료전지 사용), 3등급 부하 자동 차단"], ["자립", "보급 없이 목표 시간(기본 72시간)을 버티도록 부하 관리"]], [18, 82], { bold: [0], rowH: 0.4, fs: 10.5 });
  card(s, 6.95, 3.5, 5.88, 1.3, "부하 우선순위 자동 차단·복구", "자원 부족이 3초 이어지면 3등급 → 2등급 순으로 차단하고, 해소된 뒤 60초가 지나면 역순으로 복구한다. 1등급은 끊지 않는다. EMS 가 끊은 급전선만 되살린다.", { bs: 10.5 });
  card(s, 6.95, 4.98, 5.88, 1.0, "자립 지속시간", "ESS·수소·연료와 하루 태양광 예상량으로 '전 부하 / 3등급 차단 / 1등급만' 기준 남은 시간을 항상 표시한다.", { bs: 10.5 });
  note(s, 6.95, 6.1, 5.88, 0.66, "저소음 태세에서 자원이 바닥나면", ["디젤을 스스로 켜지 않고 1등급 경보로 알린다(태세 변경은 운용자 판단)"]);
  T(s, "그림은 전개지에서 저소음 태세로 바꿔 3등급 부하가 자동 차단된 상태다.", { x: 0.5, y: 5.85, w: 6.2, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(3, "주둔지 운전 (상전 연계)", "역송 없이 군 전력으로 사용 — 전기료 절감과 정전 시 무정전 운영을 함께",
    "주둔지에서는 상전과 ESS로 운전합니다. 정전이 나면 EMS가 곧바로 자립 운전 논리로 넘어갑니다.");
  shot(s, "r18_sld_garrison", 0.5, 1.72, 6.07, [[1, 110, 250], [2, 1540, 250]]); shot(s, "r18_sld_outage", 6.76, 1.72, 6.07, [[3, 110, 250], [4, 1160, 28]]);
  const it = [[1, "상전 수전", "수전 전력과 수전 차단기 상태. 디젤·연료전지는 정지"], [2, "ESS 충·방전", "EMS 가 지령. 경부하 시간대 충전, 최대부하 시간대 방전"], [3, "정전", "수전 차단기 개방 → '정전 · 자립 전환', ESS 가 계통 유지"], [4, "정전 경보", "1등급 경보. 디젤·연료전지를 자동 투입하고 부하를 관리"]];
  it.forEach((x, i) => legend(s, 0.5 + (i % 2) * 6.26, 5.25 + Math.floor(i / 2) * 0.7, 6.07, [x], { rh: 0.6 }));
  T(s, "역송 방지: 최소 수전 유지 → 남는 태양광은 ESS 충전 → 수전해 → PV 출력 제한 순.  정전 대비: ESS 충전율 하한(기본 50%) 아래로는 요금 절감 방전을 하지 않음.  복전: 30초 안정 뒤 복귀.  순간 절체 자체는 ESS(계통 형성)·STS 가 수행.", { x: 0.5, y: 6.62, w: 12.33, h: 0.4, fontSize: 9.5, color: GRAY }); }

// ═══ 4. 디버깅
{ const s = page(4, "디버깅 수단 한눈에", "화면 안의 디버그 도구 + 화면 없이 쓰는 현장 진단 도구 — 같은 통신 코드로 동작",
    "디버깅 수단은 세 가지입니다. 상황에 맞는 것을 골라 씁니다.");
  card(s, 0.5, 1.75, 4.0, 2.15, "① 제어화면 디버그 탭", "EMS 가 돌아가는 중에 그 자리에서 확인.\n레지스터 탐색기, 프레임 추적, 포인트 맵, 고장 주입, 시스템 정보", { bs: 11.5 });
  card(s, 4.67, 1.75, 4.0, 2.15, "② 현장 간편 진단 도구 (diag)", "EMS 를 띄우기 전, 또는 장비 제작사가 단독으로.\n번호만 누르면 7단계 자동 진단, 원인·조치 안내, 보고서 저장", { bs: 11.5 });
  card(s, 8.83, 1.75, 4.0, 2.15, "③ 점검 명령 (mbtool)", "명령 한 줄로 빠르게.\n읽기·쓰기·주기 감시·장치 번호 찾기·32비트 네 순서 동시 해석", { bs: 11.5 });
  table(s, 0.5, 4.15, 12.33, ["상황", "쓸 도구", "보는 것"], [["장비가 응답하지 않는다", "diag 자동 진단 → 통신 진단 화면", "어느 단계(허용 목록·접속·장치 번호)에서 막히는지, 경로별 오류"], ["값이 이상하다(너무 크다·작다)", "diag, 레지스터 탐색기", "바이트 순서·자료형·배율 후보, 원시값(HEX)"], ["주소가 맞는지 모르겠다", "diag 주소 탐색, mbtool read", "응답하는 주소 범위와 값"], ["지령이 먹지 않는다", "diag 지령 규약 시험, 프레임 추적", "순번 되돌림과 상태 변화 시간, 주고받은 바이트"],
    ["고장 때 EMS 반응을 보고 싶다", "디버그 → 시뮬레이터·고장 주입", "무응답, 경로 단절, 차단기 트립, 운전 시나리오"]], [28, 30, 42], { bold: [0], rowH: 0.4 });
  T(s, "쓰기 기능(레지스터 쓰기, 지령 시험)은 확인 절차를 거치며 감사 기록에 남는다.", { x: 0.5, y: 6.6, w: 12.33, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(4, "디버그 탭 ① 레지스터 탐색기 · 프레임 추적", "장비의 레지스터를 직접 읽고, 주고받는 통신을 바이트 단위로 확인",
    "레지스터 탐색기는 같은 값을 여러 형식으로 동시에 보여 줍니다. 프레임 추적은 실제 송수신 내용을 기록합니다.");
  shot(s, "eng_explorer", 0.5, 1.72, 6.07, [[1, 420, 248], [2, 1010, 248], [3, 640, 420], [4, 1700, 300]]); shot(s, "eng_trace", 6.76, 1.72, 6.07, [[5, 700, 400], [6, 1700, 400]]);
  const it = [[1, "대상·주소", "장비·경로를 고르거나 IP 직접 입력, 기능 코드, 주소, 개수"], [2, "32비트 순서", "ABCD·CDAB·BADC·DCBA 를 바꿔 가며 맞는 값 찾기"], [3, "동시 해석", "HEX·부호 없는/있는 16비트·32비트·실수, 대응하는 점 이름"], [4, "레지스터 쓰기", "엔지니어 전용. 0~65535 만 허용, 감사 기록"], [5, "프레임 목록", "장치·경로, 송신/수신/오류, 기능 코드, 왕복 시간, HEX"], [6, "프레임 해석", "줄을 누르면 머리부와 내용을 항목별로 풀이"]];
  it.forEach((x, i) => legend(s, 0.5 + (i % 3) * 4.14, 5.28 + Math.floor(i / 3) * 0.75, 4.05, [x], { rh: 0.66 })); }
{ const s = page(4, "디버그 탭 ② 포인트 맵 · 고장 주입", "설정한 주소표가 실제 값과 맞는지 확인하고, 가상 장치에 고장을 넣어 EMS 반응을 검증",
    "고장 주입은 가상 장치 모드에서만 됩니다. 교육과 시험에 씁니다.");
  shot(s, "eng_points", 0.5, 1.72, 6.07, [[1, 500, 300], [2, 1700, 300]]); shot(s, "eng_sim", 6.76, 1.72, 6.07, [[3, 420, 330], [4, 1400, 330], [5, 900, 800]]);
  const it = [[1, "포인트 맵", "점 이름, 장치, 주소, 자료형, 배율, 범위와 현재 공학값"], [2, "품질", "정상 · 범위 밖 · 갱신 지연, 마지막 갱신 뒤 경과 시간"], [3, "장치 고장", "무응답, 지령 무시, 현장 수동 모드, 통신 경로 A·B 단절"], [4, "운전 시나리오", "부하 급증, 구름 통과, 야간, 충전율 저하, 수소 부족"], [5, "차단기·보호", "급전선별 보호 트립(ANSI 번호 선택), 개방, 복구"], ["※", "값 강제", "임의 점에 값을 넣고 유지 — 범위 밖 값 반응 확인"]];
  it.forEach((x, i) => legend(s, 0.5 + (i % 3) * 4.14, 5.28 + Math.floor(i / 3) * 0.75, 4.05, [x], { rh: 0.66 })); }
{ const s = page(4, "현장 간편 진단 도구 (diag)", "노트북 한 대, 번호만 누르면 됨 — 장비·경로마다 7단계를 차례로 점검하고 원인과 조치를 한 줄로 안내",
    "현장 간편 진단 도구는 제어화면 없이 동작합니다. 장비 제작사에도 함께 제공합니다.");
  shot(s, "diag_menu", 0.5, 1.72, 4.6, [], 760, 500); shot(s, "diag_term", 5.3, 1.72, 7.53, [], 1245, 660);
  T(s, "diag.bat 실행 → 번호 차림표", { x: 0.5, y: 4.78, w: 4.6, h: 0.26, fontSize: 10.5, color: GRAY, valign: "middle" });
  table(s, 0.5, 5.06, 4.6, ["단계", "보는 것"], [["① 허용 목록 · ② TCP 접속", "IP 가 허용 대역 안인가, 포트가 열렸나"], ["③ 장치 번호 · ④ 전 점 읽기", "Unit ID 가 맞나, 주소가 모두 읽히나"], ["⑤ 값 범위 · ⑥ 생존 신호", "물리 범위 안인가, hb 가 올라가나"], ["⑦ 경로 A·B", "두 경로 값이 같나"]], [46, 54], { bold: [0], rowH: 0.3, fs: 10 });
  T(s, "자동 진단 결과(정상 예). 장비 6종을 동시에 점검해 약 5초에 끝난다.", { x: 5.3, y: 5.78, w: 7.53, h: 0.28, fontSize: 10.5, color: GRAY, valign: "middle" });
  T(s, "읽기만 한다. 쓰기는 [7 지령 규약 시험] 에서만 하며 장비 이름을 다시 입력해야 실행된다.", { x: 5.3, y: 6.08, w: 7.53, h: 0.28, fontSize: 10.5, color: GRAY, valign: "middle" }); }
{ const s = page(4, "진단 결과 읽는 법", "[정상] [주의] [이상] 과 함께 원인·조치를 표시 — 값이 이상하면 맞는 바이트 순서·자료형·배율을 찾아 줌",
    "이 예는 경로 B 의 포트가 틀리고, 한 점의 32비트 순서가 틀린 경우입니다.");
  shot(s, "diag_bad", 0.5, 1.72, 6.6, [], 1250, 640); shot(s, "diag_report", 7.35, 1.72, 5.48, [], 1300, 900);
  legend(s, 0.5, 5.22, 6.6, [[1, "값 이상 → 후보 제시", "'0 에 가까운 비정상 실수 — 순서를 CDAB 로 해석하면 -12.5 (범위 안)'. pointmap.csv 의 order 열만 고치면 된다"], [2, "접속 거부 → 원인·조치", "'장비가 접속을 거부. 포트 번호, Modbus TCP 서버 사용 설정, 동시 접속 수 확인'"]], { rh: 0.7, gap: 0.08 });
  T(s, "결과는 HTML 보고서로 저장(state/diag/). 요약·단계별 판정·전 점의 원시값과 공학값, 시험자·입회자 서명란 포함.", { x: 7.35, y: 5.6, w: 5.48, h: 0.5, fontSize: 10.5, color: GRAY });
  note(s, 7.35, 6.1, 5.48, 0.68, "종료 코드 (--auto)", ["0 정상 · 1 주의(경로 저하 등) · 2 이상 — 기동 스크립트에 연결 가능"]); }

// ═══ 5. 장치 연결
{ const s = page(5, "장치 연결 구조", "EMS 가 클라이언트, 장비가 Modbus TCP 서버 — 소스는 고치지 않고 설정 파일 2개만 맞춤",
    "장비 연결은 설정 파일 두 개를 장비에 맞게 고치는 일입니다.");
  T(s, "EMS 노트북\n192.168.10.2 / .102", { x: 0.5, y: 1.85, w: 2.3, h: 0.9, fontSize: 12, bold: true, color: WHITE, align: "center", valign: "middle", fill: { color: BROWN }, objectName: "EMS 노트북" });
  [["스위치 A", 1.75], ["스위치 B", 2.45]].forEach(([t, y]) => { s.addShape(pres.ShapeType.line, { x: 2.8, y: y + 0.2, w: 0.5, h: 0, line: { color: GOLD, width: 1.5 } });
    T(s, t, { x: 3.3, y, w: 1.3, h: 0.42, fontSize: 11, bold: true, color: DARK, align: "center", valign: "middle", fill: { color: CREAM }, line: { color: LINE, width: 1 }, objectName: t }); s.addShape(pres.ShapeType.line, { x: 4.6, y: y + 0.2, w: 0.45, h: 0, line: { color: GOLD, width: 1.5 } }); });
  table(s, 5.05, 1.72, 7.78, ["장비", "이름", "경로 A", "경로 B", "Unit"], Object.entries(JSON.parse(fs.readFileSync(EMS + "/config/runtime.json", "utf8")).devices).map(([n, d]) => [{ DG: "디젤 발전기", FC: "연료전지", ESS: "ESS PCS", MTR: "계측·보호 게이트웨이", ELZ: "수전해", PV: "태양광 인버터" }[n], n, d.paths[0][0], d.paths[1][0], d.unit]), [32, 12, 22, 22, 12], { center: [1, 2, 3, 4], rowH: 0.29, fs: 10.5 });
  T(s, "폐쇄망 · 포트 502 · 사설 주소만 접속", { x: 0.5, y: 3.0, w: 4.4, h: 0.28, fontSize: 10.5, color: GRAY, valign: "middle" });
  card(s, 0.5, 4.05, 6.07, 1.55, "① runtime.json — 접속 정보", "devices.<장비>: paths(경로 A·B 의 IP·포트), unit, order(기본 바이트 순서), gap(묶음 읽기 빈 주소 허용), done_s(지령 완료 한도)\nallow: 접속 허용 대역 — 현장 대역을 반드시 넣는다", { bs: 11 });
  card(s, 6.76, 4.05, 6.07, 1.55, "② pointmap.csv — 레지스터 주소표", "tag, device, fc(3/4), addr(0부터), type, scale, unit, lo, hi, rw, order\n예)  ESS.kw,ESS,3,4,i16,0.1,kW,-550,550,r,", { bs: 11 });
  note(s, 0.5, 5.78, 12.33, 0.98, "Modbus TCP 가 아닌 장비", ["RS-485(RTU)·CAN·IEC 61850·DNP3 장비는 프로토콜 변환 게이트웨이로 Modbus TCP 서버를 만들어 연결한다. EMS 코드와 보안 검토 범위는 바뀌지 않는다."]); }
{ const s = page(5, "레지스터와 바이트 순서", "16·32·64비트 자료형과 네 가지 바이트 순서를 모두 수용 — 제작사 사양서의 주소는 0부터 세는 값으로 변환",
    "32비트 값의 순서는 제작사마다 다릅니다. EMS는 네 가지를 모두 받습니다.");
  table(s, 0.5, 1.72, 6.0, ["자료형", "레지스터", "주 용도"], [["u16 / i16", "1", "상태, 지령, 전력(부호 있음)"], ["u32 / i32 / f32", "2", "누적 전력량, 실수 계측값"], ["u64 / i64 / f64", "4", "Wh 단위 누적량"]], [30, 16, 54], { bold: [0], center: [1], rowH: 0.33 });
  table(s, 6.83, 1.72, 6.0, ["order", "0x11223344 가 담기는 모양", "사양서 표기"], [["ABCD", "1122, 3344", "Big-endian, 표준(기본)"], ["CDAB", "3344, 1122", "Word swap, 하위 워드 먼저"], ["BADC", "2211, 4433", "Byte swap"], ["DCBA", "4433, 2211", "Little-endian"]], [16, 40, 44], { bold: [0], center: [0, 1], rowH: 0.3 });
  table(s, 0.5, 3.4, 6.0, ["제작사 표기", "fc", "addr"], [["40001 (보유 레지스터)", "3", "0"], ["40011", "3", "10"], ["30005 (입력 레지스터)", "4", "4"], ["Register 1 (1부터)", "3", "0"]], [56, 20, 24], { center: [1, 2], rowH: 0.3 });
  note(s, 6.83, 3.55, 6.0, 1.35, "순서를 모를 때", ["정격값을 아는 점(전압 440 V, 주파수 60 Hz)을 네 순서로 동시에 읽는다", "mbtool read <IP> -a <주소> -n 4 --orders", "맞는 값이 나오는 열이 그 장비의 순서"]);
  table(s, 0.5, 5.1, 12.33, ["증상", "원인", "조치"], [["0 에 가까운 실수 또는 1e+20", "32비트 순서", "order 열 수정(진단 도구가 후보 제시)"], ["값이 정확히 10배·100배", "배율", "scale 수정"], ["값이 65,000 근처", "음수를 부호 없이 읽음", "type 을 i16 으로"], ["이웃 항목의 값이 나옴", "주소 1 차이", "0부터/1부터 기준 확인"]], [34, 26, 40], { rowH: 0.3 }); }
{ const s = page(5, "지령·응답 규약", "지령을 받는 장비가 지켜야 할 약속 — 순번을 되돌려 써야 EMS 가 '수용'으로 판단",
    "이 규약은 장비 제작사에 요구사항으로 전달합니다.");
  table(s, 0.5, 1.72, 5.6, ["신호", "방향", "뜻"], [["status", "장비→EMS", "0 정지 / 1 운전"], ["mode", "장비→EMS", "0 자동 / 1 현장 수동"], ["hb", "장비→EMS", "생존 신호(약 1초마다 +1)"], ["cmd", "EMS→장비", "0 취소 / 1 기동 / 2 정지"], ["seq", "EMS→장비", "지령 순번(1~65535)"], ["seq_ack", "장비→EMS", "수용한 순번을 되돌려 씀"]], [22, 26, 52], { bold: [0], center: [1], rowH: 0.31 });
  steps(s, 6.35, 1.72, 6.48, 1.72, [["쓰기", "cmd 와 seq 를 한 프레임으로"], ["수용", "장비가 seq_ack 에 같은 순번 (1.5초 안)"], ["완료", "status 변화 (장비별 한도 done_s)"], ["실패 시", "재지령 1회 → 취소 → 대체 전원"]]);
  note(s, 6.35, 3.65, 6.48, 1.5, "장비 쪽 구현 요구", ["seq 가 바뀔 때 cmd 를 1회만 실행, cmd=0 이면 대기 지령 폐기", "현장 수동(mode=1)이면 EMS 지령 거부", "hb 는 제어 논리 안에서 증가(통신만 살아 있으면 멈춤)", "통신이 끊겨도 현재 운전 상태 유지"]);
  table(s, 0.5, 4.1, 5.6, ["시간 한도", "값"], [["지령 수용(seq_ack)", "1.5초"], ["상태 변화 완료", "기본 1.5초, done_s 로 조정"], ["생존 신호 정지 판정", "5초"], ["통신 두절 판정", "2초(두 경로 모두)"]], [58, 42], { rowH: 0.3 });
  card(s, 0.5, 5.75, 12.33, 1.0, "기동이 느린 장비", "디젤·연료전지처럼 기동에 1.5초 넘게 걸리는 장비는 runtime.json 의 devices.<장비>.done_s 에 소요 시간을 넣는다. 넣지 않으면 '수용했으나 상태 미변화'로 실패 처리되어 대체 전원으로 넘어간다.", { bs: 11 }); }
{ const s = page(5, "시운전 절차와 제작사 전달 문서", "14단계로 통신·지령·이중화·두절 복구를 확인 — 장치별 안내서 6부를 제작사에 전달",
    "시운전은 연동 방안서 8장의 절차를 따릅니다. 지령 시험은 제작사 입회 후에 합니다.");
  const PH = [["사전 · 망", "① 대응표 검증  ② ping·포트 확인", "오류 0건, 전 장비 응답"], ["읽기 확인", "③ 장치 번호  ④ 주소  ⑤ 자료형·순서  ⑥ 배율·범위  ⑦ 생존 신호", "값 일치, 오차 2% 이내"], ["지령 확인", "⑧ 기동·정지  ⑨ 수동 모드 거부", "1.5초 안 수용, 거부 동작"], ["이중화 · 복구", "⑩ 경로 하나 분리  ⑪ 두 경로 분리  ⑫ 재연결  ⑬ 대체 전원", "3초 안 두절, 복구 후 정상"], ["연속 운전", "⑭ 자동 모드 72시간", "통신 이상·주기 초과 없음"]];
  PH.forEach(([t, d, ok], i) => { const x = 0.5 + i * 2.5;
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.75, w: 2.33, h: 2.0, rectRadius: 0.05, fill: { color: CREAM }, line: { color: LINE, width: 1 }, objectName: "시운전 " + t });
    s.addShape(pres.ShapeType.rect, { x, y: 1.75, w: 2.33, h: 0.36, fill: { color: BROWN }, line: { color: BROWN, width: 1 } }); T(s, t, { x, y: 1.75, w: 2.33, h: 0.36, fontSize: 12, bold: true, color: WHITE, align: "center", valign: "middle" });
    T(s, d, { x: x + 0.1, y: 2.2, w: 2.13, h: 0.95, fontSize: 10.5 }); T(s, "합격: " + ok, { x: x + 0.1, y: 3.2, w: 2.13, h: 0.48, fontSize: 10, bold: true, color: GOLD });
    if (i < 4) T(s, "▶", { x: x + 2.33, y: 2.63, w: 0.17, h: 0.24, fontSize: 9, color: GOLD, align: "center", valign: "middle" }); });
  tag(s, 0.5, 3.98, "제작사 전달 문서 (HAES-IFPS-EMS-DG-01~06)", 4.3);
  table(s, 0.5, 4.33, 7.4, ["번호", "장비", "특히 확인할 것"], [["01", "디젤 발전기", "기동 소요 시간, status 의 뜻(부하 수용 가능)"], ["02", "연료전지", "출력 설정 0 = 병렬 대기, 수소 잔량 단위"], ["03", "ESS PCS", "전력 부호(방전 +), 충전율 기준, 생존 신호"], ["04", "계측·보호 게이트웨이", "뒤쪽 장비 무응답 처리, 차단기·보호 코드 정의"], ["05", "수전해", "안전 정지 소요 시간, 최소 운전 시간"], ["06", "태양광 인버터", "출력 제한 단위와 0 의 뜻"]], [10, 28, 62], { bold: [1], center: [0], rowH: 0.36, fs: 10.5 });
  note(s, 8.15, 4.33, 4.68, 2.42, "안내서에 담긴 것", ["접속 정보·레지스터 요구사항(회신 칸)", "지령·응답 규약과 실제 바이트 예시", "진단 도구로 하는 자체 점검 절차", "증상별 조치, 회신 항목, 점검 기록지", "주소·배율은 EMS 표준안 — 제작사가 다른 값을 회신하면 설정 파일만 고침"]); }

// ═══ 6. 신뢰성 결과
{ const s = page(6, "신뢰성 시험 결과 요약", `최종 소스(${REV}) 자동 측정 — 시험 ${ST.n_tests}건 전부 통과, 정적 시험 기준 초과 0건`,
    "군 소프트웨어 신뢰성 시험의 항목 구조인 정적 시험과 동적 시험에 맞춰 측정했습니다. 등급별 목표 수치는 원문으로 확정해야 합니다.");
  [["자동 시험", String(ST.n_tests), "건 통과"], ["문장 실행률", f1(ST.stmt.pct), "%"], ["분기 실행률", f1(ST.branch.pct), "%"], ["취약점 미조치", String(ST.bandit.results.length), "건"]].forEach(([l, v, u], i) => stat(s, 0.5 + i * 3.1, 1.72, 2.95, 1.05, l, v, u));
  const M = ST.metrics, L = M.limits;
  table(s, 0.5, 3.0, 7.6, ["구분", "항목", "적용 기준(제안)", "결과"], [["정적", "코딩 규칙 — 결함성·오류", "위배 0건", `${ST.pyflakes.length + ST.pylint.E}건`], ["정적", "코딩 규칙 — 경고", "0건 또는 사유", `${ST.pylint.W}건(전부 사유 기재)`], ["정적", "취약점 점검(CWE 대응)", "미조치 0건", `미조치 ${ST.bandit.results.length} · 예외 ${ST.bandit_nosec.length}`],
    ["정적", "순환 복잡도", `${L.cc} 이하`, `최대 ${M.cc_max}, 초과 0`], ["정적", "함수 길이 · 인자 · 중첩", `${L.len}줄 · ${L.arg}개 · ${L.depth}`, `최대 ${M.len_max} · ${M.arg_max} · ${M.depth_max}`], ["동적", "문장 실행률", "100% 또는 사유", `${ST.stmt.pct}% (${ST.stmt.hit}/${ST.stmt.n})`], ["동적", "분기 실행률", "100% 또는 사유", `${ST.branch.pct}% (${ST.branch.hit}/${ST.branch.n})`]], [10, 34, 26, 30], { center: [0], rowH: 0.36, fs: 10.5 });
  note(s, 8.35, 3.0, 4.48, 2.0, "판정 기준에 대하여", ["등급별 목표값은 원문을 열람하지 못해 가장 엄격한 '100% 또는 사유 소명'을 잠정 적용", "메트릭 제한값은 제안값", "규칙 집합은 C/C++ 대상이라 Python 용 공개 도구로 대응 — 관리 기관 승인 필요"]);
  note(s, 8.35, 5.15, 4.48, 1.6, "실행하지 못한 문장", [`${ST.stmt.n - ST.stmt.hit}개: 다른 운영체제·서비스 환경, 내부 오류 방어 처리기, 프로그램 진입점`, "결과서에 파일·줄 단위 사유 기재"]);
  T(s, "측정 대상: Python " + ST.loc_py.files + "개 파일, 실행문 " + ST.stmt.n + "개, 함수 " + M.n_func + "개. 측정: python tools/static_report.py", { x: 0.5, y: 6.1, w: 7.6, h: 0.5, fontSize: 10.5, color: GRAY }); }
{ const s = page(6, "동적 성능 측정", "가상 장치에 실제 통신으로 측정 — 시간 요구를 모두 한도 안에서 충족, 5분 연속 운전 주기 초과 0회",
    "시간 한도 항목은 모두 한도 안입니다. 실장비에서는 다시 측정해야 합니다.");
  const cat = ["통신 두절 감지", "지령 응답 확인", "대체 전원 지령"], meas = [mx(DY.comm_lost_s), mx(DY.sbo_ack_s), mx(DY.fallback_s)], lim = [3.0, 1.5, 5.0];
  s.addChart(pres.charts.BAR, [{ name: "측정(최대)", labels: cat, values: meas.map(x => +x.toFixed(2)) }, { name: "한도", labels: cat, values: lim }], { x: 0.5, y: 1.72, w: 6.4, h: 3.5, barDir: "col", barGapWidthPct: 60, chartColors: [HX.accent2, HX.accent4],
    showTitle: true, title: "시간 요구 대비 측정값 (초)", titleFontSize: 12, titleColor: HX.dk1, titleFontFace: "+mn-lt", showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 10, dataLabelColor: HX.dk1, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0.00",
    catAxisLabelColor: HX.accent5, valAxisLabelColor: HX.accent5, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valGridLine: { color: HX.accent4, size: 0.75 }, catGridLine: { style: "none" },
    showLegend: true, legendPos: "b", legendFontSize: 10, legendColor: HX.accent5, legendFontFace: "+mn-lt", objectName: "시간 요구 차트" });
  table(s, 7.15, 1.72, 5.68, ["항목", "기준", "측정"], [["경로 저하 감지", "—", `${f2(mx(DY.path_degraded_s))}초`], ["두절 뒤 복구(재조회)", "—", `${f2(mx(DY.recovery_s))}초`], ["차단기 트립 → 경보", "—", `${f2(mx(DY.trip_alarm_s))}초`], ["수집 1회 소요", "1초 주기", `평균 ${f1(DY.soak.avg_ms)} · 최대 ${f1(DY.soak.max_ms)} ms`], ["주기 초과(300초)", "0회", `${DY.soak.overruns}회`], ["메모리(300초)", "증가 없음", `${DY.soak.rss_mb_start} → ${DY.soak.rss_mb_end} MB`],
    ["웹 요청 2,000회", "오류 0", `오류 ${DY.http.errors}, p95 ${DY.http.p95_ms} ms`], ["운전계획 계산", "—", `${f2(mx(DY.plan_s))}초`], ["예측 오차(부하/태양광)", "15% 이하", `${DY.forecast_acc.load_nmae}% / ${DY.forecast_acc.pv_nmae}%`], ["감사 기록 무결성", "검증 통과", DY.audit.verify[1]]], [40, 22, 38], { rowH: 0.33, fs: 10.5 });
  note(s, 0.5, 5.4, 12.33, 1.35, "측정 조건과 한계", [`${DY.env.platform} · CPU ${DY.env.cpu}코어 · Python ${DY.env.python} · 가상 장치(로컬 Modbus TCP). 통신 지연이 거의 없는 조건이다.`, "예측 오차는 합성 현장 자료 기준이다. 실장비·현장 이력으로 다시 측정해야 한다(FAT·SAT)."]); }
{ const s = page(6, "결함 보완 내역 (Rev16)", "최종 소스를 따로 두 번 검토해 찾은 42건을 모두 조치 — 조치마다 재발 방지 시험으로 고정",
    "통신·서버 쪽 22건, 화면 쪽 20건입니다. 전체 목록은 신뢰성 시험 결과서 7장에 있습니다.");
  [["통신·제어·서버", "22", "건"], ["제어화면", "20", "건"], ["재발 방지 시험", "18", "건 추가"]].forEach(([l, v, u], i) => stat(s, 0.5, 1.72 + i * 1.2, 2.6, 1.05, l, v, u));
  table(s, 3.35, 1.72, 9.48, ["구분", "주요 결함", "조치"], [
    ["안전", "생존 신호가 멈춘 장비에도 자동 제어 지령이 나감", "지령 직전에 지령 가능 여부를 다시 확인"], ["안전", "감사 기록을 못 쓰면 수집·감시·지령이 모두 정지", "기록 실패는 경보로 알리고 운전 계속"],
    ["통신", "장비 한 대의 잘못된 응답에 전 장비 수집 중단", "응답 형식 검증, 장비별로 격리"], ["통신", "기동이 느린 장비를 매번 실패 처리", "수용과 완료를 분리, 장비별 완료 한도"],
    ["통신", "정의되지 않은 주소까지 묶어 읽음", "빈 주소를 건너뛰는 묶음 읽기"], ["보안", "로그인 없이 통신 추적 끄기·감사 기록 열람 가능", "운용자 권한 요구"],
    ["보안", "본문 크기 제한 우회, 잘못된 입력에 내부 오류", "길이·형식 검증"], ["자료", "비정상 값(NaN)에 화면 전체가 멈춤", "수집·설정·응답에서 차단"],
    ["화면", "경보·디버그 탭이 잘리고 스크롤 불가", "탭 본문 높이 배분"], ["화면", "게이트웨이 두절인데 부하를 정상값으로 표시", "#### 과 '게이트웨이 두절' 표시"]], [9, 49, 42], { center: [0], rowH: 0.345, fs: 10.5 });
  T(s, "'재현'으로 확인한 결함 31건, 코드 검토로 찾은 결함 11건. 화면 결함은 브라우저 자동 시험(전 화면·전 탭 넘침 0건, 오류 0건)으로 다시 확인했다.", { x: 0.5, y: 5.72, w: 12.33, h: 0.3, fontSize: 10.5, color: GRAY, valign: "middle" });
  note(s, 0.5, 6.05, 12.33, 0.72, "운용에 영향이 있는 변경", ["실측 이력 8일 미만이면 규칙 운전 · 기동이 느린 장비는 done_s 설정 필요 · 감사 기록 열람은 운용자 로그인 필요"]); }
{ const s = page(6, "한계와 후속 계획", "지금까지의 검증은 가상 장치 기준 — 실장비 시험과 기준 확정이 남은 일",
    "남은 일은 기준 확정, 실행률 보완, 실장비 시험입니다.");
  table(s, 0.5, 1.72, 12.33, ["번호", "항목", "현재", "할 일", "시기"], [["1", "소프트웨어 등급·목표값 확정", "잠정 기준", "신뢰성시험계획서에 등급·규칙 집합·메트릭 제한값·도구 명시, 관리 기관 승인", "상세설계 검토 전"], ["2", "분기 실행률", `${ST.branch.pct}%`, "한쪽만 실행된 조건마다 반대 경우 시험 추가", "다음 판"],
    ["3", "문장 실행률", `${ST.stmt.pct}%`, "저장 실패·소켓 오류 결함 주입 시험, Windows·서비스 환경 시험", "통합 시험"], ["4", "MC/DC", "미수행", "안전 관련 판단 함수의 조건 조합 시험표, 도구 지원 확인", "등급 확정 후"],
    ["5", "공인 도구·제3자 시험", "자체 측정", "지정 도구로 재측정, 결과 대조", "시험 평가"], ["6", "실장비 시험", "가상 장치", "실제 제어기로 지령 규약·시간 한도·두절 복구 시험", "FAT·SAT"], ["7", "현장 이력 기반 예측", "합성 자료", "실측 8일 이상 확보 뒤 모델 재학습·재평가", "전개 후"]], [6, 22, 12, 44, 16], { center: [0], bold: [1], rowH: 0.42, fs: 10.5 });
  card(s, 0.5, 5.3, 6.07, 1.45, "관련 문서", "SW 신뢰성 시험 결과서(RL-001) · SW 시험결과 보고서(TR-001) · 실장치 통신 연동 방안서(IF-001) · 보안성 검토결과(SR-001) · 장치별 연동·디버깅 안내서(DG-01~06)", { bs: 11 });
  note(s, 6.76, 5.3, 6.07, 1.45, "다음 단계 제안", ["① 장치별 안내서를 제작사에 전달하고 회신 수령", "② 회신값으로 설정 파일 확정, 진단 도구로 장비별 점검", "③ 시운전 14단계 수행, 결과로 보고서 갱신"]); }

// ═══ 맺음
pres.addSection({ title: "맺음" });
{ const s = pres.addSlide({ masterName: "CLOSING", sectionTitle: "맺음" });
  s.addText("한 화면에서 보고, 두 단계로 지령하고,\n모든 조작을 기록합니다", { placeholder: "title" }); s.addText("오프라인 학습 AI 예측 · 제어화면 8종 · 현장 진단 도구 · 설정 파일 2개로 장비 연결 · 자동 시험 " + ST.n_tests + "건", { placeholder: "sub" });
  s.addText("한화에어로스페이스㈜  에너지솔루션사업센터", { placeholder: "org" }); s.addText(YM, { placeholder: "date" }); }

pres.writeFile({ fileName: OUT }).then(async () => { await applyTheme(OUT, THEME); console.log("saved", OUT); });
