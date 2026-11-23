/* 단선결선도(SLD): 모선 A/B + 연계 차단기, 급전선별 차단기 상태(투입·개방·트립), 통전·무전압·고장 구간, 전력 흐름 방향
   통전 판정: 모선 전압(BUS.a_v/b_v, 보호 IED 게이트웨이)이 있으면 실측을 쓰고, 없으면 차단기·운전 상태로 추정한다. */
"use strict";
const BUS_Y = 316, SY = 78, SR = 48, LY = 474, LR = 42;
const RG = { YR: 410, X0: 42, X1: 958, H: 668 };      // 환망이 있으면 부하는 구간분전함 아래에 달고(등급별 합계는 맨 아래 글), 그림 높이는 H      // 환망: 모선 A(X0) 와 모선 B(X1) 에서 내려와 구간분전함 줄(YR)에서 만난다. 환망이 있으면 부하는 그 아래로 DY 만큼 내려 환망에 단다
const SRC = [
  { id: "GRID", name: "상전 수전", en: "UTILITY GRID", x: 70, col: "g1", kw: "GRID.kw", sub: "22.9kV 수전", bus: "A" },
  { id: "PV", name: "태양광 PV", en: "SOLAR PV", x: 195, col: "pv", kw: "PV.kw", sub: "80kWp × 5", bus: "A" },
  { id: "DG", name: "디젤 발전기", en: "DIESEL GEN", x: 320, col: "dg", kw: "DG.kw", sub: "90kW", bus: "A" },
  { id: "FC", name: "수소 연료전지", en: "FUEL CELL", x: 440, col: "fc", kw: "FC.kw", sub: "100kW", bus: "A" },
  { id: "GDG", name: "주둔지 발전기", en: "GARRISON GEN", x: 590, col: "dg", kw: "GDG.kw", sub: "1MW 디젤", bus: "B" },
  { id: "ESS", name: "ESS (PCS)", en: "ESS (PCS)", x: 730, col: "ess", kw: "ESS.kw", sub: "1MWh / 500kW", bus: "B" },
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
  GDG: '<rect x="3" y="8" width="13" height="10" rx="1.5"/><path d="M16 11h3v4h-3M6 8V5h5v3M10.2 10.5 8 13.5h3l-2.2 3"/>',
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
  const ko = S.lang === "ko", ring = !!(S.snap && S.snap.ring), LO = BUS_Y, LYY = LY, SLD_H = ring ? RG.H : 610;      // 환망이 있으면 등급별 부하 그림은 감추고(값은 맨 아래 글과 오른쪽 표) 부하를 구간분전함 아래에 그린다
  const hex = (n, cy, r, color, icon, isLoad) => `<g class="node" id="n-${n.id}">
    <clipPath id="cp-${n.id}"><rect x="${n.x - r * 1.18}" y="${cy - r * .8}" width="${r * 2.36}" height="${r * 1.6}" rx="12"/></clipPath>
    <rect class="hexbg" x="${n.x - r * 1.18}" y="${cy - r * .8}" width="${r * 2.36}" height="${r * 1.6}" rx="12"/>
    <g clip-path="url(#cp-${n.id})"><g id="art-${n.id}" data-x="${n.x - r * 1.18}" data-y="${cy - r * .8}" data-w="${r * 2.36}" data-h="${r * 1.6}" class="eqimg"></g></g>
    <rect class="hexo" x="${n.x - r * 1.18}" y="${cy - r * .8}" width="${r * 2.36}" height="${r * 1.6}" rx="12" style="fill:none"/>
    <circle class="sdot" cx="${n.x + r * 1.18 - 10}" cy="${cy - r * .8 + 10}" r="5"/><g id="un-${n.id}" data-x="${n.x}" data-y="${cy - r * .8 - 12}"></g>
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
    <path class="ln" id="lu-${n.id}" d="M${n.x} ${LO} V${LYY - 121}"/><path class="ln" id="ld-${n.id}" d="M${n.x} ${LYY - 103} V${LYY - LR}"/>
    <path class="flow" id="f-${n.id}" d="M${n.x} ${LYY - 101} V${LYY - LR - 2}" stroke="var(--live)"/>
    <text class="fv" id="fv-${n.id}" x="${n.x - 12}" y="${LYY - 70}" text-anchor="end"></text>
    ${cbSym(n.id, n.x, LYY - 112)}${faultMark(n.id, n.x, LYY - 66)}${hex(n, LYY, LR, n.col, ICON.L, true)}`).join("");
  return `<svg class="sld" viewBox="0 0 1000 ${SLD_H}" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="hexFill" cx="50%" cy="40%" r="65%"><stop offset="0" style="stop-color:var(--hexA)"/><stop offset="1" style="stop-color:var(--hexB)"/></radialGradient>
      <linearGradient id="hexStroke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--hexS1)"/><stop offset="1" style="stop-color:var(--hexS2)"/></linearGradient>
      <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="${SLD_H}"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${src}
    <path class="bus" id="busA" d="M40 ${BUS_Y} H478"/><path class="bus" id="busB" d="M522 ${BUS_Y} H960"/>
    <path class="flow" id="f-TIE" d="M430 ${BUS_Y} H570" stroke="var(--live)"/>
    ${cbSym("TIE", 500, BUS_Y, true)}${faultMark("TIE", 500, BUS_Y - 46)}
    <text class="buslbl" x="${ring ? 58 : 44}" y="${BUS_Y + 22}" id="blA">${ko ? "모선 A" : "BUS A"}</text><text class="buslbl" x="530" y="${BUS_Y + 22}" id="blB">${ko ? "모선 B" : "BUS B"}</text>
    <text class="fv" id="fv-TIE" x="500" y="${BUS_Y + 46}" text-anchor="middle"></text>
    <g id="sldRingG" class="sring"></g><g ${ring ? 'style="display:none"' : ""}>${lds}</g></svg>`;
}
function setFlow(id, kw, cap, on = true) {
  const f = document.getElementById("f-" + id); if (!f) return; const a = Math.abs(kw || 0);
  if (!on || a < 0.5) { f.style.opacity = 0; return; } f.style.opacity = .95;
  f.style.animationDuration = Math.max(0.35, 2.6 - 2.2 * Math.min(1, a / (cap || 100))) + "s"; f.style.animationDirection = kw < 0 ? "reverse" : "normal";
  f.style.strokeWidth = 2.5 + 3 * Math.min(1, a / (cap || 100));
}

