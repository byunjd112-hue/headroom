// 공통 Word 서식: 글자 검정, 표는 회색 계열, 본문 11pt, 제목 14 · 12 · 11pt, 표 · 설명 10pt, 주석 · 바닥글 9pt.
// 제목은 다음 문단과 한 쪽에, 표의 줄은 쪽 사이에서 나누지 않는다(아래 KEEP — 예전에는 쓰지 않았다. 되돌리려면 false).
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, LevelFormat, PageBreak, Footer, PageNumber, HeadingLevel, TableOfContents, ImageRun, VerticalAlign, TableLayoutType } = require("docx");
const fs = require("fs");
const F = "맑은 고딕", W = 9638;
// ── 공통 양식(모든 Word 문서가 같이 쓴다. 현장 보고서 작성기 ifps_ems_rt/hmi/docx.py 도 같은 값 — 고치면 함께 고친다)
// 쪽: A4, 위·아래 25 mm(1418), 좌·우 20 mm(1134) → 본문 폭 W. 글자 크기는 반 포인트(22 = 11 pt)
const S = { body: 22, h1: 28, h2: 24, h3: 22, table: 20, cap: 20, note: 18, code: 20, foot: 18, title: 28 };
const SP = { body: { after: 100, line: 300 }, h1: { before: 280, after: 140 }, h2: { before: 200, after: 100 }, h3: { before: 160, after: 80 }, cap: { before: 60, after: 160 }, fig: { before: 120, after: 40 }, gap: 60 };
const KEEP = true;        // 제목 · 그림 · 표 설명을 다음 문단과 한 쪽에 두고 표의 줄을 쪽 사이에서 나누지 않는다(인쇄 미리보기 기준 쪽 구성). 끄려면 false
let NI = 0;
// ── 조판 다듬기(문서가 tune 으로 켠다 — 안 켜면 예전 그대로): 장평 · 자간, 본문 양쪽 정렬, 표 칸 여백, 줄바꿈 규칙
const TN = { scale: 0, cs: 0, just: false, center: false, cell: { top: 50, bottom: 50, left: 90, right: 90 }, tline: 264, fx: null };
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
/** 가운뎃점으로 낱말을 잇지 않는다(사용자 지시): 둘이면 '및', 셋 이상이면 쉼표로 나열하고 마지막만 '및'으로 잇는다. 괄호 안은 따로 센다 */
function nodot(t) {
  if (t.indexOf("·") < 0) return t;
  const hold = [], seg = x => { const n = (x.match(/ · /g) || []).length; if (!n) return x; let k = 0; const has = /(^|\s)및(\s|$)/.test(x);
    return x.replace(/ · /g, () => (++k === n && !has ? " 및 " : ", ")); };
  const flat = x => x.split(/([,.:;=→\/①-⑳])/).map(seg).join("");
  let prev; do { prev = t; t = t.replace(/\(([^()]*)\)/g, (m, a) => { hold.push("(" + flat(a) + ")"); return "\u0001" + (hold.length - 1) + "\u0002"; }); } while (t !== prev);
  t = flat(t); do { prev = t; t = t.replace(/\u0001(\d+)\u0002/g, (m, i) => hold[+i]); } while (t !== prev);
  return t.replace(/·/g, ",");
}
const run = (t, o = {}) => { const mono = o.font === "Consolas" || o.font === "Cambria Math";
  return new TextRun(Object.assign({ text: TN.fx && !mono && typeof t === "string" ? TN.fx(t) : t, font: F, size: S.body, color: "000000" }, TN.scale && !mono ? { scale: TN.scale, characterSpacing: TN.cs } : {}, o)); };
