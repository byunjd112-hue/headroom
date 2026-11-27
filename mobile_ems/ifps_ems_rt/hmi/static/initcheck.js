/* 설치 점검(초기화): 장비를 설치한 뒤 한 번에 검사 → 문제마다 고치는 방법 안내 → 고친 뒤 다시 검사해 '해결됨' 확인. 서버: hmi/initcheck.py (GET /api/archive/initcheck)
   개요의 [설치 점검] 단추가 연다. 단추에는 지금 상태(미실시 · 남은 이상 · 주의 · 완료)가 보인다(스냅샷의 init).
   창은 설치 그림이다: 결선도 그림을 그대로 쓰고 맨 위에 TPCS(통신선)를 얹어 그림마다 ✔ · ! · ✕ 를 단다. 그림을 누르면 아래에 내용과 고치는 방법이 나온다. */
"use strict";
const InitCheck = {
  LV: { ok: ["정상", "ok", "var(--ok)"], warn: ["주의", "warn", "var(--warn)"], bad: ["이상", "bad", "var(--alarm)"] },
  /* 검사 구분: [이름, 좌우, 쉬운 물음, 판정 기준] — 가지에는 물음을, 아래 칸에는 판정 기준을 적어 '무엇을 보고 정상이라 했는지' 알 수 있게 한다 */
  AREAS: [["장비 통신", -1, "장비가 응답하나?", "설정 파일에 적힌 주소(경로 A · B)로 장비를 불러 두 경로 모두 답이 오면 정상. 한 경로만 답하면 주의, 둘 다 없으면 이상."],
    ["종류 · 대수", -1, "대수가 배치도와 맞나?", "응답한 장비의 대수가 개요 배치도의 그림 수와 같거나 많으면 정상. 그림이 더 많으면(예비 자리가 남으면) 주의."],
    ["환망 순서", -1, "분전함 자리 순서가 맞나?", "구간분전함 · 배전체계마다 읽은 ID 가 겹치지 않고, 빠짐없이, 자리 차례대로면 정상."],
    ["환망 A · B", 1, "양쪽에서 전기가 오나?", "급전 A · B 의 차단기가 닫혀 있고 그 모선에 전압이 있으며, 열린 구간이 설정한 상시 개방점 한 곳뿐이고, 구간분전함이 모두 급전되면 정상."],
    ["모선 구성", 1, "모선마다 전원이 있나?", "모선 A · B 마다 전압을 세우는 전원(이동형 ESS · 복합전력 ESS)이 있고, 장비마다의 차단기가 닫혀 있으면 정상."],
    ["부하 경로", 1, "부하에 가는 길이 있나?", "부하마다 물릴 구간분전함이 정해져 있고 필요한 대수의 배전체계가 붙어 있으며, 한 곳 고장에 끊기는 자리가 없으면 정상."]],
  sel: null, data: null,
  s() { return (S.snap && S.snap.init) || null; },
  /* 개요의 단추 글 */
  button() {
    const b = $("#initBtn"), i = this.s(); if (!b || !i) return;
    const t = !i.ran ? "설치 점검 · 미실시" : i.done ? "설치 점검 완료" : `설치 점검 · 남은 ${[i.bad ? "이상 " + i.bad : "", i.warn ? "주의 " + i.warn : ""].filter(Boolean).join(" · ")}`;
    if (b.textContent !== t) b.textContent = t; b.classList.toggle("stop", !!(i.ran && i.bad)); b.classList.toggle("pri", !i.ran || !!(i.ran && !i.done && !i.bad));
  },
  async get(q) {
    const h = S.token ? { "X-TPCS-Token": S.token } : {}, r = await fetch("/api/archive/initcheck" + (q || ""), { headers: h });
    let d = null; try { d = await r.json(); } catch (e) { d = null; }
    return r.ok && d && d.ok !== false ? d : { ok: false, why: (d && d.why) || "검사하지 못했습니다" };
  },
  async open() { const d = await this.get(); if (!d.ok) return toast(d.why, "bad"); this.sel = null; this.show(d); },
  async run(only, ack) {
    if (!can("operator")) { toast("설치 점검은 운용자 로그인이 필요합니다", "bad"); return loginDialog(); }
    const box = $("#icBody"); if (box) box.style.opacity = .45;
    const d = await this.get(ack ? "?ack=" + encodeURIComponent(ack) : "?run=1" + (only ? "&only=" + encodeURIComponent(only) : "")); if (!d.ok) { if (box) box.style.opacity = 1; return toast(d.why, "bad"); }
    const la = d.last; if (only || ack) this.sel = only || ack; else { this.sel = null; this.seq = true; }
    this.show(d); toast(la.done ? `검사 ${la.n}차: 이상 · 주의 없음 — 설치 점검 완료` : `검사 ${la.n}차: 이상 ${la.bad}건 · 주의 ${la.warn}건 — ! · ✕ 그림을 눌러 안내대로 고친 뒤 다시 검사하십시오`, la.done ? "ok" : la.bad ? "bad" : "warn"); poll();
  },
  worst(items) { return items.some(i => i.level === "bad") ? "bad" : items.some(i => i.level === "warn") ? "warn" : "ok"; },
  /* 설치 그림(사용자 요구 — 글보다 그림으로, 결선도를 따라가게): 결선도 그림을 그대로 쓰고 맨 위에 TPCS(통신)만 얹은 뒤, 그림마다 ✔ · ! · ✕ 표를 단다.
     위쪽 이름표 여섯 개가 검사 구분. 그림을 누르면 아래에 확인한 내용 · 고치는 방법이 나온다. 결선도를 따로 그리지 않는다(sld.js 의 sldSvg · sldUpdate 를 부른다) */
  badge(x, y, lv, r) { r = r || 11; const g = { ok: "M-5 0 L-1.5 4 L5.5 -4", warn: "M0 -5 L0 1.5 M0 4.6 L0 5", bad: "M-4 -4 L4 4 M4 -4 L-4 4" }[lv];
    return `<g transform="translate(${x} ${y}) scale(${r / 11})" class="ic-bd ${lv}"><circle r="11"/><path d="${g}"/></g>`; },
  badgeHtml(lv) { return `<svg width="18" height="18" viewBox="-12 -12 24 24" style="vertical-align:-4px">${this.badge(0, 0, lv)}</svg>`; },
  ICON: { "장비 통신": "M-8 4 a11 11 0 0 1 16 0 M-5 7 a7 7 0 0 1 10 0 M0 10 l0 .5", "종류 · 대수": "M-8 -6 h6 v6 h-6 z M2 -6 h6 v6 h-6 z M-8 3 h6 v6 h-6 z", "환망 순서": "M-9 0 h4 M-1 0 h4 M7 0 h3 M-7 -5 v10 M1 -5 v10", "환망 A · B": "M0 -8 a8 8 0 1 0 6 2.6 M3 -8 l4 4", "모선 구성": "M-9 -3 h18 M-9 4 h18 M-4 -3 v-6 M4 4 v6", "부하 경로": "M-8 8 v-9 l8 -7 l8 7 v9 z" },
  map(la) {
    const w = la.done ? "ok" : la.bad ? "bad" : "warn";
    const chips = this.AREAS.map(([a, , ask, rule]) => { const it = la.items.filter(i => i.area === a), lv = it.length ? this.worst(it) : "ok";
      return `<button class="ic-chip ${lv} ${this.sel === a ? "sel" : ""}" data-icarea="${esc(a)}" title="${esc(ask + " — " + rule)}"><svg width="22" height="22" viewBox="-12 -12 24 24"><path d="${this.ICON[a]}"/></svg>${esc(a)} ${this.badgeHtml(lv)}</button>`; }).join("");
    return `<div class="ic-top"><button class="ic-verdict ${w}" data-icall="1">${this.badgeHtml(w)} ${la.done ? "설치 완료" : la.bad ? `고칠 곳 ${la.bad}` + (la.warn ? ` · 확인할 곳 ${la.warn}` : "") : `확인할 곳 ${la.warn}`}</button>${chips}<span class="spacer"></span><span class="muted" style="font-size:12px">${la.n}차 · ${esc((la.t || "").slice(5, 16))} ${esc(la.by || "")}</span></div>
      <div class="ic-sld" id="icSld"></div>
      <div class="ic-leg"><span>${this.badgeHtml("ok")} 정상</span><span>${this.badgeHtml("warn")} 주의 — 확인 필요</span><span>${this.badgeHtml("bad")} 이상 — 고쳐야 함</span><span class="muted">결선도와 같은 그림입니다 · 표가 붙은 그림을 누르면 무엇을 확인했는지 · 어떻게 고치는지 나옵니다</span></div>`;
  },
  /* 결선도를 그리고 그 위에 검사 표를 얹는다 */
  paint(la) {
    const box = $("#icSld"); if (!box || typeof sldSvg !== "function" || !S.snap) return; const s = S.snap, rg = s.ring, TOP = 70, DY = 62;      // DY: 감춘 글자(값 · 상태) 자리만큼 장비 그림을 아래로 내려 차단기와의 빈 틈을 없앤다
    sldArrange(); box.innerHTML = sldSvg(); sldUpdate(s); const svg = box.querySelector("svg"); if (!svg) return;
    ["A", "B"].forEach(b => { const e = svg.querySelector("#bl" + b); if (e) e.textContent = "모선 " + b; });      // 이름만 남긴다(값 · 상태 글은 CSS 로 감춘다 — 사용자 요구: 장치 · 부하 이름만)
    box.classList.toggle("seq", !!this.seq); if (this.seq) { const top = $(".ic-top"); if (top) top.classList.add("seq"); } this.seq = false;      // 방금 전체 검사를 했으면 그림마다 차례로 표가 붙는 것을 보인다
    const H = +svg.getAttribute("viewBox").split(" ")[3], id = Object.fromEntries(la.items.map(i => [i.id, i])), used = new Set();
    const take = (...k) => k.filter(Boolean).map(q => id[q]).filter(Boolean).map(i => (used.add(i.id), i));
    let h = `<rect x="0" y="${-TOP}" width="1000" height="${H + TOP + 80}" fill="transparent"/>`, com = "";      // 아래의 결선도는 보기 전용(끌기 · 누르기를 막는다)
    let seq = 0; const hot = (it, x, y, wd, ht, bx, by, r) => { if (!it.length) return ""; const lv = this.worst(it), top = it.find(i => i.level === lv);
      return `<g class="ic-pk ${lv} ${this.sel === top.id ? "sel" : ""}" style="--i:${seq++}" data-ic="${esc(top.id)}" data-ics="${esc(it.map(i => i.id).join(" "))}"><title>${esc(it.map(i => `${i.name} — ${this.LV[i.level][0]}: ${i.text}`).join("\n"))}</title><rect x="${x}" y="${y}" width="${wd}" height="${ht}" rx="10"/>${this.badge(bx, by, lv, r || 10)}</g>`; };
    /* ① 전원 장비: 결선도의 그림 한 칸 = 장비 한 대. 통신 · 대수 · 차단기 검사가 그 칸에 걸린다(수전해는 같은 차량의 연료전지 칸) */
    const seen = {}, EX = 500, EY = -TOP + 50 + DY;
    SRC.forEach(n => { const k = n.k || 1, no = n.id.replace(/\D/g, ""), kd = n.kind || n.id, pcs = kd === "G1" ? "DG" + (n.id === "G1" ? "" : n.id.slice(3)) : "";
      const it = take(kd === "G1" ? "" : "comm." + n.id, "cb." + n.id, kd === "FC" && "comm.ELZ" + no, seen[kd] ? "" : "count." + kd, kd === "FC" && !seen[kd] && "count.ELZ").concat(pcs && id["comm." + pcs] ? [id["comm." + pcs]] : []); seen[kd] = 1;
      const x0 = n.x - SR * k * 1.18, y0 = SY - SR * k * .8 + DY, c = id["comm." + (pcs || n.id)], nd = svg.querySelector("#n-" + CSS.escape(n.id)); if (nd) nd.setAttribute("transform", `translate(0 ${DY})`);
      if (c) com += `<path class="ic-com ${c.level}" d="M${EX} ${EY + 6} C${EX} ${EY + 46}, ${n.x} ${y0 - 44}, ${n.x} ${y0 - 2}"/>`;
      h += hot(it, x0 - 3, y0 - 3, SR * k * 2.36 + 6, SR * k * 1.6 + 6, x0 + 6, y0 + 6, Math.max(6, 11 * k)); });
    /* TPCS · 계측 게이트웨이(맨 위) */
    const ems = typeof spriteSvg === "function" && spriteSvg("TPCS", { on: true }, EX, EY + 4, 84), mtr = take("comm.MTR", "count.MTR");
    h += com + `<defs>${SPRITE_FILTERS.replace(/id="sp/g, 'id="spIC')}</defs>${ems ? ems.replace(/url\(#sp/g, "url(#spIC") : ""}<text x="${EX + 52}" y="${EY - 22}" class="ic-nm">TPCS</text><text x="${EX + 52}" y="${EY - 8}" class="ic-st">점선 = 통신선</text>`;
    if (mtr.length) { const mx = EX - 150, sp = spriteSvg("MTR", { on: true, fault: this.worst(mtr) === "bad" }, mx, EY + 4, 62); h += `<path class="ic-com ${mtr[0].level}" d="M${EX - 44} ${EY - 16} H${mx + 34}"/>${sp ? sp.replace(/url\(#sp/g, "url(#spIC") : ""}<text x="${mx - 38}" y="${EY - 22}" text-anchor="end" class="ic-nm">계측 게이트웨이</text><text x="${mx - 38}" y="${EY - 8}" text-anchor="end" class="ic-st">배전 · 변압 안(차단기 · 모선 값)</text>` + hot(mtr, mx - 36, EY - 44, 72, 52, mx + 34, EY - 40, 9); }
    /* ⑤ 모선 A · B */
    [["A", 250], ["B", 760]].forEach(([b, x]) => { const it = la.items.filter(i => i.area === "모선 구성" && (i.id === "bus.ok" || i.id.startsWith("bus." + b))); it.forEach(i => used.add(i.id)); h += hot(it, x - 210, BUS_Y - 9, 420, 18, x, BUS_Y + 18, 8); });
    /* ③ ④ 환망 · ⑥ 부하 */
    if (rg && rg.fsu.length) { const n = rg.fsu.length, xs = k => RG.X0 + (RG.X1 - RG.X0) * (k + 1) / (n + 1), ym = (BUS_Y + RG.YR) / 2;
      h += hot(take("ring.feedA"), RG.X0 - 12, BUS_Y + 12, 100, ym - BUS_Y + 14, RG.X0 + 96, ym - 2, 8) + hot(take("ring.feedB"), RG.X1 - 88, BUS_Y + 12, 100, ym - BUS_Y + 14, RG.X1 - 96, ym - 2, 8);
      const op = rg.sections.find(x => x.state === 0) || rg.sections.find(x => x.open), nop = take("ring.nop");
      if (nop.length) { const i = op ? op.i : 0, [px, py] = i === 0 ? [RG.X0, ym + 16] : i === n ? [RG.X1, ym + 16] : [(xs(i - 1) + xs(i)) / 2, RG.YR]; h += hot(nop, px - 34, py - 44, 68, 58, px + 16, py - 14, 8); }
      const fr = take("ring.fed", "ring.order"); rg.fsu.forEach((f, k) => { h += hot(fr, xs(k) - 44, RG.YR - 32, 88, 48, xs(k) + 17, RG.YR - 13, 7); });
      svg.querySelectorAll(".sld-ld-drag[data-load]").forEach(e => { const x = +e.getAttribute("x"), y = +e.getAttribute("y"), wd = +e.getAttribute("width"), ht = +e.getAttribute("height"); h += hot(take("load." + e.dataset.load), x - 2, y - 2, wd + 4, ht + 4, x + wd - 5, y + 5, Math.max(6, Math.min(10, wd / 9))); }); }
    /* 그림에 자리가 없는 줄(무정전 점검, 연결할 곳 없는 부하 등): 정상이 아닌 것만 아래 이름표로 */
    const rest = la.items.filter(i => !used.has(i.id) && i.level !== "ok"); rest.forEach((i, k) => { const x = 30 + (k % 5) * 190, y = H - 40 + Math.floor(k / 5) * 26;
      h += `<g class="ic-pk ${i.level} ${this.sel === i.id ? "sel" : ""}" data-ic="${esc(i.id)}"><title>${esc(i.text)}</title><rect x="${x}" y="${y}" width="182" height="22" rx="8" class="lbl"/><text x="${x + 26}" y="${y + 15}" class="ic-nm">${esc(i.name.slice(0, 17))}</text>${this.badge(x + 13, y + 11, i.level, 8)}</g>`; });
    const ex = rest.length ? 12 + Math.ceil(rest.length / 5) * 26 : 0; svg.setAttribute("viewBox", `0 ${DY - TOP} 1000 ${H + TOP - DY + ex - 44}`); { const tp = $(".ic-top"); if (tp) tp.style.setProperty("--n", seq); } svg.classList.add("ic-map");
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.innerHTML = h; svg.appendChild(g); svg.onpointerdown = null;
    box.querySelectorAll("[data-ic]").forEach(e => { e.onclick = () => { this.sel = e.dataset.ic; this.show(this.data); }; });
  },
  /* 고른 마디의 내용: 판정 · 내용 · 고치는 방법 · 단추 */
  detail(la) {
    const i = la.items.find(q => q.id === this.sel), ar = this.AREAS.find(q => q[0] === this.sel);
    if (!i) {      // 마디를 고르지 않았으면: 여섯 가지 검사가 무엇을 봤고 결과가 어땠는지 한 표로(가지를 누르면 그 검사의 기준)
      if (!ar) return `<div class="ic-det ic-hint">${la.done ? "모든 그림에 ✔ 가 붙었습니다 — 설치가 설정 · 배치도와 맞습니다." : "! · ✕ 가 붙은 그림을 누르면 고치는 방법이 나옵니다 — 모두 ✔ 가 되어야 완료입니다."} <span class="muted">왼쪽 검사 이름을 누르면 그 검사의 판정 기준이 나옵니다.</span></div>`;
      const rows = this.AREAS.filter(q => !ar || q === ar).map(([a, , ask, rule], n) => { const it = la.items.filter(q => q.area === a), w = this.worst(it), nb = it.filter(q => q.level !== "ok").length;
        return `<tr><td><b>${"①②③④⑤⑥"[this.AREAS.findIndex(q => q[0] === a)]} ${esc(a)}</b><div class="muted">${esc(ask)}</div></td><td>${esc(rule)}</td><td><span class="pill ${this.LV[w][1]}">${it.length ? (w === "ok" ? `✔ ${it.length}건 모두 정상` : `${nb}건 확인 필요`) : "해당 없음"}</span><div class="muted" style="margin-top:3px">${esc(it.filter(q => q.level === "ok").slice(0, 3).map(q => q.name.replace(/^.*\) /, "") + ": " + q.short).join(" / "))}${it.length > 3 ? " …" : ""}</div></td></tr>`; }).join("");
      return `<div class="ic-det"><table class="t ic-sumt"><thead><tr><th style="width:17%">무엇을 검사했나</th><th style="width:45%">어떻게 판정하나</th><th>결과 — 확인한 사실</th></tr></thead><tbody>${rows}</tbody></table><div class="muted" style="margin-top:6px;font-size:12px">${la.done ? "모든 마디가 초록이면 설치가 설정 · 배치도와 맞는 것입니다." : "붉은 마디(이상)와 노란 마디(주의)를 누르면 고치는 방법이 나옵니다 — 모두 없애야 완료입니다."} 마디나 가지를 누르면 그 항목의 내용이 나옵니다.</div></div>`;
    }
    const [nm, cls] = this.LV[i.level], open = i.level !== "ok", rule = (this.AREAS.find(q => q[0] === i.area) || [])[3] || "";
    return `<div class="ic-det ${i.level}"><div class="ic-dh"><span class="pill ${cls}">${nm}</span>${i.was ? `<span class="pill ok">해결됨 — 직전 검사에서는 ${this.LV[i.was][0]}</span>` : ""}<b>${esc(i.name)}</b><span class="muted">${esc(i.area)}</span><span class="spacer"></span>
      ${open && i.fix ? `<button class="btn sm" data-icfix="${esc(i.id)}">${esc(i.fix.label)}</button>` : ""}${open && i.ack ? `<button class="btn sm" data-icack="${esc(i.id)}">${esc(i.ack)}</button>` : ""}${open ? `<button class="btn sm pri" data-icre="${esc(i.id)}">이 항목만 다시 검사</button>` : `<button class="btn sm" data-icall="1">전체 요약 보기</button>`}</div>
      <p><b>${open ? "확인한 것" : "✔ 확인한 사실"}:</b> ${esc(i.text)}</p><p class="muted"><b>판정 기준:</b> ${esc(rule)}</p>${open && i.guide.length ? `<p style="margin-top:8px"><b>고치는 방법</b></p><ol class="ic-guide">${i.guide.map(g => `<li>${esc(g)}</li>`).join("")}</ol>` : ""}</div>`;
  },
  show(d) {
    this.data = d; const la = d.last;
    if (la && !this.sel) { const f = la.items.find(i => i.level === "bad") || la.items.find(i => i.level === "warn"); this.sel = f ? f.id : "*"; }      // 처음에는 가장 급한 마디를 골라 둔다
    const hist = d.runs && d.runs.length > 1 ? `<details class="ic-hist"><summary>검사 이력 ${d.runs.length}회</summary><table class="t"><thead><tr><th>때</th><th>검사자</th><th class="n">이상</th><th class="n">주의</th><th>해결된 것</th><th>남은 이상</th></tr></thead><tbody>${d.runs.map(r => `<tr><td class="mono">${esc(r.t)}</td><td>${esc(r.by || "")}${r.only ? " (한 항목)" : ""}</td><td class="n">${r.bad}</td><td class="n">${r.warn}</td><td>${esc((r.fixed || []).join(", ") || "—")}</td><td>${esc((r.open || []).join(", ") || "—")}</td></tr>`).join("")}</tbody></table></details>` : "";
    const box = modal(`<h3>설치 점검(초기화)</h3>
      <p class="sub">결선도와 같은 그림에 검사 결과를 표로 붙였다(맨 위 = TPCS 와 통신선). 지금 읽히는 값으로 판정하며 TPCS 는 차단기를 조작하지 않는다.${d.sim ? " (가상 장치)" : ""}</p>
      <div id="icBody">${la ? this.map(la) + this.detail(la) : `<div class="ic-det muted" style="text-align:center;padding:38px 10px">아직 검사하지 않았습니다. 장비를 설치하고 전원 · 통신선을 이은 뒤 [검사 시작]을 누르십시오.<br>장비 통신 → 종류 · 대수 → 환망 순서 → 환망 A · B → 모선 구성 → 부하 경로 순으로 검사합니다.</div>`}${hist}</div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn pri" id="icRun">${la ? "전체 다시 검사" : "검사 시작"}</button><button class="btn" id="icClose">닫기</button></div>`);
    if (la) this.paint(la);
    box.classList.add("wide"); const close = () => { box.classList.remove("wide"); closeModal(); };
    box.querySelector("#icClose").onclick = close; box.querySelector("#icRun").onclick = () => this.run();
    box.querySelectorAll("[data-ic]").forEach(g => { g.onclick = () => { this.sel = g.dataset.ic; this.show(this.data); }; });
    box.querySelectorAll("[data-icarea]").forEach(g => { g.style.cursor = "pointer"; g.onclick = () => { this.sel = g.dataset.icarea; this.show(this.data); }; });
    box.querySelectorAll("[data-icall]").forEach(b => { b.onclick = () => { this.sel = "*"; this.show(this.data); }; });
    box.querySelectorAll("[data-icre]").forEach(b => { b.onclick = () => this.run(b.dataset.icre); });
    box.querySelectorAll("[data-icack]").forEach(b => { b.onclick = () => { if (confirm("이 항목을 '일부러 그런 것'으로 확인해 닫습니다. 기록에 남습니다. 계속합니까?")) this.run(null, b.dataset.icack); }; });
    box.querySelectorAll("[data-icfix]").forEach(b => { b.onclick = () => this.fix(la.items.find(i => i.id === b.dataset.icfix), close); });
  },
  /* 화면에서 바로 고칠 수 있는 것: 모선 구성 자동 보완, 그 밖에는 고치는 화면으로 간다 */
  async fix(i, close) {
    const f = i && i.fix; if (!f) return;
    if (f.act === "bus_auto") { if (!can("engineer")) { toast("모선 구성은 엔지니어 권한", "bad"); return loginDialog(); } const r = await api("/api/bus", { op: "auto" }); toast(r.ok ? r.msg : r.why, r.ok ? "ok" : "bad"); if (r.ok) { S.snap.bus = r.bus; this.run(i.id); } return; }
    close(); if (f.act === "busplan") return BusPlan.dialog(); if (f.act === "goto") location.hash = f.to;
  },
};
document.addEventListener("click", e => { const a = e.target.closest('[data-act="initcheck"]'); if (a) { e.preventDefault(); InitCheck.open(); } });
