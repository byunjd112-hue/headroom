/* 작전지 전개 현황(배치도 위 실시간 상태), 장비 사진 카드, 발전원 구성 도넛, 경보 매트릭스 */
"use strict";
const EQ_KIND = { GDG: "DG", GRID: "DIST", ELZ: "FC", PV: "PV", DG: "DG", G1: "DG", FC: "FC", ESS: "ESS", MTR: "DIST", DIST: "DIST", EMS: "EMS", L1: "L1", L2: "L2", L3: "L3" };
function siteState(s) {
  const k = s.kpi, D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? 1) : 1;
  const lost = n => kLost(n);
  const r = (st, v, t) => ({ st, v, t });
  const gone = n => kAbsent(n) ? r("idle", "—", "미설치") : r("bad", "####", "통신 두절");          // 켠 뒤 한 번도 응답하지 않은 장치는 설치되지 않은 것으로 본다(자동 인식)
  const out = {
    G1: cb("G1") === 2 || cb("DG") === 2 ? r("bad", `DG ${F.kw(k.dg)} kW`, "차단기 트립") : lost("DG") ? gone("DG")
      : r("ok", kOn("DG") ? `DG ${F.kw(k.dg)} kW` : "계통 형성 100 kW", kOn("DG") ? "디젤 운전" : "계통 형성"),
    ESS: cb("ESS") === 2 ? r("bad", "0 kW", "트립") : lost("ESS") ? gone("ESS") : r(Math.abs(k.ess) > 0.5 ? "ok" : "idle", `${k.ess < 0 ? "▲" : "▼"} ${F.kw(Math.abs(k.ess))} kW · ${F.n(k.soc, 0)}%`, k.ess < -0.5 ? "충전" : k.ess > 0.5 ? "방전" : "대기"),
    PV: !gw ? r("bad", "####", "게이트웨이 두절") : cb("PV") === 2 ? r("bad", "0 kW", "트립") : r(k.pv > 0.5 ? "ok" : "idle", `${F.kw(k.pv)} kW`, k.pv > 0.5 ? "발전" : "발전 없음"),
    FC: cb("FC") === 2 ? r("bad", "0 kW", "트립") : lost("FC") ? gone("FC") : r(kOn("FC") ? "ok" : "idle", `${F.kw(k.fc)} kW · H₂ ${F.n(k.h2, 0)}`, kOn("FC") ? "운전" : "정지"),
    DIST: !gw ? r("bad", "####", "게이트웨이 두절") : r((val("BUS.a_v") || 0) > 300 && (val("BUS.b_v") || 0) > 300 ? "ok" : "bad", `${F.n(val("BUS.a_v"), 0)} V · ${F.n(val("BUS.hz"), 2)} Hz`, cb("TIE") === 1 ? "모선 연계" : "연계 개방"),
    EMS: r(s.alarm_cnt[1].act ? "bad" : "ok", `${s.auto ? "AUTO" : "MANUAL"} · ${F.n(s.stats.last_ms, 0)} ms`, s.alarm_cnt[1].act ? `긴급 경보 ${s.alarm_cnt[1].act}` : "정상"),
  };
  [["G1", "DG"], ["ESS", "ESS"], ["PV", "PV"], ["FC", "FC"]].forEach(([b, kd]) => { if (out[b].st !== "bad" && out[b].t !== "미설치") out[b].t += kCnt(kd); });       // 같은 종류 여러 대면 대수를 붙인다
  ["L1", "L2", "L3"].forEach((f, i) => { const kw = [k.l1, k.l2, k.l3][i], c = cb(f); out[f] = !gw ? r("bad", "####", "게이트웨이 두절") : c === 2 ? r("bad", "0 kW", "트립 · 정전") : c === 0 ? r("idle", "0 kW", "개방") : r("ok", `${F.kw(kw)} kW`, "급전 중"); });
  return out;
}
/* 장비 카드: photos/ 폴더에 실사 이미지가 있으면 사진, 없으면 자체 벡터 일러스트 + 상태 띠 */
api("/api/photos").then(r => { S.photos = r.files || []; S.sprites = r.sprite_meta || {}; const b = $("#siteMap"); if (b) b.dataset.sig = ""; document.querySelectorAll("[id^=art-]").forEach(g => g.dataset.sig = ""); }).catch(() => { S.photos = []; S.sprites = {}; });
const SPR_KEY = { GDG: "gdg", GRID: "dist", DG: "dg", G1: "dg", ESS: "ess", PV: "pv", FC: "fc", DIST: "dist", MTR: "dist", EMS: "ems", FSU: "fsu", L1: "l1", L2: "l2", L3: "l3", BARRACK: "barrack" };
/* 실사 스프라이트(투명 배경). 상태: 정지 → 채도·밝기 낮춤, 고장·두절 → 적색 착색 */
function spriteSvg(kind, st, cx, by, w) {
  const k = SPR_KEY[kind], m = S.sprites && S.sprites[k]; if (!m) return null;
  const h = w * m.h / m.w, f = st.lost || st.fault ? "url(#spBad)" : st.on === false ? "url(#spOff)" : "";
  return `<image href="sprites/${m.file}" x="${(cx - w / 2).toFixed(1)}" y="${(by - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMax meet" ${f ? `filter="${f}"` : ""}/>`;
}
const SPRITE_FILTERS = `<filter id="spOff"><feColorMatrix type="saturate" values=".25"/><feComponentTransfer><feFuncR type="linear" slope=".7"/><feFuncG type="linear" slope=".7"/><feFuncB type="linear" slope=".7"/></feComponentTransfer></filter>
  <filter id="spBad"><feColorMatrix type="matrix" values=".6 .3 .1 0 .18  .15 .3 .05 0 0  .15 .2 .05 0 0  0 0 0 1 0"/></filter>`;
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
const MTX_ROWS = [["DG", ["DG", "CB-DG"]], ["FC·수전해", ["FC", "CB-FC", "ELZ"]], ["ESS", ["ESS", "CB-ESS"]], ["PV·계측", ["MTR", "CB-PV", "PV"]], ["모선·배전", ["BUS-A", "BUS-B", "CB-TIE", "CB-G1"]], ["부하", ["CB-L1", "CB-L2", "CB-L3"]], ["EMS·기타", ["EMS"]]];
const MTX_KNOWN = new Set(MTX_ROWS.flatMap(r => r[1]));
function alarmMatrix(alarms) {
  const cnt = MTX_ROWS.map(([, srcs]) => [1, 2, 3, 4].map(p => alarms.filter(a => a.prio === p && (srcs.includes(a.src) || (srcs[0] === "EMS" && !MTX_KNOWN.has(a.src))) && (a.state === "ACT" || !a.acked)).length));   // 표에 없는 출처는 마지막 줄에 모은다(머리줄 합계와 일치)
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
/* 환망을 감시 중이면 그 순서대로 잇는다: 배전 → 첫 구간분전함(구간 0) → … → 마지막 → 배전(구간 n). 케이블 꼬리표 RS<n> 이 구간 번호다 */
const _fsuNo = it => { if (it.rid !== undefined) return it.rid; const m = /(\d+)/.exec(it.name || ""); return m ? "FSU" + m[1] : ""; };      // 그 구간분전함 그림이 환망의 어느 자리인지
/* 배치도의 구간분전함 그림을 환망 순서에 맞춘다: 놓인 자리를 따라 한 바퀴(가운데에서 본 방향 순) 돌면서 첫째 · 둘째 … 로 삼는다 — 그래야 이웃끼리 이어지고 선이 가로지르지 않는다. 환망보다 그림이 많으면 남는 것은 뺀다 */
function fsuRing(items) {
  const r = S.snap && S.snap.ring, fsu = items.filter(i => i.kind === "FSU"); if (!r || !fsu.length) return null;
  const cx = fsu.reduce((a, i) => a + i.x, 0) / fsu.length, cy = fsu.reduce((a, i) => a + i.y, 0) / fsu.length, ord = fsu.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)), m = new Map();
  ord.forEach((it, k) => m.set(it.uid, k < r.fsu.length ? r.fsu[k].id : null)); return m;
}
function ringCables(fsu, dist, pt) {
  const r = S.snap && S.snap.ring; if (!r || !dist.length || L.edit) return null;
  const by = {}; fsu.forEach(i => { by[_fsuNo(i)] = i; }); const seq = r.fsu.map(f => by[f.id]); if (!seq.length || seq.some(x => !x)) return null;
  const d = dist[0], out = [[pt(d), pt(seq[0]), "RS0"]];
  seq.forEach((f, k) => out.push(k + 1 < seq.length ? [pt(f), pt(seq[k + 1]), "RS" + (k + 1)] : [pt(f), pt(d), "RS" + seq.length]));
  return out;
}
function layCables(items) {
  const fsu = items.filter(i => i.kind === "FSU"), dist = items.filter(i => i.kind === "DIST"), cab = [];
  const pt = i => [i.x, i.y + (i.kind === "FSU" ? 0 : 18)], ring = ringCables(fsu, dist, pt);
  if (ring) cab.push(...ring);
  else if (fsu.length >= 2) {
    const cx = fsu.reduce((a, i) => a + i.x, 0) / fsu.length, cy = fsu.reduce((a, i) => a + i.y, 0) / fsu.length;
    const ring = fsu.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    ring.forEach((f, i) => { if (ring.length > 2 || i === 0) cab.push([pt(f), pt(ring[(i + 1) % ring.length]), "RING"]); });
  }
  const hubs = fsu.length ? fsu : dist;
  if (!ring) dist.forEach(d => fsu.slice().sort((a, b) => _d2(a, d) - _d2(b, d)).slice(0, 2).forEach(f => cab.push([pt(d), pt(f), "RING"])));
  items.filter(i => i.kind !== "FSU" && i.kind !== "DIST").forEach(i => {
    if (!hubs.length) return; const src = ring && dist.length && ["DG", "ESS", "PV", "FC", "EMS"].includes(i.kind);      // 환망을 감시 중이면 결선도와 같게: 발전 장비 · EMS 는 배전 · 변압(모선)으로, 부하 시설은 가까운 구간분전함으로
    const h = (src ? dist : hubs).slice().sort((a, b) => _d2(a, i) - _d2(b, i))[0];
    cab.push([pt(i), pt(h), i.kind === "EMS" ? "EMSP" : (i.bind || "RING")]);
  });
  return cab;
}
/* 자동 인식한 대수대로 배치도를 다시 짠다(편집 중에는 저장된 배치 그대로): 같은 종류가 더 있으면 첫 장비 옆에 덧그리고, 없는 종류는 한 대만 흐리게 두며, 빈 자리의 구간분전함은 뺀다 */
const LAY_FLEET = { DG: "DG", ESS: "ESS", PV: "PV", FC: "FC" };
/* 같은 종류가 여러 대면: 그림을 대수에 맞춰 줄이고(layScale), 자리를 정해 두지 않은 장치는 첫 장비 뒤로 비스듬히 겹쳐 세운다(layStack).
   흩어 놓으면 다른 장비 · 구간분전함과 겹치고 선이 엉키므로, 한 무리로 모아 배치도의 균형을 지킨다. 자리를 따로 정하려면 [배치 편집]에서 끌어 옮겨 저장한다 */
