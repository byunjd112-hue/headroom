/* IFPS Mobile EMS HMI — 화면 */
"use strict";
/* 운용 장소(작전지·주둔지)와 운용 태세(평시·저소음·자립) 표시 */
function opsChip(s) {
  const o = s.ops || {}, ko = S.lang === "ko";
  const place = o.mode === "grid" ? (o.outage ? [ko ? "주둔지 · 정전 자립" : "GARRISON · OUTAGE", "bad"] : [ko ? "주둔지 · 상전 연계" : "GARRISON · GRID", "ok"]) : [ko ? "작전지 · 자립 운전" : "FIELD · ISLAND", "info"];
  const post = o.posture && o.posture !== "평시" ? `<span class="chip warn"><span class="dot"></span>${ko ? o.posture + " 태세" : (o.posture === "저소음" ? "LOW-NOISE" : "AUTONOMY")}</span>` : "";
  const shed = (o.shed || []).length ? `<span class="chip bad"><span class="dot"></span>${ko ? "부하 차단 " : "SHED "}${o.shed.map(f => f === "L3" ? "3" : "2").join("·")}${ko ? "등급" : ""}</span>` : "";
  return `<span class="chip ${place[1]}"><span class="dot"></span>${place[0]}</span>${post}${shed}`;
}
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
    opsChip(s),
    `<span class="chip ${s.auto ? "ok" : "warn"}"><span class="dot"></span>${s.auto ? (S.lang === "ko" ? "자동 제어" : "AUTO DISPATCH") : (S.lang === "ko" ? "수동 운전" : "MANUAL")}</span>`,
    `<span class="chip ${nLost ? "bad" : nOk === devs.length ? "ok" : "warn"}"><span class="dot"></span>${S.lang === "ko" ? "통신" : "COMMS"} ${devs.length - nLost}/${devs.length}${nLost || nOk === devs.length ? "" : (S.lang === "ko" ? " · 경로 저하" : " · DEGRADED")}</span>`,
    `<span class="chip ${s.run_mode === "운용" ? "ok" : "warn"}"><span class="dot"></span>${s.run_mode === "운용" ? (S.lang === "ko" ? "운용" : "OPERATIONAL") : (S.lang === "ko" ? "개발 모드" : "DEV MODE")}</span>`,
    s.sim ? `<span class="chip sim"><span class="dot"></span>SIM${s.sim_state && s.sim_state.clock ? " · 모의 시각 " + s.sim_state.clock : ""}</span>` : "",
  ].join("");
  const c = s.alarm_cnt; $("#almsum").innerHTML = [1, 2, 3, 4].map(p => { const n = c[p].unack, a = c[p].act; return `<div class="pc p${p} ${n || a ? "on" : ""} ${n && p <= 2 ? "blink" : ""}" title="${prioTxt(p)} — 미확인 ${n} / 발생 ${a}" data-act="goalm">${n || a || 0}</div>`; }).join("");
  const unack = s.alarms.filter(a => !a.acked); const nb = $("#nb-alm"); nb.hidden = !unack.length; nb.textContent = unack.length;
  const top = unack[0] || s.alarms[0];
  $("#topalm").innerHTML = top ? `<span class="pr p${top.prio}">${top.prio}</span><span class="mono muted">${F.time(top.t_on)}</span><span class="muted">${esc(top.src)}</span><span class="txt">${esc(top.text)}</span>${top.state === "RTN" ? `<span class="pill">복귀</span>` : ""}` : `<span class="okc">● ${S.lang === "ko" ? "발생 경보 없음" : "No active alarms"}</span>`;
  $("#ackTop").disabled = !(top && !top.acked); $("#ackTop").onclick = () => ack([top.id]);
  $("#ver").textContent = `${s.version.pkg || ""} · RT ${s.version.rt} · CORE ${s.version.core}`;
}
function renderUser() {
  const u = $("#user");
  u.innerHTML = S.me.role === "viewer" ? `<button class="btn" data-act="login"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>${t("btn.login", "로그인")}</button>`
    : `<span class="pill ${S.me.role === "engineer" ? "eng" : "ok"}">${S.me.role === "engineer" ? "ENGINEER" : "OPERATOR"}</span><span>${esc(S.me.name)}</span><button class="btn sm ghost" data-act="logout">${t("btn.logout", "로그아웃")}</button>`;
}
setInterval(() => { const d = new Date(); $("#clk").textContent = d.toTimeString().slice(0, 8); $("#dtg").textContent = "DTG " + F.dtg(d); }, 250);
async function ack(ids) { if (!can("operator")) return loginDialog(); const r = await api("/api/ack", { ids }); if (r.ok) toast(`경보 ${r.n}건 확인`, "ok"); poll(); }

