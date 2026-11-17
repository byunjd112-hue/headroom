"use strict";
/* 설정 편집기 — 장치별 카드에 대응표를 표로 보이고 그 자리에서 고친다. 바뀐 줄은 초록, 새 줄은 파랑, 지울 줄은 줄긋기.
   저장 전에 서버가 검사하고, 오류가 있으면 저장하지 않는다. 저장한 설정은 EMS 재기동 후 적용된다. */
const CfgEdit = {
  d: null, rows: [], base: [], rt: null, rtBase: "", sel: null, tab: "dev", res: null, q: "",
  COLW: { tag: 122, fc: 40, addr: 50, type: 54, scale: 48, unit: 54, lo: 48, hi: 48, rw: 40, order: 58 },
  LAB: { tag: "이름", fc: "FC", addr: "주소", type: "형", scale: "배율", unit: "단위", lo: "하한", hi: "상한", rw: "R/W", order: "순서" },

  async open(root) {
    this.root = root; root.innerHTML = `<div class="engbox">설정을 불러오는 중…</div>`;
    if (!can("engineer")) { root.innerHTML = `<div class="engbox">설정 편집은 엔지니어 권한이 필요합니다. 오른쪽 위에서 로그인하십시오.</div>`; return; }
    const d = await api("/api/config"); if (!d.ok) { root.innerHTML = `<div class="engbox">불러오기 실패: ${esc(d.why || "")}</div>`; return; }
    this.d = d; this.rows = d.pointmap.rows.map((r, i) => ({ v: r.slice(), o: i, del: false })); this.base = d.pointmap.rows.map(r => r.slice());
    this.rt = JSON.parse(d.runtime.text); this.rtBase = JSON.stringify(this.rt); this.res = null;
    if (!this.sel || !this.rt.devices[this.sel]) this.sel = Object.keys(this.rt.devices)[0];
    this.draw();
  },
  devs() { return Object.keys(this.rt.devices); },
  rowState(r) { return r.del ? "del" : r.o < 0 ? "new" : r.v.some((c, i) => String(c) !== String(this.base[r.o][i])) ? "chg" : ""; },
  dirtyPm() { return this.rows.some(r => this.rowState(r)); },
  dirtyRt() { return JSON.stringify(this.rt) !== this.rtBase; },
  count() { const c = { chg: 0, new: 0, del: 0 }; this.rows.forEach(r => { const s = this.rowState(r); if (s) c[s]++; }); return c; },

  draw() {
    const d = this.d, c = this.count(), pend = d.pending.length;
    this.root.innerHTML = `
      <div class="ce-bar">
        <button class="btn" data-a="reload">↻ 다시 불러오기</button>
        <button class="btn" data-a="check">✓ 검사</button>
        <button class="btn go" data-a="save">저장</button>
        <button class="btn" data-a="undo">편집 취소</button>
        <span class="ce-sep"></span>
        <input class="in" id="ceQ" placeholder="이름·주소 찾기" value="${esc(this.q)}" style="width:170px">
        <span class="ce-stat" id="ceStat"></span>
        <span class="spacer" style="flex:1"></span>
        ${pend ? `<span class="pill warn">저장된 설정이 운전 중인 것과 다름 — EMS 재기동 후 적용</span>` : `<span class="pill ok">운전 중인 설정과 같음</span>`}
        <span class="muted mono" style="font-size:11px">${esc(d.runtime.file)} #${d.runtime.sha} · ${esc(d.pointmap.file)} #${d.pointmap.sha}</span>
      </div>
      <div class="ce-wrap">
        <div class="ce-cards" id="ceCards"></div>
        <div class="ce-side">
          <div class="tabs" id="ceTabs"><button data-t="dev">장치 접속</button><button data-t="res">검사 · 변경 비교</button><button data-t="json">운전 설정</button><button data-t="bak">백업</button></div>
          <div id="ceSide"></div>
        </div>
      </div>`;
    this.root.querySelectorAll(".ce-bar [data-a]").forEach(b => b.onclick = () => this[b.dataset.a]());
    $("#ceQ").oninput = e => { this.q = e.target.value; this.cards(); };
    $$("#ceTabs button").forEach(b => b.onclick = () => { this.tab = b.dataset.t; this.side(); });
    this.cards(); this.side(); this.stat();
  },
  stat() {
    const c = this.count(), rt = this.dirtyRt(), el = $("#ceStat"); if (!el) return;
    el.innerHTML = (c.chg || c.new || c.del || rt) ? `<b class="ce-chg">고침 ${c.chg}</b> · <b class="ce-new">추가 ${c.new}</b> · <b class="ce-del">삭제 ${c.del}</b>${rt ? " · <b class=\"ce-chg\">운전 설정 변경</b>" : ""}` : `<span class="muted">바뀐 내용 없음</span>`;
  },
  cell(r, ri, ci) {
    const col = this.d.pointmap.cols[ci], ch = this.d.choices[col], v = r.v[ci], dirty = r.o >= 0 && String(v) !== String(this.base[r.o][ci]);
    const w = this.COLW[col], at = `data-r="${ri}" data-c="${ci}" class="ce-in ${dirty ? "d" : ""}" style="width:${w}px" ${r.del ? "disabled" : ""}`;
    if (ch) return `<select ${at}>${(ch.includes(String(v)) ? ch : ch.concat([String(v)])).map(o => `<option ${String(o) === String(v) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    return `<input ${at} value="${esc(v)}" spellcheck="false">`;
  },
  cards() {
    const cols = this.d.pointmap.cols, show = cols.map((c, i) => i).filter(i => cols[i] !== "device"), q = this.q.trim().toLowerCase();
    $("#ceCards").innerHTML = this.devs().map(n => {
      const dv = this.rt.devices[n], list = this.rows.map((r, i) => [r, i]).filter(([r]) => r.v[1] === n && (!q || r.v[0].toLowerCase().includes(q) || String(r.v[3]) === q));
      const p = dv.paths || [], chg = JSON.stringify(dv) !== JSON.stringify(JSON.parse(this.rtBase).devices[n] || null);
      return `<div class="ce-card ${this.sel === n ? "on" : ""}" data-n="${n}">
        <div class="ce-hd"><b>${esc(n)}</b><span class="mono muted">unit ${esc(dv.unit)} · ${p.map(x => esc(x[0]) + ":" + esc(x[1])).join(" / ")}</span>${chg ? `<span class="pill ok" style="margin-left:6px">접속 정보 고침</span>` : ""}<span style="flex:1"></span><span class="muted">${list.length}점</span><button class="btn sm" data-add="${n}">＋ 점 추가</button></div>
        <div class="ce-tb"><table><thead><tr>${show.map(i => `<th style="width:${this.COLW[cols[i]]}px">${this.LAB[cols[i]]}</th>`).join("")}<th></th></tr></thead><tbody>
        ${list.map(([r, i]) => `<tr class="${this.rowState(r)}">${show.map(ci => `<td>${this.cell(r, i, ci)}</td>`).join("")}<td class="ce-act"><button data-dup="${i}" title="복제">⧉</button><button data-del="${i}" title="${r.del ? "삭제 취소" : "삭제"}">${r.del ? "↩" : "✕"}</button></td></tr>`).join("") || `<tr><td colspan="11" class="muted" style="padding:8px">해당하는 점 없음</td></tr>`}
        </tbody></table></div></div>`; }).join("");
    const C = $("#ceCards");
    C.querySelectorAll(".ce-card").forEach(k => k.onclick = e => { if (e.target.closest("input,select,button")) return; this.sel = k.dataset.n; this.tab = "dev"; C.querySelectorAll(".ce-card").forEach(x => x.classList.toggle("on", x === k)); this.side(); });
    C.querySelectorAll(".ce-in").forEach(el => el.onchange = () => { const r = this.rows[+el.dataset.r]; r.v[+el.dataset.c] = el.value.trim(); el.closest("tr").className = this.rowState(r); el.classList.toggle("d", r.o >= 0 && el.value.trim() !== String(this.base[r.o][+el.dataset.c])); this.res = null; this.stat(); });
    C.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { const i = +b.dataset.del, r = this.rows[i]; if (r.o < 0) this.rows.splice(i, 1); else r.del = !r.del; this.res = null; this.cards(); this.stat(); });
    C.querySelectorAll("[data-dup]").forEach(b => b.onclick = () => { const i = +b.dataset.dup, v = this.rows[i].v.slice(); v[0] += "_2"; v[3] = String((+v[3] || 0) + 1); this.rows.splice(i + 1, 0, { v, o: -1, del: false }); this.res = null; this.cards(); this.stat(); });
    C.querySelectorAll("[data-add]").forEach(b => b.onclick = () => { const n = b.dataset.add, mine = this.rows.filter(r => r.v[1] === n), mx = Math.max(-1, ...mine.map(r => +r.v[3] || 0));
      let at = this.rows.length; this.rows.forEach((r, i) => { if (r.v[1] === n) at = i + 1; });
      this.rows.splice(at, 0, { v: [n + ".new", n, "3", String(mx + 1), "u16", "1", "", "", "", "r", ""], o: -1, del: false }); this.res = null; this.cards(); this.stat(); });
  },
  side() {
    $$("#ceTabs button").forEach(b => b.classList.toggle("on", b.dataset.t === this.tab)); const S2 = $("#ceSide");
    if (this.tab === "dev") {
      const n = this.sel, dv = this.rt.devices[n], p = dv.paths || [], f = (k, lab, v, ph) => `<label>${lab}<input class="in" data-k="${k}" value="${esc(v ?? "")}" placeholder="${ph || ""}" spellcheck="false"></label>`;
      S2.innerHTML = `<div class="ce-box"><h4>${esc(n)} 접속 정보 <span class="muted">(runtime.json → devices.${esc(n)})</span></h4><div class="ce-form">
        ${f("unit", "Unit ID", dv.unit)}${f("a_ip", "경로 A · IP", (p[0] || [])[0])}${f("a_port", "경로 A · 포트", (p[0] || [])[1])}${f("b_ip", "경로 B · IP", (p[1] || [])[0], "없으면 비움")}${f("b_port", "경로 B · 포트", (p[1] || [])[1])}
        <label>기본 바이트 순서<select class="in" data-k="order">${this.d.choices.order.map(o => `<option ${String(dv.order || "") === o ? "selected" : ""}>${o}</option>`).join("")}</select></label>
        ${f("done_s", "지령 완료 한도(초)", dv.done_s, "기본 1.5")}${f("gap", "블록 읽기 틈", dv.gap, "기본 0")}</div>
        <p class="muted" style="font-size:11.5px;margin:10px 0 0">장치 제작사가 회신한 값으로 고친 뒤 [검사] → [저장] 하십시오. 저장한 값은 EMS 를 다시 기동해야 적용됩니다. 현장 확인은 현장 진단 도구(diag)로 합니다.</p></div>`;
      S2.querySelectorAll("[data-k]").forEach(el => el.onchange = () => this.devSet(n, el.dataset.k, el.value.trim()));
    } else if (this.tab === "res") {
      const r = this.res; S2.innerHTML = !r ? `<div class="ce-box muted">[검사]를 누르면 오류·주의와 저장된 판과의 차이를 여기에 보여 줍니다.</div>` : r.map(x => `<div class="ce-box"><h4>${x.kind === "pointmap" ? "대응표" : "운전 설정"} — ${x.ok ? `<span class="okc">검사 통과</span>` : `<span class="badc">오류 ${x.errors.length}건</span>`} <span class="muted">· 변경 ${x.changed || 0}줄</span></h4>
        ${x.errors.map(e => `<div class="ce-err">✕ ${esc(e)}</div>`).join("")}${x.warnings.map(e => `<div class="ce-warn">! ${esc(e)}</div>`).join("")}
        ${x.diff && x.diff.length ? `<pre class="ce-diff">${x.diff.map(l => `<span class="${l[0] === "+" ? "a" : l[0] === "-" ? "r" : l[0] === "@" ? "h" : ""}">${esc(l)}</span>`).join("\n")}</pre>` : ""}</div>`).join("");
    } else if (this.tab === "json") {
      S2.innerHTML = `<div class="ce-box"><h4>운전 설정 (runtime.json) <span class="muted">— PIN·키는 가려져 있고, 그대로 두면 유지됩니다</span></h4><textarea class="in ce-json" id="ceJson" spellcheck="false">${esc(JSON.stringify(this.rt, null, 1))}</textarea><div id="ceJsonMsg" class="muted" style="font-size:11.5px;margin-top:6px">주둔지 설정(garrison)·현장 정격(site)·제어 주기 등을 고칩니다. 칸 밖을 누르면 문법을 확인합니다.</div></div>`;
      $("#ceJson").onchange = e => { try { const o = JSON.parse(e.target.value); if (!o || typeof o !== "object" || !o.devices) throw new Error("devices 항목이 없음"); this.rt = o; if (!o.devices[this.sel]) this.sel = Object.keys(o.devices)[0]; $("#ceJsonMsg").innerHTML = `<span class="okc">문법 정상</span>`; this.res = null; this.cards(); this.stat(); } catch (err) { $("#ceJsonMsg").innerHTML = `<span class="badc">JSON 문법 오류: ${esc(err.message)}</span>`; } };
    } else {
      const b = this.d.backups; S2.innerHTML = `<div class="ce-box"><h4>백업 <span class="muted">— 저장할 때마다 이전 판을 남깁니다(파일별 최근 20개)</span></h4>${b.length ? `<table class="t"><thead><tr><th>파일</th><th>저장 시각</th><th>크기</th><th></th></tr></thead><tbody>${b.map(x => `<tr><td>${x.kind === "pointmap" ? "대응표" : "운전 설정"}</td><td class="mono">${esc(x.time)}</td><td class="mono">${x.size}</td><td><button class="btn sm" data-bk="${esc(x.name)}">이 판으로 되돌리기</button></td></tr>`).join("")}</tbody></table>` : `<div class="muted">아직 백업이 없습니다.</div>`}</div>`;
      S2.querySelectorAll("[data-bk]").forEach(x => x.onclick = async () => { if (!confirm(`${x.dataset.bk} 판으로 되돌립니다. 지금 판은 백업으로 남습니다.`)) return; const r = await api("/api/config/restore", { name: x.dataset.bk }); if (r.ok) { toast("되돌렸습니다 — EMS 재기동 후 적용", "ok"); this.open(this.root); } else { this.res = [{ kind: x.dataset.bk.split(".")[0], ok: false, errors: r.errors || [r.why || "실패"], warnings: [], diff: [] }]; this.tab = "res"; this.side(); } });
    }
  },
  devSet(n, k, v) {
    const dv = this.rt.devices[n], num = x => x === "" ? null : Number(x); dv.paths = dv.paths || [[]];
    if (k === "unit") dv.unit = num(v);
    else if (k === "a_ip") dv.paths[0][0] = v; else if (k === "a_port") dv.paths[0][1] = num(v);
    else if (k === "b_ip") { if (v) { dv.paths[1] = dv.paths[1] || [v, (dv.paths[0] || [])[1] || 502]; dv.paths[1][0] = v; } else dv.paths.length = 1; }
    else if (k === "b_port") { if (dv.paths[1]) dv.paths[1][1] = num(v); }
    else if (k === "order") { if (v) dv.order = v; else delete dv.order; }
    else if (v === "") delete dv[k]; else dv[k] = num(v);
    this.res = null; this.cards(); this.stat();
  },
  payload() { return { rows: this.rows.filter(r => !r.del).map(r => r.v), sha: this.d.pointmap.sha }; },
  async check(quiet) {
    const out = []; if (this.dirtyRt()) { const r = await api("/api/config/check", { kind: "runtime", text: JSON.stringify(this.rt) }); out.push(Object.assign({ kind: "runtime", errors: [r.why || "실패"], warnings: [], diff: [] }, r)); }
    if (this.dirtyPm() || !out.length) { const r = await api("/api/config/check", Object.assign({ kind: "pointmap" }, this.payload())); out.push(Object.assign({ kind: "pointmap", errors: [r.why || "실패"], warnings: [], diff: [] }, r)); }
    this.res = out; this.tab = "res"; this.side(); const ok = out.every(x => x.ok); if (!quiet) toast(ok ? "검사 통과" : "오류가 있습니다 — 오른쪽 목록을 보십시오", ok ? "ok" : "bad"); return ok;
  },
  async save() {
    if (!this.dirtyPm() && !this.dirtyRt()) return toast("바뀐 내용이 없습니다", "");
    if (!(await this.check(true))) return toast("오류가 있어 저장하지 않았습니다", "bad");
    const c = this.count(); if (!confirm(`설정을 저장합니다.\n대응표: 고침 ${c.chg} · 추가 ${c.new} · 삭제 ${c.del}${this.dirtyRt() ? "\n운전 설정: 변경 있음" : ""}\n\n이전 판은 백업으로 남고, 새 설정은 EMS 를 다시 기동해야 적용됩니다.`)) return;
    const done = [];
    if (this.dirtyRt()) { const r = await api("/api/config/save", { kind: "runtime", text: JSON.stringify(this.rt), sha: this.d.runtime.sha }); if (!r.saved) { this.res = [Object.assign({ kind: "runtime", warnings: [], diff: [], errors: [r.why || "저장 실패"] }, r)]; this.tab = "res"; this.side(); return toast("운전 설정 저장 실패", "bad"); } done.push("운전 설정"); }
    if (this.dirtyPm()) { const r = await api("/api/config/save", Object.assign({ kind: "pointmap" }, this.payload())); if (!r.saved) { this.res = [Object.assign({ kind: "pointmap", warnings: [], diff: [], errors: [r.why || "저장 실패"] }, r)]; this.tab = "res"; this.side(); return toast("대응표 저장 실패", "bad"); } done.push("대응표"); }
    toast(`${done.join("·")} 저장 완료 — EMS 재기동 후 적용`, "ok"); this.tab = "bak"; this.open(this.root);
  },
  undo() { if ((this.dirtyPm() || this.dirtyRt()) && !confirm("편집한 내용을 버리고 저장된 판으로 되돌립니다.")) return; this.open(this.root); },
  reload() { this.undo(); },
};
