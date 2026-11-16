/* 단선결선도(SLD): 모선 A/B + 연계 차단기, 급전선별 차단기 상태(투입·개방·트립), 통전·무전압·고장 구간, 전력 흐름 방향
   통전 판정: 모선 전압(BUS.a_v/b_v, 보호 IED 게이트웨이)이 있으면 실측을 쓰고, 없으면 차단기·운전 상태로 추정한다. */
"use strict";
const BUS_Y = 316, SY = 78, SR = 48, LY = 474, LR = 42;
const SRC = [
  { id: "GRID", name: "상전 수전", en: "UTILITY GRID", x: 70, col: "g1", kw: "GRID.kw", sub: "22.9kV 수전", bus: "A" },
  { id: "PV", name: "태양광 PV", en: "SOLAR PV", x: 195, col: "pv", kw: "PV.kw", sub: "80kWp × 5", bus: "A" },
  { id: "DG", name: "디젤 발전기", en: "DIESEL GEN", x: 320, col: "dg", kw: "DG.kw", sub: "90kW", bus: "A" },
  { id: "FC", name: "수소 연료전지", en: "FUEL CELL", x: 440, col: "fc", kw: "FC.kw", sub: "100kW", bus: "A" },
  { id: "ESS", name: "ESS (PCS)", en: "ESS (PCS)", x: 690, col: "ess", kw: "ESS.kw", sub: "1MWh / 500kW", bus: "B" },
  { id: "G1", name: "복합전력 G1", en: "HYBRID G1", x: 880, col: "g1", kw: null, sub: "100kW 계통 형성", bus: "B" },
];
const LOADS = [
  { id: "L1", name: "1등급 필수 부하", en: "CLASS 1 · CRITICAL", x: 220, kw: "LOAD.p1_kw", bus: "A", col: "#ff6b8a" },
  { id: "L2", name: "2등급 중요 부하", en: "CLASS 2 · ESSENTIAL", x: 665, kw: "LOAD.p2_kw", bus: "B", col: "#ffb547" },
  { id: "L3", name: "3등급 일반 부하", en: "CLASS 3 · GENERAL", x: 865, kw: "LOAD.p3_kw", bus: "B", col: TV("--load") },
];
const ANSI_TXT = { 27: "27 저전압", 32: "32 역전력", 50: "50 순시 과전류", 51: "51 한시 과전류", 59: "59 과전압", 64: "64 지락", 81: "81 주파수", 87: "87 차동" };
const ICON = {
  PV: '<path d="M3 8h18l-2.2 9H5.2z"/><path d="M8.5 8 7.6 17M15.5 8l.9 9M4.1 12.5h15.8"/><path d="M12 17v3M8 20h8"/><circle cx="19" cy="3.6" r="1.6"/>',
  DG: '<rect x="3" y="8" width="13" height="10" rx="1.5"/><path d="M16 11h3v4h-3M6 8V5h5v3M10.2 10.5 8 13.5h3l-2.2 3"/>',
  FC: '<circle cx="7.5" cy="12" r="3.2"/><circle cx="16.5" cy="12" r="3.2"/><path d="M10.7 12h2.6M5.5 4.5v3M18.5 16.5v3"/>',
  ESS: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M19 10.5h2v3h-2M11.5 9 9 12.5h3.5L10 15.5"/>',
  G1: '<path d="M12 3 7.5 21M12 3l4.5 18M8.8 15.5h6.4M10 10.5h4M5 7.5h14M9 21h6"/>',
  GRID: '<path d="M12 3 7.5 21M12 3l4.5 18M8.8 15.5h6.4M10 10.5h4M5 7.5h14M9 21h6"/>',
  L: '<path d="M4 21V9l6-3.5V21M10 21v-9.5h10V21M13 14.5h1.5M16.5 14.5H18M13 17.5h1.5M16.5 17.5H18M2.5 21h19"/>',
};
const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 180 * (60 * k - 90); return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(" ");

