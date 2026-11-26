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
  await sim({ action: "clock", hour: 13 });                                             // 밤에 찍어도 태양광이 보이게 모의 시각을 낮 13시로
  await p.reload(); await p.waitForTimeout(150000);                                   // 추세 그래프가 쌓일 시간
  // 1) 평상시(작전지)
  await go("overview", "overview", 2500); await go("sld", "sld", 2500); await go("energy", "energy", 7000); await go("control", "control"); await go("comm", "comm");
  await go("trends", null, 1500); await p.click('#trWin [data-w="300"]'); await p.waitForTimeout(2500); await p.screenshot({ path: D + "trends.png" });
  await go("control", null, 1200); await p.click('button[data-c="start"][data-d="DG"]'); await p.waitForTimeout(900); await p.screenshot({ path: D + "sbo.png" }); await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  await go("eng"); await p.click('#engTabs [data-t="explorer"]'); await p.waitForTimeout(500); await p.selectOption("#exTgt", "MTR|A"); await p.selectOption("#exFc", "4"); await p.fill("#exAddr", "0"); await p.fill("#exCnt", "8"); await p.click("#exRead"); await p.waitForTimeout(900); await p.screenshot({ path: D + "eng_explorer.png" });
  await p.click('#engTabs [data-t="trace"]'); await p.waitForTimeout(2500); const row = await p.$("#trRows tr[data-i]"); if (row) await row.click().catch(() => {});     /* 추적 표가 그 사이 다시 그려지면 건너뛴다 */ await p.waitForTimeout(400); await p.screenshot({ path: D + "eng_trace.png" });
  await p.click('#engTabs [data-t="points"]'); await p.waitForTimeout(1500); await p.screenshot({ path: D + "eng_points.png" });
  await p.click('#engTabs [data-t="sim"]'); await p.waitForTimeout(1200); await p.screenshot({ path: D + "eng_sim.png" });
  // 설정 편집: 화면에서만 고쳐 보이고(배율 고침·점 추가·검사) 저장하지 않는다
  await p.click('#engTabs [data-t="config"]'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const E = CfgEdit, i = E.rows.findIndex(r => r.v[0] === "DG.fuel_l"); E.rows[i].v[5] = "0.1"; let at = 0; E.rows.forEach((r, k) => { if (r.v[1] === "DG") at = k + 1; });
    E.rows.splice(at, 0, { v: ["DG.kwh", "DG", "3", "20", "u32", "0.1", "kWh", "", "", "r", "CDAB"], o: -1, del: false }); E.rt.devices.DG.done_s = 8; E.cards(); E.stat(); });
  await p.click('.ce-bar [data-a="check"]'); await p.waitForTimeout(1500); await p.screenshot({ path: D + "eng_config.png" });
  await go("overview", null, 1500); await p.click('[data-act="layedit"]'); await p.waitForTimeout(800); const it = await p.$(".meq"); if (it) { const bb = await it.boundingBox(); await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); } await p.waitForTimeout(500); await p.screenshot({ path: D + "layedit.png" });
  await p.click('[data-act="layedit"]'); await p.waitForTimeout(600);
  // 지속 학습 상태 창(학습 한 번 돌린 뒤)
  await post("/api/ai/train", {}); for (let i = 0; i < 80; i++) { await p.waitForTimeout(3000); const a = await p.evaluate(async () => (await fetch("/api/ai")).json()); if (!a.busy && a.history.length) break; }
  await go("scenarios", null, 2500); await p.evaluate(() => P_SCENARIOS.choose(c => (c.cat || "").endsWith("운전 모드"))); await p.waitForTimeout(600);
  await p.click('[data-sc="pick"]'); await p.waitForTimeout(700); await p.evaluate(() => document.querySelector('[data-pk-cat^="고장 대응"]').click()); await p.waitForTimeout(500); await p.screenshot({ path: D + "scen_pick.png" }); await p.evaluate(() => document.querySelector('[data-pk-cat=""]').click()); await p.click('[data-pk="close"]');
  await p.evaluate(() => P_SCENARIOS.use("주둔지 · 정전·예비 발전기·복전")); await p.waitForTimeout(600); await p.click('[data-sc="verify"]').catch(() => {}); await p.waitForTimeout(8000); await p.click('.sq-row[data-step="4"]').catch(() => {}); await p.waitForTimeout(500); await p.screenshot({ path: D + "scenarios.png" });
  await p.click('[data-view="topo"]').catch(() => {}); await p.waitForTimeout(600); await p.click('.sp-dot[data-step="12"]').catch(() => {}); await p.waitForTimeout(900); await p.evaluate(() => document.querySelector(".tp-wrap")?.scrollIntoView({ block: "center" })); await p.waitForTimeout(400); await p.screenshot({ path: D + "scen_topo.png" });
  await p.evaluate(() => P_SCENARIOS.use("환망 · 구간 단선 → 구간 차단 → 반대쪽 공급")); await p.waitForTimeout(500); await p.click('[data-sc="verify"]').catch(() => {}); await p.waitForTimeout(8000);
  await post("/api/ring", { do: "sim", action: "break", section: 2, on: true }); await go("ring", "scen_ring", 9000); await post("/api/ring", { do: "sim", action: "break", section: 2, on: false }); await p.waitForTimeout(7000);      // 환망 그림은 환망 화면에서 찍는다(시나리오 화면에는 환망 그림을 두지 않는다)
  await go("loads", "loads", 2500);      // 부하 관리 화면
  await go("scenarios", null, 1500);
  await p.evaluate(() => P_SCENARIOS.use("보호 협조 · 3등급 과부하 선택 차단")); await p.waitForTimeout(500);
  await p.click('[data-sc="verify"]').catch(() => {}); await p.waitForTimeout(8000);
  await p.click('.sp-dot[data-step="2"]').catch(() => {}); await p.waitForTimeout(900); await p.evaluate(() => document.querySelector(".tp-wrap")?.scrollIntoView({ block: "center" })); await p.waitForTimeout(400); await p.screenshot({ path: D + "scen_prot.png" });
  await p.click('[data-sc="extra"]').catch(() => {}); await p.waitForTimeout(1200); await p.screenshot({ path: D + "scen_extra.png" }); await p.evaluate(() => closeModal());
  await p.click('[data-view="seq"]').catch(() => {}); await p.evaluate(() => { try { localStorage.setItem("ems.scenario.view", "seq"); } catch (_) {} });
  await post("/api/ring", { do: "sim", action: "break", section: 2 }); await go("ring", null, 8000); await p.click('[data-pp="PPDU2"]').catch(() => {}); await p.waitForTimeout(700); await p.screenshot({ path: D + "ring.png" }); await post("/api/ring", { do: "sim", action: "restore" });
  await post("/api/ring", { do: "sim", action: "shuffle" }); await post("/api/ring", { do: "sim", action: "remove", id: "FSU7" }); await post("/api/ring", { do: "sim", action: "add", kind: "ppdu", at: 1 }); await p.waitForTimeout(3500); await p.click("#rgDisc"); await p.waitForTimeout(8500); await p.screenshot({ path: D + "ring_disc.png" }); await p.click("#dcClose");
  await post("/api/ring", { do: "sim", action: "restore" }); await p.waitForTimeout(3000); await p.click("#rgCfg"); await p.waitForTimeout(800); await p.screenshot({ path: D + "ring_cfg.png" }); await p.click("#cfNo"); await post("/api/ack", { ids: "all" });
  // 이동형 배전체계 기술자료용: 평소의 환망(부하 앞 배전체계 · 우회 결선), 정격 · 가정값 창, 무정전 점검 표, 구간분전함 고립(우회 공급)
  await p.waitForTimeout(6000); await go("ring", "ring_ok", 6000); await p.click("#rgSpec"); await p.waitForTimeout(900); await p.screenshot({ path: D + "ring_spec.png" }); await p.click("#spNo"); await p.waitForTimeout(600);
  await post("/api/ring", { do: "sim", action: "break", section: 1 }); await post("/api/ring", { do: "sim", action: "break", section: 2 }); await go("ring", "ring_iso", 9000);
  await p.evaluate(() => { const h = [...document.querySelectorAll("#rgBody h3")].find(e => /무정전 점검/.test(e.textContent)); if (h) h.closest(".panel").scrollIntoView({ block: "start" }); }); await p.waitForTimeout(700); await p.screenshot({ path: D + "ring_n1.png" });
  await post("/api/ring", { do: "sim", action: "restore" }); await p.waitForTimeout(7000); await post("/api/ack", { ids: "all" });
  await go("archive", null, 2500); await p.screenshot({ path: D + "archive.png" });
  await p.click('#arcTabs button[data-t="ess"]'); await p.waitForTimeout(1200); await p.screenshot({ path: D + "arch_ess.png" });
  await p.click('#arcTabs button[data-t="device"]'); await p.waitForTimeout(1200); await p.click('[data-d="FC"]').catch(() => {}); await p.waitForTimeout(1200); await p.screenshot({ path: D + "arch_dev.png" });
  await p.click('#arcTabs button[data-t="collect"]'); await p.waitForTimeout(1500); await p.screenshot({ path: D + "arch_collect.png" });
  await go("help", null, 2000); await p.screenshot({ path: D + "help.png" }); await go("archive", null, 2000);
  await p.click('#arcTabs button[data-t="xfer"]'); await p.waitForTimeout(1000); await post("/api/archive/xfer/make", { from: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), to: new Date(Date.now() - 864e5).toISOString().slice(0, 10) }).then(r => r.row && post("/api/archive/xfer/mark", { id: r.row.id, note: "보안 USB → 주둔지 서버(캡처용 예시)" }));
  await post("/api/archive/xfer/make", {}); await p.click('#arcTabs button[data-t="xfer"]'); await p.waitForTimeout(1500); await p.screenshot({ path: D + "arch_xfer.png" }); await p.click('#arcTabs button[data-t="meter"]');
  await go("energy", null, 9000); await p.click("#enAi"); await p.waitForTimeout(1500); await p.screenshot({ path: D + "ai_learn.png" }); await p.evaluate(() => closeModal());
  // 2) 고장: 2등급 급전선 과전류 트립 + 연료전지 통신 두절
  await sim({ action: "fault", target: "L2", code: 51 }); await sim({ action: "mute", target: "FC", on: true }); await p.waitForTimeout(6000);
  await go("overview", "fault_overview", 2000); await go("sld", "fault_sld"); await go("alarms", "alarms"); await p.evaluate(() => { const b = [...document.querySelectorAll("#almRows tr")].find(r => r.textContent.includes("트립")); (b || document).querySelector("[data-ts]")?.click(); }); await p.waitForTimeout(900); await p.screenshot({ path: D + "alarm_guide.png" }); await p.evaluate(() => closeModal()); await go("comm", "fault_comm");
  await sim({ action: "scenario", name: "normal" }); await p.waitForTimeout(5000); await post("/api/ack", { ids: "all" });
  // 3) 주둔지: 상전 연계 → 정전
  await post("/api/ops", { mode: "grid" }); await p.waitForTimeout(6000);
  await go("control", "r18_ctl_garrison"); await go("sld", "r18_sld_garrison", 2000); await go("overview", "r18_ov_garrison", 2000);
  await sim({ action: "scenario", name: "grid_outage" }); await p.waitForTimeout(5000); await go("sld", "r18_sld_outage", 1500);
  await sim({ action: "scenario", name: "cloud" });                                     // 구름으로 태양광이 부하보다 작아진 상황(태양광만으로 충분하면 발전기를 켜지 않는다)
  await p.waitForTimeout(50000); await go("control", "r20_ctl_gdg", 2000); await go("sld", "r20_sld_gdg", 2000);                 // 정전 30초 지속 → 주둔지 기존 디젤발전기 기동
  await sim({ action: "scenario", name: "grid_restore" }); await sim({ action: "release", tag: "PV.kw" }); await post("/api/ops", { mode: "island" }); await p.waitForTimeout(3000); await post("/api/ack", { ids: "all" });
  // 4) 작전지 저소음 태세 → 3등급 자동 차단
  await post("/api/ops", { posture: "저소음" }); await p.waitForTimeout(7000); await go("control", "r18_ctl_quiet"); await go("overview", "r18_ov_quiet", 1500);
  await post("/api/ops", { posture: "평시" });
  // 4-0) 날씨 입력(흐림) → 예측에 반영된 모습
  await post("/api/weather", { do: "manual", sky: "대체로 흐림", pop: 40, temp: 11, hours: 12, note: "날씨 앱 기준" }); await p.waitForTimeout(9000); await go("energy", null, 7000);
  await p.evaluate(() => document.querySelector("#wxPanel")?.scrollIntoView({ block: "end" })); await p.waitForTimeout(1500); await p.screenshot({ path: D + "weather.png" });
  // 4-1) 같은 종류 장치를 한 대씩 더 놓는다 → 조작 없이 개요·결선도가 다시 짜인다
  for (const n of ["DG2", "ESS2", "PV2"]) await sim({ action: "unit", target: n, on: true });
  await p.waitForTimeout(16000); await post("/api/ack", { ids: "all" }); await go("overview", "fleet_ov", 2500); await go("sld", "fleet_sld", 2500);
  // 4-2) 장비 한 대 = 그림 하나 · 장비마다 차단기(ESS 2호기 → 모선 A, 태양광 2호기 · 복합전력 2호 차량의 ESS → 모선 B, 태양광 2호기 차단기 개방) · 설치 점검(ESS 2호기 무응답)
  for (const [node, bus] of [["ESS2", "A"], ["PV2", "B"], ["G1_2", "B"]]) await post("/api/bus", { op: "set", node, bus });
  await sim({ action: "cb", target: "PV2", on: false }); await go("sld", "sld_units", 6000); await go("control", "ctl_units", 3500);
  await sim({ action: "mute", target: "ESS2", on: true }); await p.waitForTimeout(6500); await go("overview", null, 3000); await p.click("#initBtn"); await p.waitForTimeout(1200); await p.click("#icRun"); await p.waitForTimeout(8000); await p.screenshot({ path: D + "init_map.png" }); await p.click("#icClose");
  await sim({ action: "mute", target: "ESS2", on: false }); await sim({ action: "cb", target: "PV2", on: true }); await post("/api/bus", { op: "set", node: "ESS2", bus: "B" });      // 기본 구성(site_default.json)의 모선으로 되돌린다 await p.waitForTimeout(3000); await post("/api/ack", { ids: "all" });
  // 5) 로그인 창
  await p.evaluate(() => { sessionStorage.removeItem("ems.token"); }); await p.goto(B + "#overview"); await p.reload(); await p.waitForTimeout(1500); await p.evaluate(() => loginDialog()); await p.waitForTimeout(500); await p.screenshot({ path: D + "login.png" });
  console.log("화면 오류", errs.slice(0, 5)); await b.close();
})();
