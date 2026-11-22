"use strict";
/* 환망 화면: 구간분전함(FSU)과 휴대용 배전체계(PPDU)의 실시간 상태. 장치를 어느 자리에 몇 대 놓든 자리마다 읽은 ID 로 배치를 스스로 알아내 화면을 구성한다(조작 없음). 현장에서 고르는 것은 회로별 시설·부하 등급뿐.
   그림(RingView.svg)은 운영 시나리오의 구성도 아래에서도 같이 쓴다. */
const RingView = {
  LOAD: { L1: "1등급", L2: "2등급", L3: "3등급", "": "미지정" },
  /* m: {sections: [{i, state, open, brk}], fsu: [{id, name, live, id_ok}], ppdu: [{id, name, at, load, vital, live}]} — 값이 없으면 null(회색) */
  svg(m, o = {}) {
    const n = m.fsu.length, W = 1500, H = 250, x0 = 70, x1 = W - 70, gap = (x1 - x0) / (n + 1), xs = i => x0 + gap * i, y = 96;
    const seg = m.sections.map(s => { const a = xs(s.i), b = xs(s.i + 1), mid = (a + b) / 2, c = s.state == null ? "na" : s.brk ? "brk" : s.state === 2 ? "trip" : s.state === 0 ? "open" : "on";
      const txt = s.state == null ? "값 없음" : (s.brk ? "단선 · " : "") + (s.state === 2 ? "차단" : s.state === 0 ? "개방" : s.brk ? "미차단" : "투입");
      return `<g class="rv-sec" data-sec="${s.i}"><line class="rg-l ${c}" x1="${a + 20}" y1="${y}" x2="${b - 20}" y2="${y}"/><rect class="rg-cb ${c}" x="${mid - 10}" y="${y - 10}" width="20" height="20" rx="3"/>
        <text class="rg-t" x="${mid}" y="${y - 22}" text-anchor="middle">구간 ${s.i}${s.open ? " · 상시 개방점" : ""}</text><text class="rg-s ${c}" x="${mid}" y="${y + 28}" text-anchor="middle">${txt}</text></g>`; }).join("");
    const nodes = m.fsu.map((f, k) => { const c = f.live == null ? "na" : f.live ? "on" : "off", X = xs(k + 1), pp = m.ppdu.filter(p => p.at === f.id);
      return `<g class="rv-fsu" data-unit="${esc(f.id)}"><circle class="rg-n ${c}" cx="${X}" cy="${y}" r="19"/><text class="rg-nt" x="${X}" y="${y + 4}" text-anchor="middle">${esc(f.id.replace("FSU", "F"))}</text>${f.id_ok === false ? `<text class="rg-s trip" x="${X}" y="${y - 26}" text-anchor="middle">ID 확인</text>` : ""}</g>` +
        pp.map((p, j) => { const pc = p.live == null ? "na" : p.live ? "on" : "off", py = y + 62 + j * 46;
          return `<g class="rv-ppdu" data-unit="${esc(p.id)}"><line class="rg-l ${pc === "on" ? "on" : pc === "off" ? "trip" : "na"} thin" x1="${X}" y1="${j ? py - 30 : y + 19}" x2="${X}" y2="${py - 14}"/><rect class="rg-p ${pc} ${p.vital ? "vital" : ""}" x="${X - 62}" y="${py - 14}" width="124" height="30" rx="5"/>
            <text class="rg-nt" x="${X}" y="${py + 5}" text-anchor="middle">${esc(p.id)}${p.kw == null ? "" : " · " + p.kw.toFixed(1) + " kW"}${p.vital ? " ★" : ""}</text></g>`; }).join(""); }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="rg-svg ${o.cls || ""}"><path class="rg-back" d="M${x0} ${y} V26 H${x1} V${y}"/><path class="rg-l on" d="M${x0} ${y} H${x0 + 20}"/><path class="rg-l on" d="M${x1 - 20} ${y} H${x1}"/>
      <rect class="rg-src" x="${W / 2 - 80}" y="12" width="160" height="28" rx="6"/><text class="rg-nt" x="${W / 2}" y="31" text-anchor="middle">전원(배전반 · 모선 A ↔ B)</text>${seg}${nodes}</svg>`;
  },
  /* 다른 화면(개요 · 결선도 · 설비 제어)이 같이 쓰는 것: 지금 상태(snapshot 의 ring)로 그림용 모형 · 한 줄 요약 · 구간 이름을 만든다 */
  fromSnap(s) { const r = s && s.ring; return r ? { sections: r.sections, fsu: r.fsu, ppdu: r.ppdu } : null; },
  ends(r, i) { return [i === 0 ? "전원" : r.fsu[i - 1].name, i === r.fsu.length ? "전원" : r.fsu[i].name]; },
  sum(s) {
    const r = s && s.ring; if (!r) return null;
    const cut = r.cut.map(i => `구간 ${i}(${this.ends(r, i).join(" ↔ ")}) 차단`), dead = r.fsu.filter(f => f.live === false).map(f => f.name), pd = r.ppdu.filter(p => p.live === false || p.mccb === 2).map(p => p.name);
    const bad = dead.length || pd.length, txt = [...cut, dead.length ? `정전: ${dead.join(", ")}` : "", pd.length ? `배전체계 정전·트립: ${pd.join(", ")}` : "", r.switched && !dead.length ? "반대쪽에서 공급 중(여유 없음)" : ""].filter(Boolean).join(" · ");
    return { cls: bad ? "bad" : cut.length || r.switched ? "warn" : "ok", text: txt || `전 마디 공급 · 구간분전함 ${r.fsu.length} · 배전체계 ${r.ppdu.length}`, cut: r.cut, n: cut.length + dead.length + pd.length };
  },
  /* 시나리오 검증기가 단계마다 남긴 값(snap)에서 그림용 모형을 만든다 */
  fromValues(cfg, v) {
    const g = t => v ? v[t] : undefined, st = t => g(t) == null ? null : Math.round(g(t)), live = t => g(t) == null ? null : g(t) >= 300, sw = ["RING.sw0", ...cfg.fsu.map(f => f.id + ".sw")];
    return { sections: sw.map((t, i) => ({ i, state: v ? st(t) : (i === cfg.open ? 0 : 1), open: i === cfg.open, brk: !!(v && g("BRK." + i) > 0.5) })),
      fsu: cfg.fsu.map(f => ({ id: f.id, name: f.name, live: v ? live(f.id + ".v") : true, id_ok: null })), ppdu: cfg.ppdu.map(p => ({ id: p.id, name: p.name, at: p.at, vital: (p.ch || []).some(c => c.cls === 1), kw: v ? g(p.id + ".kw") ?? null : null, live: v ? live(p.id + ".v") : true })) };
  },
};

const P_RING = {
  d: null, t: 0, open: "",
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>환망 · 구간분전함</h2><span class="sub">전력 흐름: ⑥ 배전체계 → 구간분전함(FSU, 환상 간선) → 휴대용 배전체계(PPDU-20) → 6회로 → 시설 부하</span>
      <div class="spacer"></div><button class="btn" id="rgDisc">초기 기동 점검</button><button class="btn" id="rgCfg">배전체계 구성 · 중요 부하</button></div><div id="rgBody"><p class="muted">불러오는 중…</p></div>`;
    $("#rgDisc").onclick = () => this.discover(); $("#rgCfg").onclick = () => this.config(); this.load();
  },
  async load() { this.d = await api("/api/archive/ring"); this.t = Date.now(); this.paint(); },
  update() { if (Date.now() - this.t > 1500 && !$("#modal").classList.contains("on")) this.load(); },
  paint() {
    const B = $("#rgBody"), d = this.d; if (!B) return; if (!d || !d.ok) { B.innerHTML = `<div class="panel"><div class="bd warnc">${esc((d && d.why) || "환망 정보를 불러오지 못했습니다")}</div></div>`; return; }
    const s = d.status, pill = (ok, a, b, c = "bad") => ok == null ? '<span class="pill">값 없음</span>' : `<span class="pill ${ok ? "ok" : c}">${ok ? a : b}</span>`, brk = new Set(d.sim_break || []);
    const m = { sections: s.sections.map(x => ({ ...x, brk: brk.has(x.i) })), fsu: s.fsu, ppdu: s.ppdu }, eng = can("engineer") && d.sim;
    B.innerHTML = `<div class="arc-tiles four"><div class="arc-tile"><span>환망 상태</span><b class="${s.ok ? "okc" : "badc"}">${s.ok ? "전 마디 공급" : s.isolated.length ? "정전 마디 " + s.isolated.length : "확인 필요"}</b><i></i><em>${esc(s.name)}</em></div>
        <div class="arc-tile"><span>상시 개방점</span><b>구간 ${s.open}</b><i></i><em>${s.switched ? "닫힘 — 반대쪽 공급 중(여유 없음)" : "열림(정상)"}</em></div>
        <div class="arc-tile"><span>차단된 구간</span><b class="${s.cut.length ? "badc" : ""}">${s.cut.length ? s.cut.map(i => "구간 " + i).join(", ") : "없음"}</b><i></i><em>자동 구간 차단 · 절체 ${s.auto == null ? "값 없음" : s.auto ? "사용" : "꺼짐(수동)"}</em></div>
        <div class="arc-tile"><span>장치 자동 인식(ID)</span><b class="${d.discover.ok ? "okc" : "warnc"}">${d.discover.auto ? `FSU ${d.discover.fsu} · PPDU ${d.discover.ppdu}` : `${d.discover.n - d.discover.bad} / ${d.discover.n}`}</b><i></i><em>${d.discover.auto ? (d.discover.ok ? `읽은 ID 로 화면 구성 · 빈 자리 ${d.discover.empty}` : `확인 필요 ${d.discover.bad}대 — 초기 기동 점검을 여십시오`) : d.discover.ok ? "모두 제자리" : "초기 기동 점검을 여십시오"}</em></div></div>
      <div class="panel"><div class="hd"><h3>환망 구성도</h3><div class="spacer"></div><span class="arc-leg"><i class="c-ok"></i>공급 · 투입 <i class="c-open"></i>개방 <i class="c-bad"></i>차단 · 정전 · 단선 ★ 중요 부하</span></div><div class="bd">${RingView.svg(m)}
        ${s.missing.length ? `<p class="warnc">대응표에 없거나 값이 들어오지 않는 신호 ${s.missing.length}개: ${esc(s.missing.slice(0, 8).join(", "))}${s.missing.length > 8 ? " …" : ""}</p>` : ""}
        ${eng ? `<div class="arc-form rv-sim"><b>가상 장치 연습</b>${s.sections.map(x => `<button class="btn sm ${brk.has(x.i) ? "stop" : ""}" data-brk="${x.i}">구간 ${x.i} ${brk.has(x.i) ? "단선 해제" : "단선"}</button>`).join("")}<button class="btn sm" data-auto="${s.auto ? 0 : 1}">자동 절체 ${s.auto ? "끄기" : "켜기"}</button><button class="btn sm" data-swap="1">${d.sim_swap ? "자리 바꿈 해제" : "FSU2 ↔ FSU5 자리 바꿈"}</button><button class="btn sm" data-sim="shuffle">배치 뒤섞기</button><button class="btn sm" data-sim="add|fsu">FSU 한 대 추가</button><button class="btn sm" data-sim="remove|${esc(s.fsu.length ? s.fsu[s.fsu.length - 1].id : "")}">마지막 FSU 빼기</button><button class="btn sm" data-sim="add|ppdu">PPDU 한 대 추가</button><button class="btn sm" data-sim="remove|${esc(s.ppdu.length ? s.ppdu[s.ppdu.length - 1].id : "")}">마지막 PPDU 빼기</button><button class="btn sm pri" data-restore="1">처음 상태로</button></div>` : ""}</div></div>
      <div class="arc-grid"><div class="panel"><div class="hd"><h3>구간분전함(FSU) ${s.fsu.length}대 · 구간 ${s.sections.length}개</h3></div><div class="bd np scroll arc-table"><table class="t"><thead><tr><th>순서</th><th>장치</th><th>이름</th><th class="n">전압 V</th><th>공급</th><th>다음 구간 개폐기</th><th>ID</th></tr></thead><tbody>
        ${s.fsu.map((f, k) => { const sec = s.sections[k + 1]; return `<tr><td>${k + 1}</td><td class="mono">${esc(f.id)}</td><td>${esc(f.name)}</td><td class="n">${f.v == null ? "—" : f.v.toFixed(0)}</td><td>${pill(f.live, "공급", "정전")}</td><td>구간 ${sec.i}${sec.open ? " (상시 개방점)" : ""} · ${sec.state == null ? "값 없음" : ["개방", "투입", "차단"][sec.state]}</td><td><span class="mono">${f.id_read == null ? "—" : f.id_read}</span> ${pill(f.id_ok, f.new ? "새 장치" : "인식", "확인 필요", "warn")}</td></tr>`; }).join("")}</tbody></table></div></div>
        <div class="panel"><div class="hd"><h3>휴대용 배전체계(PPDU-20) ${s.ppdu.length}대</h3><div class="spacer"></div><span class="sub">줄을 누르면 6회로가 펼쳐진다</span></div><div class="bd np scroll arc-table"><table class="t"><thead><tr><th>장치</th><th>이름</th><th>연결</th><th class="n">kW / ${d.spec.rated_kw}</th><th>주 차단기</th><th class="n">접지 Ω</th><th>공급</th><th>ID</th></tr></thead><tbody>
        ${s.ppdu.map(p => `<tr class="arc-row" data-pp="${esc(p.id)}"><td class="mono">${esc(p.id)}${p.vital ? " ★" : ""}</td><td>${esc(p.name)}</td><td>${esc(p.at)}</td><td class="n ${p.over ? "badc" : ""}">${p.kw == null ? "—" : p.kw.toFixed(1)}</td><td>${p.mccb == null ? "—" : ["개방", "투입", '<span class="badc">트립</span>'][p.mccb]}</td><td class="n ${p.gnd_bad ? "badc" : ""}">${p.gnd == null ? "—" : p.gnd.toFixed(0)}</td><td>${pill(p.live, "공급", "정전")}</td><td>${pill(p.id_ok, p.new ? "새 장치" : "인식", "확인 필요", "warn")}</td></tr>
          ${this.open === p.id ? `<tr><td colspan="8" class="rv-ch"><div class="rv-flow">⑥ 배전체계 → ${esc(p.at)} → <b>${esc(p.id)}</b> 주 차단기 → 분기 6회로</div><table class="t"><thead><tr><th>회로</th><th>형식</th><th>물린 시설</th><th>부하 등급</th><th>차단기</th><th class="n">kW</th><th class="n">정격 kW</th>${eng ? "<th></th>" : ""}</tr></thead><tbody>
            ${p.ch.map(c => `<tr><td class="mono">CH${c.n}</td><td>${esc(c.type)}</td><td>${esc(c.name)}</td><td>${c.cls ? `<span class="pill ${c.cls === 1 ? "bad" : c.cls === 2 ? "warn" : "info"}">${c.cls}등급</span>` : '<span class="sub">환상 연결 · 미사용</span>'}</td><td>${c.cb == null ? "—" : ["개방", "투입", '<span class="badc">트립</span>'][c.cb]}</td><td class="n">${c.kw == null ? "—" : c.kw.toFixed(1)}</td><td class="n">${c.limit}</td>${eng ? `<td><button class="btn sm" data-pch="${esc(p.id)}|ch${c.n}|${c.cb === 2 ? 1 : 2}">${c.cb === 2 ? "복귀" : "트립"}</button></td>` : ""}</tr>`).join("")}</tbody></table>
            ${eng ? `<div class="arc-form rv-sim"><b>가상 장치 연습</b><button class="btn sm" data-pch="${esc(p.id)}|mccb|${p.mccb === 2 ? 1 : 2}">주 차단기 ${p.mccb === 2 ? "복귀" : "트립"}</button><button class="btn sm" data-pch="${esc(p.id)}|gnd|${p.gnd_bad ? 35 : 180}">접지저항 ${p.gnd_bad ? "정상(35 Ω)" : "불량(180 Ω)"}</button></div>` : ""}</td></tr>` : ""}`).join("")}</tbody></table></div></div></div>`;
    const post = async body => { const r = await api("/api/ring", { do: "sim", ...body }); if (!r.ok) toast(r.why || "실패", "bad"); this.load(); };
    B.querySelectorAll("[data-brk]").forEach(b => b.onclick = () => post({ action: "break", section: +b.dataset.brk, on: !brk.has(+b.dataset.brk) }));
    B.querySelectorAll("[data-auto]").forEach(b => b.onclick = () => post({ action: "auto", on: b.dataset.auto === "1" }));
    B.querySelectorAll("[data-swap]").forEach(b => b.onclick = () => post(d.sim_swap ? { action: "swap" } : { action: "swap", a: "FSU2", b: "FSU5" }));
    B.querySelectorAll("[data-sim]").forEach(b => b.onclick = () => { const [a, x] = b.dataset.sim.split("|"); post(a === "add" ? { action: "add", kind: x, at: s.fsu.length ? +s.fsu[0].id.slice(3) : 0 } : a === "remove" ? { action: "remove", id: x } : { action: a }); });
    B.querySelectorAll("[data-restore]").forEach(b => b.onclick = () => post({ action: "restore" }));
    B.querySelectorAll("[data-pp]").forEach(tr => tr.onclick = () => { this.open = this.open === tr.dataset.pp ? "" : tr.dataset.pp; this.paint(); });
    B.querySelectorAll("[data-pch]").forEach(b => b.onclick = e => { e.stopPropagation(); const [id, what, value] = b.dataset.pch.split("|"); post({ action: "ppdu", id, what, value: +value }); });
  },
  /* 초기 기동 점검: 전원에서 가까운 순서로 한 대씩 ID 를 확인해 보여 준다 */
  async discover() {
    const d = await api("/api/archive/ring"); if (!d.ok) return toast(d.why, "bad"); const rows = d.discover.rows;
    modal(`<h3>초기 기동 점검 — 장치 자동 인식</h3><p class="sub">${d.discover.auto ? "장치를 어느 자리에 몇 대 놓았든, 전원에서 가까운 순서(고리 순서)로 자리마다 ID 를 읽어 그 자리에 놓인 장치를 알아낸다. 화면은 이 결과대로 스스로 구성된다 — 따로 맞출 것이 없다. 빈 자리는 화면과 경보에서 빠진다." : "설치를 마친 뒤, 전원에서 가까운 순서(고리 순서)로 구간분전함(FSU)과 거기 붙은 휴대용 배전체계(PPDU)의 ID 를 한 대씩 확인한다. 읽은 ID 가 그 자리에 있어야 할 ID 와 같으면 '일치'다."}</p>
      <div class="scroll" style="max-height:52vh"><table class="t"><thead><tr><th>순서</th><th>종류</th><th>장치</th><th>연결</th><th class="n">${d.discover.auto ? "" : "있어야 할 ID"}</th><th class="n">읽은 ID</th><th class="n">전압 V</th><th>판정</th></tr></thead><tbody id="dcRows"></tbody></table></div>
      <p id="dcSum" class="sub"></p><div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" id="dcAgain">다시 점검</button>${can("engineer") && !d.discover.auto ? '<button class="btn" id="dcAccept" title="지금 읽은 ID 를 그 자리의 기준으로 삼는다">읽은 ID 로 확정</button>' : ""}<button class="btn pri" id="dcClose">닫기</button></div>`, box => {
      box.classList.add("wide"); const tb = box.querySelector("#dcRows"); let i = 0;
      const step = () => { if (i >= rows.length) { box.querySelector("#dcSum").innerHTML = d.discover.auto ? (d.discover.ok ? `<span class="okc">구간분전함 ${d.discover.fsu}대 · 배전체계 ${d.discover.ppdu}대를 인식해 화면을 구성했습니다(빈 자리 ${d.discover.empty}).</span>` : `<span class="warnc">${d.discover.bad}대는 확인이 필요합니다(무응답 · 같은 ID · 종류가 다른 장치 · 연결 미확인). 통신선과 입력 케이블을 본 뒤 [다시 점검]을 누르십시오.</span>`)
          : d.discover.ok ? `<span class="okc">${rows.length}대 모두 제자리에서 인식했습니다.</span>` : `<span class="warnc">${d.discover.bad}대가 맞지 않습니다. 자리와 통신선을 확인한 뒤 [다시 점검]을 누르십시오.</span>`; return; }
        const x = rows[i++]; tb.insertAdjacentHTML("beforeend", `<tr><td>${x.seq}</td><td>${x.kind === "FSU" ? "구간분전함" : "배전체계"}</td><td><span class="mono">${esc(x.id)}</span> ${esc(x.name)}</td><td>${esc(x.where)}</td><td class="n">${x.expect == null ? "" : x.expect}</td><td class="n">${x.read == null ? "—" : x.read}</td><td class="n">${x.v == null ? "—" : x.v.toFixed(0)}</td>
          <td><span class="pill ${x.state === "일치" || x.state === "인식" ? "ok" : x.state === "무응답" ? "bad" : x.state === "비어 있음" ? "" : "warn"}">${x.state}</span> <span class="sub">${esc(x.hint)}</span></td></tr>`); tb.lastElementChild.scrollIntoView({ block: "nearest" }); setTimeout(step, 260); };
      step(); const close = () => { box.classList.remove("wide"); closeModal(); this.load(); };
      box.querySelector("#dcClose").onclick = close; box.querySelector("#dcAgain").onclick = () => { box.classList.remove("wide"); closeModal(); this.discover(); };
      const ac = box.querySelector("#dcAccept"); if (ac) ac.onclick = async () => { if (!confirm("지금 읽은 ID 를 각 자리의 기준 ID 로 저장합니까? 장치가 올바른 자리에 있는지 눈으로 확인한 뒤에만 하십시오.")) return; const r = await api("/api/ring", { do: "accept" }); toast(r.ok ? "기준 ID 를 저장했습니다" : (r.why || "저장하지 못했습니다"), r.ok ? "ok" : "bad"); if (r.ok) close(); };
    });
  },
  /* 배전체계(PPDU) 구성: 어느 구간분전함에 붙였는지, 회로마다 어떤 시설을 물렸고 몇 등급 부하인지 현장에서 고른다(운용자). 1등급 회로가 있는 PPDU 가 중요 부하다 */
  config() {
    if (!can("operator")) return loginDialog(); const c = this.d && this.d.config, sp = this.d && this.d.spec; if (!c) return;
    modal(`<h3>배전체계 구성 — 회로별 시설과 중요 부하</h3><p class="sub">휴대용 배전체계(PPDU-20)마다 붙인 구간분전함을 고르고, 6회로에 물린 시설 이름과 부하 등급을 적는다. <b>1등급</b>이 꼭 지켜야 하는 중요 부하다 — 1등급 회로가 있는 배전체계가 정전되면 경보가 가장 높은 등급으로 난다. 저장하면 바로 적용된다.</p>
      <div class="scroll" style="max-height:56vh">${c.ppdu.map((p, i) => `<div class="rv-cf" data-i="${i}"><div class="arc-form"><b class="mono">${esc(p.id)}</b><span class="sub">ID ${p.code == null ? "—" : p.code}</span><input class="in sm" data-k="name" value="${esc(p.name || "")}" maxlength="30" style="width:190px" title="이름">
        <label>붙인 구간분전함 <select class="in sm" ${p.at_auto ? 'disabled title="자동 인식 — 케이블을 꽂은 곳을 스스로 안다"' : 'data-k="at"'}>${c.fsu.map(f => `<option value="${f.id}" ${f.id === p.at ? "selected" : ""}>${esc(f.id)} · ${esc(f.name || "")}</option>`).join("")}</select></label></div>
        <table class="t"><thead><tr><th>회로</th><th>형식 · 정격</th><th>물린 시설</th><th>부하 등급</th></tr></thead><tbody>${p.ch.map((ch, n) => `<tr data-n="${n}"><td class="mono">CH${n + 1}</td><td class="sub">${esc(sp.ch[n].type)} · ${sp.ch[n].kw} kW</td><td><input class="in sm" data-c="name" value="${esc(ch.name || "")}" maxlength="20" style="width:200px"></td>
          <td><select class="in sm" data-c="cls">${[[1, "1등급 (중요 부하)"], [2, "2등급"], [3, "3등급"], [0, "환상 연결 · 미사용"]].map(o => `<option value="${o[0]}" ${o[0] === ch.cls ? "selected" : ""}>${o[1]}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`).join("")}</div>
      <p class="arc-form" style="margin-top:10px"><label>상시 개방점 <select class="in sm" id="cfOpen">${Array.from({ length: c.fsu.length + 1 }, (_, i) => `<option value="${i}" ${i === c.open ? "selected" : ""}>구간 ${i} (${i === 0 ? "전원" : c.fsu[i - 1].id} ↔ ${i === c.fsu.length ? "전원" : c.fsu[i].id})</option>`).join("")}</select></label><span class="sub">평소에 열어 두는 구간. 실제 개폐기 위치와 같게 맞춘다.</span></p>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" id="cfNo">닫기</button><button class="btn pri" id="cfOk">저장 · 적용</button></div>`, box => {
      box.classList.add("wide"); const close = () => { box.classList.remove("wide"); closeModal(); this.load(); }; box.querySelector("#cfNo").onclick = close;
      box.querySelector("#cfOk").onclick = async () => { const ppdu = [...box.querySelectorAll(".rv-cf")].map(el => { const p = { id: c.ppdu[+el.dataset.i].id }; el.querySelectorAll("[data-k]").forEach(x => { p[x.dataset.k] = x.value.trim(); });
          p.ch = [...el.querySelectorAll("tr[data-n]")].map(tr => ({ name: tr.querySelector('[data-c="name"]').value.trim(), cls: +tr.querySelector('[data-c="cls"]').value })); return p; });
        const r = await api("/api/ring", { do: "config", ppdu, open: +box.querySelector("#cfOpen").value }); toast(r.ok ? (r.same ? "바뀐 내용이 없습니다" : "저장하고 적용했습니다") : (r.why || "저장하지 못했습니다"), r.ok ? "ok" : "bad"); if (r.ok) close(); };
    });
  },
};