const P = (t, o = {}) => new Paragraph(Object.assign({ spacing: SP.body, children: Array.isArray(t) ? t : [run(t)] }, TN.just ? { alignment: AlignmentType.BOTH } : {}, o));
const head = (lv, k) => t => (NI++, new Paragraph({ heading: lv, keepNext: KEEP, keepLines: KEEP, spacing: SP[k], children: [run(t, { size: S[k], bold: true })] }));
const H1 = head(HeadingLevel.HEADING_1, "h1"), H2 = head(HeadingLevel.HEADING_2, "h2"), H3 = head(HeadingLevel.HEADING_3, "h3");
const CODE = t => new Paragraph({ spacing: { after: 40 }, shading: { type: ShadingType.CLEAR, fill: "F2F2F2" }, indent: { left: 200 }, children: [run(t, { font: "Consolas", size: S.code })] });
const EQ = t => new Paragraph({ spacing: { before: 40, after: 100 }, indent: { left: 400 }, children: [run(t, { font: "Cambria Math", size: S.body })] });
const NUM = t => new Paragraph({ numbering: { reference: "num", level: 0, instance: NI }, spacing: { after: 60, line: 300 }, children: [run(t)] });
const KV = (k, v) => P([run(k + "  ", { bold: true }), run(v)]);
/** 주석(9 pt, 회색) */
const NOTE = t => new Paragraph({ spacing: { after: 100, line: 280 }, children: [run(t, { size: S.note, color: "595959" })] });
/** 그림 · 표의 설명(10 pt, 가운데). above 면 표 위 설명(다음 문단인 표와 한 쪽에) */
const CAP = (t, above) => new Paragraph({ alignment: AlignmentType.CENTER, keepNext: KEEP && !!above, spacing: above ? { before: 140, after: 60 } : SP.cap, children: [run(t, { size: S.cap })] });
/** 그림(가운데) + 설명. 그림과 설명은 한 쪽에 둔다. 문단 두 개를 돌려준다 */
function FIG(file, w, h, cap) {
  const img = new ImageRun({ type: file.toLowerCase().endsWith("png") ? "png" : "jpg", data: fs.readFileSync(file), transformation: { width: w, height: h }, altText: { title: cap, description: cap, name: require("path").basename(file) } });
  return [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: KEEP, spacing: SP.fig, children: [img] }), CAP(cap)];
}
const bd = { style: BorderStyle.SINGLE, size: 4, color: "808080" }, B = { top: bd, bottom: bd, left: bd, right: bd };
/** 표: 폭 = 본문 폭, 글자 10 pt, 머리줄은 회색 · 굵게 · 가운데 · 쪽이 넘어가면 되풀이, 줄은 쪽 사이에서 나누지 않는다. widths 는 비율 */
function TBL(head, rows, widths, o = {}) {
  const sum = widths.reduce((a, b) => a + b, 0), cw = widths.map(w => Math.round(w / sum * W));
  cw[cw.length - 1] += W - cw.reduce((a, b) => a + b, 0);
  // 칸 가운데 맞춤이 기본(tune 의 center): 열 단위로 정한다. 긴 문장(한 줄 반을 넘는 글)이 있는 열만 통째로 왼쪽 맞춤 — 한 열 안에서 맞춤이 섞이지 않게
  const lines = (t, i) => { const x = String(typeof t === "object" && t !== null ? t.t : t); let w = 0; for (const ch of x) w += ch.charCodeAt(0) > 0x2E7F ? 1 : 0.56;
    return w * (S.table * 10) * (TN.scale ? TN.scale / 100 : 1) / (cw[i] - TN.cell.left - TN.cell.right - 60); };
  const mid = cw.map((_, i) => rows.every(r => r[i] === undefined || lines(r[i], i) <= 1.5)), one = (t, i) => mid[i];
  const cell = (t, i, hd, kx) => new TableCell({ borders: B, width: { size: cw[i], type: WidthType.DXA }, margins: TN.cell, verticalAlign: VerticalAlign.CENTER,
    shading: hd ? { type: ShadingType.CLEAR, fill: "D9D9D9" } : undefined,
    children: [new Paragraph({ keepNext: !!kx, alignment: hd || (o.center || []).includes(i) || (TN.center && one(t, i)) ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { line: TN.tline },
      children: [typeof t === "object" && t !== null ? run(String(t.t), { size: S.table, bold: true, color: t.c }) : run(String(t), { size: S.table, bold: hd || (o.bold || []).includes(i), font: (o.mono || []).includes(i) && !hd ? "Consolas" : F })] })] });
  // o.keep = { whole, head, tail }: 줄 수가 whole 이하면 표를 한 쪽에 묶고, 길면 첫 head 줄 · 끝 tail 줄만 묶는다(쪽 끝에 한두 줄만 남거나 넘어가지 않게). 안 주면 예전대로
  const k = o.keep, N = rows.length, kn = n => !!k && n < N - 1 && (N <= k.whole || n < k.head - 1 || n >= N - k.tail);
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw, layout: TableLayoutType.FIXED,
    rows: [new TableRow({ tableHeader: true, cantSplit: KEEP, children: head.map((h, i) => cell(h, i, true, !!k)) })].concat(rows.map((r, n) => new TableRow({ cantSplit: KEEP, children: r.map((c, i) => cell(c, i, false, kn(n))) }))) });
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
function save(body, out, foot) {
  const hs = k => ({ run: { font: F, size: S[k], bold: true, color: "000000" }, paragraph: { spacing: SP[k], keepNext: KEEP, keepLines: KEEP } });
  const doc = new Document({
    styles: { default: { document: { run: { font: F, size: S.body, color: "000000" } }, heading1: hs("h1"), heading2: hs("h2"), heading3: hs("h3") } },
    numbering: { config: [{ reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1)", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 420 } }, run: { font: F, size: S.body } } }] }] },
    features: { updateFields: true },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(foot + "  ", { size: S.foot, color: "595959" }), new TextRun({ children: [PageNumber.CURRENT], font: F, size: S.foot, color: "595959" })] })] }) },
      children: body }] });
  return Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log("saved", out); });
}
module.exports = { tune, tidy, nodot, run, P, H1, H2, H3, CODE, EQ, NUM, KV, NOTE, CAP, FIG, TBL, GAP, PB, cover, save, S, W, BLUE: "0000FF", RED: "FF0000" };
