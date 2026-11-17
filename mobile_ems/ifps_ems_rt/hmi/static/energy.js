/* 발전·예측 화면: 금일 에너지, 24h 예측(실측 + 예측 + 80% 구간), 예측 정밀도, 일별 발전·부하, 장비 현황 */
"use strict";
function canvasCtx(c, H) {
  const dpr = DPR(), W = c.clientWidth; if (H === "fill") H = Math.max(80, c.parentElement.clientHeight); c.style.height = H + "px";
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = "11px " + getComputedStyle(document.body).getPropertyValue("--sans"); return [g, W];
}
function smoothPath(g, pts) { if (!pts.length) return; g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2; g.bezierCurveTo(mx, y0, mx, y1, x1, y1); } }
function axesY(g, L, R, T, ph, max, unit, W) {
  const st = niceStep(max / 5); max = Math.ceil(max / st) * st || 1; g.textAlign = "right"; g.fillStyle = TV("--muted");
  for (let v = 0; v <= max + 1e-9; v += st) { const y = T + ph - v / max * ph; g.strokeStyle = TA("--edge", .12); g.beginPath(); g.moveTo(L, Math.round(y) + .5); g.lineTo(W - R, Math.round(y) + .5); g.stroke(); g.fillText(fmtAxis(v) + (v === max ? " " + unit : ""), L - 6, y + 4); }
  return max;
}

/* 과거 24h 실측 + 향후 24h 예측(구간) */
function drawForecast(c, d, key, color, H = 250) { if (H === "fill") H = Math.max(80, c.parentElement.clientHeight);
  const [g, W] = canvasCtx(c, H), L = 58, R = 16, T = 14, B = 26, pw = W - L - R, ph = H - T - B, N = 192;
  const act = d[key + "_act"], p = d[key], lo = d[key + "_lo"], hi = d[key + "_hi"];
  const max = axesY(g, L, R, T, ph, Math.max(10, ...act, ...hi) * 1.08, "kW", W);
  const X = i => L + i / (N - 1) * pw, Y = v => T + ph - v / max * ph;
  g.fillStyle = TA("--edge", .05); g.fillRect(X(96), T, pw - (X(96) - L), ph);
  // 예측 구간
  g.beginPath(); for (let i = 0; i < 96; i++) g.lineTo(X(96 + i), Y(hi[i])); for (let i = 95; i >= 0; i--) g.lineTo(X(96 + i), Y(lo[i])); g.closePath(); g.fillStyle = color + "33"; g.fill();
  // 실측
  const pa = act.map((v, i) => [X(i), Y(v)]); g.beginPath(); smoothPath(g, pa); g.lineTo(X(95), Y(0)); g.lineTo(X(0), Y(0)); g.closePath();
  const gr = g.createLinearGradient(0, T, 0, T + ph); gr.addColorStop(0, color + "77"); gr.addColorStop(1, color + "05"); g.fillStyle = gr; g.fill();
  g.beginPath(); smoothPath(g, pa); g.strokeStyle = color; g.lineWidth = 2.2; g.stroke();
  // 예측 중앙
  g.beginPath(); smoothPath(g, [[X(95), Y(act[95])]].concat(p.map((v, i) => [X(96 + i), Y(v)]))); g.setLineDash([6, 5]); g.strokeStyle = TV("--text"); g.lineWidth = 1.8; g.stroke(); g.setLineDash([]);
  // 현재선
  g.strokeStyle = TV("--accent"); g.beginPath(); g.moveTo(X(95.5), T); g.lineTo(X(95.5), T + ph); g.stroke(); g.fillStyle = TV("--accent"); g.textAlign = "center"; g.fillText("발행 시점", X(95.5), T + 10);
  g.fillStyle = TV("--muted"); for (let i = 0; i <= N; i += 24) { const k = i < 96 ? d.hist_ts[i] : null; g.fillText(i === 96 ? "0h" : i < 96 ? (k || "").slice(11, 16) : `+${(i - 96) / 4}h`, X(Math.min(i, N - 1)), H - 7); }
}

