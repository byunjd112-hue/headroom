/* IFPS Mobile EMS HMI — 화면 */
"use strict";
const MODE_TXT = { island: ["자립 운전", "ISLAND"], grid: ["계통 연계", "GRID-TIED"], direct: ["직결 운전", "DIRECT"] };
const LINK_CLS = { "정상": "ok", "경로 저하": "warn", "두절": "bad", "재조회 대기": "info" };
const LINK_EN = { "정상": "NORMAL", "경로 저하": "DEGRADED", "두절": "LOST", "재조회 대기": "RESYNC" };
const linkTxt = s => S.lang === "ko" ? s : (LINK_EN[s] || s);
const kv = (o, k, d = null) => (o && o[k] !== undefined && o[k] !== null) ? o[k] : d;
const val = tag => kv(S.snap && S.snap.values[tag], "v");

/* ════════════════ 머리띠·경보 띠 */
function renderHeader() {
  const s = S.snap; if (!s) return;
  $("#site").textContent = `${s.site} · ${s.sim ? "SIMULATION" : "LIVE PLANT"}`;
  const m = MODE_TXT[s.mode] || [s.mode, s.mode]; const devs = Object.values(s.devices); const nOk = devs.filter(d => d.link === "정상").length; const nLost = devs.filter(d => d.link === "두절").length;
  $("#chips").innerHTML = [
    `<span class="chip info"><span class="dot"></span>${S.lang === "ko" ? m[0] : m[1]}</span>`,
    `<span class="chip ${s.auto ? "ok" : "warn"}"><span class="dot"></span>${s.auto ? (S.lang === "ko" ? "자동 제어" : "AUTO DISPATCH") : (S.lang === "ko" ? "수동 운전" : "MANUAL")}</span>`,
    `<span class="chip ${nLost ? "bad" : nOk === devs.length ? "ok" : "warn"}"><span class="dot"></span>${S.lang === "ko" ? "통신" : "COMMS"} ${nOk}/${devs.length}</span>`,
    `<span class="chip ${s.run_mode === "운용" ? "ok" : "warn"}"><span class="dot"></span>${s.run_mode === "운용" ? (S.lang === "ko" ? "운용" : "OPERATIONAL") : (S.lang === "ko" ? "개발 모드" : "DEV MODE")}</span>`,
    s.sim ? `<span class="chip sim"><span class="dot"></span>SIM</span>` : "",
  ].join("");
  const c = s.alarm_cnt; $("#almsum").innerHTML = [1, 2, 3, 4].map(p => { const n = c[p].unack, a = c[p].act; return `<div class="pc p${p} ${n || a ? "on" : ""} ${n && p <= 2 ? "blink" : ""}" title="${prioTxt(p)} — 미확인 ${n} / 발생 ${a}" onclick="location.hash='#alarms'">${n || a || 0}</div>`; }).join("");
  const unack = s.alarms.filter(a => !a.acked); const nb = $("#nb-alm"); nb.hidden = !unack.length; nb.textContent = unack.length;
  const top = unack[0] || s.alarms[0];
  $("#topalm").innerHTML = top ? `<span class="pr p${top.prio}">${top.prio}</span><span class="mono muted">${F.time(top.t_on)}</span><span class="muted">${esc(top.src)}</span><span class="txt">${esc(top.text)}</span>${top.state === "RTN" ? `<span class="pill">복귀</span>` : ""}` : `<span class="okc">● ${S.lang === "ko" ? "발생 경보 없음" : "No active alarms"}</span>`;
  $("#ackTop").disabled = !(top && !top.acked); $("#ackTop").onclick = () => ack([top.id]);
  $("#ver").textContent = `RT ${s.version.rt} · CORE ${s.version.core}`;
}
function renderUser() {
  const u = $("#user");
  u.innerHTML = S.me.role === "viewer" ? `<button class="btn" onclick="loginDialog()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>${t("btn.login", "로그인")}</button>`
    : `<span class="pill ${S.me.role === "engineer" ? "eng" : "ok"}">${S.me.role === "engineer" ? "ENGINEER" : "OPERATOR"}</span><span>${esc(S.me.name)}</span><button class="btn sm ghost" onclick="logout()">${t("btn.logout", "로그아웃")}</button>`;
}
setInterval(() => { const d = new Date(); $("#clk").textContent = d.toTimeString().slice(0, 8); $("#dtg").textContent = "DTG " + F.dtg(d); }, 250);
async function ack(ids) { if (!can("operator")) return loginDialog(); const r = await api("/api/ack", { ids }); if (r.ok) toast(`경보 ${r.n}건 확인`, "ok"); poll(); }

