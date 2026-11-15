/* 작전지 전개 현황(배치도 위 실시간 상태), 장비 사진 카드, 발전원 구성 도넛, 경보 매트릭스 */
"use strict";
const EQ_KIND = { PV: "PV", DG: "DG", G1: "DG", FC: "FC", ESS: "ESS", MTR: "DIST", DIST: "DIST", EMS: "EMS", L1: "L1", L2: "L2", L3: "L3" };
const SITE_PTS = [
  { id: "G1", no: "①", nm: "기동형 복합전력(디젤)" }, { id: "ESS", no: "②", nm: "이동형 ESS(GFM)" }, { id: "PV", no: "③", nm: "이동형 PV 발전" },
  { id: "FC", no: "④", nm: "수소생성·발전" }, { id: "DIST", no: "⑥", nm: "배전·변압" }, { id: "EMS", no: "⑤", nm: "EMS 중앙제어", left: true },
  { id: "L1", no: "", nm: "1등급 · 지휘통제" }, { id: "L2", no: "", nm: "2등급 · 의무" }, { id: "L3", no: "", nm: "3등급 · 탄약저장", left: true },
];
function siteHtml() {
  const pos = id => { const e = MAP_EQ.find(q => q.id === id); const [Lx, Ly, Lz] = ISO_EXT[e.kind]; return [e.c[0] / MAP_W * 100, Math.max(15, (e.c[1] - ((Lx + Ly) * ISO_S / 2 + Lz) * MAP_S * .9) / MAP_H * 100)]; };
  return `<div class="site"><div id="siteMap"></div><div class="site-shade"></div>
    ${SITE_PTS.map(p => { const [x, y] = pos(p.id); return `<div class="spt ${p.left ? "l" : ""}" onclick="location.hash='#control'" id="spt-${p.id}" style="left:${x}%;top:${y}%"><i class="pulse"></i><i class="core"></i>
      <div class="scard"><div class="sh"><b>${p.no}</b> ${p.nm}</div><div class="sv"><span class="mono" id="sptv-${p.id}">—</span><span class="ss" id="spts-${p.id}">—</span></div></div></div>`; }).join("")}
    <div class="site-leg"><span><i class="ok"></i>운전·급전</span><span><i class="idle"></i>정지·대기</span><span><i class="bad"></i>고장·두절</span><span><b class="lg on"></b>전력(AC)</span><span><b class="lg com"></b>통신(EMS)</span></div></div>`;
}
function siteState(s) {
  const k = s.kpi, D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? 1) : 1;
  const lost = n => D[n] && D[n].link === "두절";
  const r = (st, v, t) => ({ st, v, t });
  const out = {
    G1: cb("G1") === 2 || cb("DG") === 2 ? r("bad", `DG ${F.kw(k.dg)} kW`, "차단기 트립") : lost("DG") ? r("bad", "####", "통신 두절")
      : r(D.DG.on ? "ok" : "ok", D.DG.on ? `DG ${F.kw(k.dg)} kW` : "계통 형성 100 kW", D.DG.on ? "디젤 운전" : "계통 형성"),
    ESS: cb("ESS") === 2 ? r("bad", "0 kW", "트립") : lost("ESS") ? r("bad", "####", "통신 두절") : r(Math.abs(k.ess) > 0.5 ? "ok" : "idle", `${k.ess < 0 ? "▲" : "▼"} ${F.kw(Math.abs(k.ess))} kW · ${F.n(k.soc, 0)}%`, k.ess < -0.5 ? "충전" : k.ess > 0.5 ? "방전" : "대기"),
    PV: cb("PV") === 2 ? r("bad", "0 kW", "트립") : r(k.pv > 0.5 ? "ok" : "idle", `${F.kw(k.pv)} kW`, k.pv > 0.5 ? "발전" : "발전 없음"),
    FC: cb("FC") === 2 ? r("bad", "0 kW", "트립") : lost("FC") ? r("bad", "####", "통신 두절") : r(D.FC.on ? "ok" : "idle", `${F.kw(k.fc)} kW · H₂ ${F.n(k.h2, 0)}`, D.FC.on ? "운전" : "정지"),
    DIST: !gw ? r("bad", "####", "게이트웨이 두절") : r((val("BUS.a_v") || 0) > 300 && (val("BUS.b_v") || 0) > 300 ? "ok" : "bad", `${F.n(val("BUS.a_v"), 0)} V · ${F.n(val("BUS.hz"), 2)} Hz`, cb("TIE") === 1 ? "모선 연계" : "연계 개방"),
    EMS: r(s.alarm_cnt[1].act ? "bad" : "ok", `${s.auto ? "AUTO" : "MANUAL"} · ${F.n(s.stats.last_ms, 0)} ms`, s.alarm_cnt[1].act ? `긴급 경보 ${s.alarm_cnt[1].act}` : "정상"),
  };
  ["L1", "L2", "L3"].forEach((f, i) => { const kw = [k.l1, k.l2, k.l3][i], c = cb(f); out[f] = c === 2 ? r("bad", "0 kW", "트립 · 정전") : c === 0 ? r("idle", "0 kW", "개방") : r("ok", `${F.kw(kw)} kW`, "급전 중"); });
  return out;
}
function siteUpdate(s) {
  const st = siteState(s), box = $("#siteMap");
  if (box) {
    const sig = JSON.stringify(MAP_EQ.map(e => mapEqSt(s, e.id)).map(o => [o.on, o.lost, Math.round((o.soc || 0) / 5)]));
    if (box.dataset.sig !== sig) { box.dataset.sig = sig; box.innerHTML = siteMapSvg(s); }
    const D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? 1) : 1, k = s.kpi;
    const busLive = (val("BUS.a_v") ?? 440) > 300 || (val("BUS.b_v") ?? 440) > 300;
    const flow = { G1: D.DG.on ? k.dg : 0, ESS: Math.abs(k.ess), PV: k.pv, FC: k.fc, L1: k.l1, L2: k.l2, L3: k.l3, RING: k.load, EMSP: 1 };
    MAP_CAB.forEach(([a, b, f], i) => {
      const e = document.getElementById("mf-" + i); if (!e) return; const c = ["RING", "EMSP"].includes(f) ? 1 : cb(f);
      const cls = c === 2 ? "flt" : c === 0 || !busLive ? "off" : (flow[f] || 0) > .5 ? "on" : "idle";
      e.setAttribute("class", "mflow " + cls); e.style.animationDirection = f === "ESS" && k.ess < 0 ? "reverse" : "normal";
      e.style.animationDuration = Math.max(.6, 2.4 - Math.min(1, (flow[f] || 0) / 150) * 1.8) + "s";
      const x = document.getElementById("mx-" + i); if (x) x.style.display = c === 2 ? "" : "none";
    });
  }
  SITE_PTS.forEach(p => { const e = $("#spt-" + p.id); if (!e) return; const x = st[p.id]; e.className = `spt ${p.left ? "l" : ""} ${x.st}`; $("#sptv-" + p.id).textContent = x.v; $("#spts-" + p.id).textContent = x.t; });
}

