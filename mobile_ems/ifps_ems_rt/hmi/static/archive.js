"use strict";
/* 기록 · 보고서 화면: 검침 누적값과 운전 실적을 시간·일·월·년 단위로 찾아보고, 상황 기록을 글자로 찾고, 점검 기록을 넣고, 운영 보고서(Word)를 내려받는다.
   TPCS 화면의 한 쪽(P_ARCHIVE)이자 별도 기록 조회기(viewer.html)가 같이 쓴다. 조회기에서는 읽기만 한다. */
const ARC = {
  unit: "hour", at: "", tab: "meter", dev: "", sig: "", essRaw: false, q: "", kind: "", data: null, info: null, standalone: false,
  UNITS: [["hour", "시간별", "하루"], ["day", "일별", "한 달"], ["month", "월별", "한 해"], ["year", "연도별", "전체"]],
  COLS: [["load_kwh", "부하"], ["pv_kwh", "태양광"], ["dg_kwh", "디젤"], ["fc_kwh", "연료전지"], ["gdg_kwh", "주둔지 발전기"], ["grid_in_kwh", "수전"], ["grid_out_kwh", "역송"], ["ess_chg_kwh", "ESS 충전"], ["ess_dis_kwh", "ESS 방전"]],
  CUM: [["cum_load", "부하 전력량"], ["cum_pv", "태양광 발전량"], ["cum_gen", "발전기 발전량"], ["cum_grid_in", "수전 전력량"], ["cum_grid_out", "역송 전력량"]],
  e(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
  n(v, d = 1) { return v === null || v === undefined ? "—" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d }); },
  today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  async get(path) {
    const h = {}; if (typeof S !== "undefined" && S.token) h["X-TPCS-Token"] = S.token;
    const r = await fetch(path, { headers: h }); let j; try { j = await r.json(); } catch (e) { j = { ok: false, why: `HTTP ${r.status}` }; } return j;
  },
  say(msg, kind) { if (typeof toast === "function") toast(msg, kind); else { const el = document.getElementById("arcMsg"); if (el) el.textContent = msg; } },
  role(need) { return !this.standalone && typeof can === "function" && can(need); },

  mount(m) {
    if (!this.at) this.at = this.today();
    m.innerHTML = `<div class="pagehd"><h2>기록 · 보고서</h2><span class="sub">검침 누적값 · 운전 실적 · 상황 기록 · 점검 기록을 시간 · 일 · 월 · 년 단위로 찾아본다${this.standalone ? " — 기록 조회기(읽기 전용)" : ""}</span></div>
    <div class="panel arc-bar"><div class="hd">
      <div class="seg" id="arcUnit">${this.UNITS.map(u => `<button data-u="${u[0]}" title="${u[2]}을(를) 한 화면에">${u[1]}</button>`).join("")}</div>
      <button class="btn sm" id="arcPrev" title="앞 구간">◀</button><input class="in" type="date" id="arcAt" value="${this.at}"><button class="btn sm" id="arcNext" title="다음 구간">▶</button><button class="btn sm" id="arcNow">오늘</button>
      <b id="arcTitle" class="arc-title"></b><div class="spacer"></div><span id="arcMsg" class="sub"></span>
      <a class="btn" id="arcCsv" title="지금 보는 표를 CSV 로">CSV 내려받기</a>
      <select class="in" id="arcDays" title="보고서에 담을 최근 기간"><option value="1">최근 1일</option><option value="7" selected>최근 7일</option><option value="31">최근 1달</option><option value="92">최근 3달</option><option value="366">최근 1년</option></select>
      <button class="btn pri" id="arcRep" title="현재 현황 · 최근 운영 현황 · 상황 기록 · 운전 시퀀스 · 점검 기록을 Word 문서로">보고서 출력(Word)</button>
      ${this.standalone ? "" : `<span class="arc-fm" title="지금 화면에 보이는 구성(장비 대수 · 모선 · 환망 · 부하)으로 FMEA 의 해당 항목을 펼치고 FAT 점검표를 만든다. 점수는 새로 매기지 않고, 구성 때문에 달라지는 줄은 '재검토'로 표시한다"><span class="muted" style="font-size:12px;margin:0 2px 0 10px">현재 구성으로 FMEA · FAT 내보내기</span><button class="btn sm" data-fm="fmea,html">FMEA · FTA(HTML)</button><button class="btn sm" data-fm="fat,html">FAT 점검표(HTML)</button><button class="btn sm" data-fm="site,xlsx">FMEA · FAT(Excel)</button></span>`}</div></div>
    <div class="tabs" id="arcTabs"><button data-t="meter">운전 실적 · 검침</button><button data-t="device">장치별 자료</button><button data-t="ess">ESS 안전 기록</button><button data-t="events">상황 기록</button><button data-t="inspect">점검 기록</button><button data-t="xfer">서버 전달</button><button data-t="collect">수집 항목</button><button data-t="store">보관 상태</button></div><div id="arcBody"></div>`;
    m.querySelectorAll("#arcUnit button").forEach(b => b.onclick = () => { this.unit = b.dataset.u; this.load(); });
    m.querySelectorAll("#arcTabs button").forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.load(); });
    m.querySelector("#arcAt").onchange = e => { this.at = e.target.value || this.today(); this.load(); };
    m.querySelector("#arcPrev").onclick = () => this.shift(-1); m.querySelector("#arcNext").onclick = () => this.shift(1);
    m.querySelector("#arcNow").onclick = () => { this.at = this.today(); this.load(); };
    m.querySelector("#arcRep").onclick = () => this.report(); this.load();
    m.querySelectorAll("[data-fm]").forEach(b => { b.onclick = () => { const [doc, fmt] = b.dataset.fm.split(","); this.fetchFile(`/api/archive/fmexport?doc=${doc}&fmt=${fmt}`, `EMS_${doc}.${fmt}`, "문서"); }; });
  },
  update() { },
  shift(k) {
    const d = new Date(this.at + "T00:00:00");
    if (this.unit === "hour") d.setDate(d.getDate() + k); else if (this.unit === "day") d.setMonth(d.getMonth() + k); else if (this.unit === "month") d.setFullYear(d.getFullYear() + k); else return;
    this.at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; this.load();
  },
  qs() { return `unit=${this.unit}&at=${this.at}`; },
  async load() {
    const $q = s => document.querySelector(s); if (!$q("#arcBody")) return;
    document.querySelectorAll("#arcUnit button").forEach(b => b.classList.toggle("on", b.dataset.u === this.unit));
    document.querySelectorAll("#arcTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === this.tab));
    $q("#arcAt").value = this.at; $q("#arcCsv").href = this.tab === "device" ? `/api/archive/device.csv?dev=${this.dev}&${this.qs()}` : this.tab === "ess" ? `/api/archive/ess.csv?unit=${this.essRaw ? "raw" : this.unit}&at=${this.at}` : `/api/archive/series.csv?${this.qs()}`;
    $q("#arcCsv").style.visibility = ["meter", "device", "ess"].includes(this.tab) ? "" : "hidden";
    this.info = await this.get("/api/archive/info");
    if (!this.info.ok) { $q("#arcBody").innerHTML = `<div class="panel"><div class="bd"><p class="warnc">${this.e(this.info.why || "기록 보관소를 열 수 없습니다")}</p></div></div>`; return; }
    if (this.tab === "meter") return this.meter(); if (this.tab === "device") return this.device(); if (this.tab === "ess") return this.ess(); if (this.tab === "xfer") return this.xfer(); if (this.tab === "collect") return this.collect(); if (this.tab === "events") return this.events(); if (this.tab === "inspect") return this.inspect(); return this.store();
  },

  /* ── 운전 실적 · 검침 */
  async meter() {
    const r = await this.get(`/api/archive/series?${this.qs()}`), B = document.querySelector("#arcBody"); if (!B) return;
    document.querySelector("#arcTitle").textContent = r.title || ""; const rows = r.rows || []; this.data = rows;
    const sum = c => rows.reduce((a, x) => a + (x[c] || 0), 0), mx = c => rows.reduce((a, x) => Math.max(a, x[c] || 0), 0), last = rows[rows.length - 1] || {}, first = rows[0] || {};
    const gen = sum("dg_kwh") + sum("fc_kwh") + sum("gdg_kwh"), demo = rows.some(x => x.demo);
    const tile = (l, v, u, s) => `<div class="arc-tile"><span>${l}</span><b>${v}</b><i>${u}</i>${s ? `<em>${s}</em>` : ""}</div>`;
    B.innerHTML = `<div class="arc-tiles">${tile("부하 전력량", this.n(sum("load_kwh")), "kWh", "최대 " + this.n(mx("load_max")) + " kW")}${tile("태양광 발전량", this.n(sum("pv_kwh")), "kWh", sum("load_kwh") ? "부하 대비 " + this.n(100 * sum("pv_kwh") / sum("load_kwh")) + " %" : "")}
      ${tile("발전기 발전량", this.n(gen), "kWh", "디젤 · 연료전지 · 주둔지")}${tile("수전량", this.n(sum("grid_in_kwh")), "kWh", "최대 " + this.n(mx("grid_max")) + " kW")}${tile("ESS 충전 / 방전", this.n(sum("ess_chg_kwh"), 0) + " / " + this.n(sum("ess_dis_kwh"), 0), "kWh", "")}</div>
    <div class="arc-grid"><div class="panel"><div class="hd"><h3>전력량 (kWh) — ${this.e(r.title || "")}</h3><div class="spacer"></div><span class="arc-leg"><i class="c-load"></i>부하 <i class="c-pv"></i>태양광 <i class="c-gen"></i>발전기 <i class="c-grid"></i>수전</span></div><div class="bd"><div id="arcChart"></div></div></div>
      <div class="panel"><div class="hd"><h3>검침 누적값 (kWh)</h3></div><div class="bd np"><table class="t"><thead><tr><th>검침 항목</th><th class="n">구간 시작</th><th class="n">구간 끝</th><th class="n">사용량</th></tr></thead><tbody>
      ${this.CUM.map(c => { const a = first[c[0]], b = last[c[0]], u = rows.length ? (b || 0) - (a || 0) + ({ cum_load: first.load_kwh, cum_pv: first.pv_kwh, cum_gen: (first.dg_kwh || 0) + (first.fc_kwh || 0) + (first.gdg_kwh || 0), cum_grid_in: first.grid_in_kwh, cum_grid_out: first.grid_out_kwh }[c[0]] || 0) : null;
      return `<tr><td>${c[1]}</td><td class="n">${this.n(rows.length ? (b || 0) - u : null)}</td><td class="n">${this.n(b)}</td><td class="n"><b>${this.n(u)}</b></td></tr>`; }).join("")}</tbody></table>
      <p class="sub arc-note">TPCS 가 계측값을 적산한 지침이다. 요금 정산용 계량기와 대조할 때는 계량기 값을 기준으로 한다.</p></div></div></div>
    <div class="panel"><div class="hd"><h3>${this.UNITS.find(u => u[0] === this.unit)[1]} 기록 ${rows.length}줄</h3>${demo ? '<span class="pill warn">* 시연용 합성 자료 포함</span>' : ""}<div class="spacer"></div><span class="sub">줄을 누르면 그 구간으로 들어간다</span></div>
      <div class="bd np scroll arc-table"><table class="t"><thead><tr><th>구간</th>${this.COLS.map(c => `<th class="n">${c[1]}</th>`).join("")}<th class="n">최대 부하 kW</th><th class="n">충전율 %</th><th class="n">전압 A / B V</th><th class="n">주파수 Hz</th><th class="n">기온 ℃</th></tr></thead>
      <tbody>${rows.map((x, i) => `<tr data-i="${i}" class="arc-row"><td class="mono">${this.e(x.k)}${x.demo ? " *" : ""}</td>${this.COLS.map(c => `<td class="n">${this.n(x[c[0]])}</td>`).join("")}<td class="n">${this.n(x.load_max)}</td><td class="n">${this.n(x.soc)}</td><td class="n">${this.n(x.va, 0)} / ${this.n(x.vb, 0)}</td><td class="n">${this.n(x.hz, 2)}</td><td class="n">${this.n(x.temp)}</td></tr>`).join("") || `<tr><td colspan="15" class="muted">이 구간에는 기록이 없습니다</td></tr>`}</tbody></table></div></div>`;
    B.querySelectorAll(".arc-row").forEach(tr => tr.onclick = () => this.drill(rows[+tr.dataset.i])); this.chart(rows);
  },
  drill(x) {
    const down = { year: "month", month: "day", day: "hour" }[this.unit]; if (!down) return;
    this.at = (x.k + "-01-01").slice(0, 10); this.unit = down; this.load();
  },
  chart(rows) {
    const el = document.querySelector("#arcChart"); if (!el) return; const W = 1040, H = 250, L = 56, R = 10, T = 12, Bm = 34, n = Math.max(rows.length, 1);
    const gen = x => (x.dg_kwh || 0) + (x.fc_kwh || 0) + (x.gdg_kwh || 0), top = Math.max(1, ...rows.map(x => Math.max(x.load_kwh || 0, x.pv_kwh || 0, gen(x), x.grid_in_kwh || 0)));
    const step = (typeof niceStep === "function" ? niceStep(top / 4) : top / 4), ymax = Math.ceil(top / step) * step, y = v => T + (H - T - Bm) * (1 - v / ymax), bw = (W - L - R) / n, each = Math.max(1, Math.ceil(n / 16));
    let g = ""; for (let v = 0; v <= ymax + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="arc-gl"/><text x="${L - 6}" y="${y(v) + 4}" class="arc-ax" text-anchor="end">${this.n(v, 0)}</text>`;
    rows.forEach((x, i) => {
      const x0 = L + i * bw, w = Math.max(1, bw * 0.2); [["load", x.load_kwh], ["pv", x.pv_kwh], ["gen", gen(x)], ["grid", x.grid_in_kwh]].forEach((s, j) => { const v = s[1] || 0; if (v > 0) g += `<rect class="c-${s[0]}" x="${(x0 + bw * 0.1 + j * w).toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}"><title>${this.e(x.k)} · ${["부하", "태양광", "발전기", "수전"][j]} ${this.n(v)} kWh</title></rect>`; });
      if (i % each === 0) g += `<text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 12}" class="arc-ax" text-anchor="middle">${this.e(this.unit === "hour" ? x.k.slice(11, 13) + "시" : this.unit === "day" ? x.k.slice(8) + "일" : this.unit === "month" ? x.k.slice(5) + "월" : x.k)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="arc-svg">${g}</svg>`;
  },

  /* ── 장치별 자료: 발전원 · 저장 장치마다 신호별 평균 · 최소 · 최대 */
  async device() {
    const B = document.querySelector("#arcBody"), L = await this.get("/api/archive/devices"), devs = L.rows || []; if (!B) return;
    if (!devs.length) { B.innerHTML = `<div class="panel"><div class="bd muted">장치별 기록이 아직 없습니다. 저장 주기(${this.info.interval_min}분)가 한 번 지나면 생깁니다.</div></div>`; return; }
    if (!devs.some(d => d.dev === this.dev)) this.dev = devs[0].dev;
    const r = await this.get(`/api/archive/device?dev=${encodeURIComponent(this.dev)}&${this.qs()}`), sig = r.signals || [], rows = r.rows || []; document.querySelector("#arcTitle").textContent = r.title || "";
    if (!sig.some(s => s.tag === this.sig)) this.sig = (sig.find(s => s.unit === "kW") || sig[0] || {}).tag || "";
    const cur = devs.find(d => d.dev === this.dev), u = sig.find(s => s.tag === this.sig) || {};
    B.innerHTML = `<div class="panel"><div class="hd arc-devs">${devs.map(d => `<button class="btn sm ${d.dev === this.dev ? "pri" : ""}" data-d="${this.e(d.dev)}" title="${this.e(d.first)} ~ ${this.e(d.last)} · ${d.rows}줄">${this.e(d.name)}</button>`).join("")}</div></div>
    <div class="panel"><div class="hd"><h3>${this.e(cur.name)} — ${this.e(this.sig)} ${u.unit ? "(" + this.e(u.unit) + ")" : ""}</h3><select class="in" id="arcSig">${sig.map(s => `<option ${s.tag === this.sig ? "selected" : ""}>${this.e(s.tag)}</option>`).join("")}</select><div class="spacer"></div><span class="arc-leg"><i class="c-load"></i>평균 <i class="c-band"></i>최소 ~ 최대</span></div><div class="bd"><div id="arcChart"></div></div></div>
    <div class="panel"><div class="hd"><h3>${this.e(cur.name)} 기록 ${rows.length}줄</h3><div class="spacer"></div><span class="sub">칸마다 평균 (최소 ~ 최대) · 줄을 누르면 그 구간으로 들어간다</span></div>
      <div class="bd np scroll arc-table"><table class="t"><thead><tr><th>구간</th>${sig.map(s => `<th class="n">${this.e(s.tag.split(".").slice(1).join("."))}${s.unit ? " " + this.e(s.unit) : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((x, i) => `<tr data-i="${i}" class="arc-row"><td class="mono">${this.e(x.k)}</td>${sig.map(s => { const v = x.v[s.tag]; return `<td class="n">${v ? `${this.n(v[0], 2)} <span class="sub">(${this.n(v[1], 1)} ~ ${this.n(v[2], 1)})</span>` : "—"}</td>`; }).join("")}</tr>`).join("") || `<tr><td colspan="${sig.length + 1}" class="muted">이 구간에는 기록이 없습니다</td></tr>`}</tbody></table></div></div>`;
    B.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { this.dev = b.dataset.d; this.sig = ""; this.load(); }); B.querySelector("#arcSig").onchange = e => { this.sig = e.target.value; this.load(); };
    B.querySelectorAll(".arc-row").forEach(tr => tr.onclick = () => this.drill(rows[+tr.dataset.i])); this.band(rows.map(x => [x.k, x.v[this.sig]]));
  },
  band(pts) {                 /* 평균 선 + 최소~최대 띠 */
    const el = document.querySelector("#arcChart"), ok = pts.filter(p => p[1]); if (!el) return; if (!ok.length) { el.innerHTML = `<p class="muted">그릴 값이 없습니다</p>`; return; }
    const W = 1500, H = 240, L = 60, R = 12, T = 12, Bm = 30, lo = Math.min(...ok.map(p => p[1][1])), hi = Math.max(...ok.map(p => p[1][2])), pad = (hi - lo) * 0.08 || 1, y0 = lo - pad, y1 = hi + pad, n = pts.length;
    const x = i => L + (W - L - R) * (n > 1 ? i / (n - 1) : 0.5), y = v => T + (H - T - Bm) * (1 - (v - y0) / (y1 - y0)), idx = pts.map((p, i) => [i, p[1]]).filter(p => p[1]), each = Math.max(1, Math.ceil(n / 14));
    let g = ""; for (let k = 0; k <= 4; k++) { const v = y0 + (y1 - y0) * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="arc-gl"/><text x="${L - 6}" y="${y(v) + 4}" class="arc-ax" text-anchor="end">${this.n(v, Math.abs(y1 - y0) < 10 ? 2 : 0)}</text>`; }
    g += `<path class="c-band" d="M${idx.map(p => `${x(p[0]).toFixed(1)},${y(p[1][2]).toFixed(1)}`).join("L")}L${idx.slice().reverse().map(p => `${x(p[0]).toFixed(1)},${y(p[1][1]).toFixed(1)}`).join("L")}Z"/><path class="arc-line" d="M${idx.map(p => `${x(p[0]).toFixed(1)},${y(p[1][0]).toFixed(1)}`).join("L")}"/>`;
    pts.forEach((p, i) => { if (i % each === 0) g += `<text x="${x(i).toFixed(1)}" y="${H - 10}" class="arc-ax" text-anchor="middle">${this.e(p[0].length > 10 ? p[0].slice(11, 16) : p[0].slice(-5))}</text>`; });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="arc-svg">${g}</svg>`;
  },

  /* ── ESS 안전 운영정보(1분 기록) */
  async ess() {
    const B = document.querySelector("#arcBody"), r = await this.get(`/api/archive/ess?unit=${this.essRaw ? "raw" : this.unit}&at=${this.at}`), items = r.items || [], rows = r.rows || [], i = this.info; if (!B) return; document.querySelector("#arcTitle").textContent = r.title || "";
    if (!items.length) { B.innerHTML = `<div class="panel"><div class="bd warnc">ESS 안전 운영정보 항목 파일(config/ess_safety.csv)이 없어 기록하지 않습니다.</div></div>`; return; }
    if (!items.some(x => x.key === this.sig)) this.sig = "soc"; const one = this.essRaw, grp = [...new Set(items.map(x => x.group))];
    B.innerHTML = `<div class="arc-tiles four"><div class="arc-tile"><span>저장 주기</span><b>${(i.ess_step_s || 60) / 60}분</b><i></i><em>${(i.ess_step_s || 60) === 60 ? "통합관리시스템 전송 주기와 같음" : "통합관리시스템 전송 주기(1분)보다 김"}</em></div><div class="arc-tile"><span>기록률 (이 구간)</span><b>${r.rate == null ? "—" : this.n(r.rate, 2)}</b><i>%</i><em>${this.n(r.recorded, 0)} / ${this.n(r.expected, 0)}줄</em></div>
      <div class="arc-tile"><span>항목 (수집 / 전체)</span><b>${i.ess_mapped} / ${i.ess_items}</b><i></i><em>미수집 항목은 0 으로 기록</em></div><div class="arc-tile"><span>기록 범위</span><b style="font-size:14px">${this.e(i.ess_first || "—")}</b><i></i><em>~ ${this.e(i.ess_last || "—")}</em></div></div>
    <div class="panel"><div class="hd"><h3>${this.e((items.find(x => x.key === this.sig) || {}).label || "")}</h3><select class="in" id="arcSig">${items.filter(x => x.tag).map(x => `<option value="${x.key}" ${x.key === this.sig ? "selected" : ""}>${this.e(x.label)}</option>`).join("")}</select>
      <label class="arc-chk"><input type="checkbox" id="essRaw" ${one ? "checked" : ""}> 1분 원자료(하루치)</label><div class="spacer"></div><span class="sub">인터넷 전송 대신 현장에 보관 → '서버 전달'에서 주둔지 서버로 넘긴다</span></div><div class="bd"><div id="arcChart"></div></div></div>
    <div class="panel"><div class="hd"><h3>ESS 안전 운영정보 ${rows.length}줄</h3><div class="spacer"></div><span class="sub">${one ? "그 순간의 값" : "평균 (최소 ~ 최대)"} · <span class="arc-miss">회색</span> = 미수집(대응표에 신호 없음)</span></div>
      <div class="bd np scroll arc-table"><table class="t arc-ess"><thead><tr><th rowspan="2">구간</th>${grp.map(g => `<th colspan="${items.filter(x => x.group === g).length}" class="arc-grp">${this.e(g)}</th>`).join("")}</tr><tr>${items.map(x => `<th class="n ${x.tag ? "" : "arc-miss"}" title="${this.e(x.tag || "미수집")}">${this.e(x.label)}${x.unit ? "<br>" + this.e(x.unit) : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(-600).map(x => `<tr><td class="mono">${this.e(x.k)}</td>${items.map(it => { const v = x.v[it.key]; return `<td class="n ${it.tag ? "" : "arc-miss"}">${!it.tag ? "0" : one ? this.n(v[0], 2) : `${this.n(v[0], 2)} <span class="sub">(${this.n(v[1], 1)} ~ ${this.n(v[2], 1)})</span>`}</td>`; }).join("")}</tr>`).join("") || `<tr><td colspan="${items.length + 1}" class="muted">이 구간에는 기록이 없습니다</td></tr>`}</tbody></table></div></div>
    <p class="sub arc-note">항목은 공개된 분류(운영 환경 · 배터리 · PCS · 보호 이벤트)에 맞춘 초안이다. 공사의 정식 연계 명세를 받으면 <span class="mono">config/ess_safety.csv</span> 를 그 열 순서로 고치고, 배터리 관리 장치(BMS) · PCS 신호를 대응표에 넣어 tag 에 적는다.</p>`;
    B.querySelector("#arcSig").onchange = e => { this.sig = e.target.value; this.load(); }; B.querySelector("#essRaw").onchange = e => { this.essRaw = e.target.checked; this.load(); }; this.band(rows.map(x => [x.k, x.v[this.sig]]));
  },

  /* ── 주둔지 서버 전달: 묶음 만들기 · 보내기 · 이력 */
  async xfer() {
    const B = document.querySelector("#arcBody"), r = await this.get("/api/archive/xfer"), ok = this.role("operator"), rows = r.rows || []; if (!B) return; document.querySelector("#arcTitle").textContent = "";
    const pill = s => `<span class="pill ${s === "전달 완료" ? "ok" : s === "전송 실패" ? "bad" : "warn"}">${this.e(s)}</span>`;
    B.innerHTML = `<div class="arc-tiles four"><div class="arc-tile"><span>전달을 마친 구간의 끝</span><b style="font-size:16px">${this.e(r.covered_to || "아직 없음")}</b><i></i><em>기록의 끝 ${this.e(r.data_to || "—")}</em></div><div class="arc-tile"><span>아직 넘기지 않은 기간</span><b class="${r.wait_days > 31 ? "warnc" : ""}">${this.n(r.wait_days, 1)}</b><i>일</i><em>묶음 하나는 ${r.max_span_days}일까지</em></div>
      <div class="arc-tile"><span>전달 완료가 아닌 묶음</span><b class="${r.pending ? "warnc" : ""}">${r.pending}</b><i>건</i><em></em></div><div class="arc-tile"><span>주둔지 서버</span><b style="font-size:13px">${this.e(r.server_url || "주소 없음 — 보조 기억 매체로 전달")}</b><i></i><em>설정: archive.server_url</em></div></div>
    <div class="panel"><div class="hd"><h3>전달 묶음 만들기</h3><input class="in" type="date" id="xfFrom"><span>~</span><input class="in" type="date" id="xfTo"><button class="btn" id="xfMake" ${ok ? "" : "disabled"}>이 기간으로 만들기</button><button class="btn pri" id="xfNext" ${ok ? "" : "disabled"} title="마지막으로 넘긴 구간의 끝부터 지금까지">다음 구간 만들기</button><div class="spacer"></div>
      <span class="sub">${r.read_only ? "기록 조회기에서는 이력만 본다" : ok ? "ESS 안전 운영정보(1분) · 검침 · 상황 · 점검 · 장치별 자료를 한 묶음(zip)으로" : "운용자 로그인이 필요하다"}</span></div>
      <div class="bd np scroll arc-table tall"><table class="t"><thead><tr><th>번호</th><th>구간</th><th class="n">줄 수</th><th class="n">크기</th><th>상태</th><th>방법 · 대상</th><th>전달 시각</th><th>담당</th><th>비고</th><th>SHA-256</th><th></th></tr></thead>
      <tbody>${rows.map(x => `<tr><td>${x.id}</td><td class="mono">${this.e(x.from_t)} ~ ${this.e(x.to_t)}</td><td class="n">${this.n(x.rows, 0)}</td><td class="n">${this.n(x.bytes / 1024, 0)} KB</td><td>${pill(x.status)}</td><td>${this.e(x.method || "")} ${this.e(x.target || "")}</td><td class="mono">${this.e(x.sent_t)}</td><td>${this.e(x.who || "")}</td><td>${this.e(x.note || "")}</td><td class="mono" title="${this.e(x.sha256)}">${this.e((x.sha256 || "").slice(0, 12))}…</td>
        <td class="arc-act">${ok && x.exists ? `<button class="btn sm" data-a="get" data-i="${x.id}" data-f="${this.e(x.file)}">내려받기</button>` : ""}${ok && x.status !== "전달 완료" ? `${r.server_url ? `<button class="btn sm pri" data-a="send" data-i="${x.id}">서버로 보내기</button>` : ""}<button class="btn sm" data-a="mark" data-i="${x.id}">전달 완료 적기</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="11" class="muted">아직 만든 묶음이 없습니다</td></tr>`}</tbody></table></div></div>
    <p class="sub arc-note">묶음 파일은 <span class="mono">${this.e(r.outbox || "")}</span> 에 생긴다. 주둔지 서버가 같은 망에 있으면 [서버로 보내기](서버가 돌려준 SHA-256 이 같아야 완료), 아니면 보조 기억 매체로 옮긴 뒤 [전달 완료 적기]. 받는 쪽 참조 프로그램: <span class="mono">python -m ifps_ems_rt.archrecv &lt;폴더&gt;</span></p>`;
    const post = async (path, body) => { const j = await api(path, body); this.say(j.ok ? "처리했습니다" : (j.why || "실패했습니다"), j.ok ? "ok" : "bad"); this.load(); };
    if (!ok) return; B.querySelector("#xfNext").onclick = () => post("/api/archive/xfer/make", {});
    B.querySelector("#xfMake").onclick = () => { const a = B.querySelector("#xfFrom").value, b = B.querySelector("#xfTo").value; if (!a || !b) return this.say("기간의 처음과 끝을 고르십시오", "bad"); post("/api/archive/xfer/make", { from: a, to: b }); };
    B.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      const id = +b.dataset.i; if (b.dataset.a === "send") return post("/api/archive/xfer/send", { id });
      if (b.dataset.a === "mark") { const note = prompt("전달 방법 · 받은 곳을 적으십시오 (예: 보안 USB → 주둔지 서버 담당 홍길동)", ""); if (note === null) return; return post("/api/archive/xfer/mark", { id, note }); }
      const h = {}; if (typeof S !== "undefined" && S.token) h["X-TPCS-Token"] = S.token; const f = await fetch(`/api/archive/bundle?id=${id}`, { headers: h }); if (!f.ok) return this.say("내려받지 못했습니다", "bad");
      const a = document.createElement("a"); a.href = URL.createObjectURL(await f.blob()); a.download = b.dataset.f; document.body.appendChild(a); a.click(); a.remove();
    });
  },

  /* ── 수집 항목 관리(엔지니어): ESS 안전 항목 · 장치별 수집 신호 · 주기 · 보관 */
  async collect() {
    const B = document.querySelector("#arcBody"); document.querySelector("#arcTitle").textContent = "";
    if (this.standalone || !this.role("engineer")) { B.innerHTML = `<div class="panel"><div class="bd"><p>수집 항목과 주기는 관리자(엔지니어 권한)가 TPCS 화면에서 고칩니다.</p>${this.standalone ? "" : '<button class="btn pri" id="colLogin">로그인</button>'}</div></div>`; const b = B.querySelector("#colLogin"); if (b) b.onclick = () => loginDialog(); return; }
    const r = await this.get("/api/archive/collect"); if (!r.ok) { B.innerHTML = `<div class="panel"><div class="bd warnc">${this.e(r.why || "불러오지 못했습니다")}</div></div>`; return; }
    const c = r.cfg, tags = r.signals.map(x => x.tag), devs = [...new Set(r.signals.map(x => x.dev))]; let items = r.items.map(x => ({ ...x }));
    const opt = (list, cur, f) => list.map(v => `<option value="${v}" ${v === cur ? "selected" : ""}>${f(v)}</option>`).join("");
    const paintItems = () => {
      B.querySelector("#colItems").innerHTML = items.map((it, i) => `<tr data-i="${i}"><td class="n">${i + 1}</td><td><input class="in sm" data-k="key" value="${this.e(it.key)}" style="width:110px"></td><td><input class="in sm" data-k="group" value="${this.e(it.group)}" style="width:100px" list="colGroups"></td><td><input class="in sm" data-k="label" value="${this.e(it.label)}" style="width:190px"></td>
        <td><input class="in sm" data-k="unit" value="${this.e(it.unit)}" style="width:60px"></td><td><select class="in sm" data-k="tag"><option value="">(미수집 — 0 으로 기록)</option>${opt(tags, it.tag, v => v)}</select></td>
        <td class="arc-act"><button class="btn sm" data-m="up" title="위로">▲</button><button class="btn sm" data-m="down" title="아래로">▼</button><button class="btn sm stop" data-m="del">삭제</button></td></tr>`).join("") || `<tr><td colspan="7" class="muted">항목이 없습니다 — ESS 안전 운영정보를 기록하지 않습니다</td></tr>`;
      B.querySelector("#colCount").textContent = `${items.length}개 (연결 ${items.filter(x => x.tag).length}개)`;
      B.querySelectorAll("#colItems [data-k]").forEach(el => el.onchange = () => { items[+el.closest("tr").dataset.i][el.dataset.k] = el.value.trim(); if (el.dataset.k === "tag") paintItems(); });
      B.querySelectorAll("#colItems [data-m]").forEach(el => el.onclick = () => { const i = +el.closest("tr").dataset.i, m = el.dataset.m; if (m === "del") items.splice(i, 1); else { const j = m === "up" ? i - 1 : i + 1; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; } paintItems(); });
    };
    B.innerHTML = `<div class="panel"><div class="hd"><h3>주기 · 보관</h3><div class="spacer"></div><span class="sub">저장하면 이전 판을 config/backup 에 남기고 바로 적용한다(재기동 불필요)</span><button class="btn pri" id="colSave">저장 · 적용</button></div>
      <div class="bd arc-form"><label>검침 · 운전 실적 <select class="in" id="cInt">${opt(r.choices.interval_min, c.interval_min, v => v + "분")}</select></label><label>장치별 자료 <select class="in" id="cDev">${opt(r.choices.dev_interval_min, c.dev_interval_min, v => v + "분")}</select></label>
        <label>ESS 안전 운영정보 <select class="in" id="cEss">${opt(r.choices.ess_interval_s, c.ess_interval_s, v => v / 60 + "분")}</select></label><label>보관 기간 <select class="in" id="cYears">${opt(r.choices.retain_years, c.retain_years, v => v + "년")}</select></label>
        <label>용량 한도 <input class="in" id="cMb" type="number" min="16" max="8192" value="${c.max_mb}" style="width:90px"> MB</label><span class="sub" id="colWarn"></span></div></div>
      <div class="panel"><div class="hd"><h3>ESS 안전 운영정보 항목 <span class="sub" id="colCount"></span></h3><div class="spacer"></div><span class="sub">연결 신호를 고르면 그 값을, 비우면 0 을 기록한다(미수집 표시). 공사 연계 명세의 열 순서대로 맞춘다</span><button class="btn" id="colAdd">항목 추가</button></div>
        <div class="bd np scroll arc-table"><table class="t"><thead><tr><th class="n">순서</th><th>이름표(key)</th><th>분류</th><th>항목 이름</th><th>단위</th><th>연결 신호(대응표)</th><th></th></tr></thead><tbody id="colItems"></tbody></table><datalist id="colGroups">${[...new Set(items.map(x => x.group))].map(g => `<option>${this.e(g)}</option>`).join("")}</datalist></div></div>
      <div class="panel"><div class="hd"><h3>장치별 수집 신호</h3><div class="spacer"></div><span class="sub">표시를 끄면 그 신호는 장치별 자료에 쌓지 않는다. 새 신호를 넣거나 주소를 바꾸는 일은 디버그 화면의 설정 편집(대응표)에서 한다</span></div>
        <div class="bd col-sig">${devs.map(d => `<div class="col-dev"><b>${this.e(r.signals.find(x => x.dev === d).name)} <span class="sub">${this.e(d)}</span></b>${r.signals.filter(x => x.dev === d).map(x => `<label class="arc-chk"><input type="checkbox" data-sig="${this.e(x.tag)}" ${x.on ? "checked" : ""}> ${this.e(x.tag.split(".").slice(1).join("."))}${x.unit ? " <span class='sub'>" + this.e(x.unit) + "</span>" : ""}</label>`).join("")}</div>`).join("")}</div></div>`;
    const warn = () => { const y = +B.querySelector("#cYears").value, e = +B.querySelector("#cEss").value; B.querySelector("#colWarn").innerHTML = (y < r.legal_years ? `<span class="pill warn">보관 ${y}년 — 점검 기록 보존 기간 ${r.legal_years}년보다 짧음</span> ` : "") + (e > 60 ? `<span class="pill warn">ESS ${e / 60}분 — 통합관리시스템 전송 주기(1분)보다 김</span>` : ""); };
    ["#cYears", "#cEss"].forEach(id => B.querySelector(id).onchange = warn); warn(); paintItems();
    B.querySelector("#colAdd").onclick = () => { if (items.length >= r.max_items) return this.say(`항목은 ${r.max_items}개까지입니다`, "bad"); let n = items.length + 1; while (items.some(x => x.key === "item_" + n)) n++; items.push({ key: "item_" + n, group: (items[items.length - 1] || {}).group || "배터리", label: "새 항목", unit: "", tag: "" }); paintItems(); };
    B.querySelector("#colSave").onclick = async () => {
      const body = { cfg: { interval_min: +B.querySelector("#cInt").value, dev_interval_min: +B.querySelector("#cDev").value, ess_interval_s: +B.querySelector("#cEss").value, retain_years: +B.querySelector("#cYears").value, max_mb: +B.querySelector("#cMb").value },
        items, dev_exclude: [...B.querySelectorAll("[data-sig]")].filter(x => !x.checked).map(x => x.dataset.sig) };
      const j = await api("/api/archive/collect", body);
      if (j.ok) { this.say(j.changed.length ? "저장하고 적용했습니다: " + j.changed.join(" · ") : "바뀐 내용이 없습니다", "ok"); this.load(); } else this.say((j.errors || [j.why || "저장하지 못했습니다"]).slice(0, 3).join(" / "), "bad");
    };
  },

  /* ── 상황 기록 */
  async events() {
    const B = document.querySelector("#arcBody");
    B.innerHTML = `<div class="panel"><div class="hd"><input class="in" id="arcQ" placeholder="찾을 글자 (예: 디젤, 트립, 통신)" value="${this.e(this.q)}" style="width:280px">
      <select class="in" id="arcKind"><option value="">모든 종류</option>${["경보", "지령", "운용", "운전", "통신", "보안", "설정", "예측", "오류", "기동"].map(k => `<option ${this.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>
      <button class="btn" id="arcFind">찾기</button><div class="spacer"></div><span class="sub" id="arcEvN"></span></div>
      <div class="bd np scroll arc-table tall"><table class="t"><thead><tr><th>시각</th><th>종류</th><th>등급</th><th>대상</th><th>내용</th><th>행위자</th></tr></thead><tbody id="arcEv"></tbody></table></div></div>`;
    const run = async () => {
      this.q = document.querySelector("#arcQ").value.trim(); this.kind = document.querySelector("#arcKind").value;
      const r = await this.get(`/api/archive/events?${this.qs()}&q=${encodeURIComponent(this.q)}&kind=${encodeURIComponent(this.kind)}&limit=2000`); if (!document.querySelector("#arcEv")) return;
      document.querySelector("#arcTitle").textContent = r.title || ""; const rows = r.rows || []; document.querySelector("#arcEvN").textContent = `${rows.length}건` + (rows.length >= 2000 ? " (2000건까지만 표시 — 기간을 좁히십시오)" : "");
      document.querySelector("#arcEv").innerHTML = rows.map(x => `<tr><td class="mono">${this.e(x.t)}</td><td><span class="pill ${/발생|격상/.test(x.kind) ? "bad" : /복귀/.test(x.kind) ? "ok" : "info"}">${this.e(x.kind)}</span></td><td>${x.prio ?? ""}</td><td>${this.e(x.src)}</td><td>${this.e(x.text)}</td><td>${this.e(x.actor)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">찾는 기록이 없습니다</td></tr>`;
    };
    document.querySelector("#arcFind").onclick = run; document.querySelector("#arcQ").onkeydown = e => { if (e.key === "Enter") run(); }; document.querySelector("#arcKind").onchange = run; run();
  },

  /* ── 점검 기록(사람이 잰 값) */
  async inspect() {
    const B = document.querySelector("#arcBody"), ok = this.role("operator"), now = new Date(), stamp = `${this.today()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    B.innerHTML = `<div class="panel"><div class="hd"><h3>점검 기록 넣기</h3><span class="sub">절연저항 · 접지저항 · 누설전류처럼 TPCS 가 재지 못하는 항목을 점검자가 적는다${ok ? "" : " — 운용자 로그인이 필요하다"}</span></div>
      <div class="bd arc-form"><input class="in" id="insAt" value="${stamp}" title="점검 일시 (YYYY-MM-DD HH:MM)" style="width:150px"><input class="in" id="insItem" placeholder="항목 (예: 접지저항)" list="insItems" style="width:200px"><datalist id="insItems"><option>절연저항</option><option>접지저항</option><option>누설전류</option><option>외관 점검</option><option>차단기 동작 시험</option><option>계량기 지침 대조</option></datalist>
      <input class="in" id="insVal" placeholder="값" style="width:100px"><input class="in" id="insUnit" placeholder="단위" style="width:70px"><input class="in" id="insNote" placeholder="의견" style="width:360px"><button class="btn pri" id="insAdd" ${ok ? "" : "disabled"}>기록</button></div></div>
      <div class="panel"><div class="hd"><h3>점검 기록 — <span id="insTitle"></span></h3><div class="spacer"></div><span class="sub">보존 기간 ${this.info.legal_years}년(전기안전관리법 시행규칙) · 지금 설정 ${this.info.retain_years}년</span></div>
      <div class="bd np scroll arc-table"><table class="t"><thead><tr><th>일시</th><th>항목</th><th class="n">값</th><th>단위</th><th>의견</th><th>점검자</th></tr></thead><tbody id="insRows"></tbody></table></div></div>`;
    const show = async () => {
      const r = await this.get(`/api/archive/inspect?unit=${this.unit === "year" ? "year" : "month"}&at=${this.at}`); if (!document.querySelector("#insRows")) return;
      document.querySelector("#insTitle").textContent = r.title || ""; document.querySelector("#arcTitle").textContent = r.title || "";
      document.querySelector("#insRows").innerHTML = (r.rows || []).map(x => `<tr><td class="mono">${this.e(x.t)}</td><td>${this.e(x.item)}</td><td class="n">${this.e(x.value)}</td><td>${this.e(x.unit)}</td><td>${this.e(x.note)}</td><td>${this.e(x.who)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">이 구간에는 점검 기록이 없습니다</td></tr>`;
    };
    document.querySelector("#insAdd").onclick = async () => {
      const v = id => document.querySelector(id).value.trim(), r = await api("/api/archive/inspect", { at: v("#insAt"), item: v("#insItem"), value: v("#insVal"), unit: v("#insUnit"), note: v("#insNote") });
      if (r.ok) { this.say("점검 기록을 넣었습니다", "ok"); show(); } else this.say(r.why || "넣지 못했습니다", "bad");
    }; show();
  },

  /* ── 보관 상태 */
  store() {
    const i = this.info, B = document.querySelector("#arcBody"), pct = Math.min(100, 100 * i.size_mb / i.max_mb), full = Math.min(100, 100 * i.rows / Math.max(1, i.rows_at_full)); document.querySelector("#arcTitle").textContent = "";
    const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    B.innerHTML = `<div class="arc-grid"><div class="panel"><div class="hd"><h3>자료 보관 상태</h3></div><div class="bd np"><table class="t"><tbody>
      ${row("저장 주기", `<b>${i.interval_min}분</b> <span class="sub">(1 · 5 · 15 · 30 · 60분 중 선택)</span>`)}${row("보관 기간", `<b>${i.retain_years}년</b> <span class="sub">(1~5년)</span>` + (i.retain_years < i.legal_years ? ` <span class="pill warn">점검 기록 보존 기간 ${i.legal_years}년보다 짧음</span>` : ""))}
      ${row("기록 범위", `${this.e(i.first || "—")} ~ ${this.e(i.last || "—")}`)}${row("장치별 자료 / ESS 안전 운영정보", `${this.n(i.dev_rows, 0)}줄(${i.dev_step_min || i.interval_min}분) / ${this.n(i.ess_rows, 0)}줄(${(i.ess_step_s || 60) / 60}분)`)}${row("검침 기록", `${this.n(i.rows, 0)}줄 <span class="sub">(보관 기간을 다 채우면 약 ${this.n(i.rows_at_full, 0)}줄)</span><div class="arc-meter"><i style="width:${full.toFixed(1)}%"></i></div>`)}
      ${row("상황 기록 / 점검 기록", `${this.n(i.events, 0)}건 / ${this.n(i.inspects, 0)}건`)}${row("보관소 크기", `${this.n(i.size_mb)} MB / 한도 ${this.n(i.max_mb, 0)} MB<div class="arc-meter"><i style="width:${pct.toFixed(1)}%"></i></div>`)}
      ${row("시연용 합성 자료", i.demo_rows ? `${this.n(i.demo_rows, 0)}줄 <span class="pill warn">가상 장치 모드의 첫 기동 때 넣은 과거 자료</span>` : "없음")}${i.err ? row("저장 오류", `<span class="badc">${this.e(i.err)}</span>`) : ""}${row("열기 방식", i.read_only ? "읽기 전용(기록 조회기)" : "TPCS 가 쓰는 중")}</tbody></table></div></div>
      <div class="panel"><div class="hd"><h3>보관 규칙</h3></div><div class="bd arc-rules"><p>· 저장 주기마다 한 줄씩 적는다: 구간 전력량, 구간 최대, 평균 상태, <b>검침 누적값</b>.</p><p>· 보관 기간이 지난 기록은 자동으로 지운다. 파일이 한도를 넘으면 가장 오래된 달부터 지우고 빈 공간을 돌려받는다.</p>
      <p>· 점검 결과 기록의 보존 기간은 <b>4년</b>이다(전기안전관리법 시행규칙). 그래서 기본 보관 기간을 4년으로 했다.</p><p>· 검침 · 장치별 자료의 저장 주기를 직접 정한 조항은 확인하지 못했다. 전력 검침 관행인 <b>15분</b>을 기본으로 했고, 현장 지침이 있으면 그에 맞춰 바꾼다.</p><p>· ESS 안전 운영정보는 전기안전공사 통합관리시스템의 전송 주기인 <b>1분</b>으로 쌓는다. 인터넷으로 보내지 못하므로 보관하고 주둔지 서버로 넘긴다.</p>
      <p>· 바꾸는 곳: 이 화면의 <b>수집 항목</b> 탭(엔지니어 권한) — 주기 · 보관 기간 · ESS 항목 · 장치별 수집 신호를 고치면 바로 적용된다.</p><p>· 별도 조회: <span class="mono">python -m ifps_ems_rt.archview state/archive.db</span> — TPCS 를 켜지 않고 보관소 파일만 읽는다.</p></div></div></div>`;
  },

  async report() { const days = document.querySelector("#arcDays").value; return this.fetchFile(`/api/report.docx?days=${days}`, "EMS_report.docx", "보고서"); },
  /* 서버가 만든 문서를 내려받는다(운용자 로그인). 파일 이름은 서버가 준 것을 쓴다 */
  async fetchFile(url, fallback, what) {
    if (!this.standalone && !this.role("operator")) { this.say(`${what} 출력은 운용자 로그인이 필요합니다`, "bad"); if (typeof loginDialog === "function") loginDialog(); return; }
    const h = {}; if (typeof S !== "undefined" && S.token) h["X-TPCS-Token"] = S.token; this.say(`${what}를 만드는 중…`);
    const r = await fetch(url, { headers: h }); if (!r.ok) { let w = ""; try { w = (await r.json()).why; } catch (e) { } return this.say(w || `${what}를 만들지 못했습니다`, "bad"); }
    const m = /filename\*=UTF-8''([^;]+)/.exec(r.headers.get("Content-Disposition") || ""), a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = m ? decodeURIComponent(m[1]) : fallback;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); this.say(`${what}를 내려받았습니다`, "ok");
  },
};
const P_ARCHIVE = { mount(m) { ARC.mount(m); }, update() { } };