function drawDaily(c, rows, H = 250) { if (H === "fill") H = Math.max(80, c.parentElement.clientHeight);
  const [g, W] = canvasCtx(c, H), L = 58, R = 16, T = 14, B = 26, pw = W - L - R, ph = H - T - B;
  const max = axesY(g, L, R, T, ph, Math.max(10, ...rows.map(r => Math.max(r.load, r.clear))) * 1.1, "kWh", W);
  const bw = pw / rows.length, Y = v => T + ph - v / max * ph;
  rows.forEach((r, i) => {
    const x = L + i * bw, w = bw * 0.32;
    [[r.load, TV("--load"), x + bw / 2 - w - 2], [r.pv, TV("--pv"), x + bw / 2 + 2]].forEach(([v, col, gx]) => { const gr = g.createLinearGradient(0, Y(v), 0, T + ph); gr.addColorStop(0, col); gr.addColorStop(1, col + "30"); g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(gx, Y(v), w, T + ph - Y(v), [4, 4, 0, 0]) : g.rect(gx, Y(v), w, T + ph - Y(v)); g.fill(); });
    if (bw >= 44 || i % 2 === 0) { g.fillStyle = TV("--muted"); g.textAlign = "center"; g.fillText(r.d.slice(5), x + bw / 2, H - 7); }
  });
  g.beginPath(); smoothPath(g, rows.map((r, i) => [L + i * bw + bw / 2, Y(r.clear)])); g.strokeStyle = TV("--pv") + "99"; g.setLineDash([4, 4]); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
}

function drawHourly(c, hrs, H = 230) { if (H === "fill") H = Math.max(80, c.parentElement.clientHeight);
  const [g, W] = canvasCtx(c, H), L = 52, R = 16, T = 14, B = 26, pw = W - L - R, ph = H - T - B, cols = [TV("--pv"), TV("--dg"), TV("--fc"), TV("--ess")];
  const tot = hrs.map(h => h[0] + h[1] + h[2] + h[3]); const max = axesY(g, L, R, T, ph, Math.max(1, ...tot, ...hrs.map(h => h[4])) * 1.15, "kWh", W);
  const bw = pw / 24, Y = v => T + ph - v / max * ph, nowH = new Date().getHours();
  hrs.forEach((h, i) => { let acc = 0; for (let k = 0; k < 4; k++) { if (h[k] <= 0) continue; g.fillStyle = cols[k]; g.fillRect(L + i * bw + bw * .18, Y(acc + h[k]), bw * .64, Y(acc) - Y(acc + h[k])); acc += h[k]; } if (i % 3 === 0) { g.fillStyle = i === nowH ? TV("--accent") : TV("--muted"); g.textAlign = "center"; g.fillText(String(i).padStart(2, "0"), L + i * bw + bw / 2, H - 7); } });
  g.beginPath(); smoothPath(g, hrs.map((h, i) => [L + i * bw + bw / 2, Y(h[4])]).filter((_, i) => i <= nowH)); g.strokeStyle = TV("--load"); g.lineWidth = 2; g.stroke();
}

