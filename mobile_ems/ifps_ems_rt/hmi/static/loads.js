/* 부하 관리: 부하의 종류 · 수량 · 등급 · 정격 · 절감 비율을 늘리고 줄인다. 서버: hmi/loadctl.py · ifps_ems_rt/loads.py
   목록은 스냅샷의 loads 로 오며 개요 · 결선도 · 환망 · 운영 시나리오 화면이 LD 를 같이 쓴다(화면마다 따로 세지 않는다). */
const LD = {
  STAGE: { on: ["ok", "공급"], save: ["warn", "절감 공급"], off: ["bad", "차단"] },
  s() { return (S.snap && S.snap.loads) || { items: [], grades: [], kinds: [] }; },
  g(f) { return this.s().grades.find(x => x.feeder === f) || null; },
  stage(f) { const g = this.g(f); return g ? g.stage : null; },
  pill(st) { const x = this.STAGE[st]; return x ? `<span class="pill ${x[0]}">${x[1]}</span>` : '<span class="pill">값 없음</span>'; },
  /* 급전선 한 줄 요약: "3종 4개 · 정격 56 kW" */
  sum(f) { const it = this.s().items.filter(i => i.feeder === f && i.n > 0), g = this.g(f); return g ? `${it.length}종 ${g.n}개 · 정격 ${F.n(g.rated, 0)} kW` : ""; },
  names(f) { return this.s().items.filter(i => i.feeder === f && i.n > 0).map(i => i.n > 1 ? `${i.name} ×${i.n}` : i.name); },
  /* 그 배전체계(PPDU)에 물린 부하 — 개요 · 결선도 · 환망이 같은 목록을 쓴다 */
  at(ppdu) { return this.s().items.filter(i => i.ppdu === ppdu && i.n > 0); },
  label(i) { return i.n > 1 ? `${i.name} ×${i.n}` : i.name; },
};
const P_LOADS = {
  sel: null, sig: "",
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>부하 관리</h2><span class="sub">부하의 종류 · 수량을 늘리고 줄이면 개요 · 결선도 · 환망 · 운영 시나리오에 함께 반영된다</span><div class="spacer"></div><button class="btn" id="ldReset">기본 목록으로</button></div>
      <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px" id="ldGrades"></div>
      <div class="engbox" style="margin-bottom:14px"><b>공급이 부하를 따라가지 못할 때</b> — ① 3등급 절감 공급 → ② 3등급 차단 → ③ 2등급 절감 공급 → ④ 2등급 차단 순서로 내려간다(절감 뒤 10초 지켜봄). 1등급은 끊지 않는다. 모자람이 풀리면 60초 뒤 되살린다.
        절감 공급은 그 급전선의 '절감 비율'만큼만 줄인다(냉난방 완화 · 조명 감광 · 비필수 회로). 태세(저소음 · 자립)나 ESS 충전율 때문에 끊을 때는 절감을 거치지 않고 바로 끊는다.</div>
      <div class="panel"><div class="hd"><h3>부하 목록</h3><div class="spacer"></div><select class="in" id="ldKind"></select><button class="btn go" id="ldAdd">＋ 부하 추가</button></div>
        <div class="bd np"><table class="t"><thead><tr><th>이름</th><th>종류</th><th>등급</th><th>물린 배전체계</th><th class="n">대당 정격</th><th style="text-align:center">수량</th><th class="n">정격 합</th><th class="n">지금(추정)</th><th class="n">절감 비율</th><th>상태</th><th></th></tr></thead><tbody id="ldRows"></tbody></table></div>
        <div class="bd muted" style="font-size:12px;border-top:1px solid var(--line)">EMS 가 재는 것은 급전선(등급)별 합계다. 부하 하나하나의 '지금' 값은 급전선 계측값을 정격 비율로 나눈 추정값이다. 등급별 정격 합은 그 급전선의 계측 범위를 넘을 수 없다(<span id="ldLim"></span>).</div></div>
      <div class="panel" style="margin-top:14px;display:none" id="ldEdit"></div>`;
    $("#ldReset").onclick = () => { if (confirm("부하 목록을 기본으로 되돌립니다. 계속합니까?")) this.post({ op: "reset" }); };
    $("#ldAdd").onclick = () => this.post({ op: "add", kind: $("#ldKind").value });
    this.sig = ""; this.sel = null; this.paint();
  },
  async post(b) {
    if (!can("operator")) return loginDialog();
    const r = await api("/api/loads", b); toast(r.ok ? r.msg : r.why, r.ok ? "ok" : "bad");
    if (r.ok) { S.snap.loads = r.loads; if (b.op === "del" || b.op === "reset") this.sel = null; this.sig = ""; this.paint(); }
    return r;
  },
  update() { this.paint(); },
  grades(d) {
    $("#ldGrades").innerHTML = d.grades.map(g => `<div class="panel"><div class="hd"><h3>${g.grade}등급 부하</h3><div class="spacer"></div>${LD.pill(g.stage)}</div>
      <div class="bd"><div style="display:flex;gap:18px;align-items:baseline"><div><div class="lab">지금</div><div style="font-size:26px;font-weight:700">${F.kw(g.kw)}<span class="muted" style="font-size:13px"> kW</span></div></div>
        <div><div class="lab">정격 합</div><div style="font-size:18px">${F.n(g.rated, 0)} kW</div></div><div><div class="lab">부하</div><div style="font-size:18px">${g.n}개</div></div>
        <div><div class="lab">절감 가능</div><div style="font-size:18px">${g.grade === 1 ? "—" : Math.round(g.save_frac * 100) + "%"}</div></div></div>
        <div class="muted" style="margin-top:8px;min-height:18px;font-size:12px">${g.auto ? `EMS 자동 ${g.auto === "save" ? "절감" : "차단"} — ${esc(g.why)}` : g.grade === 1 ? "끊지 않는 부하(지휘 · 통신)" : "CB-" + g.feeder}</div>
        ${g.grade === 1 ? "" : `<div style="display:flex;gap:6px;margin-top:8px"><button class="btn sm" data-lds="${g.feeder}" data-v="3">절감 공급</button><button class="btn sm stop" data-lds="${g.feeder}" data-v="2">차단</button><button class="btn sm go" data-lds="${g.feeder}" data-v="1">복구</button></div>`}</div></div>`).join("");
    $$("#ldGrades [data-lds]").forEach(b => b.onclick = () => sbo("MTR", "set", { tag: "LDS." + b.dataset.lds, value: +b.dataset.v, label: `${b.dataset.lds === "L2" ? "2등급" : "3등급"} 부하 ${{ 1: "복구", 2: "차단", 3: "절감 공급" }[b.dataset.v]}` }));
  },
  rows(d) {
    const kn = Object.fromEntries(d.kinds.map(k => [k.id, k.name]));
    $("#ldRows").innerHTML = d.items.map(i => `<tr class="${this.sel === i.id ? "sel" : ""}"><td><b>${esc(i.name)}</b></td><td>${esc(kn[i.kind] || i.kind)}</td><td>${i.grade}등급 <span class="muted">(${i.feeder})</span></td><td>${i.ppdu ? `${esc(i.ppdu_name)} <span class="muted">(${esc(i.ppdu)} · ${esc(i.fsu)}${i.ppdu_auto ? " · 자동" : ""})</span>` : '<span class="muted">배전체계 없음</span>'}</td><td class="n">${F.n(i.kw, 1)} kW</td>
      <td style="text-align:center;white-space:nowrap"><button class="btn sm" data-q="${i.id}" data-dv="-1" ${i.n <= 0 ? "disabled" : ""}>−</button> <b style="display:inline-block;min-width:22px">${i.n}</b> <button class="btn sm" data-q="${i.id}" data-dv="1" ${i.n >= d.max_n ? "disabled" : ""}>＋</button></td>
      <td class="n">${F.n(i.rated, 0)} kW</td><td class="n">${i.n ? F.kw(i.est_kw) : "—"}</td><td class="n">${i.grade === 1 ? "—" : i.save_pct + "%"}</td><td>${i.n ? LD.pill(LD.stage(i.feeder)) : '<span class="pill">없음</span>'}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn sm" data-ed="${i.id}">고치기</button> <button class="btn sm stop" data-del="${i.id}">삭제</button></td></tr>`).join("") || `<tr><td colspan="11" class="muted" style="text-align:center;padding:18px">부하가 없습니다 — [＋ 부하 추가]로 넣으십시오</td></tr>`;
    $$("#ldRows [data-q]").forEach(b => b.onclick = () => this.post({ op: "count", id: b.dataset.q, delta: +b.dataset.dv }));
    $$("#ldRows [data-del]").forEach(b => b.onclick = () => { const i = d.items.find(x => x.id === b.dataset.del); if (confirm(`'${i.name}' 을(를) 목록에서 지웁니다. 계속합니까?`)) this.post({ op: "del", id: i.id }); });
    $$("#ldRows [data-ed]").forEach(b => b.onclick = () => { this.sel = b.dataset.ed; this.sig = ""; this.paint(); });
  },
  paint() {
    const d = LD.s(); if (!$("#ldRows")) return;
    if (!$("#ldKind").options.length) $("#ldKind").innerHTML = d.kinds.map(k => `<option value="${k.id}">${esc(k.name)} (${k.grade}등급 · ${k.kw} kW)</option>`).join("");
    const lim = d.limit || {}; $("#ldLim").textContent = `1등급 ${lim[1] ?? "—"} · 2등급 ${lim[2] ?? "—"} · 3등급 ${lim[3] ?? "—"} · 합계 ${lim[0] ?? "—"} kW`;
    this.grades(d); this.rows(d);
    const it = d.items.find(x => x.id === this.sel), E = $("#ldEdit"), sig = it ? JSON.stringify([it.id, d.rev]) : "";
    if (!it) { E.style.display = "none"; this.sig = ""; return; }
    if (sig === this.sig) return;                                         // 입력하는 동안에는 다시 그리지 않는다
    this.sig = sig; E.style.display = "";
    E.innerHTML = `<div class="hd"><h3>부하 고치기 — ${esc(it.name)}</h3></div><div class="bd"><div class="form">
      <label>이름<input class="in" id="leName" maxlength="24" value="${esc(it.name)}" style="width:180px"></label>
      <label>등급<select class="in" id="leGrade">${[1, 2, 3].map(g => `<option value="${g}" ${g === it.grade ? "selected" : ""}>${g}등급</option>`).join("")}</select></label>
      <label>물린 배전체계<select class="in" id="lePp"><option value="">자동(종류에 따라)</option>${(d.ppdus || []).map(p => `<option value="${esc(p.id)}" ${!it.ppdu_auto && it.ppdu === p.id ? "selected" : ""}>${esc(p.name)} (${esc(p.id)} · ${esc(p.at)})</option>`).join("")}</select></label>
      <label>대당 정격(kW)<input class="in" id="leKw" type="number" min="0.1" max="500" step="0.1" value="${it.kw}" style="width:100px"></label>
      <label>절감 비율(%)<input class="in" id="leSave" type="number" min="0" max="80" step="5" value="${it.save_pct}" style="width:90px"></label>
      <button class="btn go" id="leOk">저장</button><button class="btn" id="leNo">닫기</button></div>
      <div class="muted" style="margin-top:8px;font-size:12px">등급이 급전선을 정한다(1등급 L1 · 2등급 L2 · 3등급 L3). 1등급은 절감하지 않는다. 물린 배전체계는 개요 배치도의 케이블과 결선도의 부하 자리를 정한다. 절감 비율은 그 부하가 절감 공급 때 줄일 수 있는 몫이다.</div></div>`;
    $("#leNo").onclick = () => { this.sel = null; this.paint(); };
    $("#leOk").onclick = async () => {
      const g = +$("#leGrade").value, r = await this.post({ op: "set", id: it.id, name: $("#leName").value, grade: g, kw: parseFloat($("#leKw").value), save_pct: g === 1 ? 0 : parseFloat($("#leSave").value), ppdu: $("#lePp").value });
      if (r && r.ok) { this.sel = null; this.paint(); }
    };
  },
};
