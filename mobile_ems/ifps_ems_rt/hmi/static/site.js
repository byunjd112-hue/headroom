/* 작전지 전개 현황(배치도 위 실시간 상태), 장비 사진 카드, 발전원 구성 도넛, 경보 매트릭스 */
"use strict";
const EQ_KIND = { PV: "PV", DG: "DG", G1: "DG", FC: "FC", ESS: "ESS", MTR: "DIST", DIST: "DIST", EMS: "EMS", L1: "L1", L2: "L2", L3: "L3" };
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
/* 장비 카드: photos/ 폴더에 실사 이미지가 있으면 사진, 없으면 자체 벡터 일러스트 + 상태 띠 */
api("/api/photos").then(r => { S.photos = r.files || []; }).catch(() => { S.photos = []; });
function equipPhoto(kind, st = {}) {
  const cls = st.lost || st.fault ? "bad" : st.on ? "ok" : "idle";
  const tag = st.lost ? "COMM LOSS" : st.fault ? "FAULT" : st.on ? "RUNNING" : "STANDBY";
  const pk = { G1: "dg", DG: "dg", MTR: "dist", FC: "fc" }[kind] || String(kind).toLowerCase(), ph = (S.photos || []).find(f => f.split(".")[0] === pk);
  return `<div class="eqph ${cls} ${ph ? "photo" : ""}">${ph ? `<img src="photos/${ph}" alt="${kind}" loading="lazy">` : isoArt(EQ_KIND[kind] || "DIST", st, 400, 250)}<span class="eqtag"><i></i>${tag}</span>${st.value !== undefined && st.value !== null && st.value !== "" ? `<span class="eqval mono">${st.value}</span>` : ""}</div>`;
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

/* ═══ 작전지 배치(운용자 편집 가능): 장비 대수·막사 수량·위치·연결 급전선. 케이블은 배치에서 자동 생성 ═══ */
const MAP_W = 1600, MAP_H = 900, MAP_S = 21, MAP_O = [800, 150];
const _mapI = new Iso(MAP_O[0], MAP_O[1], MAP_S);
const LB = ["L1", "L2", "L3"];
const LAY_KINDS = {
  DG: { nm: "복합전력(디젤)", bind: "G1", binds: ["G1"] }, ESS: { nm: "이동형 ESS", bind: "ESS", binds: ["ESS"] }, PV: { nm: "이동형 PV", bind: "PV", binds: ["PV"] },
  FC: { nm: "수소생성·발전", bind: "FC", binds: ["FC"] }, DIST: { nm: "배전·변압", bind: "DIST", binds: ["DIST"] }, EMS: { nm: "EMS 쉘터", bind: "EMS", binds: ["EMS"] },
  FSU: { nm: "구간분전함(FSU)", bind: "", binds: [""] }, BARRACK: { nm: "막사", bind: "L2", binds: LB },
  L1: { nm: "지휘통제 천막", bind: "L1", binds: LB }, L2: { nm: "의무 천막", bind: "L2", binds: LB }, L3: { nm: "탄약고", bind: "L3", binds: LB },
};
const BIND_TXT = { G1: "① 복합전력", ESS: "② ESS", PV: "③ PV", FC: "④ 수소", DIST: "⑥ 배전·변압", EMS: "⑤ EMS", L1: "1등급 부하", L2: "2등급 부하", L3: "3등급 부하", "": "—" };
const LAY_DEFAULT = [
  ["DG", "G1", "① 기동형 복합전력", 230, 330], ["ESS", "ESS", "② 이동형 ESS(GFM)", 500, 300], ["PV", "PV", "③ 이동형 PV", 850, 225], ["FC", "FC", "④ 수소생성·발전", 1250, 300],
  ["DIST", "DIST", "⑥ 배전·변압", 810, 500], ["EMS", "EMS", "⑤ EMS 중앙제어", 1400, 540],
  ["L1", "L1", "지휘통제(C2)", 230, 740], ["L2", "L2", "의무시설", 780, 820], ["L3", "L3", "탄약저장", 1380, 770],
  ["BARRACK", "L2", "막사 #1", 1040, 800], ["BARRACK", "L2", "막사 #2", 520, 820],
  ...[[400, 450], [630, 420], [1020, 410], [1180, 460], [500, 630], [800, 670], [1130, 640]].map((c, i) => ["FSU", "", `FSU-${i + 1}`, c[0], c[1]]),
].map(([kind, bind, name, x, y], i) => ({ uid: "d" + i, kind, bind, name, x, y }));
const L = { items: null, rev: 0, edit: false, sel: null, dirty: false, drag: null, loading: false };
const _clone = o => JSON.parse(JSON.stringify(o));
async function layoutLoad() {
  if (L.loading) return; L.loading = true;
  try { const r = await api("/api/layout"); L.items = r.items && r.items.length ? r.items : _clone(LAY_DEFAULT); L.rev = r.rev || 0; L.meta = r.by ? `rev${r.rev} · ${r.by} · ${r.t}` : "기본 배치"; }
  finally { L.loading = false; }
  L.dirty = false; L.sel = null; siteRebuild();
}
function mapWorld(X, Y) { const a = (X - MAP_O[0]) / (ISO_C * MAP_S), b = (Y - MAP_O[1]) / (ISO_S * MAP_S); return [(a + b) / 2, (b - a) / 2]; }
function _cabPath([x1, y1], [x2, y2]) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + Math.abs(x2 - x1) * .06; return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`; }
const _d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/* 배치 → 케이블 자동 생성: FSU 환상망 + 배전반-FSU 2회선 + 장비별 최근접 FSU 인입 */
function layCables(items) {
  const fsu = items.filter(i => i.kind === "FSU"), dist = items.filter(i => i.kind === "DIST"), cab = [];
  const pt = i => [i.x, i.y + (i.kind === "FSU" ? 0 : 18)];
  if (fsu.length >= 2) {
    const cx = fsu.reduce((a, i) => a + i.x, 0) / fsu.length, cy = fsu.reduce((a, i) => a + i.y, 0) / fsu.length;
    const ring = fsu.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    ring.forEach((f, i) => { if (ring.length > 2 || i === 0) cab.push([pt(f), pt(ring[(i + 1) % ring.length]), "RING"]); });
  }
  const hubs = fsu.length ? fsu : dist;
  dist.forEach(d => fsu.slice().sort((a, b) => _d2(a, d) - _d2(b, d)).slice(0, 2).forEach(f => cab.push([pt(d), pt(f), "RING"])));
  items.filter(i => i.kind !== "FSU" && i.kind !== "DIST").forEach(i => {
    if (!hubs.length) return; const h = hubs.slice().sort((a, b) => _d2(a, i) - _d2(b, i))[0];
    cab.push([pt(i), pt(h), i.kind === "EMS" ? "EMSP" : (i.bind || "RING")]);
  });
  return cab;
}
function mapEqSt(s, it) {
  const k = s.kpi, D = s.devices, lost = n => D[n] && D[n].link === "두절", b = it.bind;
  if (it.kind === "FSU") return { on: true };
  return ({ G1: { on: D.DG.on, lost: lost("DG") }, ESS: { on: true, lost: lost("ESS"), soc: Math.round(k.soc / 5) * 5 }, PV: { on: k.pv > .5 }, FC: { on: D.FC.on, lost: lost("FC") },
    DIST: { on: true, lost: lost("MTR") }, EMS: { on: true } })[b] || { on: true };
}
function siteMapSvg(s) {
  const I = _mapI, items = L.items || [], cab = L.cab = layCables(items); let g = "";
  g += `<defs><linearGradient id="mSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26301f"/><stop offset="1" stop-color="#11150d"/></linearGradient>
    <linearGradient id="mM1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4630"/><stop offset="1" stop-color="#1f2618"/></linearGradient>
    <linearGradient id="mM2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3624"/><stop offset="1" stop-color="#161b11"/></linearGradient>
    <radialGradient id="mGnd" cx="50%" cy="55%" r="70%"><stop offset="0" stop-color="#4a4b40"/><stop offset=".7" stop-color="#34362c"/><stop offset="1" stop-color="#22241c"/></radialGradient>
    <pattern id="mGv" patternUnits="userSpaceOnUse" width="22" height="16"><circle cx="3" cy="3" r="1.6" fill="#5c5d50"/><circle cx="14" cy="8" r="1.3" fill="#2b2c25"/><circle cx="8" cy="13" r="1.1" fill="#66675a"/><circle cx="19" cy="14" r="1" fill="#3a3b33"/></pattern>
    <pattern id="mTr" patternUnits="userSpaceOnUse" width="14" height="10"><circle cx="4" cy="5" r="4" fill="#253019"/><circle cx="11" cy="3" r="3.4" fill="#2e3a21"/></pattern>
    <pattern id="mGrid" patternUnits="userSpaceOnUse" width="40" height="40"><path d="M40 0H0V40" fill="none" stroke="#b6d36b" stroke-opacity=".12" stroke-width="1"/></pattern></defs>
    <rect width="${MAP_W}" height="${MAP_H}" fill="url(#mSky)"/>
    <path d="M0 150 L120 95 L260 130 L420 60 L560 115 L700 80 L860 120 L1010 55 L1180 105 L1320 70 L1480 110 L1600 80 L1600 260 L0 260Z" fill="url(#mM2)" opacity=".8"/>
    <path d="M0 210 L160 150 L330 200 L470 140 L640 205 L820 150 L980 210 L1150 150 L1330 205 L1480 160 L1600 190 L1600 330 L0 330Z" fill="url(#mM1)"/>
    <path d="M0 210 L160 150 L330 200 L470 140 L640 205 L820 150 L980 210 L1150 150 L1330 205 L1480 160 L1600 190 L1600 330 L0 330Z" fill="url(#mTr)" opacity=".7"/>
    <path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGnd)"/><path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGv)" opacity=".55"/>
    ${L.edit ? `<path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGrid)"/>` : ""}`;
  const ems = items.find(i => i.kind === "EMS");
  if (ems) items.filter(i => ["DG", "ESS", "PV", "FC", "DIST"].includes(i.kind)).forEach(i => { g += `<path d="${_cabPath([ems.x, ems.y - 20], [i.x, i.y + 20])}" class="mcom" fill="none"/>`; });
  cab.forEach(([a, b, f], i) => { const d = _cabPath(a, b); g += `<path d="${d}" class="mcab" fill="none"/><path d="${d}" class="mflow" id="mf-${i}" fill="none"/>`; });
  items.slice().sort((a, b) => a.y - b.y).forEach(it => {
    const kind = it.kind === "BARRACK" ? "BARRACK" : it.kind, [Lx, Ly] = ISO_EXT[kind] || ISO_EXT.FSU, [wx, wy] = mapWorld(it.x, it.y), [px, py] = I.p(wx - Lx / 2, wy - Ly / 2, 0);
    const sel = L.edit && L.sel === it.uid;
    g += `<g class="meq ${L.edit ? "editable" : ""} ${sel ? "sel" : ""}" data-uid="${it.uid}">${sel ? `<ellipse cx="${it.x}" cy="${it.y}" rx="${(Lx + Ly) * ISO_C * MAP_S * .62}" ry="${(Lx + Ly) * ISO_S * MAP_S * .62}" class="msel"/>` : ""}${isoPlace(kind, mapEqSt(s, it), px, py, MAP_S)}</g>`;
  });
  cab.forEach(([a, b], i) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + Math.abs(b[0] - a[0]) * .03; g += `<g class="mflt" id="mx-${i}" style="display:none"><circle cx="${mx}" cy="${my}" r="13" fill="#ff5148"/><path d="M${mx - 5} ${my - 5}l10 10M${mx + 5} ${my - 5}l-10 10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g>`; });
  return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sitemap ${L.edit ? "editing" : ""}" preserveAspectRatio="xMidYMid slice">${g}</svg>`;
}
function _mkPos(it) { const [Lx, Ly, Lz] = ISO_EXT[it.kind] || ISO_EXT.FSU; return [it.x / MAP_W * 100, Math.max(12, (it.y - ((Lx + Ly) * ISO_S / 2 + Lz) * MAP_S * .9) / MAP_H * 100)]; }
function siteMarkers() {
  const box = $("#siteMk"); if (!box || !L.items) return;
  if (L.edit) { box.innerHTML = ""; return; }
  const seen = {};
  box.innerHTML = L.items.filter(i => i.kind !== "FSU").map(it => {
    const [x, y] = _mkPos(it), mini = it.kind === "BARRACK" || seen[it.bind]; seen[it.bind] = 1;
    return `<div class="spt ${mini ? "mini" : ""}" data-act="goctl" data-uid="${it.uid}" style="left:${x}%;top:${y}%"><i class="pulse"></i><i class="core"></i>
      <div class="scard"><div class="sh">${esc(it.name || LAY_KINDS[it.kind].nm)}</div><div class="sv"><span class="mono">—</span><span class="ss">—</span></div></div></div>`;
  }).join("");
}
function siteRebuild() { const box = $("#siteMap"); if (box && S.snap) { box.dataset.sig = ""; siteUpdate(S.snap, true); } siteMarkers(); layToolbar(); }
function siteHtml() {
  return `<div class="site" id="siteBox"><div id="siteMap"></div><div class="site-shade"></div><div id="siteMk"></div>
    <div class="site-leg"><span><i class="ok"></i>운전·급전</span><span><i class="idle"></i>정지·대기</span><span><i class="bad"></i>고장·두절</span><span><b class="lg on"></b>전력(AC)</span><span><b class="lg com"></b>통신(EMS)</span></div></div>
    <div id="layBar"></div>`;
}
function siteUpdate(s, force) {
  if (!L.items) { if (!L.loading) layoutLoad(); return; }
  const st = siteState(s), box = $("#siteMap");
  if (box && !L.drag) {
    const sig = JSON.stringify([L.edit, L.sel, L.items, L.items.map(i => mapEqSt(s, i))]);
    if (force || box.dataset.sig !== sig) { box.dataset.sig = sig; box.innerHTML = siteMapSvg(s); layBindDrag(); }
    const D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? 1) : 1, k = s.kpi;
    const busLive = (val("BUS.a_v") ?? 440) > 300 || (val("BUS.b_v") ?? 440) > 300;
    const flow = { G1: D.DG.on ? k.dg : 0, ESS: Math.abs(k.ess), PV: k.pv, FC: k.fc, L1: k.l1, L2: k.l2, L3: k.l3, RING: k.load, EMSP: 1, DIST: k.load, EMS: 1 };
    (L.cab || []).forEach(([a, b, f], i) => {
      const e = document.getElementById("mf-" + i); if (!e) return; const c = ["RING", "EMSP", "DIST", "EMS", ""].includes(f) ? 1 : cb(f);
      const cls = c === 2 ? "flt" : c === 0 || !busLive ? "off" : (flow[f] || 0) > .5 ? "on" : "idle";
      e.setAttribute("class", "mflow " + cls); e.style.animationDirection = f === "ESS" && k.ess < 0 ? "reverse" : "normal";
      e.style.animationDuration = Math.max(.6, 2.4 - Math.min(1, (flow[f] || 0) / 150) * 1.8) + "s";
      const x = document.getElementById("mx-" + i); if (x) x.style.display = c === 2 ? "" : "none";
    });
  }
  $$("#siteMk .spt").forEach(e => { const it = L.items.find(i => i.uid === e.dataset.uid); if (!it) return; const x = st[it.bind] || { st: "ok", v: "", t: "" };
    e.className = `spt ${e.classList.contains("mini") ? "mini" : ""} ${x.st}`; e.querySelector(".sv .mono").textContent = x.v; e.querySelector(".ss").textContent = x.t; });
  const sum = $("#layCnt"); if (sum) { const c = k => L.items.filter(i => i.kind === k).length; sum.textContent = `장비 ${L.items.filter(i => !["FSU", "BARRACK", "L1", "L2", "L3"].includes(i.kind)).length} · 막사 ${c("BARRACK")} · 시설 ${c("L1") + c("L2") + c("L3")} · FSU ${c("FSU")}`; }
}