function drawScatter(c, pts, H = 230) { if (H === "fill") H = Math.max(80, c.parentElement.clientHeight);
  const [g, W] = canvasCtx(c, H), L = 52, R = 16, T = 14, B = 26, ph = H - T - B, pw = Math.min(W - L - R, ph * 1.6);
  const all = pts.flat(), mn = Math.floor(Math.min(...all) / 10) * 10, mx = Math.ceil(Math.max(...all) / 10) * 10;
  const X = v => L + (v - mn) / (mx - mn) * pw, Y = v => T + ph - (v - mn) / (mx - mn) * ph;
  g.strokeStyle = "rgba(96,140,240,.15)"; g.strokeRect(L, T, pw, ph); g.fillStyle = TV("--muted"); g.textAlign = "right";
  for (let v = mn; v <= mx; v += (mx - mn) / 4) { g.fillText(v.toFixed(0), L - 6, Y(v) + 4); g.textAlign = "center"; g.fillText(v.toFixed(0), X(v), H - 7); g.textAlign = "right"; }
  g.strokeStyle = TA("--acc", .55); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(mn), Y(mn)); g.lineTo(X(mx), Y(mx)); g.stroke(); g.setLineDash([]);
  pts.forEach(([p, a]) => { g.fillStyle = TV("--load") + "99"; g.beginPath(); g.arc(X(a), Y(p), 2.6, 0, 7); g.fill(); });
  g.textAlign = "left"; g.fillStyle = "#aab8dc"; g.fillText("가로: 실측 kW · 세로: 예측 kW", L + 10, T + 14); g.fillText("점선 = 완전 일치", L + 10, T + 30);
}

function donut(parts, size = 150) {
  const tot = parts.reduce((a, p) => a + p[1], 0); const r = size / 2 - 14, c = 2 * Math.PI * r; let off = 0;
  const segs = tot > 0 ? parts.map(([n, v, col]) => { const len = v / tot * c; const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return s; }).join("") : "";
  return `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(30,52,120,.9)" stroke-width="18"/>${segs}</svg>`;
}

