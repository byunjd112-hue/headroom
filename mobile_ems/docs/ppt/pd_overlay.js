// 작전지 전경 그림 위에 이름표, 전력과 통신 흐름, 범례를 얹는다. node pd_overlay.js <원본.png> <출력.png>
const { chromium } = require("playwright"); const path = require("path"), fs = require("fs");
const FD = process.env.FONTS || path.join(__dirname, "fonts"), src = process.argv[2], out = process.argv[3];
const FT = f => "data:font/woff2;base64," + fs.readFileSync(path.join(FD, f)).toString("base64");
const css = [400, 700].map(w => `@font-face{font-family:NSK;font-weight:${w};src:url(${FT(`noto-sans-kr-korean-${w}-normal.woff2`)})}@font-face{font-family:NSK;font-weight:${w};src:url(${FT(`noto-sans-kr-latin-${w}-normal.woff2`)});unicode-range:U+0000-00FF}`).join("");
const W = 1592, H = 900, img = "data:image/png;base64," + fs.readFileSync(src).toString("base64");
const LB = [[175, 212, "① 기동형 복합전력공급체계"], [512, 178, "② 이동형 ESS(GFM)"], [888, 98, "③ 이동형 PV 발전체계(롤러블)"], [1296, 200, "④ 이동형 수소 발전체계"], [1392, 358, "⑤ 전술전력통제체계(TPCS)"], [810, 340, "⑥ 고전압 배전 및 변압체계"],
  [165, 842, "지휘통제(C2)"], [462, 818, "통신시설"], [782, 842, "의무시설"], [1106, 826, "정비시설"], [1285, 822, "탄약저장시설"]];
const FS = [[446, 368, "FSU 1"], [364, 472, "FSU 2"], [596, 532, "FSU 3"], [936, 532, "FSU 4"], [1148, 480, "FSU 5"], [1132, 368, "FSU 6"]];
const P = [[280, 318, 598, 398], [545, 318, 648, 358], [890, 332, 842, 358], [1222, 332, 1028, 384],
  [596, 428, 500, 412], [596, 500, 428, 512], [700, 528, 642, 560], [880, 528, 930, 558], [1032, 486, 1094, 508], [1032, 424, 1086, 408],
  [330, 562, 232, 640], [560, 628, 502, 690], [650, 632, 742, 664], [962, 632, 1068, 668], [1192, 572, 1330, 650]];