function cbSym(id, x, y, horiz) {
  return `<g class="cbk unk" id="cb-${id}"><rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3"/><path class="x" d="M${x - 6} ${y - 6}l12 12M${x + 6} ${y - 6}l-12 12"/></g>
    <text class="cbl" x="${horiz ? x : x + 16}" y="${horiz ? y - 18 : y - 2}" ${horiz ? 'text-anchor="middle"' : ""}>CB-${id}</text><text class="cbs" id="cbs-${id}" x="${horiz ? x : x + 16}" y="${horiz ? y + 26 : y + 11}" ${horiz ? 'text-anchor="middle"' : ""}>—</text>`;
}
function faultMark(id, x, y) {
  return `<g class="fltm" id="fm-${id}" style="display:none"><circle cx="${x}" cy="${y}" r="13"/><path d="M${x + 2} ${y - 9} ${x - 5} ${y + 1} ${x} ${y + 1} ${x - 2} ${y + 9} ${x + 5} ${y - 1} ${x} ${y - 1}z"/>
    <g transform="translate(${x + 18},${y - 10})"><rect width="118" height="20" rx="10"/><text x="10" y="14" id="fmt-${id}">고장</text></g></g>`;
}
function sldSvg() {
  const ko = S.lang === "ko";
  const hex = (n, cy, r, color, icon, isLoad) => `<g class="node" id="n-${n.id}">
    <clipPath id="cp-${n.id}"><rect x="${n.x - r * 1.18}" y="${cy - r * .8}" width="${r * 2.36}" height="${r * 1.6}" rx="12"/></clipPath>
    <rect class="hexbg" x="${n.x - r * 1.18}" y="${cy - r * .8}" width="${r * 2.36}" height="${r * 1.6}" rx="12"/>
    <g clip-path="url(#cp-${n.id})"><g id="art-${n.id}" data-x="${n.x - r * 1.18}" data-y="${cy - r * .8}" data-w="${r * 2.36}" data-h="${r * 1.6}" class="eqimg"></g></g>
    <rect class="hexo" x="${n.x - r * 1.18}" y="${cy - r * .8}" width="${r * 2.36}" height="${r * 1.6}" rx="12" style="fill:none"/>
    <circle class="sdot" cx="${n.x + r * 1.18 - 10}" cy="${cy - r * .8 + 10}" r="5"/>
    <g class="ico" style="display:none" stroke="${color}" transform="translate(${n.x - 16.8},${cy - 16.8}) scale(1.4)">${icon}</g>
    <text class="nm" x="${n.x}" y="${cy + r + 22}" text-anchor="middle">${ko ? n.name : n.en}</text>
    <text x="${n.x}" y="${cy + r + 47}" text-anchor="middle"><tspan class="kw" id="kw-${n.id}">—</tspan><tspan class="u" dx="4">kW</tspan></text>
    <text class="st" x="${n.x}" y="${cy + r + 64}" text-anchor="middle" id="st-${n.id}" fill="var(--muted)">—</text>
    ${isLoad ? "" : `<text class="tag" x="${n.x}" y="${cy + r + 80}" text-anchor="middle" id="tg-${n.id}" fill="var(--muted)">${n.sub}</text>`}</g>`;
  const top = SY + SR + 92;                 // 급전선 시작(이름·값 아래)
  const src = SRC.map(n => `
    <path class="ln" id="lu-${n.id}" d="M${n.x} ${top} V${BUS_Y - 63}"/><path class="ln" id="ld-${n.id}" d="M${n.x} ${BUS_Y - 45} V${BUS_Y}"/>
    <path class="flow" id="f-${n.id}" d="M${n.x} ${BUS_Y - 44} V${BUS_Y - 2}" stroke="var(--${n.col})"/>
    <text class="fv" id="fv-${n.id}" x="${n.x - 12}" y="${BUS_Y - 18}" text-anchor="end"></text>
    ${cbSym(n.id, n.x, BUS_Y - 54)}${faultMark(n.id, n.x, top + 14)}${hex(n, SY, SR, `var(--${n.col})`, ICON[n.id], false)}`).join("");
  const lds = LOADS.map(n => `
    <path class="ln" id="lu-${n.id}" d="M${n.x} ${BUS_Y} V${BUS_Y + 37}"/><path class="ln" id="ld-${n.id}" d="M${n.x} ${BUS_Y + 55} V${LY - LR}"/>
    <path class="flow" id="f-${n.id}" d="M${n.x} ${BUS_Y + 57} V${LY - LR - 2}" stroke="var(--live)"/>
    <text class="fv" id="fv-${n.id}" x="${n.x - 12}" y="${BUS_Y + 88}" text-anchor="end"></text>
    ${cbSym(n.id, n.x, BUS_Y + 46)}${faultMark(n.id, n.x, BUS_Y + 92)}${hex(n, LY, LR, n.col, ICON.L, true)}`).join("");
  return `<svg class="sld" viewBox="0 0 1000 610" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="hexFill" cx="50%" cy="40%" r="65%"><stop offset="0" style="stop-color:var(--hexA)"/><stop offset="1" style="stop-color:var(--hexB)"/></radialGradient>
      <linearGradient id="hexStroke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--hexS1)"/><stop offset="1" style="stop-color:var(--hexS2)"/></linearGradient>
      <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="610"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${src}
    <path class="bus" id="busA" d="M40 ${BUS_Y} H478"/><path class="bus" id="busB" d="M522 ${BUS_Y} H960"/>
    <path class="flow" id="f-TIE" d="M430 ${BUS_Y} H570" stroke="var(--live)"/>
    ${cbSym("TIE", 500, BUS_Y, true)}${faultMark("TIE", 500, BUS_Y - 46)}
    <text class="buslbl" x="44" y="${BUS_Y + 22}" id="blA">${ko ? "모선 A" : "BUS A"}</text><text class="buslbl" x="530" y="${BUS_Y + 22}" id="blB">${ko ? "모선 B" : "BUS B"}</text>
    <text class="fv" id="fv-TIE" x="500" y="${BUS_Y + 46}" text-anchor="middle"></text>
    ${lds}</svg>`;
}
function setFlow(id, kw, cap, on = true) {
  const f = document.getElementById("f-" + id); if (!f) return; const a = Math.abs(kw || 0);
  if (!on || a < 0.5) { f.style.opacity = 0; return; } f.style.opacity = .95;
  f.style.animationDuration = Math.max(0.35, 2.6 - 2.2 * Math.min(1, a / (cap || 100))) + "s"; f.style.animationDirection = kw < 0 ? "reverse" : "normal";
  f.style.strokeWidth = 2.5 + 3 * Math.min(1, a / (cap || 100));
}

