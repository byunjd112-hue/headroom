// AI 예측 기술자료·논문용 그래프(밝은 바탕): ai_paper_eval.json → img/aich_*.png. 개발 PC 에서만 실행한다(결과 그림을 저장소에 둔다).  node docs/ppt/ai_charts.js
const fs = require("fs"), path = require("path"); const { chromium } = require("playwright");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "ai_paper_eval.json"), "utf8")), W = 1200, H = 620, M = { l: 86, r: 30, t: 64, b: 86 };
const COL = { base: "#9aa3ad", ridge: "#2a78c2", cam: "#1aa39a", att: "#e08a1e", ink: "#1f2630", grid: "#dfe3e8", act: "#1f2630" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
function frame(title, sub, ymax, yt, xl, yl, body, legend) {
  const ih = H - M.t - M.b, Y = v => M.t + ih * (1 - v / ymax); let g = "";
  for (let i = 0; i <= yt; i++) { const v = ymax * i / yt; g += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${COL.grid}"/><text x="${M.l - 10}" y="${Y(v) + 6}" text-anchor="end" font-size="17" fill="#566">${+v.toFixed(2)}</text>`; }
  const lg = legend.map(([c, t], i) => `<rect x="${M.l + i * 250}" y="${H - 30}" width="18" height="18" rx="3" fill="${c}"/><text x="${M.l + 26 + i * 250}" y="${H - 15}" font-size="17" fill="${COL.ink}">${esc(t)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff;font-family:Inter,'WenQuanYi Zen Hei',sans-serif"><text x="${M.l}" y="30" font-size="23" font-weight="700" fill="${COL.ink}">${esc(title)}</text><text x="${M.l}" y="52" font-size="15.5" fill="#566">${esc(sub)}</text>${g}${body(Y)}<text x="${(W + M.l - M.r) / 2}" y="${H - 44}" text-anchor="middle" font-size="16.5" fill="#445">${esc(xl)}</text><text transform="translate(24 ${(H + M.t - M.b) / 2}) rotate(-90)" text-anchor="middle" font-size="16.5" fill="#445">${esc(yl)}</text>${lg}</svg>`;
}
function bars(title, sub, series, cats, ymax, yl) {
  const iw = W - M.l - M.r, gw = iw / cats.length, bw = Math.min(46, (gw - 30) / series.length);
  return frame(title, sub, ymax, 5, "선행시간 구간", yl, Y => cats.map((c, i) => series.map(([col, , v], k) => { const x = M.l + gw * i + (gw - bw * series.length - 4 * (series.length - 1)) / 2 + k * (bw + 4);
    return `<rect x="${x}" y="${Y(v[i])}" width="${bw}" height="${Y(0) - Y(v[i])}" rx="4" fill="${col}"/><text x="${x + bw / 2}" y="${Y(v[i]) - 6}" text-anchor="middle" font-size="14" fill="${COL.ink}">${v[i].toFixed(2)}</text>`; }).join("") + `<text x="${M.l + gw * (i + .5)}" y="${H - M.b + 24}" text-anchor="middle" font-size="17" fill="${COL.ink}">${esc(c)}</text>`).join(""), series.map(([c, t]) => [c, t]));
}
function fc(title, S, col, unit) {
  const n = 96, past = S.past.length, tot = past + n, iw = W - M.l - M.r, X = i => M.l + iw * i / (tot - 1), ymax = Math.ceil(Math.max(...S.hi, ...S.act, ...S.past) * 1.12 / 10) * 10, line = (a, o, c, w, d = "") => `<polyline fill="none" stroke="${c}" stroke-width="${w}" ${d} points="${a.map((v, i) => X(o + i) + "," + "Y" + v).join(" ")}"/>`;
  return frame(title, `${S.issued} 발행 · 세로선 왼쪽은 지난 12시간 실측, 오른쪽은 24시간 예측`, ymax, 5, "시간 (15분 구간)", unit, Y => { const fix = s => s.replace(/Y(-?[\d.]+)/g, (_, v) => Y(+v));
    const band = `<polygon fill="${col}" opacity=".2" points="${S.hi.map((v, i) => X(past + i) + "," + Y(v)).concat(S.lo.map((v, i) => X(past + i) + "," + Y(v)).reverse()).join(" ")}"/>`;
    return band + fix(line(S.past, 0, COL.act, 2.4) + line(S.act, past, COL.act, 2.4) + line(S.p50, past, col, 3.2, 'stroke-dasharray="9 5"')) + `<line x1="${X(past - .5)}" x2="${X(past - .5)}" y1="${M.t}" y2="${H - M.b}" stroke="#8a6d1f" stroke-width="1.5"/>` +
      [-12, -6, 0, 6, 12, 18, 24].map(h => `<text x="${X(past - 1 + h * 4)}" y="${H - M.b + 24}" text-anchor="middle" font-size="16" fill="${COL.ink}">${h > 0 ? "+" : ""}${h}h</text>`).join(""); }, [[COL.act, "실측"], [col, "예측(중앙, 점선)"], [col + "55", "80% 예측 구간"]]);
}
const bk = D.data.buckets.map(b => "≤ " + b + "시간"), P = D.pv, out = {
  pv_h: bars("태양광 예측 오차 — 선행시간 구간별", `시험 ${D.data.test_days}일 · ${D.data.issues}회 발행 · 설비 용량(${D.data.kwp} kW) 대비 평균 절대 오차(%) · 낮 구간만`, [[COL.base, "전일 같은 시각", P[0].base_by_h], [COL.ridge, "릿지 회귀", P[0].by_h], [COL.cam, "＋하늘 카메라", P[1].by_h], [COL.att, "＋주의집중", P[2].by_h]], bk, 5, "오차 (%)"),
  load_h: bars("부하 예측 오차 — 선행시간 구간별", `시험 ${D.data.test_days}일 · ${D.data.issues}회 발행 · 평균 부하(${D.data.mean_load} kW) 대비 평균 절대 오차(%)`, [[COL.base, "전일 같은 시각", D.load.base_by_h], [COL.ridge, "릿지 회귀", D.load.by_h]], bk, 5, "오차 (%)"),
  fc_pv: fc("태양광 24시간 예측의 한 예", D.sample.pv, COL.att, "출력 (kW)"), fc_load: fc("부하 24시간 예측의 한 예", D.sample.load, COL.ridge, "부하 (kW)"),
  att_w: frame("주의집중 가중치 분포 — 한 번의 예측", `${D.sample.pv.issued} 발행 · 가중치 큰 순 40건 · 위 10건의 합 ${D.sample.top10_share}% · 유효 기억 수 1/Σw² = ${D.sample.eff_n}`, Math.ceil(D.sample.weights[0] * 1.2 * 10) / 10, 4, "기억 순위(가중치 큰 순)", "가중치 wᵢ (%)",
    Y => D.sample.weights.map((w, i) => `<rect x="${M.l + 8 + i * ((W - M.l - M.r - 16) / 40)}" y="${Y(w)}" width="${(W - M.l - M.r - 16) / 40 - 5}" height="${Y(0) - Y(w)}" rx="3" fill="${COL.att}"/>`).join("") + [1, 10, 20, 30, 40].map(k => `<text x="${M.l + 8 + (k - .5) * ((W - M.l - M.r - 16) / 40)}" y="${H - M.b + 24}" text-anchor="middle" font-size="16" fill="${COL.ink}">${k}</text>`).join(""), [[COL.att, "가중치 wᵢ"]]) };
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: W, height: H } });
  for (const [k, svg] of Object.entries(out)) { await p.setContent(`<body style="margin:0">${svg}</body>`); await p.screenshot({ path: path.join(__dirname, "img", `aich_${k}.png`) }); console.log(k); }
  await b.close(); })();
