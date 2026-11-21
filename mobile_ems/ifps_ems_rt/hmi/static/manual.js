"use strict";
/* 도움말(사용자 설명서): manual.json 을 화면에서 읽는다. 왼쪽 차례 · 글자 찾기 · 인쇄. 다른 화면의 [?]를 누르면 그 화면을 설명하는 절로 바로 온다.
   같은 본문으로 Word 설명서(docs/build_user_manual.js)를 만든다. 그림은 static/manual/<이름>.jpg 가 있을 때만 보인다. */
const P_HELP = {
  data: null, cur: "", q: "",
  async load() { if (!this.data) { try { this.data = await (await fetch("manual.json")).json(); } catch (e) { this.data = { title: "사용자 설명서", sections: [] }; } } return this.data; },
  block(k) {
    if (k.type === "p") return `<p>${esc(k.text)}</p>`; if (k.type === "h") return `<h4>${esc(k.text)}</h4>`;
    if (k.type === "steps") return `<ol class="hp-steps">${k.items.map(t => `<li>${esc(t)}</li>`).join("")}</ol>`;
    if (k.type === "note") return `<p class="hp-note"><b>주의 · 참고</b> ${esc(k.text)}</p>`;
    if (k.type === "table") return `<div class="scroll"><table class="t hp-tbl"><thead><tr>${k.head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${k.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    if (k.type === "shot") return `<figure class="hp-fig"><img src="manual/${encodeURIComponent(k.name)}.jpg" alt="${esc(k.caption || k.name)}" loading="lazy" data-hp-img><figcaption>${esc(k.caption || "")}</figcaption></figure>`;
    return "";
  },
  mount(m) {
    m.innerHTML = `<div class="pagehd"><h2>도움말 · 사용자 설명서</h2><span class="sub">화면별 사용법 · 운용 절차 · 점검과 문제 해결. 같은 내용의 Word 설명서가 문서 묶음에 있다</span></div><div class="hp" id="hpBody"><p class="muted">불러오는 중…</p></div>`;
    this.load().then(() => this.paint());
  },
  update() { },
  open(page) { this.pending = page; location.hash = "#help"; if (this.data && document.querySelector("#hpBody")) this.paint(); },
  paint() {
    const B = document.querySelector("#hpBody"), S_ = this.data.sections; if (!B) return;
    if (this.pending) { const hit = S_.find(s => s.page === this.pending); if (hit) this.cur = hit.id; this.pending = null; }
    if (!S_.some(s => s.id === this.cur)) this.cur = (S_[0] || {}).id || "";
    const hits = this.q ? S_.filter(s => JSON.stringify(s).includes(this.q)) : S_, cur = S_.find(s => s.id === this.cur);
    B.innerHTML = `<div class="panel hp-toc"><div class="hd"><input class="in" id="hpQ" placeholder="찾을 글자" value="${esc(this.q)}" style="width:100%"></div><div class="bd np scroll hfill">${hits.map(s => `<a class="hp-link ${s.id === this.cur ? "on" : ""}" data-hp="${esc(s.id)}">${esc(s.title)}</a>`).join("") || `<p class="muted" style="padding:10px">찾는 내용이 없습니다</p>`}</div></div>
      <div class="panel hp-doc"><div class="hd"><h3>${esc(cur ? cur.title : "")}</h3><div class="spacer"></div>${cur && cur.page && cur.page !== "null" ? `<a class="btn sm" href="#${esc(cur.page)}">이 화면으로 가기</a>` : ""}<button class="btn sm" id="hpPrint">인쇄</button></div><div class="bd scroll hfill hp-text" id="hpText">${cur ? cur.blocks.map(k => this.block(k)).join("") : ""}</div></div>`;
    B.querySelector("#hpQ").onchange = e => { this.q = e.target.value.trim(); const h = this.q && this.data.sections.find(s => JSON.stringify(s).includes(this.q)); if (h) this.cur = h.id; this.paint(); };
    B.querySelectorAll("[data-hp]").forEach(a => a.onclick = () => { this.cur = a.dataset.hp; this.paint(); }); B.querySelector("#hpPrint").onclick = () => window.print();
    B.querySelectorAll("[data-hp-img]").forEach(i => i.onerror = () => { i.closest("figure").style.display = "none"; });
  },
};
/* 화면 제목 옆 [?] — 그 화면을 설명하는 절로 */
function decorateHelp(page) { const hd = document.querySelector("#main .pagehd"); if (!hd || page === "help" || hd.querySelector(".hp-q")) return; const b = h(`<button class="btn sm ghost hp-q" title="이 화면의 사용법">? 도움말</button>`); b.onclick = () => P_HELP.open(page); hd.appendChild(b); }
