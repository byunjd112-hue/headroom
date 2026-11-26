/* 구성 저장 · 불러오기(사용자 요구): 장비 대수 · 모선 구성 · 부하 목록 · 배치도 · 상시 개방점을 이름 붙여 저장하고 다시 불러온다. 서버: hmi/siteprofile.py (POST /api/profile)
   개요의 [구성 저장 · 불러오기] 단추가 연다. 저장 · 지우기는 운용자, 불러오기는 엔지니어(모선 구성을 함께 바꾼다) */
"use strict";
const Profile = {
  async open() { if (!can("operator")) { toast("구성 저장 · 불러오기는 운용자 로그인이 필요합니다", "bad"); return loginDialog(); } const d = await api("/api/profile", { op: "list" }); if (!d.ok) return toast(d.why || "읽지 못했습니다", "bad"); this.show(d); },
  async act(op, name) {
    if (op === "load" && !can("engineer")) { toast("불러오기는 엔지니어 권한(모선 구성을 함께 바꾼다)", "bad"); return loginDialog(); }
    if (op === "load" && !confirm(`'${name}' 구성으로 바꿉니다 — 장비 대수 · 모선 구성 · 부하 목록 · 배치도 · 상시 개방점이 저장된 값으로 돌아갑니다. 계속합니까?`)) return;
    if (op === "del" && !confirm(`저장한 구성 '${name}' 을 지웁니다. 계속합니까?`)) return;
    const d = await api("/api/profile", { op, name }); if (!d.ok) return toast(d.why || "실패", "bad");
    toast(d.msg + ((d.notes || []).length ? " — 맞추지 못한 것: " + d.notes.join(" / ") : ""), (d.notes || []).length ? "warn" : "ok");
    if (op === "load") { if (typeof L !== "undefined") { L.items = null; L.loading = false; } closeModal(); poll(); return; }      // 배치도 · 부하 · 모선을 새로 읽는다
    this.show(d);
  },
  show(d) {
    const rows = d.items.map(i => `<tr><td><b>${esc(i.name)}</b>${i.same ? ' <span class="pill ok">지금 구성</span>' : ""}<div class="muted" style="font-size:12px">${esc(i.brief)}</div></td><td class="mono" style="white-space:nowrap">${esc((i.t || "").slice(0, 16))}<div class="muted">${esc(i.by || "")}</div></td>
      <td style="white-space:nowrap;text-align:right"><button class="btn sm pri" data-pfl="${esc(i.name)}"${i.same ? " disabled" : ""}>불러오기</button> <button class="btn sm" data-pfd="${esc(i.name)}">지우기</button></td></tr>`).join("");
    const box = modal(`<h3>구성 저장 · 불러오기</h3>
      <p class="sub">장비 대수 · 모선 구성 · 부하 목록 · 배치도 · 상시 개방점을 한 묶음으로 저장한다.${d.sim ? "" : " 실장비에서는 대수를 EMS 가 맞추지 못한다(장치를 연결 · 철수해야 바뀐다) — 다르면 알려 준다."}</p>
      <div class="row" style="gap:8px;margin:8px 0"><input id="pfName" class="in" maxlength="30" placeholder="이름(예: 작전지 A · 2호 차량 추가)" style="flex:1"><button class="btn pri" id="pfSave">지금 구성 저장</button></div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">지금: ${esc(d.now)}</div>
      ${d.items.length ? `<table class="t"><thead><tr><th>저장한 구성</th><th>저장한 때</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="muted" style="text-align:center;padding:22px">저장한 구성이 없습니다(최대 ${d.max}개).</div>`}
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="pfClose">닫기</button></div>`);
    box.querySelector("#pfClose").onclick = closeModal;
    box.querySelector("#pfSave").onclick = () => { const n = box.querySelector("#pfName").value.trim(); if (!n) return toast("이름을 적으십시오", "bad"); if (d.items.some(i => i.name === n) && !confirm(`'${n}' 이 이미 있습니다. 덮어씁니까?`)) return; this.act("save", n); };
    box.querySelectorAll("[data-pfl]").forEach(b => { b.onclick = () => this.act("load", b.dataset.pfl); });
    box.querySelectorAll("[data-pfd]").forEach(b => { b.onclick = () => this.act("del", b.dataset.pfd); });
  },
};
document.addEventListener("click", e => { const a = e.target.closest('[data-act="profile"]'); if (a) { e.preventDefault(); Profile.open(); } });
