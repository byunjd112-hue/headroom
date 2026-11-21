"use strict";
/* 교육용 가상 화면의 대역 서버: 실제 EMS 화면 파일을 그대로 쓰되, 서버 대신 가상 장치에서 녹화해 둔 응답(train_data.js 의 TRAIN_DATA)을 돌려준다.
   운용 장소·태세·자동/수동·지령·고장 주입은 녹화해 둔 '장면'을 바꾸는 것으로 흉내 낸다. 값은 녹화한 가상값이며 계산을 새로 하지 않는다.
   실제 EMS 에서는 이 파일을 쓰지 않는다(교육용 묶음의 index.html 만 부른다). */
(function () {
  const D = window.TRAIN_DATA; if (!D) return;
  const st = { mode: "island", posture: "평시", auto: true, extra: "", frame: 0, acked: new Set(), t0: Date.now() };
  window.EMS_TRAIN = { offline: true, state: st };
  const NO = { ok: false, why: "교육용 가상 화면에서는 쓰지 않는 기능입니다 — 실제 EMS 의 가상 장치 모드(run_sim)에서 연습하십시오" };
  const scene = () => { const k = st.extra || `${st.mode}|${st.posture}`; return D.scenes[k] || D.scenes["island|평시"]; };
  const copy = o => JSON.parse(JSON.stringify(o));
  function snapshot() {
    const sc = scene(), s = copy(sc.frames[st.frame++ % sc.frames.length]);
    if (!st.extra || st.extra === "dg_on") { s.auto = st.auto; }
    s.alarms.forEach(a => { if (st.acked.has(a.key)) { a.acked = true; a.ack_by = "교육생"; } });
    if (window.S && S.token) s.me = { role: "engineer", name: "교육생" };
    return s;
  }
  function shiftTrend(t) { const r = copy(t); if (r.rows && r.rows.length) { const d = Date.now() - r.rows[r.rows.length - 1][0]; r.rows.forEach(x => { x[0] += d; }); } return r; }
  function get(path, q) {
    if (path === "/api/snapshot") return snapshot();
    const sc = scene(), key = path + (q.get("unit") ? "?unit=" + q.get("unit") : "") + (q.get("dev") ? "&dev=" + q.get("dev") : "");
    if (path === "/api/trend") return q.get("since") > 0 ? { cols: sc.get["/api/trend"].cols, rows: [] } : shiftTrend(sc.get["/api/trend"]);
    if (path === "/api/trace") return { rows: [], on: false };
    return sc.get[key] || sc.get[path] || D.global[key] || D.global[path] || NO;
  }
  function post(path, b) {
    if (path === "/api/login") return { ok: true, token: "train", role: "engineer", name: (b.name || "교육생") };
    if (path === "/api/logout") return { ok: true };
    if (path === "/api/ops") { if (b.mode) st.mode = b.mode; if (b.posture) st.posture = b.posture; st.extra = ""; st.frame = 0; return { ok: true }; }
    if (path === "/api/auto") { st.auto = b.on === true; return { ok: true }; }
    if (path === "/api/control_now") return { ok: true, why: "" };
    if (path === "/api/select") { const r = copy(D.select); r.dev = b.dev; r.cmd = b.cmd; st.pending = b; return r; }
    if (path === "/api/operate") { const p = st.pending || {}; if (p.dev === "DG" && p.cmd === "start") { st.extra = "dg_on"; st.frame = 0; } else if (p.dev === "DG" && p.cmd === "stop") { st.extra = ""; st.frame = 0; } return { ok: true }; }
    if (path === "/api/cancel") return { ok: true };
    if (path === "/api/ack") { scene().frames[0].alarms.forEach(a => { if (b.ids === "all" || (b.ids || []).includes(a.id)) st.acked.add(a.key); }); return { ok: true, n: 1 }; }
    if (path === "/api/sim") {
      if (b.action === "fault" || b.action === "mute" || b.action === "cb") st.extra = "fault"; else if (b.action === "scenario" && b.name === "grid_outage") { st.mode = "grid"; st.extra = "outage"; } else if (b.action === "scenario") st.extra = "";
      st.frame = 0; return { ok: true };
    }
    if (path === "/api/scenarios/verify") { const names = (b.cases || []).map(c => c.name), res = names.map(n => D.verify[n]).filter(Boolean); return res.length === names.length ? { ok: true, results: res } : NO; }
    if (path === "/api/trace" || path === "/api/trace/clear") return { ok: true, on: false };
    return NO;
  }
  /* 파일 하나짜리(휴대전화용)에서는 그림도 파일 안에 들어 있다(TRAIN_ASSETS). 화면이 그림 경로를 쓰면 그 자리에서 바꿔 끼운다 */
  const A = window.TRAIN_ASSETS;
  if (A) {
    const norm = v => String(v || "").replace(/^\.?\//, "").split("?")[0], swap = v => A[norm(v)];
    const fix = el => {
      if (el.nodeType !== 1) return;
      for (const k of ["src", "href", "xlink:href"]) { const v = el.getAttribute && el.getAttribute(k); if (v && !v.startsWith("data:") && swap(v)) el.setAttribute(k, swap(v)); }
      const st = el.getAttribute && el.getAttribute("style"); if (st && st.includes("url(") && !st.includes("data:")) { const n = st.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => swap(u) ? `url("${swap(u)}")` : m); if (n !== st) el.setAttribute("style", n); }
    };
    const walk = el => { fix(el); if (el.querySelectorAll) el.querySelectorAll("img,image,[style*='url(']").forEach(fix); };
    new MutationObserver(rs => rs.forEach(r => { if (r.type === "attributes") fix(r.target); else r.addedNodes.forEach(walk); })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href", "style"] });
    document.addEventListener("DOMContentLoaded", () => walk(document.body));
  }
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (url, opt) {
    const u = new URL(String(url), "http://ems.local/"), path = u.pathname; opt = opt || {};
    const file = path.replace(/^\//, ""); if (D.files[file]) return new Response(JSON.stringify(D.files[file]), { status: 200, headers: { "Content-Type": "application/json" } });
    if (!path.startsWith("/api/")) return real ? real(url, opt) : new Response("", { status: 404 });
    let body = {}; try { body = typeof opt.body === "string" ? JSON.parse(opt.body) : {}; } catch (e) { body = {}; }
    const out = (opt.method || "GET").toUpperCase() === "POST" ? post(path, body) : get(path, u.searchParams);
    return new Response(JSON.stringify(out), { status: out === NO && /pptx|docx|bundle|csv|import/.test(path) ? 403 : 200, headers: { "Content-Type": "application/json" } });
  };
})();