/* ════════════════ 1. 개요 */
const SRC = [
  { id: "PV", name: "태양광 PV", en: "SOLAR PV", x: 110, col: "pv", kw: "PV.kw", sub: "80kWp × 5" },
  { id: "DG", name: "디젤 발전기", en: "DIESEL GEN", x: 300, col: "dg", kw: "DG.kw", sub: "100kW" },
  { id: "FC", name: "수소 연료전지", en: "FUEL CELL", x: 490, col: "fc", kw: "FC.kw", sub: "100kW" },
  { id: "ESS", name: "ESS (PCS)", en: "ESS (PCS)", x: 680, col: "ess", kw: "ESS.kw", sub: "1,000kWh / 500kW" },
  { id: "G1", name: "복합전력 G1", en: "HYBRID G1", x: 870, col: "g1", kw: null, sub: "100kW" },
];
const LOADS = [{ id: "L1", name: "1등급 필수 부하", en: "CLASS 1 · CRITICAL", x: 200, kw: "LOAD.p1_kw" }, { id: "L2", name: "2등급 중요 부하", en: "CLASS 2 · ESSENTIAL", x: 500, kw: "LOAD.p2_kw" }, { id: "L3", name: "3등급 일반 부하", en: "CLASS 3 · NON-ESSENTIAL", x: 800, kw: "LOAD.p3_kw" }];
const ICON = {
  PV: '<path d="M3 8h18l-2.2 9H5.2z"/><path d="M8.5 8 7.6 17M15.5 8l.9 9M4.1 12.5h15.8"/><path d="M12 17v3M8 20h8"/><circle cx="19" cy="3.6" r="1.6"/>',
  DG: '<rect x="3" y="8" width="13" height="10" rx="1.5"/><path d="M16 11h3v4h-3M6 8V5h5v3M10.2 10.5 8 13.5h3l-2.2 3"/>',
  FC: '<circle cx="7.5" cy="12" r="3.2"/><circle cx="16.5" cy="12" r="3.2"/><path d="M10.7 12h2.6M5.5 4.5v3M18.5 16.5v3"/>',
  ESS: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M19 10.5h2v3h-2M11.5 9 9 12.5h3.5L10 15.5"/>',
  G1: '<path d="M12 3 7.5 21M12 3l4.5 18M8.8 15.5h6.4M10 10.5h4M5 7.5h14M9 21h6"/>',
  L: '<path d="M4 21V9l6-3.5V21M10 21v-9.5h10V21M13 14.5h1.5M16.5 14.5H18M13 17.5h1.5M16.5 17.5H18M2.5 21h19"/>',
};
const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 180 * (60 * k - 90); return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(" ");
function sldSvg() {
  const hex = (n, cy, r, color, icon, isLoad) => `<g class="node" id="n-${n.id}">
    <polygon class="hexo" points="${hexPts(n.x, cy, r)}"/><polygon class="hexi" points="${hexPts(n.x, cy, r - 9)}"/>
    <g class="ico" stroke="${color}" transform="translate(${n.x - 19.2},${cy - 19.2}) scale(1.6)">${icon}</g>
    <text class="nm" x="${n.x}" y="${cy + r + 24}" text-anchor="middle">${S.lang === "ko" ? n.name : n.en}</text>
    <text x="${n.x}" y="${cy + r + 50}" text-anchor="middle"><tspan class="kw" id="kw-${n.id}">—</tspan><tspan class="u" dx="4">kW</tspan></text>
    <text class="st" x="${n.x}" y="${cy + r + 68}" text-anchor="middle" id="st-${n.id}" fill="var(--muted)">—</text>
    ${n.id === "ESS" ? `<rect x="${n.x - 55}" y="${cy + r + 78}" width="110" height="5" rx="2.5" fill="rgba(6,12,34,.9)"/><rect x="${n.x - 55}" y="${cy + r + 78}" width="0" height="5" rx="2.5" fill="var(--ess)" id="socbar"/><text class="u" id="sub-ESS" x="${n.x}" y="${cy + r + 97}" text-anchor="middle"></text>`
      : isLoad ? "" : `<text class="tag" x="${n.x}" y="${cy + r + 86}" text-anchor="middle" id="tg-${n.id}" fill="var(--muted)">${n.sub || ""}</text>`}
  </g>`;
  const SY = 78, R = 50, BUS = 300, LY = 410, LR = 44;
  const src = SRC.map(n => `<path class="wire" id="w-${n.id}" d="M${n.x} ${SY + R + 104} V${BUS}"/><path class="flow" id="f-${n.id}" d="M${n.x} ${SY + R + 106} V${BUS - 4}" stroke="var(--${n.col})"/>
    <rect class="cb closed" id="cb-${n.id}" x="${n.x - 6}" y="${BUS - 32}" width="12" height="12" rx="3"/>${hex(n, SY, R, `var(--${n.col})`, ICON[n.id], false)}`).join("");
  const lds = LOADS.map((n, i) => `<path class="wire live" d="M${n.x} ${BUS} V${LY - LR}"/><path class="flow" id="f-${n.id}" d="M${n.x} ${BUS + 4} V${LY - LR - 2}" stroke="var(--load)"/>
    <rect class="cb closed" x="${n.x - 6}" y="${BUS + 22}" width="12" height="12" rx="3"/>${hex(n, LY, LR, ["#ff6b8a", "#ffb547", "#3d8bff"][i], ICON.L, true)}`).join("");
  return `<svg class="sld" viewBox="0 0 1000 530" preserveAspectRatio="xMidYMid meet">
    <defs><radialGradient id="hexFill" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#1d3a86"/><stop offset="1" stop-color="#0a1538"/></radialGradient>
      <linearGradient id="hexStroke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2de2c8"/><stop offset="1" stop-color="#3d6bff"/></linearGradient>
      <linearGradient id="busGrad" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="960" y2="0"><stop offset="0" stop-color="#2de2c8" stop-opacity=".2"/><stop offset=".5" stop-color="#5aa8ff"/><stop offset="1" stop-color="#2de2c8" stop-opacity=".2"/></linearGradient>
      <filter id="glow" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="530"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${src}<line class="bus" x1="40" y1="${BUS}" x2="960" y2="${BUS}"/><text class="buslbl" x="44" y="${BUS + 22}">${S.lang === "ko" ? "AC 주 모선" : "AC MAIN BUS"}</text>${lds}</svg>`;
}
function setFlow(id, kw, cap) {
  const f = document.getElementById("f-" + id); if (!f) return; const a = Math.abs(kw || 0);
  if (a < 0.5) { f.style.opacity = 0; return; } f.style.opacity = .95;
  f.style.animationDuration = Math.max(0.35, 2.6 - 2.2 * Math.min(1, a / (cap || 100))) + "s"; f.style.animationDirection = kw < 0 ? "reverse" : "normal";
  f.style.strokeWidth = 2 + 3 * Math.min(1, a / (cap || 100));
}
const P_OV = {
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("ov.title", "운전 개요")}</h2><span class="sub" id="ovSub"></span></div>
    <div class="tiles">
      <div class="panel tile"><div class="lab"><i style="background:var(--load)"></i>${t("k.load", "총 부하")}</div><div class="big" id="tLoad">—<small>kW</small></div><div class="foot"><span id="tL12"></span><span id="tL3"></span></div></div>
      <div class="panel tile"><div class="lab"><i style="background:var(--pv)"></i>${t("k.pv", "태양광 발전")}</div><div class="big" id="tPv">—<small>kW</small></div><div class="foot"><span id="tRen"></span><span id="tPvCap"></span></div></div>
      <div class="panel tile"><div class="lab"><i style="background:var(--ess)"></i>${t("k.soc", "ESS 충전율")}</div><div class="big" id="tSoc">—<small>%</small></div><div class="foot"><span id="tEssKw"></span><span id="tEssH"></span></div></div>
      <div class="panel tile"><div class="lab"><i style="background:var(--g1)"></i>${t("ov.reserve", "N-1 순동 예비력")}</div><div class="big" id="tRes">—<small>kW</small></div><div class="foot"><span id="tResSt"></span><span id="tOnl"></span></div></div>
    </div>
    <div class="grid ov">
      <div class="grid" style="align-content:start">
        <div class="panel"><div class="hd"><h3>${t("ov.sld", "단선 결선도 · 실시간 전력 흐름")}</h3><span class="sub mono" id="busbal"></span><div class="spacer"></div><div class="legend"><span><i style="background:var(--pv)"></i>PV</span><span><i style="background:var(--dg)"></i>DG</span><span><i style="background:var(--fc)"></i>FC</span><span><i style="background:var(--ess)"></i>ESS</span></div></div>
          <div class="bd" style="padding:6px 10px 10px">${sldSvg()}</div></div>
        <div class="panel"><div class="hd"><h3>${t("ov.trend", "전력 추세 · 15분")}</h3><div class="spacer"></div><div class="legend" id="ovLeg"></div></div><div class="bd"><canvas class="chart" id="ovChart"></canvas></div></div>
      </div>
      <div class="right">
        <div class="panel"><div class="hd"><h3>${t("ov.balance", "전력 수급")}</h3><div class="spacer"></div><span class="pill" id="balPill">—</span></div><div class="bd">
          <div style="display:flex;justify-content:space-between;align-items:flex-end"><div><div class="lab">${t("k.gen", "공급")}</div><div class="mid" id="bGen">—</div></div><div style="text-align:right"><div class="lab">${t("k.load", "소비")}</div><div class="mid" id="bLoad">—</div></div></div>
          <div class="stack" style="margin-top:10px" id="bStack"></div><div class="legend" style="margin-top:8px" id="bLeg"></div></div></div>
        <div class="panel"><div class="hd"><h3>${t("ov.ess", "에너지 저장")}</h3><div class="spacer"></div><span class="pill" id="essPill">—</span></div><div class="bd">
          <div class="ring gauge" id="socRing"></div>
          <div class="stbtns" id="essSt"></div>
          <div class="kv band" style="margin-top:12px"><span class="k">출력</span><span class="v" id="eKw">—</span><span class="k">가용 에너지</span><span class="v" id="eKwh">—</span><span class="k">자립 시간</span><span class="v" id="eH">—</span><span class="k">운전 범위</span><span class="v" id="eRng">—</span></div></div></div>
        <div class="panel"><div class="hd"><h3>${t("ov.fuel", "연료 · 수소")}</h3></div><div class="bd" style="display:grid;gap:12px">
          <div><div style="display:flex;justify-content:space-between"><span class="lab">${t("k.fuel", "디젤 연료")}</span><span class="mono" id="fuelV">—</span></div><div class="bar" style="margin-top:6px"><i id="fuelB" style="background:var(--dg)"></i></div><div class="muted" style="font-size:12px;margin-top:4px" id="fuelH"></div></div>
          <div><div style="display:flex;justify-content:space-between"><span class="lab">${t("k.h2", "수소 저장")}</span><span class="mono" id="h2V">—</span></div><div class="bar" style="margin-top:6px"><i id="h2B" style="background:var(--fc)"></i></div><div class="muted" style="font-size:12px;margin-top:4px" id="h2H"></div></div></div></div>
        <div class="panel"><div class="hd"><h3>${t("ov.auto", "자동 제어")}</h3><div class="spacer"></div><span class="pill" id="autoPill">—</span></div><div class="bd"><div class="kv band" id="autoKv"></div></div></div>
        <div class="panel"><div class="hd"><h3>${t("ov.env", "쉘터 환경")}</h3></div><div class="bd" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
          <div><div class="lab">기온</div><div class="mid" id="enT">—</div></div><div><div class="lab">기압</div><div class="mid" id="enP">—</div></div><div><div class="lab">습도</div><div class="mid" id="enH">—</div></div></div></div>
      </div></div>`;
    this.chart = new Chart($("#ovChart"), { height: 210, window: 900, series: [{ key: "load", label: "부하", color: COLORS.load, w: 2.2 }, { key: "pv", label: "PV", color: COLORS.pv, fill: true }, { key: "dg", label: "DG", color: COLORS.dg, fill: true }, { key: "fc", label: "FC", color: COLORS.fc, fill: true }, { key: "ess", label: "ESS", color: COLORS.ess }] });
    $("#ovLeg").innerHTML = this.chart.o.series.map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join("");
  },
  update(s) {
    const k = s.kpi, D = s.devices, site = {}; const devOk = n => D[n] && D[n].link !== "두절";
    $("#ovSub").textContent = `${s.policy} · ${S.lang === "ko" ? "수집" : "scan"} ${F.n(s.stats.last_ms, 0)}ms`;
    $("#tLoad").innerHTML = `${F.kw(k.load)}<small>kW</small>`; $("#tL12").textContent = `1+2등급 ${F.kw(k.l1 + k.l2)}kW`; $("#tL3").textContent = `3등급 ${F.kw(k.l3)}kW`;
    $("#tPv").innerHTML = `${F.kw(k.pv)}<small>kW</small>`; $("#tRen").textContent = `${t("k.renew", "재생 비율")} ${F.n(k.renew, 0)}%`; $("#tPvCap").textContent = `${F.n(k.pv / 4, 0)}% of 400kWp`;
    const bad = tag => !!(s.values[tag] && s.values[tag].f);                    // 품질 이상(범위 밖·갱신 지연) → 흐리게 표시
    $("#tSoc").innerHTML = `${F.n(k.soc)}<small>%</small>`; $("#tSoc").className = "big " + (bad("ESS.soc") ? "stale" : k.soc < 19 ? "badc" : k.soc < 25 ? "warnc" : "");
    $("#tLoad").classList.toggle("stale", bad("LOAD.kw")); $("#tPv").classList.toggle("stale", bad("PV.kw"));
    $("#tEssKw").textContent = k.ess >= 0 ? `방전 ${F.kw(k.ess)}kW` : `충전 ${F.kw(-k.ess)}kW`; $("#tEssH").textContent = k.ess_h ? `자립 ${F.hrs(k.ess_h)}h` : "충전 중";
    $("#tRes").innerHTML = `${k.reserve_margin >= 0 ? "+" : ""}${F.n(k.reserve_margin, 0)}<small>kW</small>`; $("#tRes").className = "big " + (k.reserve_need ? "warnc" : "okc");
    $("#tResSt").textContent = k.reserve_need ? t("k.need", "예비력 부족 → FC 병렬") : t("k.ok", "N-1 만족"); $("#tOnl").textContent = `병렬 ${k.online_kw.length}대`;
    // 결선도
    const st = (id, txt, col) => { const e = $("#st-" + id); if (e) { e.textContent = txt; e.setAttribute("fill", col); } };
    const pk = { PV: k.pv, DG: k.dg, FC: k.fc, ESS: k.ess };
    SRC.forEach(n => {
      const g = $("#n-" + n.id); const lost = n.id === "PV" ? !devOk("MTR") : n.id === "G1" ? false : !devOk(n.id);
      if (n.kw) $("#kw-" + n.id).textContent = lost ? "####" : F.kw(pk[n.id]);
      const on = n.id === "PV" ? k.pv > 0.5 : n.id === "ESS" ? (val("ESS.status") > 0.5) : n.id === "G1" ? true : (D[n.id] && D[n.id].on);
      g.classList.toggle("lost", lost); g.classList.toggle("on", !!on && !lost); g.classList.toggle("off", !on && !lost);
      const cb = $("#cb-" + n.id); cb.setAttribute("class", "cb " + (lost ? "unk" : (on || n.id === "PV" || n.id === "G1") ? "closed" : "open"));
      $("#w-" + n.id).setAttribute("class", "wire" + (on && !lost ? " live" : ""));
      if (lost) st(n.id, S.lang === "ko" ? "통신 두절" : "COMM LOSS", "var(--alarm)");
      else if (n.id === "PV") st(n.id, k.pv > 0.5 ? (S.lang === "ko" ? "발전 중" : "GENERATING") : (S.lang === "ko" ? "발전 없음" : "IDLE"), k.pv > 0.5 ? "var(--pv)" : "var(--muted)");
      else if (n.id === "ESS") st(n.id, k.ess > 0.5 ? (S.lang === "ko" ? "방전" : "DISCHARGING") : k.ess < -0.5 ? (S.lang === "ko" ? "충전" : "CHARGING") : (S.lang === "ko" ? "대기" : "STANDBY"), "var(--ess)");
      else if (n.id === "G1") st(n.id, S.lang === "ko" ? "계통 형성" : "GRID-FORMING", "var(--g1)");
      else st(n.id, on ? (S.lang === "ko" ? "운전" : "RUNNING") : (S.lang === "ko" ? "정지" : "STOPPED"), on ? "var(--ok)" : "var(--muted)");
      const tg = $("#tg-" + n.id); if (tg && D[n.id] && D[n.id].ctl) { tg.textContent = D[n.id].manual ? "LOCAL · MANUAL" : "REMOTE · AUTO"; tg.setAttribute("fill", D[n.id].manual ? "var(--warn)" : "var(--muted)"); }
      setFlow(n.id, lost ? 0 : (n.id === "G1" ? 0 : pk[n.id]), n.id === "PV" ? 400 : n.id === "ESS" ? 300 : 100);
    });
    $("#socbar").setAttribute("width", 110 * Math.max(0, Math.min(1, k.soc / 100)));
    $("#sub-ESS").textContent = `SOC ${F.n(k.soc, 1)}%`;
    LOADS.forEach(n => { $("#kw-" + n.id).textContent = devOk("MTR") ? F.kw(val(n.kw)) : "####"; st(n.id, S.lang === "ko" ? "급전 중" : "ENERGIZED", "var(--ok)"); setFlow(n.id, val(n.kw), 150); });
    const bal = k.gen - k.load; $("#busbal").textContent = `Σ${S.lang === "ko" ? "공급" : "GEN"} ${F.kw(k.gen)} · Σ${S.lang === "ko" ? "부하" : "LOAD"} ${F.kw(k.load)} kW`;
    // 수급
    $("#bGen").textContent = F.kw(k.pv + k.dg + k.fc + Math.max(0, k.ess)) + " kW"; $("#bLoad").textContent = F.kw(k.load) + " kW";
    const parts = [["PV", k.pv, "pv"], ["DG", k.dg, "dg"], ["FC", k.fc, "fc"], ["ESS", Math.max(0, k.ess), "ess"]]; const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
    $("#bStack").innerHTML = parts.map(p => `<i style="width:${p[1] / tot * 100}%;background:var(--${p[2]})" title="${p[0]} ${F.kw(p[1])}kW"></i>`).join("");
    $("#bLeg").innerHTML = parts.map(p => `<span><i style="background:var(--${p[2]})"></i>${p[0]} ${F.n(p[1] / tot * 100, 0)}%</span>`).join("");
    $("#balPill").className = "pill " + (k.ess < -0.5 ? "info" : "ok"); $("#balPill").textContent = k.ess < -0.5 ? `잉여 ${F.kw(-k.ess)}kW → ESS` : "수급 균형";
    // ESS
    $("#socRing").innerHTML = gauge(k.soc, 260) + `<div class="c" style="top:78px"><div class="mid">${F.n(k.soc, 1)}<small style="font-size:16px;color:var(--muted)">%</small></div><div class="lab">SOC</div></div>`;
    const est = !devOk("ESS") ? "off" : val("ESS.status") < 0.5 ? "off" : k.ess < -0.5 ? "chg" : k.ess > 0.5 ? "dis" : "idle";
    $("#essSt").innerHTML = [["chg", "충전 중", '<path d="M7 7h-.5A3.5 3.5 0 0 0 3 10.5v3A3.5 3.5 0 0 0 6.5 17H7M17 7h.5a3.5 3.5 0 0 1 3.5 3.5v3a3.5 3.5 0 0 1-3.5 3.5H17M13 5l-3 7h4l-3 7"/>'], ["dis", "방전 중", '<rect x="3" y="8" width="16" height="8" rx="2"/><path d="M19 11h2v2h-2"/><rect x="5" y="10" width="4" height="4" fill="currentColor"/>'],
      ["idle", "대기 중", '<circle cx="12" cy="12" r="8"/><path d="M10 9v6M14 9v6"/>'], ["off", "정지", '<circle cx="12" cy="12" r="8"/><rect x="9" y="9" width="6" height="6" rx="1"/>']].map(([k2, l, ic]) => `<div class="${est === k2 ? "on" : ""}"><svg viewBox="0 0 24 24">${ic}</svg>${l}</div>`).join("");
    $("#eKw").textContent = `${k.ess >= 0 ? "+" : ""}${F.kw(k.ess)} kW`; $("#eKwh").textContent = `${F.n(Math.max(0, (k.soc / 100 - 0.15) * 1000), 0)} kWh`;
    $("#eH").textContent = k.ess_h ? `${F.hrs(k.ess_h)} h` : "—"; $("#eRng").textContent = "15 – 90 %";
    $("#essPill").className = "pill " + (devOk("ESS") ? (k.soc < 25 ? "warn" : "ok") : "bad"); $("#essPill").textContent = devOk("ESS") ? (k.ess < -0.5 ? "충전" : k.ess > 0.5 ? "방전" : "대기") : "두절";
    // 연료·수소
    $("#fuelV").textContent = `${F.n(k.fuel, 0)} / 2,000 L`; $("#fuelB").style.width = Math.min(100, k.fuel / 20) + "%"; $("#fuelH").textContent = `정격 운전 시 ${F.hrs(k.fuel_h)}시간`;
    $("#h2V").textContent = `${F.n(k.h2, 0)} / 1,000 Nm³`; $("#h2B").style.width = Math.min(100, k.h2 / 10) + "%"; $("#h2H").textContent = `연료전지 정격 ${F.hrs(k.h2_h)}시간 · 하한 100Nm³`;
    // 자동 제어
    const d = s.decision; $("#autoPill").className = "pill " + (s.auto ? "ok" : "warn"); $("#autoPill").textContent = s.auto ? "AUTO" : "MANUAL";
    $("#autoKv").innerHTML = `<span class="k">정책</span><span class="v" style="font-family:var(--sans)">${esc(s.policy)}</span>
      <span class="k">다음 제어</span><span class="v">${s.auto ? F.n(s.next_ctrl_s, 0) + " s" : "—"} / ${F.n(s.ctrl_s, 0)} s</span>
      <span class="k">최근 결정</span><span class="v">${d ? `DG ${d.want.DG ? "ON" : "OFF"} · FC ${d.want.FC ? "ON" : "OFF"}${d.reserve ? " (예비력)" : ""}` : "—"}</span>
      <span class="k">결정 시각</span><span class="v">${d ? d.t.slice(11) : "—"}</span>`;
    $("#enT").textContent = F.n(k.temp) + "°C"; $("#enP").textContent = F.n(k.press, 0) + " hPa"; $("#enH").textContent = F.n(k.rh, 0) + "%";
    this.chart.set(["t", "load", "pv", "dg", "fc", "ess", "soc", "h2", "reserve"], S.trend);
  },
};

/* ════════════════ 2. 설비 제어 */
const DEVINFO = { DG: ["디젤 발전기", "Diesel generator · 100kW", "dg"], FC: ["수소 연료전지", "PEM fuel cell · 100kW", "fc"], ESS: ["ESS 전력변환장치", "Battery PCS · 1,000kWh / 500kW", "ess"], MTR: ["계측기 · 환경 센서", "Power meter & shelter sensors", "load"] };
const P_CTL = {
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("ctl.title", "설비 제어")}</h2><span class="sub">모든 지령은 선택-실행(SBO) 2단계 · 연동 조건 확인 · 응답(순번 되돌림) 확인 · 감사 기록</span></div>
    <div class="grid ctl"><div class="grid" style="align-content:start"><div class="devs" id="devs"></div>
      <div class="panel"><div class="hd"><h3>${t("ctl.log", "지령 기록")}</h3><div class="spacer"></div><span class="sub" id="qInfo"></span></div><div class="bd np scroll h420"><table class="t"><thead><tr><th>시각</th><th>운용자</th><th>장치</th><th>지령</th><th>결과</th><th>내용</th></tr></thead><tbody id="cmdlog"></tbody></table></div></div></div>
      <div class="grid" style="align-content:start">
        <div class="panel"><div class="hd"><h3>${t("ctl.auto", "자동 제어 (EMS 급전)")}</h3></div><div class="bd">
          <div style="display:flex;gap:8px;align-items:center"><div class="seg" id="autoSeg"><button data-v="1">AUTO</button><button data-v="0">MANUAL</button></div><div class="spacer"></div><button class="btn" id="ctlNow">제어 즉시 실행</button></div>
          <div class="kv band" style="margin-top:14px" id="ctlKv"></div><div class="interlock" id="ctlNote"></div></div></div>
        <div class="panel"><div class="hd"><h3>지령 연동 조건</h3></div><div class="bd" style="font-size:12.5px;color:var(--text2);line-height:1.7">
          ① 통신 두절 장치 지령 금지 &nbsp;② 현장 수동 모드 차단 &nbsp;③ 작업 잠금 차단 &nbsp;④ 중복 지령(운전 중 기동 등) 차단<br>
          ⑤ 응답 한도 <b class="mono">1.5 s</b>, 재지령 <b class="mono">1</b>회 → 실패 시 대체 전원(DG↔FC) 자동 지령·경보<br>⑥ 선택 후 <b class="mono">10 s</b> 안에 실행하지 않으면 선택 해제</div></div>
        <div class="panel"><div class="hd"><h3>현장 실행 보호 계층</h3></div><div class="bd np"><table class="t"><tbody>
          <tr><td>디젤 강제 기동</td><td class="muted">충전율 &lt; 하한 + 4%p</td></tr><tr><td>N-1 순동 예비력</td><td class="muted">(Σ병렬 − 최대 1대) &lt; 1·2등급 부하 → FC 병렬</td></tr>
          <tr><td>보호 차단·우회 복구</td><td class="muted">보호 IED·절체기 수행(EMS 지령 없음)</td></tr><tr><td>수소 한계</td><td class="muted">하한 10% 미만 → FC·수전해 정지</td></tr></tbody></table></div></div>
      </div></div>`;
    $$("#autoSeg button").forEach(b => b.onclick = async () => { if (!can("operator")) return loginDialog(); const on = b.dataset.v === "1"; if (!on && !confirm("자동 제어를 해제하고 수동 운전으로 전환합니까?")) return; const r = await api("/api/auto", { on }); if (r.ok) toast(`자동 제어 ${on ? "설정" : "해제"}`, "ok"); poll(); });
    $("#ctlNow").onclick = async () => { if (!can("operator")) return loginDialog(); const r = await api("/api/control_now", {}); if (r.ok) toast("제어 주기 즉시 실행", "ok"); };
    this.built = false;
  },
  build(s) {
    $("#devs").innerHTML = Object.keys(s.devices).map(n => {
      const [ko, en, col] = DEVINFO[n] || [n, "", "load"]; const ctl = s.devices[n].ctl;
      return `<div class="panel dev" id="dv-${n}"><div class="hd"><span class="lamp" id="lp-${n}"></span><h3 style="color:var(--text)">${n} · ${ko}</h3><div class="spacer"></div><span class="pill" id="lk-${n}">—</span></div>
      <div class="bd"><div class="muted" style="font-size:12px;margin:-4px 0 8px">${en}</div><div class="row"><div><div class="lab">출력</div><div class="big" id="kw2-${n}" style="color:var(--${col})">—</div></div><div class="spacer"></div><div style="text-align:right"><div class="lab">상태</div><div class="mid" id="sx-${n}">—</div></div></div>
      <div class="meta" id="mt-${n}"></div>
      ${ctl ? `<div class="acts"><button class="btn go" data-c="start" data-d="${n}">▶ ${t("btn.start", "기동")}</button><button class="btn stop" data-c="stop" data-d="${n}">■ ${t("btn.stop", "정지")}</button>
        ${n === "FC" ? `<div class="spacer"></div><input class="in" id="fcSp" type="number" min="0" max="100" step="5" style="width:80px" placeholder="kW"><button class="btn" id="fcSet">출력 설정</button>` : ""}</div><div class="interlock" id="il-${n}"></div>` : `<div class="interlock muted" style="color:var(--muted)">감시 전용 — EMS는 지령하지 않음</div>`}</div></div>`;
    }).join("");
    $$("#devs [data-c]").forEach(b => b.onclick = () => sbo(b.dataset.d, b.dataset.c));
    const fs = $("#fcSet"); if (fs) fs.onclick = () => { const v = parseFloat($("#fcSp").value); if (!(v >= 0)) return toast("설정값을 입력하세요", "bad"); sbo("FC", "set", { tag: "FC.kw_set", value: v, label: `FC 출력 설정 ${v} kW` }); };
    this.built = true;
  },
  update(s) {
    if (!this.built) this.build(s);
    for (const [n, d] of Object.entries(s.devices)) {
      const lost = d.link === "두절"; $("#lp-" + n).className = "lamp " + (lost ? "lost" : d.on ? "on" : "");
      const lk = $("#lk-" + n); lk.className = "pill " + LINK_CLS[d.link]; lk.textContent = linkTxt(d.link);
      const kwTag = { DG: "DG.kw", FC: "FC.kw", ESS: "ESS.kw", MTR: "LOAD.kw" }[n]; $("#kw2-" + n).innerHTML = `${lost ? "####" : F.kw(val(kwTag))}<small>kW</small>`;
      $("#sx-" + n).innerHTML = lost ? `<span class="badc">통신 두절</span>` : n === "MTR" ? `<span class="okc">계측 중</span>` : d.on ? `<span class="okc">${n === "ESS" ? "운전" : "운전 중"}</span>` : `<span class="muted">정지</span>`;
      const meta = n === "DG" ? [["모드", d.manual ? "수동" : "자동"], ["연료", F.n(val("DG.fuel_l"), 0) + " L"], ["순번 ACK", F.n(d.seq_ack, 0)], ["생존 HB", F.n(d.hb, 0)]]
        : n === "FC" ? [["모드", d.manual ? "수동" : "자동"], ["수소", F.n(val("H2.nm3"), 0) + " Nm³"], ["순번 ACK", F.n(d.seq_ack, 0)], ["생존 HB", F.n(d.hb, 0)]]
          : n === "ESS" ? [["SOC", F.n(val("ESS.soc")) + " %"], ["방향", val("ESS.kw") < 0 ? "충전" : "방전"], ["생존 HB", F.n(d.hb, 0)], ["경로", Object.entries(d.paths).map(([k, p]) => k + (p.alive ? "●" : "○")).join(" ")]]
            : [["PV", F.kw(val("PV.kw")) + " kW"], ["기온", F.n(val("ENV.temp")) + " °C"], ["습도", F.n(val("ENV.rh"), 0) + " %"], ["경로", Object.entries(d.paths).map(([k, p]) => k + (p.alive ? "●" : "○")).join(" ")]];
      $("#mt-" + n).innerHTML = meta.map(([a, b]) => `<div><div class="lab">${a}</div><div class="v">${b}</div></div>`).join("");
      const il = $("#il-" + n); if (il) { il.textContent = lost ? "⚠ 통신 두절 — 지령 차단" : d.manual ? "⚠ 현장 수동 모드 — EMS 지령 차단" : (s.busy ? "지령 처리 중…" : ""); }
      $$(`#devs [data-d="${n}"]`).forEach(b => { b.disabled = !can("operator") || lost || d.manual || (b.dataset.c === "start" ? d.on : !d.on); });
    }
    $$("#autoSeg button").forEach(b => b.classList.toggle("on", (b.dataset.v === "1") === s.auto));
    const d = s.decision;
    $("#ctlKv").innerHTML = `<span class="k">운전 정책</span><span class="v" style="font-family:var(--sans)">${esc(s.policy)}</span><span class="k">제어 주기</span><span class="v">${F.n(s.ctrl_s, 0)} s</span>
      <span class="k">다음 제어까지</span><span class="v">${s.auto ? F.n(s.next_ctrl_s, 0) + " s" : "수동"}</span><span class="k">최근 결정</span><span class="v">${d ? `DG ${d.want.DG ? "ON" : "OFF"} / FC ${d.want.FC ? "ON" : "OFF"}` : "—"}</span>
      <span class="k">계획 결정(DG,FC,ELZ)</span><span class="v">${d ? "(" + d.action.join(", ") + ")" : "—"}</span><span class="k">예비력 규칙</span><span class="v">${d ? (d.reserve ? "작동 → FC 병렬" : "미작동") : "—"}</span>
      <span class="k">결정 시각 · 연산</span><span class="v">${d ? d.t.slice(11) + " · " + d.ms + "ms" : "—"}</span>`;
    $("#ctlNote").textContent = d && d.policy && d.policy.includes("실패") ? d.policy : "";
    $("#qInfo").textContent = s.busy ? `처리 중: ${s.busy} · 대기 ${s.queue}` : `대기 ${s.queue}`;
    $("#cmdlog").innerHTML = s.cmdlog.length ? s.cmdlog.map(e => `<tr><td class="mono">${esc((e.wall || "").slice(11))}</td><td>${esc(e.who || "EMS")}</td><td>${esc(e.dev)}</td><td class="mono">${esc(e.cmd)}</td><td>${e.ok ? `<span class="pill ok">성공</span>` : `<span class="pill bad">실패</span>`}</td><td>${esc(e.text)}</td></tr>`).join("") : `<tr><td colspan="6" class="empty">지령 기록 없음</td></tr>`;
  },
};

