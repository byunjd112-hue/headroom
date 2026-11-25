/* 모선 구성: 전원 · 부하 급전선이 모선 A · B 가운데 어디에 물렸는지. 스냅샷의 bus 를 결선도 · 운영 시나리오 구성도 · 개요가 같이 읽는다. 서버: hmi/busctl.py · ifps_ems_rt/busplan.py
   개요 배치도에 놓인 좌 → 우 순서도 여기서 정한다(BusPlan.order) — 결선도와 시나리오 구성도가 같은 순서로 그린다. */
const BusPlan = {
  LAY: { PV: "PV", DG: "DG", G1: "DG", FC: "FC", ESS: "ESS" },             // 결선도의 전원 ↔ 개요 배치도의 그림 종류(복합전력 차량 = 디젤 + 복합전력 ESS)
  s() { return (S.snap && S.snap.bus) || null; },
  of(id, dflt) { const b = this.s(); return (b && b.assign[id]) || dflt; },
  /* 그 종류의 장비가 물린 모선들(추가 장비가 다른 모선에 있으면 둘 다): "A" · "B" · "A·B" */
  all(id) { const b = this.s(); if (!b) return ""; return [...new Set([b.assign[id], ...(b.units || []).filter(u => u.kind === id).map(u => u.bus)])].filter(Boolean).sort().join("·"); },
  /* 종류와 다른 모선에 물린 추가 장비 요약(결선도 위의 띠) */
  split() { const b = this.s(), d = b ? (b.units || []).filter(u => u.bus !== b.assign[u.kind]) : []; return d.length ? `<div class="engbox" style="margin-bottom:10px"><b>호기별 모선</b> — ${d.map(u => `${esc(u.name)} → 모선 ${u.bus}`).join(" · ")} <span class="muted">(결선도의 전원 그림은 종류마다 하나 — 첫 장비의 모선에 그린다)</span> <a href="#" data-act="busplan" style="color:var(--accent)">[모선 구성 열기]</a></div>` : ""; },
  /* 개요 배치도에서 그 전원 그림의 가로 자리(없으면 상전 · 주둔지 발전기는 맨 왼쪽, 나머지는 원래 순서) */
  ox(id, i) { const k = this.LAY[id], it = k && typeof L !== "undefined" && L.items && L.items.find(q => q.kind === k); return it ? it.x : id === "GRID" || id === "GDG" ? -1e6 + i : 1e6 + i; },
  /* 한 모선의 전원 · 부하를 개요의 좌 → 우 순서로 [x0, x1] 사이에 고르게 놓는다. nodes: [{id, x, bus}] 를 고쳐 쓴다 */
  place(nodes, home, bus, x0, x1, loadX) {
    const mine = nodes.filter(n => this.of(n.id, home[n.id]) === bus).sort((p, q) => (loadX ? loadX(p.id) - loadX(q.id) : this.ox(p.id, nodes.indexOf(p)) - this.ox(q.id, nodes.indexOf(q))) || nodes.indexOf(p) - nodes.indexOf(q));
    mine.forEach((n, i) => { n.bus = bus; n.x = mine.length === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (mine.length - 1); });
  },
  sig() { const b = this.s(); return b ? JSON.stringify(b.assign) + JSON.stringify((b.units || []).map(u => [u.id, u.bus])) + "|" + (typeof L !== "undefined" && L.items ? Object.values(this.LAY).map(k => { const it = L.items.find(q => q.kind === k); return it ? Math.round(it.x) : ""; }).join(",") : "") : ""; },
  /* 약점 요약(결선도 위의 띠 · 개요의 안내) */
  banner() {
    const b = this.s(); if (!b || !b.issues.length) return "";
    const bad = b.issues.filter(i => i.level === "bad").length;
    return `<div class="engbox" style="margin-bottom:10px;border-color:${bad ? "var(--alarm)" : "var(--warn)"}"><b class="${bad ? "badc" : "warnc"}">모선 구성 점검 ${b.issues.length}건</b> — ${b.issues.map(i => esc(i.text)).join(" ")} <a href="#" data-act="busplan" style="color:var(--accent)">[모선 구성 열기]</a></div>`;
  },
  async post(body) { if (!can("engineer")) { toast("엔지니어 권한 필요", "bad"); return loginDialog(); } const r = await api("/api/bus", body); toast(r.ok ? r.msg : r.why, r.ok ? "ok" : "bad"); if (r.ok) { S.snap.bus = r.bus; this.dialog(); } },
  dialog() {
    const b = this.s(); if (!b) return; const fixable = b.issues.some(i => i.fix);
    const pick = (name, cur) => ["A", "B"].map(x => `<label style="margin:0 10px;white-space:nowrap"><input type="radio" name="${name}" value="${x}" ${cur === x ? "checked" : ""}> 모선 ${x}</label>`).join("");
    const srow = u => `<tr class="${u.present ? "" : "muted"}"><td><b>${esc(u.name)}</b>${u.present ? "" : ' <span class="muted">(지금 없음)</span>'}</td><td style="text-align:center">${pick("bs-" + u.id, u.bus)}</td><td class="muted"></td></tr>`;
    const lrow = u => `<tr><td><b>${esc(u.name)}</b> <span class="pill ${u.grade === 1 ? "bad" : u.grade === 2 ? "warn" : "info"}">${u.grade}등급</span></td><td style="text-align:center">${pick("bl-" + u.id, u.bus)}</td><td class="muted">${esc(u.fsu_name)}</td></tr>`;
    modal(`<h3>모선 구성 — 장비 · 부하 하나하나가 물린 모선</h3><p class="sub">전원은 한 대씩, 부하는 하나씩 모선 A · B 를 고른다. 실제 결선을 EMS 에 알려 주는 값이다 — 여기서 바꾼다고 케이블이 옮겨지지 않는다(결선을 바꾼 뒤, 또는 바꾸기 전에 검토하려고 맞춘다). 바꾸면 결선도 · 운영 시나리오 구성도 · 가상 장치의 모선 전압 계산 · 환망이 함께 바뀐다.</p>
      <div class="scroll" style="max-height:52vh"><table class="t"><thead><tr><th>전원(한 대씩)</th><th style="text-align:center">물린 모선</th><th></th></tr></thead><tbody>${(b.sources || []).map(srow).join("")}</tbody>
      <thead><tr><th>부하(하나씩)</th><th style="text-align:center">받는 모선</th><th>물린 구간분전함</th></tr></thead><tbody>${(b.loads || []).map(lrow).join("") || '<tr><td colspan="3" class="muted">부하 목록이 비어 있다</td></tr>'}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">부하는 환망의 구간분전함에 물려 있고, 구간분전함은 상시 개방점 앞쪽이면 모선 A(급전 A), 뒤쪽이면 모선 B(급전 B)에서 받는다. 부하의 모선을 바꾸면 그 모선 쪽 구간분전함(출력 회로가 남은 곳)으로 옮겨지고 배전체계와 우회 결선이 따라간다 — 구간분전함을 직접 고르려면 부하 관리의 '공급 경로'에서 고른다.</p>
      <h4 style="margin:14px 0 6px">점검 결과</h4>${b.issues.length ? `<ul style="margin:0;padding-left:18px">${b.issues.map(i => `<li class="${i.level === "bad" ? "badc" : "warnc"}">${esc(i.text)}</li>`).join("")}</ul>` : '<p class="okc" style="margin:0">약점 없음 — 두 모선 모두 전압을 세울 전원이 있다.</p>'}
      <p class="muted" style="font-size:12px;margin:10px 0 0">점검: ① 모선마다 전압을 세울 전원(이동형 ESS · 복합전력 ESS)이 있는가 ② 1등급 부하의 모선에 전원이 있는가 ③ 연계 차단기가 열려도 모선별 전원 정격이 부하 정격을 감당하는가 ④ 전원이 한 모선에 몰리지 않았는가.${b.by ? ` 마지막 변경: ${esc(b.by)} · ${esc(b.t)}` : ""}</p>
      <div class="acts" style="margin-top:14px"><button class="btn go" id="bpAuto" ${fixable ? "" : "disabled"}>자동 보완</button><button class="btn" id="bpReset">기본 구성으로</button><div class="spacer"></div><button class="btn" data-act="close">닫기</button></div>`, box => {
      box.querySelectorAll('input[type="radio"]').forEach(r => r.onchange = () => this.post(r.name.startsWith("bl-") ? { op: "load", id: r.name.slice(3), bus: r.value } : { op: "set", node: r.name.slice(3), bus: r.value }));
      box.querySelector("#bpAuto").onclick = () => this.post({ op: "auto" }); box.querySelector("#bpReset").onclick = () => { if (confirm("전원의 모선 구성을 기본으로 되돌립니다(부하의 자리는 그대로). 계속합니까?")) this.post({ op: "reset" }); };
    });
  },
};
document.addEventListener("click", e => { const a = e.target.closest('[data-act="busplan"]'); if (a) { e.preventDefault(); BusPlan.dialog(); } });