/* 장비 카드: 자체 벡터 일러스트 + 상태 띠 */
function equipPhoto(kind, st = {}) {
  const cls = st.lost || st.fault ? "bad" : st.on ? "ok" : "idle";
  const tag = st.lost ? "COMM LOSS" : st.fault ? "FAULT" : st.on ? "RUNNING" : "STANDBY";
  return `<div class="eqph ${cls}">${isoArt(EQ_KIND[kind] || "DIST", st, 400, 250)}<span class="eqtag"><i></i>${tag}</span>${st.value !== undefined && st.value !== null && st.value !== "" ? `<span class="eqval mono">${st.value}</span>` : ""}</div>`;
}
/* 도넛(발전원 구성) */
function mixDonut(parts, total, size = 148) {
  const r = size / 2 - 12, c = 2 * Math.PI * r, sum = parts.reduce((a, p) => a + p[1], 0); let off = 0;
  const segs = sum > 0 ? parts.filter(p => p[1] > 0).map(([n, v, col]) => { const len = v / sum * c, gap = Math.min(3, len / 3); const sg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return sg; }).join("") : "";
  return `<svg width="${size}" height="${size}" class="donut"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(var(--edge),.08)" stroke-width="14"/>${segs}
    <text x="50%" y="47%" text-anchor="middle" class="dv">${F.n(total, 0)}</text><text x="50%" y="62%" text-anchor="middle" class="du">kW 발전</text></svg>`;
}