/* ════════════════ 3. 경보 */
const P_ALM = {
  tab: "list", sel: new Set(),
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("alm.title", "경보 관리")}</h2><span class="sub">ISA-18.2 형식 — 우선순위 · 발생/복귀 · 확인. 감사 기록은 연쇄 HMAC으로 변조를 검출</span></div>
    <div class="tabs" id="almTabs"><button data-t="list">${t("alm.active", "경보 목록")}</button><button data-t="journal">${t("alm.journal", "경보 이력")}</button><button data-t="audit">${t("alm.audit", "감사 기록")}</button></div><div id="almBody"></div>`;
    $$("#almTabs button").forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.show(); }); this.show();
  },
  show() {
    $$("#almTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === this.tab)); const B = $("#almBody");
    if (this.tab === "list") {
      B.innerHTML = `<div class="panel"><div class="hd"><div class="seg" id="almF"><button data-f="all" class="on">전체</button><button data-f="unack">미확인</button><button data-f="act">발생 중</button></div><div class="spacer"></div>
        <button class="btn" id="ackSel">${t("btn.acksel", "선택 확인")}</button><button class="btn pri" id="ackAll">${t("btn.ackall", "전체 확인")}</button></div>
        <div class="bd np scroll hfill"><table class="t"><thead><tr><th style="width:28px"><input type="checkbox" id="selAll"></th><th>우선</th><th>발생 시각</th><th>장치</th><th>내용</th><th>상태</th><th>복귀</th><th>확인</th></tr></thead><tbody id="almRows"></tbody></table></div></div>`;
      this.filter = "all"; $$("#almF button").forEach(b => b.onclick = () => { this.filter = b.dataset.f; $$("#almF button").forEach(x => x.classList.toggle("on", x === b)); this.update(S.snap); });
      $("#ackAll").onclick = () => ack("all"); $("#ackSel").onclick = () => { if (this.sel.size) ack([...this.sel]); this.sel.clear(); };
      $("#selAll").onchange = e => { this.sel = e.target.checked ? new Set(S.snap.alarms.map(a => a.id)) : new Set(); this.update(S.snap); };
      this.update(S.snap);
    } else if (this.tab === "journal") {
      B.innerHTML = `<div class="panel"><div class="hd"><h3>경보 이력 (최근 300건)</h3><div class="spacer"></div><button class="btn sm" id="jr">새로 고침</button></div><div class="bd np scroll hfill"><table class="t"><thead><tr><th>시각</th><th>구분</th><th>우선</th><th>장치</th><th>내용</th></tr></thead><tbody id="jrRows"></tbody></table></div></div>`;
      const load = async () => { const r = await api("/api/journal?n=300"); $("#jrRows").innerHTML = r.rows.map(e => `<tr><td class="mono">${F.dt(e.t)}</td><td><span class="pill ${e.ev === "발생" || e.ev === "재발생" ? "bad" : e.ev === "복귀" ? "ok" : "info"}">${e.ev}</span></td><td><span class="pr p${e.prio}">${e.prio}</span></td><td>${esc(e.src)}</td><td>${esc(e.text)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">이력 없음</td></tr>`; };
      $("#jr").onclick = load; load();
    } else {
      B.innerHTML = `<div class="panel"><div class="hd"><h3>감사 기록 (audit.log, 최근 200건)</h3><div class="spacer"></div><span id="avRes" class="sub"></span><button class="btn" id="av">${t("alm.verify", "무결성 검증")}</button><button class="btn sm" id="ar">새로 고침</button></div>
        <div class="bd np scroll hfill"><table class="t"><thead><tr><th class="n">순번</th><th>시각</th><th>주체</th><th>구분</th><th>내용</th><th>MAC</th></tr></thead><tbody id="auRows"></tbody></table></div></div>`;
      const load = async () => { const r = await api("/api/audit?n=200"); $("#auRows").innerHTML = r.rows.map(e => `<tr><td class="n">${e.seq}</td><td class="mono">${esc((e.ts || "").replace("T", " ").slice(0, 19))}</td><td>${esc(e.actor)}</td><td>${esc(e.kind)}</td><td>${esc((e.data && e.data.text) || JSON.stringify(e.data))}</td><td class="mono muted">${esc((e.mac || "").slice(0, 12))}…</td></tr>`).join(""); };
      $("#ar").onclick = load; $("#av").onclick = async () => { const r = await api("/api/audit/verify"); $("#avRes").innerHTML = r.ok ? `<span class="okc">✔ ${esc(r.msg)}</span>` : `<span class="badc">✖ ${esc(r.msg)}</span>`; }; load();
    }
  },
  update(s) {
    if (this.tab !== "list" || !$("#almRows")) return;
    let rows = s.alarms; if (this.filter === "unack") rows = rows.filter(a => !a.acked); if (this.filter === "act") rows = rows.filter(a => a.state === "ACT");
    $("#almRows").innerHTML = rows.length ? rows.map(a => `<tr class="${a.acked ? "" : "unack"} ${a.state === "RTN" ? "rtn" : ""} ${this.sel.has(a.id) ? "sel" : ""}" data-id="${a.id}">
      <td><input type="checkbox" ${this.sel.has(a.id) ? "checked" : ""} data-id="${a.id}"></td><td><span class="pr p${a.prio}">${a.prio} ${prioTxt(a.prio)}</span></td><td class="mono">${F.dt(a.t_on)}</td><td>${esc(a.src)}</td><td>${esc(a.text)}</td>
      <td>${a.state === "ACT" ? `<span class="pill bad">발생</span>` : `<span class="pill ok">복귀</span>`}</td><td class="mono muted">${a.t_off ? F.time(a.t_off) : ""}</td><td>${a.acked ? `<span class="muted">${esc(a.ack_by || "")}</span>` : `<button class="btn sm" data-ack="${a.id}">확인</button>`}</td></tr>`).join("")
      : `<tr><td colspan="8" class="empty">${S.lang === "ko" ? "표시할 경보 없음 — 계통 정상" : "No alarms"}</td></tr>`;
    $$("#almRows input[type=checkbox]").forEach(c => c.onchange = () => { const id = +c.dataset.id; c.checked ? this.sel.add(id) : this.sel.delete(id); });
    $$("#almRows [data-ack]").forEach(b => b.onclick = () => ack([+b.dataset.ack]));
  },
};

