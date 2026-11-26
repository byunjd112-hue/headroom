/* 설치 점검(초기화): 장비를 설치한 뒤 한 번에 검사 → 문제마다 고치는 방법 안내 → 고친 뒤 다시 검사해 '해결됨' 확인. 서버: hmi/initcheck.py (GET /api/archive/initcheck)
   개요의 [설치 점검] 단추가 연다. 단추에는 지금 상태(미실시 · 남은 이상 · 주의 · 완료)가 보인다(스냅샷의 init).
   창은 생각그물(마인드맵)이다: 가운데 = 전체 판정, 가지 여섯 = 검사 구분, 가지 끝의 마디 = 장비 · 부하 하나하나(그 그림과 색 점). 마디를 누르면 아래에 내용과 고치는 방법이 나온다. */
"use strict";
const InitCheck = {
  LV: { ok: ["정상", "ok", "var(--ok)"], warn: ["주의", "warn", "var(--warn)"], bad: ["이상", "bad", "var(--alarm)"] },
  AREAS: [["장비 통신", -1, "설정된 주소로 응답하는가"], ["종류 · 대수", -1, "배치도와 맞는가"], ["환망 순서", -1, "ID 로 본 자리 순서"], ["환망 A · B", 1, "급전 · 상시 개방점"], ["모선 구성", 1, "전원 · 차단기"], ["부하 경로", 1, "분전함 · 배전체계"]],
  sel: null, data: null,
  s() { return (S.snap && S.snap.init) || null; },
  /* 개요의 단추 글 */
  button() {
    const b = $("#initBtn"), i = this.s(); if (!b || !i) return;
    const t = !i.ran ? "설치 점검 · 미실시" : i.done ? "설치 점검 완료" : `설치 점검 · 남은 ${[i.bad ? "이상 " + i.bad : "", i.warn ? "주의 " + i.warn : ""].filter(Boolean).join(" · ")}`;
    if (b.textContent !== t) b.textContent = t; b.classList.toggle("stop", !!(i.ran && i.bad)); b.classList.toggle("pri", !i.ran || !!(i.ran && !i.done && !i.bad));
  },
  async get(q) {
    const h = S.token ? { "X-EMS-Token": S.token } : {}, r = await fetch("/api/archive/initcheck" + (q || ""), { headers: h });
    let d = null; try { d = await r.json(); } catch (e) { d = null; }
    return r.ok && d && d.ok !== false ? d : { ok: false, why: (d && d.why) || "검사하지 못했습니다" };
  },
  async open() { const d = await this.get(); if (!d.ok) return toast(d.why, "bad"); this.sel = null; this.show(d); },
  async run(only, ack) {
    if (!can("operator")) { toast("설치 점검은 운용자 로그인이 필요합니다", "bad"); return loginDialog(); }
    const box = $("#icBody"); if (box) box.style.opacity = .45;
    const d = await this.get(ack ? "?ack=" + encodeURIComponent(ack) : "?run=1" + (only ? "&only=" + encodeURIComponent(only) : "")); if (!d.ok) { if (box) box.style.opacity = 1; return toast(d.why, "bad"); }
    const la = d.last; if (only || ack) this.sel = only || ack; else this.sel = null;
    this.show(d); toast(la.done ? `검사 ${la.n}차: 이상 · 주의 없음 — 설치 점검 완료` : `검사 ${la.n}차: 이상 ${la.bad}건 · 주의 ${la.warn}건 — 붉은 · 노란 마디를 눌러 안내대로 고친 뒤 다시 검사하십시오`, la.done ? "ok" : la.bad ? "bad" : "warn"); poll();
  },
  worst(items) { return items.some(i => i.level === "bad") ? "bad" : items.some(i => i.level === "warn") ? "warn" : "ok"; },
  /* 생각그물: 가운데(전체) → 가지(구분) → 마디(장비 · 부하). 마디가 많으면 두 줄로 늘어놓고 그림 높이가 따라 늘어난다 */
  map(la) {
    const W = 1410, CX = W / 2, BX = 205, LW = 190, LH = 36, items = la.items, col = l => this.LV[l][2];
    const grp = this.AREAS.map(([a, side, sub]) => { const it = items.filter(i => i.area === a), cols = it.length > 5 ? 2 : 1, rows = Math.ceil(it.length / cols); return { a, side, sub, it, cols, rows, h: Math.max(64, rows * (LH + 6) + 10) }; });
    const yy = { "-1": 16, 1: 16 }; grp.forEach(g => { g.y = yy[g.side]; yy[g.side] += g.h + 18; }); const H = Math.max(yy[-1], yy[1], 330) + 4, CY = H / 2;
    let h = `<defs>${typeof SPRITE_FILTERS === "string" ? SPRITE_FILTERS.replace(/id="sp/g, 'id="spIC') : ""}</defs>`;
    grp.forEach(g => { const bx = CX + g.side * BX, by = g.y + g.h / 2, w = this.worst(g.it), nok = g.it.filter(i => i.level === "ok").length;
      h += `<path class="ic-ln ${w}" d="M${CX + g.side * 84} ${CY} C${CX + g.side * 150} ${CY}, ${bx - g.side * 130} ${by}, ${bx - g.side * 74} ${by}"/>`;
      g.it.forEach((i, k) => { const c = Math.floor(k / g.rows), r = k % g.rows, lx = bx + g.side * (74 + 26 + c * (LW + 8)) + (g.side < 0 ? -LW : 0), ly = g.y + (g.h - g.rows * (LH + 6) + 6) / 2 + r * (LH + 6), jx = g.side < 0 ? lx + LW : lx;
        const pk = { ELZ: "FC" }[i.pic] || i.pic, sm = typeof SPR_KEY !== "undefined" && S.sprites && S.sprites[SPR_KEY[pk]], pw = sm ? Math.min(32, (LH - 8) * sm.w / sm.h) : 32;      // 그림은 마디 상자 안에 들어가게(세로로 긴 그림은 폭을 줄인다)
        const pic = typeof spriteSvg === "function" ? spriteSvg(pk, { on: i.level === "ok", fault: i.level === "bad" }, lx + 21, ly + LH - 4, pw) : null, nm = i.name.replace(/^기동형 복합전력\(디젤 · PCS\)/, "복합전력").replace(/^계측 · 보호 게이트웨이\(배전 · 변압\)/, "게이트웨이").replace(/ 차단기\(CB-.*\)$/, " 차단기").replace(/^(급전 [AB])\(.*\)$/, "$1").replace("구간분전함 · 배전체계 ID", "분전함 · 배전체계 ID");
        h += `<path class="ic-ln ${i.level}" d="M${bx + g.side * 74} ${by} C${bx + g.side * 92} ${by}, ${jx - g.side * 14} ${ly + LH / 2}, ${jx} ${ly + LH / 2}"/>
          <g class="ic-leaf ${i.level} ${this.sel === i.id ? "sel" : ""}" data-ic="${esc(i.id)}"><title>${esc(i.name)} — ${this.LV[i.level][0]}: ${esc(i.text)}</title><rect x="${lx}" y="${ly}" width="${LW}" height="${LH}" rx="9"/>
          ${pic ? pic.replace(/url\(#sp/g, "url(#spIC") : `<circle cx="${lx + 20}" cy="${ly + LH / 2}" r="9" fill="none" stroke="${col(i.level)}"/>`}
          <text x="${lx + 44}" y="${ly + 15}" class="ic-nm">${esc(nm.length > 15 ? nm.slice(0, 14) + "…" : nm)}</text><text x="${lx + 44}" y="${ly + 28}" class="ic-st" fill="${col(i.level)}">${i.was ? "해결됨" : i.acked ? "확인함" : this.LV[i.level][0]}</text>
          <circle cx="${lx + LW - 12}" cy="${ly + LH / 2}" r="5" fill="${col(i.level)}" class="ic-dot"/></g>`; });
      h += `<g class="ic-br ${w}"><rect x="${bx - 74}" y="${by - 25}" width="148" height="50" rx="14"/><text x="${bx}" y="${by - 5}" text-anchor="middle" class="ic-bn">${esc(g.a)}</text>
        <text x="${bx}" y="${by + 12}" text-anchor="middle" class="ic-bs">${g.it.length ? (w === "ok" ? `정상 ${nok}` : [g.it.filter(i => i.level === "bad").length ? "이상 " + g.it.filter(i => i.level === "bad").length : "", g.it.filter(i => i.level === "warn").length ? "주의 " + g.it.filter(i => i.level === "warn").length : "", nok ? "정상 " + nok : ""].filter(Boolean).join(" · ")) : "해당 없음"}</text></g>`; });
    const w = la.done ? "ok" : la.bad ? "bad" : "warn";
    h += `<g class="ic-core ${w}"><circle cx="${CX}" cy="${CY}" r="84"/><circle cx="${CX}" cy="${CY}" r="72" class="in"/><text x="${CX}" y="${CY - 26}" text-anchor="middle" class="ic-ct">설치 점검 ${la.n}차</text>
      <text x="${CX}" y="${CY + 6}" text-anchor="middle" class="ic-cv">${la.done ? "완료" : la.bad ? "이상 " + la.bad : "주의 " + la.warn}</text><text x="${CX}" y="${CY + 28}" text-anchor="middle" class="ic-cs">${la.done ? "이상 · 주의 없음" : `이상 ${la.bad} · 주의 ${la.warn} · 정상 ${items.filter(i => i.level === "ok").length}`}</text>
      <text x="${CX}" y="${CY + 46}" text-anchor="middle" class="ic-cs">${esc((la.t || "").slice(5, 16))} ${esc(la.by || "")}</text></g>`;
    return `<svg class="ic-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${h}</svg>`;
  },
  /* 고른 마디의 내용: 판정 · 내용 · 고치는 방법 · 단추 */
  detail(la) {
    const i = la.items.find(q => q.id === this.sel); if (!i) return `<div class="ic-det muted">마디를 누르면 내용과 고치는 방법이 여기에 나옵니다. 붉은 마디(이상)와 노란 마디(주의)를 모두 없애야 완료입니다.</div>`;
    const [nm, cls] = this.LV[i.level], open = i.level !== "ok";
    return `<div class="ic-det ${i.level}"><div class="ic-dh"><span class="pill ${cls}">${nm}</span>${i.was ? `<span class="pill ok">해결됨 — 직전 검사에서는 ${this.LV[i.was][0]}</span>` : ""}<b>${esc(i.name)}</b><span class="muted">${esc(i.area)}</span><span class="spacer"></span>
      ${open && i.fix ? `<button class="btn sm" data-icfix="${esc(i.id)}">${esc(i.fix.label)}</button>` : ""}${open && i.ack ? `<button class="btn sm" data-icack="${esc(i.id)}">${esc(i.ack)}</button>` : ""}${open ? `<button class="btn sm pri" data-icre="${esc(i.id)}">이 항목만 다시 검사</button>` : ""}</div>
      <p>${esc(i.text)}</p>${open && i.guide.length ? `<ol class="ic-guide">${i.guide.map(g => `<li>${esc(g)}</li>`).join("")}</ol>` : ""}</div>`;
  },
  show(d) {
    this.data = d; const la = d.last;
    if (la && (!this.sel || !la.items.some(i => i.id === this.sel))) { const f = la.items.find(i => i.level === "bad") || la.items.find(i => i.level === "warn"); this.sel = f ? f.id : null; }      // 처음에는 가장 급한 마디를 골라 둔다
    const hist = d.runs && d.runs.length > 1 ? `<details class="ic-hist"><summary>검사 이력 ${d.runs.length}회</summary><table class="t"><thead><tr><th>때</th><th>검사자</th><th class="n">이상</th><th class="n">주의</th><th>해결된 것</th><th>남은 이상</th></tr></thead><tbody>${d.runs.map(r => `<tr><td class="mono">${esc(r.t)}</td><td>${esc(r.by || "")}${r.only ? " (한 항목)" : ""}</td><td class="n">${r.bad}</td><td class="n">${r.warn}</td><td>${esc((r.fixed || []).join(", ") || "—")}</td><td>${esc((r.open || []).join(", ") || "—")}</td></tr>`).join("")}</tbody></table></details>` : "";
    const box = modal(`<h3>설치 점검(초기화)</h3>
      <p class="sub">장비를 설치한 뒤 한 번에 검사한다 — 가운데가 전체 판정, 가지가 검사 구분, 가지 끝의 마디가 장비 · 부하 하나하나다(<span class="okc">초록 정상</span> · <span class="warnc">노랑 주의</span> · <span class="badc">빨강 이상</span>). 지금 읽히는 값으로 판정하며 EMS 는 차단기를 조작하지 않는다.${d.sim ? " (가상 장치)" : ""}</p>
      <div id="icBody">${la ? this.map(la) + this.detail(la) : `<div class="ic-det muted" style="text-align:center;padding:38px 10px">아직 검사하지 않았습니다. 장비를 설치하고 전원 · 통신선을 이은 뒤 [검사 시작]을 누르십시오.<br>장비 통신 → 종류 · 대수 → 환망 순서 → 환망 A · B → 모선 구성 → 부하 경로 순으로 검사합니다.</div>`}${hist}</div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn pri" id="icRun">${la ? "전체 다시 검사" : "검사 시작"}</button><button class="btn" id="icClose">닫기</button></div>`);
    box.classList.add("wide"); const close = () => { box.classList.remove("wide"); closeModal(); };
    box.querySelector("#icClose").onclick = close; box.querySelector("#icRun").onclick = () => this.run();
    box.querySelectorAll("[data-ic]").forEach(g => { g.onclick = () => { this.sel = g.dataset.ic; this.show(this.data); }; });
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
