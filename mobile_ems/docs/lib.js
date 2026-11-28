// 공통 Word 서식: 글자 검정, 표는 회색 계열, 본문 11pt, 제목 14 · 12 · 11pt, 표 · 설명 10pt, 주석 · 바닥글 9pt.
// 제목은 다음 문단과 한 쪽에, 표의 줄은 쪽 사이에서 나누지 않는다(아래 KEEP — 예전에는 쓰지 않았다. 되돌리려면 false).
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, LevelFormat, PageBreak, Footer, PageNumber, HeadingLevel, TableOfContents, ImageRun, VerticalAlign, TableLayoutType } = require("docx");
const fs = require("fs");
const F = "맑은 고딕", W = 9638;
// ── 공통 양식(모든 Word 문서가 같이 쓴다. 현장 보고서 작성기 ifps_ems_rt/hmi/docx.py 도 같은 값 — 고치면 함께 고친다)
// 쪽: A4, 위·아래 25 mm(1418), 좌·우 20 mm(1134) → 본문 폭 W. 글자 크기는 반 포인트(22 = 11 pt)
const S = { body: 22, h1: 28, h2: 24, h3: 22, table: 20, cap: 20, note: 18, code: 20, foot: 18, title: 28 };
const SP = { body: { after: 100, line: 300 }, h1: { before: 280, after: 140 }, h2: { before: 200, after: 100 }, h3: { before: 160, after: 80 }, cap: { before: 60, after: 160 }, fig: { before: 120, after: 40 }, gap: 60 };
const MARK = false;      // 문단의 '다음과 함께 · 줄 묶음 · 앞에서 쪽 나눔'을 쓰지 않는다(사용자 지시: Word 가 그런 문단 앞에 검은 네모 표시를 보인다). 묶음은 표의 머리줄 · 줄 나눔 금지로 한다
const KEEP = true;        // 제목 · 그림 · 표 설명을 다음 문단과 한 쪽에 두고 표의 줄을 쪽 사이에서 나누지 않는다(인쇄 미리보기 기준 쪽 구성). 끄려면 false
let NI = 0;
// ── 조판 다듬기(문서가 tune 으로 켠다 — 안 켜면 예전 그대로): 장평 · 자간, 본문 양쪽 정렬, 표 칸 여백, 줄바꿈 규칙
const TN = { scale: 95, cs: -3, just: true, center: true, cell: { top: 60, bottom: 60, left: 100, right: 100 }, tline: 260, fx: t => tidy(nodot(nodash(rename(t)))), keep: { whole: 5, head: 3, tail: 2 } };   // 문서 작성 공통 규칙(모든 Word 문서의 기본값)
const tune = o => Object.assign(TN, o);
const NB = "\u00A0";
/** 줄바꿈 규칙: 줄이 어절 사이에서만, 그리고 어색하지 않은 곳에서만 넘어가게 묶음 공백을 넣는다.
    가운뎃점 · 화살표는 앞말에 붙이고, 수와 단위 · 범위(~) · 영문 뒤 조사는 떼지 않으며, 짧은 괄호는 통째로 다음 줄로 넘긴다 */
