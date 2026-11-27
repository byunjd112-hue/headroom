/* 운영 시나리오 — 구성도 보기.
   실제 장비(사진)·배전반(모선)·차단기를 입체 블록으로 놓고, 단계마다 지령·응답과 전력의 흐름을 보여 준다.
   상태(차단기 투입·개방·트립, 운전·정지, kW)는 검증 결과가 단계마다 남긴 값(snap)이다 — 검증하기 전에는 구성만 보인다.
   모선 구성은 결선도 화면과 같다: 모선 A(상전·태양광·디젤·연료전지 / 1등급 부하·수전해) — 연결 차단기(TIE) — 모선 B(주둔지 발전기·ESS·복합전력 G1 / 2·3등급 부하). */
const ScTopo = (() => {
  const KEY = "ems.scenario.layout.v1", U = 46, V = 23, BUS_GY = 4;
  const BUS0 = {A: [-0.4, 6.6], B: [8.0, 13.4]}, TIE_GX = 7.3;
  // 종류 kind: src 전원(모선으로 공급) · load 부하(모선에서 받음) · ctl 제어·시험(전력선 없음)
  const NODES = {
    GRID: {name: "상전 수전", kind: "src", bus: "A", at: [0.4, 0.2], cb: "GRID", kw: "GRID.kw", c: "#b9c4d0", icon: "grid"},
    PV: {name: "태양광", kind: "src", bus: "A", at: [2.2, 0.2], cb: "PV", kw: "PV.kw", st: "PV.status", c: "#f0c05a", photo: "pv"},
    DG: {name: "디젤 발전기", kind: "src", bus: "A", at: [4.0, 0.2], cb: "DG", kw: "DG.kw", st: "DG.status", c: "#e59866", photo: "dg"},
    FC: {name: "연료전지", kind: "src", bus: "A", at: [5.8, 0.2], cb: "FC", kw: "FC.kw", st: "FC.status", c: "#7fc8c0", photo: "fc"},
    GDG: {name: "주둔지 발전기", kind: "src", bus: "B", at: [8.8, 0.2], cb: "GDG", kw: "GDG.kw", st: "GDG.status", c: "#d7a86e", photo: "gdg"},
    ESS: {name: "ESS", kind: "src", bus: "B", at: [10.6, 0.2], cb: "ESS", kw: "ESS.kw", st: "ESS.status", soc: "ESS.soc", c: "#9aa8e8", photo: "ess"},
    G1: {name: "복합전력 G1", kind: "src", bus: "B", at: [12.4, 0.2], cb: "G1", c: "#c4b08a", photo: "dg"},
    L1: {name: "1등급 필수 부하", kind: "load", bus: "A", at: [1.2, 7.9], cb: "L1", kw: "LOAD.p1_kw", c: "#ff8fa6", photo: "l1"},
    ELZ: {name: "수전해", kind: "load", bus: "A", at: [4.6, 7.9], kw: "ELZ.kw", st: "ELZ.status", c: "#8fd3ff", photo: "fc"},
    L2: {name: "2등급 중요 부하", kind: "load", bus: "B", at: [9.4, 7.9], cb: "L2", kw: "LOAD.p2_kw", c: "#ffc56b", photo: "l2"},
    L3: {name: "3등급 일반 부하", kind: "load", bus: "B", at: [11.8, 7.9], cb: "L3", kw: "LOAD.p3_kw", c: "#8fb7ff", photo: "l3"},
    TPCS: {name: "TPCS", kind: "ctl", at: [7.3, -2.8], c: "#f2d27a", photo: "ems"},
    MTR: {name: "계측·배전 게이트웨이", kind: "ctl", at: [14.0, 10.8], c: "#a9d18e", photo: "dist"},
    TEST: {name: "검증기", kind: "ctl", at: [-0.6, 11.2], c: "#c9a6c0", icon: "actor"},
  };
  // 시나리오용 추가 설비(scenario_extra.json): 급전선은 블록으로, 변압기는 급전선 위에, 보호 계전기는 차단기 옆에 정정값으로 보인다
  const BASE = Object.keys(NODES), SLOT = {Aload: [-1.6, -1.8], Bload: [14.2, 1.8], Asrc: [-1.4, -1.8], Bsrc: [14.2, 1.8]};      // [첫 자리, 간격] — 같은 줄에서 모선 바깥쪽으로 이어 붙인다
  let EXTRA = {feeders: [], transformers: [], relays: []};
  // 모선 소속과 좌우 순서는 결선도와 같게: 모선 구성(BusPlan)과 개요 배치도의 순서를 따른다
  const HOME = Object.fromEntries(BASE.map(k => [k, {bus: NODES[k].bus, y: NODES[k].at[1]}])), REG = {Asrc: [0.4, 5.8], Bsrc: [8.8, 12.4], Aload: [1.2, 4.6], Bload: [9.4, 11.8]};
  /* 같은 종류가 여러 대면 둘째 장비부터 블록을 따로 만든다(장비 한 대 = 블록 하나 — 결선도와 같다). 값은 그 한 대의 신호(ESS2.kw …), 차단기는 종류의 차단기를 같이 본다.
     태양광은 인버터가 출력을 내주지 않아 한 대별 kW 는 없다(합계는 첫 블록에). 반환: 만든 블록의 이름들 */
  const MULTI = ["PV", "DG", "FC", "ESS"];
  let LIVE = false;                                                   // 실시간 보기일 때만 한 대별 블록을 만든다 — 검증 결과(구성도 재생)는 그 검증을 돌린 가상 장치의 값이라 지금의 대수와 상관이 없다
  function units() {
    Object.keys(NODES).filter(k => NODES[k].unit).forEach(k => delete NODES[k]);
    const src = BusPlan.s().sources || [], out = [];
    for (const k of MULTI) { const f = LIVE && typeof KF === "function" ? KF(k) : null, b = NODES[k]; NAME0[k] = NAME0[k] || b.name; b.name = NAME0[k] + (f && f.units.length > 1 ? " 1" : "");
      (f && f.units.length > 1 ? f.units.slice(1) : []).forEach((u, n) => { const q = src.find(z => z.id === u.id);
        NODES[u.id] = {name: `${NAME0[k]} ${n + 2}`, kind: "src", bus: (q && q.bus) || HOME[k].bus, at: b.at.slice(), cb: b.cb, kw: u.id + ".kw", st: u.id + ".status", soc: b.soc ? u.id + ".soc" : undefined, c: b.c, photo: b.photo, icon: b.icon, unit: k}; out.push(u.id); }); }
    const dg = LIVE && typeof KF === "function" ? KF("DG") : null, g = NODES.G1, many = !!(dg && dg.units.length > 1);      // 복합전력 ESS: 차량(디젤 PCS)마다 한 블록 — 차단기 CB.G1 · CB.G1_2 …, 모선도 차량마다
    NAME0.G1 = NAME0.G1 || g.name; g.name = NAME0.G1 + (many ? " 1" : ""); g.kw = many ? "G1.kw" : undefined; g.st = many ? "G1.status" : undefined;
    (many ? dg.units.slice(1) : []).forEach((u, n) => { const id = "G1_" + u.id.replace(/\D/g, ""), q = src.find(z => z.id === id);
      NODES[id] = {name: `${NAME0.G1} ${n + 2}`, kind: "src", bus: (q && q.bus) || HOME.G1.bus, at: g.at.slice(), cb: id, kw: id + ".kw", st: id + ".status", c: g.c, photo: g.photo, unit: "G1"}; out.push(id); });
    return out;
  }
  function arrange() {
    if (typeof BusPlan === "undefined" || !BusPlan.s()) return;
    const extra = units(), SRCK = BASE.filter(k => NODES[k].kind === "src"), STEP = 1.8;
    for (const bus of ["A", "B"]) {                                    // 전원: 모선마다 개요의 좌 → 우 순서로. 많아지면 모선 바깥쪽으로 자리를 넓힌다(블록이 겹치지 않게 — 모선 길이는 따라 늘어난다)
      const mine = SRCK.concat(extra).filter(k => (NODES[k].unit ? NODES[k].bus : BusPlan.of(k, HOME[k].bus)) === bus).sort((p, q) => { const a = NODES[p].unit || p, c = NODES[q].unit || q; return BusPlan.ox(a, SRCK.indexOf(a)) - BusPlan.ox(c, SRCK.indexOf(c)) || SRCK.indexOf(a) - SRCK.indexOf(c) || (p > q ? 1 : -1); });
      const [r0, r1] = REG[bus + "src"], m = mine.length, wide = (m - 1) * STEP > r1 - r0, x0 = !wide ? r0 : bus === "A" ? r1 - (m - 1) * STEP : r0, step = m < 2 ? 0 : wide ? STEP : (r1 - r0) / (m - 1);
      mine.forEach((k, i) => { NODES[k].bus = bus; NODES[k].at = [Math.round((m === 1 ? (r0 + r1) / 2 : x0 + step * i) * 10) / 10, HOME[NODES[k].unit || k].y]; }); }
    const ns = BASE.filter(k => NODES[k].kind === "load").map(k => ({id: k, x: 0, bus: HOME[k].bus})), home = Object.fromEntries(ns.map(n => [n.id, n.bus]));
    for (const bus of ["A", "B"]) BusPlan.place(ns, home, bus, REG[bus + "load"][0], REG[bus + "load"][1], id => ({L1: 1, ELZ: 1.5, L2: 2, L3: 3}[id] || 9));
    ns.forEach(n => { NODES[n.id].bus = n.bus; NODES[n.id].at = [Math.round(n.x * 10) / 10, HOME[n.id].y]; });
  }
  function configure(extra) {
    EXTRA = {feeders: extra?.feeders || [], transformers: extra?.transformers || [], relays: extra?.relays || []};
    Object.keys(NODES).filter(k => !BASE.includes(k)).forEach(k => delete NODES[k]);
    const used = {};
    for (const f of EXTRA.feeders) { const key = f.bus + f.kind, n = used[key] = (used[key] || 0) + 1, [g0, step] = SLOT[key], gx = Math.round((g0 + step * (n - 1)) * 10) / 10;
      NODES[f.id] = {name: f.name, kind: f.kind, bus: f.bus, at: [gx, f.kind === "load" ? 7.9 : 0.2], cb: f.id, kw: f.id + ".kw", c: f.kind === "load" ? "#c3a8ee" : "#9ad27a", extra: true, photo: f.photo || undefined, ems: !!f.ems}; }
  }
  // 차단기 옆에 적는 계전기 정정: 요소 번호 ▸ 정정값 · 시간 특성 (→ 후비 차단기)
  function relayText(r) {
    const kind = r.kind || "oc", pick = r.pickup ?? r.pickup_kw, curve = r.curve || "dt", code = r.code ?? {oc: 51, gf: 64, uv: 27}[kind];
    const what = kind === "gf" ? `${pick} A` : kind === "uv" ? `< ${pick} V` : `${pick} kW`, time = curve === "dt" ? `${((r.delay_ms || 0) / 1000).toFixed(1)} s` : `${{si: "표준", vi: "강", ei: "초"}[curve]}반한시 ×${r.tms ?? 0.1}`;
    return `${code} ▸ ${what} · ${time}${r.backup ? " → 후비 " + r.backup : ""}`;
  }
  const CB_TEXT = {0: "개방", 1: "투입", 2: "트립"}, CB_COLOR = {0: "#8a97a5", 1: "#55d08a", 2: "#ff6b6b"};
  const esc = t => String(t).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const P = (gx, gy) => [(gx - gy) * U, (gx + gy) * V];
  let layout = {}, busy = false; const NAME0 = {};                              // busy: 블록을 끄는 중(실시간 보기는 그동안 다시 그리지 않는다)
  try { layout = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { layout = {}; }
  const at = id => layout[id] || NODES[id].at;
  // 모선 길이: 붙은 설비가 바깥으로 나가면 그만큼 늘어난다(A 는 왼쪽, B 는 오른쪽)
  const BUS = new Proxy({}, {get: (_, k) => { const xs = Object.keys(NODES).filter(id => NODES[id].bus === k).map(id => at(id)[0]);
    return k === "A" ? [Math.min(BUS0.A[0], Math.min(...xs) - 0.8), BUS0.A[1]] : [BUS0.B[0], Math.max(BUS0.B[1], Math.max(...xs) + 0.8)]; }});
  const foot = id => { const n = NODES[id], [a, b] = BUS[n.bus]; return [Math.max(a + 0.3, Math.min(b - 0.3, at(id)[0])), BUS_GY]; };   // 모선 위의 접속점
  const mid = (p, q, t = 0.5) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const pts = a => a.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");

  // 신호가 어느 블록에 속하는지: CB.L3 → 차단기 L3, LOAD.p2_kw → L2, GRID.kw → 상전, DG.status → 디젤 …
  function owner(tag, device) {
    const [head, tail = ""] = String(tag || "").split(".");
    if (head === "GF") return {node: NODES[tail] ? tail : "MTR"};
    if (head === "CB" || head === "FLT" || head === "STK") return {node: Object.keys(NODES).find(k => NODES[k].cb === tail) || (tail === "TIE" ? "TIE" : "MTR"), part: head === "CB" ? "cb" : "flt"};
    if (head === "LDS") return {node: tail, part: "cb"};
    if (head === "LOAD") return {node: {p1_kw: "L1", p2_kw: "L2", p3_kw: "L3"}[tail] || "MTR"};
    if (head === "BUS") return {node: tail.startsWith("b") ? "BUSB" : "BUSA"};
    if (head === "H2") return {node: "FC"};
    const tr = EXTRA.transformers.find(t => t.id === head); if (tr) return {node: tr.on};
    if (NODES[head]) return {node: head};
    return {node: NODES[device] ? device : "MTR"};
  }
  function ends(step) {                                      // [보내는 쪽, 받는 쪽, 선 모양]
    const to = step.device ? {node: step.device} : owner(step.tag);
    if (step.type === "command") return ["TPCS", to, "call"];
    if (step.type === "policy") return ["TEST", {node: "TPCS"}, "call"];
    if (step.type === "policy_check") return ["TPCS", {node: "TEST"}, "return"];
    if (step.type === "wait") return ["TEST", {node: "TEST"}, "self"];
    if (step.type === "set") return ["TEST", to, "call"];
    if (step.type === "response") return ["TEST", to, "inject"];
    return [to.node, {node: "TEST", part: to.part, from: to}, "return"];
  }

  // ── 그리기 도우미
  function box(gx, gy, s, h, color, cls = "") {                 // 입체 블록(윗면 + 옆면 둘)
    const n = P(gx - s, gy - s), e = P(gx + s, gy - s), so = P(gx + s, gy + s), w = P(gx - s, gy + s), up = p => [p[0], p[1] - h];
    return `<g class="tp-box ${cls}"><polygon points="${pts([w, so, up(so), up(w)])}" fill="${color}"/><polygon points="${pts([w, so, up(so), up(w)])}" fill="#000" opacity=".28"/>
      <polygon points="${pts([so, e, up(e), up(so)])}" fill="${color}"/><polygon points="${pts([so, e, up(e), up(so)])}" fill="#000" opacity=".45"/>
      <polygon class="top" points="${pts([n, e, so, w].map(up))}" fill="${color}"/></g>`;
  }
  const ICON = {
    grid: `<path d="M-12 14L0-16L12 14M-8 4H8M-5-4H5M-16-8H16" fill="none" stroke-width="2.4" stroke-linecap="round"/>`,
    actor: `<circle cy="-12" r="6" stroke-width="2.4"/><path d="M0-6V8M-11 0H11M0 8L-8 19M0 8L8 19" fill="none" stroke-width="2.4" stroke-linecap="round"/>`,
  };
  function anchor(id, part) {                                   // 화살표가 닿는 화면 좌표
    if (id === "BUSA" || id === "BUSB") { const [a, b] = BUS[id.slice(3)]; const p = P((a + b) / 2, BUS_GY); return [p[0], p[1] - 8]; }
    if (id === "TIE") { const p = P(TIE_GX, BUS_GY); return [p[0], p[1] - 14]; }
    const n = NODES[id]; if (!n) return anchor("MTR");
    if (part && n.cb) { const p = P(...mid(at(id), foot(id))); return [p[0], p[1] - 12]; }
    const p = P(...at(id)); return [p[0], p[1] - 44];
  }

  /* 실시간 보기의 한 대별 값: 종류 이름의 신호(ESS.kw)는 합계라, 블록마다 그 한 대의 값(fleet.units)으로 바꿔 읽는다. 태양광은 합계를 연결된 대수로 나눈 추정값 */
  function unitVals(fleet) {
    const o = {};
    for (const k of MULTI) { const f = fleet && fleet[k]; if (!f || f.units.length < 2) continue;
      f.units.forEach(u => { o[u.id + ".kw"] = typeof unitKw === "function" ? unitKw(k, u) : u.kw; o[u.id + ".status"] = u.live === false ? 0 : u.on ? 1 : 0; if (u.soc != null) o[u.id + ".soc"] = u.soc; }); }
    const dg = fleet && fleet.DG;                                    // 복합전력 ESS: 그 차량 PCS 의 ESS 쪽 전력
    if (dg && dg.units.length > 1) dg.units.forEach((u, i) => { const id = i ? "G1_" + u.id.replace(/\D/g, "") : "G1"; o[id + ".kw"] = u.ess_kw == null ? null : u.ess_kw; o[id + ".status"] = u.live === false ? 0 : 1; });
    return o;
  }
  function html(ctx) {
    LIVE = !!ctx.fleet; arrange(); const uv = LIVE ? unitVals(ctx.fleet) : {};
    const {steps, rows, stepIndex, describe, picked} = ctx, row = rows.find(r => r.step === stepIndex), snap = row?.snap || rows.filter(r => r.step < stepIndex).pop()?.snap || null;
    const v = tag => tag in uv ? uv[tag] : snap && tag in snap ? snap[tag] : null, cb = name => v("CB." + name), closed = name => cb(name) === 1 || (cb(name) === null && !snap);
    const running = id => { const n = NODES[id]; return id === "GRID" ? cb("GRID") === 1 : n.st ? v(n.st) > 0.5 : Math.abs(v(n.kw) || 0) > 0.5; };
    const feeds = bus => Object.keys(NODES).some(id => NODES[id].kind === "src" && NODES[id].bus === bus && id !== "PV" && running(id) && cb(NODES[id].cb) === 1);
    let liveA = !!snap && feeds("A"), liveB = !!snap && feeds("B"); if (snap && cb("TIE") === 1) liveA = liveB = liveA || liveB;
    const known = !!snap && Object.keys(snap).some(t => t.startsWith("CB."));          // 차단기 값이 하나도 없으면(통신 두절) 급전 여부를 말하지 않는다
    const live = {A: liveA, B: liveB}, kw = id => NODES[id].kw ? v(NODES[id].kw) : null;

    // 모선(배전반)과 연결 차단기
    const bus = ["A", "B"].map(k => [k, BUS[k]]).map(([k, [a, b]]) => { const p = P(a, BUS_GY), q = P(b, BUS_GY);
      return `<g class="tp-bus ${live[k] ? "live" : ""} ${picked === "BUS" + k ? "picked" : ""}" data-node="BUS${k}"><line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" class="slab"/><line x1="${p[0]}" y1="${p[1] - 7}" x2="${q[0]}" y2="${q[1] - 7}" class="bar"/>
        <text x="${p[0] - 6}" y="${p[1] + 22}" text-anchor="end">주 배전반 ${k} · 모선 ${k}${snap ? (known ? (live[k] ? " · 급전 중" : " · 무전압") : " · 값 없음") : ""}</text></g>`; }).join("");
    const breaker = (name, gp, ownerId) => { const s = cb(name), p = P(...gp), flt = v("FLT." + name);
      return `<g class="tp-cb ${picked === ownerId && ctx.part ? "picked" : ""}" data-node="${ownerId}" data-part="cb">${box(gp[0], gp[1], 0.3, 11, s === null ? "#5c6875" : CB_COLOR[s])}
        <text class="tp-cbname" x="${p[0] + 18}" y="${p[1] - 12}">CB.${name}</text><text class="tp-cbst" x="${p[0] + 18}" y="${p[1] + 1}" fill="${s === null ? "#8a97a5" : CB_COLOR[s]}">${s === null ? "—" : CB_TEXT[s]}${s === 2 && flt ? " · 고장 " + flt : ""}${v("STK." + name) === 1 ? " · 차단 실패" + (s === 1 && flt ? "(고장 " + flt + ")" : "") : ""}${v("GF." + name) > 0 ? " · 지락 " + v("GF." + name) + " A" : ""}</text>
        ${EXTRA.relays.filter(r => r.cb === name).map((r, i) => `<text class="tp-relay" x="${p[0] + 18}" y="${p[1] + 13 + i * 11}">${esc(relayText(r))}</text>`).join("")}</g>`; };
    const tieA = P(BUS.A[1], BUS_GY), tieB = P(BUS.B[0], BUS_GY);
    const tie = `<line class="tp-cable ${snap && cb("TIE") === 1 && (liveA || liveB) ? "live" : ""}" x1="${tieA[0]}" y1="${tieA[1] - 4}" x2="${tieB[0]}" y2="${tieB[1] - 4}"/>${breaker("TIE", [TIE_GX, BUS_GY], "TIE")}`;

    // 급전선·차단기·장비
    const order = Object.keys(NODES).filter(id => !(ctx.live && id === "TEST")).sort((a, b) => (at(a)[0] + at(a)[1]) - (at(b)[0] + at(b)[1]));          // 뒤에 있는 것부터 그린다
    const cables = order.filter(id => NODES[id].kind !== "ctl").map(id => { const n = NODES[id], a = P(...at(id)), f = P(...foot(id)), k = kw(id) || 0, on = n.cb ? cb(n.cb) === 1 : true;
      const flowing = snap && on && Math.abs(k) > 0.5 && (n.kind === "src" || live[n.bus]), toBus = n.kind === "src" ? k > 0 : false;          // ESS 는 충전(음수)이면 모선 → 장비
      const d = toBus ? `M${a[0]} ${a[1] - 4}L${f[0]} ${f[1] - 4}` : `M${f[0]} ${f[1] - 4}L${a[0]} ${a[1] - 4}`;
      return `<path class="tp-cable ${snap && on && (n.kind === "src" ? running(id) : live[n.bus]) ? "live" : ""} ${snap && n.cb && cb(n.cb) === 2 ? "trip" : ""}" d="${d}"/>${flowing ? `<path class="tp-flow" d="${d}" style="--w:${Math.min(5, 1.6 + Math.abs(k) / 60).toFixed(1)}px;stroke:${n.c}"/>` : ""}`; }).join("");
    const cbs = order.filter(id => NODES[id].cb).map(id => breaker(NODES[id].cb, mid(at(id), foot(id)), id)).join("");
    const trs = EXTRA.transformers.filter(t => NODES[t.on]).map(t => { const g = mid(at(t.on), foot(t.on), 0.24), p = P(...g), pct = v(t.id + ".load_pct");
      return `<g class="tp-tr" data-node="${t.on}">${box(g[0], g[1], 0.26, 16, pct !== null && pct > 100 ? "#ff6b6b" : "#b9a37a")}<text class="tp-cbname" x="${p[0] - 16}" y="${p[1] - 20}" text-anchor="end">${esc(t.id)} · ${t.kva} kVA</text>
        ${pct === null ? "" : `<text class="tp-cbst" x="${p[0] - 16}" y="${p[1] - 7}" text-anchor="end" fill="${pct > 100 ? "#ff6b6b" : "#e8dcc0"}">부하율 ${pct.toFixed(0)}%</text>`}</g>`; }).join("");
    const nodes = order.map(id => { const n = NODES[id], [gx, gy] = at(id), p = P(gx, gy), k = kw(id), seen = id === "GRID" ? cb("GRID") !== null : v(n.st || n.kw) !== null, run = snap && n.kind !== "ctl" && seen ? running(id) : null;
      const cut = n.kind === "load" && n.cb && snap && cb(n.cb) !== null && cb(n.cb) !== 1;                 // 부하 차단기가 열려 있으면 급전되지 않는다(표시값은 부하 요구량)
      const un = snap ? Object.keys(snap).filter(t => t.startsWith("UNIT." + id) && /^\d*$/.test(t.slice(5 + id.length))) : [], placed = un.filter(t => snap[t] > 0.5).length;      // 검증 중 놓인 대수(모의 신호)
      const fl = ctx.fleet && ctx.fleet[id], none = fl ? fl.seen === 0 : un.length > 0 && placed === 0, many = fl ? (fl.units.length > 1 && !(LIVE && MULTI.includes(id)) ? ` · ${fl.units.length}대(운전 ${fl.units.filter(u => u.on).length})` : "") : placed > 1 ? ` · ${placed}대` : "";      // 자동 인식한 대수(개요 · 결선도와 같은 자료)
      const chip = none ? (fl ? "미설치(인식된 장치 없음)" : "없음(미휴대 · 철수)") : !snap || n.kind === "ctl" ? "" : !seen && k === null ? "값 없음" : cut ? `급전 차단${k ? " · 요구 " + k.toFixed(0) + " kW" : ""}` : [k === null ? "" : `${k.toFixed(k % 1 ? 1 : 0)} kW`, n.soc && v(n.soc) !== null ? `SOC ${v(n.soc)}%` : "", n.st ? (run ? "운전" : "정지") : ""].filter(Boolean).join(" · ") + many;
      const card = n.icon ? `<g transform="translate(${p[0]} ${p[1] - 40})" stroke="${n.c}" fill="none" class="tp-icon"><circle r="27" fill="#16201e" stroke-width="2"/>${ICON[n.icon]}</g>`
        : `<g class="tp-card"><rect x="${p[0] - 37}" y="${p[1] - 66}" width="74" height="50" rx="6" fill="#16201e" stroke="${n.c}" stroke-width="2"/>
            <text x="${p[0]}" y="${p[1] - 36}" text-anchor="middle" fill="${n.c}" class="tp-code">${id}</text>
            ${n.photo ? `<image href="photos/${n.photo}.jpg" x="${p[0] - 35}" y="${p[1] - 64}" width="70" height="46" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 4px)"/>` : ""}</g>`;
      return `<g class="tp-node ${cut || none ? "off" : run === true ? "on" : run === false ? "off" : ""} ${picked === id && !ctx.part ? "picked" : ""}" data-node="${id}" tabindex="0" role="button" aria-label="${esc(n.name)}">
        ${box(gx, gy, 0.52, 10, n.c)}${card}<text class="tp-name" x="${p[0]}" y="${p[1] - (chip ? 86 : 72)}" text-anchor="middle">${esc(n.name)}${n.extra ? (n.ems ? " ＊수급" : " ＊") : ""}${n.kind === "load" && n.cb && LD.g(n.cb) ? ` · ${LD.names(n.cb).slice(0, 2).join(", ") || "부하 없음"}${LD.names(n.cb).length > 2 ? " 외" : ""}` : ""}</text>
        ${chip ? `<text class="tp-chip" x="${p[0]}" y="${p[1] - 72}" text-anchor="middle">${esc(chip)}</text>` : ""}</g>`; }).join("");

    // 지금 단계의 신호 흐름
    let signal = "";
    const step = steps[stepIndex];
    if (step) { const [from, to, kind] = ends(step), a = anchor(from, kind === "return" ? to.from?.part : null), b = anchor(to.node, to.part), st = row?.state || "";
      const col = st === "fail" ? "#ff6b6b" : kind === "inject" ? "#ffb347" : kind === "return" ? "#55d08a" : "#ffd65a", text = `${stepIndex + 1}. ${describe(step)}`;
      const seen = row ? (st === "fail" && row.why ? row.why : [row.actual !== undefined && row.expected !== undefined ? `관측 ${row.actual}` : "", `${row.elapsed} ms`].filter(Boolean).join(" · ")) : "";
      if (kind === "self") signal = `<g class="tp-sig"><circle cx="${a[0]}" cy="${a[1]}" r="34" fill="none" stroke="${col}" stroke-dasharray="5 5" class="spin"/><text class="tp-say" x="${a[0]}" y="${a[1] - 44}" text-anchor="middle">${esc(text)}</text></g>`;
      else { const lift = Math.min(110, 30 + Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.18), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift], d = `M${a[0]} ${a[1]}Q${c[0]} ${c[1]} ${b[0]} ${b[1]}`, lab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - lift / 2 - 8];
        signal = `<g class="tp-sig ${kind} ${st}"><path d="${d}" stroke="${col}" class="${kind === "call" ? "" : "dash"}" marker-end="url(#tpHead)" style="color:${col}"/>
          ${st === "fail" ? `<text x="${b[0]}" y="${b[1] - 10}" text-anchor="middle" class="tp-x">✕</text>` : `<circle r="6" fill="${col}"><animateMotion dur="1.3s" repeatCount="indefinite" path="${d}"/></circle>`}
          <circle cx="${b[0]}" cy="${b[1]}" r="20" fill="none" stroke="${col}" class="ping"/>
          <text class="tp-say" x="${lab[0]}" y="${lab[1]}" text-anchor="middle">${esc(text)}</text>${seen ? `<text class="tp-seen ${st}" x="${lab[0]}" y="${lab[1] + 16}" text-anchor="middle">${esc(seen)}</text>` : ""}</g>`; } }

    const xs = order.map(id => P(...at(id))), minX = Math.min(...xs.map(p => p[0])) - 80, maxX = Math.max(...xs.map(p => p[0])) + 100, minY = Math.min(...xs.map(p => p[1])) - 120, maxY = Math.max(...xs.map(p => p[1])) + 50;
    return `<svg class="tp-svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="장비·배전반·차단기 구성도">
      <defs><marker id="tpHead" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" viewBox="0 0 10 9" preserveAspectRatio="none"><path d="M0 0L10 4.5L0 9z" fill="currentColor"/></marker></defs>
      ${bus}${tie}${cables}${cbs}${trs}${nodes}${signal}</svg>
      ${snap ? "" : '<p class="muted tp-hint">검증을 실행하면 단계마다 차단기·운전 상태와 전력 흐름이 표시됩니다. 지금은 구성과 신호 방향만 보입니다.</p>'}`;
  }

  // 고른 블록에서 바로 넣을 수 있는 단계(신호 목록)
  function tagsOf(id, points) {
    const n = NODES[id], own = t => { const o = owner(t.tag, t.device); return o.node === id; };
    if (id === "TIE") return points.filter(p => /^(CB|FLT)\.TIE$/.test(p.tag));
    if (id === "BUSA" || id === "BUSB") return points.filter(p => p.tag.startsWith("BUS."));
    if (!n) return [];
    return points.filter(own);
  }
  const title = id => id === "TIE" ? "모선 연결 차단기" : id === "BUSA" ? "주 배전반 A" : id === "BUSB" ? "주 배전반 B" : NODES[id]?.name || id;

  // 끌어서 배치 바꾸기(화면 좌표 → 격자 좌표, 0.1 칸 단위)
  function bind(root, onPick, onMoved) {
    const svg = root.querySelector(".tp-svg"); if (!svg) return;
    let drag = null; busy = false;
    svg.onpointerdown = e => { const g = e.target.closest("[data-node]"); if (!g) return; const id = g.dataset.node;
      drag = {id, part: g.dataset.part || "", x: e.clientX, y: e.clientY, moved: false, start: NODES[id] && !g.dataset.part ? [...at(id)] : null}; busy = true; svg.setPointerCapture(e.pointerId); };
    svg.onpointermove = e => { if (!drag?.start) return; const m = svg.getScreenCTM(), dx = (e.clientX - drag.x) / m.a, dy = (e.clientY - drag.y) / m.d;
      if (Math.abs(dx) + Math.abs(dy) < 6 && !drag.moved) return; drag.moved = true;
      const gx = drag.start[0] + (dx / U + dy / V) / 2, gy = drag.start[1] + (dy / V - dx / U) / 2; layout[drag.id] = [Math.round(gx * 10) / 10, Math.round(gy * 10) / 10];
      const g = svg.querySelector(`.tp-node[data-node="${drag.id}"]`), p0 = P(...drag.start), p1 = P(...layout[drag.id]); if (g) g.setAttribute("transform", `translate(${p1[0] - p0[0]} ${p1[1] - p0[1]})`); };
    svg.onpointerup = e => { if (!drag) return; const d = drag; drag = null; busy = false;
      if (d.moved) { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (_) { /* 저장 실패는 무시(배치만 초기 상태로 돌아간다) */ } return onMoved(); }
      onPick(d.id, d.part); };
    svg.onkeydown = e => { const g = e.target.closest?.("[data-node]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(g.dataset.node, g.dataset.part || ""); } };
  }
  function reset() { layout = {}; try { localStorage.removeItem(KEY); } catch (_) { /* 무시 */ } }
  const custom = () => Object.keys(layout).length > 0;
  return {html, bind, reset, custom, tagsOf, title, owner, configure, base: BASE, dragging: () => busy};
})();
