// 배전체계 자료의 ⑥ 평면 배치 검토안과 단선 결선도를 그린다(SVG 를 브라우저로 찍음). node pd_figs.js <출력 폴더>
const { chromium } = require("playwright"); const path = require("path"), fs = require("fs");
const FD = path.join(__dirname, "fonts"), out = process.argv[2];
const FT = f => "data:font/woff2;base64," + fs.readFileSync(path.join(FD, f)).toString("base64");
const css = [400, 700].map(w => `@font-face{font-family:NSK;font-weight:${w};src:url(${FT(`noto-sans-kr-korean-${w}-normal.woff2`)})}@font-face{font-family:NSK;font-weight:${w};src:url(${FT(`noto-sans-kr-latin-${w}-normal.woff2`)});unicode-range:U+0000-00FF}`).join("");
const K = 0.1453, X0 = 72, Y0 = 160, mm = v => v * K;
const T = (x, y, t, o = {}) => `<text x="${x}" y="${y}" font-size="${o.s || 15}" font-weight="${o.b ? 700 : 400}" fill="${o.c || "#1b2733"}" text-anchor="${o.a || "middle"}">${t}</text>`;
const R = (x, y, w, h, f, st = "#1b2733", sw = 1.5, ex = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${st}" stroke-width="${sw}" ${ex}/>`;
const LN = (a, b, c, d, st = "#1b2733", sw = 1.5, ex = "") => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${st}" stroke-width="${sw}" ${ex}/>`;
const dimH = (x1, x2, y, t) => LN(x1, y, x2, y, "#55626f", 1) + LN(x1, y - 6, x1, y + 6, "#55626f", 1) + LN(x2, y - 6, x2, y + 6, "#55626f", 1) + T((x1 + x2) / 2, y - 7, t, { s: 13, c: "#55626f" });
const dimV = (x, y1, y2, t) => LN(x, y1, x, y2, "#55626f", 1) + LN(x - 6, y1, x + 6, y1, "#55626f", 1) + LN(x - 6, y2, x + 6, y2, "#55626f", 1) + `<text x="${x + 9}" y="${(y1 + y2) / 2 + 5}" font-size="13" fill="#55626f">${t}</text>`;
function plan() {
  const W = mm(6058), H = mm(2438), wl = mm(80), ix = X0 + wl, iy = Y0 + wl, iw = W - 2 * wl, ih = H - 2 * wl; let g = "";
  g += T(512, 44, "⑥ 고전압 배전 및 변압체계: 20ft 컨테이너 1대 평면 배치(검토안)", { s: 22, b: 1 });
  g += T(512, 72, "치수는 일반 기자재 크기로 잡은 추정값, 제작사 자료로 확정 필요", { s: 14, c: "#8a4b12" });
  g += R(X0, Y0, W, H, "#e9edf1", "#1b2733", 3) + R(ix, iy, iw, ih, "#ffffff", "#1b2733", 1);
  const a = mm(1400), b = mm(2000), c = iw - a - b;                // 구획 길이
  g += LN(ix + a, iy, ix + a, iy + ih * 0.62, "#1b2733", 2) + LN(ix + a + b, iy, ix + a + b, iy + ih * 0.62, "#1b2733", 2);
  // 고압 개폐 장치
  g += R(ix + mm(150), iy + mm(40), mm(1100), mm(800), "#f6d9d5", "#a3261a", 2) + T(ix + mm(700), iy + mm(400), "고압 개폐 장치", { s: 14, b: 1 }) + T(ix + mm(700), iy + mm(560), "24 kV급", { s: 13 });
  // 변압기와 보호망
  g += R(ix + a + mm(100), iy + mm(40), mm(1800), mm(1200), "none", "#55626f", 1.2, 'stroke-dasharray="6 4"');
  g += R(ix + a + mm(250), iy + mm(150), mm(1500), mm(900), "#f3c9a8", "#8a4b12", 2) + T(ix + a + mm(1000), iy + mm(540), "몰드형 변압기", { s: 15, b: 1 }) + T(ix + a + mm(1000), iy + mm(720), "500 kVA", { s: 14 }) + T(ix + a + mm(1000), iy + mm(880), "22.9 kV / 380 V", { s: 13 });
  // 저압 분전반
  g += R(ix + a + b + mm(50), iy + mm(40), mm(2400), mm(800), "#d6e6f6", "#1d4f91", 2) + T(ix + a + b + mm(1250), iy + mm(360), "저압 분전반", { s: 15, b: 1 }) + T(ix + a + b + mm(1250), iy + mm(540), "주 차단기, 모선 A와 B, 연계 차단기", { s: 13 }) + T(ix + a + b + mm(1250), iy + mm(700), "분기 12회로", { s: 13 });
  g += T(ix + iw / 2, iy + ih - mm(420), "조작 및 점검 통로(폭 1.1 m 이상 확보, 추정)", { s: 14, c: "#55626f" });
  // 문과 접속부
  g += R(X0 - 5, Y0 + mm(500), 10, mm(1400), "#a3261a", "#a3261a", 1) + `<text x="${X0 - 14}" y="${Y0 + mm(1200)}" font-size="14" font-weight="700" fill="#a3261a" text-anchor="middle" transform="rotate(-90 ${X0 - 14} ${Y0 + mm(1200)})">고압 케이블 인입부</text>`;
  g += R(X0 + W - 5, Y0 + mm(500), 10, mm(1400), "#1d4f91", "#1d4f91", 1) + `<text x="${X0 + W + 22}" y="${Y0 + mm(1200)}" font-size="14" font-weight="700" fill="#1d4f91" text-anchor="middle" transform="rotate(90 ${X0 + W + 22} ${Y0 + mm(1200)})">저압 커넥터 인출부</text>`;
  g += R(ix + a + mm(550), Y0 + H - 5, mm(900), 10, "#2f7d4f", "#2f7d4f", 1) + T(ix + a + mm(1000), Y0 + H + 24, "출입문", { s: 14, b: 1, c: "#2f7d4f" });
  g += T(ix + a + mm(1000), Y0 - 10, "변압기 구획 상부: 강제 환기 팬과 루버", { s: 13, c: "#55626f" });
  // 치수
  g += dimH(ix, ix + a, Y0 - 44, "고압 구획 약 1.4 m") + dimH(ix + a, ix + a + b, Y0 - 44, "변압기 구획 약 2.0 m") + dimH(ix + a + b, ix + iw, Y0 - 44, "저압 구획 약 2.5 m");
  g += dimH(X0, X0 + W, Y0 + H + 50, "외부 길이 6.06 m(20ft ISO 규격)") + dimV(X0 + W + 44, Y0, Y0 + H, "");
  g += T(X0 + W / 2, Y0 + H + 70, "외부 폭 2.44 m, 내부 약 5.9 m × 2.35 m(일반 컨테이너 기준 추정)", { s: 13, c: "#55626f" });
  // 아래 요약
  const yb = 632; g += R(72, yb - 24, 880, 62, "#fff7e6", "#c98a1a", 1.2);
  g += T(512, yb, "판정: 컨테이너 1대에 세 구획 수용 가능(길이 여유 거의 없음). 장비는 한쪽 벽에 일렬 배치", { s: 15, b: 1 });
  g += T(512, yb + 24, "추정 중량 약 7 t(한계 15 t 이내), 변압기 손실 약 7.5 kW 는 강제 환기로 배출", { s: 14 });
  return g;
}
function sld() {
  let g = "", cx = 512; const br = (x, y) => R(x - 9, y - 9, 18, 18, "#fff", "#1b2733", 2) + LN(x - 6, y - 6, x + 6, y + 6) + LN(x - 6, y + 6, x + 6, y - 6);
  g += T(512, 44, "⑥ 고전압 배전 및 변압체계: 단선 결선도(검토안)", { s: 22, b: 1 });
  g += T(512, 72, "점선 안이 컨테이너 1대. 붉은 글씨는 받은 자료에 없어 설계 확정이 필요한 항목", { s: 14, c: "#8a4b12" });
  g += R(120, 122, 784, 432, "none", "#55626f", 1.5, 'stroke-dasharray="8 5"') + T(130, 142, "20ft ISO 컨테이너 1대", { s: 13, a: "start", c: "#55626f" });
  // 고압
  g += T(cx, 112, "22.9 kV 인입(주둔지 상전)", { s: 14, b: 1, c: "#a3261a" }) + LN(cx, 118, cx, 150, "#a3261a", 3);
  g += br(cx, 150) + T(cx + 22, 147, "고압 개폐 장치(24 kV급)", { s: 14, a: "start", b: 1 }) + T(cx + 22, 166, "형식, 인입 회선 수, 고압 환상 여부: 설계 확정 필요", { s: 13, a: "start", c: "#a3261a" });
  g += T(cx - 22, 155, "정격 전류 약 12.6 A", { s: 13, a: "end", c: "#55626f" });
  g += LN(cx, 159, cx, 196, "#a3261a", 3);
  g += `<circle cx="${cx}" cy="214" r="20" fill="#fff" stroke="#8a4b12" stroke-width="2.5"/><circle cx="${cx}" cy="240" r="20" fill="none" stroke="#8a4b12" stroke-width="2.5"/>`;
  g += T(cx + 34, 222, "몰드형 변압기 500 kVA", { s: 14, a: "start", b: 1 }) + T(cx + 34, 241, "22.9 kV / 380 V, 온도 감시", { s: 13, a: "start" }) + T(cx - 34, 232, "결선 방식: 설계 확정 필요", { s: 13, a: "end", c: "#a3261a" });
  g += LN(cx, 260, cx, 300, "#1d4f91", 3) + br(cx, 300) + T(cx + 22, 297, "저압 주 차단기", { s: 14, a: "start", b: 1 }) + T(cx + 22, 316, "2차 정격 전류 약 760 A, 800 A급 이상", { s: 13, a: "start" });
  g += T(cx - 22, 305, "TPCS 신호 CB.GRID", { s: 13, a: "end", c: "#55626f" });
  // 모선
  const yb = 370, ax1 = 160, ax2 = 462, bx1 = 562, bx2 = 864;
  g += LN(cx, 309, cx, 340, "#1d4f91", 3) + LN(380, 340, cx, 340, "#1d4f91", 3) + LN(380, 340, 380, yb, "#1d4f91", 3);
  g += LN(ax1, yb, ax2, yb, "#1d4f91", 6) + LN(bx1, yb, bx2, yb, "#1d4f91", 6) + T(ax1, yb - 12, "모선 A(380 V)", { s: 14, a: "start", b: 1, c: "#1d4f91" }) + T(bx2, yb - 12, "모선 B(380 V)", { s: 14, a: "end", b: 1, c: "#1d4f91" });
  g += LN(ax2, yb, bx1, yb, "#1d4f91", 2) + br(cx, yb) + T(cx, yb - 18, "연계 차단기", { s: 13 });
  const fd = (x, t1, t2, col, up) => LN(x, yb, x, yb + 13, col, 2.5) + br(x, yb + 22) + LN(x, yb + 31, x, 486, col, 2.5) + (up ? `<path d="M${x - 7} 418 L${x + 7} 418 L${x} 404 Z" fill="${col}"/>` : `<path d="M${x - 7} 486 L${x + 7} 486 L${x} 500 Z" fill="${col}"/>`) + T(x, 520, t1, { s: 13, b: 1 }) + (t2 ? T(x, 538, t2, { s: 12, c: "#55626f" }) : "");
  g += fd(200, "전원 접속", "모선 A 쪽", "#2f7d4f", 1) + fd(300, "환망 급전 A", "630 A", "#1d4f91") + fd(420, "등급 급전선", "", "#1d4f91");
  g += fd(604, "등급 급전선", "", "#1d4f91") + fd(724, "환망 급전 B", "630 A", "#1d4f91") + fd(824, "전원 접속", "모선 B 쪽", "#2f7d4f", 1);
  g += T(512, 578, "분기 합계 12회로. 회로별 배정표는 설계 확정 필요", { s: 14, b: 1, c: "#a3261a" });
  g += R(72, 600, 880, 62, "#fff7e6", "#c98a1a", 1.2);
  g += T(512, 624, "전원 차량(복합전력, ESS, 태양광, 수소)은 380 V 모선에 직접 접속하고 변압기는 22.9 kV 연계 구간만 담당", { s: 14, b: 1 });
  g += T(512, 648, "작전지에서는 고압 측 미사용, 주둔지에서는 상전 22.9 kV 수전. 저압 모선 정격은 전원 합계 전류로 선정", { s: 14 });
  return g;
}
function garrison() {
  let g = ""; const box = (x, y, w, h, f, st, t1, t2, t3) => R(x, y, w, h, f, st, 2, 'rx="8"') + T(x + w / 2, y + (t2 ? 30 : h / 2 + 5), t1, { s: 15, b: 1 }) + (t2 ? T(x + w / 2, y + 52, t2, { s: 13 }) : "") + (t3 ? T(x + w / 2, y + 71, t3, { s: 13, c: "#55626f" }) : "");
  const ar = (x1, y1, x2, y2, col, sw = 3) => LN(x1, y1, x2, y2, col, sw) + (y1 === y2 ? `<path d="M${x2} ${y2} l-12 -7 v14 Z" fill="${col}"/>` : `<path d="M${x2} ${y2} l-7 ${y2 > y1 ? -12 : 12} h14 Z" fill="${col}"/>`);
  g += T(512, 44, "주둔지에서의 한전(상전) 연결(검토안)", { s: 22, b: 1 });
  g += T(512, 72, "붉은 선은 22.9 kV, 푸른 선은 380 V. 붉은 글씨는 받은 자료에 없어 설계 확정이 필요한 항목", { s: 14, c: "#8a4b12" });
  // 윗줄: 한전 → 주둔지 수전 설비 → 기존 변압기 → 기존 부하
  g += box(40, 120, 170, 84, "#f6d9d5", "#a3261a", "한전 배전선로", "22.9 kV");
  g += ar(210, 162, 262, 162, "#a3261a") + box(262, 120, 200, 84, "#eef1f4", "#1b2733", "주둔지 수전 설비", "책임분계점, 기존 시설", "변경 최소화");
  g += ar(462, 162, 560, 162, "#a3261a") + box(560, 120, 180, 84, "#eef1f4", "#1b2733", "기존 변압기와 배전반", "주둔지 기존 계통");
  g += ar(740, 162, 800, 162, "#1d4f91") + box(800, 120, 184, 84, "#eef1f4", "#1b2733", "주둔지 기존 부하", "기존 배선 그대로");
  // 분기
  g += `<circle cx="511" cy="162" r="7" fill="#a3261a"/>` + LN(511, 162, 511, 262, "#a3261a", 3) + T(523, 232, "고압 분기점과 분기 개폐기: 설계 확정 필요", { s: 13, a: "start", c: "#a3261a", b: 1 });
  g += T(523, 251, "기존 고압반의 예비 회로 사용 또는 분기 개폐기 신설 가운데 선택", { s: 13, a: "start", c: "#a3261a" });
  g += ar(511, 262, 511, 300, "#a3261a") + T(499, 286, "22.9 kV 고압 케이블", { s: 13, a: "end", c: "#55626f" });
  // ⑥ 컨테이너
  g += R(150, 300, 724, 150, "#f4f8ec", "#4b5d23", 2.5, 'rx="8" stroke-dasharray="9 5"') + T(164, 322, "⑥ 고전압 배전 및 변압체계(20ft 컨테이너 1대)", { s: 14, a: "start", b: 1, c: "#4b5d23" });
  g += box(180, 340, 190, 84, "#f6d9d5", "#a3261a", "고압 인입부와 개폐 장치", "24 kV급") + ar(370, 382, 416, 382, "#a3261a");
  g += box(416, 340, 190, 84, "#f3c9a8", "#8a4b12", "몰드형 변압기", "500 kVA, 22.9 kV / 380 V") + ar(606, 382, 652, 382, "#1d4f91");
  g += box(652, 340, 196, 84, "#d6e6f6", "#1d4f91", "저압 주 차단기와 모선", "TPCS 감시 신호 CB.GRID");
  // 아래: 전원 차량, 환망
  g += ar(750, 450, 750, 500, "#1d4f91") + box(600, 500, 300, 64, "#d6e6f6", "#1d4f91", "환망 간선, 구간분전함, 배전체계", "TPCS 관리 부하");
  g += box(124, 500, 380, 64, "#e3f1e6", "#2f7d4f", "전원 차량(복합전력, ESS, 태양광, 수소)", "380 V 모선에 직접 접속") + LN(504, 532, 560, 532, "#2f7d4f", 3) + LN(560, 532, 560, 476, "#2f7d4f", 3) + LN(560, 476, 700, 476, "#2f7d4f", 3) + ar(700, 476, 700, 426, "#2f7d4f");
  g += `<rect x="652" y="462" width="196" height="16" fill="none"/>`;
  g += R(72, 592, 880, 76, "#fff7e6", "#c98a1a", 1.2);
  g += T(512, 615, "한전 전기는 ⑥ 컨테이너 끝면의 고압 인입부로 받음. 주둔지 기존 계통과 기존 부하의 배선은 변경하지 않음", { s: 14, b: 1 });
  g += T(512, 637, "수전 한도는 변압기 용량 500 kVA. 상전 상실 시 주 차단기 개방 상태에서 전원 차량으로 자립 운전", { s: 14 });
  g += T(512, 658, "TPCS 는 수전 차단기 상태를 감시만 하고 조작하지 않음", { s: 14 });
  return g;
}
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1024, height: 688 }, deviceScaleFactor: 2 });
  for (const [n, f] of [["pd2_layout", plan], ["pd2_sld", sld], ["pd2_grid", garrison]]) { await p.setContent(`<style>${css} body{margin:0;background:#fff} text{font-family:NSK}</style><svg xmlns="http://www.w3.org/2000/svg" width="1024" height="688" viewBox="0 0 1024 688">${f()}</svg>`); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: path.join(out, n + ".png") }); }
  await b.close(); })();
