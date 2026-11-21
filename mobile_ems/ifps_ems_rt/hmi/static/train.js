"use strict";
/* 교육 창: 실제 EMS 화면 위에 단원 · 과제 · 확인 문제를 얹는다. 과제는 화면의 실제 상태(운용 장소·태세·경보·열어 본 화면)를 보고 스스로 ✔ 한다.
   ① 교육용 가상 화면 묶음(녹화한 값) ② 실제 EMS 의 가상 장치 모드 — 두 곳에서 같은 창을 쓴다. 실장비 모드에서는 열리지 않는다. */
const TRAIN = {
  on: false, cur: 0, seen: new Set(), did: new Set(), ans: {}, who: { name: "", unit: "" }, KEY: "ems.train.v1",
  L: [
    { t: "1. 화면 둘러보기", d: "왼쪽 차림표로 화면을 옮겨 다닌다. 개요는 전체 수급, 결선도는 전기가 흐르는 길, 발전·예측은 앞으로의 태양광과 부하를 보여 준다. 위쪽 줄에는 운용 장소·태세, 자동 제어, 통신 상태가 있다.",
      k: [["개요 화면 열기", c => c.seen.has("overview")], ["결선도 열기", c => c.seen.has("sld")], ["발전·예측 열기", c => c.seen.has("energy")], ["추세 열기", c => c.seen.has("trends")]],
      q: [["ESS 충전율(SOC)은 무엇을 뜻하는가?", ["발전기 회전 속도", "배터리에 전기가 얼마나 차 있는지(%)", "태양광 출력"], 1, "충전율은 배터리가 찬 정도다. 낮으면 발전기가 필요해진다."], ["결선도에서 볼 수 있는 것은?", ["전기가 흐르는 길과 차단기 상태", "장병 근무표", "연료 단가"], 0, "모선·차단기·장치가 어떻게 이어졌는지 본다."]] },
    { t: "2. 로그인과 권한", d: "보기만 할 때는 로그인이 필요 없다. 지령·경보 확인·태세 변경은 운용자, 설정과 고장 주입은 엔지니어 권한이 필요하다. 오른쪽 위 [로그인]을 누른다.",
      k: [["로그인하기(운용자 이상)", c => c.role !== "viewer"]],
      q: [["장치에 기동 지령을 내려면 최소 어떤 권한이 필요한가?", ["조회", "운용자", "권한 없음"], 1, "지령·경보 확인·태세 변경은 운용자부터 할 수 있다."]] },
    { t: "3. 운용 장소와 태세", d: "운용 장소는 작전지(상전 없이 자체 전원)와 주둔지(상전 연계)다. 태세는 평시 · 저소음(디젤 금지, 연료전지 허용, 3등급 부하 차단) · 자립(외부 보급 없이 목표 시간 버티기)이다. 설비 제어 화면에서 바꾼다.",
      k: [["설비 제어 화면 열기", c => c.seen.has("control")], ["태세를 저소음으로 바꾸기", c => c.posture === "저소음"], ["3등급 부하가 자동 차단되는지 확인", c => c.posture === "저소음" && c.shed.includes("L3")], ["태세를 평시로 되돌리기", c => c.did.has("quiet") && c.posture === "평시"]],
      q: [["저소음 태세에서 EMS 가 하는 일은?", ["디젤을 더 많이 돌린다", "디젤을 쓰지 않고 3등급 부하를 차단한다", "모든 부하를 끈다"], 1, "소리를 줄이려고 디젤을 금지하고, 모자라는 만큼 낮은 등급 부하를 끊는다."], ["가장 나중까지 지키는 부하는?", ["3등급", "2등급", "1등급"], 2, "1등급이 가장 중요하다. 차단은 3등급부터 한다."]] },
    { t: "4. 자동 제어와 수동 지령", d: "평소에는 자동 제어가 급전을 맡는다. 수동으로 장치를 켤 때는 '선택 → 실행' 두 번 확인한다(SBO). 선택 창에서 조건을 읽고 [실행]을 눌러야 지령이 나간다.",
      k: [["자동 제어를 해제(수동)하기", c => c.auto === false], ["디젤발전기 기동을 선택 → 실행하기", c => c.dg], ["자동 제어를 다시 켜기", c => c.did.has("manual") && c.auto === true]],
      q: [["'선택 → 실행' 두 단계로 하는 까닭은?", ["화면을 예쁘게 하려고", "잘못 누른 지령이 바로 나가지 않게 하려고", "통신을 빠르게 하려고"], 1, "선택한 대상과 조건을 한 번 더 확인하게 해 오조작을 막는다."]] },
    { t: "5. 주둔지 운전과 상전 상실", d: "주둔지에서는 상전에 연계해 최대부하 시간에 ESS 로 수전을 깎고, 역송은 하지 않는다. 주둔지 자립은 전시·유사시 상전 상실을 뜻한다 — ESS 가 끊김 없이 전압을 만들고 발전기가 붙는다.",
      k: [["운용 장소를 주둔지로 바꾸기", c => c.mode === "grid"], ["태세를 자립으로 바꾸어 상전 상실 상태 보기", c => c.mode === "grid" && (c.posture === "자립" || c.outage)], ["결선도에서 수전 차단기 상태 확인", c => c.did.has("grid") && c.seen.has("sld2")], ["작전지 · 평시로 되돌리기", c => c.did.has("grid") && c.mode === "island" && c.posture === "평시"]],
      q: [["주둔지 '자립' 태세는 어떤 상황인가?", ["전시·유사시 상전 상실", "전기 요금 할인 시간", "장비 점검일"], 0, "상전이 끊긴 상황에서 자체 전원으로 버틴다."], ["상전이 끊긴 순간 전압을 이어 주는 것은?", ["ESS", "수전해", "하늘 카메라"], 0, "ESS 가 바로 전압을 만들어 끊김이 없다."]] },
    { t: "6. 경보와 조치 안내", d: "경보 화면에서 등급 · 발생 시각 · 내용을 보고 [확인]을 누른다. [조치 안내]를 누르면 이상의 종류, 안전 주의, 점검 순서, 도구, 부품이 나온다. 연습을 위해 디버그 화면의 가상 장치 조작으로 고장을 넣을 수 있다.",
      k: [["경보 화면 열기", c => c.seen.has("alarms")], ["경보의 [조치 안내] 열어 보기", c => c.did.has("guide")], ["경보 확인하기(미확인 0건)", c => c.did.has("guide") && c.unack === 0]],
      q: [["차단기 트립 경보가 떴다. 먼저 할 일은?", ["바로 다시 투입한다", "보호 요소와 원인을 확인한다", "경보를 지운다"], 1, "원인을 모른 채 재투입하면 사고가 커진다."], ["전원이 살아 있는 반을 만지기 전 순서는?", ["개방 → 검전 → 접지", "접지 → 투입", "그냥 작업"], 0, "차단기를 열고, 전압이 없는지 재고, 접지한 뒤 작업한다."]] },
    { t: "7. 기록 · 보고서", d: "기록·보고서 화면에서 검침 누적값과 운전 실적을 시간 · 일 · 월 · 년으로 찾아본다. ESS 안전 운영정보는 1분마다 쌓아 주둔지 서버로 넘긴다. [보고서 출력]으로 Word 보고서를 받는다.",
      k: [["기록·보고서 화면 열기", c => c.seen.has("archive")], ["'ESS 안전 기록' 탭 보기", c => c.tabs.has("ess")], ["'장치별 자료' 탭 보기", c => c.tabs.has("device")], ["'서버 전달' 탭 보기", c => c.tabs.has("xfer")]],
      q: [["ESS 안전 운영정보를 현장에 쌓아 두는 까닭은?", ["인터넷으로 보낼 수 없어서 보관했다가 주둔지 서버로 넘기려고", "화면을 채우려고", "배터리를 충전하려고"], 0, "군 시설은 인터넷 전송이 안 되므로 보관 후 전달한다."]] },
    { t: "8. 운영 시나리오와 도움말", d: "운영 시나리오 화면은 운전 순서를 미리 시험하고 시퀀스 문서(PPT)로 내는 곳이다. 모르는 화면에서는 제목 줄의 [? 도움말]을 누르면 그 화면의 사용법이 나온다.",
      k: [["운영 시나리오 화면 열기", c => c.seen.has("scenarios")], ["도움말 열기", c => c.seen.has("help")]],
      q: [["시나리오 검증의 시간 값은 무엇인가?", ["실장비에서 잰 값", "가상 장치에서 본 값(실장비는 시험으로 확인)", "법으로 정한 값"], 1, "가상 장치의 값이다. 실장비 성능은 시험으로 확인한다."]] },
  ],
  FINAL: [["3등급 부하가 자동 차단되는 태세는?", ["평시", "저소음", "없다"], 1], ["연료 경보가 뜨는 기준은?", ["잔량 50% 이하 또는 남은 시간 8시간 이하", "잔량 5% 이하만", "매일 정오"], 0], ["수동 지령의 순서는?", ["실행 → 선택", "선택 → 실행", "선택만"], 1],
    ["통신 두절된 장치에 대해 EMS 는?", ["지령을 막고 마지막 값을 유지한다", "계속 지령을 낸다", "값을 0 으로 만든다"], 0], ["주둔지 평시 운전에서 하지 않는 것은?", ["피크 억제", "역송", "경부하 시간 충전"], 1], ["차단은 어느 등급부터 하는가?", ["1등급", "2등급", "3등급"], 2],
    ["조치 안내 창에서 가장 먼저 읽을 칸은?", ["부품", "안전", "인쇄"], 1], ["ESS 안전 운영정보의 기본 저장 주기는?", ["1분", "1시간", "하루"], 0], ["자립 태세의 목적은?", ["외부 보급 없이 목표 시간 버티기", "전기 요금 절감", "소음 줄이기"], 0], ["경보를 본 뒤 [확인]을 누르는 뜻은?", ["고장이 고쳐졌다", "운용자가 그 경보를 알았다", "경보를 지운다"], 1]],

  load() { try { const j = JSON.parse(localStorage.getItem(this.KEY) || "{}"); this.cur = j.cur || 0; this.seen = new Set(j.seen || []); this.did = new Set(j.did || []); this.ans = j.ans || {}; this.who = j.who || this.who; this.tabs = new Set(j.tabs || []); } catch (e) { this.tabs = new Set(); } if (!this.tabs) this.tabs = new Set(); },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify({ cur: this.cur, seen: [...this.seen], did: [...this.did], ans: this.ans, who: this.who, tabs: [...this.tabs] })); } catch (e) { /* 저장 못 해도 계속 */ } },
  ctx() {
    const s = S.snap || {}, o = s.ops || {}, pg = (location.hash || "#overview").slice(1); this.seen.add(pg); if (s.mode === "grid" && pg === "sld") this.seen.add("sld2");
    if (o.posture === "저소음") this.did.add("quiet"); if (s.auto === false) this.did.add("manual"); if (s.mode === "grid") this.did.add("grid");
    if (pg === "archive" && typeof ARC !== "undefined") this.tabs.add(ARC.tab);
    return { seen: this.seen, did: this.did, tabs: this.tabs, role: S.me.role, mode: s.mode, posture: o.posture, shed: o.shed || [], outage: !!o.outage, auto: s.auto, dg: !!(s.devices && s.devices.DG && s.devices.DG.on), unack: (s.alarms || []).filter(a => !a.acked).length };
  },
  done(i, c) { return this.L[i].k.every(k => k[1](c)) && this.L[i].q.every((q, j) => this.ans[`${i}.${j}`] === q[2]); },
  /* ── 작은 화면(휴대전화·태블릿): 실제 화면판(1920×1080)은 그대로 두고 손가락으로 밀어 보며, 확대·축소 단추를 쓴다. 교육 창은 아래에 붙는다 */
  small() { const touch = matchMedia("(pointer: coarse)").matches; return innerWidth < 1100 || (touch && (innerHeight < 820 || Math.min(screen.width, screen.height) < 820)); },
  fit() {
    const app = document.getElementById("app"); if (!app) return;
    if (!this.small()) { document.documentElement.classList.remove("tr-m"); const sp = document.getElementById("trSpace"); if (sp) sp.remove(); return this._fit(); }
    document.documentElement.classList.add("tr-m"); const base = innerWidth / CANVAS_W, s = Math.min(1.2, Math.max(base, this.zoom || Math.max(base, innerWidth > innerHeight ? 0.45 : 0.55))); this.zoom = s; S.scale = s;
    app.style.transform = `scale(${s})`; let sp = document.getElementById("trSpace"); if (!sp) { sp = document.createElement("div"); sp.id = "trSpace"; document.body.appendChild(sp); }
    sp.style.width = CANVAS_W * s + "px"; sp.style.height = CANVAS_H * s + (this.el ? this.el.offsetHeight : 0) + 12 + "px";
    ["modal", "toast", "stale"].forEach(id => { const e = document.getElementById(id); if (e && e.parentElement !== app) app.appendChild(e); });
  },
  zoomBy(k) { this.zoom = k === 0 ? innerWidth / CANVAS_W : (this.zoom || 0.5) * k; this.fit(); },
  watch() {                 /* 작은 화면에서는 확인 창·알림이 화면 밖에 뜰 수 있어 그쪽으로 옮겨 주고, 알림 글은 교육 창에도 보여 준다 */
    const m = document.getElementById("modal"), t = document.getElementById("toast");
    if (m) new MutationObserver(() => { if (this.small() && m.classList.contains("on")) { const b = document.getElementById("modalBox"); if (b) b.scrollIntoView({ block: "center", inline: "center" }); } }).observe(m, { attributes: true, attributeFilter: ["class"] });
    if (t) new MutationObserver(r => { const n = r.flatMap(x => [...x.addedNodes])[0]; if (n && this.small()) { this.msg = n.textContent; this.paint(true); clearTimeout(this._mt); this._mt = setTimeout(() => { this.msg = ""; this.paint(true); }, 4500); } }).observe(t, { childList: true });
  },
  start() {
    if (this.on) return; this.on = true; this.load();
    const el = document.createElement("div"); el.id = "train"; el.className = "train"; document.body.appendChild(el); this.el = el;
    if (typeof TS !== "undefined") { const o = TS.open.bind(TS); TS.open = a => { this.did.add("guide"); return o(a); }; }
    this._fit = fitCanvas; fitCanvas = () => this.fit(); addEventListener("orientationchange", () => setTimeout(() => this.fit(), 200)); this.watch();      // eslint-disable-line no-global-assign — 화면판 맞춤을 교육 창이 맡는다
    this.min = this.small() && innerHeight < 500;                      // 가로로 든 휴대전화는 화면이 낮아 교육 창을 접은 채로 시작한다
    setInterval(() => this.paint(), 1000); this.paint(true); this.fit();
  },
  paint(force) {
    const c = this.ctx(), n = this.L.length, fin = this.cur === n, key = JSON.stringify([this.cur, this.min, fin ? this.ans : this.L[this.cur].k.map(k => k[1](c)), Object.keys(this.ans).length, this.L.map((_, i) => this.done(i, c))]);
    if (!force && key === this._key) return; this._key = key; this.save();
    const tabs = this.L.map((l, i) => `<button class="tr-tab ${i === this.cur ? "on" : ""} ${this.done(i, c) ? "ok" : ""}" data-l="${i}" title="${esc(l.t)}">${i + 1}</button>`).join("") + `<button class="tr-tab ${fin ? "on" : ""}" data-l="${n}" title="종합 평가">평가</button>`;
    const off = window.EMS_TRAIN && EMS_TRAIN.offline;
    let body;
    if (fin) {
      const sc = this.FINAL.filter((q, j) => this.ans["f." + j] === q[2]).length, all = this.FINAL.every((q, j) => this.ans["f." + j] !== undefined), tasks = this.L.filter((_, i) => this.done(i, c)).length;
      body = `<h4>종합 평가</h4><p class="tr-d">열 문제를 풀고 결과표를 인쇄한다.</p><div class="tr-who"><input class="in sm" id="trName" placeholder="이름" value="${esc(this.who.name)}"><input class="in sm" id="trUnit" placeholder="소속" value="${esc(this.who.unit)}"></div>
        ${this.FINAL.map((q, j) => this.quiz("f." + j, q, j)).join("")}<p class="tr-score">${all ? `점수 ${sc} / ${this.FINAL.length} · 단원 완료 ${tasks} / ${n}` : "모든 문제에 답하면 점수가 나온다"}</p><button class="btn sm" id="trPrint" ${all ? "" : "disabled"}>결과표 인쇄</button>`;
    } else {
      const l = this.L[this.cur];
      body = `<h4>${esc(l.t)}</h4><p class="tr-d">${esc(l.d)}</p><div class="tr-k">${l.k.map(k => `<div class="${k[1](c) ? "ok" : ""}"><i>${k[1](c) ? "✔" : "□"}</i>${esc(k[0])}</div>`).join("")}</div>${l.q.map((q, j) => this.quiz(`${this.cur}.${j}`, q, j)).join("")}`;
    }
    this.el.classList.toggle("min", !!this.min);
    this.el.innerHTML = `<div class="tr-hd"><b>교육</b><span class="sub">${off ? "가상 화면(녹화한 값)" : "가상 장치 모드"}</span><div class="spacer"></div><span class="tr-zoom"><button class="btn sm" id="trZo" title="축소">－</button><button class="btn sm" id="trZf" title="화면 너비에 맞춤">맞춤</button><button class="btn sm" id="trZi" title="확대">＋</button></span><button class="btn sm ghost" id="trMin">${this.min ? "펼치기" : "접기"}</button><button class="btn sm ghost" id="trReset" title="진행 상황 지우기">처음부터</button></div>
      ${this.msg ? `<div class="tr-msg">${esc(this.msg)}</div>` : ""}<div class="tr-tabs">${tabs}</div><div class="tr-bd">${body}</div><div class="tr-ft"><button class="btn sm" id="trPrev" ${this.cur ? "" : "disabled"}>◀ 앞</button><button class="btn sm pri" id="trNext" ${fin ? "disabled" : ""}>다음 ▶</button></div>`;
    const q = s => this.el.querySelector(s);
    this.el.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { this.cur = +b.dataset.l; this.paint(true); });
    this.el.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { this.ans[b.dataset.q] = +b.dataset.a; this.paint(true); });
    q("#trMin").onclick = () => { this.min = !this.min; this.paint(true); this.fit(); }; q("#trZo").onclick = () => this.zoomBy(1 / 1.25); q("#trZi").onclick = () => this.zoomBy(1.25); q("#trZf").onclick = () => this.zoomBy(0); q("#trPrev").onclick = () => { this.cur--; this.paint(true); }; q("#trNext").onclick = () => { this.cur++; this.paint(true); };
    q("#trReset").onclick = () => { if (!confirm("교육 진행 상황을 지우고 처음부터 합니까?")) return; this.seen = new Set(); this.did = new Set(); this.tabs = new Set(); this.ans = {}; this.cur = 0; this.paint(true); };
    if (fin) { q("#trName").onchange = e => { this.who.name = e.target.value.trim().slice(0, 20); this.save(); }; q("#trUnit").onchange = e => { this.who.unit = e.target.value.trim().slice(0, 30); this.save(); }; q("#trPrint").onclick = () => this.print(c); }
  },
  quiz(id, q, j) {
    const a = this.ans[id], ok = a === q[2];
    return `<div class="tr-q"><p>문제 ${j + 1}. ${esc(q[0])}</p>${q[1].map((o, i) => `<button class="tr-o ${a === i ? (ok ? "ok" : "bad") : ""}" data-q="${id}" data-a="${i}">${"①②③"[i]} ${esc(o)}</button>`).join("")}${a !== undefined && q[3] ? `<p class="tr-x ${ok ? "ok" : "bad"}">${ok ? "맞다. " : "다시 생각해 보자. "}${ok ? esc(q[3]) : ""}</p>` : ""}</div>`;
  },
  print(c) {
    const sc = this.FINAL.filter((q, j) => this.ans["f." + j] === q[2]).length, w = window.open("", "_blank"); if (!w) { this.msg = `결과: ${this.who.name || "이름 없음"} · 평가 ${sc}/${this.FINAL.length} · 단원 ${this.L.filter((_, i) => this.done(i, c)).length}/${this.L.length} — 이 화면을 갈무리(캡처)해 제출하십시오`; return this.paint(true); }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>EMS 교육 결과표</title><style>body{font-family:"맑은 고딕",sans-serif;margin:40px;color:#000}table{border-collapse:collapse;width:100%}td,th{border:1px solid #666;padding:6px 10px;text-align:left}h1{font-size:22px}</style>
      <h1>IFPS 이동형 EMS 교육 결과표</h1><table><tr><th>이름</th><td>${esc(this.who.name)}</td><th>소속</th><td>${esc(this.who.unit)}</td></tr><tr><th>일시</th><td>${new Date().toLocaleString("ko-KR")}</td><th>교육 자료</th><td>${esc((S.snap && S.snap.version && S.snap.version.pkg) || "")}</td></tr>
      <tr><th>종합 평가</th><td>${sc} / ${this.FINAL.length}</td><th>단원 완료</th><td>${this.L.filter((_, i) => this.done(i, c)).length} / ${this.L.length}</td></tr></table><h3>단원별</h3><table>${this.L.map((l, i) => `<tr><td>${esc(l.t)}</td><td>${this.done(i, c) ? "완료" : "미완료"}</td></tr>`).join("")}</table>
      <p style="margin-top:30px">확인자: ____________________ (서명)</p>`); w.document.close(); w.print();
  },
};
/* 교육 창 켜기: 교육용 묶음에서는 바로, 실제 EMS 에서는 가상 장치 모드일 때 위쪽 줄의 [교육] 단추로 */
(function () {
  const boot = () => {
    if (window.EMS_TRAIN && EMS_TRAIN.offline) return TRAIN.start();
    const t = setInterval(() => { if (!S.snap) return; clearInterval(t); if (!S.snap.sim) return;
      const b = h(`<button class="btn sm" id="trOpen" title="화면을 보며 따라 하는 교육 창(가상 장치 모드 전용)">교육</button>`); const u = document.querySelector("#user"); if (u && u.parentNode) u.parentNode.insertBefore(b, u); b.onclick = () => { TRAIN.start(); b.remove(); };
      if (/[?&]train=1/.test(location.search)) b.click(); }, 500);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
