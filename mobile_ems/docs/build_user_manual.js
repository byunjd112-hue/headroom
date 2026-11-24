// 이동형 전력체계 EMS 사용자 설명서 (입력: ../ifps_ems_rt/hmi/static/manual.json — 화면의 도움말과 같은 본문)
// 실행: node build_user_manual.js [Rev] [작성일] [출력 경로]
const fs = require("fs"), path = require("path"); const L = require("./lib.js"); const { P, H1, H2, NUM, TBL, GAP, run } = L;
const { Paragraph, ShadingType } = require("docx");
const REV = process.argv[2] || "Rev00", DATE = process.argv[3] || "", OUT = process.argv[4] || path.join(__dirname, "out", `이동형전력체계EMS_사용자설명서_${REV}.docx`);
const M = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "ifps_ems_rt", "hmi", "static", "manual.json"), "utf8")), IMG = path.join(__dirname, "ppt", "img");
const b = []; let figN = 0;
L.cover(b, M.title, "설치와 실행 · 화면별 사용법 · 운용 절차 · 기록과 보고서 · 점검과 문제 해결",
  [["문서번호", `HAES-IFPS-EMS-UM-001  ${REV} (초안)`], ["작성일", DATE], ["적용 대상", "제어화면(HMI), 기록 조회기, 현장 진단 도구"], ["읽는 사람", "운용자(장병), 정비 담당, 관리자"],
   ["비고", "화면의 '도움말'과 같은 본문이다. 그림은 가상 장치 모드의 화면이며 값은 가상값이다. 장치 정비는 제작사 교범과 부대 안전 규정이 먼저다."]]);
b.push(H1("차례")); M.sections.forEach(s => b.push(P(s.title)));
const shot = (name, cap) => { const f = ["jpg", "png"].map(e => path.join(IMG, `${name}.${e}`)).find(p => fs.existsSync(p)); if (!f) return; figN++; b.push(...L.FIG(f, 620, 349, `그림 ${figN}. ${cap || name}`)); };
for (const s of M.sections) {
  b.push(H1(s.title));
  for (const k of s.blocks) {
    if (k.type === "p") b.push(P(k.text));
    else if (k.type === "h") b.push(H2(k.text));
    else if (k.type === "steps") k.items.forEach((t, i) => b.push(k.items.length > 1 ? NUM(t) : P("· " + t)));
    else if (k.type === "table") { const n = k.head.length; b.push(TBL(k.head, k.rows.map(r => r.concat(Array(n).fill("")).slice(0, n)), k.widths || Array(n).fill(Math.floor(100 / n)), { bold: [0] })); b.push(GAP()); }
    else if (k.type === "note") b.push(new Paragraph({ keepLines: true, spacing: { before: 60, after: 120, line: 300 }, shading: { type: ShadingType.CLEAR, fill: "FFF4D6" }, indent: { left: 160, right: 160 }, children: [run("주의 · 참고  ", { bold: true }), run(k.text)] }));
    else if (k.type === "shot") shot(k.name, k.caption);
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
L.save(b, OUT, M.title);