function tidy(t) {
  t = t.replace(/ · /g, NB + "· ").replace(/ → /g, NB + "→ ").replace(/(\S) ~ (\S)/g, "$1" + NB + "~" + NB + "$2").replace(/ — /g, NB + "— ");
  t = t.replace(/(\d) (kWh|kWp|kW|kHz|MHz|GHz|Hz|ms|mΩ|Ω|GB|MB|KB|V|A|%|℃|pt|mm)(?![A-Za-z])/g, "$1" + NB + "$2");
  t = t.replace(/([A-Za-z0-9)\]'%℃]) (가|이|은|는|을|를|와|과|의|에|에서|에는|에도|로|으로|도|만|까지|부터|보다|마다|이다|임)(?=[\s.,)·" + NB + "]|$)/g, "$1" + NB + "$2");
  return t.replace(/\(([^()]*)\)/g, (m, a) => a.length <= 20 ? "(" + a.replace(/ /g, NB) + ")" : "(" + a.replace(/^(\S+) /, "$1" + NB).replace(/ (\S+)$/, NB + "$1") + ")");
}
/** 체계 명칭(사용자 결정, Rev70): EMS → 전술전력통제체계(TPCS, Tactical Power Control System). 문서의 글에서 바꾼다(프로그램의 모듈 · 신호 이름은 그대로). tools/doc_rules.py 와 같은 규칙 */
function rename(t) {
  if (t.indexOf("EMS") < 0) return t;
  return t.replace(/IFPS_Mobile_EMS/g, "IFPS_TPCS").replace(/IFPS_EMS_/g, "IFPS_TPCS_").replace(/이동형전력체계EMS/g, "전술전력통제체계TPCS")
    .replace(/이동형 전력체계 EMS|이동형 EMS|EMS 중앙제어/g, "전술전력통제체계(TPCS)").replace(/(?<![A-Za-z0-9_.\/])EMS(?![A-Za-z0-9_])/g, "TPCS");
}
/** 가운뎃점으로 낱말을 잇지 않는다(사용자 지시): 둘이면 '및', 셋 이상이면 쉼표로 나열하고 마지막만 '및'으로 잇는다. 괄호 안은 따로 센다 */
function nodot(t) {
  t = t.replace(/[ㆍ•∙]/g, "·"); if (t.indexOf("·") < 0) return t;
  if (t.indexOf("=") >= 0) t = t.replace(/([A-Za-z0-9_)])·(?=[A-Za-z0-9_(])/g, "$1 × ");
  t = t.replace(/ ?· ?/g, " · ");
  const hold = [], seg = x => { const n = (x.match(/ · /g) || []).length; if (!n) return x; let k = 0; const has = /(^|\s)및(\s|$)/.test(x);
    return x.replace(/ · /g, () => (++k === n && !has ? " 및 " : ", ")); };
  const flat = x => x.split(/([,.:;=→\/①-⑳])/).map(seg).join("");
  let prev; do { prev = t; t = t.replace(/\(([^()]*)\)/g, (m, a) => { hold.push("(" + flat(a) + ")"); return "\u0001" + (hold.length - 1) + "\u0002"; }); } while (t !== prev);
  t = flat(t); do { prev = t; t = t.replace(/\u0001(\d+)\u0002/g, (m, i) => hold[+i]); } while (t !== prev);
  return t.replace(/ · /g, ", ");
}
/** 줄표로 구절을 잇지 않는다: 앞말이 짧은 이름표면 쌍점, 아니면 쉼표. 줄표만 있는 칸은 '해당 없음'(tools/doc_rules.py 와 같은 규칙) */
function nodash(t) {
  if (/^\s*[—–]\s*$/.test(t)) return t.replace(/[—–]/, "해당 없음");
  if (!/[—–]| - /.test(t)) return t;
  const rep = (m, off, all) => { const left = all.slice(0, off).split(/[.:;,(]/).pop().trim(); return left.length > 0 && left.length <= 14 && all.slice(Math.max(0, off - 30), off).indexOf(":") < 0 ? ": " : ", "; };
  return t.replace(/\s*[—–]\s*/g, rep).replace(/([가-힣)]) - (?=[가-힣(])/g, (m, a, off, all) => a + rep(m, off + 1, all));
}
const run = (t, o = {}) => { mark(typeof t === "string" ? rename(t) : t); const mono = o.font === "Consolas" || o.font === "Cambria Math";
  return new TextRun(Object.assign({ text: typeof t !== "string" || !TN.fx ? t : !mono ? TN.fx(t) : o.font === "Cambria Math" ? t.replace(/ ?· ?/g, " × ") : /[가-힣]/.test(t) ? nodot(nodash(rename(t))) : t, font: F, size: S.body, color: "000000" }, TN.scale && !mono ? { scale: TN.scale, characterSpacing: TN.cs } : {}, o)); };
// ── 약어(사용자 요구): 문서에 나온 약어만 끝의 '별첨 약어 설명' 표에 싣고, 핵심 약어는 본문에 처음 나올 때 쪽 아래에 8pt 주석을 단다(문서마다 FN_MAX 개까지 — 과하지 않게)
const ABBR = JSON.parse(fs.readFileSync(__dirname + "/abbr.json", "utf8")), FN_MAX = 10;
ABBR.items.forEach(a => { a.rx = new RegExp(a.re ? a.re : "(?<![A-Za-z0-9])" + a.k.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "(?![A-Za-z0-9])"); });
let USED = new Set(), NOTED = new Set(), NOTES = {};
const { FootnoteReferenceRun } = require("docx");
const mark = t => { if (typeof t === "string" && /[A-Z①-⑥]|\dms/.test(t)) ABBR.items.forEach(a => { if (!USED.has(a.k) && a.rx.test(t)) USED.add(a.k); }); };
/** 본문 문단의 글: 핵심 약어가 처음 나오면 그 뒤에 주석 번호를 붙인다 */
function runsFn(t) {
  const s = rename(t); let best = null;
  if (NOTED.size < FN_MAX) ABBR.items.forEach(a => { if (!a.fn || NOTED.has(a.k)) return; const m = a.rx.exec(s); if (m && (!best || m.index < best.i)) best = { a, i: m.index, e: m.index + m[0].length }; });
  if (!best) return [run(t)];
  NOTED.add(best.a.k); const id = NOTED.size;
  NOTES[id] = { children: [new Paragraph({ spacing: { after: 0, line: 220 }, children: [new TextRun({ text: ` ${best.a.k}: ${best.a.en}. ${best.a.ko}`, font: F, size: 16, color: "000000" })] })] };
  return [run(s.slice(0, best.e)), new FootnoteReferenceRun(id)].concat(s.length > best.e ? [run(s.slice(best.e))] : []);
}
const P = (t, o = {}) => new Paragraph(Object.assign({ spacing: SP.body, children: Array.isArray(t) ? t : runsFn(t) }, TN.just ? { alignment: AlignmentType.BOTH } : {}, o));
const head = (lv, k) => t => (NI++, Object.assign(new Paragraph({ heading: lv, spacing: SP[k], children: [run(t, { size: S[k], bold: true })] }), { __h: true }));
const H1 = head(HeadingLevel.HEADING_1, "h1"), H2 = head(HeadingLevel.HEADING_2, "h2"), H3 = head(HeadingLevel.HEADING_3, "h3");
const CODE = t => new Paragraph({ spacing: { after: 40 }, shading: { type: ShadingType.CLEAR, fill: "F2F2F2" }, indent: { left: 200 }, children: [run(t, { font: "Consolas", size: S.code })] });
const EQ = t => new Paragraph({ spacing: { before: 40, after: 100 }, indent: { left: 400 }, children: [run(t, { font: "Cambria Math", size: S.body })] });
const NUM = t => new Paragraph({ numbering: { reference: "num", level: 0, instance: NI }, spacing: { after: 60, line: 300 }, children: [run(t)] });
const KV = (k, v) => P([run(k + "  ", { bold: true }), run(v)]);
/** 주석(9 pt, 회색) */
const NOTE = t => new Paragraph({ spacing: { after: 100, line: 280 }, children: [run(t, { size: S.note, color: "595959" })] });
/** 그림 · 표의 설명(10 pt, 가운데). above 면 표 위 설명(다음 문단인 표와 한 쪽에) */
// 표 위 설명(above)은 표의 첫 줄(되풀이 머리줄)로 넣어 표와 떨어지지 않게 한다 — save 가 바로 뒤의 표와 합친다
const CAPP = (t, above) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: above ? { before: 140, after: 60 } : SP.cap, children: [run(t, { size: S.cap })] });
const CAP = (t, above) => above ? { __cap: t } : CAPP(t, false);
/** 그림(가운데) + 설명. 그림과 설명은 한 쪽에 둔다. 문단 두 개를 돌려준다 */
function FIG(file, w, h, cap) {
  const img = new ImageRun({ type: file.toLowerCase().endsWith("png") ? "png" : "jpg", data: fs.readFileSync(file), transformation: { width: w, height: h }, altText: { title: cap, description: cap, name: require("path").basename(file) } });
  return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: SP.fig, children: [img] }), CAP(cap)];
}
const bd = { style: BorderStyle.SINGLE, size: 4, color: "808080" }, B = { top: bd, bottom: bd, left: bd, right: bd };
/** 표: 폭 = 본문 폭, 글자 10 pt, 머리줄은 회색 · 굵게 · 가운데 · 쪽이 넘어가면 되풀이, 줄은 쪽 사이에서 나누지 않는다. widths 는 비율 */
const TBL = (head, rows, widths, o = {}) => ({ __tbl: [head, rows, widths, o] });
function mkTBL(head, rows, widths, o = {}, cap) {
  const sum = widths.reduce((a, b) => a + b, 0), cw = widths.map(w => Math.round(w / sum * W));
  cw[cw.length - 1] += W - cw.reduce((a, b) => a + b, 0);
  // 칸 가운데 맞춤이 기본(tune 의 center): 열 단위로 정한다. 긴 문장(한 줄 반을 넘는 글)이 있는 열만 통째로 왼쪽 맞춤 — 한 열 안에서 맞춤이 섞이지 않게
  const lines = (t, i) => { const x = String(typeof t === "object" && t !== null ? t.t : t); let w = 0; for (const ch of x) w += ch.charCodeAt(0) > 0x2E7F ? 1 : 0.56;
    return w * (S.table * 10) * (TN.scale ? TN.scale / 100 : 1) / (cw[i] - TN.cell.left - TN.cell.right - 60); };
  const mid = cw.map((_, i) => rows.every(r => r[i] === undefined || lines(r[i], i) <= 1.5)), one = (t, i) => mid[i];
  const cell = (t, i, hd, kx) => new TableCell({ borders: B, width: { size: cw[i], type: WidthType.DXA }, margins: TN.cell, verticalAlign: VerticalAlign.CENTER,
    shading: hd ? { type: ShadingType.CLEAR, fill: "D9D9D9" } : undefined,
    children: [new Paragraph({ alignment: hd || (o.center || []).includes(i) || (TN.center && one(t, i)) ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { line: TN.tline },
      children: [typeof t === "object" && t !== null ? run(String(t.t), { size: S.table, bold: true, color: t.c }) : run(String(t), { size: S.table, bold: hd || (o.bold || []).includes(i), font: (o.mono || []).includes(i) && !hd ? "Consolas" : F })] })] });
  // o.keep = { whole, head, tail }: 줄 수가 whole 이하면 표를 한 쪽에 묶고, 길면 첫 head 줄 · 끝 tail 줄만 묶는다(쪽 끝에 한두 줄만 남거나 넘어가지 않게). 안 주면 예전대로
  const k = o.keep || TN.keep, N = rows.length, kn = n => !!k && n < N - 1 && (N <= k.whole || n < k.head - 1 || n >= N - k.tail);
  const no = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const capRow = cap ? [new TableRow({ tableHeader: true, cantSplit: true, children: [new TableCell({ columnSpan: cw.length, borders: { top: no, left: no, right: no, bottom: bd }, width: { size: W, type: WidthType.DXA },
    margins: { top: 0, bottom: 40, left: 0, right: 0 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 140, after: 0 }, children: [run(cap, { size: S.cap })] })] })] })] : [];
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw, layout: TableLayoutType.FIXED,
    rows: capRow.concat([new TableRow({ tableHeader: true, cantSplit: KEEP, children: head.map((h, i) => cell(h, i, true, !!k)) })].concat(rows.map((r, n) => new TableRow({ cantSplit: KEEP, children: r.map((c, i) => cell(c, i, false, kn(n))) })))) });
}
const GAP = () => new Paragraph({ spacing: { after: SP.gap }, children: [] });
const PB = () => new Paragraph({ children: [new PageBreak()] });
/** 표지(문서 이름 · 부제 · 항목 표) + 목차. 모든 문서가 같은 배치를 쓴다 */
function cover(body, title, sub, rows) {
  body.push(new Paragraph({ spacing: { before: 2600, after: 200 }, alignment: AlignmentType.CENTER, children: [run("작전지 종합전력공급체계(IFPS) ⑤", { size: S.title, bold: true })] }));
  body.push(new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.CENTER, children: [run(title, { size: S.title, bold: true })] }));
  body.push(new Paragraph({ spacing: { after: 1400 }, alignment: AlignmentType.CENTER, children: [run(sub)] }));
  body.push(TBL(["항목", "내용"], rows, [22, 78], { center: [0], bold: [0] })); body.push(PB());
  body.push(new Paragraph({ spacing: { after: 160 }, children: [run("목차", { size: S.h1, bold: true })] }));
  body.push(new TableOfContents("목차", { hyperlink: true, headingStyleRange: "1-2" })); body.push(PB());
}
/** 묶음 상자: 테두리 없는 한 칸짜리 표(줄 나눔 금지)에 담아 쪽 사이에서 갈리지 않게 한다. 문단 묶음 속성 대신 쓴다(검은 네모 표시가 생기지 않는다) */
function BOX(kids) {
  const no = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], layout: TableLayoutType.FIXED, borders: { top: no, bottom: no, left: no, right: no, insideHorizontal: no, insideVertical: no },
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({ width: { size: W, type: WidthType.DXA }, borders: { top: no, bottom: no, left: no, right: no }, margins: { top: 0, bottom: 0, left: 0, right: 0 }, children: kids })] })] });
}
/** 본문 목록을 실제 문서 요소로 바꾼다: 표 설명은 표의 첫 줄로, 제목은 뒤따르는 문단과 한 상자로(제목만 쪽 끝에 남지 않게) */
function solid(body) {
  const out = [], isP = x => x instanceof Paragraph && !x.__h, isT = x => x && (x.__tbl || x.__cap !== undefined || x instanceof Table);
  const gap = () => new Paragraph({ spacing: { after: 0, line: 20, lineRule: "exact" }, children: [] });       // 표가 잇달아 오면 한 표로 합쳐지므로 사이에 아주 낮은 빈 문단을 둔다
  for (let i = 0; i < body.length; i++) { const x = body[i], y = body[i + 1];
    if (x && x.__cap !== undefined) { if (y && y.__tbl) { out.push(mkTBL(...y.__tbl, x.__cap)); i++; if (isT(body[i + 1])) out.push(gap()); } else out.push(CAPP(x.__cap, true)); }
    else if (x && x.__tbl) { out.push(mkTBL(...x.__tbl)); if (isT(y)) out.push(gap()); }
    else if (x instanceof Table) { out.push(x); if (isT(y)) out.push(gap()); }
    else if (x && x.__h && !x.__nb) { let k = i; while (body[k + 1] && body[k + 1].__h) k++;
      if (isP(body[k + 1])) { out.push(BOX(body.slice(i, k + 2))); out.push(gap()); i = k + 1; } else out.push(x); }
    else out.push(x); }
  // 표가 맞붙으면 Word 가 한 표로 합쳐, 쪽이 넘어갈 때 앞 표의 제목 · 머리줄을 다시 찍는다(사용자가 화면으로 알려 줌). 어떤 표든 두 개가 맞붙지 않게 사이에 아주 낮은 빈 문단을 둔다
  const fin = []; out.forEach(x => { if (x instanceof Table && fin[fin.length - 1] instanceof Table) fin.push(gap()); fin.push(x); });
  return fin;
}
/** 별첨: 이 문서에 나온 약어만 표기 · 원어 · 의미 표로(묶음 순서대로) */
function appendix(body) {
  const rows = ABBR.items.filter(a => USED.has(a.k)); if (rows.length < 3) return;
  body.push(Object.assign(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 0, after: 160 }, children: [new PageBreak(), run("별첨  약어 설명", { size: S.h1, bold: true })] }), { __h: true, __nb: true }));
  body.push(new Paragraph({ spacing: { after: 100, line: 280 }, children: [run("이 문서에 쓰인 영문 약어, 단위 및 기호의 원어와 의미", { size: S.note, color: "595959" })] }));
  body.push(TBL(["표기", "원어", "의미"], rows.map(a => [a.k, a.en, a.ko]), [17, 35, 48], { bold: [0] }));
}
function save(body, out, foot) {
  const main = solid(body), app = []; appendix(app);             // 본문을 먼저 굳혀야(표의 글까지) 나온 약어를 다 센다
  const hs = k => ({ run: { font: F, size: S[k], bold: true, color: "000000" }, paragraph: { spacing: SP[k] } });
  const doc = new Document({
    styles: { default: { document: { run: { font: F, size: S.body, color: "000000" } }, heading1: hs("h1"), heading2: hs("h2"), heading3: hs("h3") } },
    numbering: { config: [{ reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1)", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 420 } }, run: { font: F, size: S.body } } }] }] },
    features: { updateFields: true }, footnotes: NOTES,
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(foot + "  ", { size: S.foot, color: "595959" }), new TextRun({ children: [PageNumber.CURRENT], font: F, size: S.foot, color: "595959" })] })] }) },
      children: main.concat(solid(app)) }] });
  USED = new Set(); NOTED = new Set(); NOTES = {};                 // 한 프로세스에서 문서를 여러 개 만들 때 문서마다 새로 센다
  return Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log("saved", out); });
}
module.exports = { tune, tidy, nodot, nodash, rename, solid, mkTBL, BOX, run, P, H1, H2, H3, CODE, EQ, NUM, KV, NOTE, CAP, FIG, TBL, GAP, PB, cover, save, S, W, BLUE: "0000FF", RED: "FF0000" };
