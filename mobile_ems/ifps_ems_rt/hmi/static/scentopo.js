/* 운영 시나리오 — 구성도 보기.
   실제 장비(사진)·배전반(모선)·차단기를 입체 블록으로 놓고, 단계마다 지령·응답과 전력의 흐름을 보여 준다.
   상태(차단기 투입·개방·트립, 운전·정지, kW)는 검증 결과가 단계마다 남긴 값(snap)이다 — 검증하기 전에는 구성만 보인다.
   모선 구성은 결선도 화면과 같다: 모선 A(상전·태양광·디젤·연료전지 / 1등급 부하·수전해) — 연결 차단기(TIE) — 모선 B(주둔지 발전기·ESS·복합전력 G1 / 2·3등급 부하). */
const ScTopo = (() => {
  const KEY = "ems.scenario.layout.v1", U = 46, V = 23, BUS_GY = 4;
  const BUS = {A: [-0.4, 6.6], B: [8.0, 13.4]}, TIE_GX = 7.3;
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
    ELZ: {name: "수전해", kind: "load", bus: "A", at: [4.6, 7.9], kw: "ELZ.kw", st: "ELZ.status", c: "#8fd3ff"},
    L2: {name: "2등급 중요 부하", kind: "load", bus: "B", at: [9.4, 7.9], cb: "L2", kw: "LOAD.p2_kw", c: "#ffc56b", photo: "l2"},
    L3: {name: "3등급 일반 부하", kind: "load", bus: "B", at: [11.8, 7.9], cb: "L3", kw: "LOAD.p3_kw", c: "#8fb7ff", photo: "l3"},
    EMS: {name: "EMS", kind: "ctl", at: [7.3, -2.8], c: "#f2d27a", photo: "ems"},
    MTR: {name: "계측·배전 게이트웨이", kind: "ctl", at: [15.4, 4.4], c: "#a9d18e", photo: "dist"},
    TEST: {name: "검증기", kind: "ctl", at: [-2.6, 5.6], c: "#c9a6c0", icon: "actor"},
  };
  const CB_TEXT = {0: "개방", 1: "투입", 2: "트립"}, CB_COLOR = {0: "#8a97a5", 1: "#55d08a", 2: "#ff6b6b"};
  const esc = t => String(t).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  const P = (gx, gy) => [(gx - gy) * U, (gx + gy) * V];
  let layout = {};
  try { layout = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { layout = {}; }
  const at = id => layout[id] || NODES[id].at;
  const foot = id => { const n = NODES[id], [a, b] = BUS[n.bus]; return [Math.max(a + 0.3, Math.min(b - 0.3, at(id)[0])), BUS_GY]; };   // 모선 위의 접속점
  const mid = (p, q, t = 0.5) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const pts = a => a.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");

  // 신호가 어느 블록에 속하는지: CB.L3 → 차단기 L3, LOAD.p2_kw → L2, GRID.kw → 상전, DG.status → 디젤 …
  function owner(tag, device) {
    const [head, tail = ""] = String(tag || "").split(".");
    if (head === "CB" || head === "FLT") return {node: Object.keys(NODES).find(k => NODES[k].cb === tail) || (tail === "TIE" ? "TIE" : "MTR"), part: head === "CB" ? "cb" : "flt"};
    if (head === "LDS") return {node: tail, part: "cb"};
    if (head === "LOAD") return {node: {p1_kw: "L1", p2_kw: "L2", p3_kw: "L3"}[tail] || "MTR"};
    if (head === "BUS") return {node: tail.startsWith("b") ? "BUSB" : "BUSA"};
    if (head === "H2") return {node: "FC"};
    if (NODES[head]) return {node: head};
    return {node: NODES[device] ? device : "MTR"};
  }
  function ends(step) {                                      // [보내는 쪽, 받는 쪽, 선 모양]
    const to = step.device ? {node: step.device} : owner(step.tag);
    if (step.type === "command") return ["EMS", to, "call"];
    if (step.type === "policy") return ["TEST", {node: "EMS"}, "call"];
    if (step.type === "policy_check") return ["EMS", {node: "TEST"}, "return"];
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

  function html(ctx) {
    const {steps, rows, stepIndex, describe, picked} = ctx, row = rows.find(r => r.step === stepIndex), snap = row?.snap || rows.filter(r => r.step < stepIndex).pop()?.snap || null;
    const v = tag => snap && tag in snap ? snap[tag] : null, cb = name => v("CB." + name), closed = name => cb(name) === 1 || (cb(name) === null && !snap);
    const running = id => { const n = NODES[id]; return id === "GRID" ? cb("GRID") === 1 : n.st ? v(n.st) > 0.5 : Math.abs(v(n.kw) || 0) > 0.5; };
    const feeds = bus => Object.keys(NODES).some(id => NODES[id].kind === "src" && NODES[id].bus === bus && id !== "PV" && running(id) && cb(NODES[id].cb) === 1);
    let liveA = !!snap && feeds("A"), liveB = !!snap && feeds("B"); if (snap && cb("TIE") === 1) liveA = liveB = liveA || liveB;
    const live = {A: liveA, B: liveB}, kw = id => NODES[id].kw ? v(NODES[id].kw) : null;

    // 모선(배전반)과 연결 차단기
    const bus = Object.entries(BUS).map(([k, [a, b]]) => { const p = P(a, BUS_GY), q = P(b, BUS_GY);
      return `<g class="tp-bus ${live[k] ? "live" : ""} ${picked === "BUS" + k ? "picked" : ""}" data-node="BUS${k}"><line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" class="slab"/><line x1="${p[0]}" y1="${p[1] - 7}" x2="${q[0]}" y2="${q[1] - 7}" class="bar"/>
        <text x="${p[0] - 6}" y="${p[1] + 22}" text-anchor="end">주 배전반 ${k} · 모선 ${k}${snap ? (live[k] ? " · 급전 중" : " · 무전압") : ""}</text></g>`; }).join("");
    const breaker = (name, gp, ownerId) => { const s = cb(name), p = P(...gp), flt = v("FLT." + name);
      return `<g class="tp-cb ${picked === ownerId && ctx.part ? "picked" : ""}" data-node="${ownerId}" data-part="cb">${box(gp[0], gp[1], 0.3, 11, s === null ? "#5c6875" : CB_COLOR[s])}
        <text class="tp-cbname" x="${p[0] + 18}" y="${p[1] - 12}">CB.${name}</text><text class="tp-cbst" x="${p[0] + 18}" y="${p[1] + 1}" fill="${s === null ? "#8a97a5" : CB_COLOR[s]}">${s === null ? "—" : CB_TEXT[s]}${s === 2 && flt ? " · 고장 " + flt : ""}</text></g>`; };
    const tieA = P(BUS.A[1], BUS_GY), tieB = P(BUS.B[0], BUS_GY);
    const tie = `<line class="tp-cable ${snap && cb("TIE") === 1 && (liveA || liveB) ? "live" : ""}" x1="${tieA[0]}" y1="${tieA[1] - 4}" x2="${tieB[0]}" y2="${tieB[1] - 4}"/>${breaker("TIE", [TIE_GX, BUS_GY], "TIE")}`;

    // 급전선·차단기·장비
    const order = Object.keys(NODES).sort((a, b) => (at(a)[0] + at(a)[1]) - (at(b)[0] + at(b)[1]));          // 뒤에 있는 것부터 그린다
    const cables = order.filter(id => NODES[id].kind !== "ctl").map(id => { const n = NODES[id], a = P(...at(id)), f = P(...foot(id)), k = kw(id) || 0, on = n.cb ? cb(n.cb) === 1 : true;
      const flowing = snap && on && Math.abs(k) > 0.5 && (n.kind === "src" || live[n.bus]), toBus = n.kind === "src" ? k > 0 : false;          // ESS 는 충전(음수)이면 모선 → 장비
      const d = toBus ? `M${a[0]} ${a[1] - 4}L${f[0]} ${f[1] - 4}` : `M${f[0]} ${f[1] - 4}L${a[0]} ${a[1] - 4}`;
      return `<path class="tp-cable ${snap && on && (n.kind === "src" ? running(id) : live[n.bus]) ? "live" : ""} ${snap && n.cb && cb(n.cb) === 2 ? "trip" : ""}" d="${d}"/>${flowing ? `<path class="tp-flow" d="${d}" style="--w:${Math.min(5, 1.6 + Math.abs(k) / 60).toFixed(1)}px;stroke:${n.c}"/>` : ""}`; }).join("");
    const cbs = order.filter(id => NODES[id].cb).map(id => breaker(NODES[id].cb, mid(at(id), foot(id)), id)).join("");
    const nodes = order.map(id => { const n = NODES[id], [gx, gy] = at(id), p = P(gx, gy), k = kw(id), run = snap && n.kind !== "ctl" ? running(id) : null;
      const cut = n.kind === "load" && n.cb && snap && cb(n.cb) !== 1;                 // 부하 차단기가 열려 있으면 급전되지 않는다(표시값은 부하 요구량)
      const chip = !snap || n.kind === "ctl" ? "" : cut ? `급전 차단${k ? " · 요구 " + k.toFixed(0) + " kW" : ""}` : [k === null ? "" : `${k.toFixed(k % 1 ? 1 : 0)} kW`, n.soc && v(n.soc) !== null ? `SOC ${v(n.soc)}%` : "", n.st ? (run ? "운전" : "정지") : ""].filter(Boolean).join(" · ");
      const card = n.icon ? `<g transform="translate(${p[0]} ${p[1] - 40})" stroke="${n.c}" fill="none" class="tp-icon"><circle r="27" fill="#16201e" stroke-width="2"/>${ICON[n.icon]}</g>`
        : `<g class="tp-card"><rect x="${p[0] - 37}" y="${p[1] - 66}" width="74" height="50" rx="6" fill="#16201e" stroke="${n.c}" stroke-width="2"/>
            <text x="${p[0]}" y="${p[1] - 36}" text-anchor="middle" fill="${n.c}" class="tp-code">${id}</text>
            ${n.photo ? `<image href="photos/${n.photo}.jpg" x="${p[0] - 35}" y="${p[1] - 64}" width="70" height="46" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 4px)" onerror="this.remove()"/>` : ""}</g>`;
      return `<g class="tp-node ${cut ? "off" : run === true ? "on" : run === false ? "off" : ""} ${picked === id && !ctx.part ? "picked" : ""}" data-node="${id}" tabindex="0" role="button" aria-label="${esc(n.name)}">
        ${box(gx, gy, 0.52, 10, n.c)}${card}<text class="tp-name" x="${p[0]}" y="${p[1] - (chip ? 86 : 72)}" text-anchor="middle">${esc(n.name)}</text>
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

    const xs = Object.keys(NODES).map(id => P(...at(id))), minX = Math.min(...xs.map(p => p[0])) - 80, maxX = Math.max(...xs.map(p => p[0])) + 100, minY = Math.min(...xs.map(p => p[1])) - 120, maxY = Math.max(...xs.map(p => p[1])) + 50;
    return `<svg class="tp-svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" role="img" aria-label="장비·배전반·차단기 구성도">
      <defs><marker id="tpHead" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="12" refX="12" refY="6" orient="auto" viewBox="0 0 10 9" preserveAspectRatio="none"><path d="M0 0L10 4.5L0 9z" fill="currentColor"/></marker></defs>
      ${bus}${tie}${cables}${cbs}${nodes}${signal}</svg>
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
    let drag = null;
    svg.onpointerdown = e => { const g = e.target.closest("[data-node]"); if (!g) return; const id = g.dataset.node;
      drag = {id, part: g.dataset.part || "", x: e.clientX, y: e.clientY, moved: false, start: NODES[id] && !g.dataset.part ? [...at(id)] : null}; svg.setPointerCapture(e.pointerId); };
    svg.onpointermove = e => { if (!drag?.start) return; const m = svg.getScreenCTM(), dx = (e.clientX - drag.x) / m.a, dy = (e.clientY - drag.y) / m.d;
      if (Math.abs(dx) + Math.abs(dy) < 6 && !drag.moved) return; drag.moved = true;
      const gx = drag.start[0] + (dx / U + dy / V) / 2, gy = drag.start[1] + (dy / V - dx / U) / 2; layout[drag.id] = [Math.round(gx * 10) / 10, Math.round(gy * 10) / 10];
      const g = svg.querySelector(`.tp-node[data-node="${drag.id}"]`), p0 = P(...drag.start), p1 = P(...layout[drag.id]); if (g) g.setAttribute("transform", `translate(${p1[0] - p0[0]} ${p1[1] - p0[1]})`); };
    svg.onpointerup = e => { if (!drag) return; const d = drag; drag = null;
      if (d.moved) { try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch (_) { /* 저장 실패는 무시(배치만 초기 상태로 돌아간다) */ } return onMoved(); }
      onPick(d.id, d.part); };
    svg.onkeydown = e => { const g = e.target.closest?.("[data-node]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(g.dataset.node, g.dataset.part || ""); } };
  }
  function reset() { layout = {}; try { localStorage.removeItem(KEY); } catch (_) { /* 무시 */ } }
  const custom = () => Object.keys(layout).length > 0;
  return {html, bind, reset, custom, tagsOf, title, owner};
})();