const arrow = ([a, b, c, d]) => { const mx = (a + c) / 2, my = (b + d) / 2 - 14; return `<path d="M${a} ${b} Q${mx} ${my} ${c} ${d}" fill="none" stroke="#7CFF4D" stroke-width="5" stroke-linecap="round" marker-end="url(#ag)" filter="url(#gl)" opacity="0.92"/>`; };
const Y0 = 318, H2 = 582;
const RP = [[1004, 452], [1090, 470], [1135, 425], [1150, 545], [940, 590], [771, 603]], RQ = [[771, 603], [598, 590], [366, 530], [448, 425], [520, 372], [960, 366], [1004, 440]];
const rpath = pts => pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + (p[1] - Y0)).join(" ");
const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H2}" viewBox="0 0 ${W} ${H2}" style="position:absolute;left:0;top:0">
<defs><filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<path d="${rpath(RP)}" fill="none" stroke="#5BC8FF" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" filter="url(#gl)"/>
<path d="${rpath(RQ)}" fill="none" stroke="#FFC83D" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" filter="url(#gl)"/>
${[[330, 562, 232, 640], [560, 628, 502, 690], [650, 632, 742, 664], [962, 632, 1068, 668], [1192, 572, 1330, 650]].map(([a, b, c, d]) => `<path d="M${a} ${b - Y0} L${c} ${d - Y0}" fill="none" stroke="#7CFF4D" stroke-width="4" stroke-linecap="round" filter="url(#gl)" opacity="0.9"/>`).join("")}
<g stroke="#FF4B3A" stroke-width="5" stroke-linecap="round" filter="url(#gl)"><line x1="760" y1="${592 - Y0}" x2="782" y2="${614 - Y0}"/><line x1="782" y1="${592 - Y0}" x2="760" y2="${614 - Y0}"/></g></svg>`;
const pill2 = ([x, y, t], cls) => `<div class="lb ${cls || ""}" style="left:${x}px;top:${y - Y0}px">${t}</div>`;
const html2 = `<style>${css} body{margin:0;width:${W}px;height:${H2}px;position:relative;font-family:NSK;overflow:hidden}
img{position:absolute;left:0;top:${-Y0}px;width:${W}px;height:${H}px}
.lb{position:absolute;transform:translate(-50%,-50%);background:#101820d9;color:#fff;font-size:16px;font-weight:700;padding:5px 12px 6px;border-radius:7px;border:1px solid #ffffff55;white-space:nowrap;letter-spacing:-0.3px}
.lb.f{font-size:13.5px;padding:3px 9px 4px;background:#1f3a5fe0;border-color:#9fc0ea}.lb.n{font-size:14px;background:#7a1810e6;border-color:#ffb3a8}
.lb.a{background:#0b5a86e6;border-color:#9fe0ff;font-size:14px}.lb.b{background:#8a6400e6;border-color:#ffe29a;font-size:14px}
.lg{position:absolute;right:20px;bottom:16px;background:#101820e0;color:#fff;font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid #ffffff55;line-height:24px}
.lg i{display:inline-block;width:40px;height:0;vertical-align:middle;margin-right:10px;border-top:5px solid #5BC8FF}.lg i.b{border-top-color:#FFC83D}.lg i.g{border-top-color:#7CFF4D}.lg b{display:inline-block;width:40px;text-align:center;color:#FF4B3A;margin-right:10px;font-size:17px}</style>
<img src="${img}">${svg2}
${FS.map(l => pill2(l, "f")).join("")}${pill2([771, 566, "상시 개방점"], "n")}${pill2([1080, 392, "급전 A"], "a")}${pill2([720, 348, "급전 B"], "b")}${pill2([810, 500, "⑥ 배전 및 변압(저압 접속반은 오른쪽 끝면)"])}
${[[165, 842, "지휘통제(C2)"], [462, 818, "통신시설"], [782, 842, "의무시설"], [1106, 826, "정비시설"], [1262, 800, "탄약저장시설"]].map(l => pill2(l)).join("")}
<div class="lg"><div><i></i>환망 급전 A 쪽 간선</div><div><i class="b"></i>환망 급전 B 쪽 간선</div><div><i class="g"></i>구간분전함에서 부하로</div><div><b>✕</b>상시 개방점(평소 열림)</div></div>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">
<defs><marker id="ag" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#7CFF4D"/></marker>
<marker id="ab" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#6FB6FF"/></marker>
<filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
${P.map(arrow).join("")}
<path d="M1214 452 Q1125 425 1040 452" fill="none" stroke="#6FB6FF" stroke-width="4" stroke-dasharray="3 9" stroke-linecap="round" marker-end="url(#ab)" filter="url(#gl)"/>
<path d="M1236 470 Q1200 520 1190 500" fill="none" stroke="#6FB6FF" stroke-width="0"/>
<g stroke="#FF4B3A" stroke-width="5" stroke-linecap="round" filter="url(#gl)"><line x1="760" y1="592" x2="782" y2="614"/><line x1="782" y1="592" x2="760" y2="614"/></g></svg>`;
const pill = ([x, y, t], cls) => `<div class="lb ${cls || ""}" style="left:${x}px;top:${y}px">${t}</div>`;
const html = `<style>${css} body{margin:0;width:${W}px;height:${H}px;position:relative;font-family:NSK;overflow:hidden}
img{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
.sh{position:absolute;left:0;top:0;width:${W}px;height:86px;background:linear-gradient(#000a,#0000)}
.lb{position:absolute;transform:translate(-50%,-50%);background:#101820d9;color:#fff;font-size:17px;font-weight:700;padding:5px 13px 6px;border-radius:7px;border:1px solid #ffffff55;white-space:nowrap;letter-spacing:-0.3px}
.lb.f{font-size:13.5px;padding:3px 9px 4px;background:#1f3a5fe0;border-color:#9fc0ea}
.lb.n{font-size:14px;background:#7a1810e6;border-color:#ffb3a8}
.tt{position:absolute;left:26px;top:18px;color:#fff;font-size:27px;font-weight:700;letter-spacing:-0.5px;text-shadow:0 2px 6px #000}
.lg{position:absolute;right:22px;bottom:20px;background:#101820e0;color:#fff;font-size:14.5px;padding:11px 16px;border-radius:8px;border:1px solid #ffffff55;line-height:25px}
.lg i{display:inline-block;width:42px;height:0;vertical-align:middle;margin-right:10px;border-top:4px solid #7CFF4D}.lg i.b{border-top:4px dotted #6FB6FF}.lg b{display:inline-block;width:42px;text-align:center;color:#FF4B3A;margin-right:10px;font-size:17px}</style>
<img src="${img}"><div class="sh"></div>${svg}<div class="tt">작전지 종합전력공급체계(IFPS) 전개 전경</div>
${LB.map(l => pill(l)).join("")}${FS.map(l => pill(l, "f")).join("")}${pill([771, 580, "상시 개방점"], "n")}
<div class="lg"><div><i></i>전력(AC 380 V)</div><div><i class="b"></i>통신(감시 및 지령)</div><div><b>✕</b>환망 상시 개방점</div></div>`;
(async () => { const ring = process.argv[4] === "ring", b = await chromium.launch(), p = await b.newPage({ viewport: { width: W, height: ring ? H2 : H }, deviceScaleFactor: 1.5 }); await p.setContent(ring ? html2 : html); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: out }); await b.close(); })();