/* 같은 종류 장치가 여러 대면 그림 위에 장치 칩을 대수만큼 그린다(자동 인식 — 놓거나 빼면 스스로 바뀐다). 초록 운전 · 회색 정지 · 빨강 두절 */
function sldUnits(id) {
  const g = document.getElementById("un-" + id); if (!g) return; const f = KF(id === "G1" ? "DG" : id),      /* 복합전력 G1 은 디젤과 같은 차량이라 디젤 대수를 따른다 */ us = f && f.units.length > 1 ? f.units : [], sig = JSON.stringify(us.map(u => [u.id, u.live, u.on])); if (g.dataset.sig === sig) return; g.dataset.sig = sig;
  const x0 = +g.dataset.x - us.length * 17 + 1, y = +g.dataset.y;
  g.innerHTML = us.map((u, i) => `<g class="uchip ${u.live ? (u.on ? "on" : "off") : "lost"}"><title>${u.id} · ${u.live ? (u.on ? "운전" : "정지") : "통신 두절"}</title><rect x="${x0 + i * 34}" y="${y - 8}" width="32" height="15" rx="4"/><text x="${x0 + i * 34 + 16}" y="${y + 3.5}" text-anchor="middle">${u.id}</text></g>`).join("");
}
/* 환망(구간분전함 · 휴대용 배전체계)을 결선도 안에 그린다 — 모선과 부하 사이에: 모선 A ─(구간 0)─ 구간분전함 1 … n ─(구간 n)─ 모선 B.
   등급별 부하는 이 고리 아래에 등급별 차단기를 거쳐 달린다(모선 → 환망 → 차단기 → 부하). 자동 인식한 대수가 바뀌면 스스로 다시 그린다 */
