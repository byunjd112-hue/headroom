// 보고자료용 화면 캡처. 가상 장치 모드 제어화면(기본 http://127.0.0.1:8088)에 접속해 docs/ppt/img 에 PNG 로 저장한다.
//   python -m ifps_ems_rt.hmi config/runtime.json --sim --plan results --port 8088   (다른 창에서 먼저 실행)
//   node docs/ppt/capture.js [주소] && python docs/ppt/to_jpg.py
// 화면이 바뀐 리비전에서는 다시 찍어 보고자료와 실제 화면이 어긋나지 않게 한다. 약 5분 걸린다(추세가 쌓일 시간 포함).
const { chromium } = require("playwright"); const B = process.argv[2] || "http://127.0.0.1:8088/", D = __dirname + "/img/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs = [];
  p.on("pageerror", e => errs.push(String(e))); p.on("dialog", d => d.accept());
  await p.goto(B);
  const tok = await p.evaluate(async () => { const r = await (await fetch("/api/login", { method: "POST", body: JSON.stringify({ pin: "2222", name: "김상사" }) })).json(); sessionStorage.setItem("ems.token", r.token); return r.token; });
  const post = (path, body) => p.evaluate(async ([tok, path, body]) => (await fetch(path, { method: "POST", headers: { "X-EMS-Token": tok }, body: JSON.stringify(body) })).json(), [tok, path, body]);
  const sim = body => post("/api/sim", body);
  const go = async (pg, name, ms = 1500) => { await p.goto(B + "#" + pg); await p.waitForTimeout(ms); if (name) await p.screenshot({ path: D + name + ".png" }); };
  await post("/api/ops", { mode: "island" }); await post("/api/ops", { posture: "평시" }); await sim({ action: "scenario", name: "normal" });
  await p.reload(); await p.waitForTimeout(150000);                                   // 추세 그래프가 쌓일 시간
  // 1) 평상시(작전지)
  await go("overview", "overview", 2500); await go("sld", "sld", 2500); await go("energy", "energy", 7000); await go("control", "control"); await go("comm", "comm");
  await go("trends", null, 1500); await p.click('#trWin [data-w="300"]'); await p.waitForTimeout(2500); await p.screenshot({ path: D + "trends.png" });
  await go("control", null, 1200); await p.click('button[data-c="start"][data-d="DG"]'); await p.waitForTimeout(900); await p.screenshot({ path: D + "sbo.png" }); await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  await go("eng"); await p.click('#engTabs [data-t="explorer"]'); await p.waitForTimeout(500); await p.selectOption("#exTgt", "MTR|A"); await p.selectOption("#exFc", "4"); await p.fill("#exAddr", "0"); await p.fill("#exCnt", "8"); await p.click("#exRead"); await p.waitForTimeout(900); await p.screenshot({ path: D + "eng_explorer.png" });
  await p.click('#engTabs [data-t="trace"]'); await p.waitForTimeout(2500); const row = await p.$("#trRows tr[data-i]"); if (row) await row.click(); await p.waitForTimeout(400); await p.screenshot({ path: D + "eng_trace.png" });
  await p.click('#engTabs [data-t="points"]'); await p.waitForTimeout(1500); await p.screenshot({ path: D + "eng_points.png" });
  await p.click('#engTabs [data-t="sim"]'); await p.waitForTimeout(1200); await p.screenshot({ path: D + "eng_sim.png" });
  await go("overview", null, 1500); await p.click('[data-act="layedit"]'); await p.waitForTimeout(800); const it = await p.$(".meq"); if (it) { const bb = await it.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); } await p.waitForTimeout(500); await p.screenshot({ path: D + "layedit.png" });
  await p.click('[data-act="layedit"]'); await p.waitForTimeout(600);
  // 2) 고장: 2등급 급전선 과전류 트립 + 연료전지 통신 두절
  await sim({ action: "fault", target: "L2", code: 51 }); await sim({ action: "mute", target: "FC", on: true }); await p.waitForTimeout(6000);
  await go("overview", "fault_overview", 2000); await go("sld", "fault_sld"); await go("alarms", "alarms"); await go("comm", "fault_comm");
  await sim({ action: "scenario", name: "normal" }); await p.waitForTimeout(5000); await post("/api/ack", { ids: "all" });
  // 3) 주둔지: 상전 연계 → 정전
  await post("/api/ops", { mode: "grid" }); await p.waitForTimeout(6000);
  await go("control", "r18_ctl_garrison"); await go("sld", "r18_sld_garrison", 2000); await go("overview", "r18_ov_garrison", 2000);
  await sim({ action: "scenario", name: "grid_outage" }); await p.waitForTimeout(5000); await go("sld", "r18_sld_outage", 1500);
  await p.waitForTimeout(50000); await go("control", "r20_ctl_gdg", 2000); await go("sld", "r20_sld_gdg", 2000);                 // 정전 30초 지속 → 주둔지 기존 디젤발전기 기동
  await sim({ action: "scenario", name: "grid_restore" }); await post("/api/ops", { mode: "island" }); await p.waitForTimeout(3000); await post("/api/ack", { ids: "all" });
  // 4) 작전지 저소음 태세 → 3등급 자동 차단
  await post("/api/ops", { posture: "저소음" }); await p.waitForTimeout(7000); await go("control", "r18_ctl_quiet"); await go("overview", "r18_ov_quiet", 1500);
  await post("/api/ops", { posture: "평시" });
  // 5) 로그인 창
  await p.evaluate(() => { sessionStorage.removeItem("ems.token"); }); await p.goto(B + "#overview"); await p.reload(); await p.waitForTimeout(1500); await p.evaluate(() => loginDialog()); await p.waitForTimeout(500); await p.screenshot({ path: D + "login.png" });
  console.log("화면 오류", errs.slice(0, 5)); await b.close();
})();
