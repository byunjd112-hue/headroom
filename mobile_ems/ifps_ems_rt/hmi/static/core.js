/* IFPS Mobile EMS HMI — 공통: 통신, 상태, 다국어, 서식, 차트, 대화상자 */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

/* 테마 변수 읽기: TV("--pv") → "#e8c547", TA("--edge", .12) → "rgba(150,160,110,.12)" */
const TV = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TA = (n, a) => `rgba(${TV(n)},${a})`;
const S = { snap: null, token: null, me: { role: "viewer", name: "조회" }, lang: "ko", page: "overview", trend: [], trendT: 0, ok: true, lastOk: 0 };
S.theme = "olive";
try { S.token = sessionStorage.getItem("ems.token"); S.lang = localStorage.getItem("ems.lang") || "ko"; S.theme = localStorage.getItem("ems.theme") || "olive"; } catch (e) { }
document.documentElement.dataset.theme = S.theme;

/* ── 다국어 */
const I18N = {
  en: {
    "nav.overview": "Overview", "nav.control": "Control", "nav.alarms": "Alarms", "nav.trends": "Trends", "grp.mon": "MONITOR", "grp.ctl": "CONTROL", "grp.mgt": "MANAGE", "nav.energy": "Energy & Forecast", "nav.comm": "Comms", "nav.eng": "Debug",
    "foot.latest": "Latest alarm", "btn.ack": "Ack", "btn.ackall": "Ack all", "btn.acksel": "Ack selected", "btn.login": "Log in", "btn.logout": "Log out",
    "btn.start": "START", "btn.stop": "STOP", "btn.cancel": "Cancel", "btn.select": "Select", "btn.execute": "EXECUTE", "btn.read": "Read", "btn.write": "Write",
    "ov.title": "System Overview", "ov.sld": "Single-Line Diagram · Live Power Flow", "ov.balance": "Power Balance", "ov.ess": "Energy Storage", "ov.fuel": "Fuel & Hydrogen",
    "ov.reserve": "N-1 Spinning Reserve", "ov.env": "Shelter Environment", "ov.auto": "Automatic Dispatch", "ov.trend": "Power Trend · 15 min",
    "k.load": "Load", "k.pv": "Solar PV", "k.dg": "Diesel Gen", "k.fc": "Fuel Cell", "k.ess": "ESS", "k.soc": "State of Charge", "k.h2": "Hydrogen", "k.fuel": "Diesel Fuel",
    "k.renew": "Renewable share", "k.gen": "Generation", "k.margin": "Margin", "k.l12": "Class 1+2 load", "k.need": "Reserve required", "k.ok": "Sufficient",
    "ctl.title": "Equipment Control", "ctl.auto": "Automatic Dispatch", "ctl.log": "Command Log", "ctl.sbo": "Select-Before-Operate",
    "alm.title": "Alarm Management", "alm.active": "Alarm List", "alm.journal": "Alarm Journal", "alm.audit": "Audit Trail", "alm.verify": "Verify chain",
    "tr.title": "Historical Trends", "cm.title": "Communication Diagnostics", "eng.title": "Engineering & Debug Tools",
    "eng.explorer": "Register Explorer", "eng.trace": "Frame Trace", "eng.points": "Point Map", "eng.sim": "Simulator / Fault Injection", "eng.info": "System Info",
  },
};
const t = (k, ko) => (S.lang !== "ko" && I18N[S.lang] && I18N[S.lang][k]) || ko || k;
function applyI18n(root = document) { $$("[data-i18n]", root).forEach(el => { if (!el.dataset.ko) el.dataset.ko = el.textContent; el.textContent = t(el.dataset.i18n, el.dataset.ko); }); }