/* ════════════════ 1. 개요 */
/* 개요 오른쪽: 발전원·부하 현황, 금일 시간대별 발전량, ESS */
function spark(c, ys, color, H = 30, lo = null, hi = null) {
  const dpr = DPR(), W = c.clientWidth; if (!W) return; c.style.height = H + "px";
  if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); if (ys.length < 2) return;
  const mn = lo ?? Math.min(0, ...ys), mx = hi ?? Math.max(1, ...ys) * 1.1, X = i => i / (ys.length - 1) * W, Y = v => H - 2 - (v - mn) / (mx - mn || 1) * (H - 4);
  g.beginPath(); ys.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = color; g.lineWidth = 1.6; g.stroke();
  g.lineTo(W, H); g.lineTo(0, H); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, color + "66"); gr.addColorStop(1, color + "00"); g.fillStyle = gr; g.fill();
}
function ovRight(s) {
  const k = s.kpi, D = s.devices, devOk = n => D[n] && D[n].link !== "두절";
  const rows = [["PV", "태양광", k.pv, 400, TV("--pv"), 2, true], ["DG", "디젤", k.dg, 100, TV("--dg"), 3, D.DG && D.DG.on], ["FC", "연료전지", k.fc, 100, TV("--fc"), 4, D.FC && D.FC.on],
    ["ESS", "ESS", k.ess, 500, TV("--ess"), 5, true], ["LOAD", "총 부하", k.load, 400, TV("--load"), 1, true]];
  const box = $("#srcRows"); if (!box) return;
  if (!box.dataset.built) { box.dataset.built = 1; box.innerHTML = rows.map(r => `<div class="srow"><span class="nm"><i style="background:${r[4]}"></i>${r[1]}</span><span class="v mono" id="sv-${r[0]}">—</span>
      <span class="sb"><i id="sb-${r[0]}" style="background:${r[4]}"></i></span><canvas class="sp" id="sp-${r[0]}"></canvas><span class="ss" id="ss-${r[0]}"></span></div>`).join(""); }
  const win = S.trend.slice(-900);
  rows.forEach(([id, nm, v, cap, col, ci, on]) => {
    const lost = id === "DG" || id === "FC" || id === "ESS" ? !devOk(id) : !devOk("MTR");
    $("#sv-" + id).textContent = lost ? "####" : (id === "ESS" && v > 0 ? "+" : "") + F.kw(v) + " kW";
    $("#sb-" + id).style.width = Math.min(100, Math.abs(v) / cap * 100) + "%";
    const ss = $("#ss-" + id); ss.textContent = lost ? "두절" : id === "ESS" ? (v < -0.5 ? "충전" : v > 0.5 ? "방전" : "대기") : id === "LOAD" ? "급전" : on && Math.abs(v) > 0.5 ? "운전" : "정지";
    ss.className = "ss " + (lost ? "bad" : ss.textContent === "정지" || ss.textContent === "대기" ? "" : "on");
    spark($("#sp-" + id), win.map(r => r[ci]), col, 26);
  });
  $("#balPill").className = "pill " + (k.ess < -0.5 ? "info" : "ok"); $("#balPill").textContent = k.ess < -0.5 ? `잉여 ${F.kw(-k.ess)}kW → ESS 충전` : k.ess > 0.5 ? `부족 ${F.kw(k.ess)}kW ← ESS` : "수급 균형";
}
const TILE = (id, col, lab) => `<div class="panel tile"><div class="lab"><i style="background:var(--${col})"></i><span id="${id}Lab">${lab}</span></div><div class="big" id="${id}">—</div><div class="foot"><span id="${id}a"></span><span id="${id}b"></span></div><canvas class="tspark" id="tsp-${id}"></canvas></div>`;
const P_OV = {
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("ov.title", "운전 개요")}</h2><span class="sub" id="ovSub"></span></div>
    <div class="pg" style="grid-template-rows:118px 1fr">
      <div class="tiles6">${TILE("tLoad", "load", "총 부하")}${TILE("tPv", "pv", "태양광 발전")}${TILE("tSoc", "ess", "ESS 충전율")}${TILE("tFuel", "dg", "연료 · 수소")}${TILE("tRes", "g1", "N-1 순동 예비력")}${TILE("tAuto", "accent", "자동 제어")}</div>
      <div class="pg" style="grid-template-columns:1fr 440px">
        <div class="panel"><div class="hd"><h3>작전지 전개 현황</h3><span class="sub" id="layCnt"></span><div class="spacer"></div><span class="pill" id="siteSum">—</span><button class="btn sm" id="layEditBtn" data-act="layedit">배치 편집</button></div>
          <div class="bd sitebd">${siteHtml()}</div></div>
        <div class="col" style="grid-template-rows:auto auto 1fr">
          <div class="panel"><div class="hd"><h3>발전원 구성</h3><div class="spacer"></div><span class="sub" id="mixSub"></span></div><div class="bd mixbd"><div id="mixDn"></div><div class="mixleg" id="mixLeg"></div></div></div>
          <div class="panel"><div class="hd"><h3>발전 · 부하 현황</h3><div class="spacer"></div><span class="pill" id="balPill">—</span></div><div class="bd"><div class="srcrows" id="srcRows"></div></div></div>
          <div class="panel"><div class="hd"><h3>경보 매트릭스</h3><div class="spacer"></div><a class="sub" href="#alarms" style="color:var(--accent);text-decoration:none">경보 관리 →</a></div><div class="bd" id="almMtx"></div></div>
        </div></div></div>`;
  },
  update(s) {
    const k = s.kpi, bad = tag => !!(s.values[tag] && s.values[tag].f);
    const set = (id, big, a, b, cls = "") => { const e = $("#" + id); e.innerHTML = big; e.className = "big " + cls; $("#" + id + "a").textContent = a; $("#" + id + "b").textContent = b; };
    $("#ovSub").textContent = `${s.policy} · ${S.lang === "ko" ? "수집" : "scan"} ${F.n(s.stats.last_ms, 0)}ms`;
    set("tLoad", `${F.kw(k.load)}<small>kW</small>`, `1+2등급 ${F.kw(k.l1 + k.l2)}kW`, `3등급 ${F.kw(k.l3)}kW`, bad("LOAD.kw") ? "stale" : "");
    set("tPv", `${F.kw(k.pv)}<small>kW</small>`, `재생 비율 ${F.n(k.renew, 0)}%`, `${F.n(k.pv / 4, 0)}% of 400kWp`, bad("PV.kw") ? "stale" : "");
    set("tSoc", `${F.n(k.soc)}<small>%</small>`, k.ess >= 0 ? `방전 ${F.kw(k.ess)}kW` : `충전 ${F.kw(-k.ess)}kW`, k.ess_h ? `자립 ${F.hrs(k.ess_h)}h` : "충전 중", bad("ESS.soc") ? "stale" : k.soc < 19 ? "badc" : k.soc < 25 ? "warnc" : "");
    set("tFuel", `${F.n(k.fuel, 0)}<small>L</small> <span style="font-size:20px">${F.n(k.h2, 0)}<small>Nm³</small></span>`, `디젤 ${F.hrs(k.fuel_h)}h`, `연료전지 ${F.hrs(k.h2_h)}h`, k.h2 < 150 || k.fuel < 300 ? "warnc" : "");
    const o = s.ops || {}, au = o.autonomy, hh = x => x >= 999 ? "∞" : F.n(x, 0), tied = o.mode === "grid" && !o.outage;
    const lab = $("#tResLab"); if (lab) lab.textContent = tied ? "상전 수전" : "N-1 순동 예비력";
    if (tied) set("tRes", `${F.kw(k.grid)}<small>kW</small>`, `피크 목표 ${F.n(o.gcfg.peak_kw, 0)}kW`, { peak: "최대부하 시간대", off: "경부하 시간대", mid: "중간부하 시간대" }[o.gcfg.band], k.grid > o.gcfg.peak_kw + 2 ? "warnc" : "okc");
    else set("tRes", `${k.reserve_margin >= 0 ? "+" : ""}${F.n(k.reserve_margin, 0)}<small>kW</small>`, k.reserve_need ? "예비력 부족 → FC 병렬" : "N-1 만족", au ? `자립 ${hh(au.full)}h` : `병렬 ${k.online_kw.length}대`, k.reserve_need ? "warnc" : "okc");
    const d = s.decision;
    set("tAuto", s.auto ? "AUTO" : "MANUAL", d ? `DG ${d.want.DG ? "ON" : "OFF"} · FC ${d.want.FC ? "ON" : "OFF"} · 수전해 ${d.want.ELZ ? "ON" : "OFF"}` : "결정 대기", s.auto ? `다음 ${F.n(s.next_ctrl_s, 0)}s` : "수동", s.auto ? "okc" : "warnc");
    const tw = S.trend.slice(-600);
    [["tLoad", 1, TV("--load")], ["tPv", 2, TV("--pv")], ["tSoc", 6, TV("--ess")], ["tFuel", 7, TV("--fc")], ["tRes", 8, TV("--g1")], ["tAuto", 3, TV("--dg")]].forEach(([id, ci, col]) => { const c = $("#tsp-" + id); if (c) spark(c, tw.map(r => r[ci]), col, 30, id === "tSoc" ? 0 : null, id === "tSoc" ? 100 : null); });
    siteUpdate(s);
    const sst = siteState(s), nbad = Object.values(sst).filter(x => x.st === "bad").length;
    $("#siteSum").className = "pill " + (nbad ? "bad" : "ok"); $("#siteSum").textContent = nbad ? `이상 ${nbad}개소` : `전 장비 정상 · ${Object.keys(sst).length}개소`;
    const mix = [["태양광", k.pv, TV("--pv")], ["디젤", k.dg, TV("--dg")], ["연료전지", k.fc, TV("--fc")], ["ESS 방전", Math.max(0, k.ess), TV("--ess")]].concat(o.mode === "grid" ? [["상전", Math.max(0, k.grid || 0), TV("--g1")], ["주둔지 발전기", Math.max(0, k.gdg || 0), TV("--warn")]] : []), gsum = mix.reduce((x, mm) => x + mm[1], 0);
    $("#mixDn").innerHTML = mixDonut(mix, gsum, 132); $("#mixSub").textContent = `부하 ${F.kw(k.load)} kW`;
    $("#mixLeg").innerHTML = mix.map(([n, v, c]) => `<div><i style="background:${c}"></i><span>${n}</span><b class="mono">${F.kw(v)}</b><em>${gsum > 0 ? F.n(v / gsum * 100, 0) : 0}%</em></div>`).join("") + `<div class="ren"><span>재생에너지 비율</span><b>${F.n(k.renew, 0)}%</b></div>`;
    $("#almMtx").innerHTML = alarmMatrix(s.alarms);
    ovRight(s);
  },
};

/* ════════════════ 1-2. 단선결선도 */
const P_SLD = {
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>단선결선도</h2><span class="sub">모선 A/B · 연계 차단기 · 급전선별 통전·무전압·고장 · 전력 흐름</span></div>
    <div class="pg" style="grid-template-columns:1fr 420px">
      <div class="panel"><div class="hd"><h3>${t("ov.sld", "단선 결선도 · 실시간 전력 흐름")}</h3><span class="sub mono" id="busbal"></span><div class="spacer"></div><div class="legend sldleg"><span><i class="l on"></i>통전</span><span><i class="l off"></i>무전압</span><span><i class="l flt"></i>고장</span><span><i class="c closed"></i>투입</span><span><i class="c open"></i>개방</span><span><i class="c trip"></i>트립</span></div></div>
        <div class="bd sldbox">${sldSvg()}</div></div>
      <div class="col" style="grid-template-rows:auto auto 1fr">
        <div class="panel"><div class="hd"><h3>모선 상태</h3></div><div class="bd"><div class="kv band" id="busKv"></div></div></div>
        <div class="panel"><div class="hd"><h3>차단기</h3><div class="spacer"></div><a class="sub" href="#control" style="color:var(--accent);text-decoration:none">부하 관리 →</a></div><div class="bd np"><table class="t tc"><tbody id="sldCb"></tbody></table></div></div>
        <div class="panel"><div class="hd"><h3>전력 추세 · 15분</h3><div class="spacer"></div><div class="legend" id="sldLeg"></div></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="sldChart"></canvas></div></div></div>
      </div></div>`;
    this.chart = new Chart($("#sldChart"), { fill: true, window: 900, series: [{ key: "load", label: "부하", color: COLORS.load, w: 2.2 }, { key: "pv", label: "PV", color: COLORS.pv, fill: true }, { key: "dg", label: "DG", color: COLORS.dg, fill: true }, { key: "fc", label: "FC", color: COLORS.fc, fill: true }, { key: "ess", label: "ESS", color: COLORS.ess }] });
    $("#sldLeg").innerHTML = this.chart.o.series.map(x => `<span><i style="background:${x.color}"></i>${x.label}</span>`).join("");
  },
  update(s) {
    sldUpdate(s);
    const k = s.kpi, gw = s.devices.MTR && s.devices.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? -1) : -1;
    $("#busKv").innerHTML = `<span class="k">모선 A 전압</span><span class="v">${F.n(val("BUS.a_v"), 1)} V</span><span class="k">모선 B 전압</span><span class="v">${F.n(val("BUS.b_v"), 1)} V</span>
      <span class="k">주파수</span><span class="v">${F.n(val("BUS.hz"), 2)} Hz</span><span class="k">연계 차단기</span><span class="v">${cb("TIE") === 1 ? "투입" : cb("TIE") === 0 ? "개방" : cb("TIE") === 2 ? "트립" : "미상"}</span>
      <span class="k">Σ 발전 / Σ 부하</span><span class="v">${F.kw(k.gen)} / ${F.kw(k.load)} kW</span><span class="k">ESS</span><span class="v">${k.ess < -.5 ? "충전 " + F.kw(-k.ess) : k.ess > .5 ? "방전 " + F.kw(k.ess) : "대기"} kW</span>`;
    $("#sldCb").innerHTML = CB_ROWS.map(([f, nm]) => { const c = cb(f), code = Math.round(val("FLT." + f) || 0);
      return `<tr><td class="mono nw"><b>CB-${f}</b></td><td class="ell">${nm}</td><td class="nw" style="text-align:right">${c === 1 ? `<span class="pill ok">투입</span>` : c === 2 ? `<span class="pill bad">트립${code ? " · " + esc(String(ANSI_TXT[code] || code)) : ""}</span>` : c === 0 ? `<span class="pill warn">개방</span>` : `<span class="pill">미상</span>`}</td></tr>`; }).join("");
    this.chart.set(["t", "load", "pv", "dg", "fc", "ess", "soc", "h2", "reserve"], S.trend);
  },
};