const LAY_STEP = { PV: [62, -30], DG: [44, -24], ESS: [46, -24], FC: [48, -25] };
const layScale = n => n <= 1 ? 1 : Math.max(.58, 1 - .11 * (n - 1));
function layStack(it, j, sc) { const [dx, dy] = LAY_STEP[it.kind] || [44, -24]; return [Math.min(1540, it.x + dx * sc * j), Math.max(215, it.y + dy * sc * j)]; }
/* 배치 편집에 들어갈 때: 자동으로 놓인 장치를 실제 항목으로 넣어 끌어 옮길 수 있게 한다(저장하면 그 자리가 기억된다) */
function layAdopt() {
  const add = layAuto(L.items).filter(i => String(i.uid).startsWith("auto-")).map((i, k) => ({ uid: "u" + Date.now().toString(36) + k, kind: i.kind, bind: i.bind, name: i.name, x: Math.round(i.x), y: Math.round(i.y) }));
  if (add.length) { L.items = L.items.concat(add); L.dirty = true; toast(`자동으로 놓인 장비 ${add.length}대를 편집 목록에 넣었습니다 — 옮긴 뒤 저장하면 그 자리가 기억됩니다`, "ok"); }
}
function layAuto(items) {
  const fl = S.snap && S.snap.fleet; if (L.edit || !fl) return items; const out = [], cnt = {}, first = {}, rmap = fsuRing(items);
  items.forEach(it => { const kd = LAY_FLEET[it.kind], f = kd && fl[kd];
    if (it.kind === "FSU") { if (!rmap) out.push(it); else if (rmap.get(it.uid)) out.push(Object.assign({}, it, { rid: rmap.get(it.uid) })); return; }
    if (!f) { out.push(it); return; }
    const i = cnt[kd] = (cnt[kd] || 0) + 1; first[kd] = first[kd] || it;
    if (i <= Math.max(1, f.units.length)) out.push(Object.assign({}, it, { unit: (f.units[i - 1] || {}).id, absent: !f.units.length }));
    else out.push(Object.assign({}, it, { absent: true, spare: true })); });      // 배치 편집으로 미리 놓아 둔 자리: 흐리게 두었다가 그 장치가 인식되면 켜진다(저장한 배치가 사라져 보이지 않게)
  Object.keys(first).forEach(kd => { const f = fl[kd], it = first[kd];
    const sc = layScale(f.units.length);
    for (let i = cnt[kd]; i < f.units.length; i++) { const [x, y] = layStack(it, i - cnt[kd] + 1, sc); out.push(Object.assign({}, it, { uid: `auto-${kd}-${i}`, name: `${it.name} #${i + 1}`, unit: f.units[i].id, x, y })); } });
  out.forEach(o => { const f = LAY_FLEET[o.kind] && fl[LAY_FLEET[o.kind]]; if (f && f.units.length > 1) o.sc = layScale(f.units.length); });      // 그 종류의 그림을 모두 같은 비율로 줄인다
  return out;
}
function mapEqSt(s, it) {
  const k = s.kpi, D = s.devices, lost = n => kLost(n), b = it.bind;
  if (it.absent) return { on: false, absent: true };
  const u = it.unit && KF(LAY_FLEET[it.kind]) && KF(LAY_FLEET[it.kind]).units.find(x => x.id === it.unit);
  if (it.kind === "FSU") { const id = _fsuNo(it), v = id ? val(id + ".v") : null; return v == null || v >= 300 ? { on: true } : { on: false, fault: true }; }      // 그 자리 구간분전함의 전압을 본다. 정전이면 붉게
  const gw = D.MTR && D.MTR.link !== "두절", cbF = { G1: "G1", ESS: "ESS", PV: "PV", FC: "FC", L1: "L1", L2: "L2", L3: "L3" }[b];
  const c = cbF && gw ? Math.round(val("CB." + cbF) ?? 1) : 1;
  if (c === 2) return { on: false, fault: true };                      // 차단기 트립 → 고장 표시
  if (c === 0) return { on: false };                                   // 차단기 개방 → 정지 표시
  if (u && KF(LAY_FLEET[it.kind]).units.length > 1) return { on: it.kind === "ESS" ? u.live : it.kind === "PV" ? u.live && k.pv > .5 : u.on, lost: !u.live, soc: it.kind === "ESS" && u.soc != null ? Math.round(u.soc / 5) * 5 : undefined };     // 여러 대면 장치마다 제 상태
  return ({ G1: { on: kOn("DG"), lost: lost("DG") }, ESS: { on: true, lost: lost("ESS"), soc: Math.round(k.soc / 5) * 5 }, PV: { on: k.pv > .5 }, FC: { on: kOn("FC"), lost: lost("FC") },
    DIST: { on: true, lost: lost("MTR") }, EMS: { on: true } })[b] || { on: true };
}
function siteMapSvg(s) {
  const I = _mapI, items = L.view || L.items || [], cab = L.cab = layCables(items); let g = "";
  g += `<defs><linearGradient id="mSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26301f"/><stop offset="1" stop-color="#11150d"/></linearGradient>
    <linearGradient id="mM1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4630"/><stop offset="1" stop-color="#1f2618"/></linearGradient>
    <linearGradient id="mM2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3624"/><stop offset="1" stop-color="#161b11"/></linearGradient>
    <radialGradient id="mGnd" cx="50%" cy="55%" r="70%"><stop offset="0" stop-color="#4a4b40"/><stop offset=".7" stop-color="#34362c"/><stop offset="1" stop-color="#22241c"/></radialGradient>
    <pattern id="mGv" patternUnits="userSpaceOnUse" width="22" height="16"><circle cx="3" cy="3" r="1.6" fill="#5c5d50"/><circle cx="14" cy="8" r="1.3" fill="#2b2c25"/><circle cx="8" cy="13" r="1.1" fill="#66675a"/><circle cx="19" cy="14" r="1" fill="#3a3b33"/></pattern>
    <pattern id="mTr" patternUnits="userSpaceOnUse" width="14" height="10"><circle cx="4" cy="5" r="4" fill="#253019"/><circle cx="11" cy="3" r="3.4" fill="#2e3a21"/></pattern>
    ${SPRITE_FILTERS}<pattern id="mGrid" patternUnits="userSpaceOnUse" width="40" height="40"><path d="M40 0H0V40" fill="none" stroke="#b6d36b" stroke-opacity=".12" stroke-width="1"/></pattern></defs>
    <rect width="${MAP_W}" height="${MAP_H}" fill="url(#mSky)"/>
    <path d="M0 150 L120 95 L260 130 L420 60 L560 115 L700 80 L860 120 L1010 55 L1180 105 L1320 70 L1480 110 L1600 80 L1600 260 L0 260Z" fill="url(#mM2)" opacity=".8"/>
    <path d="M0 210 L160 150 L330 200 L470 140 L640 205 L820 150 L980 210 L1150 150 L1330 205 L1480 160 L1600 190 L1600 330 L0 330Z" fill="url(#mM1)"/>
    <path d="M0 210 L160 150 L330 200 L470 140 L640 205 L820 150 L980 210 L1150 150 L1330 205 L1480 160 L1600 190 L1600 330 L0 330Z" fill="url(#mTr)" opacity=".7"/>
    <path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGnd)"/><path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGv)" opacity=".55"/>
    ${L.edit ? `<path d="M0 255 Q800 225 1600 255 L1600 900 L0 900Z" fill="url(#mGrid)"/>` : ""}`;
  const ems = items.find(i => i.kind === "EMS");
  if (ems) items.filter(i => ["DG", "ESS", "PV", "FC", "DIST", "FSU"].includes(i.kind)).forEach(i => {      // 통신선: 발전 장비 · 배전 · 구간분전함 모두 EMS 와 이어진다
    g += `<path d="${_cabPath([ems.x, ems.y - 20], [i.x, i.y + 20])}" class="mcom" fill="none"/>`; });
  cab.forEach(([a, b, f], i) => { const d = _cabPath(a, b); g += `<path d="${d}" class="mcab" fill="none"/><path d="${d}" class="mflow" id="mf-${i}" fill="none"/>`; });
  items.slice().sort((a, b) => a.y - b.y).forEach(it => {
    const kind = it.kind === "BARRACK" ? "BARRACK" : it.kind, [Lx, Ly] = ISO_EXT[kind] || ISO_EXT.FSU, [wx, wy] = mapWorld(it.x, it.y), [px, py] = I.p(wx - Lx / 2, wy - Ly / 2, 0);
    const sel = L.edit && L.sel === it.uid;
    g += `<g class="meq ${L.edit ? "editable" : ""} ${sel ? "sel" : ""}" data-uid="${it.uid}">${sel ? `<ellipse cx="${it.x}" cy="${it.y}" rx="${(Lx + Ly) * ISO_C * MAP_S * .62}" ry="${(Lx + Ly) * ISO_S * MAP_S * .62}" class="msel"/>` : ""}${spriteSvg(kind, mapEqSt(s, it), it.x, it.y + (Lx + Ly) * ISO_S * MAP_S / 2 + 6, (Lx + Ly) * ISO_C * MAP_S * (kind === "FSU" ? 1.5 : kind === "PV" ? .78 : 1.12) * (it.sc || 1)) || isoPlace(kind, mapEqSt(s, it), px, py, MAP_S)}</g>`;
  });
  if (ems && !L.edit) g += `<text x="${ems.x}" y="${ems.y + 58}" text-anchor="middle" class="mfsu sec">EMS 전원: 배전 모선(주) · 차량 28 V(예비) · 내장 무정전 전원</text>`;      // 하드웨어 설계의 전원 이중화
  const rg = !L.edit && s.ring ? s.ring : null;                                    // 구간분전함 이름표(환망 화면의 이름과 같다)
  const dst = rg && items.find(i => i.kind === "DIST");                            // 고리가 닫히는 곳: 첫 · 마지막 구간분전함은 배전 · 변압 안의 모선에서 만난다
  if (dst && rg.fsu.length > 1) g += `<text x="${dst.x}" y="${dst.y + 96}" text-anchor="middle" class="mfsu sec open">${esc(rg.fsu[0].name)} ↔ ${esc(rg.fsu[rg.fsu.length - 1].name)} 은 이 안의 모선 A · B 로 이어져 고리가 닫힘</text>`;
  if (rg) items.filter(i => i.kind === "FSU").forEach(it => { const f = rg.fsu.find(x => x.id === _fsuNo(it)); if (f) g += `<text x="${it.x}" y="${it.y + 34}" text-anchor="middle" class="mfsu ${f.live === false ? "bad" : ""}">${esc(f.name)}</text>`; });
  if (rg) cab.forEach(([a, b, f]) => { const sec = /^RS\d+$/.test(f) ? rg.sections[+f.slice(2)] : null; if (!sec) return; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + Math.abs(b[0] - a[0]) * .03;      // 구간 이름표
    const t = sec.state === 2 ? `구간 ${sec.i} 차단` : sec.open ? (sec.state === 1 ? "상시 개방점(닫힘 · 우회 중)" : "상시 개방점(열림)") : sec.i === 0 ? "환망 급전 A(모선 A)" : sec.i === rg.fsu.length ? "환망 급전 B(모선 B)" : "";      // 고리의 양 끝은 배전반의 두 모선에 물려 닫힌다
    if (t) g += `<text x="${mx}" y="${my - 16}" text-anchor="middle" class="mfsu sec ${sec.state === 2 ? "bad" : sec.open ? "open" : ""}">${t}</text>`; });
  cab.forEach(([a, b], i) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + Math.abs(b[0] - a[0]) * .03; g += `<g class="mflt" id="mx-${i}" style="display:none"><circle cx="${mx}" cy="${my}" r="13" fill="#ff5148"/><path d="M${mx - 5} ${my - 5}l10 10M${mx + 5} ${my - 5}l-10 10" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g>`; });
  return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sitemap ${L.edit ? "editing" : ""}" preserveAspectRatio="xMidYMid slice">${g}</svg>`;
}
function _mkPos(it) { const [Lx, Ly, Lz] = ISO_EXT[it.kind] || ISO_EXT.FSU; return [it.x / MAP_W * 100, Math.max(12, (it.y - ((Lx + Ly) * ISO_S / 2 + Lz) * MAP_S * .9) / MAP_H * 100)]; }
function siteMarkers() {
  const box = $("#siteMk"); if (!box || !L.items) return;
  if (L.edit) { box.innerHTML = ""; return; }
  const seen = {};
  const rg = S.snap && S.snap.ring, pp = !rg ? "" : rg.ppdu.map((p, j) => { const it = (L.view || L.items).find(i => i.kind === "FSU" && _fsuNo(i) === p.at); if (!it) return "";
    return `<div class="spt mini ppdu" data-pp="${esc(p.id)}" style="left:${it.x / MAP_W * 100}%;top:${(it.y + 50) / MAP_H * 100}%"><i class="core"></i><div class="scard"><div class="sh">${esc(p.name)}${p.vital ? " ★" : ""}</div><div class="sv"><span class="mono">—</span><span class="ss">—</span></div></div></div>`; }).join("");
  box.dataset.n = (L.view || L.items).length + (rg ? rg.ppdu.length * 100 : 0); box.innerHTML = pp + (L.view || L.items).filter(i => i.kind !== "FSU").map(it => {
    const [x, y] = _mkPos(it), mini = it.kind === "BARRACK" || seen[it.bind]; seen[it.bind] = 1;
    return `<div class="spt ${mini ? "mini" : ""}" data-act="goctl" data-uid="${it.uid}" style="left:${x}%;top:${y}%"><i class="pulse"></i><i class="core"></i>
      <div class="scard"><div class="sh">${esc(it.name || LAY_KINDS[it.kind].nm)}${it.spare ? " · 예비 자리" : ""}</div><div class="sv"><span class="mono">—</span><span class="ss">—</span></div></div></div>`;
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
  const st = siteState(s), box = $("#siteMap"); L.view = layAuto(L.items);
  if (box && !L.drag) {
    const sig = JSON.stringify([L.edit, L.sel, L.view, L.view.map(i => mapEqSt(s, i)), s.ring ? s.ring.sections.map(x => x.state) : 0]);
    if (force || box.dataset.sig !== sig) { box.dataset.sig = sig; box.innerHTML = siteMapSvg(s); layBindDrag(); }
    const D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? 1) : 1, k = s.kpi;
    const busLive = (val("BUS.a_v") ?? 440) > 300 || (val("BUS.b_v") ?? 440) > 300;
    const flow = { G1: kOn("DG") ? k.dg : 0, ESS: Math.abs(k.ess), PV: k.pv, FC: k.fc, L1: k.l1, L2: k.l2, L3: k.l3, RING: k.load, EMSP: 1, DIST: k.load, EMS: 1 };
    (L.cab || []).forEach(([a, b, f], i) => {
      const e = document.getElementById("mf-" + i); if (!e) return; const sec = /^RS\d+$/.test(f) && s.ring ? s.ring.sections[+f.slice(2)] : null;      // 환망 구간: 차단 2 → 고장 표시, 개방 0 → 꺼짐(상시 개방점)
      const c = sec ? (sec.state == null ? 1 : sec.state) : ["RING", "EMSP", "DIST", "EMS", ""].includes(f) ? 1 : cb(f); if (sec) flow[f] = k.load;
      const cls = c === 2 ? "flt" : c === 0 || !busLive ? "off" : (flow[f] || 0) > .5 ? "on" : "idle";
      e.setAttribute("class", "mflow " + cls); e.style.animationDirection = f === "ESS" && k.ess < 0 ? "reverse" : "normal";
      e.style.animationDuration = Math.max(.6, 2.4 - Math.min(1, (flow[f] || 0) / 150) * 1.8) + "s";
      const x = document.getElementById("mx-" + i); if (x) x.style.display = c === 2 ? "" : "none";
    });
  }
  const mk = $("#siteMk"); if (mk && !L.edit && (!mk.children.length || +mk.dataset.n !== L.view.length + (s.ring ? s.ring.ppdu.length * 100 : 0))) siteMarkers();            // 대수가 바뀌면 표지도 다시 만든다
  $$("#siteMk .spt.ppdu").forEach(e => { const p = s.ring && s.ring.ppdu.find(q => q.id === e.dataset.pp); if (!p) return; const bad = p.live === false || p.mccb === 2, tr = p.ch.filter(c => c.cb === 2 && c.cls > 0).length;
    e.className = `spt mini ppdu ${bad ? "bad" : tr || p.over || p.gnd_bad ? "idle" : "ok"}`; e.querySelector(".sv .mono").textContent = p.kw == null ? "—" : F.kw(p.kw) + " kW"; e.querySelector(".ss").textContent = bad ? (p.mccb === 2 ? "주 차단기 트립" : "정전") : tr ? `회로 트립 ${tr}` : p.over ? "과부하" : "공급"; });
  $$("#siteMk .spt:not(.ppdu)").forEach(e => { const it = L.view.find(i => i.uid === e.dataset.uid); if (!it) return; let x = st[it.bind] || { st: "ok", v: "", t: "" };
    const kf = KF(LAY_FLEET[it.kind]), u = kf && kf.units.length > 1 && kf.units.find(q => q.id === it.unit);
    if (u) x = { st: !u.live ? "bad" : u.on || it.kind === "ESS" || it.kind === "PV" ? "ok" : "idle", v: `${u.id}${u.kw == null ? "" : " · " + F.kw(u.kw) + " kW"}${it.kind === "ESS" && u.soc != null ? " · " + F.n(u.soc, 0) + "%" : ""}`, t: !u.live ? "통신 두절" : it.kind === "ESS" || it.kind === "PV" ? "연결" : u.on ? "운전" : "정지" };
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
      <button class="btn sm" id="layDup">복제</button><button class="btn sm stop" id="layDel">삭제</button>` : `<span class="muted">장비를 누르면 선택, 끌면 이동 · 같은 종류를 더 놓으면 예비 자리(흐림)로 저장되고 그 장치가 인식되면 켜진다 · 대수는 설비 제어 화면의 − ＋</span>`}</div>
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
  layAdopt(); L.edit = true; L.sel = null; siteRebuild();
}
document.addEventListener("keydown", e => { if (S.page === "overview" && $("#siteBox") && L.edit && L.sel && (e.key === "Delete" || e.key === "Backspace") && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); layDelete(); } });
