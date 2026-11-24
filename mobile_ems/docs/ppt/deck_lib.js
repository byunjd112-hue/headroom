// 발표 자료 공통 양식 — 세 덱(build_deck.js · build_hw_deck.js · build_ai_deck.js)이 함께 쓴다.
// 기준은 사용자의 제안 발표 자료(IFPS_제안발표)다. 글자 크기와 위치는 아래 FS · L 에만 적는다.
// 각 덱은 여기의 구성 요소(카드·표·그림 설명 등)만 쓰고, 글자 크기를 직접 숫자로 적지 않는다.
// 구성 요소는 글 길이로 높이를 어림해 아래쪽 y 를 돌려준다 → 덱에서는 위에서 아래로 차례로 쌓는다.
// 저장할 때 넘침·여백 침범·첫 요소 높이 불일치를 [배치] 로 알려 준다(DECK_STRICT=1 이면 실패 처리).
const fs = require("fs"), path = require("path"); const pptxgen = require("pptxgenjs");
const { applyTheme } = require("./apply_theme.js");

// ── 글자 크기(역할별, pt). 이 값 밖의 크기는 표지·맺음 장에만 쓴다.
const FS = { title: 21, sub: 12.5, head: 16, th: 16, thDense: 14, body: 12, td: 12, tag: 12, kpi: 28, unit: 14, note: 8.8, cap: 7.5, foot: 8.5, pageno: 9.5, secEn: 9, axis: 9 };
// ── 위치(inch). 슬라이드 13.333 × 7.5
const L = { W: 13.333, H: 7.5, X: 0.5, R: 12.83, CW: 12.33, TOP: 1.72, BOT: 6.75, NOTE_Y: 6.5, NOTE_H: 0.32, GAP: 0.15,
  C2W: 6.09, C2X: 6.74,                                       // 2단: 폭 6.09, 둘째 단 시작 6.74
  SHOT_W: 7.6, SIDE_X: 8.25, SIDE_W: 4.58 };                  // 화면 그림(왼쪽) + 설명(오른쪽)
const THEME = { name: "IFPS 제안 발표", headFontFace: "맑은 고딕", bodyFontFace: "맑은 고딕",
  colors: { dk1: "2B2723", lt1: "FFFFFF", dk2: "35302A", lt2: "F9F1E6", accent1: "B59F76", accent2: "7B674F", accent3: "8A7449", accent4: "E0D7C8", accent5: "6F6B68", accent6: "B0392B", hlink: "8A7449", folHlink: "6F6B68" } };
const IMG_DIR = path.join(__dirname, "img");

// ── 글 크기 어림(맑은 고딕 기준, 넉넉하게). 줄 높이 1.33 em, 낱말 단위 줄바꿈
const NARROW = "iljtfrI.,:;'|!()[]/·", WIDE = "MWmw%@";
function chW(c) {
  const k = c.codePointAt(0);
  if (k === 32) return 0.32;
  if (k < 128) { if (NARROW.includes(c)) return 0.36; if (WIDE.includes(c)) return 0.88; if (c >= "0" && c <= "9") return 0.57; return c >= "A" && c <= "Z" ? 0.68 : c >= "a" && c <= "z" ? 0.56 : 0.66; }
  if (k === 0xB7) return 0.36;
  if (k < 0x2000) return 0.62;                                 // 라틴 확장·그리스 문자
  if (k >= 0x2070 && k < 0x20A0) return 0.42;                  // 위·아래 첨자
  if (k < 0x2070) return k === 0x2014 || k === 0x2026 ? 1 : 0.55;
  return 0.97;                                                 // 한글·원문자·화살표·도형
}
const strW = (t, pt, bold) => [...t].reduce((a, c) => a + chW(c), 0) * pt / 72 * (bold ? 1.05 : 1);
const lineH = pt => pt * 1.33 / 72;
function paras(text, pt, bold) {                               // → [[{t, pt, bold}], …] 문단별 조각
  if (!Array.isArray(text)) return String(text).split("\n").map(t => [{ t, pt, bold }]);
  const out = [[]];
  text.forEach(r => { const o = r.options || {}; String(r.text).split("\n").forEach((t, i) => { if (i) out.push([]); out[out.length - 1].push({ t, pt: o.fontSize || pt, bold: o.bold === undefined ? bold : o.bold }); });
    if (o.breakLine) out.push([]); });
  return out.filter((p, i) => p.length || i < out.length - 1);
}
function paraH(runs, w) {                                      // 한 문단의 높이
  let lines = 1, x = 0, mp = 0;
  runs.forEach(r => { mp = Math.max(mp, r.pt); r.t.split(/(?<= )/).forEach(word => { const ww = strW(word, r.pt, r.bold), bare = strW(word.trimEnd(), r.pt, r.bold);
    if (x > 0 && x + bare > w) { lines++; x = 0; }
    if (bare > w) { lines += Math.ceil(bare / w) - 1; x = bare % w; } else x += ww; }); });
  return lines * lineH(mp || 12);
}
/** 글 상자에 필요한 높이(inch). text 는 문자열 또는 pptxgenjs 조각 배열 */
function textH(text, w, pt = FS.body, o = {}) {
  const ps = paras(text, pt, o.bold); const gap = (o.paraSpaceAfter || 0) / 72; w *= 0.94;        // 글꼴 차이에 대비한 폭 여유
  return ps.reduce((a, p) => a + paraH(p, w), 0) + gap * Math.max(0, ps.length - 1);
}

