// 화면 배치 점검: 모든 화면 · 탭 · 도움말 각 절에서 ① 내용이 잘리는데 스크롤이 없는 곳 ② 표의 붙박이 머리가 틈을 두고 붙는 곳 ③ 화면 오류를 찾는다.
//   python -m ifps_ems_rt.hmi config/runtime.json --sim --plan results --port 8088   (다른 창에서 먼저 실행)
//   node tools/layout_check.js   — 약 8분, 문제 0 이어야 한다
const { chromium } = require("playwright"); const B = "http://127.0.0.1:8088/";
(async () => { const b = await chromium.launch(); let n = 0, bad = 0; const errs = [];
  for (const [W, H] of [[1920, 1080]]) { const p = await b.newPage({ viewport: { width: W, height: H } }); p.on("pageerror", e => errs.push(String(e))); p.on("dialog", d => d.accept());
    await p.goto(B); await p.evaluate(async () => { const r = await (await fetch("/api/login", { method: "POST", body: JSON.stringify({ pin: "2222", name: "김상사" }) })).json(); sessionStorage.setItem("ems.token", r.token); });
    const scan = () => p.evaluate(() => { const res = [], seen = new Set(), name = e => `${e.tagName}.${String(e.id || e.className).slice(0, 30)}`;
      document.querySelectorAll("main, main *").forEach(e => { const cs = getComputedStyle(e); if (e instanceof SVGElement || e.closest("svg")) return;
        if (cs.overflowY === "hidden" && e.clientHeight > 120 && e.scrollHeight > e.clientHeight + 12 && cs.textOverflow !== "ellipsis") res.push(`잘림 ${name(e)} ${e.scrollHeight}>${e.clientHeight}`);
        if (cs.position === "sticky" && cs.top !== "auto") { let s = e.parentElement; while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
          if (s && s.tagName !== "MAIN" && !seen.has(s)) {      /* 본문(main)이 스크롤 상자인 짧은 표는 머리가 맨 위까지 올라가지 않는다 */ seen.add(s); if (parseFloat(getComputedStyle(s).paddingTop) > 0.5) res.push(`머리 틈 ${name(e)} in ${name(s)}`); } } }); return res; });
    for (const pg of ["overview", "sld", "ring", "energy", "trends", "control", "scenarios", "alarms", "archive", "comm", "eng", "help"]) { await p.goto(B + "#" + pg); await p.reload(); await p.waitForTimeout(2800);
      const sel = pg === "help" ? "main .hp-link" : "main [data-t], main [data-u], main [data-view]", k = await p.evaluate(s => document.querySelectorAll(s).length, sel);
      for (let i = -1; i < k; i++) { if (i >= 0) { await p.evaluate(([s, i]) => { const e = document.querySelectorAll(s)[i]; if (e) e.click(); }, [sel, i]).catch(() => {}); await p.waitForTimeout(pg === "help" ? 350 : 1100); }
        const r = await scan(); n++; if (r.length) { bad++; console.log(`${W}x${H}`, pg, i, JSON.stringify(r).slice(0, 330)); } } }
    await p.close(); }
  console.log(`본 화면 · 탭 ${n} · 문제 ${bad} · 화면 오류 ${errs.length}`, errs.slice(0, 3)); await b.close(); process.exit(bad || errs.length ? 1 : 0); })();
