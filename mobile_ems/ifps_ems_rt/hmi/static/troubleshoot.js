"use strict";
/* 이상 조치 안내: 경보 하나를 누르면 이상의 종류 · 뜻 · 점검 순서 · 도구 · 부품 · 복귀 확인 · 상급 정비 요청 기준을 보여 준다.
   내용은 troubleshoot.json(경보 키의 앞머리로 찾는다). 일반 점검 순서이며 제작사 교범과 부대 안전 규정이 먼저다. */
const TS = {
  data: null,
  async load() { if (!this.data) { try { this.data = await (await fetch("troubleshoot.json")).json(); } catch (e) { this.data = { note: "", items: [] }; } } return this.data; },
  find(key) { const it = (this.data || { items: [] }).items; return it.filter(x => x.match.some(m => String(key || "").startsWith(m))).sort((a, b) => Math.max(...b.match.map(m => m.length)) - Math.max(...a.match.map(m => m.length)))[0] || null; },
  list(title, arr, ordered) { return arr && arr.length ? `<h4>${title}</h4><${ordered ? "ol" : "ul"} class="ts-list">${arr.map(x => `<li>${esc(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>` : ""; },
  body(x, alarm) {
    return `<div class="ts"><div class="ts-hd"><span class="pill info">${esc(x.kind)}</span><h3>${esc(x.title)}</h3></div>
      ${alarm ? `<p class="ts-alm"><b>지금 경보</b> ${esc(alarm.src)} — ${esc(alarm.text)}</p>` : ""}<p>${esc(x.meaning)}</p>
      ${x.danger ? `<p class="ts-danger"><b>안전</b> ${esc(x.danger)}</p>` : ""}${this.list("점검 순서", x.steps, true)}
      <div class="ts-two"><div>${this.list("도구", x.tools) || "<h4>도구</h4><p class='sub'>따로 필요 없음</p>"}</div><div>${this.list("부품 · 보급품", x.parts) || "<h4>부품 · 보급품</h4><p class='sub'>따로 필요 없음</p>"}</div></div>
      ${x.done ? `<h4>복귀 확인</h4><p>${esc(x.done)}</p>` : ""}${x.call ? `<h4>상급 정비 요청</h4><p>${esc(x.call)}</p>` : ""}<p class="sub ts-note">${esc(this.data.note)}</p></div>`;
  },
  async open(alarm) {
    await this.load(); const x = this.find(alarm.key);
    modal(`${x ? this.body(x, alarm) : `<h3>조치 안내</h3><p>${esc(alarm.text)}</p><p class="sub">이 경보에 맞는 안내가 아직 없습니다. 아래 목록에서 비슷한 항목을 찾아보십시오.</p>`}
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" id="tsAll">전체 목록</button><button class="btn" id="tsPrint">인쇄</button><button class="btn pri" id="tsClose">닫기</button></div>`, box => {
      box.classList.add("wide"); box.querySelector("#tsClose").onclick = () => { box.classList.remove("wide"); closeModal(); }; box.querySelector("#tsPrint").onclick = () => window.print();
      box.querySelector("#tsAll").onclick = () => { box.classList.remove("wide"); closeModal(); location.hash = "#alarms"; P_ALM.tab = "guide"; if (P_ALM.show && document.querySelector("#almTabs")) P_ALM.show(); };
    });
  },
  /* 경보 화면의 '조치 안내' 탭: 전체 목록에서 고르거나 글자로 찾는다 */
  async page(B) {
    await this.load(); const kinds = [...new Set(this.data.items.map(x => x.kind))]; let cur = this.data.items[0], q = "", kind = "";
    const paint = () => {
      const rows = this.data.items.filter(x => (!kind || x.kind === kind) && (!q || JSON.stringify(x).includes(q)));
      B.innerHTML = `<div class="ts-page"><div class="panel"><div class="hd"><input class="in" id="tsQ" placeholder="찾을 글자 (예: 트립, 연료, 통신)" value="${esc(q)}" style="width:200px"><select class="in" id="tsK"><option value="">모든 종류</option>${kinds.map(k => `<option ${k === kind ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></div>
        <div class="bd np scroll hfill"><table class="t"><tbody>${rows.map(x => `<tr class="arc-row ${x === cur ? "sel" : ""}" data-ts="${x.id}"><td><span class="pill info">${esc(x.kind)}</span></td><td>${esc(x.title)}</td></tr>`).join("") || `<tr><td class="muted">찾는 항목이 없습니다</td></tr>`}</tbody></table></div></div>
        <div class="panel"><div class="bd scroll hfill">${cur ? this.body(cur, null) : ""}</div></div></div>`;
      B.querySelector("#tsQ").onchange = e => { q = e.target.value.trim(); paint(); }; B.querySelector("#tsK").onchange = e => { kind = e.target.value; paint(); };
      B.querySelectorAll("[data-ts]").forEach(tr => tr.onclick = () => { cur = this.data.items.find(x => x.id === tr.dataset.ts); paint(); });
    };
    paint();
  },
};