/* 상태 갱신 */
function sldArt(id, st) {
  const g = document.getElementById("art-" + id); if (!g) return; const sig = JSON.stringify(st); if (g.dataset.sig === sig) return; g.dataset.sig = sig;
  const x = +g.dataset.x, y = +g.dataset.y, w = +g.dataset.w, h = +g.dataset.h;
  const sp = spriteSvg(id, st, x + w / 2, y + h - 2, w * .96);
  g.innerHTML = sp ? `<defs>${SPRITE_FILTERS.replace(/id="sp/g, `id="sp${id}`)}</defs>` + sp.replace(/url\(#sp/g, `url(#sp${id}`) : isoArt(EQ_KIND[id] || "DIST", st, 400, 250, 6).replace("<svg ", `<svg x="${x}" y="${y}" width="${w}" height="${h}" `);
}
function sldUpdate(s) {
  const k = s.kpi, D = s.devices, ko = S.lang === "ko", gw = D.MTR && D.MTR.link !== "두절";     // 보호 IED 게이트웨이(MTR) 통신
  const cbv = f => { const v = val("CB." + f); return (!gw || v === null || v === undefined) ? null : Math.round(v); };   // 1 투입, 0 개방, 2 트립, null 미상
  const closed = f => cbv(f) === null ? true : cbv(f) === 1;
  const code = f => Math.round(val("FLT." + f) || 0);
  const devLost = id => id === "PV" || id === "G1" || id === "GRID" ? !gw : (D[id] ? D[id].link === "두절" : false);
  const ops = s.ops || {}, garr = ops.mode === "grid";
  const running = { PV: k.pv > 0.5, DG: !!(D.DG && D.DG.on), FC: !!(D.FC && D.FC.on), ESS: val("ESS.status") > 0.5, G1: true, GRID: garr && cbv("GRID") === 1 };
  // 모선 통전: 실측 전압 우선
  const est = bus => SRC.some(n => n.bus === bus && n.id !== "PV" && running[n.id] && closed(n.id));
  let aLive = est("A"), bLive = est("B"); if (closed("TIE")) { const x = aLive || bLive; aLive = bLive = x; }
  const va = val("BUS.a_v"), vb = val("BUS.b_v"); if (gw && va !== null && va !== undefined) aLive = va > 300; if (gw && vb !== null && vb !== undefined) bLive = vb > 300;
  const live = { A: aLive, B: bLive };
  const setCls = (id, cls) => { const e = document.getElementById(id); if (e) e.setAttribute("class", cls); };
  const cbDraw = f => {
    const c = cbv(f), txt = c === null ? (ko ? "상태 미상" : "UNKNOWN") : c === 1 ? (ko ? "투입" : "CLOSED") : c === 2 ? (ko ? "트립" : "TRIPPED") : (ko ? "개방" : "OPEN");
    setCls("cb-" + f, "cbk " + (c === null ? "unk" : c === 1 ? "closed" : c === 2 ? "trip" : "open")); const e = $("#cbs-" + f); if (e) { e.textContent = txt; e.setAttribute("class", "cbs " + (c === 2 ? "t" : c === 0 ? "o" : "")); }
    const fm = $("#fm-" + f); if (fm) { fm.style.display = c === 2 ? "" : "none"; $("#fmt-" + f).textContent = "⚡ " + (ANSI_TXT[code(f)] || (ko ? "보호 동작 " : "PROT ") + code(f)); }
  };
  const st = (id, txt, col) => { const e = $("#st-" + id); if (e) { e.textContent = txt; e.setAttribute("fill", col); } };
  const pk = { PV: k.pv, DG: k.dg, FC: k.fc, ESS: k.ess, G1: 0, GRID: k.grid || 0 };
  SRC.forEach(n => {
    const lost = devLost(n.id), c = cbv(n.id), trip = c === 2, on = running[n.id] && !lost, g = $("#n-" + n.id);
    g.setAttribute("class", "node " + (trip ? "flt" : lost ? "lost" : on ? "on" : "off"));
    if (n.kw) $("#kw-" + n.id).textContent = lost ? "####" : F.kw(pk[n.id]);
    sldArt(n.id, { on: n.id === "G1" ? !!(D.DG && D.DG.on) : on, lost, soc: n.id === "ESS" ? Math.round(k.soc / 5) * 5 : undefined });
    cbDraw(n.id);
    setCls("lu-" + n.id, "ln " + (trip ? "flt" : on ? "on" : "off")); setCls("ld-" + n.id, "ln " + (live[n.bus] ? "on" : "off"));
    const flowing = closed(n.id) && on && n.kw; setFlow(n.id, flowing ? pk[n.id] : 0, n.id === "PV" ? 400 : n.id === "ESS" || n.id === "GRID" ? 300 : 100);
    $("#fv-" + n.id).textContent = flowing && Math.abs(pk[n.id]) > 0.5 ? `${pk[n.id] < 0 ? "▲" : "▼"} ${F.kw(Math.abs(pk[n.id]))}` : "";
    if (trip) st(n.id, (ko ? "차단기 트립 · " : "CB TRIP · ") + (ANSI_TXT[code(n.id)] || code(n.id)), "var(--alarm)");
    else if (lost) st(n.id, ko ? "통신 두절" : "COMM LOSS", "var(--alarm)");
    else if (n.id === "GRID") st(n.id, !garr ? (ko ? "미연계(작전지)" : "NOT CONNECTED") : c === 1 ? (ops.outage ? (ko ? "복전 확인 중" : "RESTORING") : (ko ? "수전 중" : "IMPORTING")) : (ko ? "정전 · 자립 전환" : "OUTAGE"), !garr ? "var(--muted)" : c === 1 && !ops.outage ? "var(--ok)" : "var(--alarm)");
    else if (c === 0) st(n.id, ko ? "차단기 개방 · 분리" : "CB OPEN · ISOLATED", "var(--warn)");
    else if (n.id === "PV") st(n.id, k.pv > 0.5 ? (ko ? "발전 중" : "GENERATING") : (ko ? "발전 없음" : "IDLE"), k.pv > 0.5 ? "var(--pv)" : "var(--muted)");
    else if (n.id === "ESS") st(n.id, k.ess > 0.5 ? (ko ? "방전" : "DISCHARGING") : k.ess < -0.5 ? (ko ? "충전" : "CHARGING") : (ko ? "대기" : "STANDBY"), "var(--ess)");
    else if (n.id === "G1") st(n.id, ko ? "계통 형성" : "GRID-FORMING", "var(--g1)");
    else st(n.id, on ? (ko ? "운전" : "RUNNING") : (ko ? "정지" : "STOPPED"), on ? "var(--ok)" : "var(--muted)");
    const tg = $("#tg-" + n.id);
    if (tg && n.id === "ESS") { tg.textContent = `SOC ${F.n(k.soc, 1)}%`; }
    else if (tg && D[n.id] && D[n.id].ctl) { tg.textContent = D[n.id].manual ? "LOCAL · MANUAL" : "REMOTE · AUTO"; tg.setAttribute("fill", D[n.id].manual ? "var(--warn)" : "var(--muted)"); }
  });
  LOADS.forEach(n => {
    const c = cbv(n.id), trip = c === 2, fed = live[n.bus] && closed(n.id), kw = val(n.kw);
    cbDraw(n.id); setCls("lu-" + n.id, "ln " + (live[n.bus] ? "on" : "off")); setCls("ld-" + n.id, "ln " + (trip ? "flt" : fed ? "on" : "off"));
    $("#n-" + n.id).setAttribute("class", "node " + (trip ? "flt" : fed ? "on" : "off"));
    $("#kw-" + n.id).textContent = gw ? F.kw(kw) : "####"; setFlow(n.id, fed ? kw : 0, 150);
    sldArt(n.id, { on: fed, lost: trip });
    $("#fv-" + n.id).textContent = fed && kw > 0.5 ? `▼ ${F.kw(kw)}` : "";
    if (trip) st(n.id, (ko ? "트립 · " : "TRIP · ") + (ANSI_TXT[code(n.id)] || code(n.id)), "var(--alarm)");
    else if (!fed) st(n.id, c === 0 ? (ko ? "차단기 개방 · 정전" : "CB OPEN · DE-ENERGIZED") : (ko ? "무전압 · 정전" : "DE-ENERGIZED"), "var(--warn)");
    else st(n.id, ko ? "급전 중" : "ENERGIZED", "var(--ok)");
  });
  // 모선·연계
  cbDraw("TIE"); setCls("busA", "bus " + (aLive ? "on" : "off")); setCls("busB", "bus " + (bLive ? "on" : "off"));
  const genA = SRC.filter(n => n.bus === "A" && closed(n.id)).reduce((a, n) => a + Math.max(0, pk[n.id] || 0), 0) - (closed("L1") ? (val("LOAD.p1_kw") || 0) : 0);
  const tie = closed("TIE") && cbv("TIE") !== null; setFlow("TIE", tie ? genA : 0, 150, aLive && bLive);
  $("#fv-TIE").textContent = tie && Math.abs(genA) > 0.5 ? (genA > 0 ? `A → B ${F.kw(genA)} kW` : `B → A ${F.kw(-genA)} kW`) : "";
  const vtxt = (v, l) => (v === null || v === undefined || !gw) ? "" : ` · ${l ? F.n(v, 1) + " V" : (ko ? "무전압" : "DEAD")}`;
  $("#blA").textContent = (ko ? "모선 A" : "BUS A") + vtxt(va, aLive); $("#blB").textContent = (ko ? "모선 B" : "BUS B") + vtxt(vb, bLive);
  const bb = $("#busbal"); if (bb) bb.textContent = (val("BUS.hz") > 1 && gw ? `${F.n(val("BUS.hz"), 2)} Hz · ` : "") + `Σ${ko ? "공급" : "GEN"} ${F.kw(k.gen)} · Σ${ko ? "부하" : "LOAD"} ${F.kw(k.load)} kW`;
  $("#blA").setAttribute("fill", aLive ? "var(--text2)" : "var(--warn)"); $("#blB").setAttribute("fill", bLive ? "var(--text2)" : "var(--warn)");
}
