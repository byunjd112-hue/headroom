/* 설치 점검(초기화): 장비를 설치한 뒤 한 번에 검사 → 문제마다 고치는 방법 안내 → 고친 뒤 다시 검사해 '해결됨' 확인. 서버: hmi/initcheck.py (GET /api/archive/initcheck)
   개요의 [설치 점검] 단추가 연다. 단추에는 지금 상태(미실시 · 남은 이상 n건 · 완료)가 보인다(스냅샷의 init). */
"use strict";
const InitCheck = {
  LV: { ok: ["정상", "ok"], warn: ["주의", "warn"], bad: ["이상", "bad"] },
  s() { return (S.snap && S.snap.init) || null; },
  /* 개요의 단추 글 */
  button() {
    const b = $("#initBtn"), i = this.s(); if (!b || !i) return;
    const t = !i.ran ? "설치 점검 · 미실시" : i.done ? (i.warn ? `설치 점검 완료 · 주의 ${i.warn}` : "설치 점검 완료") : `설치 점검 · 남은 이상 ${i.bad}건`;
    if (b.textContent !== t) b.textContent = t; b.classList.toggle("stop", !!(i.ran && !i.done)); b.classList.toggle("pri", !i.ran);
  },
  async get(run, only) {
    const h = S.token ? { "X-EMS-Token": S.token } : {}, r = await fetch("/api/archive/initcheck" + (run ? "?run=1" + (only ? "&only=" + encodeURIComponent(only) : "") : ""), { headers: h });
    let d = null; try { d = await r.json(); } catch (e) { d = null; }
    return r.ok && d ? d : { ok: false, why: (d && d.why) || "검사하지 못했습니다" };
  },
  async open() { const d = await this.get(false); if (!d.ok) return toast(d.why, "bad"); this.show(d); },
  async run(only) {
    if (!can("operator")) { toast("설치 점검은 운용자 로그인이 필요합니다", "bad"); return loginDialog(); }
    const box = $("#icBody"); if (box) box.style.opacity = .45;
    const d = await this.get(true, only); if (!d.ok) { if (box) box.style.opacity = 1; return toast(d.why, "bad"); }
    this.show(d); toast(d.last.bad ? `검사 ${d.last.n}차: 이상 ${d.last.bad}건 · 주의 ${d.last.warn}건 — 안내대로 고친 뒤 다시 검사하십시오` : `검사 ${d.last.n}차: 이상 없음 — 설치 점검 완료`, d.last.bad ? "bad" : "ok"); poll();
  },
  row(i) {
    const [nm, cls] = this.LV[i.level] || ["?", ""], open = i.level !== "ok";
    const fix = i.fix ? `<button class="btn sm" data-icfix="${esc(i.id)}">${esc(i.fix.label)}</button>` : "";
    return `<tr class="ic-${i.level}"><td class="muted">${esc(i.area)}</td><td><b>${esc(i.name)}</b></td><td><span class="pill ${cls}">${nm}</span>${i.was ? ` <span class="pill ok" title="직전 검사에서는 ${this.LV[i.was][0]}이었다">해결됨</span>` : ""}</td>
      <td>${esc(i.text)}${open && i.guide.length ? `<ol class="ic-guide">${i.guide.map(g => `<li>${esc(g)}</li>`).join("")}</ol>` : ""}</td>
      <td class="ic-act">${open ? fix + `<button class="btn sm" data-icre="${esc(i.id)}">이 항목만 다시 검사</button>` : ""}</td></tr>`;
  },
  show(d) {
    const la = d.last, items = la ? la.items : [], open = items.filter(i => i.level !== "ok"), fixed = items.filter(i => i.was).length + (la && la.cleared ? la.cleared.length : 0);
    const head = !la ? `<p class="sub">아직 검사하지 않았습니다. 장비를 설치하고 전원 · 통신선을 이은 뒤 [검사 시작]을 누르십시오.</p>`
      : `<div class="ic-sum ${la.bad ? "bad" : "ok"}"><b>${la.bad ? `이상 ${la.bad}건 — 아래 안내대로 고친 뒤 다시 검사하십시오` : "이상 없음 — 설치 점검 완료"}</b><span>주의 ${la.warn}건 · 정상 ${items.length - open.length}건${fixed ? ` · 이번에 해결됨 ${fixed}건` : ""} · ${la.n}차 검사 ${esc(la.t)} ${esc(la.by || "")}</span></div>`;
    const hist = d.runs && d.runs.length > 1 ? `<details class="ic-hist"><summary>검사 이력 ${d.runs.length}회</summary><table class="t"><thead><tr><th>때</th><th>검사자</th><th class="n">이상</th><th class="n">주의</th><th>해결된 것</th><th>남은 이상</th></tr></thead><tbody>${d.runs.map(r => `<tr><td class="mono">${esc(r.t)}</td><td>${esc(r.by || "")}${r.only ? " (한 항목)" : ""}</td><td class="n">${r.bad}</td><td class="n">${r.warn}</td><td>${esc((r.fixed || []).join(", ") || "—")}</td><td>${esc((r.open || []).join(", ") || "—")}</td></tr>`).join("")}</tbody></table></details>` : "";
    const box = modal(`<h3>설치 점검(초기화) — 장비 통신 · 대수 · 환망 · 모선 · 부하 경로</h3>
      <p class="sub">설정된 주소로 장비가 응답하는지, 대수가 배치도와 맞는지, 환망의 순서와 급전 A · B, 모선 구성, 부하 공급 경로를 지금 읽히는 값으로 검사한다. EMS 는 차단기를 조작하지 않는다 — 한쪽 급전만 살려 보는 시험은 차단기를 조작한 뒤 다시 검사한다.${d.sim ? " (가상 장치)" : ""}</p>
      <div id="icBody">${head}${la ? `<div class="scroll" style="max-height:52vh"><table class="t ic-t"><thead><tr><th>구분</th><th>대상</th><th>판정</th><th>내용 · 고치는 방법</th><th></th></tr></thead><tbody>${open.concat(items.filter(i => i.level === "ok")).map(i => this.row(i)).join("")}</tbody></table></div>` : ""}${hist}</div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn pri" id="icRun">${la ? "전체 다시 검사" : "검사 시작"}</button><button class="btn" id="icClose">닫기</button></div>`);
    box.classList.add("wide"); const close = () => { box.classList.remove("wide"); closeModal(); };
    box.querySelector("#icClose").onclick = close; box.querySelector("#icRun").onclick = () => this.run();
    box.querySelectorAll("[data-icre]").forEach(b => { b.onclick = () => this.run(b.dataset.icre); });
    box.querySelectorAll("[data-icfix]").forEach(b => { b.onclick = () => this.fix(items.find(i => i.id === b.dataset.icfix), close); });
  },
  /* 화면에서 바로 고칠 수 있는 것: 모선 구성 자동 보완, 그 밖에는 고치는 화면으로 간다 */
  async fix(i, close) {
    const f = i && i.fix; if (!f) return;
    if (f.act === "bus_auto") { if (!can("engineer")) { toast("모선 구성은 엔지니어 권한", "bad"); return loginDialog(); } const r = await api("/api/bus", { op: "auto" }); toast(r.ok ? r.msg : r.why, r.ok ? "ok" : "bad"); if (r.ok) { S.snap.bus = r.bus; this.run(i.id); } return; }
    close(); if (f.act === "busplan") return BusPlan.dialog(); if (f.act === "goto") location.hash = f.to;
  },
};
document.addEventListener("click", e => { const a = e.target.closest('[data-act="initcheck"]'); if (a) { e.preventDefault(); InitCheck.open(); } });
