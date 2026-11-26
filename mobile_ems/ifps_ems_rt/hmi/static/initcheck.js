/* 설치 점검(초기화): 장비를 설치한 뒤 한 번에 검사 → 문제마다 고치는 방법 안내 → 고친 뒤 다시 검사해 '해결됨' 확인. 서버: hmi/initcheck.py (GET /api/archive/initcheck)
   개요의 [설치 점검] 단추가 연다. 단추에는 지금 상태(미실시 · 남은 이상 · 주의 · 완료)가 보인다(스냅샷의 init).
   창은 설치 그림이다: EMS → 장비 → 모선 → 환망 → 부하를 놓인 대로 그리고 그림마다 ✔ · ! · ✕ 를 단다. 그림을 누르면 아래에 내용과 고치는 방법이 나온다. */
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
    this.show(d); toast(la.done ? `검사 ${la.n}차: 이상 · 주의 없음 — 설치 점검 완료` : `검사 ${la.n}차: 이상 ${la.bad}건 · 주의 ${la.warn}건 — ! · ✕ 그림을 눌러 안내대로 고친 뒤 다시 검사하십시오`, la.done ? "ok" : la.bad ? "bad" : "warn"); poll();
  },
  worst(items) { return items.some(i => i.level === "bad") ? "bad" : items.some(i => i.level === "warn") ? "warn" : "ok"; },
  /* 설치 그림(사용자 요구 — 글보다 그림으로): 실제 놓인 모양대로 EMS → 장비 → 모선 A · B → 환망(구간분전함) → 부하를 그리고, 그림마다 ✔ · ! · ✕ 표를 단다.
     왼쪽의 이름표가 검사 여섯 가지(그 줄의 그림이 그 검사의 결과). 그림을 누르면 아래에 확인한 내용 · 고치는 방법이 나온다 */
  badge(x, y, lv, r) { r = r || 11; const g = { ok: "M-5 0 L-1.5 4 L5.5 -4", warn: "M0 -5 L0 1.5 M0 4.6 L0 5", bad: "M-4 -4 L4 4 M4 -4 L-4 4" }[lv];
    return `<g transform="translate(${x} ${y}) scale(${r / 11})" class="ic-bd ${lv}"><circle r="11"/><path d="${g}"/></g>`; },
  pk(it, x, by, w, kind, nm, opt) {      // 그림 하나: it = 그 그림에 걸린 검사 줄들(가장 나쁜 것이 표시 · 누르면 그 줄)
    opt = opt || {}; const lv = it.length ? this.worst(it) : "ok", top = it.find(i => i.level === lv) || it[0], k = { ELZ: "FC" }[kind] || kind;
    const sm = typeof SPR_KEY !== "undefined" && S.sprites && S.sprites[SPR_KEY[k]], hh = sm ? w * sm.h / sm.w : w * .6, mh = opt.mh || 70, ww = hh > mh ? w * mh / hh : w, h = Math.min(hh, mh);
    const sp = typeof spriteSvg === "function" ? spriteSvg(k, { on: lv !== "warn" || !opt.dim ? true : false, fault: lv === "bad" }, x, by, ww) : null;
    return `<g class="ic-pk ${lv} ${top && this.sel === top.id ? "sel" : ""}" ${top ? `data-ic="${esc(top.id)}"` : ""}><title>${esc(it.map(i => `${i.name} — ${this.LV[i.level][0]}: ${i.text}`).join("\n"))}</title>
      <rect x="${x - ww / 2 - 6}" y="${by - h - 6}" width="${ww + 12}" height="${h + 24}" rx="9"/>${sp ? sp.replace(/url\(#sp/g, "url(#spIC") : `<rect x="${x - 18}" y="${by - 30}" width="36" height="28" rx="5" class="ic-ph"/>`}
      <text x="${x}" y="${by + 13}" text-anchor="middle" class="ic-nm">${esc(nm)}</text>${this.badge(x + ww / 2 + 1, by - h - 1, lv, opt.r || 11)}</g>`; },
  short(n) { n = n.replace(/^기동형 복합전력\(디젤 · PCS\)/, "복합전력").replace(/^계측 · 보호 게이트웨이\(배전 · 변압\)/, "게이트웨이").replace(/\(.*\)$/, "").replace(/^이동형 /, "").replace(/^수소 /, "").replace(/^주둔지 /, "주둔지").trim(); return n.length > 9 ? n.slice(0, 8) + "…" : n; },
  map(la) {
    const W = 1410, X0 = 176, X1 = 1392, items = la.items, id = Object.fromEntries(items.map(i => [i.id, i])), used = new Set(), col = l => this.LV[l][2];
    const take = (...k) => k.map(q => id[q]).filter(Boolean).map(i => (used.add(i.id), i)), sn = S.snap || {}, rg = sn.ring, src = (sn.bus && sn.bus.sources) || [];
    const yD = 196, yBus = 252, yR = 372, yL = 498, H = 548;
    let h = `<defs>${typeof SPRITE_FILTERS === "string" ? SPRITE_FILTERS.replace(/id="sp/g, 'id="spIC') : ""}</defs>`, top = "";
    /* ① 장비: 통신 줄마다 그림 하나(모선 A 쪽 → 모선 없는 것 → 모선 B 쪽) */
    const seenK = {}, dev = items.filter(i => i.area === "장비 통신").map(i => { const x = i.id.slice(5), s = src.find(q => q.id === x), kd = i.pic, g1 = x === "DG" ? "G1" : /^DG\d/.test(x) ? "G1_" + x.slice(2) : "";
      const it = take(i.id, "cb." + x, g1 && "cb." + g1).concat(seenK[kd] ? [] : take("count." + kd)); seenK[kd] = 1; const mate = /^ELZ/.test(x) ? src.find(q => q.id === "FC" + x.slice(3)) : null;      // 수전해는 같은 차량 연료전지의 모선에서 받는다
      return { x, kd, bus: mate ? mate.bus : s && s.present !== false ? s.bus : "", it, why: mate ? "" : s && s.present === false ? "여기선 안 씀" : !s ? "계측 전용" : "", nm: this.short(i.name.replace(new RegExp(" " + x + "$"), "")) + (/\d$/.test(x) ? " " + x.replace(/\D/g, "") : "") }; });
    dev.sort((a, b) => ({ A: 0, "": 1, B: 2 }[a.bus] - { A: 0, "": 1, B: 2 }[b.bus]));
    const n = Math.max(dev.length, 1), step = (X1 - X0 - 120) / n, pw = Math.min(92, step * .74); dev.forEach((d, k) => { d.cx = X0 + 60 + step * (k + .5); });
    const A = dev.filter(d => d.bus === "A"), B = dev.filter(d => d.bus === "B"), aR = Math.max(A.length ? A[A.length - 1].cx + 46 : 0, X0 + 90), bL = Math.min(B.length ? B[0].cx - 46 : W, X1 - 90), EX = (X0 + X1) / 2;
    dev.forEach(d => { const c = id["comm." + d.x], lv = c ? c.level : "ok";
      h += `<path class="ic-com ${lv}" d="M${EX} 62 C${EX} 96, ${d.cx} 84, ${d.cx} ${yD - 76}"/>`;
      if (d.bus) { const cb = d.it.find(i => i.id.startsWith("cb.")); h += `<path class="ic-pw ${cb ? cb.level : "ok"}" d="M${d.cx} ${yD + 20} V${yBus}"/>${cb ? `<path class="ic-open" d="M${d.cx - 7} ${yD + 40} l14 -10"/>` : ""}`; }
      top += this.pk(d.it, d.cx, yD, pw, d.kd, d.nm) + (d.bus ? "" : `<text x="${d.cx}" y="${yD + 27}" text-anchor="middle" class="ic-st">${d.why || "전력선 없음"}</text><text x="${d.cx}" y="${yD + 40}" text-anchor="middle" class="ic-st">모선 연결 없음</text>`); });
    h += `<g class="ic-ems">${typeof spriteSvg === "function" && spriteSvg("EMS", { on: true }, EX, 62, 74) || ""}<text x="${EX + 46}" y="40" class="ic-nm">EMS</text><text x="${EX + 46}" y="54" class="ic-st">점선 = 통신</text></g>`;
    /* ⑤ 모선 A · B */
    const bi = b => { const t = items.filter(i => i.area === "모선 구성" && (i.id === "bus.ok" || i.id.startsWith("bus." + b))); t.forEach(i => used.add(i.id)); return t; };
    [["A", X0 + 8, aR, bi("A")], ["B", bL, X1 - 8, bi("B")]].forEach(([b, x0, x1, it]) => { const lv = it.length ? this.worst(it) : "ok", t = it.find(i => i.level === lv);
      h += `<g class="ic-bus ${lv} ${t && this.sel === t.id ? "sel" : ""}" ${t ? `data-ic="${esc(t.id)}"` : ""}><title>${esc(it.map(i => i.text).join("\n"))}</title><rect x="${x0}" y="${yBus - 6}" width="${x1 - x0}" height="12" rx="4"/><text x="${b === "A" ? x0 + 8 : x1 - 8}" y="${yBus - 12}" text-anchor="${b === "A" ? "start" : "end"}" class="ic-nm">모선 ${b}</text>${this.badge(b === "A" ? x0 + 70 : x1 - 70, yBus - 16, lv, 9)}</g>`; });
    h += `<path class="ic-tie" d="M${aR} ${yBus} H${bL}"/>`;
    /* ③ ④ 환망: 급전 A → 구간분전함 1 … n → 급전 B (열린 구간 = 상시 개방점) */
    if (rg && rg.fsu.length) {
      const F = rg.fsu, m = F.length, fx = k => X0 + 110 + (X1 - X0 - 220) * (m > 1 ? k / (m - 1) : .5), xa = X0 + 24, xb = X1 - 24, yy = yR - 26;
      const fa = take("ring.feedA"), fb = take("ring.feedB"), nop = take("ring.nop"), fed = take("ring.fed"), ord = take("ring.order"), st = k => (rg.sections[k] || {}).state;
      const seg = (k, d, mx, my) => { const s = st(k), cls = s === 0 ? "open" : s === 2 ? "bad" : "ok";
        h += `<path class="ic-rg ${cls}" d="${d}"/>`; if (s === 0) h += `<g class="ic-nop ${nop[0] ? nop[0].level : "ok"} ${nop[0] && this.sel === "ring.nop" ? "sel" : ""}" data-ic="ring.nop"><title>${esc(nop[0] ? nop[0].text : "")}</title><circle cx="${mx}" cy="${my}" r="15"/><path d="M${mx - 8} ${my + 5} l16 -10"/><text x="${mx}" y="${my + 30}" text-anchor="middle" class="ic-st">열어 둔 곳</text>${nop[0] ? this.badge(mx + 15, my - 14, nop[0].level, 8) : ""}</g>`; };
      seg(0, `M${xa} ${yBus + 6} V${yy} H${fx(0)}`, xa, (yBus + yy) / 2 + 6); for (let k = 1; k < m; k++) seg(k, `M${fx(k - 1)} ${yy} H${fx(k)}`, (fx(k - 1) + fx(k)) / 2, yy); seg(m, `M${fx(m - 1)} ${yy} H${xb} V${yBus + 6}`, xb, (yBus + yy) / 2 + 6);
      [[fa, xa, "급전 A"], [fb, xb, "급전 B"]].forEach(([it, x, nm]) => { if (it[0]) h += `<g class="ic-pk ${it[0].level} ${this.sel === it[0].id ? "sel" : ""}" data-ic="${esc(it[0].id)}"><title>${esc(it[0].text)}</title><rect x="${x - 30}" y="${yBus + 12}" width="60" height="22" rx="8" class="lbl"/><text x="${x - 6}" y="${yBus + 27}" text-anchor="middle" class="ic-nm">${nm}</text>${this.badge(x + 20, yBus + 23, it[0].level, 7)}</g>`; });
      const lds = (sn.loads && sn.loads.items) || [], fw = Math.min(64, (X1 - X0 - 220) / m * .5);
      F.forEach((f, k) => { const x = fx(k), mine = lds.filter(q => q.fsu === f.id), dead = f.live === false, o = ord[0] ? ord[0].level : "ok";
        mine.forEach((q, j) => { const lw = Math.min(70, (X1 - X0 - 220) / m * .86 / mine.length), lx = x + (j - (mine.length - 1) / 2) * (lw + 10), it = take("load." + q.id);
          h += `<path class="ic-pw ${it[0] ? it[0].level : "ok"}" d="M${x} ${yR + 18} C${x} ${yL - 70}, ${lx} ${yR + 30}, ${lx} ${yL - 56}"/>`; top += this.pk(it, lx, yL, lw, q.spr, this.short(q.name) + (q.n > 1 ? " ×" + q.n : ""), { mh: 52, r: 9 }); });
        top += this.pk(dead ? fed : fed.filter(i => i.level === "ok"), x, yR, fw, "FSU", "", { mh: 56, r: 9 }).replace('class="ic-nm"></text>', `class="ic-nm">${esc(f.name.replace("구간분전함 ", "분전함 "))}</text>`);
        top += `<g class="ic-no ${o} ${ord[0] && this.sel === "ring.order" ? "sel" : ""}" data-ic="ring.order"><title>${esc(ord[0] ? ord[0].text : "")}</title><circle cx="${x - fw / 2 - 12}" cy="${yR - 50}" r="10"/><text x="${x - fw / 2 - 12}" y="${yR - 46}" text-anchor="middle">${k + 1}</text></g>`; });
      const lost = lds.filter(q => !q.fsu); lost.forEach((q, j) => { top += this.pk(take("load." + q.id), X1 - 40 - j * 80, yL, 60, q.spr, this.short(q.name), { mh: 52, r: 9 }); });
    }
    /* 왼쪽 이름표 = 검사 여섯 가지(그 줄의 그림이 그 검사) */
    const ICON = { "장비 통신": "M-8 4 a11 11 0 0 1 16 0 M-5 7 a7 7 0 0 1 10 0 M0 10 l0 .5", "종류 · 대수": "M-8 -6 h6 v6 h-6 z M2 -6 h6 v6 h-6 z M-8 3 h6 v6 h-6 z", "환망 순서": "M-9 0 h4 M-1 0 h4 M7 0 h3 M-7 -5 v10 M1 -5 v10", "환망 A · B": "M0 -8 a8 8 0 1 0 6 2.6 M3 -8 l4 4", "모선 구성": "M-9 -3 h18 M-9 4 h18 M-4 -3 v-6 M4 4 v6", "부하 경로": "M-8 8 v-9 l8 -7 l8 7 v9 z" };
    [["장비 통신", 150], ["종류 · 대수", 196], ["모선 구성", yBus], ["환망 순서", yR - 50], ["환망 A · B", yR - 4], ["부하 경로", yL - 20]].forEach(([a, y]) => { const it = items.filter(i => i.area === a), lv = it.length ? this.worst(it) : "ok";
      h += `<g class="ic-lab ${lv} ${this.sel === a ? "sel" : ""}" data-icarea="${esc(a)}"><title>${esc(this.AREAS.find(q => q[0] === a)[3])}</title><rect x="6" y="${y - 19}" width="150" height="38" rx="10"/><path transform="translate(26 ${y})" d="${ICON[a]}" class="ico"/><text x="46" y="${y + 4}" class="ic-nm">${esc(a)}</text>${this.badge(140, y, lv, 9)}</g>`; });
    /* 전체 판정 */
    const w = la.done ? "ok" : la.bad ? "bad" : "warn";
    h += `<g class="ic-core ${w}" data-icall="1"><circle cx="80" cy="62" r="50"/>${la.done ? `<path d="M56 62 l17 18 l32 -36" class="big"/>` : `<text x="80" y="76" text-anchor="middle" class="ic-cv">${la.bad || la.warn}</text>`}<text x="80" y="${la.done ? 100 : 96}" text-anchor="middle" class="ic-cs">${la.done ? "설치 완료" : la.bad ? "고칠 곳" : "확인할 곳"}</text></g>
      <text x="${W - 14}" y="24" text-anchor="end" class="ic-st">${la.n}차 검사 · ${esc((la.t || "").slice(5, 16))} ${esc(la.by || "")}</text>`;
    /* 그림에 자리가 없는 줄(무정전 점검 등): 정상이 아닌 것만 아래에 표로 */
    const rest = items.filter(i => !used.has(i.id) && i.level !== "ok"); rest.forEach((i, k) => { const x = X0 + 10 + k * 190;
      top += `<g class="ic-pk ${i.level} ${this.sel === i.id ? "sel" : ""}" data-ic="${esc(i.id)}"><title>${esc(i.text)}</title><rect x="${x}" y="${H - 30}" width="180" height="24" rx="8" class="lbl"/><text x="${x + 26}" y="${H - 14}" class="ic-nm">${esc(i.name.slice(0, 16))}</text>${this.badge(x + 13, H - 18, i.level, 8)}</g>`; });
    return `<svg class="ic-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${h}${top}</svg>
      <div class="ic-leg"><span>${this.badgeHtml("ok")} 정상</span><span>${this.badgeHtml("warn")} 주의 — 확인 필요</span><span>${this.badgeHtml("bad")} 이상 — 고쳐야 함</span><span class="muted">그림을 누르면 무엇을 확인했는지 · 어떻게 고치는지 나옵니다</span></div>`;
  },
  badgeHtml(lv) { return `<svg width="18" height="18" viewBox="-12 -12 24 24" style="vertical-align:-4px">${this.badge(0, 0, lv)}</svg>`; },
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
      <p class="sub">설치한 모양 그대로 그린 그림이다 — 그림마다 붙은 표가 검사 결과다. 지금 읽히는 값으로 판정하며 EMS 는 차단기를 조작하지 않는다.${d.sim ? " (가상 장치)" : ""}</p>
      <div id="icBody">${la ? this.map(la) + this.detail(la) : `<div class="ic-det muted" style="text-align:center;padding:38px 10px">아직 검사하지 않았습니다. 장비를 설치하고 전원 · 통신선을 이은 뒤 [검사 시작]을 누르십시오.<br>장비 통신 → 종류 · 대수 → 환망 순서 → 환망 A · B → 모선 구성 → 부하 경로 순으로 검사합니다.</div>`}${hist}</div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn pri" id="icRun">${la ? "전체 다시 검사" : "검사 시작"}</button><button class="btn" id="icClose">닫기</button></div>`);
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
