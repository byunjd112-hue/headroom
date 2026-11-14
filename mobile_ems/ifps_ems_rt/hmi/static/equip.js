/* 장비 일러스트(SVG, 자체 제작). equipSvg(종류, {on, lost, value}) → SVG 문자열
   종류: PV 태양광 어레이, DG 디젤 발전기 컨테이너, FC 수소 연료전지 + 저장 용기, ESS 배터리 컨테이너, MTR 계측·환경 분전반, LOAD 쉘터(부하) */
"use strict";
let _eqN = 0;
function equipSvg(kind, st = {}) {
  const u = "eq" + (++_eqN), on = !!st.on && !st.lost, lamp = st.lost ? "#ff4d64" : on ? "#2de2a6" : "#ffb547";
  const W = 260, H = 160;
  const defs = `<defs>
    <linearGradient id="${u}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9e2f2"/><stop offset="1" stop-color="#8e9cb8"/></linearGradient>
    <linearGradient id="${u}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6c7a96"/><stop offset="1" stop-color="#46536e"/></linearGradient>
    <linearGradient id="${u}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b6b3c"/><stop offset="1" stop-color="#3e4a28"/></linearGradient>
    <linearGradient id="${u}gs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a4526"/><stop offset="1" stop-color="#2b341b"/></linearGradient>
    <linearGradient id="${u}pv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a5bd7"/><stop offset=".55" stop-color="#14307e"/><stop offset="1" stop-color="#0b1d52"/></linearGradient>
    <linearGradient id="${u}sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="${u}gl"><stop offset="0" stop-color="${lamp}" stop-opacity=".9"/><stop offset="1" stop-color="${lamp}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${u}sun"><stop offset="0" stop-color="#fff3a6"/><stop offset=".45" stop-color="#f5d000" stop-opacity=".9"/><stop offset="1" stop-color="#f5d000" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}cy" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9fb2cf"/><stop offset=".45" stop-color="#eef3fb"/><stop offset="1" stop-color="#7486a5"/></linearGradient>
  </defs>`;
  const shadow = (cx, w) => `<ellipse cx="${cx}" cy="148" rx="${w}" ry="7" fill="#000" opacity=".35"/>`;
  const light = (x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="url(#${u}gl)" class="${on ? "eqpulse" : ""}"/><circle cx="${x}" cy="${y}" r="3" fill="${lamp}"/>`;
  // 상자(정면 + 윗면 + 옆면)로 입체감
  const box = (x, y, w, h, d, front, side, top) => `<polygon points="${x},${y} ${x + d},${y - d * .55} ${x + w + d},${y - d * .55} ${x + w},${y}" fill="${top}"/>
    <polygon points="${x + w},${y} ${x + w + d},${y - d * .55} ${x + w + d},${y + h - d * .55} ${x + w},${y + h}" fill="${side}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${front}"/>`;
  let body = "";
  if (kind === "PV") {
    const panel = (x0, y0) => { let cells = ""; for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const px = x0 + c * 13 + r * 6, py = y0 + r * 9; cells += `<polygon points="${px},${py} ${px + 12},${py} ${px + 17.4},${py + 8.2} ${px + 5.4},${py + 8.2}" fill="url(#${u}pv)" stroke="#9cc1ff" stroke-opacity=".35" stroke-width=".5"/>`; }
      return `<polygon points="${x0 - 3},${y0 - 3} ${x0 + 80},${y0 - 3} ${x0 + 104},${y0 + 38} ${x0 + 21},${y0 + 38}" fill="#c9d3e6"/>${cells}<polygon points="${x0 - 3},${y0 - 3} ${x0 + 80},${y0 - 3} ${x0 + 104},${y0 + 38} ${x0 + 21},${y0 + 38}" fill="url(#${u}sh)"/>
        <path d="M${x0 + 25} ${y0 + 38} v32 M${x0 + 95} ${y0 + 38} v32 M${x0 + 8} ${y0 + 4} v62 M${x0 + 78} ${y0 + 4} v62" stroke="#8796b3" stroke-width="3"/>`; };
    body = `${on ? `<circle cx="226" cy="26" r="26" fill="url(#${u}sun)"/>` : `<circle cx="226" cy="26" r="9" fill="#2a3560"/>`}${shadow(130, 112)}${panel(18, 58)}${panel(128, 58)}
      <rect x="112" y="122" width="26" height="20" rx="2" fill="url(#${u}m)"/><rect x="116" y="126" width="18" height="6" fill="#0b1638"/>${light(125, 137)}`;
  } else if (kind === "DG") {
    let louv = ""; for (let i = 0; i < 7; i++) louv += `<rect x="${136 + i * 9}" y="62" width="5" height="44" rx="1" fill="#2b341b"/>`;
    body = `${shadow(122, 112)}${box(22, 46, 176, 88, 30, `url(#${u}g)`, `url(#${u}gs)`, "#6f7f4a")}
      <rect x="34" y="58" width="42" height="68" rx="2" fill="#4a5830" stroke="#2b341b"/><circle cx="70" cy="94" r="2.4" fill="#c9d3a6"/>
      <rect x="84" y="60" width="38" height="28" rx="2" fill="#0f1a10" stroke="#2b341b"/><rect x="88" y="64" width="30" height="10" fill="${on ? "#123f2c" : "#1d2414"}"/>
      <text x="103" y="72" text-anchor="middle" font-size="7" font-family="monospace" fill="${on ? "#2de2a6" : "#77805a"}">${on ? "RUN" : "STOP"}</text>${light(94, 82)}${light(110, 82)}${louv}
      <rect x="168" y="18" width="10" height="28" fill="#5d6574"/><rect x="166" y="14" width="14" height="6" rx="1" fill="#454c59"/>
      ${on ? `<g class="eqsmoke"><circle cx="173" cy="8" r="5" fill="#9aa3b5" opacity=".35"/><circle cx="181" cy="0" r="7" fill="#9aa3b5" opacity=".22"/></g>` : ""}
      <text x="40" y="54" font-size="8" font-weight="700" fill="#c9d3a6" letter-spacing="1">GENSET 100kW</text>`;
  } else if (kind === "FC") {
    const tank = x => `<rect x="${x}" y="40" width="20" height="96" rx="10" fill="url(#${u}cy)"/><rect x="${x + 6}" y="32" width="8" height="10" rx="2" fill="#7486a5"/><text x="${x + 10}" y="96" text-anchor="middle" font-size="7" font-weight="700" fill="#2b5fa8" transform="rotate(-90 ${x + 10} 96)">H₂</text>`;
    body = `${shadow(128, 116)}${tank(16)}${tank(40)}${tank(64)}<path d="M74 34 V26 H112 V58" stroke="#a9b6cc" stroke-width="3" fill="none"/>
      ${box(104, 50, 112, 86, 24, `url(#${u}m)`, `url(#${u}s)`, "#eef3fb")}
      <rect x="116" y="62" width="40" height="64" rx="2" fill="#c3cde0" stroke="#8e9cb8"/><rect x="164" y="62" width="40" height="64" rx="2" fill="#c3cde0" stroke="#8e9cb8"/>
      <rect x="122" y="68" width="28" height="16" rx="2" fill="#0b1638"/><text x="136" y="79" text-anchor="middle" font-size="7" font-family="monospace" fill="${on ? "#2de2c8" : "#55648a"}">${on ? (st.value ?? "--") + "kW" : "IDLE"}</text>
      ${light(136, 98)}<circle cx="184" cy="94" r="14" fill="none" stroke="#8e9cb8" stroke-width="2"/><g class="${on ? "eqspin" : ""}" style="transform-origin:184px 94px"><path d="M184 82v24M172 94h24M175.5 85.5l17 17M192.5 85.5l-17 17" stroke="#6c7a96" stroke-width="2"/></g>
      <text x="110" y="47" font-size="8" font-weight="700" fill="#2de2c8" letter-spacing="1">PEMFC 100kW</text>`;
  } else if (kind === "ESS") {
    let racks = ""; for (let i = 0; i < 5; i++) racks += `<rect x="${34 + i * 28}" y="60" width="24" height="70" rx="1.5" fill="#d3dbea" stroke="#8e9cb8"/><rect x="${38 + i * 28}" y="66" width="16" height="4" fill="${on ? "#a07cff" : "#6c7a96"}"/><circle cx="${46 + i * 28}" cy="120" r="1.6" fill="#6c7a96"/>`;
    const soc = Math.max(0, Math.min(100, st.value || 0));
    body = `${shadow(124, 114)}${box(22, 48, 160, 90, 30, `url(#${u}m)`, `url(#${u}s)`, "#f4f7fd")}${racks}
      <rect x="196" y="58" width="26" height="44" rx="2" fill="#7f8daa"/><circle cx="209" cy="80" r="9" fill="#46536e"/><g class="${on ? "eqspin" : ""}" style="transform-origin:209px 80px"><path d="M209 72v16M201 80h16" stroke="#c9d3e6" stroke-width="2"/></g>
      <rect x="30" y="26" width="58" height="14" rx="3" fill="#0b1638"/><rect x="32" y="28" width="${54 * soc / 100}" height="10" rx="2" fill="#a07cff"/><text x="94" y="37" font-size="9" font-weight="700" fill="#cdbbff">${soc.toFixed(0)}%</text>
      ${light(160, 36)}<text x="122" y="56" font-size="8" font-weight="700" fill="#46536e" letter-spacing="1">BESS 1MWh</text>`;
  } else if (kind === "MTR") {
    body = `${shadow(130, 100)}${box(48, 30, 120, 108, 26, `url(#${u}m)`, `url(#${u}s)`, "#eef3fb")}
      <rect x="60" y="42" width="96" height="40" rx="3" fill="#0b1638"/><path d="M66 74 L80 64 L92 70 L106 54 L120 60 L134 50 L150 56" stroke="#3d8bff" stroke-width="2" fill="none"/>
      <text x="66" y="54" font-size="8" font-family="monospace" fill="#2de2c8">${st.value ?? "--"} kW</text>
      ${[0, 1, 2].map(i => `<circle cx="${76 + i * 32}" cy="104" r="11" fill="#f4f7fd" stroke="#8e9cb8"/><path d="M${76 + i * 32} 104 l${[5, -4, 6][i]} -6" stroke="#ff4d64" stroke-width="1.6"/>`).join("")}
      ${light(70, 128)}<rect x="88" y="124" width="60" height="6" rx="3" fill="#8e9cb8"/>
      <path d="M200 40 v90 M190 50 h20 M194 64 h12" stroke="#7f8daa" stroke-width="3"/><circle cx="200" cy="34" r="6" fill="#c9d3e6"/>`;
  } else {
    body = `${shadow(130, 112)}${box(28, 54, 170, 82, 28, `url(#${u}g)`, `url(#${u}gs)`, "#6f7f4a")}
      <rect x="44" y="70" width="34" height="62" rx="2" fill="#3e4a28" stroke="#2b341b"/><rect x="92" y="72" width="40" height="22" rx="2" fill="${on ? "#ffe08a" : "#20280f"}" opacity=".9"/><rect x="142" y="72" width="40" height="22" rx="2" fill="${on ? "#ffe08a" : "#20280f"}" opacity=".9"/>
      <path d="M80 54 L96 30 L180 30 L196 54" fill="#55643a"/><rect x="150" y="20" width="4" height="14" fill="#7f8daa"/>${light(152, 18)}`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="eqsvg ${st.lost ? "eqlost" : ""}" role="img" aria-label="${kind}">${defs}${body}${st.lost ? `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#hatchEq)" opacity=".0"/><text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="16" font-weight="800" fill="#ff4d64" letter-spacing="2">COMM LOSS</text>` : ""}</svg>`;
}