function sldRing(s, live) {
  const g = document.getElementById("sldRingG"); if (!g) return; const r = s.ring;
  const sig = r ? JSON.stringify([live, S.lang, [1, 2, 3].map(c => [Math.round(val("CB.L" + c) ?? 1), Math.round((val("LOAD.p" + c + "_kw") || 0) * 2)]), !!(S.sprites && S.sprites.l1), r.ppdu.map(p => p.ch.map(q => Math.round((q.kw || 0) * 5))), r.sections.map(x => x.state), r.fsu.map(f => [f.id, f.name, f.live]), r.ppdu.map(p => [p.id, p.name, p.at, p.live, p.mccb, p.vital, Math.round((p.kw || 0) * 2), p.ch.filter(c => c.cb === 2 && c.cls > 0).length])]) : "";
  if (g.dataset.sig === sig) return; g.dataset.sig = sig; if (!r) { g.innerHTML = ""; return; }
  const { YR, X0, X1 } = RG, n = r.fsu.length, xs = k => X0 + (X1 - X0) * (k + 1) / (n + 1), ym = (BUS_Y + YR) / 2, sm = RingView.sum(s);
  const liveAt = k => k < 0 ? live.A : k >= n ? live.B : r.fsu[k].live === true;                                             // 구간 양 끝 가운데 한쪽이라도 살아 있으면 그 구간에 전압이 있다
  const sw = (x, y, st) => `<g class="cbk ${st == null ? "unk" : st === 1 ? "closed" : st === 2 ? "trip" : "open"}"><rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="2.5"/><path class="x" d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8"/></g>`;
  let h = `<text class="cbl" x="${X0 + 14}" y="${ym + 2}">환망 급전 A</text><text class="cbl" x="${X1 - 14}" y="${ym + 2}" text-anchor="end">환망 급전 B</text>
    <text class="sring-t ${sm.cls}" x="${X0 + 118}" y="${YR - 46}">${esc("환망 · " + (sm.cut.length ? "구간 " + sm.cut.join(", ") + " 차단" + (r.switched ? " · 반대쪽에서 공급 중" : "") : r.ok ? "전 마디 공급" : "확인 필요"))}</text>`;
  r.sections.forEach(x => { const i = x.i, cls = x.state === 2 ? "flt" : x.state === 0 || x.state == null ? "off" : (liveAt(i - 1) || liveAt(i)) ? "on" : "off";
    const d = i === 0 ? `M${X0} ${BUS_Y} V${YR} H${xs(0) - 13}` : i === n ? `M${xs(n - 1) + 13} ${YR} H${X1} V${BUS_Y}` : `M${xs(i - 1) + 13} ${YR} H${xs(i) - 13}`;
    const [px, py] = i === 0 ? [X0, ym + 16] : i === n ? [X1, ym + 16] : [(xs(i - 1) + xs(i)) / 2, YR], side = i === 0 ? 1 : i === n ? -1 : 0;
    const lab = x.state === 2 ? "구간 " + i + " 차단" : x.open ? (x.state === 0 ? "상시 개방점" : "개방점 닫힘") : x.state === 0 ? "구간 " + i + " 개방" : "";
    h += `<path class="ln ${cls}" d="${d}"/>${sw(px, py, x.state)}<text class="sring-s ${x.state === 2 ? "t" : x.state === 0 || x.open ? "o" : ""}" x="${px + side * 12}" y="${side ? py + 4 : py - 33}" text-anchor="${side > 0 ? "start" : side < 0 ? "end" : "middle"}">${lab}</text>`; });
  const CLS = [["1", "#ff6b8a"], ["2", "#ffb547"], ["3", TV("--load")]], cbl = c => { const v = val("CB.L" + c); return v == null ? null : Math.round(v); }, shed = c => cbl(c) != null && cbl(c) !== 1;      // 등급별 차단기가 열렸으면 그 등급 회로는 끊긴 것으로 보인다
  const PIC = ["L1", "L2", "L3"]; let tile = 0; h += `<defs>${SPRITE_FILTERS.replace(/id="sp/g, 'id="spRG')}</defs>`;
  r.fsu.forEach((f, k) => { const x = xs(k), c = f.live == null ? "na" : f.live ? "on" : "off", pp = r.ppdu.filter(p => p.at === f.id), one = pp.length === 1;
    h += `<circle class="sring-n ${c}" cx="${x}" cy="${YR}" r="13"/><text class="sring-k" x="${x}" y="${YR + 4}" text-anchor="middle">${k + 1}</text><text class="sring-nm ${c}" x="${x}" y="${YR - 19}" text-anchor="middle">${esc(f.name)}</text>` +
      pp.map((p, j) => { const bad = p.live === false || p.mccb === 2, tr = p.ch.filter(q => q.cb === 2 && q.cls > 0).length, y = YR + 26 + j * 46, w = 108, st = bad ? "off" : tr || p.over || p.gnd_bad ? "warn" : "on", fed = !bad && f.live === true;
        const kw = cl => p.ch.filter(q => q.cls === cl).reduce((a, q) => a + (q.kw || 0), 0), has = cl => p.ch.some(q => q.cls === cl), ty = y + 52, sp = one ? spriteSvg(PIC[tile++ % 3], { on: fed, fault: bad }, x, ty + 62, 92) : null;
        return `<path class="ln ${bad ? "flt" : fed ? "on" : "off"}" d="M${x} ${j ? y - 10 : YR + 13} V${y}"/><rect class="sring-p ${st}" x="${x - w / 2}" y="${y}" width="${w}" height="16" rx="4"/>
          <text class="sring-pt" x="${x}" y="${y + 11.5}" text-anchor="middle">${esc(p.name.length > 9 ? p.name.slice(0, 9) + "…" : p.name)}${p.vital ? " ★" : ""}</text>` +
          CLS.map(([cl, col], q) => !has(+cl) ? "" : `<rect class="sring-c ${bad || shed(cl) ? "off" : ""}" x="${x - 54 + q * 37}" y="${y + 20}" width="34" height="14" rx="3" style="stroke:${col}"/><text class="sring-ct" x="${x - 37 + q * 37}" y="${y + 30.5}" text-anchor="middle" style="fill:${bad || shed(cl) ? "var(--muted)" : col}">${cl}급 ${bad || shed(cl) ? "✕" : kw(+cl).toFixed(1)}</text>`).join("") +
          (!one ? "" : `<path class="ln ${bad ? "flt" : fed ? "on" : "off"}" d="M${x} ${y + 34} V${ty}"/><rect class="sring-ld ${bad ? "off" : fed ? "on" : ""}" x="${x - 50}" y="${ty}" width="100" height="64" rx="9"/>${sp ? sp.replace(/url\(#sp/g, "url(#spRG") : ""}
            <text class="nm" x="${x}" y="${ty + 82}" text-anchor="middle">${esc(p.name)} 부하</text><text x="${x}" y="${ty + 103}" text-anchor="middle"><tspan class="kw" style="font-size:19px">${bad ? "0.0" : p.kw == null ? "—" : F.kw(p.kw)}</tspan><tspan class="u" dx="4">kW</tspan></text>
            <text class="st" x="${x}" y="${ty + 119}" text-anchor="middle" fill="${bad ? "var(--alarm)" : fed ? "var(--ok)" : "var(--warn)"}">${bad ? (p.mccb === 2 ? "주 차단기 트립 · 정전" : "정전") : fed ? "급전 중" : "무전압"}</text>`); }).join(""); });
  const tot = [["1", "LOAD.p1_kw"], ["2", "LOAD.p2_kw"], ["3", "LOAD.p3_kw"]].map(([cl, t], q) => `<tspan style="fill:${CLS[q][1]}" dx="${q ? 16 : 8}">${cl}등급 ${F.kw(val(t))} kW</tspan><tspan class="${cbl(cl) === 2 ? "t" : cbl(cl) === 0 ? "o" : ""}" dx="5">CB-L${cl} ${cbl(cl) == null ? "미상" : ["개방", "투입", "트립"][cbl(cl)]}</tspan>`).join("");
  h += `<text class="sring-s" x="${X0}" y="${RG.H - 12}">작전지 전체 등급별 합계(배전체계에 물리지 않은 부하 포함) · 등급별 차단기${tot}</text>`;
  g.innerHTML = h; g.onclick = () => { location.hash = "#ring"; };
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
  const cbv = f => { const v = val("CB." + f), ok = f === "GDG" ? !!(D.GDG && D.GDG.link !== "두절") : gw; return (!ok || v === null || v === undefined) ? null : Math.round(v); };   // 1 투입, 0 개방, 2 트립, null 미상
  const closed = f => cbv(f) === null ? true : cbv(f) === 1;
  const code = f => Math.round(val("FLT." + f) || 0);
  const devLost = id => id === "PV" || id === "G1" || id === "GRID" ? !gw : KF(id) ? kLost(id) : (D[id] ? D[id].link === "두절" : false);
  const ops = s.ops || {}, garr = ops.mode === "grid";
  const running = { PV: k.pv > 0.5, DG: kOn("DG"), FC: kOn("FC"), ESS: val("ESS.status") > 0.5, G1: true, GRID: garr && cbv("GRID") === 1, GDG: !!(D.GDG && D.GDG.on) };
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
  const pk = { PV: k.pv, DG: k.dg, FC: k.fc, ESS: k.ess, G1: 0, GRID: k.grid || 0, GDG: k.gdg || 0 };
  SRC.forEach(n => {
    if (n.id === "GDG" && !D.GDG) { const e = $("#n-GDG"); if (e) e.style.opacity = .25; return; }      // 주둔지 발전기를 연동하지 않은 현장
    const lost = devLost(n.id), c = cbv(n.id), trip = c === 2, on = running[n.id] && !lost, g = $("#n-" + n.id); sldUnits(n.id);
    if (KF(n.id) && kAbsent(n.id)) {                                     // 가져오지 않은 종류: 흐리게 두고 '미설치'
      g.setAttribute("class", "node off absent"); if (n.kw) $("#kw-" + n.id).textContent = "—"; sldArt(n.id, { on: false }); cbDraw(n.id); setCls("lu-" + n.id, "ln off"); setCls("ld-" + n.id, "ln " + (live[n.bus] ? "on" : "off"));
      setFlow(n.id, 0); $("#fv-" + n.id).textContent = ""; st(n.id, ko ? "미설치 · 자동 인식" : "NOT INSTALLED", "var(--muted)"); return; }
    g.setAttribute("class", "node " + (trip ? "flt" : lost ? "lost" : on ? "on" : "off"));
    if (n.kw) $("#kw-" + n.id).textContent = lost ? "####" : F.kw(pk[n.id]);
    sldArt(n.id, { on: n.id === "G1" ? kOn("DG") : on, lost, soc: n.id === "ESS" ? Math.round(k.soc / 5) * 5 : undefined });
    cbDraw(n.id);
    setCls("lu-" + n.id, "ln " + (trip ? "flt" : on ? "on" : "off")); setCls("ld-" + n.id, "ln " + (live[n.bus] ? "on" : "off"));
    const flowing = closed(n.id) && on && n.kw; setFlow(n.id, flowing ? pk[n.id] : 0, (n.id === "PV" ? 400 : n.id === "ESS" || n.id === "GRID" ? 300 : n.id === "GDG" ? 1000 : 100) * Math.max(1, kN(n.id)));
    $("#fv-" + n.id).textContent = flowing && Math.abs(pk[n.id]) > 0.5 ? `${pk[n.id] < 0 ? "▲" : "▼"} ${F.kw(Math.abs(pk[n.id]))}` : "";
    if (trip) st(n.id, (ko ? "차단기 트립 · " : "CB TRIP · ") + (ANSI_TXT[code(n.id)] || code(n.id)), "var(--alarm)");
    else if (lost) st(n.id, ko ? "통신 두절" : "COMM LOSS", "var(--alarm)");
    else if (n.id === "GRID") st(n.id, !garr ? (ko ? "미연계(작전지)" : "NOT CONNECTED") : c === 1 ? (ops.outage ? (ko ? "복전 확인 중" : "RESTORING") : (ko ? "수전 중" : "IMPORTING")) : (ko ? "정전 · 자립 전환" : "OUTAGE"), !garr ? "var(--muted)" : c === 1 && !ops.outage ? "var(--ok)" : "var(--alarm)");
    else if (n.id === "GDG" && !on) st(n.id, garr ? (ko ? "대기" : "STANDBY") : (ko ? "미사용(작전지)" : "NOT USED"), "var(--muted)");
    else if (c === 0) st(n.id, ko ? "차단기 개방 · 분리" : "CB OPEN · ISOLATED", "var(--warn)");
    else if (n.id === "PV") st(n.id, k.pv > 0.5 ? (ko ? "발전 중" : "GENERATING") : (ko ? "발전 없음" : "IDLE"), k.pv > 0.5 ? "var(--pv)" : "var(--muted)");
    else if (n.id === "ESS") st(n.id, k.ess > 0.5 ? (ko ? "방전" : "DISCHARGING") : k.ess < -0.5 ? (ko ? "충전" : "CHARGING") : (ko ? "대기" : "STANDBY"), "var(--ess)");
    else if (n.id === "G1") st(n.id, ko ? "계통 형성" : "GRID-FORMING", "var(--g1)");
    else st(n.id, on ? (ko ? "운전" : "RUNNING") : (ko ? "정지" : "STOPPED"), on ? "var(--ok)" : "var(--muted)");
    const tg = $("#tg-" + n.id);
    if (tg && n.id === "ESS") { tg.textContent = `SOC ${F.n(k.soc, 1)}%${kCnt("ESS")}`; }
    else if (tg && kN(n.id) > 1) { tg.textContent = `${n.sub} × ${kN(n.id)}대`; tg.setAttribute("fill", "var(--muted)"); }
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
  sldRing(s, live);
}