/* ── 편집: 선택·끌기·추가·복제·삭제·저장 */
function _svgPt(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
function layBindDrag() {
  const svg = $("#siteMap svg"); if (!svg || !L.edit) return;
  svg.onpointerdown = e => {
    const g = e.target.closest(".meq"); if (!g) { L.sel = null; siteRebuild(); return; }
    const it = L.items.find(i => i.uid === g.dataset.uid); if (!it) return;
    L.sel = it.uid; layToolbar();
    const p0 = _svgPt(svg, e); L.drag = { it, g: svg.querySelector(`.meq[data-uid="${it.uid}"]`), p0, x0: it.x, y0: it.y }; svg.setPointerCapture(e.pointerId); e.preventDefault();
  };
  svg.onpointermove = e => { if (!L.drag) return; const p = _svgPt(svg, e), d = L.drag; const nx = Math.max(40, Math.min(1560, d.x0 + p.x - d.p0.x)), ny = Math.max(285, Math.min(880, d.y0 + p.y - d.p0.y));
    d.g.setAttribute("transform", `translate(${nx - d.x0} ${ny - d.y0})`); d.nx = nx; d.ny = ny; };
  svg.onpointerup = () => { const d = L.drag; if (!d) return; L.drag = null; if (d.nx !== undefined) { d.it.x = Math.round(d.nx); d.it.y = Math.round(d.ny); L.dirty = true; } siteRebuild(); };
}
function layToolbar() {
  const bar = $("#layBar"), btn = $("#layEditBtn"); if (btn) btn.textContent = L.edit ? "편집 종료" : "배치 편집";
  if (!bar) return; if (!L.edit) { bar.innerHTML = ""; return; }
  const it = L.items.find(i => i.uid === L.sel), kinds = Object.entries(LAY_KINDS);
  bar.innerHTML = `<div class="laybar">
    <div class="grp"><span class="lab">추가</span><select class="in" id="layKind">${kinds.map(([k, v]) => `<option value="${k}">${v.nm}</option>`).join("")}</select><button class="btn sm pri" id="layAdd">＋ 추가</button></div>
    <div class="grp">${it ? `<span class="lab">선택</span><input class="in" id="layName" value="${esc(it.name || "")}" maxlength="24" style="width:150px">
      <select class="in" id="layBind" ${LAY_KINDS[it.kind].binds.length < 2 ? "disabled" : ""}>${LAY_KINDS[it.kind].binds.map(b => `<option value="${b}" ${b === it.bind ? "selected" : ""}>${BIND_TXT[b]}</option>`).join("")}</select>
      <button class="btn sm" id="layDup">복제</button><button class="btn sm stop" id="layDel">삭제</button>` : `<span class="muted">장비를 누르면 선택, 선택한 장비를 끌면 이동</span>`}</div>
    <div class="grp end"><span class="muted" style="font-size:11.5px">${L.dirty ? "● 저장 안 된 변경" : esc(L.meta || "")}</span><button class="btn sm" id="layReset">기본값</button><button class="btn sm" id="layCancel">취소</button><button class="btn sm go" id="laySave">저장</button></div></div>`;
  $("#layAdd").onclick = () => { const k = $("#layKind").value, n = L.items.filter(i => i.kind === k).length + 1;
    const uid = "u" + Date.now().toString(36); L.items.push({ uid, kind: k, bind: LAY_KINDS[k].bind, name: `${LAY_KINDS[k].nm} #${n}`, x: 300 + (L.items.length * 97) % 1000, y: 700 + (L.items.length % 3) * 45 }); L.sel = uid; L.dirty = true; siteRebuild(); };
  if (it) {
    $("#layName").onchange = e => { it.name = e.target.value.trim(); L.dirty = true; layToolbar(); };
    $("#layBind").onchange = e => { it.bind = e.target.value; L.dirty = true; siteRebuild(); };
    $("#layDup").onclick = () => { const c = Object.assign({}, it, { uid: "u" + Date.now().toString(36), name: (it.name || "") + " 복제", x: Math.min(1560, it.x + 60), y: Math.min(880, it.y + 30) }); L.items.push(c); L.sel = c.uid; L.dirty = true; siteRebuild(); };
    $("#layDel").onclick = () => layDelete();
  }
  $("#layCancel").onclick = () => { L.edit = false; layoutLoad(); };
  $("#layReset").onclick = async () => { if (!confirm("기본 배치로 되돌립니까? (현재 저장본은 백업됩니다)")) return; const r = await api("/api/layout/reset", {}); if (r.ok) { toast("기본 배치 복원", "ok"); L.edit = false; layoutLoad(); } };
  $("#laySave").onclick = async () => { const r = await api("/api/layout", { items: L.items }); if (r.ok) { toast(`배치 저장 rev${r.rev} — 감사 기록됨`, "ok"); L.edit = false; layoutLoad(); } else toast(r.why || "저장 실패", "bad"); };
}
function layDelete() {
  const it = L.items.find(i => i.uid === L.sel); if (!it) return;
  if (["DIST", "EMS"].includes(it.kind) && L.items.filter(i => i.kind === it.kind).length === 1 && !confirm(`마지막 ${LAY_KINDS[it.kind].nm}입니다. 삭제합니까?`)) return;
  L.items = L.items.filter(i => i.uid !== it.uid); L.sel = null; L.dirty = true; siteRebuild();
}
function layToggleEdit() {
  if (!can("operator")) return loginDialog();
  if (L.edit && L.dirty && !confirm("저장하지 않은 변경을 버리고 편집을 끝냅니까?")) return;
  if (L.edit) { L.edit = false; layoutLoad(); return; }
  L.edit = true; L.sel = null; siteRebuild();
}
document.addEventListener("keydown", e => { if (L.edit && L.sel && (e.key === "Delete" || e.key === "Backspace") && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); layDelete(); } });