function makeDeck(cfg) {
  const pres = new pptxgen(); pres.layout = "LAYOUT_WIDE"; pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = cfg.title; pres.author = "한화에어로스페이스㈜ 에너지솔루션사업센터"; pres.company = "한화에어로스페이스㈜"; pres.subject = cfg.subject;
  const C = pres.SchemeColor, K = { INK: C.text1, DARK: C.text2, CREAM: C.background2, TAN: C.accent1, BROWN: C.accent2, GOLD: C.accent3, LINE: C.accent4, GRAY: C.accent5, RED: C.accent6, WHITE: C.background1 };
  const { INK, DARK, CREAM, TAN, BROWN, GOLD, LINE, GRAY, WHITE } = K, HX = THEME.colors, RR = pres.ShapeType.roundRect;
  const IMG = n => path.join(IMG_DIR, n + ".jpg"), PNG = n => path.join(IMG_DIR, n + ".png");
  const warn = []; let nSlide = 0, cur = null;                 // cur: 지금 만드는 내용 장 {n, title, top}
  const ph = (name, type, x, y, w, h, o) => ({ placeholder: { options: Object.assign({ name, type, x, y, w, h, margin: 0, valign: "middle" }, o), text: "" } });

  // ── 레이아웃(표지 · 맺음 · 내용)
  pres.defineSlideMaster({ title: "COVER", background: { path: path.join(__dirname, "bg1.jpg") },
    objects: [{ rect: { x: 0, y: 0, w: L.W, h: L.H, fill: { color: "1B1713", transparency: 45 } } }, { rect: { x: 0.9, y: 2.05, w: 0.07, h: 1.85, fill: { color: TAN } } },
      ph("kicker", "body", 1.2, 2.0, 9, 0.35, { fontSize: 13, bold: true, color: TAN }), ph("title", "title", 1.2, 2.42, 11, 0.85, { fontSize: 40, bold: true, color: WHITE, align: "left" }),
      ph("en", "body", 1.2, 3.28, 11, 0.4, { fontSize: 15, color: "D8CBB4" }), ph("tag", "body", 1.2, 3.95, 11, 0.35, { fontSize: 12.5, bold: true, color: "E9DFC9" }),
      ph("org", "body", 1.2, 6.4, 9, 0.35, { fontSize: 11.5, color: "C9BCA4" })] });
  pres.defineSlideMaster({ title: "CLOSING", background: { path: path.join(__dirname, "bg23.jpg") },
    objects: [{ rect: { x: 0, y: 0, w: L.W, h: L.H, fill: { color: "17130F", transparency: 22 } } }, { rect: { x: 1.3, y: 4.1, w: 2.2, h: 0.05, fill: { color: TAN } } },
      ph("title", "title", 1.3, 2.2, 11.55, 1.7, { fontSize: 36, bold: true, color: WHITE, align: "left" }), ph("sub", "body", 1.3, 4.35, 11, 0.4, { fontSize: 14, color: "D8CBB4" }),
      ph("org", "body", 1.3, 5.5, 8, 0.45, { fontSize: 17, bold: true, color: WHITE }), ph("date", "body", 1.3, 5.98, 8, 0.3, { fontSize: 11, color: "B8AB94" })] });
  pres.defineSlideMaster({ title: "CONTENT", background: { color: "FFFFFF" }, margin: [0.5, 0.5, 0.6, 0.5],
    objects: [{ rect: { x: 0, y: 0, w: L.W, h: 0.62, fill: { color: DARK } } }, { rect: { x: 0.45, y: 0.11, w: 0.42, h: 0.4, fill: { color: TAN } } },
      { text: { text: cfg.footer, options: { x: 0.45, y: 7.05, w: 7, h: 0.3, fontSize: FS.foot, color: GRAY, margin: 0, valign: "middle" } } },
      ph("secno", "body", 0.45, 0.11, 0.42, 0.4, { fontSize: FS.head, bold: true, color: WHITE, align: "center" }), ph("sec", "body", 0.98, 0.07, 6.5, 0.28, { fontSize: FS.head, bold: true, color: WHITE }),
      ph("secen", "body", 1.0, 0.33, 6.5, 0.22, { fontSize: FS.secEn, bold: true, color: TAN }), ph("title", "title", L.X, 0.78, 12.3, 0.4, { fontSize: FS.title, bold: true, color: INK, align: "left" }),
      ph("sub", "body", L.X, 1.2, 12.3, 0.32, { fontSize: FS.sub, bold: true, color: GOLD, align: "left" })],
    slideNumber: { x: 11.83, y: 7.05, w: 1.05, h: 0.3, fontSize: FS.pageno, bold: true, color: GRAY, align: "right" } });

  // ── 배치 점검: 내용 장에 놓는 모든 요소의 자리와 글 넘침을 본다
  const say = m => warn.push(`[배치] ${cur.n}쪽 「${cur.title}」 ${m}`);
  function seen(o, what) {
    if (!cur || !o || o.placeholder || o.x === undefined) return;
    const b = o.y + (o.h || 0), lim = o._foot ? L.NOTE_Y + L.NOTE_H : L.BOT;
    cur.top = Math.min(cur.top, o.y); if (!o._foot) cur.bot = Math.max(cur.bot, b);
    if (o.x < L.X - 0.011 || o.x + (o.w || 0) > L.R + 0.011) say(`${what} 좌우 여백 침범 x=${o.x.toFixed(2)}~${(o.x + (o.w || 0)).toFixed(2)}`);
    if (o.y < L.TOP - 0.011 || b > lim + 0.011) say(`${what} 상하 범위 밖 y=${o.y.toFixed(2)}~${b.toFixed(2)}`);
  }
  /* 내용 장의 요소는 바로 그리지 않고 모아 두었다가(ops) 장을 닫을 때 그린다 — 그래야 아래쪽 빈 공간을 장마다 같게 맞출 수 있다(spread) */
  function watch(s) {
    const ops = cur_ops = []; const put = (fn, f, args, o) => { if (cur && o && !o.placeholder && o.x !== undefined && o.y !== undefined) ops.push({ fn, f, args, o }); else f(...args); };
    ["addShape", "addImage", "addChart", "addTable"].forEach(fn => { const f = s[fn].bind(s); s[fn] = (a, b, c) => { const o = fn === "addImage" ? a : fn === "addChart" ? c : b; if (fn !== "addTable") seen(o, fn.slice(3)); put(fn, f, [a, b, c], o); return s; }; });
    const t = s.addText.bind(s);
    s.addText = (text, o) => { seen(o, "글");
      if (cur && o && !o.placeholder && o.h && o.w) { const need = textH(text, o.w, o.fontSize || FS.body, o); if (need > o.h + 0.02) say(`글 넘침 ${need.toFixed(2)} > ${o.h.toFixed(2)} : ${String(Array.isArray(text) ? text[0].text : text).slice(0, 24)}…`); }
      put("addText", t, [text, o], o); return s; };
    return s;
  }
  const opH = o => o.rowH ? o.rowH.reduce((a, b) => a + b, 0) : (o.h || 0);
  /** 아래쪽 빈 공간 맞추기: 내용이 기준선(L.BOT, 주석이 있으면 주석 위)보다 일찍 끝나면 첫 요소의 높이(L.TOP)는 그대로 두고 장 전체를 세로로 고르게 늘려 기준선에서 끝나게 한다.
      글자 크기와 그림 크기는 바꾸지 않는다: 글 상자 · 카드 · 표의 줄은 높이가 늘고, 그림은 크기를 지킨 채 자리만 옮긴다(그림 위의 번호 표식 · 테두리 · 그림 설명은 그림과 함께 움직인다).
      너무 성긴 장은 MAX_K 배까지만 늘린다(그 이상은 내용이 흩어져 보인다). */
  const MAX_K = 1.6, MIN_COL = 3.7;
  const rides = (p, g) => p !== g && p.o.x >= g.o.x - 0.02 && p.o.x + (p.o.w || 0) <= g.o.x + g.o.w + 0.02 && p.o.y >= g.o.y - 0.02 && p.o.y <= g.o.y + g.o.h + 0.1 && opH(p.o) <= g.o.h + 0.04;
  /** 왼쪽 위의 큰 그림(화면 그림 + 오른쪽 설명 형식): 그림 아래가 비어 있으면 그림을 비율대로 키워 기준선까지 채우고, 오른쪽 단은 그만큼 좁힌다(MIN_COL 보다 좁히지는 않는다). 키운 그림 묶음을 돌려준다 */
  function growShot(it, target) {
    const g = it.find(p => p.fn === "addImage" && Math.abs(p.o.x - L.X) < 0.02 && Math.abs(p.o.y - L.TOP) < 0.02 && p.o.w > 5); if (!g) return [];
    const rd = it.filter(p => rides(p, g)), rest = it.filter(p => p !== g && !rd.includes(p)), right0 = g.o.x + g.o.w;
    if (rest.some(p => p.o.x < right0 - 0.02)) return [];                    // 그림 아래에 다른 내용이 있으면 키우지 않는다
    const colX = rest.length ? Math.min(...rest.map(p => p.o.x)) : L.R, ext = Math.max(0, ...rd.map(p => p.o.y + opH(p.o) - (g.o.y + g.o.h))), f = Math.min((target - ext - 0.05 - L.TOP) / g.o.h, (rest.length ? L.CW - L.GAP - MIN_COL : L.CW) / g.o.w); if (f < 1.03) return [g, ...rd];
    const gx = g.o.x, gy = g.o.y, w0 = g.o.w;
    rd.forEach(p => { const small = (p.o.w || 0) < 0.7 && opH(p.o) < 0.7, cx = p.o.x + (small ? p.o.w / 2 : 0), cy = p.o.y + (small ? p.o.h / 2 : 0);
      p.o.x = gx + (cx - gx) * f - (small ? p.o.w / 2 : 0); p.o.y = gy + (cy - gy) * f - (small ? p.o.h / 2 : 0);
      if (!small) { p.o.w *= f; if (p.o.h > g.o.h * 0.9) p.o.h *= f; } });
    g.o.w *= f; g.o.h *= f;
    const nx = gx + g.o.w + (colX - gx - w0), sx = (L.R - nx) / (L.R - colX);
    rest.forEach(p => { p.o.x = nx + (p.o.x - colX) * sx; if (p.o.w) p.o.w *= sx; if (p.o.colW) p.o.colW = p.o.colW.map(c => c * sx); });
    return [g, ...rd];
  }
  function spread(ops, foot) {
    const all = ops.filter(p => !p.o._foot); if (!all.length) return;
    const target = foot ? L.NOTE_Y - 0.06 : L.BOT, fixed = growShot(all, target), it = all.filter(p => !fixed.includes(p)); if (!it.length) return;
    const bot = Math.max(...it.map(p => p.o.y + opH(p.o))), k = Math.min(MAX_K, (target - L.TOP) / Math.max(0.5, bot - L.TOP)); if (k < 1.02) return;
    const imgs = it.filter(p => p.fn === "addImage"), ride = p => imgs.find(g => rides(p, g));
    const moved = new Map(it.map(p => [p, p.o.y])), ny = y => L.TOP + (y - L.TOP) * k;
    it.forEach(p => { const g = p.fn === "addImage" ? null : ride(p), y0 = moved.get(p);
      if (g) p.o.y = ny(moved.get(g)) + (y0 - moved.get(g));          // 그림에 딸린 것: 그림과 같은 만큼 옮긴다
      else { p.o.y = ny(y0); if (p.fn !== "addImage") { if (p.o.rowH) p.o.rowH = p.o.rowH.map(v => v * k); else if (p.o.h) p.o.h *= k; } } });
  }
  let cur_ops = [];
  function closePage() {
    if (cur && Math.abs(cur.top - L.TOP) > 0.011) say(`첫 요소 높이 ${cur.top.toFixed(2)} (기준 ${L.TOP})`);
    if (cur && cur.foot && cur.bot > L.NOTE_Y - 0.03) say(`내용이 ※ 주석과 겹침 (아래쪽 ${cur.bot.toFixed(2)})`);
    if (cur) { spread(cur_ops, cur.foot); cur_ops.forEach(p => p.f(...p.args)); }
    cur_ops = []; cur = null;
  }

  // ── 장 만들기
  let curSec = 0, sub = 0;
  function content(secTitle, no, name, en, title, subtitle, notes) {
    closePage(); nSlide++; const s = watch(pres.addSlide({ masterName: "CONTENT", sectionTitle: secTitle })); cur = { n: nSlide, title, top: 99, bot: 0, foot: false };
    s.addText(no, { placeholder: "secno" }); s.addText(name, { placeholder: "sec" }); s.addText(en, { placeholder: "secen" }); s.addText(title, { placeholder: "title" }); s.addText(subtitle, { placeholder: "sub" });
    if (notes) s.addNotes(notes); return s;
  }
  /** 내용 장. sec 는 cfg.secs 의 차례(1부터) */
  function page(sec, title, subtitle, notes) {
    const [name, en] = cfg.secs[sec - 1], st = `${sec}. ${name}`;
    if (sec !== curSec) { curSec = sec; sub = 0; pres.addSection({ title: st }); } sub++;
    return content(st, String(sec), name, en, `${sec}-${sub}.  ${title}`, subtitle, notes);
  }
  function cover(f) { closePage(); nSlide++; pres.addSection({ title: "표지·목차" }); const s = pres.addSlide({ masterName: "COVER", sectionTitle: "표지·목차" }); Object.entries(f).forEach(([k, v]) => k === "notes" ? s.addNotes(v) : s.addText(v, { placeholder: k })); return s; }
  const toc = (title, subtitle) => content("표지·목차", "", "목 차", "CONTENTS", title, subtitle);
  function closing(f) { closePage(); nSlide++; pres.addSection({ title: "맺음" }); const s = pres.addSlide({ masterName: "CLOSING", sectionTitle: "맺음" }); Object.entries(f).forEach(([k, v]) => s.addText(v, { placeholder: k })); return s; }

  // ── 구성 요소
  const T = (s, text, o) => s.addText(text, Object.assign({ isTextBox: true, margin: 0, color: INK, fontSize: FS.body, valign: "top" }, o));
  const box = (s, x, y, w, h, fill, line, name, lw) => s.addShape(RR, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color: line, width: lw || 1 }, objectName: name });
  const PAD = 0.16, TH = 0.32, SP = 3;                          // 상자 안 여백, 제목 줄 높이, 문단 간격(pt)
  const fit = h => Math.ceil((h * 1.06 + 0.02) * 100) / 100;   // 어림 높이에 여유 6%
  const lines = a => a.map((t, i) => ({ text: t, options: { breakLine: i < a.length - 1 } }));

  /** 본문 글(12pt). 높이를 어림해 놓고 아래쪽 y 를 돌려준다 */
  function body(s, x, y, w, text, o = {}) { const h = o.h || fit(textH(text, w, FS.body, { paraSpaceAfter: SP, bold: o.bold })); T(s, text, Object.assign({ x, y, w, h, paraSpaceAfter: SP }, o)); return y + h; }
  /** 장 안의 소제목(16pt) */
  function head(s, x, y, w, text) { T(s, text, { x, y, w, h: TH, fontSize: FS.head, bold: true, color: DARK, valign: "middle" }); return y + TH; }
  const cardNeed = (w, text) => 0.1 + TH + 0.06 + (text ? fit(textH(text, w - 2 * PAD, FS.body, { paraSpaceAfter: SP })) : 0) + 0.1;
  /** 크림색 카드: 제목(16pt) + 본문(12pt). h 가 없으면 글에 맞춘다 */
  function card(s, x, y, w, h, title, text, o = {}) {
    h = h || cardNeed(w, text); box(s, x, y, w, h, o.fill || CREAM, LINE, "카드 " + title);
    T(s, title, { x: x + PAD, y: y + 0.1, w: w - 2 * PAD, h: TH, fontSize: FS.head, bold: true, color: o.tc || DARK, valign: "middle" });
    if (text) T(s, text, { x: x + PAD, y: y + 0.1 + TH + 0.06, w: w - 2 * PAD, h: h - TH - 0.26, color: o.bc || INK, paraSpaceAfter: SP });
    return y + h;
  }
  const MATH = "Cambria Math";
  const fparts = (formulas, desc) => formulas.map(t => ({ text: t, options: { fontFace: MATH, bold: true, color: DARK, breakLine: true } })).concat(desc ? [{ text: desc, options: {} }] : []);
  const fcardNeed = (w, formulas, desc) => 0.1 + TH + 0.06 + fit(textH(fparts(formulas, desc), w - 2 * PAD, FS.body, { paraSpaceAfter: SP })) + 0.1;
  /** 수식 카드: 제목 + 수식(여러 줄, Cambria Math) + 설명 */
  function fcard(s, x, y, w, h, title, formulas, desc) {
    h = h || fcardNeed(w, formulas, desc); card(s, x, y, w, h, title, "");
    T(s, fparts(formulas, desc), { x: x + PAD, y: y + 0.1 + TH + 0.06, w: w - 2 * PAD, h: h - TH - 0.26, paraSpaceAfter: SP }); return y + h;
  }
  /** 같은 높이 카드를 가로로 나란히. items = [[제목, 본문], …] */
  function cards(s, y, items, o = {}) {
    const x = o.x || L.X, w = o.w || L.CW, n = items.length, cw = (w - L.GAP * (n - 1)) / n, h = o.h || Math.max(...items.map(([, b]) => cardNeed(cw, b)));
    items.forEach(([t, b], i) => card(s, x + i * (cw + L.GAP), y, cw, h, t, b)); return y + h;
  }
  /** 갈색 수치 상자: 이름(12) + 값(28) + 단위(14) */
  function stat(s, x, y, w, h, label, value, unit) {
    box(s, x, y, w, h, BROWN, BROWN, "수치 " + label);
    T(s, label, { x, y: y + 0.08, w, h: 0.28, color: "EFE6D8", align: "center", valign: "middle" });
    T(s, [{ text: value, options: { fontSize: FS.kpi, bold: true, color: WHITE } }, { text: unit ? " " + unit : "", options: { fontSize: FS.unit, color: "F0E4CE" } }], { x, y: y + 0.36, w, h: h - 0.4, align: "center", valign: "middle" });
    return y + h;
  }
  function stats(s, y, items, o = {}) {
    const x = o.x || L.X, w = o.w || L.CW, n = items.length, cw = (w - L.GAP * (n - 1)) / n, h = o.h || 0.95;
    items.forEach(([l, v, u], i) => stat(s, x + i * (cw + L.GAP), y, cw, h, l, v, u)); return y + h;
  }
  function tag(s, x, y, text, w) {
    w = w || 0.3 + strW(text, FS.tag, true); box(s, x, y, w, 0.3, GOLD, GOLD, "꼬리표 " + text);
    T(s, text, { x, y, w, h: 0.3, fontSize: FS.tag, bold: true, color: WHITE, align: "center", valign: "middle" }); return y + 0.3;
  }
  /** 표: 머리 16pt(dense 면 14pt), 본문 12pt. 줄 높이를 글에 맞춰 어림하고 아래쪽 y 를 돌려준다. colW 는 비율 */
  function table(s, x, y, w, hd, rows, colW, o = {}) {
    const bd = { type: "solid", pt: 0.75, color: HX.accent4 }, sum = colW.reduce((a, b) => a + b, 0), cw = colW.map(c => c / sum * w), hs = o.dense ? FS.thDense : FS.th;
    const cell = (t, isH, i) => ({ text: String(t), options: { fontSize: isH ? hs : FS.td, bold: isH || (o.bold || []).includes(i), color: isH ? WHITE : INK, fill: { color: isH ? BROWN : WHITE }, align: isH || (o.center || []).includes(i) ? "center" : "left", valign: "middle", border: [bd, bd, bd, bd], margin: [0.03, 0.08, 0.03, 0.08] } });
    const rh = (r, pt, isH) => Math.max(o.rowH || 0, ...r.map((t, i) => textH(String(t), cw[i] - 0.18, pt, { bold: isH || (o.bold || []).includes(i) }))) + 0.1;
    let hh = [rh(hd, hs, true)].concat(rows.map(r => rh(r, FS.td, false))), tot = hh.reduce((a, b) => a + b, 0);
    if (o.h && tot < o.h) { const add = Math.min(0.3, (o.h - tot) / rows.length); hh = hh.map((v, i) => i ? v + add : v); tot += add * rows.length; }   // o.h: 그 높이까지 줄을 고르게 늘린다
    seen({ x, y, w, h: tot }, "표");
    s.addTable([hd.map((t, i) => cell(t, true, i))].concat(rows.map(r => r.map((c, i) => cell(c, false, i)))), { x, y, w, colW: cw, rowH: hh, objectName: o.name || "표" });
    return y + tot;
  }
  /** 테두리 있는 그림. ratio = 가로/세로. 높이를 돌려준다 */
  function frame(s, file, x, y, w, ratio, name) {
    const h = w / ratio; s.addImage({ path: file, x, y, w, h, altText: name, objectName: name });
    s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { type: "none" }, line: { color: LINE, width: 1 }, objectName: "그림 테두리" }); return h;
  }
  /** 화면 그림 + 번호 표식(px 좌표는 원본 크기 기준). 높이를 돌려준다 */
  function shot(s, name, x, y, w, marks = [], srcW = 1920, srcH = 1080) {
    const h = frame(s, IMG(name), x, y, w, srcW / srcH, "화면 " + name), d = 0.28;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));                // 표식이 그림 밖으로 나가지 않게
    marks.forEach(([n, px, py]) => { const cx = clamp(x + px / srcW * w, x + d / 2, x + w - d / 2), cy = clamp(y + py / srcH * h, y + d / 2, y + h - d / 2);
      s.addShape(pres.ShapeType.ellipse, { x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: { color: TAN }, line: { color: WHITE, width: 1.25 }, objectName: "표식 " + n });
      T(s, String(n), { x: cx - d / 2, y: cy - d / 2, w: d, h: d, bold: true, color: WHITE, align: "center", valign: "middle" }); });
    return h;
  }
  /** 그림 아래 설명(7.5pt). 아래쪽 y */
  function caption(s, x, y, w, text) { T(s, text, { x, y: y + 0.03, w, h: 0.17, fontSize: FS.cap, color: GRAY, valign: "middle" }); return y + 0.2; }
  /** 실사형 그림(AI 생성 개념도) + 설명. 설명까지의 높이를 돌려준다 */
  function pic(s, name, x, y, w, cap) { const h = frame(s, IMG(name), x, y, w, 1024 / 688, "그림 " + name); return cap ? caption(s, x, y + h, w, cap + "  (개념도 · AI 생성)") - y : h; }
  /** 번호 설명 목록: [번호, 제목, 설명]. 제목은 굵게, 설명은 이어서. o.h 를 주면 그 높이에 고르게 편다 */
  function legend(s, x, y, w, items, o = {}) {
    const tw = w - 0.66, txt = items.map(([, t, d]) => [{ text: t + (d ? "  " : ""), options: { bold: true, color: DARK } }, { text: d || "" }]);
    const hs = txt.map(t => Math.max(0.46, fit(textH(t, tw)) + 0.16)), used = hs.reduce((a, b) => a + b, 0), n = items.length;
    const gap = o.h && n > 1 ? Math.min(0.3, Math.max(0.06, (o.h - used) / (n - 1))) : o.gap === undefined ? 0.08 : o.gap; let yy = y;
    items.forEach(([no], i) => { box(s, x, yy, w, hs[i], CREAM, LINE, "설명 " + no);
      s.addShape(pres.ShapeType.ellipse, { x: x + 0.12, y: yy + 0.08, w: 0.3, h: 0.3, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "번호 " + no });
      T(s, String(no), { x: x + 0.12, y: yy + 0.08, w: 0.3, h: 0.3, bold: true, color: WHITE, align: "center", valign: "middle" });
      T(s, txt[i], { x: x + 0.54, y: yy + 0.08, w: tw, h: hs[i] - 0.16, valign: "middle" }); yy += hs[i] + (i < n - 1 ? gap : 0); });
    return yy;
  }
  const noteNeed = (w, ls) => 0.08 + TH + 0.04 + fit(textH(lines(ls), w - 2 * PAD, FS.body, { paraSpaceAfter: SP })) + 0.08;
  /** 흰 바탕 강조 상자(금색 테두리): 제목(16pt) + 줄 목록(12pt). h 가 없으면 글에 맞춘다 */
  function note(s, x, y, w, h, title, ls) {
    h = h || noteNeed(w, ls);
    box(s, x, y, w, h, WHITE, GOLD, "강조 " + title, 1.25);
    T(s, title, { x: x + PAD, y: y + 0.08, w: w - 2 * PAD, h: TH, fontSize: FS.head, bold: true, color: GOLD, valign: "middle" });
    T(s, lines(ls), { x: x + PAD, y: y + 0.08 + TH + 0.04, w: w - 2 * PAD, h: h - TH - 0.2, paraSpaceAfter: SP }); return y + h;
  }
  /** 가로 절차(번호 머리 + 화살표): [제목, 설명] */
  function steps(s, x, y, w, h, items) {
    const n = items.length, gap = 0.24, bw = (w - gap * (n - 1)) / n, HH = 0.36;
    h = h || HH + 0.08 + Math.max(...items.map(([, d]) => fit(textH(d, bw - 0.2)))) + 0.08;
    items.forEach(([title, desc], i) => { const xx = x + i * (bw + gap);
      box(s, xx, y, bw, h, CREAM, LINE, "절차 " + (i + 1)); s.addShape(pres.ShapeType.rect, { x: xx, y, w: bw, h: HH, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "절차 머리 " + (i + 1) });
      T(s, `${i + 1}  ${title}`, { x: xx + 0.1, y, w: bw - 0.2, h: HH, bold: true, color: WHITE, valign: "middle" });
      T(s, desc, { x: xx + 0.1, y: y + HH + 0.08, w: bw - 0.2, h: h - HH - 0.14 });
      if (i < n - 1) T(s, "▶", { x: xx + bw, y: y + h / 2 - 0.12, w: gap, h: 0.24, fontSize: FS.axis, color: GOLD, align: "center", valign: "middle" }); });
    return y + h;
  }
  /** 목차 장의 카드 격자(4열): items = [[이름, 영문, 설명], …]. 아래쪽 y */
  function tocCards(s, items, ch = 2.2) {
    const cw = (L.CW - 3 * L.GAP) / 4;
    items.forEach(([k, e, d], i) => { const x = L.X + (i % 4) * (cw + L.GAP), y = L.TOP + Math.floor(i / 4) * (ch + L.GAP);
      box(s, x, y, cw, ch, CREAM, LINE, "목차 " + (i + 1)); s.addShape(pres.ShapeType.rect, { x, y, w: cw, h: 0.62, fill: { color: BROWN }, line: { color: BROWN, width: 1 }, objectName: "목차 머리 " + (i + 1) });
      T(s, `${i + 1}  ${k}`, { x: x + 0.14, y, w: cw - 0.28, h: 0.62, fontSize: FS.head, bold: true, color: WHITE, valign: "middle" });
      T(s, e, { x: x + 0.14, y: y + 0.7, w: cw - 0.28, h: 0.26, fontSize: FS.secEn, bold: true, color: GOLD, valign: "middle" }); T(s, d, { x: x + 0.14, y: y + 1.0, w: cw - 0.28, h: ch - 1.08 }); });
    return L.TOP + Math.ceil(items.length / 4) * (ch + L.GAP) - L.GAP;
  }
  /** 장 아래 ※ 주석(8.8pt, 두 줄까지) */
  function foot(s, text) { cur.foot = true; T(s, text.startsWith("※") ? text : "※ " + text, { x: L.X, y: L.NOTE_Y, w: L.CW, h: L.NOTE_H, fontSize: FS.note, color: GRAY, valign: "middle", _foot: true }); }
  /** 화면 그림(왼쪽) + 번호 설명(오른쪽, 그림 높이에 맞춤). {y: 그림 아래쪽, x·w: 오른쪽 단} 을 돌려준다 */
  function shotPage(s, name, marks, items, o = {}) {
    const w = o.w || L.SHOT_W, x2 = L.X + w + L.GAP, h = shot(s, name, L.X, L.TOP, w, marks, o.srcW, o.srcH);
    if (items) legend(s, x2, L.TOP, L.R - x2, items, { h: o.lh || h }); return { y: L.TOP + h, x: x2, w: L.R - x2 };
  }
  /** 화면 그림 두 장을 나란히. 그림 아래쪽 y */
  function shots2(s, a, am, b, bm) { const h = shot(s, a, L.X, L.TOP, L.C2W, am); shot(s, b, L.C2X, L.TOP, L.C2W, bm); return L.TOP + h; }
  const chartOpt = (title, o = {}) => Object.assign({ barDir: "col", barGapWidthPct: 55, chartColors: [HX.accent2, HX.accent4], showTitle: true, title, titleFontSize: FS.body, titleColor: HX.dk1, titleFontFace: "+mn-lt",
    showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: FS.axis, dataLabelColor: HX.dk1, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0.0", catAxisLabelColor: HX.accent5, valAxisLabelColor: HX.accent5, catAxisLabelFontSize: FS.axis, valAxisLabelFontSize: FS.axis,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valGridLine: { color: HX.accent4, size: 0.75 }, catGridLine: { style: "none" }, showLegend: true, legendPos: "b", legendFontSize: FS.axis, legendColor: HX.accent5, legendFontFace: "+mn-lt" }, o);

  async function save(out) {
    closePage(); await pres.writeFile({ fileName: out }); await applyTheme(out, THEME);
    warn.forEach(m => console.error(m)); console.log("saved", out, warn.length ? `(배치 경고 ${warn.length}건)` : "");
    if (warn.length && process.env.DECK_STRICT) process.exit(1);
  }
  return Object.assign({ pres, K, HX, FS, L, IMG, PNG, page, cover, toc, closing, save, T, body, head, card, cards, stat, stats, tag, table, frame, shot, caption, pic, legend, note, steps, foot, shotPage, shots2, chartOpt, textH, fit, noteNeed, cardNeed, fcard, fcardNeed, tocCards, MATH }, K);
}
module.exports = { makeDeck, FS, L, THEME, textH };