const P_EN = {
  fc: null, hrs: null,
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>${t("nav.energy", "발전·예측")}</h2><span class="sub" id="enSub">금일 전력량 적산 · 24시간 예측 · 예측 정밀도(최근 7일 백테스트)</span><div class="spacer"></div><button class="btn eng" id="enAi">AI 학습 상태</button><button class="btn" id="enRe">예측 다시 계산</button></div>
    <div class="pg" style="grid-template-rows:104px 1fr 1fr">
    <div class="en-tiles" id="enTiles"></div>
    <div class="pg" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="panel"><div class="hd"><h3>부하 예측 · 24시간</h3><div class="spacer"></div><div class="legend"><span><i style="background:var(--load)"></i>실측</span><span><i style="background:#fff"></i>예측(중앙)</span><span><i style="background:color-mix(in srgb, var(--load) 33%, transparent)"></i>80% 예측 구간</span></div></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="fcL"></canvas></div></div></div>
      <div class="panel"><div class="hd"><h3>PV 발전 예측 · 24시간</h3><div class="spacer"></div><div class="legend"><span><i style="background:var(--pv)"></i>실측</span><span><i style="background:#fff"></i>예측(중앙)</span><span><i style="background:color-mix(in srgb, var(--pv) 33%, transparent)"></i>80% 예측 구간</span></div></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="fcP"></canvas></div><div class="pvai" id="pvAi"></div></div></div>
      <div class="panel"><div class="hd"><h3>예측 정밀도</h3><div class="spacer"></div><span class="sub" id="accSub"></span></div><div class="bd"><div class="accbig" id="accBig"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:10px"><div><div class="lab" style="margin-bottom:6px">선행시간별 오차 — 부하 (기준선 15%)</div><div id="accL"></div></div><div><div class="lab" style="margin-bottom:6px">선행시간별 오차 — PV (설비용량 대비)</div><div id="accP"></div></div></div></div></div>
    </div><div class="pg" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="panel"><div class="hd"><h3>예측 vs 실측 (부하)</h3><div class="spacer"></div><span class="sub">최근 7일, 6시간 간격 발행</span></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="scat"></canvas></div></div></div>
      <div class="panel"><div class="hd"><h3>금일 시간대별 발전량</h3><div class="spacer"></div><div class="legend"><span><i style="background:var(--pv)"></i>PV</span><span><i style="background:var(--dg)"></i>DG</span><span><i style="background:var(--fc)"></i>FC</span><span><i style="background:var(--ess)"></i>ESS 방전</span><span><i style="background:var(--load)"></i>부하</span></div></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="hrC"></canvas></div></div></div>
      <div class="panel"><div class="hd"><h3>일별 발전·부하 (최근 14일)</h3><div class="spacer"></div><div class="legend"><span><i style="background:var(--load)"></i>부하 kWh</span><span><i style="background:var(--pv)"></i>PV kWh</span><span><i style="background:color-mix(in srgb, var(--pv) 60%, transparent)"></i>청천 PV 가능량</span></div></div><div class="bd" style="display:flex;flex-direction:column"><div class="cv"><canvas id="dayC"></canvas></div></div></div>
    </div></div>`;
    $("#enAi").onclick = () => this.aiDialog();
    $("#enRe").onclick = async () => { if (!can("operator")) { toast("운용자 권한 필요", "bad"); return loginDialog(); } const r = await api("/api/forecast?force=1"); if (r.ok === false && !r.why) return; toast("예측 재계산 요청", "ok"); setTimeout(() => this.load(), 2500); };
    clearTimeout(this._retry); this._retry = null;
    this.load(); clearInterval(this._t); this._t = setInterval(() => { if (S.page === "energy") this.load(); }, 10000);
    this._ro = new ResizeObserver(() => this.draw()); this._ro.observe($("#fcL"));
  },
  async aiDialog() {
    const a = await api("/api/ai"); if (!a.ok) return toast(a.why || "불러오기 실패", "bad");
    const act = a.active || {}, n = v => v === null || v === undefined ? "—" : v, kn = k => k === "load" ? "부하" : "태양광";
    const row = h => `<tr><td class="mono">${esc(h.t || "")}</td><td>${h.adopted ? `<span class="pill ok">적용</span>` : `<span class="pill">유지</span>`}</td><td class="mono">${["load", "pv"].map(k => h.kinds && h.kinds[k] ? `${kn(k)} ${n(h.kinds[k].current)} → ${n(h.kinds[k].new)}%` : "").filter(Boolean).join(" · ") || "—"}</td><td>${esc(h.why || "")}</td></tr>`;
    modal(`<div class="wide" style="padding:18px 20px"><h3 style="margin:0">AI 학습 상태 <span class="muted" style="font-weight:400;font-size:12px">— 자료가 쌓이면 스스로 다시 배우고, 검증을 통과한 모델만 적용합니다</span></h3>
      <div class="kv" style="margin:10px 0">
        <span class="k">적용 중인 모델</span><span class="v">${act.ver ? esc(act.ver) + " (" + esc(act.t || "") + ")" : "기본 모델(자체 학습 전)"}</span>
        <span class="k">학습 자료</span><span class="v" style="font-family:var(--sans);font-size:11.5px">${act.rows ? act.rows + "구간(" + Math.floor(act.rows / 96) + "일) · " + esc(act.source || "") : "—"}</span>
        <span class="k">검증 오차 (부하 / 태양광)</span><span class="v ${a.degraded ? "badc" : ""}">${n(act.load && act.load.nmae)}% / ${n(act.pv && act.pv.nmae)}% <span class="muted">(한도 ${a.limit}%)</span></span>
        <span class="k">최근 오차 보정</span><span class="v">${act.load ? (act.load.bias_on ? "부하 켬" : "부하 끔") + " · " + (act.pv && act.pv.bias_on ? "태양광 켬" : "태양광 끔") : "—"}${this.fc && this.fc.ai && this.fc.ai.bias_load !== null && this.fc.ai.bias_load !== undefined ? ` <span class="muted">(지금 부하 ${this.fc.ai.bias_load > 0 ? "+" : ""}${this.fc.ai.bias_load} kW)</span>` : ""}</span>
        <span class="k">다음 학습</span><span class="v">${a.busy ? "지금 학습 중…" : a.enabled ? Math.floor(a.next_s / 60) + "분 뒤 (주기 " + a.retrain_h + "시간)" : "꺼짐"}</span>
        <span class="k">운전 반영</span><span class="v ${a.degraded ? "badc" : "okc"}">${a.degraded ? "정확도 저하 — 규칙 운전 중" : "예측 계획 운전에 사용"}</span>
      </div>
      <div style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th>시각</th><th>판단</th><th>검증 오차 (현재 → 새 모델)</th><th>사유</th></tr></thead><tbody>${(a.history || []).map(row).join("") || `<tr><td colspan="4" class="muted">아직 학습 기록이 없습니다. 자료가 ${a.min_rows}구간(${Math.floor(a.min_rows / 96)}일) 이상 쌓이면 시작합니다.</td></tr>`}</tbody></table></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" id="aiBack">이전 모델로 되돌리기</button><button class="btn eng" id="aiNow">지금 학습</button><button class="btn" id="aiClose">닫기</button></div></div>`, box => {
      box.querySelector("#aiClose").onclick = closeModal;
      box.querySelector("#aiNow").onclick = async () => { if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return; } const r = await api("/api/ai/train", {}); toast(r.ok ? "학습을 시작했습니다(1~2분). 끝나면 이 창을 다시 열어 확인하십시오" : (r.why || "실패"), r.ok ? "ok" : "bad"); closeModal(); };
      box.querySelector("#aiBack").onclick = async () => { if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return; } if (!confirm("바로 앞 판의 예측 모델로 되돌립니다.")) return; const r = await api("/api/ai/rollback", {}); toast(r.why || (r.ok ? "되돌렸습니다" : "실패"), r.ok ? "ok" : "bad"); closeModal(); this.load(); };
    });
  },
  async load() {
    const [f, e] = await Promise.all([api("/api/forecast"), api("/api/energy")]);
    if (S.page !== "energy" || !$("#accSub")) return;                       // 응답이 오기 전에 화면을 떠났다
    if (e.hours) this.hrs = e.hours;
    if (f.ok) this.fc = f; else { $("#accSub").textContent = f.why || "예측 계산 중"; clearTimeout(this._retry); this._retry = setTimeout(() => this.load(), 1500); }   // 재시도는 한 줄기만
    this.draw();
  },
  pvAi(f) {                                                               // 태양광 예측 보강: 하늘 카메라 + 주의집중(닮은 과거 찾기)
    const s = f.sky || {}, a = f.pv_ai || {};
    const cam = !s.on ? "하늘 카메라 사용 안 함" : s.ok ? `구름량 <b>${F.n(s.cover, 0)}%</b>` : esc(s.why || "사진 없음");
    const img = s.on && s.t ? `<img src="/api/skycam.png?t=${Math.floor(s.t)}" alt="하늘 사진">` : `<div class="noimg">사진 없음</div>`;
    const mix = a.on ? `섞는 비율 ${a.alpha.map((x, i) => "≤" + f.acc.buckets[i] / 4 + "h " + Math.round(x * 100) + "%").filter((_, i) => a.alpha[i] > 0).join(" · ")}` : "검증에서 도움이 안 되어 쉬는 중(릿지 회귀만 사용)";
    const refs = !a.on ? "" : a.refs.length ? "가장 닮은 과거: " + a.refs.map(r => `${esc(r[0].slice(5))} (${r[1]}%)`).join(", ") : "닮은 과거 표시는 낮에만";
    const imp = a.on ? "중요하게 본 것: " + a.near.slice(0, 3).map(r => esc(r[0])).join(", ") : "";
    return `${img}<div><div><span class="tag">하늘 카메라</span> ${cam}</div><div><span class="tag">주의집중 예측</span> ${mix}</div><div class="muted">${refs}${refs && imp ? " · " : ""}${imp}</div></div>`;
  },
  draw() {
    if (!$("#fcL")) return; const f = this.fc;
    if (this.hrs) drawHourly($("#hrC"), this.hrs, "fill");
    if (!f) return;
    drawForecast($("#fcL"), f, "load", TV("--load"), "fill"); drawForecast($("#fcP"), f, "pv", TV("--pv"), "fill"); drawDaily($("#dayC"), f.daily, "fill"); drawScatter($("#scat"), f.acc.scatter, "fill");
    const a = f.acc, okc = v => v !== null && v <= a.limit ? "ok" : "warnc";
    $("#accSub").textContent = `${f.source} · 발행 ${f.issued} · 백테스트 ${a.n_issue}회 · 모델 ${f.trained.load && f.trained.pv ? "학습됨" : "미학습(전일 동시각)"}`;
    $("#pvAi").innerHTML = this.pvAi(f);
    $("#accBig").innerHTML = `<div><div class="lab">부하 오차 nMAE</div><div class="big ${okc(a.load_nmae)}">${F.n(a.load_nmae, 1)}<small>%</small></div><div class="muted" style="font-size:12px">기준 ≤ 15%</div></div>
      <div><div class="lab">PV 오차 (용량 대비)</div><div class="big ${okc(a.pv_nmae)}">${F.n(a.pv_nmae, 1)}<small>%</small></div><div class="muted" style="font-size:12px">기준 ≤ 15%</div></div>
      <div><div class="lab">80% 구간 포함률</div><div class="big ${a.load_cov >= 70 ? "ok" : "warnc"}">${F.n(a.load_cov, 0)}<small>% / ${F.n(a.pv_cov, 0)}%</small></div><div class="muted" style="font-size:12px">기준 ≥ 70%</div></div>
      <div><div class="lab">일 전력량 오차</div><div class="big">${F.n(a.load_day, 1)}<small>% / ${F.n(a.pv_day, 1)}%</small></div><div class="muted" style="font-size:12px">PV는 날씨 변화로 큼</div></div>`;
    const hb = (arr, col) => arr.map((v, i) => `<div class="hb"><span class="muted">≤ ${a.buckets[i] / 4}h</span><span class="tr"><i style="width:${Math.min(100, (v || 0) / 20 * 100)}%;background:${col}"></i><b style="left:${a.limit / 20 * 100}%"></b></span><span class="mono" style="text-align:right">${F.n(v, 1)}%</span></div>`).join("");
    $("#accL").innerHTML = hb(a.load_by_h, "linear-gradient(90deg,var(--accent2),var(--load))"); $("#accP").innerHTML = hb(a.pv_by_h, "linear-gradient(90deg,var(--pv),var(--pv))");
  },
  update(s) {
    const e = s.energy, k = s.kpi, gen = e.pv + e.dg + e.fc;
    $("#enTiles").innerHTML = [
      ["금일 PV 발전", e.pv, "kWh", "pv", `최대 ${F.n(e.peak_pv, 0)} kW`], ["금일 디젤 발전", e.dg, "kWh", "dg", `연료 ${F.n(e.fuel_l, 1)} L`], ["금일 연료전지", e.fc, "kWh", "fc", `수소 ${F.n(e.h2_nm3, 1)} Nm³`],
      ["금일 부하 소비", e.load, "kWh", "load", `최대 ${F.n(e.peak_load, 0)} kW`], ["ESS 충전 / 방전", e.ess_chg, "kWh", "ess", `방전 ${F.n(e.ess_dis, 1)} kWh`],
      ["재생에너지 자급률", gen > 0 ? e.pv / gen * 100 : 0, "%", "g1", `발전 합계 ${F.n(gen, 1)} kWh`]]
      .map(([l, v, u, c, f]) => `<div class="panel tile"><div class="lab"><i style="background:var(--${c});color:var(--${c})"></i>${l}</div><div class="big">${F.n(v, v >= 100 ? 0 : 1)}<small>${u}</small></div><div class="foot"><span>${f}</span></div></div>`).join("");
    if (!this._t2 || Date.now() - this._t2 > 15000) { this._t2 = Date.now(); api("/api/energy").then(e2 => { this.hrs = e2.hours; if ($("#hrC")) drawHourly($("#hrC"), this.hrs, "fill"); }); }
  },
};
