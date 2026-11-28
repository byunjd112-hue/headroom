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
  g += R(X0 + W - 5, Y0 + mm(500), 10, mm(1400), "#1d4f91", "#1d4f91", 1) + `<text x="${X0 + W + 22}" y="${Y0 + mm(1200)}" font-size="14" font-weight="700" fill="#1d4f91" text-anchor="middle" transform="rotate(90 ${X0 + W + 22} ${Y0 + mm(1200)})">저압 접속반(12회로)</text>`;
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
/** 단선 결선도(도면 양식: 도면 틀, IEC 식 기호, 범례, 정격표, 표제란). 1640 × 626 */
function sldPro() {
  const HV = "#b3261e", LV = "#1f3a5f", SRC = "#2f6b3f", INK = "#1b2733", GR = "#5b6773", RED = "#b3261e"; let g = "";
  const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.s || 11}" font-weight="${o.b ? 700 : 400}" fill="${o.c || INK}" text-anchor="${o.a || "start"}">${s}</text>`;
  const ln = (a, b, c, d, col = INK, w = 1.6, ex = "") => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" ${ex}/>`;
  const cb = (x, y, col = INK) => `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="#fff" stroke="${col}" stroke-width="1.6"/>` + ln(x - 4.5, y - 4.5, x + 4.5, y + 4.5, col, 1.4) + ln(x - 4.5, y + 4.5, x + 4.5, y - 4.5, col, 1.4);
  const ct = (x, y, col = INK) => `<circle cx="${x}" cy="${y}" r="5.5" fill="none" stroke="${col}" stroke-width="1.4"/>`;
  const earth = (x, y) => ln(x, y, x, y + 8, INK, 1.4) + ln(x - 8, y + 8, x + 8, y + 8, INK, 1.4) + ln(x - 5, y + 11.5, x + 5, y + 11.5, INK, 1.4) + ln(x - 2, y + 15, x + 2, y + 15, INK, 1.4);
  const tag = (x, y, w, s1, col = GR) => `<rect x="${x}" y="${y}" width="${w}" height="16" rx="3" fill="#fff" stroke="${col}" stroke-width="1"/>` + t(x + w / 2, y + 11.5, s1, { s: 10, a: "middle", c: col });
  // 도면 틀과 구역 눈금
  g += `<rect x="6" y="6" width="1628" height="614" fill="#fff" stroke="${INK}" stroke-width="2"/><rect x="14" y="14" width="1612" height="598" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
  for (let i = 0; i < 8; i++) g += t(14 + 1612 / 16 + i * 1612 / 8, 12.5, String(i + 1), { s: 7, a: "middle", c: GR }) + (i ? ln(14 + i * 1612 / 8, 6, 14 + i * 1612 / 8, 14, INK, 0.8) : "");
  ["A", "B", "C", "D"].forEach((c, i) => { g += t(10, 14 + 598 / 8 + i * 598 / 4 + 3, c, { s: 7, a: "middle", c: GR }) + (i ? ln(6, 14 + i * 598 / 4, 14, 14 + i * 598 / 4, INK, 0.8) : ""); });
  // 컨테이너 경계
  g += `<rect x="52" y="64" width="1016" height="338" rx="6" fill="#f7f9fb" stroke="${GR}" stroke-width="1.2" stroke-dasharray="9 5"/>` + t(1056, 82, "⑥ 고전압 배전 및 변압체계: 20ft ISO 컨테이너 1대", { s: 12, b: 1, c: GR, a: "end" });
  // 고압 인입
  const X = 300;
  g += t(X, 34, "한전 22.9 kV, 3상 60 Hz(주둔지 상전)", { s: 12, b: 1, a: "middle", c: HV }) + ln(X, 40, X, 100, HV, 2.4) + `<path d="M${X - 6} 52 h12 l-6 10 Z" fill="${HV}"/>` + t(X + 12, 60, "고압 케이블, 엘보형 접속재", { s: 10, c: GR });
  g += ln(X, 92, X - 46, 92, HV, 1.6) + `<rect x="${X - 60}" y="86" width="14" height="24" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` + `<path d="M${X - 53} 90 v12 m-3 -4 l3 4 l3 -4" fill="none" stroke="${INK}" stroke-width="1.2"/>` + earth(X - 53, 110) + t(X - 66, 101, "피뢰기", { s: 10, a: "end", c: GR });
  g += cb(X, 108, HV) + t(X + 14, 106, "고압 개폐 장치(24 kV급)", { s: 11, b: 1 }) + t(X + 14, 119, "부하 개폐기 + 전력 퓨즈 25 A, 1회선(적용안)", { s: 10, c: RED });
  g += ln(X, 115, X, 150, HV, 2.4) + ct(X, 132, HV) + ln(X + 6, 132, X + 150, 132, GR, 1, 'stroke-dasharray="3 3"') + tag(X + 150, 124, 112, "보호 계전기와 계량기");
  // 변압기
  g += `<circle cx="${X}" cy="164" r="15" fill="#fff" stroke="${HV}" stroke-width="2.2"/><circle cx="${X}" cy="186" r="15" fill="none" stroke="${LV}" stroke-width="2.2"/>`;
  g += t(X + 24, 170, "TR  몰드형 변압기 500 kVA", { s: 12, b: 1 }) + t(X + 24, 184, "22.9 kV / 380 V, 권선 온도 감시", { s: 10.5 }) + t(X + 24, 197, "1차 Δ, 2차 Y, 임피던스 5 %(적용안)", { s: 10, c: RED });
  g += t(X - 24, 168, "1차 약 12.6 A", { s: 10, a: "end", c: GR }) + t(X - 24, 190, "2차 약 760 A", { s: 10, a: "end", c: GR });
  g += ln(X, 201, X, 290, LV, 2.4) + cb(X, 226, LV) + t(X + 14, 224, "저압 주 차단기(1,000 A급, 정정 760 A)", { s: 11, b: 1 }) + t(X + 14, 237, "TPCS 신호 CB.GRID, 고압 개폐 장치와 연동 잠금", { s: 10, c: GR });
  g += ct(X, 258, LV) + ln(X - 6, 258, X - 40, 258, GR, 1, 'stroke-dasharray="3 3"') + `<circle cx="${X - 50}" cy="258" r="10" fill="#fff" stroke="${GR}" stroke-width="1.2"/>` + t(X - 50, 262, "M", { s: 10, a: "middle", b: 1, c: GR });
  // 모선
  const YB = 290, A1 = 80, A2 = 500, B1 = 620, B2 = 1040;
  g += ln(A1, YB, A2, YB, LV, 5.5) + ln(B1, YB, B2, YB, LV, 5.5) + t(A1, YB - 9, "모선 A  380 V, 2,500 A", { s: 12, b: 1, c: LV }) + t(B2, YB - 9, "모선 B  380 V, 2,500 A", { s: 12, b: 1, a: "end", c: LV });
  g += ln(A2, YB, B1, YB, LV, 1.8) + cb(560, YB, LV) + t(560, YB - 14, "연계 차단기 CB.TIE", { s: 10.5, a: "middle", b: 1 });
  // 게이트웨이와 TPCS
  g += `<rect x="760" y="110" width="180" height="42" rx="4" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` + t(850, 127, "계측 및 보호 게이트웨이", { s: 11, b: 1, a: "middle" }) + t(850, 142, "차단기 상태, 고장, 전압, 전력", { s: 10, a: "middle", c: GR });
  g += ln(940, 131, 1090, 131, INK, 1.2, 'stroke-dasharray="6 3"') + ln(940, 137, 1090, 137, INK, 1.2, 'stroke-dasharray="6 3"') + t(1000, 124, "Modbus TCP 이중 경로", { s: 10, a: "middle", c: GR });
  g += `<rect x="760" y="176" width="180" height="30" rx="4" fill="#fff" stroke="${GR}" stroke-width="1.2"/>` + t(850, 195, "변압기 구획 강제 환기 팬", { s: 10.5, a: "middle", c: GR });
  // 분기
  const fd = (x, col, y2) => ln(x, YB, x, y2, col, 2) + cb(x, YB + 26, col);
  const src = (x, sym, n1, n2) => { let o = fd(x, SRC, 408) + `<path d="M${x - 5} ${YB + 50} h10 l-5 -9 Z" fill="${SRC}"/>` + ln(x, 402, x, 426, SRC, 2);
    o += sym === "G" ? `<circle cx="${x}" cy="442" r="16" fill="#fff" stroke="${SRC}" stroke-width="2"/>` + t(x, 447, "G", { s: 14, b: 1, a: "middle", c: SRC })
      : `<rect x="${x - 16}" y="426" width="32" height="32" fill="#fff" stroke="${SRC}" stroke-width="2"/>` + ln(x - 16, 458, x + 16, 426, SRC, 1.2) + t(x - 8, 439, "~", { s: 12, b: 1, a: "middle", c: SRC }) + t(x + 8, 454, "=", { s: 12, b: 1, a: "middle", c: SRC });
    return o + t(x, 476, n1, { s: 11, b: 1, a: "middle" }) + (n2 ? t(x, 489, n2, { s: 9.5, a: "middle", c: GR }) : ""); };
  const spare = x => fd(x, GR, 350) + t(x, 364, "예비", { s: 10, a: "middle", c: GR });
  g += src(110, "G", "복합전력 발전기", "디젤") + src(200, "P", "복합전력 ESS", "계통 형성 PCS") + src(290, "P", "태양광", "인버터") + spare(355);
  g += spare(765) + src(840, "P", "이동형 ESS", "PCS") + src(930, "P", "수소 연료전지", "인버터") + spare(1005);
  // 환망
  const RA = 420, RB = 700, YR = 548;
  g += fd(RA, LV, YR) + fd(RB, LV, YR) + ln(RA, YR, RB, YR, LV, 2);
  g += ct(RA, YB + 46, LV) + ct(RB, YB + 46, LV) + t(RA + 12, YB + 30, "환망 급전 A  630 A", { s: 11, b: 1 }) + t(RB - 12, YB + 30, "환망 급전 B  630 A", { s: 11, b: 1, a: "end" });
  g += tag(RA + 12, YB + 38, 96, "87  67  27 보호") + tag(RB - 108, YB + 38, 96, "87  67  27 보호");
  const fsu = (x, y, n) => `<rect x="${x - 23}" y="${y - 11}" width="46" height="22" rx="3" fill="#eaf1f8" stroke="${LV}" stroke-width="1.6"/>` + t(x, y + 4, n, { s: 10.5, b: 1, a: "middle", c: LV });
  g += fsu(RA, 440, "FSU 1") + fsu(RB, 440, "FSU n") + fsu(480, YR, "FSU 2") + fsu(640, YR, "FSU …");
  g += `<rect x="552" y="${YR - 8}" width="16" height="16" fill="#fff" stroke="${RED}" stroke-width="1.8"/>` + ln(556, YR + 4, 564, YR - 4, RED, 1.6) + t(560, YR - 14, "상시 개방점 1개소", { s: 10.5, b: 1, a: "middle", c: RED });
  [[RA - 23, 440, -1], [RB + 23, 440, 1]].forEach(([x, y, d]) => { g += ln(x, y, x + d * 22, y, LV, 1.4) + t(x + d * 26, y + 4, "PPDU-20, 부하", { s: 9.5, a: d < 0 ? "end" : "start", c: GR }); });
  [480, 640].forEach(x => { g += ln(x, YR + 11, x, YR + 26, LV, 1.4) + t(x, YR + 38, "PPDU-20, 부하", { s: 9.5, a: "middle", c: GR }); });
  g += t(560, YR + 52, "환상 간선: 양쪽 급전, 구간분전함으로 구간 분할(제안 발표 기준 6구간)", { s: 10.5, a: "middle", c: GR });
  g += t(560, 378, "분기 합계 12회로", { s: 10.5, b: 1, c: RED, a: "middle" }) + t(560, 392, "배정은 5장의 반영안 참조", { s: 10, c: RED, a: "middle" }) + t(1056, 98, "전원의 모선 배정은 TPCS 모선 구성 설정에 따름", { s: 10, a: "end", c: GR });
  // 오른쪽 단: 범례, 정격, 확정 필요, 표제란
  const PX = 1100, PW = 518; g += ln(PX - 12, 14, PX - 12, 612, INK, 0.8);
  const hd = (y, s1) => `<rect x="${PX}" y="${y}" width="${PW}" height="20" fill="${LV}"/>` + t(PX + 10, y + 14.5, s1, { s: 12, b: 1, c: "#fff" });
  g += hd(24, "범례");
  const lg = [[cb(PX + 18, 62), "차단기"], [ct(PX + 18, 84), "변류기"], [`<circle cx="${PX + 18}" cy="106" r="8" fill="#fff" stroke="${GR}" stroke-width="1.2"/>` + t(PX + 18, 110, "M", { s: 9, a: "middle", b: 1, c: GR }), "계량기"],
    [ln(PX + 150, 62, PX + 186, 62, HV, 2.4), "22.9 kV"], [ln(PX + 150, 84, PX + 186, 84, LV, 2.4), "380 V"], [ln(PX + 150, 106, PX + 186, 106, SRC, 2), "전원 접속"],
    [ln(PX + 300, 62, PX + 336, 62, INK, 1.2, 'stroke-dasharray="6 3"'), "통신"], [ln(PX + 300, 84, PX + 336, 84, GR, 1.2, 'stroke-dasharray="9 5"'), "컨테이너 경계"], [`<rect x="${PX + 310}" y="98" width="16" height="16" fill="#fff" stroke="${RED}" stroke-width="1.8"/>`, "상시 개방점"]];
  lg.forEach(([sy, nm], i) => { g += sy + t(PX + [36, 196, 346][Math.floor(i / 3)], 66 + (i % 3) * 22, nm, { s: 11 }); });
  g += t(PX + 10, 134, "87 구간 차동, 67 방향성, 27 저전압(제안 발표 자료의 보호 요소)", { s: 10.5, c: GR });
  g += hd(148, "주요 정격");
  const rt = [["형태", "20ft ISO 컨테이너 1대, 15 t 이하, PLS 운송", "받은 자료"], ["변압기", "몰드형 500 kVA, 22.9 kV / 380 V", "받은 자료"], ["저압 분기", "12회로", "받은 자료"], ["환상 간선", "630 A, 구간분전함으로 분할", "받은 자료"],
    ["변압기 전류", "1차 약 12.6 A, 2차 약 760 A", "계산값"], ["저압 모선, 주 차단기", "모선 2,500 A, 주 차단기 1,000 A급, 차단 용량 36 kA", "반영안"]];
  rt.forEach((r, i) => { const y = 168 + i * 21; g += `<rect x="${PX}" y="${y}" width="${PW}" height="21" fill="${i % 2 ? "#fff" : "#f3f6f9"}" stroke="#c9d1d9" stroke-width="0.6"/>` + t(PX + 10, y + 14.5, r[0], { s: 11, b: 1 }) + t(PX + 118, y + 14.5, r[1], { s: 11 }) + t(PX + PW - 10, y + 14.5, r[2], { s: 10, a: "end", c: r[2] === "받은 자료" ? GR : "#8a4b12" }); });
  g += `<rect x="${PX}" y="306" width="${PW}" height="20" fill="${RED}"/>` + t(PX + 10, 320.5, "설계 적용안(허용 범위와 사유는 5장, 계산은 별첨)", { s: 12, b: 1, c: "#fff" });
  ["분기 12회로(적용안). 전원 7, 환망 2, 소내 1, 예비 2(증설 분전반)", "저압 모선(반영안). 구획별 전원 합계 약 2,009 A 이상인 2,500 A", "변압기 2차(반영안). 모선 A 인입, 연계 차단기로 모선 B 공급",
    "역가압 방지(반영안). 고압 개폐 장치 개방 시 주 차단기 투입 잠금", "고압 측(적용안). 1회선 방사상, 부하 개폐기 + 전력 퓨즈, 피뢰기 18 kV", "작전지 운용(적용안). 고압 측 미사용, 고압 개폐 장치 개방 잠금"].forEach((s1, i) => {
    const y = 326 + i * 22; g += `<rect x="${PX}" y="${y}" width="${PW}" height="22" fill="#fff" stroke="#e3c4c1" stroke-width="0.6"/>` + `<circle cx="${PX + 14}" cy="${y + 11}" r="7.5" fill="${RED}"/>` + t(PX + 14, y + 14.5, String(i + 1), { s: 9.5, b: 1, a: "middle", c: "#fff" }) + t(PX + 28, y + 15, s1, { s: 10.5 }); });
  // 표제란
  const TY = 472; g += `<rect x="${PX}" y="${TY}" width="${PW}" height="132" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` + ln(PX, TY + 44, PX + PW, TY + 44, INK, 0.8) + ln(PX, TY + 88, PX + PW, TY + 88, INK, 0.8) + ln(PX + 300, TY + 44, PX + 300, TY + 132, INK, 0.8) + ln(PX + 150, TY + 88, PX + 150, TY + 132, INK, 0.8);
  g += t(PX + 10, TY + 15, "도면명", { s: 9, c: GR }) + t(PX + 10, TY + 35, "⑥ 고전압 배전 및 변압체계 단선 결선도", { s: 15, b: 1 });
  g += t(PX + 10, TY + 59, "체계", { s: 9, c: GR }) + t(PX + 10, TY + 78, "IFPS 이동형 배전체계", { s: 12.5, b: 1 }) + t(PX + 310, TY + 59, "구분", { s: 9, c: GR }) + t(PX + 310, TY + 78, "적용안(제작사 검증 전)", { s: 12.5, b: 1, c: RED });
  g += t(PX + 10, TY + 103, "리비전", { s: 9, c: GR }) + t(PX + 10, TY + 122, process.argv[3] || "Rev72", { s: 12.5, b: 1 }) + t(PX + 160, TY + 103, "축척", { s: 9, c: GR }) + t(PX + 160, TY + 122, "없음(계통도)", { s: 12.5, b: 1 }) + t(PX + 310, TY + 103, "비고", { s: 9, c: GR }) + t(PX + 310, TY + 122, "시공 도면 아님", { s: 12.5, b: 1 });
  return g;
}
/** 작전지 전개 배치도(실제 치수 비율, 도면 양식). 1640 × 626. 1 m = 7.4 px */
function sitePlan() {
  const HV = "#b3261e", LV = "#1f3a5f", SRC = "#2f6b3f", INK = "#1b2733", GR = "#5b6773", RED = "#b3261e", OR = "#d9731a", OD = "#6b7a45", K = 7.4; let g = "";
  const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.s || 11}" font-weight="${o.b ? 700 : 400}" fill="${o.c || INK}" text-anchor="${o.a || "start"}">${s}</text>`;
  const ln = (a, b, c, d, col = INK, w = 1.6, ex = "") => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" ${ex}/>`;
  const pl = (pts, col, w, ex = "") => `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${ex}/>`;
  g += `<rect x="6" y="6" width="1628" height="614" fill="#fff" stroke="${INK}" stroke-width="2"/><rect x="14" y="14" width="1612" height="598" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
  for (let i = 0; i < 8; i++) g += t(14 + 1612 / 16 + i * 1612 / 8, 12.5, String(i + 1), { s: 7, a: "middle", c: GR }) + (i ? ln(14 + i * 1612 / 8, 6, 14 + i * 1612 / 8, 14, INK, 0.8) : "");
  ["A", "B", "C", "D"].forEach((c, i) => { g += t(10, 14 + 598 / 8 + i * 598 / 4 + 3, c, { s: 7, a: "middle", c: GR }) + (i ? ln(6, 14 + i * 598 / 4, 14, 14 + i * 598 / 4, INK, 0.8) : ""); });
  g += `<rect x="24" y="24" width="1052" height="578" fill="#f4f1e8" stroke="#cfc8b4" stroke-width="1"/>`;                       // 부지
  // 구역
  const zone = (x, y, w, h, nm) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${GR}" stroke-width="1" stroke-dasharray="7 5"/>` + t(x + 8, y + 15, nm, { s: 11, b: 1, c: GR });
  g += zone(36, 36, 500, 330, "전원 구역") + zone(36, 392, 330, 198, "통제 구역") + zone(600, 36, 464, 554, "부하 구역(환망)");
  g += `<rect x="556" y="36" width="34" height="554" fill="#e2dccb" stroke="none"/>` + t(573, 420, "차량 통로", { s: 10, a: "middle", c: GR });
  // 차량(9.0 × 2.5 m), 운전석은 오른쪽
  const TW = 9 * K, TH = 2.5 * K, TX = 380;
  const truck = (y, no, nm, sub) => `<rect x="${TX}" y="${y}" width="${TW}" height="${TH}" rx="2" fill="${OD}" stroke="${INK}" stroke-width="1.2"/><rect x="${TX + TW - 15}" y="${y + 2}" width="13" height="${TH - 4}" rx="2" fill="#4c5a2f"/>` + t(TX - 8, y + 9, no + " " + nm, { s: 11, b: 1, a: "end" }) + t(TX - 8, y + 21, sub, { s: 9.5, a: "end", c: GR });
  const TY = [70, 130, 200, 322];
  g += truck(TY[0], "①", "복합전력 차량", "디젤 발전기 + ESS") + truck(TY[1], "②", "ESS 차량", "이동형 에너지저장장치");
  g += `<rect x="${TX}" y="${TY[2]}" width="${TW}" height="${TH}" rx="2" fill="${OD}" stroke="${INK}" stroke-width="1.2"/><rect x="${TX + TW - 15}" y="${TY[2] + 2}" width="13" height="${TH - 4}" rx="2" fill="#4c5a2f"/><rect x="${TX + 2}" y="${TY[2] + 1.5}" width="12" height="${TH - 3}" fill="#22355c" stroke="${INK}" stroke-width="1"/>`;
  g += `<rect x="${TX - 40 * K}" y="${TY[2] + 1}" width="${40 * K}" height="${TH - 2}" fill="#2c4a86" stroke="#16264a" stroke-width="1"/>`;
  for (let i = 1; i < 20; i++) g += ln(TX - i * 2 * K, TY[2] + 1, TX - i * 2 * K, TY[2] + TH - 1, "#7f96c4", 0.6);
  g += t(TX - 20 * K, TY[2] - 6, "③ 롤러블 태양광 차량: 뒤쪽 드럼에서 차량 뒤로 패널 띠 전개(길이 40 m 예시)", { s: 11, b: 1, a: "middle" });
  g += truck(TY[3], "④", "수소 차량", "연료전지 + 수소 저장") + t(TX - 8, TY[3] + 33, "다른 장비와 10 m, 지휘통제와 17 m 이상", { s: 9.5, a: "end", c: RED }) + `<rect x="${TX - 10 * K}" y="${TY[3] - 10 * K}" width="${TW + 20 * K}" height="${TH + 20 * K}" rx="${10 * K}" fill="none" stroke="${RED}" stroke-width="1" stroke-dasharray="4 4"/>` + t(TX + TW / 2, TY[3] - 10 * K + 12, "10 m", { s: 9, a: "middle", c: RED });
  // ⑥ 컨테이너(6.06 × 2.44 m), 세로 배치
  const CX = 500, CY = 160, CW = 2.44 * K, CH = 6.06 * K;
  g += `<rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" fill="#56653a" stroke="${INK}" stroke-width="1.6"/>` + `<rect x="${CX}" y="${CY - 4}" width="${CW}" height="4" fill="${HV}"/>`;
  g += `<rect x="${CX}" y="${CY + CH}" width="${CW}" height="4" fill="${LV}"/>` + t(454, CY - 24, "⑥ 배전 및 변압(컨테이너 1대)", { s: 10.5, b: 1 }) + t(CX + CW + 32, CY - 9, "고압 인입부(끝면)", { s: 9.5, a: "end", c: HV }) + t(CX + CW + 6, CY + CH - 8, "저압", { s: 9.5, c: LV }) + t(CX + CW + 6, CY + CH + 3, "접속반", { s: 9.5, c: LV });
  // 전원 케이블(차량 → 컨테이너 옆면)
  TY.forEach((y, i) => { const yy = CY + CH + 9 + i * 5, xx = CX + 3 + i * 3; g += pl(`${TX + TW},${y + TH / 2} ${TX + TW + 14 + i * 5},${y + TH / 2} ${TX + TW + 14 + i * 5},${yy} ${xx},${yy} ${xx},${CY + CH + 4}`, SRC, 1.8); });
  // TPCS 쉘터(6.0 × 2.4 m)와 통신선
  const SX = 150, SY = 470; g += `<rect x="${SX}" y="${SY}" width="${6 * K}" height="${2.4 * K}" fill="#3d5a80" stroke="${INK}" stroke-width="1.4"/>` + t(SX + 3 * K, SY + 34, "⑤ TPCS 통제 쉘터", { s: 11, b: 1, a: "middle" }) + t(SX + 3 * K, SY + 46, "전원 구역의 소음원에서 이격", { s: 9.5, a: "middle", c: GR });
  g += pl(`${SX + 6 * K},${SY + 9} ${CX - 10},${SY + 9} ${CX - 10},${CY + 14} ${CX},${CY + 14}`, OR, 1.6, 'stroke-dasharray="6 3"') + t(360, SY + 3, "통신선(이중 경로)", { s: 9.5, a: "middle", c: OR });
  g += `<circle cx="${SX - 20}" cy="${SY + 9}" r="4" fill="none" stroke="${INK}" stroke-width="1.2"/>` + ln(SX - 20, SY + 9, SX, SY + 9, INK, 1) + t(SX - 28, SY + 13, "안테나", { s: 9.5, a: "end", c: GR });
  // 환망
  const RX1 = 660, RX2 = 1010, RY1 = 90, RY2 = 540, FA = CY + CH + 34, FB = CY + CH + 46;
  g += pl(`${CX + CW - 2},${CY + CH + 4} ${CX + CW - 2},${FA} ${RX1 - 60},${FA} ${RX1 - 60},${RY1} ${RX2},${RY1} ${RX2},${RY2} ${RX1 - 40},${RY2} ${RX1 - 40},${FB} ${CX + CW - 6},${FB} ${CX + CW - 6},${CY + CH + 4}`, LV, 2.6);
  g += t(592, FA - 5, "급전 A", { s: 9.5, a: "end", c: LV }) + t(592, FB + 12, "급전 B", { s: 9.5, a: "end", c: LV });
  const fsu = (x, y, n) => `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" fill="#eaf1f8" stroke="${LV}" stroke-width="1.8"/>` + t(x, y - 11, "FSU " + n, { s: 9.5, b: 1, a: "middle", c: LV });
  const F = [[720, RY1], [900, RY1], [RX2, 230], [RX2, 400], [900, RY2], [720, RY2]];
  F.forEach(([x, y], i) => { g += fsu(x, y, i + 1); });
  g += `<rect x="${RX2 - 7}" y="308" width="14" height="14" fill="#fff" stroke="${RED}" stroke-width="2"/>` + ln(RX2 - 4, 319, RX2 + 4, 311, RED, 1.6) + t(RX2 - 12, 319, "상시 개방점", { s: 9.5, b: 1, a: "end", c: RED });
  const tent = (x, y, w, h, nm, f) => `<rect x="${x}" y="${y}" width="${w * K}" height="${h * K}" rx="2" fill="#a9b08a" stroke="#5c6440" stroke-width="1.2"/>` + ln(x, y + h * K / 2, x + w * K, y + h * K / 2, "#5c6440", 0.8) + t(x + w * K / 2, y + h * K + 12, nm, { s: 10, b: 1, a: "middle" });
  const L = [[690, 130, 10, 5, "지휘통제(1등급)", 0], [870, 130, 10, 5, "의무시설(1등급)", 1], [860, 250, 12, 6, "막사(2등급)", 2], [860, 370, 12, 6, "막사(2등급)", 3], [870, 470, 8, 5, "정비 및 취사(3등급)", 4], [690, 470, 8, 5, "탄약저장(3등급)", 5]];
  L.forEach(([x, y, w, h, nm, i]) => { const [fx, fy] = F[i], cx = x + w * K / 2, cy = y + (fy < y ? 0 : h * K), px = (fx + cx) / 2, py = (fy + cy) / 2;
    g += tent(x, y, w, h, nm) + pl(`${fx},${fy} ${px},${py} ${cx},${cy}`, LV, 1.2) + `<rect x="${px - 4}" y="${py - 4}" width="8" height="8" fill="${OR}" stroke="${INK}" stroke-width="0.8"/>`; });
  // 차량 통로와 보호대
  g += `<rect x="556" y="${FA - 5}" width="34" height="${FB - FA + 10}" fill="#f2c200" stroke="${INK}" stroke-width="0.8"/>`;
  // 축척
  g += ln(60, 574, 60 + 20 * K, 574, INK, 2) + [0, 10, 20].map(m => ln(60 + m * K, 569, 60 + m * K, 579, INK, 1.4) + t(60 + m * K, 592, m + " m", { s: 9.5, a: "middle" })).join("") + t(60 + 20 * K + 12, 578, "장비는 실제 치수 비율로 표시", { s: 9.5, c: GR });
  // 오른쪽 단
  const PX = 1100, PW = 518; g += ln(PX - 12, 14, PX - 12, 612, INK, 0.8);
  const hd = (y, s1, col = LV) => `<rect x="${PX}" y="${y}" width="${PW}" height="20" fill="${col}"/>` + t(PX + 10, y + 14.5, s1, { s: 12, b: 1, c: "#fff" });
  g += hd(24, "범례");
  const lg = [[`<rect x="${PX + 8}" y="56" width="26" height="10" fill="${OD}" stroke="${INK}"/>`, "전원 차량(9.0 × 2.5 m)"], [`<rect x="${PX + 8}" y="78" width="18" height="10" fill="#56653a" stroke="${INK}"/>`, "⑥ 컨테이너(6.06 × 2.44 m)"], [`<rect x="${PX + 8}" y="100" width="18" height="10" fill="#3d5a80" stroke="${INK}"/>`, "⑤ TPCS 쉘터"],
    [ln(PX + 268, 61, PX + 300, 61, SRC, 1.8), "전원 케이블(380 V)"], [ln(PX + 268, 83, PX + 300, 83, LV, 2.6), "환망 간선(380 V, 630 A)"], [ln(PX + 268, 105, PX + 300, 105, OR, 1.6, 'stroke-dasharray="6 3"'), "통신선"]];
  lg.forEach(([sy, nm], i) => { g += sy + t(PX + (i < 3 ? 44 : 310), 65 + (i % 3) * 22, nm, { s: 11 }); });
  g += `<rect x="${PX + 10}" y="120" width="12" height="12" fill="#eaf1f8" stroke="${LV}" stroke-width="1.8"/>` + t(PX + 30, 130, "구간분전함(FSU)", { s: 11 }) + `<rect x="${PX + 160}" y="122" width="8" height="8" fill="${OR}" stroke="${INK}" stroke-width="0.8"/>` + t(PX + 176, 130, "배전체계(PPDU-20)", { s: 11 }) + `<rect x="${PX + 320}" y="120" width="12" height="12" fill="#f2c200" stroke="${INK}" stroke-width="0.8"/>` + t(PX + 340, 130, "케이블 보호대", { s: 11 });
  g += hd(146, "배치 원칙");
  [["전원 구역", "전원 차량을 ⑥ 컨테이너 한쪽에 모아 케이블 길이 최소화"], ["⑥ 컨테이너", "한쪽 끝면은 고압 인입부, 반대쪽 끝면은 저압 접속반(12회로)"], ["태양광", "패널 띠는 차량 뒤로 전개. 그늘과 차량 동선을 피해 배치"],
    ["TPCS", "전원 구역과 떨어진 통제 구역. 통신선 이중 경로"], ["환망", "급전 A, B 로 시설을 한 바퀴. 구간분전함 6대, 상시 개방점 1개소"], ["부하", "구간분전함에서 배전체계를 거쳐 시설로 공급"]].forEach((r, i) => {
    const y = 166 + i * 21; g += `<rect x="${PX}" y="${y}" width="${PW}" height="21" fill="${i % 2 ? "#fff" : "#f3f6f9"}" stroke="#c9d1d9" stroke-width="0.6"/>` + t(PX + 10, y + 14.5, r[0], { s: 11, b: 1 }) + t(PX + 92, y + 14.5, r[1], { s: 10.5 }); });
  g += hd(304, "설계 확정 필요 항목", RED);
  ["장비 수량과 간격은 예시. 임무, 부지, 지형에 따라 확정", "수소 차량 이격: 다른 장비 10 m, 사람이 있는 시설 12 ~ 17 m(법규 준용, 5장)", "케이블 길이 한도. 전압 강하와 보호 협조 검토 후 확정", "차량 치수는 일반 군용 차량 크기로 잡은 값. 실제 차량으로 확정", "태양광 패널 띠의 길이와 줄 수. 제품 제원으로 확정"].forEach((s1, i) => {
    const y = 324 + i * 22; g += `<rect x="${PX}" y="${y}" width="${PW}" height="22" fill="#fff" stroke="#e3c4c1" stroke-width="0.6"/>` + `<circle cx="${PX + 14}" cy="${y + 11}" r="7.5" fill="${RED}"/>` + t(PX + 14, y + 14.5, String(i + 1), { s: 9.5, b: 1, a: "middle", c: "#fff" }) + t(PX + 28, y + 15, s1, { s: 10.5 }); });
  const TY0 = 472; g += `<rect x="${PX}" y="${TY0}" width="${PW}" height="132" fill="#fff" stroke="${INK}" stroke-width="1.4"/>` + ln(PX, TY0 + 44, PX + PW, TY0 + 44, INK, 0.8) + ln(PX, TY0 + 88, PX + PW, TY0 + 88, INK, 0.8) + ln(PX + 300, TY0 + 44, PX + 300, TY0 + 132, INK, 0.8) + ln(PX + 150, TY0 + 88, PX + 150, TY0 + 132, INK, 0.8);
  g += t(PX + 10, TY0 + 15, "도면명", { s: 9, c: GR }) + t(PX + 10, TY0 + 35, "작전지 전개 배치도(예시)", { s: 15, b: 1 });
  g += t(PX + 10, TY0 + 59, "체계", { s: 9, c: GR }) + t(PX + 10, TY0 + 78, "IFPS 이동형 전력체계", { s: 12.5, b: 1 }) + t(PX + 310, TY0 + 59, "구분", { s: 9, c: GR }) + t(PX + 310, TY0 + 78, "배치 예시(설계 확정 전)", { s: 12.5, b: 1, c: RED });
  g += t(PX + 10, TY0 + 103, "리비전", { s: 9, c: GR }) + t(PX + 10, TY0 + 122, process.argv[3] || "Rev72", { s: 12.5, b: 1 }) + t(PX + 160, TY0 + 103, "축척", { s: 9, c: GR }) + t(PX + 160, TY0 + 122, "막대 축척 참조", { s: 12.5, b: 1 }) + t(PX + 310, TY0 + 103, "비고", { s: 9, c: GR }) + t(PX + 310, TY0 + 122, "시공 도면 아님", { s: 12.5, b: 1 });
  return g;
}
/** 보호 협조 개념도: 말단일수록 먼저 동작하는 계단(값은 미정). 1024 × 688 */
function coord() {
  let g = ""; const ST = [["① PPDU-20 출력 회로", "#2f7d4f"], ["② 구간분전함 분기", "#3a7ca5"], ["③ 환상 간선 구간(차동, 블로킹)", "#1d4f91"], ["④ 환망 급전 A, B", "#6a4c93"], ["⑤ 저압 주 차단기, 고압 측", "#a3261a"]];
  g += T(512, 44, "보호 협조 개념: 고장 지점에 가까운 장치가 먼저 동작", { s: 22, b: 1 }) + T(512, 72, "세로는 동작 시간의 순서만 나타냄. 시간과 전류의 값은 보호 협조 검토에서 확정", { s: 14, c: "#8a4b12" });
  const X0 = 150, Y0 = 560, W = 780, H = 420; g += LN(X0, Y0, X0 + W, Y0, "#1b2733", 2) + LN(X0, Y0, X0, Y0 - H - 20, "#1b2733", 2);
  g += T(X0 + W / 2, Y0 + 44, "전원 쪽  ←  보호 장치의 위치  →  부하 쪽", { s: 14, c: "#55626f" }) + `<text x="${X0 - 46}" y="${Y0 - H / 2}" font-size="14" fill="#55626f" text-anchor="middle" transform="rotate(-90 ${X0 - 46} ${Y0 - H / 2})">동작 시간(늦음 ↑, 빠름 ↓)</text>`;
  ST.forEach(([nm, col], i) => { const k = ST.length - 1 - i, x = X0 + 20 + k * 150, h = 60 + i * 78, y = Y0 - h;
    g += R(x, y, 136, h, col + "22", col, 2) + LN(x, y, x + 136, y, col, 5) + T(x + 68, y - 12, nm.slice(0, 1) + " 단계", { s: 14, b: 1, c: col }) + `<text x="${x + 68}" y="${Y0 + 20}" font-size="12.5" fill="#1b2733" text-anchor="middle">${nm.slice(2).split("(")[0]}</text>`; });
  g += `<path d="M${X0 + 20 + 4 * 150 + 68} ${Y0 - 60 - 50} l-16 -34 h10 v-30 h12 v30 h10 Z" fill="#b3261e"/>` + T(X0 + 20 + 4 * 150 + 68, Y0 - 60 - 122, "고장", { s: 15, b: 1, c: "#b3261e" });
  g += R(72, 612, 880, 56, "#fff7e6", "#c98a1a", 1.2) + T(512, 636, "앞 단계가 끊지 못하면 다음 단계가 뒤를 받침(후비 보호). 환상 간선은 차동 보호로 고장 구간만 순시 분리", { s: 14, b: 1 }) + T(512, 656, "한전 연계 때와 자립 운전 때의 고장 전류가 달라 정정값을 따로 검토", { s: 13.5 });
  return g;
}
/** 최대 전개 반경의 정의 그림. 1024 × 688 */
function radius() {
  let g = ""; const cx = 470, cy = 340, r = 190, LV = "#1f3a5f", RED = "#b3261e", GR = "#55626f";
  g += T(512, 44, "최대 전개 반경의 정의", { s: 22, b: 1 }) + T(512, 72, "환망을 원형으로 놓았을 때 ⑥ 컨테이너에서 가장 먼 부하까지의 직선거리", { s: 14, c: "#8a4b12" });
  g += `<circle cx="${cx - r - 0}" cy="${cy}" r="${2 * r + 96}" fill="#f4f8ec" stroke="${RED}" stroke-width="1.6" stroke-dasharray="8 6" clip-path="inset(0)"/>`;
  g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${LV}" stroke-width="5"/>`;
  g += R(cx - r - 22, cy - 34, 44, 68, "#56653a", "#1b2733", 2) + T(cx - r - 34, cy - 44, "⑥ 컨테이너", { s: 14, b: 1, a: "end" });
  [[-60, "FSU"], [60, "FSU"], [-120, "FSU"], [120, "FSU"]].forEach(([a]) => { const x = cx + r * Math.cos(a * Math.PI / 180), y = cy + r * Math.sin(a * Math.PI / 180); g += R(x - 9, y - 9, 18, 18, "#eaf1f8", LV, 2); });
  g += R(cx + r - 10, cy - 10, 20, 20, "#eaf1f8", LV, 2.4) + T(cx + r - 16, cy - 18, "가장 먼 구간분전함", { s: 13, b: 1, a: "end", c: LV });
  g += LN(cx + r + 10, cy, cx + r + 96, cy, LV, 2.5) + R(cx + r + 96, cy - 16, 44, 32, "#a9b08a", "#5c6440", 1.5) + T(cx + r + 118, cy - 24, "부하", { s: 13, b: 1 });
  g += LN(cx - r, cy + 70, cx + r, cy + 70, GR, 1.2) + LN(cx - r, cy + 62, cx - r, cy + 78, GR, 1.2) + LN(cx + r, cy + 62, cx + r, cy + 78, GR, 1.2) + T(cx, cy + 92, "D = 환망 둘레 C ÷ π", { s: 15, b: 1, c: GR });
  g += LN(cx + r, cy + 70, cx + r + 96, cy + 70, GR, 1.2) + LN(cx + r + 96, cy + 62, cx + r + 96, cy + 78, GR, 1.2) + T(cx + r + 48, cy + 92, "분기 길이", { s: 13, b: 1, c: GR });
  g += LN(cx - r, cy - 250, cx + r + 96, cy - 250, RED, 1.6) + LN(cx - r, cy - 258, cx - r, cy - 60, RED, 1, 'stroke-dasharray="4 4"') + LN(cx + r + 96, cy - 258, cx + r + 96, cy - 20, RED, 1, 'stroke-dasharray="4 4"') + T(cx + 48, cy - 258, "최대 전개 반경 = C ÷ π + 분기 길이", { s: 16, b: 1, c: RED });
  g += T(cx, cy - 8, "환망 간선", { s: 14, b: 1, c: LV }) + T(cx, cy + 12, "둘레 C: 한쪽 급전의 허용 길이", { s: 13, c: GR });
  g += R(72, 612, 880, 56, "#fff7e6", "#c98a1a", 1.2) + T(512, 636, "둘레 C 는 한 구간이 고장 나 한쪽에서만 공급할 때의 전압 강하로 정함", { s: 14, b: 1 }) + T(512, 656, "붉은 점선 안이 전개 가능 범위. 환망이 원형이 아니면 둘레 한도로 판정", { s: 13.5 });
  return g;
}
function garrison() {
  let g = ""; const box = (x, y, w, h, f, st, t1, t2, t3) => R(x, y, w, h, f, st, 2, 'rx="8"') + T(x + w / 2, y + (t2 ? 30 : h / 2 + 5), t1, { s: 15, b: 1 }) + (t2 ? T(x + w / 2, y + 52, t2, { s: 13 }) : "") + (t3 ? T(x + w / 2, y + 71, t3, { s: 13, c: "#55626f" }) : "");
  const ar = (x1, y1, x2, y2, col, sw = 3) => LN(x1, y1, x2, y2, col, sw) + (y1 === y2 ? `<path d="M${x2} ${y2} l-12 -7 v14 Z" fill="${col}"/>` : `<path d="M${x2} ${y2} l-7 ${y2 > y1 ? -12 : 12} h14 Z" fill="${col}"/>`);
  g += T(512, 44, "주둔지에서의 한전(상전) 연결(검토안)", { s: 22, b: 1 });
  g += T(512, 72, "붉은 선은 22.9 kV, 푸른 선은 380 V. 붉은 글씨는 받은 자료에 없어 이 자료에서 정한 적용안", { s: 14, c: "#8a4b12" });
  // 윗줄: 한전 → 주둔지 수전 설비 → 기존 변압기 → 기존 부하
  g += box(40, 120, 170, 84, "#f6d9d5", "#a3261a", "한전 배전선로", "22.9 kV");
  g += ar(210, 162, 262, 162, "#a3261a") + box(262, 120, 200, 84, "#eef1f4", "#1b2733", "주둔지 수전 설비", "책임분계점, 기존 시설", "변경 최소화");
  g += ar(462, 162, 560, 162, "#a3261a") + box(560, 120, 180, 84, "#eef1f4", "#1b2733", "기존 변압기와 배전반", "주둔지 기존 계통");
  g += ar(740, 162, 800, 162, "#1d4f91") + box(800, 120, 184, 84, "#eef1f4", "#1b2733", "주둔지 기존 부하", "기존 배선 그대로");
  // 분기
  g += `<circle cx="511" cy="162" r="7" fill="#a3261a"/>` + LN(511, 162, 511, 262, "#a3261a", 3) + T(523, 232, "고압 분기점: 분기 개폐기 신설(적용안)", { s: 13, a: "start", c: "#a3261a", b: 1 });
  g += T(523, 251, "기존 고압반에 예비 회로가 있으면 그것을 사용", { s: 13, a: "start", c: "#a3261a" });
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
(async () => { const b = await chromium.launch();
  for (const [n, f, w, h] of [["pd2_layout", plan, 1024, 688], ["pd2_sld", sldPro, 1640, 626], ["pd2_grid", garrison, 1024, 688], ["pd2_plan", sitePlan, 1640, 626], ["pd2_coord", coord, 1024, 688], ["pd2_radius", radius, 1024, 688]]) { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.setContent(`<style>${css} body{margin:0;background:#fff} text{font-family:NSK}</style><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${f()}</svg>`); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: path.join(out, n + ".png") }); await p.close(); }
  await b.close(); })();