/* 경보 매트릭스(장비 × 우선순위) */
const MTX_ROWS = [["DG", ["DG", "CB-DG"]], ["FC", ["FC", "CB-FC"]], ["ESS", ["ESS", "CB-ESS"]], ["PV·계측", ["MTR", "CB-PV", "PV"]], ["모선·배전", ["BUS-A", "BUS-B", "CB-TIE", "CB-G1"]], ["부하", ["CB-L1", "CB-L2", "CB-L3"]], ["EMS", ["EMS"]]];
function alarmMatrix(alarms) {
  const cnt = MTX_ROWS.map(([, srcs]) => [1, 2, 3, 4].map(p => alarms.filter(a => a.prio === p && srcs.includes(a.src) && (a.state === "ACT" || !a.acked)).length));
  return `<div class="mtx"><span></span>${[1, 2, 3, 4].map(p => `<span class="mh">${prioTxt(p)}</span>`).join("")}
    ${MTX_ROWS.map(([nm], i) => `<span class="mr">${nm}</span>${cnt[i].map((n, j) => `<span class="mc ${n ? "p" + (j + 1) : ""}">${n}</span>`).join("")}`).join("")}</div>`;
}

/* 작전지 전개 배치도(자체 생성 벡터): 산악 배경 · 자갈 지면 · 장비 · 환상 배전 케이블(흐름·고장) · FSU · 통신선 */
const MAP_W = 1600, MAP_H = 900, MAP_S = 21, MAP_O = [800, 150];
const _mapI = new Iso(MAP_O[0], MAP_O[1], MAP_S);
function mapWorld(X, Y) { const a = (X - MAP_O[0]) / (ISO_C * MAP_S), b = (Y - MAP_O[1]) / (ISO_S * MAP_S); return [(a + b) / 2, (b - a) / 2]; }
// 장비 배치(화면 중심 좌표) — 제안서 배치 개념(전원 후열, 배전 중앙, EMS 측방, 부하 전열)을 참고해 재구성
const MAP_EQ = [
  { id: "G1", kind: "DG", c: [230, 330] }, { id: "ESS", kind: "ESS", c: [500, 300] }, { id: "PV", kind: "PV", c: [850, 225] },
  { id: "FC", kind: "FC", c: [1250, 300] }, { id: "DIST", kind: "DIST", c: [810, 500] }, { id: "EMS", kind: "EMS", c: [1400, 540] },
  { id: "L1", kind: "L1", c: [230, 740] }, { id: "L2", kind: "L2", c: [780, 820] }, { id: "L3", kind: "L3", c: [1380, 770] },
];
const MAP_FSU = [[400, 450], [630, 420], [1020, 410], [1180, 460], [500, 630], [800, 670], [1130, 640]];
// 케이블: [시작, 끝, 급전선]
const MAP_CAB = [
  [[230, 370], [400, 450], "G1"], [[500, 340], [630, 420], "ESS"], [[850, 330], [1020, 410], "PV"], [[1250, 345], [1180, 460], "FC"],
  [[400, 450], [630, 420], "RING"], [[630, 420], [810, 500], "RING"], [[810, 500], [1020, 410], "RING"], [[1020, 410], [1180, 460], "RING"],
  [[1180, 460], [1130, 640], "RING"], [[1130, 640], [800, 670], "RING"], [[800, 670], [500, 630], "RING"], [[500, 630], [400, 450], "RING"], [[810, 500], [800, 670], "RING"],
  [[500, 630], [240, 730], "L1"], [[800, 670], [780, 800], "L2"], [[1130, 640], [1370, 760], "L3"], [[1180, 460], [1390, 530], "EMSP"],
];
function _cabPath([x1, y1], [x2, y2]) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + Math.abs(x2 - x1) * .06; return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`; }
function mapEqSt(s, id) {
  const k = s.kpi, D = s.devices, lost = n => D[n] && D[n].link === "두절";
  return { G1: { on: D.DG.on, lost: lost("DG") }, ESS: { on: true, lost: lost("ESS"), soc: k.soc }, PV: { on: k.pv > .5 }, FC: { on: D.FC.on, lost: lost("FC") },
    DIST: { on: true, lost: lost("MTR") }, EMS: { on: true }, L1: { on: true }, L2: { on: true }, L3: { on: true } }[id] || {};
}
function siteMapSvg(s) {
  const I = _mapI; let g = "";
  // 하늘·산
  g += `<defs><linearGradient id="mSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26301f"/><stop offset="1" stop-color="#11150d"/></linearGradient>
    <linearGradient id="mM1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4630"/><stop offset="1" stop-color="#1f2618"/></linearGradient>
    <linearGradient id="mM2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3624"/><stop offset="1" stop-color="#161b11"/></linearGradient>
    <radialGradient id="mGnd" cx="50%" cy="55%" r="70%"><stop offset="0" stop-color="#4a4b40"/><stop offset=".7" stop-color="#34362c"/><stop offset="1" stop-color="#22241c"/></radialGradient>
    <pattern id="mGv" patternUnits="userSpaceOnUse" width="22" height="16"><circle cx="3" cy="3" r="1.6" fill="#5c5d50"/><circle cx="14" cy="8" r="1.3" fill="#2b2c25"/><circle cx="8" cy="13" r="1.1" fill="#66675a"/><circle cx="19" cy="14" r="1" fill="#3a3b33"/></pattern>
    <pattern id="mTr" patternUnits="userSpaceOnUse" width="14" height="10"><circle cx="4" cy="5" r="4" fill="#253019"/><circle cx="11" cy="3" r="3.4" fill="#2e3a21"/></pattern>
    <filter id="mBl"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <rect width="${MAP_W}" height="${MAP_H}" fill="url(#mSky)"/>
    <path d="M0 150 L120 95 L260 130 L420 60 L560 115 L700 80 L860 120 L1010 55 L1180 105 L1320 70 L1480 110 L1600 80 L1600 260 L0 260Z" fill="url(#mM2)" opacity=".8"/>
    <path d="M0 210 L160 150 L330 200 L470 140 L640 205 L820 150 L980 210 L1150 150 L1330 205 L1480 160 L1600 190 L1600 330 L0 330Z" fill="url(#mM1)"/>
    <path d="M0 210 L160 150 L330 200 L470 140 L640 205 L820 150 L980 210 L1150 150 L1330 205 L1480 160 L1600 190 L1600 330 L0 330Z" fill="url(#mTr)" opacity=".7"/>`;
  // 지면(등각 판)
  const gp = [[-14, -2], [72, -2], [72, 70], [-14, 70]].map(([x, y]) => I.p(x - 20, y - 20, 0));
  g += `<path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGnd)"/><path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGv)" opacity=".55"/>`;
  // 케이블(바닥) — 통신선 먼저
  MAP_EQ.filter(e => ["G1", "ESS", "PV", "FC", "DIST"].includes(e.id)).forEach(e => { g += `<path d="${_cabPath([1400, 520], [e.c[0], e.c[1] + 20])}" class="mcom" fill="none"/>`; });
  MAP_CAB.forEach(([a, b, f], i) => { const d = _cabPath(a, b); g += `<path d="${d}" class="mcab" fill="none"/><path d="${d}" class="mflow" id="mf-${i}" data-f="${f}" fill="none"/>`; });
  // FSU + 장비(뒤 → 앞)
  const items = MAP_FSU.map((c, i) => ({ id: "FSU" + i, kind: "FSU", c, fsu: true })).concat(MAP_EQ).sort((a, b) => a.c[1] - b.c[1]);
  items.forEach(e => {
    const [Lx, Ly] = ISO_EXT[e.kind]; const [wx, wy] = mapWorld(e.c[0], e.c[1]); const [px, py] = I.p(wx - Lx / 2, wy - Ly / 2, 0);
    const st = e.fsu ? { on: true } : mapEqSt(s, e.id);
    g += `<g id="meq-${e.id}" class="meq">${isoPlace(e.kind, st, px, py, MAP_S)}</g>`;
  });
  // 고장 표식 자리
  MAP_CAB.forEach(([a, b, f], i) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + Math.abs(b[0] - a[0]) * .03; g += `<g class="mflt" id="mx-${i}" style="display:none"><circle cx="${mx}" cy="${my}" r="13" fill="#ff5148"/><path d="M${mx - 5} ${my - 5}l10 10M${mx + 5} ${my - 5}l-10 10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g>`; });
  return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sitemap" preserveAspectRatio="xMidYMid slice">${g}</svg>`;
}