/* ════════════════ 4. 추세 */
const P_TR = {
  win: 900,
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("tr.title", "추세")}</h2><span class="sub">1초 표본 · 최대 4시간 보관 · 그래프 위에 마우스를 올리면 값 표시</span><div class="spacer"></div>
      <div class="seg" id="trWin"><button data-w="300">5분</button><button data-w="900" class="on">15분</button><button data-w="3600">1시간</button><button data-w="14400">4시간</button></div><a class="btn" href="/api/export/trend.csv">CSV 내보내기</a></div>
    <div class="grid"><div class="panel"><div class="hd"><h3>전력 (kW)</h3><div class="spacer"></div><div class="legend" id="trLeg"></div></div><div class="bd"><canvas class="chart" id="trA"></canvas></div></div>
      <div class="panel"><div class="hd"><h3>ESS 충전율 (%) · N-1 예비력 여유 (kW)</h3></div><div class="bd"><canvas class="chart" id="trB"></canvas></div></div></div>`;
    this.a = new Chart($("#trA"), { height: 320, window: this.win, series: [{ key: "load", label: "부하", color: COLORS.load, w: 2.2 }, { key: "pv", label: "PV", color: COLORS.pv, fill: true }, { key: "dg", label: "DG", color: COLORS.dg, fill: true }, { key: "fc", label: "FC", color: COLORS.fc, fill: true }, { key: "ess", label: "ESS", color: COLORS.ess }] });
    this.b = new Chart($("#trB"), { height: 220, window: this.win, yl: "kW", series: [{ key: "reserve", label: "예비력 여유", color: COLORS.reserve }, { key: "soc", label: "SOC", color: COLORS.soc, axis: "r", w: 2.2 }] });
    const leg = () => { $("#trLeg").innerHTML = this.a.o.series.map((s, i) => `<span style="cursor:pointer;opacity:${s.hidden ? .35 : 1}" data-i="${i}"><i style="background:${s.color}"></i>${s.label}</span>`).join(""); $$("#trLeg span").forEach(e => e.onclick = () => { const s = this.a.o.series[+e.dataset.i]; s.hidden = !s.hidden; leg(); this.a.draw(); }); }; leg();
    $$("#trWin button").forEach(b => b.onclick = () => { this.win = +b.dataset.w; $$("#trWin button").forEach(x => x.classList.toggle("on", x === b)); this.a.o.window = this.b.o.window = this.win; this.update(); });
  },
  update() { const c = ["t", "load", "pv", "dg", "fc", "ess", "soc", "h2", "reserve"]; this.a.set(c, S.trend); this.b.set(c, S.trend); },
};

/* ════════════════ 5. 통신 진단 */
const P_CM = {
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("cm.title", "통신 진단")}</h2><span class="sub">Modbus TCP · 장치마다 이중 경로(A/B) · 두절 판정 2.0초 + 감시 주기 · 복구 시 재조회 후 제어 재개</span></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 360px">
      <div class="panel"><div class="hd"><h3>장치 · 경로 상태</h3></div><div class="bd np scroll"><table class="t"><thead><tr><th>장치</th><th>판정</th><th>지속</th><th>경로</th><th>주소</th><th>Unit</th><th>응답</th><th class="n">RTT ms</th><th class="n">성공</th><th class="n">오류</th><th class="n">오류율</th><th class="n">무응답</th><th>마지막 오류</th></tr></thead><tbody id="cmRows"></tbody></table></div></div>
      <div class="grid" style="align-content:start">
        <div class="panel"><div class="hd"><h3>수집 주기 성능</h3></div><div class="bd"><div class="kv band" id="scKv"></div><div class="hist" id="scHist" style="margin-top:12px"></div><div style="display:flex;justify-content:space-between" class="muted mono"><span>0</span><span id="scTop"></span></div></div></div>
        <div class="panel"><div class="hd"><h3>프로세스 감시 (Watchdog)</h3></div><div class="bd"><div class="kv band" id="wdKv"></div></div></div>
        <div class="panel"><div class="hd"><h3>판정 기준</h3></div><div class="bd np"><table class="t"><tbody><tr><td><span class="pill ok">정상</span></td><td class="muted">두 경로 모두 응답</td></tr><tr><td><span class="pill warn">경로 저하</span></td><td class="muted">한 경로만 응답 — 제어 유지</td></tr><tr><td><span class="pill bad">두절</span></td><td class="muted">두 경로 무응답 &gt; 2.0 s — 지령 차단, 직전 유효값</td></tr><tr><td><span class="pill info">재조회 대기</span></td><td class="muted">응답 복귀 — 전 상태 재조회 후 정상</td></tr></tbody></table></div></div>
      </div></div>`;
  },
  update(s) {
    $("#cmRows").innerHTML = Object.entries(s.devices).map(([n, d]) => Object.entries(d.paths).map(([k, p], i) => `<tr>
      ${i === 0 ? `<td rowspan="2"><b>${n}</b></td><td rowspan="2"><span class="pill ${LINK_CLS[d.link]}">${linkTxt(d.link)}</span></td><td rowspan="2" class="mono">${F.dur(d.since)}</td>` : ""}
      <td><b class="mono">${k}</b></td><td class="mono">${esc(p.host)}</td><td class="mono">${p.unit}</td><td>${p.alive ? `<span class="okc">● 응답</span>` : `<span class="badc">○ 무응답</span>`}</td><td class="n">${F.n(p.rtt, 2)}</td><td class="n">${p.ok}</td><td class="n">${p.err}</td>
      <td class="n">${F.n(p.ok + p.err ? p.err / (p.ok + p.err) * 100 : 0, 2)}%</td><td class="n">${F.n(p.age, 1)}s</td><td class="muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.last_err)}">${esc(p.last_err)}</td></tr>`).join("")).join("");
    const st = s.stats; $("#scKv").innerHTML = `<span class="k">주기</span><span class="v">${F.n(st.scan_s * 1000, 0)} ms</span><span class="k">최근 / 평균</span><span class="v">${F.n(st.last_ms, 1)} / ${F.n(st.avg_ms, 1)} ms</span><span class="k">p95 / 최대</span><span class="v">${F.n(st.p95_ms, 1)} / ${F.n(st.max_ms, 1)} ms</span><span class="k">주기 수 / 초과</span><span class="v">${st.n_scan} / <span class="${st.n_over ? "warnc" : ""}">${st.n_over}</span></span><span class="k">추적 프레임</span><span class="v">${st.trace_n}</span><span class="k">가동 시간</span><span class="v">${F.dur(s.uptime)}</span>`;
    const mx = Math.max(1, ...st.hist); $("#scHist").innerHTML = st.hist.map(v => `<i style="height:${v / mx * 100}%" title="${v}"></i>`).join(""); $("#scTop").textContent = F.n(st.hist_top, 0) + " ms";
    $("#wdKv").innerHTML = Object.entries(st.wd).map(([k, v]) => `<span class="k">${esc(k)} 생존 신호</span><span class="v ${v !== null && v > 3 ? "badc" : "okc"}">${v === null ? "—" : F.n(v, 1) + " s 전"}</span>`).join("") + `<span class="k">판정 한도</span><span class="v">3.0 s</span>`;
  },
};

