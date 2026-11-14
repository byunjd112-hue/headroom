// 공통 Word 서식: 글자 검정, 표는 회색 계열, 본문 11pt, 제목 12~14pt, 다음 문단과 함께·문단 나누지 않음 미사용.
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle, LevelFormat, PageBreak, Footer, PageNumber, HeadingLevel, TableOfContents } = require("docx");
const fs = require("fs");
const F = "맑은 고딕", W = 9638;
let NI = 0;
const run = (t, o = {}) => new TextRun(Object.assign({ text: t, font: F, size: 22, color: "000000" }, o));
const P = (t, o = {}) => new Paragraph(Object.assign({ spacing: { after: 100, line: 300 }, children: Array.isArray(t) ? t : [run(t)] }, o));
const H1 = t => (NI++, new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 140 }, children: [run(t, { size: 28, bold: true })] }));
const H2 = t => (NI++, new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, children: [run(t, { size: 24, bold: true })] }));
const CODE = t => new Paragraph({ spacing: { after: 40 }, shading: { type: ShadingType.CLEAR, fill: "F2F2F2" }, indent: { left: 200 }, children: [run(t, { font: "Consolas", size: 22 })] });
const EQ = t => new Paragraph({ spacing: { before: 40, after: 100 }, indent: { left: 400 }, children: [run(t, { font: "Cambria Math", size: 22 })] });
const NUM = t => new Paragraph({ numbering: { reference: "num", level: 0, instance: NI }, spacing: { after: 60, line: 300 }, children: [run(t)] });
const KV = (k, v) => P([run(k + "  ", { bold: true }), run(v)]);
const bd = { style: BorderStyle.SINGLE, size: 4, color: "808080" }, B = { top: bd, bottom: bd, left: bd, right: bd };
function TBL(head, rows, widths, o = {}) {
  const sum = widths.reduce((a, b) => a + b, 0), cw = widths.map(w => Math.round(w / sum * W));
  cw[cw.length - 1] += W - cw.reduce((a, b) => a + b, 0);
  const cell = (t, i, hd) => new TableCell({ borders: B, width: { size: cw[i], type: WidthType.DXA }, margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: hd ? { type: ShadingType.CLEAR, fill: "D9D9D9" } : undefined,
    children: [new Paragraph({ alignment: hd || (o.center || []).includes(i) ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [typeof t === "object" && t !== null ? run(String(t.t), { bold: true, color: t.c }) : run(String(t), { bold: hd || (o.bold || []).includes(i), font: (o.mono || []).includes(i) && !hd ? "Consolas" : F })] })] });
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cw,
    rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true)) })].concat(rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))) });
}
const GAP = () => new Paragraph({ spacing: { after: 60 }, children: [] });
const PB = () => new Paragraph({ children: [new PageBreak()] });
function cover(body, title, sub, rows) {
  body.push(new Paragraph({ spacing: { before: 2600, after: 200 }, alignment: AlignmentType.CENTER, children: [run("작전지 종합전력공급체계(IFPS) ⑤", { size: 28, bold: true })] }));
  body.push(new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.CENTER, children: [run(title, { size: 28, bold: true })] }));
  body.push(new Paragraph({ spacing: { after: 1400 }, alignment: AlignmentType.CENTER, children: [run(sub)] }));
  body.push(TBL(["항목", "내용"], rows, [22, 78], { center: [0], bold: [0] })); body.push(PB());
  body.push(new Paragraph({ spacing: { after: 160 }, children: [run("목차", { size: 28, bold: true })] }));
  body.push(new TableOfContents("목차", { hyperlink: true, headingStyleRange: "1-2" })); body.push(PB());
}
function save(body, out, foot) {
  const doc = new Document({
    styles: { default: { document: { run: { font: F, size: 22, color: "000000" } },
      heading1: { run: { font: F, size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 280, after: 140 } } },
      heading2: { run: { font: F, size: 24, bold: true, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 } } } } },
    numbering: { config: [{ reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1)", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 420 } }, run: { font: F, size: 22 } } }] }] },
    features: { updateFields: true },
    sections: [{ properties: { page: { margin: { top: 1418, bottom: 1418, left: 1134, right: 1134 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(foot + "  ", { size: 22, color: "595959" }), new TextRun({ children: [PageNumber.CURRENT], font: F, size: 22, color: "595959" })] })] }) },
      children: body }] });
  return Packer.toBuffer(doc).then(b => { fs.writeFileSync(out, b); console.log("saved", out); });
}
module.exports = { run, P, H1, H2, CODE, EQ, NUM, KV, TBL, GAP, PB, cover, save, BLUE: "0000FF", RED: "FF0000" };