/* ── 서식 */
const F = {
  n: (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : Number(v).toFixed(d),
  kw: (v, d = 1) => F.n(v, d),
  time: ts => { const d = new Date(ts * 1000); return d.toTimeString().slice(0, 8); },
  dt: ts => { const d = new Date(ts * 1000); const p = n => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${d.toTimeString().slice(0, 8)}`; },
  dur: s => { s = Math.round(s); const hh = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60; return hh ? `${hh}h ${String(mm).padStart(2, "0")}m` : `${mm}m ${String(ss).padStart(2, "0")}s`; },
  hrs: v => (v === null || v === undefined || !isFinite(v)) ? "—" : (v >= 100 ? ">99" : v.toFixed(1)),
  dtg: d => { const M = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]; const p = n => String(n).padStart(2, "0"); return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${M[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; },
};
const PRIO = { 1: "긴급", 2: "높음", 3: "보통", 4: "낮음" }, PRIO_EN = { 1: "CRIT", 2: "HIGH", 3: "MED", 4: "LOW" };
const prioTxt = p => S.lang === "ko" ? PRIO[p] : PRIO_EN[p];
const COLORS = new Proxy({}, { get: (_, k) => TV("--" + ({ soc: "ess", h2: "fc", reserve: "g1" }[k] || k)) });

/* ── 통신 */
async function api(path, body) {
  const opt = { method: body === undefined ? "GET" : "POST", headers: {} };
  if (S.token) opt.headers["X-EMS-Token"] = S.token;
  if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  let j; try { j = await r.json(); } catch (e) { j = { ok: false, why: `HTTP ${r.status}` }; }
  if (r.status === 403) { j.ok = false; toast(j.why || "권한 필요", "bad"); if (/권한/.test(j.why || "") && S.me.role === "viewer") loginDialog(); }
  return j;
}

/* ── 알림·대화상자 */
function toast(msg, kind = "") { const el = h(`<div class="${kind}">${esc(msg)}</div>`); $("#toast").appendChild(el); setTimeout(() => el.remove(), 4200); }
function modal(html, onMount) { const bg = $("#modal"), box = $("#modalBox"); box.innerHTML = html; bg.classList.add("on"); applyI18n(box); if (onMount) onMount(box); return box; }
function closeModal() { $("#modal").classList.remove("on"); $("#modalBox").innerHTML = ""; if (S._sboTimer) { clearInterval(S._sboTimer); S._sboTimer = null; } }
$("#modal").addEventListener("mousedown", e => { if (e.target.id === "modal" && !S._sboTimer) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#modal").classList.contains("on")) { if (S._sboSid) api("/api/cancel", { sid: S._sboSid }); closeModal(); } });

function loginDialog() {
  const sim = S.snap && S.snap.sim;
  modal(`<div class="hd"><h3>운용자 인증</h3><span class="muted">Operator authentication</span></div>
  <div class="bd"><div class="form" style="flex-direction:column;align-items:stretch">
    <label>이름 / 직책<input class="in" id="lgName" maxlength="24" placeholder="예: 운용병 김OO" value="${esc(S.me.name !== "조회" ? S.me.name : "")}"></label>
    <label>PIN<input class="in" id="lgPin" type="password" inputmode="numeric" autocomplete="off"></label>
    <div class="muted" style="font-size:12px">운용자: 지령·경보 확인 · 엔지니어: + 레지스터 쓰기·고장 주입. 모든 인증과 지령은 감사 기록에 남습니다.</div>
    ${sim ? `<div class="engbox">가상 장치 모드 기본 PIN — 운용자 <b class="mono">1111</b>, 엔지니어 <b class="mono">2222</b> (runtime.json → hmi에서 변경)</div>` : ""}
    <div id="lgErr" class="badc"></div></div></div>
  <div class="ft"><button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="lgGo">로그인</button></div>`, box => {
    const go = async () => {
      const r = await api("/api/login", { pin: $("#lgPin", box).value, name: $("#lgName", box).value.trim() || "운용자" });
      if (!r.ok) { $("#lgErr", box).textContent = r.why; return; }
      S.token = r.token; S.me = { role: r.role, name: r.name }; try { sessionStorage.setItem("ems.token", r.token); } catch (e) { }
      closeModal(); toast(`${r.name} — ${r.role === "engineer" ? "엔지니어" : "운용자"} 권한`, "ok"); renderUser(); render();
    };
    $("#lgGo", box).onclick = go; $("#lgPin", box).onkeydown = e => { if (e.key === "Enter") go(); }; setTimeout(() => ($("#lgName", box).value ? $("#lgPin", box) : $("#lgName", box)).focus(), 30);
  });
}
async function logout() { await api("/api/logout", {}); S.token = null; S.me = { role: "viewer", name: "조회" }; try { sessionStorage.removeItem("ems.token"); } catch (e) { } renderUser(); render(); }
const can = role => ({ viewer: 0, operator: 1, engineer: 2 }[S.me.role] >= { viewer: 0, operator: 1, engineer: 2 }[role]);

/* ── 선택-실행(SBO) 지령 대화상자 */
async function sbo(dev, cmd, opts = {}) {
  if (!can("operator")) { loginDialog(); return; }
  const label = opts.label || `${dev} ${cmd === "start" ? "기동" : cmd === "stop" ? "정지" : cmd}`;
  const r = await api("/api/select", { dev, cmd, tag: opts.tag, value: opts.value });
  if (!r.ok) {
    modal(`<div class="hd"><h3>지령 차단 — 연동 조건 불만족</h3></div><div class="bd"><div class="sbo-steps"><div class="done">① 선택</div><div>② 확인</div><div>③ 실행</div></div>
      <div class="kv"><span class="k">대상</span><span class="v">${esc(label)}</span><span class="k">사유</span><span class="v badc" style="font-family:var(--sans)">${esc(r.why)}</span></div></div>
      <div class="ft"><button class="btn" onclick="closeModal()">닫기</button></div>`); return;
  }
  S._sboSid = r.sid; const tEnd = Date.now() + r.exp_s * 1000;
  modal(`<div class="hd"><h3>${t("ctl.sbo", "선택-실행 지령")}</h3><span class="pill warn">${esc(dev)}</span></div>
    <div class="bd"><div class="sbo-steps"><div class="done">① 선택 완료</div><div class="on">② 확인</div><div>③ 실행</div></div>
    <div class="kv"><span class="k">대상 장치</span><span class="v">${esc(dev)}</span><span class="k">지령</span><span class="v" style="font-family:var(--sans);font-weight:700">${esc(label)}</span>
    <span class="k">연동 조건</span><span class="v okc" style="font-family:var(--sans)">만족 (통신·모드·중복 확인)</span><span class="k">운용자</span><span class="v" style="font-family:var(--sans)">${esc(S.me.name)}</span></div>
    <div class="count"><i id="sboBar" style="width:100%"></i></div><div class="muted" style="margin-top:6px;font-size:12px"><span id="sboLeft"></span>초 안에 실행하지 않으면 선택이 해제됩니다.</div></div>
    <div class="ft"><button class="btn" id="sboCancel">${t("btn.cancel", "취소")}</button><button class="btn ${cmd === "stop" ? "stop" : "go"}" id="sboGo">${t("btn.execute", "실행")}</button></div>`, box => {
    const tick = () => { const left = Math.max(0, (tEnd - Date.now()) / 1000); const bar = $("#sboBar", box); if (!bar) return; bar.style.width = (left / r.exp_s * 100) + "%"; $("#sboLeft", box).textContent = left.toFixed(0); if (left <= 0) { closeModal(); toast("선택 시간 초과 — 지령 취소", "bad"); } };
    S._sboTimer = setInterval(tick, 200); tick();
    $("#sboCancel", box).onclick = async () => { await api("/api/cancel", { sid: r.sid }); S._sboSid = null; closeModal(); };
    $("#sboGo", box).onclick = async () => { const o = await api("/api/operate", { sid: r.sid }); S._sboSid = null; closeModal(); toast(o.ok ? `${label} 지령 송신 — 응답 확인 대기` : `실행 거부: ${o.why}`, o.ok ? "ok" : "bad"); };
  });
}

/* ── 선 그래프(캔버스). series: [{key, label, color, axis:'l'|'r', fill}] */
class Chart {
  constructor(canvas, opt) {
    this.c = canvas; this.o = Object.assign({ height: 220, yl: "kW", yr: "%", window: 900, rmax: 100, rmin: 0 }, opt); this.rows = []; this.cols = []; this.hover = null;
    canvas.style.height = this.o.height + "px";
    canvas.addEventListener("mousemove", e => { const r = canvas.getBoundingClientRect(); this.hover = e.clientX - r.left; this.draw(); });
    canvas.addEventListener("mouseleave", () => { this.hover = null; this.draw(); });
    this._ro = new ResizeObserver(() => this.draw()); this._ro.observe(canvas);
  }
  set(cols, rows) { this.cols = cols; this.rows = rows; this.draw(); }
  draw() {
    const c = this.c, o = this.o, dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = o.height; if (!W) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const L = 48, R = o.series.some(s => s.axis === "r") ? 44 : 14, T = 12, B = 24, pw = W - L - R, ph = H - T - B;
    const idx = k => this.cols.indexOf(k); const now = this.rows.length ? this.rows[this.rows.length - 1][0] : Date.now();
    const t0 = now - o.window * 1000; const rows = this.rows.filter(r => r[0] >= t0);
    let lmax = 10, lmin = 0;
    o.series.filter(s => s.axis !== "r" && !s.hidden).forEach(s => { const i = idx(s.key); rows.forEach(r => { const v = r[i]; if (v > lmax) lmax = v; if (v < lmin) lmin = v; }); });
    const step = niceStep((lmax - lmin) / 5); lmax = Math.ceil(lmax / step) * step; lmin = Math.floor(lmin / step) * step;
    const X = tm => L + (tm - t0) / (o.window * 1000) * pw, YL = v => T + ph - (v - lmin) / (lmax - lmin || 1) * ph, YR = v => T + ph - (v - o.rmin) / (o.rmax - o.rmin) * ph;
    g.font = "11px " + getComputedStyle(document.body).getPropertyValue("--mono"); g.strokeStyle = TA("--edge", .12); g.fillStyle = TV("--muted"); g.lineWidth = 1;
    for (let v = lmin; v <= lmax + 1e-9; v += step) { const y = Math.round(YL(v)) + .5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); g.textAlign = "right"; g.fillText(fmtAxis(v), L - 6, y + 4); }
    if (lmin < 0) { g.strokeStyle = "#3a4d62"; g.beginPath(); g.moveTo(L, YL(0)); g.lineTo(L + pw, YL(0)); g.stroke(); }
    if (R > 20) { g.textAlign = "left"; for (let k = 0; k <= 4; k++) { const v = o.rmin + (o.rmax - o.rmin) * k / 4; g.fillText(fmtAxis(v), L + pw + 6, YR(v) + 4); } }
    g.textAlign = "center"; const tickS = o.window <= 900 ? 120 : o.window <= 3600 ? 600 : 1800;
    for (let tm = Math.ceil(t0 / (tickS * 1000)) * tickS * 1000; tm <= now; tm += tickS * 1000) { const x = X(tm); g.fillText(new Date(tm).toTimeString().slice(0, 5), x, H - 6); g.strokeStyle = TA("--edge", .06); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); }
    g.fillStyle = "#6f8197"; g.textAlign = "left"; g.fillText(o.yl, 4, T + 8);
    o.series.forEach(s => {
      if (s.hidden) return; const i = idx(s.key); if (i < 0 || !rows.length) return; const Y = s.axis === "r" ? YR : YL;
      g.beginPath(); rows.forEach((r, k) => { const x = X(r[0]), y = Y(r[i]); k ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = s.color; g.lineWidth = s.w || 1.8; g.lineJoin = "round"; g.stroke();
      if (s.fill) { g.lineTo(X(rows[rows.length - 1][0]), Y(Math.max(lmin, 0))); g.lineTo(X(rows[0][0]), Y(Math.max(lmin, 0))); g.closePath(); const gr = g.createLinearGradient(0, T, 0, T + ph); gr.addColorStop(0, s.color + "88"); gr.addColorStop(1, s.color + "05"); g.fillStyle = gr; g.fill(); }
    });
    if (this.hover !== null && rows.length && this.hover > L && this.hover < L + pw) {
      const tm = t0 + (this.hover - L) / pw * o.window * 1000; let best = rows[0]; rows.forEach(r => { if (Math.abs(r[0] - tm) < Math.abs(best[0] - tm)) best = r; });
      const x = X(best[0]); g.strokeStyle = "#5b7390"; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); g.setLineDash([]);
      const lines = [new Date(best[0]).toTimeString().slice(0, 8)].concat(o.series.filter(s => !s.hidden).map(s => [s, best[idx(s.key)]]));
      const bw = 150, bh = 18 * lines.length + 8, bx = x + 12 + bw > W ? x - bw - 12 : x + 12, by = T + 6;
      g.fillStyle = "rgba(12,19,27,.94)"; g.strokeStyle = "#2c3d50"; g.beginPath(); g.roundRect ? g.roundRect(bx, by, bw, bh, 6) : g.rect(bx, by, bw, bh); g.fill(); g.stroke();
      lines.forEach((ln, k) => { const y = by + 18 + k * 18; if (k === 0) { g.fillStyle = "#a9b6c6"; g.fillText(ln, bx + 10, y); return; } const [s, v] = ln; g.fillStyle = s.color; g.fillRect(bx + 10, y - 8, 8, 8); g.fillStyle = "#dbe4ee"; g.fillText(`${s.label}`, bx + 24, y); g.textAlign = "right"; g.fillText(F.n(v, 1) + (s.axis === "r" ? " " + o.yr : ""), bx + bw - 10, y); g.textAlign = "left"; });
    }
  }
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9)))), m = x / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
function fmtAxis(v) { return Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : (Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : v.toFixed(0)); }

/* ── 반원 눈금 계기(240°) */
function gauge(pct, size = 260) {
  const cx = size / 2, cy = size / 2 - 4, r = size * 0.33, a0 = 150, sw = 240, p = Math.max(0, Math.min(100, pct || 0)) / 100;
  const P = (deg, rr) => [cx + rr * Math.cos(deg * Math.PI / 180), cy + rr * Math.sin(deg * Math.PI / 180)];
  const arc = (d0, d1, rr) => { const [x0, y0] = P(d0, rr), [x1, y1] = P(d1, rr); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rr} ${rr} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  let ticks = "";
  for (let v = 0; v <= 100; v += 5) {
    const d = a0 + sw * v / 100, major = v % 20 === 0, [x0, y0] = P(d, r + 16), [x1, y1] = P(d, r + (major ? 26 : 22));
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${v <= 15 || v >= 90 ? "#ffb547" : "#7f93c8"}" stroke-width="${major ? 2 : 1.2}" opacity="${major ? 1 : .6}"/>`;
    if (major) { const [tx, ty] = P(d, r + 38); ticks += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" fill="#8b9bc6" font-size="11">${v}</text>`; }
  }
  return `<svg width="${size}" height="${size * 0.78}" viewBox="0 0 ${size} ${size * 0.78}"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--accent2)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient>
    <filter id="gglow"><feGaussianBlur stdDeviation="3"/></filter></defs>
    <path d="${arc(a0, a0 + sw, r)}" fill="none" stroke="rgba(30,52,120,.9)" stroke-width="18" stroke-linecap="round"/>
    ${p > 0.005 ? `<path d="${arc(a0, a0 + sw * p, r)}" fill="none" stroke="url(#gg)" stroke-width="18" stroke-linecap="round" filter="url(#gglow)" opacity=".6"/><path d="${arc(a0, a0 + sw * p, r)}" fill="none" stroke="url(#gg)" stroke-width="18" stroke-linecap="round"/>` : ""}${ticks}</svg>`;
}

/* ── 원형 계기 */
function ring(pct, color, size = 132, marks = []) {
  const r = size / 2 - 10, c = 2 * Math.PI * r, a0 = 0.75, span = 0.75; const p = Math.max(0, Math.min(100, pct || 0)) / 100;
  const arc = (from, to) => `stroke-dasharray="${c * (to - from) * span} ${c}" stroke-dashoffset="${-c * (a0 / 1 * 0 + from * span)}"`;
  const mk = marks.map(m => { const ang = (135 + 270 * m / 100) * Math.PI / 180; const x1 = size / 2 + (r - 9) * Math.cos(ang), y1 = size / 2 + (r - 9) * Math.sin(ang), x2 = size / 2 + (r + 7) * Math.cos(ang), y2 = size / 2 + (r + 7) * Math.sin(ang); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f5b84b" stroke-width="2"/>`; }).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="rotate(135 ${size / 2} ${size / 2})">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#18232f" stroke-width="10" ${arc(0, 1)} stroke-linecap="round"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="10" ${arc(0, p)} stroke-linecap="round" style="transition:stroke-dasharray .6s"/></g>${mk}</svg>`;
}