/* ════════════════ 6. 디버그 · 엔지니어링 */
const P_ENG = {
  tab: "explorer", traceLast: 0, traceRows: [], paused: false,
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("eng.title", "디버그 · 엔지니어링 도구")}</h2><span class="sub">현장 시운전(FAT/SAT)·고장 분석용. 쓰기·고장 주입은 엔지니어 권한과 감사 기록이 필요합니다</span></div>
    <div class="tabs" id="engTabs"><button data-t="explorer">${t("eng.explorer", "레지스터 탐색기")}</button><button data-t="trace">${t("eng.trace", "프레임 추적")}</button><button data-t="points">${t("eng.points", "포인트 맵")}</button><button data-t="sim">${t("eng.sim", "시뮬레이터 · 고장 주입")}</button><button data-t="info">${t("eng.info", "시스템 정보")}</button></div><div id="engBody"></div>`;
    $$("#engTabs button").forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.show(); }); this.show();
  },
  show() {
    $$("#engTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === this.tab)); clearInterval(this._ex); this._ex = null;
    ({ explorer: () => this.explorer(), trace: () => this.trace(), points: () => this.points(), sim: () => this.sim(), info: () => this.info() })[this.tab]();
  },
  explorer() {
    const devs = Object.keys(S.snap.devices);
    $("#engBody").innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 380px"><div class="panel"><div class="hd"><h3>Modbus 레지스터 읽기</h3><div class="spacer"></div><span class="sub" id="exInfo"></span></div><div class="bd">
      <div class="form"><label>대상<select class="in" id="exTgt">${devs.map(d => ["A", "B"].map(p => `<option value="${d}|${p}">${d} · 경로 ${p}</option>`).join("")).join("")}<option value="custom">직접 입력(허용 목록 안)</option></select></label>
        <span id="exCustom" style="display:none"><label>IP<input class="in" id="exHost" value="192.168.10.11" style="width:130px"></label><label>포트<input class="in" id="exPort" value="502" style="width:70px"></label><label>Unit<input class="in" id="exUnit" value="1" style="width:56px"></label></span>
        <label>기능 코드<select class="in" id="exFc"><option value="3">03 보유 레지스터</option><option value="4">04 입력 레지스터</option><option value="1">01 코일</option><option value="2">02 접점 입력</option></select></label>
        <label>시작 주소<input class="in" id="exAddr" type="number" value="0" min="0" max="65535" style="width:90px"></label><label>개수<input class="in" id="exCnt" type="number" value="16" min="1" max="125" style="width:70px"></label>
        <button class="btn pri" id="exRead">${t("btn.read", "읽기")}</button><label style="flex-direction:row;align-items:center;gap:6px;text-transform:none"><input type="checkbox" id="exAuto"> 1초 자동 갱신</label></div>
      <div class="scroll h560" style="margin-top:12px"><table class="t"><thead><tr><th class="n">주소</th><th>HEX</th><th class="n">UINT16</th><th class="n">INT16</th><th class="n">UINT32 (이 + 다음)</th><th class="n">FLOAT32 (이 + 다음)</th><th>대응 TAG</th></tr></thead><tbody id="exRows"><tr><td colspan="7" class="empty">대상과 주소를 정하고 읽기를 누르세요</td></tr></tbody></table></div></div></div>
      <div class="grid" style="align-content:start"><div class="panel"><div class="hd"><h3>레지스터 쓰기</h3><span class="pill eng">ENGINEER</span></div><div class="bd">
        <div class="warnbox" style="margin-bottom:12px">실장치에 직접 값을 씁니다. 지령 연동 조건(SBO·응답 확인)을 거치지 않으므로 시운전·정비 중에만 사용하십시오.</div>
        <div class="form"><label>기능 코드<select class="in" id="wrFc"><option value="6">06 단일 레지스터</option><option value="16">16 다중 레지스터</option><option value="5">05 단일 코일</option></select></label><label>주소<input class="in" id="wrAddr" type="number" value="40" style="width:90px"></label>
        <label style="flex:1">값(쉼표 구분, 0x 가능)<input class="in" id="wrVals" value="1234" style="width:100%"></label><button class="btn eng" id="wrGo">${t("btn.write", "쓰기")}</button></div><div id="wrRes" class="muted" style="margin-top:8px"></div></div></div>
        <div class="panel"><div class="hd"><h3>사용 안내</h3></div><div class="bd" style="color:var(--text2);font-size:12.5px;line-height:1.7">· 주소는 0부터(제작사 문서의 40001 = 보유 레지스터 0)<br>· 32비트 값은 상위 워드가 앞(Big-endian word order)<br>· 응답 없음 = 연결 거부/시간 초과 → 통신 진단 화면의 경로 상태 확인<br>· 직접 입력은 runtime.json의 <span class="mono">allow</span> 대역 안의 사설 주소만 허용<br>· 모든 프레임은 [프레임 추적] 탭에 HEX로 기록</div></div></div></div>`;
    const tg = $("#exTgt"); tg.onchange = () => { $("#exCustom").style.display = tg.value === "custom" ? "contents" : "none"; };
    const q = () => { const v = tg.value; const base = v === "custom" ? { host: $("#exHost").value.trim(), port: $("#exPort").value, unit: $("#exUnit").value } : { dev: v.split("|")[0], path: v.split("|")[1] }; return Object.assign(base, { fc: $("#exFc").value, addr: $("#exAddr").value, count: $("#exCnt").value }); };
    const read = async () => {
      if (!can("operator")) { $("#exAuto").checked = false; return loginDialog(); }
      const r = await api("/api/mb/read?" + new URLSearchParams(q())); if (!r.ok) { $("#exRows").innerHTML = `<tr><td colspan="7" class="empty badc">${esc(r.why)}</td></tr>`; $("#exInfo").textContent = ""; return; }
      $("#exInfo").textContent = `${r.regs.length}개 · 왕복 ${r.rtt} ms`; const bits = r.fc <= 2;
      $("#exRows").innerHTML = r.regs.map((v, i) => { const a = r.addr + i, nx = r.regs[i + 1]; const u32 = nx !== undefined ? (v * 65536 + nx) : null; let f32 = null; if (nx !== undefined) { const dv = new DataView(new ArrayBuffer(4)); dv.setUint16(0, v); dv.setUint16(2, nx); f32 = dv.getFloat32(0); }
        return `<tr><td class="n">${a}</td><td class="mono accc">${bits ? v : "0x" + v.toString(16).toUpperCase().padStart(4, "0")}</td><td class="n">${v}</td><td class="n">${bits ? "" : (v > 32767 ? v - 65536 : v)}</td><td class="n">${bits || u32 === null ? "" : u32}</td><td class="n">${bits || f32 === null ? "" : (Math.abs(f32) < 1e7 && Math.abs(f32) > 1e-4 || f32 === 0 ? f32.toPrecision(6) : f32.toExponential(3))}</td><td class="mono">${esc(r.tags[a] || "")}</td></tr>`; }).join("");
    };
    $("#exRead").onclick = read; $("#exAuto").onchange = e => { clearInterval(this._ex); this._ex = e.target.checked ? setInterval(read, 1000) : null; };
    $("#wrGo").onclick = async () => {
      if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return loginDialog(); }
      const vals = $("#wrVals").value.split(",").map(x => x.trim()).filter(Boolean).map(x => parseInt(x, x.startsWith("0x") ? 16 : 10)); if (!vals.length || vals.some(Number.isNaN)) return toast("값 형식 오류", "bad");
      const qq = q(); if (!confirm(`${qq.host || qq.dev + "/" + qq.path} fc${$("#wrFc").value} 주소 ${$("#wrAddr").value} ← [${vals.join(", ")}]\n실장치에 씁니다. 계속합니까?`)) return;
      const r = await api("/api/mb/write", Object.assign(qq, { fc: +$("#wrFc").value, addr: +$("#wrAddr").value, values: vals })); $("#wrRes").innerHTML = r.ok ? `<span class="okc">✔ 쓰기 완료 — 감사 기록됨</span>` : `<span class="badc">✖ ${esc(r.why)}</span>`;
    };
  },
  trace() {
    $("#engBody").innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) 400px"><div class="panel"><div class="hd"><h3>Modbus TCP 프레임 추적</h3><div class="spacer"></div>
      <select class="in" id="trDev"><option value="">전체 장치</option>${Object.keys(S.snap.devices).map(d => `<option>${d}</option>`).join("")}<option>직접</option></select>
      <select class="in" id="trDir"><option value="">TX+RX+ERR</option><option>TX</option><option>RX</option><option>ERR</option></select>
      <button class="btn" id="trPause">일시 정지</button><button class="btn" id="trClr">지우기</button><button class="btn" id="trSave">저장(.txt)</button></div>
      <div class="bd np scroll hfill" id="trBox"><table class="t"><thead><tr><th class="n">#</th><th>시각</th><th>장치/경로</th><th>방향</th><th class="n">FC</th><th class="n">길이</th><th class="n">RTT ms</th><th>프레임 [MBAP | Unit | FC | 자료]</th></tr></thead><tbody id="trRows"></tbody></table></div></div>
      <div class="panel"><div class="hd"><h3>프레임 해석</h3></div><div class="bd" id="trDec"><div class="empty">행을 누르면 MBAP 머리부와 PDU를 해석합니다</div></div></div></div>`;
    this.traceRows = []; this.traceLast = 0; this.paused = false;
    $("#trPause").onclick = () => { this.paused = !this.paused; $("#trPause").textContent = this.paused ? "재개" : "일시 정지"; $("#trPause").classList.toggle("pri", this.paused); };
    $("#trClr").onclick = async () => { await api("/api/trace/clear", {}); this.traceRows = []; this.renderTrace(); };
    $("#trSave").onclick = () => { const txt = this.traceRows.map(r => `${new Date(r.t * 1000).toISOString()}\t${r.dev}/${r.path}\t${r.host}\t${r.dir}\t${r.rtt ?? ""}\t${r.hex || r.txt}`).join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" })); a.download = `modbus_trace_${Date.now()}.txt`; a.click(); };
    $("#trDev").onchange = $("#trDir").onchange = () => this.renderTrace();
    $("#trRows").onclick = e => { const tr = e.target.closest("tr[data-i]"); if (tr) this.decode(this.traceRows.find(r => r.i === +tr.dataset.i)); };
  },
  async pollTrace() {
    if (this.tab !== "trace" || this.paused || !$("#trRows")) return;
    const r = await api(`/api/trace?since=${this.traceLast}&limit=400`); if (!r.rows) return;
    if (r.rows.length) { this.traceLast = r.rows[r.rows.length - 1].i; this.traceRows = this.traceRows.concat(r.rows).slice(-1500); this.renderTrace(); }
  },
  renderTrace() {
    const fd = $("#trDev").value, fr = $("#trDir").value; const rows = this.traceRows.filter(r => (!fd || r.dev === fd) && (!fr || r.dir === fr)).slice(-400).reverse();
    const hx = r => { if (!r.hex) return `<span class="badc">${esc(r.txt)}</span>`; const b = r.hex.split(" "); return `<span class="hex"><span class="mbap">${b.slice(0, 6).join(" ")}</span> <span class="uid">${b[6] || ""}</span> <span class="fc">${b[7] || ""}</span> <span class="pdu">${b.slice(8, 40).join(" ")}${b.length > 40 ? " …" : ""}</span></span>`; };
    $("#trRows").innerHTML = rows.map(r => `<tr data-i="${r.i}" style="cursor:pointer"><td class="n muted">${r.i}</td><td class="mono">${new Date(r.t * 1000).toTimeString().slice(0, 8)}.${String(Math.floor(r.t * 1000) % 1000).padStart(3, "0")}</td><td>${esc(r.dev)}/${esc(r.path)}</td><td><span class="dir ${r.dir}">${r.dir}</span></td><td class="n">${r.fc ?? ""}</td><td class="n">${r.n || ""}</td><td class="n">${r.rtt ?? ""}</td><td>${hx(r)}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">프레임 없음</td></tr>`;
  },
  decode(r) {
    if (!r) return; const D = $("#trDec"); if (!r.hex) { D.innerHTML = `<div class="kv band"><span class="k">구분</span><span class="v badc">오류</span><span class="k">대상</span><span class="v">${esc(r.host)}</span><span class="k">내용</span><span class="v" style="font-family:var(--sans)">${esc(r.txt)}</span></div>`; return; }
    const b = r.hex.split(" ").map(x => parseInt(x, 16)); const w = i => b[i] * 256 + b[i + 1]; const fc = b[7]; const FCN = { 1: "Read Coils", 2: "Read Discrete Inputs", 3: "Read Holding Registers", 4: "Read Input Registers", 5: "Write Single Coil", 6: "Write Single Register", 16: "Write Multiple Registers" };
    let pdu = ""; const exc = fc & 0x80;
    if (exc) pdu = `<span class="k">예외 코드</span><span class="v badc">${b[8]}</span>`;
    else if (r.dir === "TX") { if ([1, 2, 3, 4].includes(fc)) pdu = `<span class="k">시작 주소</span><span class="v">${w(8)}</span><span class="k">개수</span><span class="v">${w(10)}</span>`; else if (fc === 5 || fc === 6) pdu = `<span class="k">주소</span><span class="v">${w(8)}</span><span class="k">값</span><span class="v">${w(10)} (0x${w(10).toString(16)})</span>`; else if (fc === 16) { const n = w(10); pdu = `<span class="k">시작 주소</span><span class="v">${w(8)}</span><span class="k">개수</span><span class="v">${n}</span><span class="k">값</span><span class="v">${Array.from({ length: n }, (_, i) => w(13 + 2 * i)).join(", ")}</span>`; } }
    else { if ([3, 4].includes(fc)) { const n = b[8] / 2; pdu = `<span class="k">바이트 수</span><span class="v">${b[8]}</span><span class="k">레지스터</span><span class="v">${Array.from({ length: n }, (_, i) => w(9 + 2 * i)).join(", ")}</span>`; } else if ([5, 6, 16].includes(fc)) pdu = `<span class="k">주소</span><span class="v">${w(8)}</span><span class="k">${fc === 16 ? "개수" : "값"}</span><span class="v">${w(10)}</span>`; else pdu = `<span class="k">바이트 수</span><span class="v">${b[8]}</span>`; }
    D.innerHTML = `<div class="kv band"><span class="k">방향</span><span class="v"><span class="dir ${r.dir}">${r.dir}</span></span><span class="k">대상</span><span class="v">${esc(r.host)} (${esc(r.dev)}/${esc(r.path)})</span>
      <span class="k">거래 번호 (TID)</span><span class="v">${w(0)}</span><span class="k">프로토콜 ID</span><span class="v">${w(2)}</span><span class="k">길이</span><span class="v">${w(4)}</span><span class="k">Unit ID</span><span class="v">${b[6]}</span>
      <span class="k">기능 코드</span><span class="v">${fc & 0x7f}${exc ? " (예외)" : ""} — ${FCN[fc & 0x7f] || "?"}</span>${pdu}${r.rtt ? `<span class="k">왕복 시간</span><span class="v">${r.rtt} ms</span>` : ""}</div><pre class="code" style="margin-top:12px">${esc(r.hex)}</pre>`;
  },
  async points() {
    $("#engBody").innerHTML = `<div class="panel"><div class="hd"><h3>자료 대응표 (pointmap.csv) · 실시간 값</h3><div class="spacer"></div><input class="in" id="ptQ" placeholder="TAG·장치 검색" style="width:220px"><button class="btn sm" id="ptR">새로 고침</button></div>
      <div class="bd np scroll hfill"><table class="t"><thead><tr><th>TAG</th><th>장치</th><th>FC:주소</th><th>자료형</th><th class="n">배율</th><th>단위</th><th class="n">하한</th><th class="n">상한</th><th>R/W</th><th class="n">공학값</th><th>품질</th><th class="n">경과 s</th></tr></thead><tbody id="ptRows"></tbody></table></div></div>`;
    const load = async () => { const r = await api("/api/points"); this._pts = r.rows; draw(); };
    const draw = () => { const qq = $("#ptQ").value.toLowerCase(); $("#ptRows").innerHTML = (this._pts || []).filter(p => !qq || (p.tag + p.device).toLowerCase().includes(qq)).map(p => `<tr><td class="mono"><b>${esc(p.tag)}</b></td><td>${esc(p.device)}</td><td class="mono">${p.fc}:${p.addr}</td><td class="mono">${p.type}</td><td class="n">${p.scale}</td><td>${esc(p.unit)}</td><td class="n">${p.lo ?? ""}</td><td class="n">${p.hi ?? ""}</td><td>${p.rw === "w" ? `<span class="pill warn">W</span>` : `<span class="pill">R</span>`}</td><td class="n">${p.v === null || p.v === undefined ? "—" : F.n(p.v, 2)}</td><td>${p.rw === "w" ? `<span class="muted">지령</span>` : `<span class="pill ${p.f ? "bad" : "ok"}">${esc(p.ftxt)}</span>`}</td><td class="n">${p.age ?? ""}</td></tr>`).join(""); };
    $("#ptQ").oninput = draw; $("#ptR").onclick = load; load(); this._ex = setInterval(() => { if (this.tab === "points") load(); }, 2000);
  },
  sim() {
    const s = S.snap;
    if (!s.sim) { $("#engBody").innerHTML = `<div class="panel"><div class="bd"><div class="empty">실장치 연동 모드입니다. 고장 주입은 가상 장치 모드(<span class="mono">--sim</span>)에서만 쓸 수 있습니다.</div></div></div>`; return; }
    const tags = ["LOAD.p1_kw", "LOAD.p2_kw", "LOAD.p3_kw", "PV.kw", "ESS.soc", "H2.nm3", "DG.fuel_l", "ENV.temp", "ENV.press", "ENV.rh", "DG.mode", "FC.mode", "ESS.status"];
    $("#engBody").innerHTML = `<div class="engbox" style="margin-bottom:12px">가상 장치(Modbus TCP 서버, 127.0.0.1:${s.sim_state.ports.join(" / ")})에 고장을 주입해 EMS의 감시·지령·대체 전원 논리를 실제 통신으로 확인합니다. 엔지니어 권한 필요.</div>
      <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
        <div class="panel"><div class="hd"><h3>장치 고장 주입</h3></div><div class="bd np"><table class="t"><thead><tr><th>장치</th><th>무응답 (시간 초과)</th><th>지령 무시 (무응답)</th><th>현장 수동 모드</th></tr></thead><tbody id="simDev"></tbody></table></div>
          <div class="bd"><div class="lab" style="margin-bottom:8px">통신 경로 단절 (전 장치)</div><div style="display:flex;gap:8px" id="simPath"></div></div></div>
        <div class="panel"><div class="hd"><h3>운전 시나리오</h3></div><div class="bd" style="display:flex;flex-wrap:wrap;gap:8px" id="simScn">
          ${[["load_surge", "부하 급증 +60kW"], ["cloud", "구름 통과 (PV −70%)"], ["night", "야간 (PV 0)"], ["soc_low", "ESS 충전율 22%"], ["soc_critical", "ESS 충전율 17%"], ["h2_low", "수소 잔량 130Nm³"], ["normal", "▶ 정상 복귀 (전 고장 해제)"]].map(([k, v]) => `<button class="btn ${k === "normal" ? "go" : ""}" data-s="${k}">${v}</button>`).join("")}</div>
          <div class="bd" style="border-top:1px solid var(--line)"><div class="lab" style="margin-bottom:8px">값 강제 (가상 장치 레지스터)</div><div class="form"><label>TAG<select class="in" id="svTag">${tags.map(x => `<option>${x}</option>`).join("")}</select></label><label>값<input class="in" id="svVal" type="number" step="any" style="width:100px"></label><label style="flex-direction:row;gap:6px;align-items:center;text-transform:none"><input type="checkbox" id="svHold" checked>유지</label><button class="btn eng" id="svGo">적용</button></div>
          <div id="simHold" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px"></div></div></div></div>`;
    const act = async b => { if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return loginDialog(); } const r = await api("/api/sim", b); if (r.ok) { S.snap.sim_state = r.sim; this.simUpdate(); toast("고장 주입 적용", "ok"); } else toast(r.why, "bad"); };
    this._simAct = act;
    $$("#simScn [data-s]").forEach(b => b.onclick = () => act({ action: "scenario", name: b.dataset.s }));
    $("#svGo").onclick = () => act({ action: "set", tag: $("#svTag").value, value: parseFloat($("#svVal").value), hold: $("#svHold").checked });
    this.simUpdate();
  },
  simUpdate() {
    const s = S.snap; if (!s || !s.sim || !$("#simDev")) return; const ss = s.sim_state; const tog = (on, a, tgt) => `<button class="btn sm ${on ? "stop" : ""}" data-a="${a}" data-t="${tgt}" data-on="${on ? 0 : 1}">${on ? "● 적용 중 — 해제" : "적용"}</button>`;
    $("#simDev").innerHTML = Object.keys(s.devices).map(n => `<tr><td><b>${n}</b></td><td>${tog(ss.muted.includes(n), "mute", n)}</td><td>${s.devices[n].ctl ? tog(ss.noack.includes(n), "noack", n) : `<span class="muted">—</span>`}</td><td>${s.devices[n].ctl ? tog(ss.manual.includes(n), "manual", n) : `<span class="muted">—</span>`}</td></tr>`).join("");
    $("#simPath").innerHTML = ["A", "B"].map(p => `<span>경로 ${p} ${tog(ss.down.includes(p), "down", p)}</span>`).join("");
    $$("#simDev [data-a], #simPath [data-a]").forEach(b => b.onclick = () => this._simAct({ action: b.dataset.a, target: b.dataset.t, on: b.dataset.on === "1" }));
    $("#simHold").innerHTML = Object.entries(ss.hold).map(([k, v]) => `<span class="pill eng">${k} = ${F.n(v, 1)} <a href="#" data-r="${k}" style="color:#fff;margin-left:6px;text-decoration:none">✕</a></span>`).join("") || `<span class="muted" style="font-size:12px">강제 유지 값 없음${ss.scenario ? " · 시나리오: " + ss.scenario : ""}</span>`;
    $$("#simHold [data-r]").forEach(a => a.onclick = e => { e.preventDefault(); this._simAct({ action: "release", tag: a.dataset.r }); });
  },
  async info() {
    const r = await api("/api/info"); const v = await api("/api/audit/verify");
    $("#engBody").innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><div class="panel"><div class="hd"><h3>실행 정보</h3></div><div class="bd"><div class="kv band">
      <span class="k">EMS 연동 계층</span><span class="v">v${r.version.rt}</span><span class="k">핵심 프로그램</span><span class="v">v${r.version.core}</span><span class="k">운전 정책</span><span class="v" style="font-family:var(--sans)">${esc(r.policy)}</span>
      <span class="k">설정 파일</span><span class="v">${esc(r.cfg_path)}</span><span class="k">상태 폴더</span><span class="v">${esc(r.state_dir)}</span><span class="k">모드</span><span class="v">${r.sim ? "가상 장치" : "실장치"}</span>
      <span class="k">암호 모듈</span><span class="v">${esc(r.crypto.module)} ${r.crypto.verified ? `<span class="okc">검증필</span>` : `<span class="warnc">미검증(개발 모드 한정)</span>`}</span>
      <span class="k">감사 기록</span><span class="v ${v.ok ? "okc" : "badc"}">${v.ok ? "✔" : "✖"} ${esc(v.msg)}</span></div></div>
      <div class="hd" style="border-top:1px solid var(--line)"><h3>운영 감시 한도 (SUP)</h3></div><div class="bd"><div class="kv band">${Object.entries(r.sup).map(([k, x]) => `<span class="k mono">${k}</span><span class="v">${x}</span>`).join("")}</div></div></div>
      <div class="grid" style="align-content:start"><div class="panel"><div class="hd"><h3>설비 정격 (Site)</h3></div><div class="bd"><div class="kv band">${Object.entries(r.site).map(([k, x]) => `<span class="k mono">${k}</span><span class="v">${esc(x)}</span>`).join("")}</div></div></div>
      <div class="panel"><div class="hd"><h3>runtime.json</h3></div><div class="bd"><pre class="code">${esc(JSON.stringify(r.config, null, 2))}</pre></div></div></div></div>`;
  },
  update(s) { if (this.tab === "sim") this.simUpdate(); },
};

/* ════════════════ 라우팅·주기 갱신 */
const PAGES = { overview: P_OV, control: P_CTL, alarms: P_ALM, trends: P_TR, comm: P_CM, eng: P_ENG };
let mounted = null;
function render() {
  if (!S.snap) return; const p = PAGES[S.page] ? S.page : "overview";
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.p === p));
  if (mounted !== p + S.lang) { clearInterval(P_ENG._ex); const m = $("#main"); PAGES[p].mount(m); applyI18n(m); mounted = p + S.lang; }
  try { PAGES[p].update(S.snap); } catch (e) { console.error(e); }
}
window.addEventListener("hashchange", () => { S.page = location.hash.slice(1) || "overview"; mounted = null; render(); });
$$("#lang button").forEach(b => b.onclick = () => { S.lang = b.dataset.l; try { localStorage.setItem("ems.lang", S.lang); } catch (e) { } $$("#lang button").forEach(x => x.classList.toggle("on", x === b)); applyI18n(); mounted = null; renderUser(); renderHeader(); render(); });

async function poll() {
  try {
    const s = await api("/api/snapshot"); S.snap = s; S.lastOk = Date.now();
    if (s.me && (s.me.role !== S.me.role)) { if (S.token && s.me.role === "viewer") { S.token = null; try { sessionStorage.removeItem("ems.token"); } catch (e) { } toast("세션 만료 — 다시 로그인하세요", "bad"); } S.me = s.me; renderUser(); }
    renderHeader(); render();
  } catch (e) { }
}
async function pollTrend() {
  try { const r = await api("/api/trend?since=" + S.trendT); if (r.rows && r.rows.length) { S.trend = S.trend.concat(r.rows); if (S.trend.length > 14400) S.trend = S.trend.slice(-14400); S.trendT = S.trend[S.trend.length - 1][0]; if (S.page === "trends") P_TR.update(); } } catch (e) { }
}
setInterval(() => { const stale = Date.now() - S.lastOk > 3500; $("#stale").classList.toggle("on", stale && S.lastOk > 0); const c = $("#conn"); c.className = "conn" + (stale ? " bad" : ""); c.textContent = stale ? "● SERVER LOST" : "● LINK " + (S.snap ? F.n(S.snap.stats.last_ms, 0) + "ms" : ""); }, 500);
$$("#lang button").forEach(x => x.classList.toggle("on", x.dataset.l === S.lang));
S.page = location.hash.slice(1) || "overview"; renderUser(); applyI18n();
poll(); pollTrend(); setInterval(poll, 1000); setInterval(pollTrend, 2000); setInterval(() => P_ENG.pollTrace(), 700);