/* ════════════════ 2. 설비 제어 */
/* 설비 목록: IFPS 체계 구성(①~⑥) 기준. dev = 통신 장치(runtime.json devices), 없으면 감시 전용 */
const CTL_UNITS = [
  { id: "DG", no: "①", nm: "기동형 복합전력공급체계 · 디젤발전기", en: "Hybrid power unit · diesel generator", col: "dg", dev: "DG", kw: "DG.kw", ctl: true },
  { id: "G1", no: "①", nm: "기동형 복합전력공급체계 · ESS 200kWh (계통 형성)", en: "Grid-forming hybrid ESS · 100kW", col: "g1", dev: null },
  { id: "ESS", no: "②", nm: "이동형 ESS(GFM) · 1.0MWh / PCS 500kW", en: "Mobile grid-forming BESS", col: "ess", dev: "ESS", kw: "ESS.kw" },
  { id: "PV", no: "③", nm: "이동형 PV 발전체계 · 400kW급 (80kWp × 5식)", en: "Rollable thin-film PV · inverter", col: "pv", dev: "PV", kw: "PV.kw", ctl: true, on: "계통 연결", off: "분리", sp: ["PV.lim_set", "출력 제한", 400, 10] },
  { id: "FC", no: "④", nm: "수소생성·발전체계 · 연료전지 100kW", en: "PEM fuel cell", col: "fc", dev: "FC", kw: "FC.kw", ctl: true, sp: ["FC.kw_set", "출력 설정", 100, 5] },
  { id: "ELZ", no: "④", nm: "수소생성·발전체계 · 수전해 30Nm³/h", en: "Electrolyzer · 150kW", col: "fc", dev: "ELZ", kw: "ELZ.kw", ctl: true },
  { id: "EMS", no: "⑤", nm: "이동형 전력체계 EMS · 중앙제어기", en: "Energy management system", col: "accent", dev: null },
  { id: "MTR", no: "⑥", nm: "이동형 배전·변압체계 · 계측/보호 게이트웨이", en: "22.9/6.6kV/380V · metering & IED gateway", col: "load", dev: "MTR", kw: "LOAD.kw" },
  { id: "GDG", no: "주", nm: "주둔지 기존 디젤발전기 · 1MW급 컨테이너형(고정식)", en: "Garrison standby diesel generator", col: "dg", dev: "GDG", kw: "GDG.kw", ctl: true },
  { id: "GRID", no: "주", nm: "주둔지 상전 수전점 · 22.9kV", en: "Utility incoming (no export)", col: "g1", dev: null, kw: "GRID.kw", need: "GRID.kw" },
];
const CB_ROWS = [["PV", "③ PV 인입"], ["DG", "① 디젤 인입"], ["FC", "④ 연료전지 인입"], ["ESS", "② ESS 인입"], ["G1", "① 복합전력 인입"], ["TIE", "모선 A·B 연계"], ["L1", "1등급 부하 (지휘통제·의무)"], ["L2", "2등급 부하 (막사·정비)"], ["L3", "3등급 부하 (일반·탄약)"]];
const CTL_PHOTO = { ELZ: "FC", EMS: "EMS", G1: "G1", GDG: "GDG", GRID: "MTR" };
const P_CTL = {
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("ctl.title", "설비 제어")}</h2><span class="sub">IFPS 6개 서브시스템 · 선택-실행(SBO) 2단계 · 연동 조건 · 응답 확인 · 감사 기록</span><div class="spacer"></div><span class="pill" id="ctlCnt">—</span></div>
    <div class="pg" style="grid-template-columns:1fr 410px">
      <div class="devs devs4" id="devs"></div>
      <div class="col" style="grid-template-rows:auto auto 1fr">
        <div class="panel"><div class="hd"><h3>${t("ctl.auto", "자동 제어 (EMS 급전)")}</h3><div class="spacer"></div><span class="sub" title="① 통신 두절 지령 금지 ② 현장 수동 모드 차단 ③ 작업 잠금 차단 ④ 중복 지령 차단 ⑤ 응답 1.5s·재지령 1회 → 지령 취소·대체 전원 ⑥ 선택 후 10s 내 실행 ⑦ 1등급 부하 차단 금지">연동 조건 ⓘ</span></div><div class="bd">
          <div style="display:flex;gap:8px;align-items:center"><div class="seg" id="autoSeg"><button data-v="1">AUTO</button><button data-v="0">MANUAL</button></div><div class="spacer"></div><button class="btn sm" id="ctlNow">제어 즉시 실행</button></div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span class="lab" style="width:54px">운용 장소</span><div class="seg" id="placeSeg"><button data-v="island">작전지</button><button data-v="grid">주둔지</button></div></div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><span class="lab" style="width:54px">운용 태세</span><div class="seg" id="postSeg"><button data-v="평시">평시</button><button data-v="저소음">저소음</button><button data-v="자립">자립</button></div></div>
          <div class="kv band" style="margin-top:10px" id="ctlKv"></div><div class="interlock" id="ctlNote"></div></div></div>
        <div class="panel"><div class="hd"><h3>⑥ 차단기 · 부하 관리</h3><div class="spacer"></div><span class="sub">보호 차단은 IED 수행</span></div>
          <div class="bd np"><table class="t tc"><tbody id="cbRows"></tbody></table></div></div>
        <div class="panel"><div class="hd"><h3>${t("ctl.log", "최근 지령")}</h3><div class="spacer"></div><span class="sub" id="qInfo"></span></div><div class="bd np fill-scroll"><table class="t tc"><tbody id="cmdlog"></tbody></table></div></div>
      </div></div>`;
    const POST_MSG = { "평시": "평시 태세로 바꿉니까?", "저소음": "저소음 태세로 바꿉니까?\n· 디젤 발전기를 기동하지 않습니다(연료전지는 사용)\n· 3등급 부하를 자동으로 차단합니다", "자립": "자립 태세로 바꿉니까?\n· 외부 보급 없이 목표 시간을 버티도록 부하를 단계적으로 관리합니다" };
    $$("#postSeg button").forEach(b => b.onclick = async () => { if (!can("operator")) return loginDialog(); if (!confirm(POST_MSG[b.dataset.v])) return; const r = await api("/api/ops", { posture: b.dataset.v }); toast(r.ok ? `운용 태세: ${b.dataset.v}` : r.why, r.ok ? "ok" : "bad"); });
    $$("#placeSeg button").forEach(b => b.onclick = async () => { if (!can("operator")) return loginDialog(); const g = b.dataset.v === "grid";
      if (!confirm(g ? "주둔지(상전 연계) 운전으로 바꿉니까?\n· 상전과 ESS 로 운전하고 디젤·연료전지는 정지합니다\n· 역송 없음, 최대부하 시간대 ESS 방전, 정전 시 자립 전환" : "작전지(자립 운전)로 바꿉니까?\n· 상전 없이 자체 전원으로 운전합니다")) return;
      const r = await api("/api/ops", { mode: b.dataset.v }); toast(r.ok ? `운용 장소: ${g ? "주둔지" : "작전지"}` : r.why, r.ok ? "ok" : "bad"); });
    $$("#autoSeg button").forEach(b => b.onclick = async () => { if (!can("operator")) return loginDialog(); const on = b.dataset.v === "1"; if (!on && !confirm("자동 제어를 해제하고 수동 운전으로 전환합니까?")) return; const r = await api("/api/auto", { on }); if (r.ok) toast(`자동 제어 ${on ? "설정" : "해제"}`, "ok"); poll(); });
    $("#ctlNow").onclick = async () => { if (!can("operator")) return loginDialog(); const r = await api("/api/control_now", {}); if (r.ok) toast("제어 주기 즉시 실행", "ok"); };
    if (!L.items) layoutLoad();
    this.built = false;
  },
  build(s) {
    const units = CTL_UNITS.filter(u => (!u.dev || s.devices[u.dev]) && (!u.need || s.values[u.need]));
    $("#devs").className = "devs devs4" + (units.length > 8 ? " devs5" : "");                       // 9~10장이면 5칸 × 2줄
    $("#devs").innerHTML = units.map(u => `<div class="panel dev" id="dv-${u.id}"><div class="hd"><span class="lamp" id="lp-${u.id}"></span><h3 style="color:var(--text)"><span class="dno">${u.no}</span>${u.nm}</h3><div class="spacer"></div><span class="pill" id="lk-${u.id}">—</span></div>
      <div class="bd"><div class="toprow"><div style="flex:1;min-width:0"><div class="muted" style="font-size:12px;margin:-4px 0 8px">${u.en}${u.dev ? ` · <span class="mono">${u.dev}</span>` : ""}</div><div class="row"><div><div class="lab">${u.id === "EMS" ? "수집 주기" : u.id === "MTR" ? "총 부하" : u.id === "ELZ" ? "소비" : "출력"}</div><div class="big" id="kw2-${u.id}" style="color:var(--${u.col})">—</div></div><div class="spacer"></div><div style="text-align:right"><div class="lab">상태</div><div class="mid" id="sx-${u.id}">—</div></div></div></div><div class="eqimg" id="eq-${u.id}"></div></div>
      <div class="meta" id="mt-${u.id}"></div>
      ${u.ctl ? `<div class="acts"><button class="btn go" data-c="start" data-d="${u.dev}">▶ ${u.on || t("btn.start", "기동")}</button><button class="btn stop" data-c="stop" data-d="${u.dev}">■ ${u.off || t("btn.stop", "정지")}</button>
        ${u.sp ? `<div class="spacer"></div><input class="in" id="sp-${u.id}" type="number" min="0" max="${u.sp[2]}" step="${u.sp[3]}" style="width:80px" placeholder="kW"><button class="btn" data-sp="${u.id}">${u.sp[1]}</button>` : ""}</div><div class="interlock" id="il-${u.id}"></div>`
        : `<div class="interlock muted" style="color:var(--muted)">${u.id === "EMS" ? "EMS 자체 상태 — 자동 제어는 오른쪽 패널에서 전환" : u.id === "G1" ? "국기연 관급 체계 — 계통 형성 전원, EMS는 감시만 수행(차단기 상태로 확인)" : "감시 전용 — EMS는 지령하지 않음"}</div>`}</div></div>`).join("");
    $$("#devs [data-c]").forEach(b => b.onclick = () => { const u = CTL_UNITS.find(x => x.dev === b.dataset.d); sbo(b.dataset.d, b.dataset.c, { label: `${u.no} ${u.nm.split(" · ").pop()} ${b.dataset.c === "start" ? (u.on || "기동") : (u.off || "정지")}` }); });
    $$("#devs [data-sp]").forEach(b => b.onclick = () => { const u = CTL_UNITS.find(x => x.id === b.dataset.sp), v = parseFloat($("#sp-" + u.id).value); if (!(v >= 0)) return toast("설정값을 입력하세요", "bad"); sbo(u.dev, "set", { tag: u.sp[0], value: v, label: `${u.no} ${u.sp[1]} ${v} kW` }); });
    $("#cbRows").innerHTML = CB_ROWS.map(([f, nm]) => `<tr title="${nm}"><td class="mono"><b>CB-${f}</b></td><td id="cbs2-${f}"></td><td class="mono muted" id="cbf-${f}"></td><td class="n" id="cbk-${f}"></td>
      <td style="text-align:right">${["L2", "L3"].includes(f) ? `<button class="btn sm stop" data-shed="${f}" data-v="2">차단</button> <button class="btn sm go" data-shed="${f}" data-v="1">복구</button>` : `<span class="muted" style="font-size:11px">${f === "L1" ? "차단 금지" : ""}</span>`}</td></tr>`).join("");
    $$("#cbRows [data-shed]").forEach(b => b.onclick = () => sbo("MTR", "set", { tag: "LDS." + b.dataset.shed, value: +b.dataset.v, label: `${b.dataset.shed === "L2" ? "2등급" : "3등급"} 부하 ${b.dataset.v === "2" ? "차단" : "복구"}` }));
    this.built = true;
  },
  update(s) {
    if (!this.built) this.build(s);
    const k = s.kpi, D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? -1) : -1;
    const paths = d => Object.entries(d.paths).map(([a, p]) => a + (p.alive ? "●" : "○")).join(" ");
    for (const u of CTL_UNITS) {
      const lp = $("#lp-" + u.id); if (!lp) continue;
      const d = u.dev ? D[u.dev] : null, lost = d ? d.link === "두절" : ((u.id === "G1" || u.id === "GRID") && !gw);
      const o = s.ops || {}, garr = o.mode === "grid";
      const on = u.id === "EMS" ? true : u.id === "G1" ? cb("G1") === 1 : u.id === "GRID" ? (garr && cb("GRID") === 1) : u.id === "MTR" ? !lost : !!(d && d.on);
      lp.className = "lamp " + (lost ? "lost" : on ? "on" : "");
      const lk = $("#lk-" + u.id);
      if (d) { lk.className = "pill " + LINK_CLS[d.link]; lk.textContent = linkTxt(d.link); }
      else if (u.id === "EMS") { lk.className = "pill " + (s.alarm_cnt[1].act ? "bad" : "ok"); lk.textContent = s.alarm_cnt[1].act ? `긴급 ${s.alarm_cnt[1].act}` : "정상"; }
      else if (u.id === "GRID" && !lost) { const g2 = s.ops || {}, t2 = g2.mode !== "grid" ? "미연계" : g2.outage ? "정전" : "연계"; lk.className = "pill " + (t2 === "정전" ? "bad" : t2 === "연계" ? "ok" : "info"); lk.textContent = t2; }
      else { lk.className = "pill " + (lost ? "bad" : "info"); lk.textContent = lost ? "게이트웨이 두절" : "미계측"; }
      const big = u.id === "EMS" ? `${F.n(s.stats.last_ms, 0)}<small>ms</small>` : u.id === "G1" ? `100<small>kW 형성</small>` : `${lost ? "####" : F.kw(val(u.kw))}<small>kW</small>`;
      $("#kw2-" + u.id).innerHTML = big;
      const c = { G1: cb("G1"), PV: cb("PV"), DG: cb("DG"), FC: cb("FC"), ESS: cb("ESS"), GRID: cb("GRID"), GDG: lost ? -1 : Math.round(val("CB.GDG") ?? -1) }[u.id];
      $("#sx-" + u.id).innerHTML = lost ? `<span class="badc">통신 두절</span>` : c === 2 ? `<span class="badc">차단기 트립</span>`
        : u.id === "GRID" ? (!garr ? `<span class="muted">미연계(작전지)</span>` : o.outage ? `<span class="badc">정전</span>` : `<span class="okc">수전 중</span>`)
        : u.id === "GDG" ? (on ? `<span class="okc">운전 중</span>` : `<span class="muted">${garr ? "대기" : "미사용"}</span>`)
        : u.id === "MTR" ? `<span class="okc">계측 중</span>` : u.id === "EMS" ? `<span class="okc">${s.auto ? "자동 제어" : "수동 운전"}</span>`
        : u.id === "ESS" ? `<span class="okc">${k.ess < -.5 ? "충전" : k.ess > .5 ? "방전" : "대기"}</span>` : u.id === "PV" ? (on ? `<span class="okc">계통 연결</span>` : `<span class="muted">분리</span>`)
        : on ? `<span class="okc">운전 중</span>` : `<span class="muted">정지</span>`;
      const mode = d ? ["모드", d.manual ? "수동" : "자동"] : null, hb = d ? ["생존 HB", F.n(d.hb, 0)] : null;
      const meta = { DG: [mode, ["연료", F.n(val("DG.fuel_l"), 0) + " L"], ["순번 ACK", F.n(d && d.seq_ack, 0)], hb],
        G1: [["CB-G1", c === 1 ? "투입" : c === 0 ? "개방" : c === 2 ? "트립" : "미상"], ["모선 B", F.n(val("BUS.b_v"), 0) + " V"], ["주파수", F.n(val("BUS.hz"), 2) + " Hz"], ["형성 용량", "100 kW"]],
        ESS: [["SOC", F.n(k.soc) + " %"], ["가용", F.n(Math.max(0, (k.soc / 100 - .15) * 1000), 0) + " kWh"], ["자립", k.ess_h ? F.hrs(k.ess_h) + " h" : "—"], ["경로", d ? paths(d) : "—"]],
        PV: [mode, ["출력 제한", F.n(val("PV.lim"), 0) + " kW"], ["금일 발전", F.n(s.energy.pv, 1) + " kWh"], hb],
        FC: [mode, ["수소", F.n(val("H2.nm3"), 0) + " Nm³"], ["순번 ACK", F.n(d && d.seq_ack, 0)], hb],
        ELZ: [mode, ["생산", F.n(val("ELZ.h2_rate"), 1) + " Nm³/h"], ["저장", F.n(val("H2.nm3"), 0) + " Nm³"], hb],
        GDG: [mode, ["연료", F.n(val("GDG.fuel_pct"), 0) + " %"], ["차단기", c === 1 ? "투입" : c === 0 ? "개방" : c === 2 ? "트립" : "미상"], hb],
        GRID: [["수전 차단기", c === 1 ? "투입" : c === 0 ? "개방" : c === 2 ? "트립" : "미상"], ["피크 목표", o.gcfg ? F.n(o.gcfg.peak_kw, 0) + " kW" : "—"], ["시간대", o.gcfg ? { peak: "최대부하", off: "경부하", mid: "중간부하" }[o.gcfg.band] : "—"], ["금일 수전", F.n(s.energy.grid, 1) + " kWh"]],
        EMS: [["정책", s.policy.includes("예측") ? "예측 계획" : "규칙"], ["주기 초과", s.stats.n_over + "회"], ["감사 기록", s.stats.audit_seq + "건"], ["가동", F.dur(s.uptime)]],
        MTR: lost ? [["모선 A", "####"], ["기온", "####"], ["습도", "####"], ["경로", d ? paths(d) : "—"]] : [["모선 A", F.n(val("BUS.a_v"), 0) + " V"], ["기온", F.n(val("ENV.temp")) + " °C"], ["습도", F.n(val("ENV.rh"), 0) + " %"], ["경로", d ? paths(d) : "—"]] }[u.id];
      $("#mt-" + u.id).innerHTML = meta.map(([a, b]) => `<div><div class="lab">${a}</div><div class="v">${b}</div></div>`).join("");
      const eqs = { on, lost, fault: c === 2, value: u.id === "ESS" ? F.n(k.soc, 0) + "% SOC" : u.id === "EMS" || u.id === "G1" ? undefined : on && u.kw ? F.n(val(u.kw), 0) + " kW" : undefined };
      const sig = JSON.stringify(eqs), eqb = $("#eq-" + u.id);
      if (eqb && eqb.dataset.sig !== sig) { eqb.dataset.sig = sig; eqb.innerHTML = equipPhoto(CTL_PHOTO[u.id] || u.id, eqs); }
      const il = $("#il-" + u.id); if (il && u.id === "GDG" && !lost && !d.manual && c !== 2 && !s.busy) { il.textContent = !garr ? "주둔지 운전에서만 자동 기동" : o.gdg ? o.gdg.why : "상전 연계 중 — 대기"; }
      else if (il && d) il.textContent = lost ? "⚠ 통신 두절 — 지령 차단" : d.manual ? "⚠ 현장 수동 모드 — EMS 지령 차단" : c === 2 ? "⚠ 인입 차단기 트립 — 보호 IED 복구 후 지령" : (s.busy ? "지령 처리 중…" : "");
      if (d) $$(`#devs [data-d="${u.dev}"]`).forEach(b => { b.disabled = !can("operator") || lost || d.manual || (b.dataset.c === "start" ? d.on : !d.on); });
      const spb = $(`#devs [data-sp="${u.id}"]`); if (spb) spb.disabled = !can("operator") || lost;
    }
    const ld = { L1: k.l1, L2: k.l2, L3: k.l3 };
    for (const [f] of CB_ROWS) {
      const c = cb(f), code = Math.round(val("FLT." + f) || 0);
      $("#cbs2-" + f).innerHTML = c === 1 ? `<span class="pill ok">투입</span>` : c === 2 ? `<span class="pill bad">트립</span>` : c === 0 ? `<span class="pill warn">개방</span>` : `<span class="pill">미상</span>`;
      $("#cbf-" + f).textContent = code ? (ANSI_TXT[code] || code) : "—"; $("#cbk-" + f).textContent = ld[f] === undefined ? "" : gw ? F.kw(ld[f]) : "####";
      $$(`#cbRows [data-shed="${f}"]`).forEach(b => { b.disabled = !can("operator") || !gw || (b.dataset.v === "2" ? c !== 1 : c === 1); });
    }
    if (L.items) {
      const cnt = kk => L.items.filter(i => i.kind === kk).length;
      const q = [["① 기동형 복합전력", cnt("DG")], ["② 이동형 ESS", cnt("ESS")], ["③ 이동형 PV", cnt("PV")], ["④ 수소생성·발전", cnt("FC")], ["⑤ EMS 쉘터", cnt("EMS")], ["⑥ 배전·변압", cnt("DIST")], ["⑥ 구간분전함(FSU)", cnt("FSU")], ["막사", cnt("BARRACK")], ["지휘통제·의무·탄약 시설", cnt("L1") + cnt("L2") + cnt("L3")]];
      $("#ctlCnt").textContent = `설비 ${CTL_UNITS.length}종 · 배치 ${L.items.length}대`; $("#ctlCnt").title = q.map(([n, v]) => `${n} ${v}대`).join("\n");
    }
    $$("#autoSeg button").forEach(b => b.classList.toggle("on", (b.dataset.v === "1") === s.auto));
    const d = s.decision, o = s.ops || {}, au = o.autonomy;
    $("#ctlKv").innerHTML = `<span class="k">운전 정책</span><span class="v" style="font-family:var(--sans)">${esc(s.policy)}</span><span class="k">다음 제어까지</span><span class="v">${s.auto ? F.n(s.next_ctrl_s, 0) + " s" : "수동"}</span><span class="k">최근 결정</span><span class="v">${d ? `DG ${d.want.DG ? "ON" : "OFF"} / FC ${d.want.FC ? "ON" : "OFF"} / 수전해 ${d.want.ELZ ? "ON" : "OFF"}` : "—"}</span>
      <span class="k">예비력 규칙</span><span class="v">${d ? (d.reserve ? "작동 → FC 병렬" : "미작동") : "—"}</span>
      <span class="k" title="외부 보급 없이 버티는 시간: 전 부하 / 3등급 차단 / 1등급만">자립 지속(전·3차단·1등급)</span><span class="v">${au ? [au.full, au.shed3, au.p1].map(x => x >= 999 ? "∞" : F.n(x, 0)).join(" / ") + " h" : "—"}</span>
      ${o.mode === "grid" ? `<span class="k">상전 수전 / 피크 목표</span><span class="v ${o.outage ? "badc" : ""}">${o.outage ? "정전 — 자립 운전" : F.kw(k.grid) + " / " + F.n(o.gcfg.peak_kw, 0) + " kW"}</span>
      <span class="k">주둔지 제어</span><span class="v" style="font-family:var(--sans);font-size:11px">${o.garrison ? esc(o.garrison.why) : o.gdg ? esc(o.gdg.why) : "—"}</span>` : ""}
      ${(o.shed || []).length ? `<span class="k">부하 자동 차단</span><span class="v badc" style="font-family:var(--sans);font-size:11px">${o.shed.map(f => (f === "L3" ? "3등급" : "2등급")).join(", ")} — ${esc(o.shed_why[o.shed[0]] || "")}</span>` : ""}`;
    $$("#placeSeg button").forEach(b => { b.classList.toggle("on", b.dataset.v === (o.mode || "island")); b.disabled = b.dataset.v === "grid" && !o.can_grid; });
    $$("#postSeg button").forEach(b => b.classList.toggle("on", b.dataset.v === (o.posture || "평시")));
    $("#ctlNote").textContent = d && d.policy && d.policy.includes("실패") ? d.policy : "";
    $("#qInfo").textContent = s.busy ? `처리 중: ${s.busy} · 대기 ${s.queue}` : `대기 ${s.queue}`;
    $("#cmdlog").innerHTML = s.cmdlog.length ? s.cmdlog.slice(0, 20).map(e => `<tr title="${esc(e.text)}"><td class="mono">${esc((e.wall || "").slice(11))}</td><td>${esc(e.who || "EMS")}</td><td>${e.ok ? `<span class="pill ok">성공</span>` : `<span class="pill bad">실패</span>`}</td><td class="ell">${esc(e.text)}</td></tr>`).join("") : `<tr><td colspan="4" class="empty">지령 기록 없음</td></tr>`;
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
      $("#ackAll").onclick = () => ack("all"); $("#ackSel").onclick = () => { if (this.sel.size) ack([...this.sel]); this.sel.clear(); $("#selAll").checked = false; };
      $("#selAll").onchange = e => { this.sel = e.target.checked ? new Set(this.rows(S.snap).map(a => a.id)) : new Set(); this.update(S.snap); };
      this.update(S.snap);
    } else if (this.tab === "journal") {
      B.innerHTML = `<div class="panel"><div class="hd"><h3>경보 이력 (최근 300건)</h3><div class="spacer"></div><button class="btn sm" id="jr">새로 고침</button></div><div class="bd np scroll hfill"><table class="t"><thead><tr><th>시각</th><th>구분</th><th>우선</th><th>장치</th><th>내용</th></tr></thead><tbody id="jrRows"></tbody></table></div></div>`;
      const load = async () => { const r = await api("/api/journal?n=300"); if (!$("#jrRows") || !r.rows) return; $("#jrRows").innerHTML = r.rows.map(e => `<tr><td class="mono">${F.dt(e.t)}</td><td><span class="pill ${e.ev === "발생" || e.ev === "재발생" ? "bad" : e.ev === "복귀" ? "ok" : "info"}">${e.ev}</span></td><td><span class="pr p${e.prio}">${e.prio}</span></td><td>${esc(e.src)}</td><td>${esc(e.text)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">이력 없음</td></tr>`; };
      $("#jr").onclick = load; load();
    } else {
      B.innerHTML = `<div class="panel"><div class="hd"><h3>감사 기록 (audit.log, 최근 200건)</h3><div class="spacer"></div><span id="avRes" class="sub"></span><button class="btn" id="av">${t("alm.verify", "무결성 검증")}</button><button class="btn sm" id="ar">새로 고침</button></div>
        <div class="bd np scroll hfill"><table class="t"><thead><tr><th class="n">순번</th><th>시각</th><th>주체</th><th>구분</th><th>내용</th><th>MAC</th></tr></thead><tbody id="auRows"></tbody></table></div></div>`;
      const load = async () => { const r = await api("/api/audit?n=200"); if (!$("#auRows")) return; if (!r.rows) { $("#auRows").innerHTML = `<tr><td colspan="6" class="empty">감사 기록은 운용자 이상 로그인 후 볼 수 있습니다</td></tr>`; return; } $("#auRows").innerHTML = r.rows.map(e => `<tr><td class="n">${e.seq}</td><td class="mono">${esc((e.ts || "").replace("T", " ").slice(0, 19))}</td><td>${esc(e.actor)}</td><td>${esc(e.kind)}</td><td>${esc((e.data && e.data.text) || JSON.stringify(e.data))}</td><td class="mono muted">${esc((e.mac || "").slice(0, 12))}…</td></tr>`).join(""); };
      $("#ar").onclick = load; $("#av").onclick = async () => { const r = await api("/api/audit/verify"); if (!$("#avRes")) return; $("#avRes").innerHTML = r.ok ? `<span class="okc">✔ ${esc(r.msg)}</span>` : `<span class="badc">✖ ${esc(r.msg)}</span>`; }; load();
    }
  },
  rows(s) { let r = s.alarms; if (this.filter === "unack") r = r.filter(a => !a.acked); if (this.filter === "act") r = r.filter(a => a.state === "ACT"); return r; },
  update(s) {
    if (this.tab !== "list" || !$("#almRows")) return;
    const rows = this.rows(s);
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
      <div class="seg" id="trWin">${[[300, "5분"], [900, "15분"], [3600, "1시간"], [14400, "4시간"]].map(([w, n]) => `<button data-w="${w}"${w === this.win ? ' class="on"' : ""}>${n}</button>`).join("")}</div><a class="btn" href="/api/export/trend.csv">CSV 내보내기</a></div>
    <div class="pg" style="grid-template-rows:3fr 2fr"><div class="panel"><div class="hd"><h3>전력 (kW)</h3><div class="spacer"></div><div class="legend" id="trLeg"></div></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="trA"></canvas></div></div></div>
      <div class="panel"><div class="hd"><h3>ESS 충전율 (%) · N-1 예비력 여유 (kW)</h3></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="trB"></canvas></div></div></div></div>`;
    this.a = new Chart($("#trA"), { fill: true, window: this.win, series: [{ key: "load", label: "부하", color: COLORS.load, w: 2.2 }, { key: "pv", label: "PV", color: COLORS.pv, fill: true }, { key: "dg", label: "DG", color: COLORS.dg, fill: true }, { key: "fc", label: "FC", color: COLORS.fc, fill: true }, { key: "ess", label: "ESS", color: COLORS.ess }] });
    this.b = new Chart($("#trB"), { fill: true, window: this.win, yl: "kW", series: [{ key: "reserve", label: "예비력 여유", color: COLORS.reserve }, { key: "soc", label: "SOC", color: COLORS.soc, axis: "r", w: 2.2 }] });
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
        <label title="32비트 해석 순서. 정격값에 맞게 나오는 순서가 그 장치의 순서">32비트 순서<select class="in" id="exOrd"><option>ABCD</option><option>CDAB</option><option>BADC</option><option>DCBA</option></select></label>
        <button class="btn pri" id="exRead">${t("btn.read", "읽기")}</button><label style="flex-direction:row;align-items:center;gap:6px;text-transform:none"><input type="checkbox" id="exAuto"> 1초 자동 갱신</label></div>
      <div class="scroll h560" style="margin-top:12px"><table class="t"><thead><tr><th class="n">주소</th><th>HEX</th><th class="n">UINT16</th><th class="n">INT16</th><th class="n">UINT32</th><th class="n">INT32</th><th class="n">FLOAT32 (이 + 다음)</th><th>대응 TAG</th></tr></thead><tbody id="exRows"><tr><td colspan="8" class="empty">대상과 주소를 정하고 읽기를 누르세요</td></tr></tbody></table></div></div></div>
      <div class="grid" style="align-content:start"><div class="panel"><div class="hd"><h3>레지스터 쓰기</h3><span class="pill eng">ENGINEER</span></div><div class="bd">
        <div class="warnbox" style="margin-bottom:12px">실장치에 직접 값을 씁니다. 지령 연동 조건(SBO·응답 확인)을 거치지 않으므로 시운전·정비 중에만 사용하십시오.</div>
        <div class="form"><label>기능 코드<select class="in" id="wrFc"><option value="6">06 단일 레지스터</option><option value="16">16 다중 레지스터</option><option value="5">05 단일 코일</option></select></label><label>주소<input class="in" id="wrAddr" type="number" value="40" style="width:90px"></label>
        <label style="flex:1">값(쉼표 구분, 0x 가능)<input class="in" id="wrVals" value="1234" style="width:100%"></label><button class="btn eng" id="wrGo">${t("btn.write", "쓰기")}</button></div><div id="wrRes" class="muted" style="margin-top:8px"></div></div></div>
        <div class="panel"><div class="hd"><h3>사용 안내</h3></div><div class="bd" style="color:var(--text2);font-size:12.5px;line-height:1.7">· 주소는 0부터(제작사 문서의 40001 = 보유 레지스터 0)<br>· 32비트 순서: ABCD 표준 · CDAB 워드 뒤집힘 · BADC 바이트 뒤집힘 · DCBA 완전 역순 — [32비트 순서]를 바꿔 정격값이 맞게 나오는 것을 찾고 pointmap.csv의 order 열에 적음<br>· 응답 없음 = 연결 거부/시간 초과 → 통신 진단 화면의 경로 상태 확인<br>· 직접 입력은 runtime.json의 <span class="mono">allow</span> 대역 안의 사설 주소만 허용<br>· 모든 프레임은 [프레임 추적] 탭에 HEX로 기록</div></div></div></div>`;
    const tg = $("#exTgt"); tg.onchange = () => { $("#exCustom").style.display = tg.value === "custom" ? "contents" : "none"; };
    const q = () => { const v = tg.value; const base = v === "custom" ? { host: $("#exHost").value.trim(), port: $("#exPort").value, unit: $("#exUnit").value } : { dev: v.split("|")[0], path: v.split("|")[1] }; return Object.assign(base, { fc: $("#exFc").value, addr: $("#exAddr").value, count: $("#exCnt").value }); };
    const read = async () => {
      if (!$("#exRows")) { clearInterval(this._ex); this._ex = null; return; }
      if (!can("operator")) { $("#exAuto").checked = false; clearInterval(this._ex); this._ex = null; return loginDialog(); }      // 자동 갱신을 멈춘다(매초 로그인 창이 다시 뜨지 않게)
      const r = await api("/api/mb/read?" + new URLSearchParams(q())); if (!r.ok) { $("#exRows").innerHTML = `<tr><td colspan="8" class="empty badc">${esc(r.why)}</td></tr>`; $("#exInfo").textContent = ""; return; }
      $("#exInfo").textContent = `${r.regs.length}개 · 왕복 ${r.rtt} ms`; const bits = r.fc <= 2;
      const ord = $("#exOrd").value; this._exLast = r;
      $("#exRows").innerHTML = r.regs.map((v, i) => { const a = r.addr + i, nx = r.regs[i + 1]; let u32 = null, i32 = null, f32 = null;
        if (nx !== undefined) { const dv = regsView([v, nx], ord); u32 = dv.getUint32(0); i32 = dv.getInt32(0); f32 = dv.getFloat32(0); }
        const w16 = regsView([v], ord);
        return `<tr><td class="n">${a}</td><td class="mono accc">${bits ? v : "0x" + v.toString(16).toUpperCase().padStart(4, "0")}</td><td class="n">${bits ? v : w16.getUint16(0)}</td><td class="n">${bits ? "" : w16.getInt16(0)}</td><td class="n">${bits || u32 === null ? "" : u32}</td><td class="n">${bits || i32 === null ? "" : i32}</td><td class="n">${bits || f32 === null ? "" : (Math.abs(f32) < 1e7 && Math.abs(f32) > 1e-4 || f32 === 0 ? f32.toPrecision(6) : f32.toExponential(3))}</td><td class="mono">${esc(r.tags[a] || "")}</td></tr>`; }).join("");
    };
    $("#exRead").onclick = read; $("#exOrd").onchange = () => { if (this._exLast) read(); }; $("#exAuto").onchange = e => { clearInterval(this._ex); this._ex = e.target.checked ? setInterval(read, 1000) : null; };
    $("#wrGo").onclick = async () => {
      if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return loginDialog(); }
      const toks = $("#wrVals").value.split(",").map(x => x.trim()).filter(Boolean), at = $("#wrAddr").value.trim();
      if (!toks.length || !toks.every(x => /^(0x[0-9a-f]{1,4}|\d{1,5})$/i.test(x))) return toast("값 형식 오류 — 0~65535 정수 또는 0x0000~0xFFFF, 쉼표 구분", "bad");
      const vals = toks.map(x => parseInt(x, /^0x/i.test(x) ? 16 : 10)); if (vals.some(v => v > 65535)) return toast("값 범위 오류 — 0~65535", "bad");
      if (!/^\d{1,5}$/.test(at) || +at > 65535) return toast("주소를 0~65535 정수로 입력하십시오", "bad");
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
    const load = async () => { const r = await api("/api/points"); if (!$("#ptRows") || !r.rows) return; this._pts = r.rows; draw(); };
    const draw = () => { if (!$("#ptRows")) return; const qq = $("#ptQ").value.toLowerCase(); $("#ptRows").innerHTML = (this._pts || []).filter(p => !qq || (p.tag + p.device).toLowerCase().includes(qq)).map(p => `<tr><td class="mono"><b>${esc(p.tag)}</b></td><td>${esc(p.device)}</td><td class="mono">${p.fc}:${p.addr}</td><td class="mono">${p.type}</td><td class="n">${p.scale}</td><td>${esc(p.unit)}</td><td class="n">${p.lo ?? ""}</td><td class="n">${p.hi ?? ""}</td><td>${p.rw === "w" ? `<span class="pill warn">W</span>` : `<span class="pill">R</span>`}</td><td class="n">${p.v === null || p.v === undefined ? "—" : F.n(p.v, 2)}</td><td>${p.rw === "w" ? `<span class="muted">지령</span>` : `<span class="pill ${p.f ? "bad" : "ok"}">${esc(p.ftxt)}</span>`}</td><td class="n">${p.age ?? ""}</td></tr>`).join(""); };
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
          ${[["load_surge", "부하 급증 +60kW"], ["cloud", "구름 통과 (PV −70%)"], ["night", "야간 (PV 0)"], ["soc_low", "ESS 충전율 22%"], ["soc_critical", "ESS 충전율 17%"], ["h2_low", "수소 잔량 130Nm³"], ["fault_l3", "3등급 급전선 과전류 트립"], ["fault_dg", "디젤 차동(87) 트립"], ["fault_ess", "ESS 지락(64) 트립"], ["tie_open", "모선 연계 개방"], ["grid_outage", "상전 정전(주둔지)"], ["grid_restore", "상전 복전"], ["normal", "▶ 정상 복귀 (전 고장 해제)"]].map(([k, v]) => `<button class="btn ${k === "normal" ? "go" : ""}" data-s="${k}">${v}</button>`).join("")}
          ${[[13, "모의 시각 13시(주간·태양광)"], [21, "모의 시각 21시(야간)"], ["", "실제 시각으로"]].map(([h, v]) => `<button class="btn" data-clk="${h}">${v}</button>`).join("")}</div>
          <div class="bd" style="border-top:1px solid var(--line)"><div class="lab" style="margin-bottom:8px">값 강제 (가상 장치 레지스터)</div><div class="form"><label>TAG<select class="in" id="svTag">${tags.map(x => `<option>${x}</option>`).join("")}</select></label><label>값<input class="in" id="svVal" type="number" step="any" style="width:100px"></label><label style="flex-direction:row;gap:6px;align-items:center;text-transform:none"><input type="checkbox" id="svHold" checked>유지</label><button class="btn eng" id="svGo">적용</button></div>
          <div id="simHold" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px"></div></div></div></div>
      <div class="panel" style="margin-top:18px"><div class="hd"><h3>급전선 차단기 · 보호 동작 주입</h3><div class="spacer"></div><span class="sub">보호 IED가 차단기를 트립하고 ANSI 보호요소 코드를 게이트웨이로 보고하는 상황을 모사</span></div>
        <div class="bd np"><table class="t"><thead><tr><th>급전선</th><th>차단기 상태</th><th>보호요소</th><th>고장 주입</th><th>조작</th></tr></thead><tbody id="simCb"></tbody></table></div></div>`;
    const act = async b => { if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return loginDialog(); } const r = await api("/api/sim", b); if (r.ok) { S.snap.sim_state = r.sim; this.simUpdate(); toast("고장 주입 적용", "ok"); } else toast(r.why, "bad"); };
    this._simAct = act;
    $$("#simScn [data-s]").forEach(b => b.onclick = () => act({ action: "scenario", name: b.dataset.s }));
    $$("#simScn [data-clk]").forEach(b => b.onclick = () => act({ action: "clock", hour: b.dataset.clk === "" ? null : +b.dataset.clk }));
    $("#svGo").onclick = () => { const x = parseFloat($("#svVal").value); if (!Number.isFinite(x)) return toast("값을 숫자로 입력하십시오", "bad"); act({ action: "set", tag: $("#svTag").value, value: x, hold: $("#svHold").checked }); };
    this.simUpdate();
  },
  simUpdate() {
    const s = S.snap; if (!s || !s.sim || !$("#simDev")) return; const ss = s.sim_state; const tog = (on, a, tgt) => `<button class="btn sm ${on ? "stop" : ""}" data-a="${a}" data-t="${tgt}" data-on="${on ? 0 : 1}">${on ? "● 적용 중 — 해제" : "적용"}</button>`;
    $("#simDev").innerHTML = Object.keys(s.devices).map(n => `<tr><td><b>${n}</b></td><td>${tog(ss.muted.includes(n), "mute", n)}</td><td>${s.devices[n].ctl ? tog(ss.noack.includes(n), "noack", n) : `<span class="muted">—</span>`}</td><td>${s.devices[n].ctl ? tog(ss.manual.includes(n), "manual", n) : `<span class="muted">—</span>`}</td></tr>`).join("");
    $("#simPath").innerHTML = ["A", "B"].map(p => `<span>경로 ${p} ${tog(ss.down.includes(p), "down", p)}</span>`).join("");
    const FD = [["PV", "태양광"], ["DG", "디젤"], ["FC", "연료전지"], ["ESS", "ESS"], ["G1", "복합전력 G1"], ["TIE", "모선 연계"], ["L1", "1등급 부하"], ["L2", "2등급 부하"], ["L3", "3등급 부하"]];
    const cbE = $("#simCb"); if (cbE && !cbE.dataset.built) { cbE.dataset.built = 1; cbE.innerHTML = FD.map(([f, nm]) => `<tr><td><b>CB-${f}</b> <span class="muted">${nm}</span></td><td id="sc-${f}"></td><td class="mono" id="sf-${f}"></td>
        <td><select class="in" id="scd-${f}" style="height:26px"><option value="51">51 한시 과전류</option><option value="50">50 순시 과전류</option><option value="87">87 차동</option><option value="64">64 지락</option><option value="27">27 저전압</option><option value="59">59 과전압</option><option value="81">81 주파수</option><option value="32">32 역전력</option></select>
        <button class="btn sm stop" data-flt="${f}">트립</button></td><td><button class="btn sm" data-cbo="${f}">개방</button> <button class="btn sm go" data-cbc="${f}">투입·복구</button></td></tr>`).join("");
      $$("#simCb [data-flt]").forEach(b => b.onclick = () => this._simAct({ action: "fault", target: b.dataset.flt, code: +$("#scd-" + b.dataset.flt).value }));
      $$("#simCb [data-cbo]").forEach(b => b.onclick = () => this._simAct({ action: "cb", target: b.dataset.cbo, on: false }));
      $$("#simCb [data-cbc]").forEach(b => b.onclick = () => this._simAct({ action: "cb", target: b.dataset.cbc, on: true })); }
    FD.forEach(([f]) => { const c = Math.round(val("CB." + f) ?? -1), e = $("#sc-" + f); if (!e) return; e.innerHTML = c === 1 ? `<span class="pill ok">투입</span>` : c === 2 ? `<span class="pill bad">트립</span>` : c === 0 ? `<span class="pill warn">개방</span>` : `<span class="pill">미상</span>`; const fc = Math.round(val("FLT." + f) || 0); $("#sf-" + f).textContent = fc ? (ANSI_TXT[fc] || fc) : "—"; });
    $$("#simDev [data-a], #simPath [data-a]").forEach(b => b.onclick = () => this._simAct({ action: b.dataset.a, target: b.dataset.t, on: b.dataset.on === "1" }));
    $("#simHold").innerHTML = Object.entries(ss.hold).map(([k, v]) => `<span class="pill eng">${k} = ${F.n(v, 1)} <a href="#" data-r="${k}" style="color:#fff;margin-left:6px;text-decoration:none">✕</a></span>`).join("") || `<span class="muted" style="font-size:12px">강제 유지 값 없음${ss.scenario ? " · 시나리오: " + ss.scenario : ""}</span>`;
    $$("#simHold [data-r]").forEach(a => a.onclick = e => { e.preventDefault(); this._simAct({ action: "release", tag: a.dataset.r }); });
  },
  async info() {
    const r = await api("/api/info"); const v = await api("/api/audit/verify");
    if (this.tab !== "info" || S.page !== "eng" || !$("#engBody") || !r.version) return;
    $("#engBody").innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)"><div class="panel"><div class="hd"><h3>실행 정보</h3></div><div class="bd"><div class="kv band">
      <span class="k">패키지 리비전</span><span class="v">${esc(r.version.pkg || "")}</span><span class="k">EMS 연동 계층</span><span class="v">v${r.version.rt}</span><span class="k">핵심 프로그램</span><span class="v">v${r.version.core}</span><span class="k">운전 정책</span><span class="v" style="font-family:var(--sans)">${esc(r.policy)}</span>
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
const PAGE_META = {
  overview: ["mon", "계측", "MONITOR", "SYSTEM OVERVIEW", "전원·부하·모선 상태를 한 화면에서 감시"],
  sld: ["mon", "계측", "MONITOR", "SINGLE-LINE DIAGRAM", "모선·차단기·급전선 상태"],
  energy: ["mon", "계측", "MONITOR", "ENERGY & FORECAST", "발전량·부하량 적산과 24시간 예측 정밀도"],
  trends: ["mon", "계측", "MONITOR", "HISTORICAL TRENDS", "1초 표본 4시간 추세"],
  control: ["ctl", "제어", "CONTROL", "EQUIPMENT CONTROL", "선택-실행(SBO) 지령 · 자동 급전"],
  alarms: ["mgt", "관리", "MANAGE", "ALARM MANAGEMENT", "경보 확인·이력 · 감사 기록 무결성"],
  comm: ["mgt", "관리", "MANAGE", "COMMUNICATIONS", "이중 경로 통신 품질 · 수집 주기 · 워치독"],
  eng: ["mgt", "관리", "MANAGE", "ENGINEERING", "레지스터·프레임·포인트 · 고장 주입"],
};
function decoratePage(p) {
  const hd = $("#main .pagehd"), m = PAGE_META[p]; if (!hd || !m || hd.querySelector(".pcat")) return;
  hd.insertAdjacentHTML("afterbegin", `<span class="pcat ${m[0]}"><b>${S.lang === "ko" ? m[1] : m[2]}</b>${m[3]}</span>`);
  const sub = hd.querySelector(".sub"); if (sub && !sub.textContent.trim()) sub.textContent = m[4];
}
/* 레지스터 → 표준(ABCD) 순서 DataView. modbus.py to_std와 같은 규칙 */
function regsView(regs, ord) {
  let w = regs.map(x => x & 0xFFFF);
  if (ord === "BADC" || ord === "DCBA") w = w.map(x => ((x & 0xFF) << 8) | (x >> 8));
  if (ord === "CDAB" || ord === "DCBA") w = w.slice().reverse();
  const dv = new DataView(new ArrayBuffer(2 * w.length)); w.forEach((x, k) => dv.setUint16(2 * k, x)); return dv;
}
const PAGES = { overview: P_OV, sld: P_SLD, control: P_CTL, alarms: P_ALM, energy: P_EN, trends: P_TR, comm: P_CM, eng: P_ENG };
let mounted = null;
function render() {
  if (!S.snap) return; const p = PAGES[S.page] ? S.page : "overview";
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.p === p));
  if (mounted !== p + S.lang + S.theme) { clearInterval(P_ENG._ex); const m = $("#main"); PAGES[p].mount(m); applyI18n(m); decoratePage(p); mounted = p + S.lang + S.theme; }
  try { PAGES[p].update(S.snap); } catch (e) { console.error(e); }
}
window.addEventListener("hashchange", () => {
  if (L.edit) { if (L.dirty) toast("저장하지 않은 배치 변경을 버렸습니다", "bad"); L.edit = false; L.sel = null; L.dirty = false; layoutLoad(); }     // 배치 편집은 개요 화면 안에서만
  S.page = location.hash.slice(1) || "overview"; mounted = null; render(); });
$$("#lang button").forEach(b => b.onclick = () => { S.lang = b.dataset.l; try { localStorage.setItem("ems.lang", S.lang); } catch (e) { } $$("#lang button").forEach(x => x.classList.toggle("on", x === b)); applyI18n(); mounted = null; renderUser(); renderHeader(); render(); });

async function poll() {
  try {
    const s = await api("/api/snapshot"); if (!s || !s.values || !s.devices) return;      // 오류 응답(500 등)이면 갱신하지 않는다 → 3.5초 뒤 '서버 응답 없음' 표시
    S.snap = s; S.lastOk = Date.now();
    if (s.me && (s.me.role !== S.me.role)) { if (S.token && s.me.role === "viewer") { S.token = null; try { sessionStorage.removeItem("ems.token"); } catch (e) { } toast("세션 만료 — 다시 로그인하세요", "bad"); } S.me = s.me; renderUser(); }
    renderHeader(); render();
  } catch (e) { }
}
async function pollTrend() {
  try { const r = await api("/api/trend?since=" + S.trendT); if (r.rows && r.rows.length) { S.trend = S.trend.concat(r.rows); if (S.trend.length > 14400) S.trend = S.trend.slice(-14400); S.trendT = S.trend[S.trend.length - 1][0]; if (S.page === "trends") P_TR.update(); } } catch (e) { }
}
setInterval(() => { const stale = Date.now() - S.lastOk > 3500; $("#stale").classList.toggle("on", stale && S.lastOk > 0); const c = $("#conn"); c.className = "conn" + (stale ? " bad" : ""); c.textContent = stale ? "● SERVER LOST" : "● LINK " + (S.snap ? F.n(S.snap.stats.last_ms, 0) + "ms" : ""); }, 500);
$$("#lang button").forEach(x => x.classList.toggle("on", x.dataset.l === S.lang));
$$("#themeSeg button").forEach(b => { b.classList.toggle("on", b.dataset.th === S.theme); b.onclick = () => { S.theme = b.dataset.th; document.documentElement.dataset.theme = S.theme; try { localStorage.setItem("ems.theme", S.theme); } catch (e) { } $$("#themeSeg button").forEach(x => x.classList.toggle("on", x === b)); mounted = null; render(); if (S.page === "energy") P_EN.draw(); }; });
S.page = location.hash.slice(1) || "overview"; renderUser(); applyI18n(); fitCanvas();
poll(); pollTrend(); setInterval(poll, 1000); setInterval(pollTrend, 2000); setInterval(() => P_ENG.pollTrace(), 700);
