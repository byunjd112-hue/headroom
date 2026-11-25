// 부하 연동 점검: 부하 목록을 바꿔 가며(수량 · 등급 · 추가 · 자리 옮김 · 개요 배치 편집) 부하 관리 · 개요 · 결선도 · 환망 · 설비 제어 · 발전·예측 · 추세 · 운영 시나리오 화면이
// 모두 같은 부하(이름 · 수량 · 물린 구간분전함 · 추정 전력)를 보이는지 화면의 글자로 대조한다. 기준은 서버 스냅샷의 loads 다.
//   python -m ifps_ems_rt.hmi config/runtime.json --sim --plan results --port 8088   (다른 창에서 먼저 실행)
//   node tools/load_link_check.js [주소]      — 약 3분, 어긋남 0 이어야 한다
const { chromium } = require("playwright"); const B = process.argv[2] || "http://127.0.0.1:8088/";
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = []; let bad = 0, n = 0;
  p.on("pageerror", e => errs.push(String(e))); p.on("dialog", d => d.accept());
  await p.goto(B);
  const tok = await p.evaluate(async () => { const r = await (await fetch("/api/login", { method: "POST", body: JSON.stringify({ pin: "2222", name: "점검" }) })).json(); sessionStorage.setItem("ems.token", r.token); return r.token; });
  const post = (path, body) => p.evaluate(async ([tok, path, body]) => (await fetch(path, { method: "POST", headers: { "X-EMS-Token": tok }, body: JSON.stringify(body) })).json(), [tok, path, body]);
  const text = async (pg, sel, ms = 2600) => { await p.goto(B + "#" + pg); await p.waitForTimeout(ms); return p.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent).join(" | ").replace(/\s+/g, " "), sel); };
  const loads = () => p.evaluate(async () => (await (await fetch("/api/snapshot")).json()).loads);
  const lab = i => i.n > 1 ? `${i.name} ×${i.n}` : i.name;
  async function compare(what, again) {
    const n0 = n; await p.waitForTimeout(again ? 9000 : 2500); const d = await loads(), on = d.items.filter(i => i.n > 0), miss = [], tot = d.grades.reduce((a, g) => a + g.n, 0), pill = `부하 ${tot}개`;
    const need = (scr, txt, want) => { n++; if (!txt.includes(want)) miss.push(`${scr}: '${want}' 없음`); };
    const lp = await text("loads", "#ldRows tr"); on.forEach(i => { need("부하 관리", lp, i.name); need("부하 관리", lp, i.fsu_name); });
    const ov = await text("overview", "#siteMk .spt:not(.ppdu)", 4500); on.forEach(i => { need("개요", ov, i.name); need("개요", ov, `${i.grade}등급 · ${i.fsu_name}`); });
    const spare = await p.evaluate(() => [...document.querySelectorAll("#siteMk .spt:not(.ppdu)")].filter(e => /예비 자리/.test(e.querySelector(".sh").textContent)).map(e => e.querySelector(".ss").textContent));
    n++; if (spare.some(t => /급전 중|kW/.test(t))) miss.push(`개요: 예비 자리에 '${spare.find(t => /급전 중|kW/.test(t))}'`);      // 부하가 없는 예비 자리는 급전 중이라고 나오면 안 된다
    const cnt = await p.evaluate(() => document.querySelector("#layCnt").textContent); need("개요", cnt, pill.replace("개", "").trim());
    const sl = await text("sld", "#main svg text, #main svg title, #sldCb", 3500); on.forEach(i => need("결선도", sl, lab(i).slice(0, 10)));
    const rg = await text("ring", "#rgBody", 3500); on.forEach(i => need("환망", rg, lab(i)));
    // 환망 구성도: 부하가 개요 · 결선도와 같은 구간분전함 아래에 그려지는지, 분기 전력계(구간분전함 · 배전체계)가 그 자리에 물린 부하의 추정 전력과 맞는지
    const dg = await p.evaluate(() => ({ at: Object.fromEntries([...document.querySelectorAll("#rgBody .rv-load")].map(e => [e.dataset.load, e.dataset.fsu])), ring: S.snap.ring, items: S.snap.loads.items }));
    on.forEach(i => { n++; if (dg.at[i.id] !== i.fsu) miss.push(`환망 구성도: ${i.name} 이 ${dg.at[i.id] || "없음"} 아래(목록은 ${i.fsu})`); });
    const est = f => dg.items.filter(f).reduce((a, i) => a + (i.n > 0 ? i.est_kw || 0 : 0), 0), near = (a, b) => Math.abs(a - b) <= Math.max(2.5, 0.12 * Math.max(a, b));
    on.forEach(i => { n++; if ((i.ppdus || []).length !== i.need && dg.ring.ppdu.length < 18) miss.push(`${i.name}: 배전체계 ${(i.ppdus || []).length}대(필요 ${i.need}대)`); });      // 부하 앞에 필요한 대수만큼 붙었는지(배전체계 자리 18개가 다 차면 모자랄 수 있다)
    dg.ring.fsu.forEach(f => { n++; const e = est(i => i.fsu === f.id); if (f.kw != null && !near(f.kw, e)) miss.push(`분기 전력계 ${f.id} ${f.kw.toFixed(1)} kW ≠ 물린 부하 ${e.toFixed(1)} kW`); });
    dg.ring.ppdu.forEach(q => { n++; const e = dg.items.reduce((a, i) => a + (i.n > 0 && (i.ppdus || []).includes(q.id) ? (i.est_kw || 0) / i.ppdus.length : 0), 0); if (q.kw != null && !near(q.kw, e)) miss.push(`배전체계 ${q.id} ${q.kw.toFixed(1)} kW ≠ 물린 부하 ${e.toFixed(1)} kW`); n++; const v = dg.items.some(i => (i.ppdus || []).includes(q.id) && i.grade === 1 && i.n > 0); if (!!q.vital !== v) miss.push(`배전체계 ${q.id} 중요 부하 표시(★) ${q.vital} — 1등급 부하 ${v ? "있음" : "없음"}`); });
    for (const [pg, nm] of [["control", "설비 제어"], ["energy", "발전·예측"], ["trends", "추세"], ["scenarios", "운영 시나리오"]]) need(nm, await text(pg, "#main .pagehd .ld-note", 2200), pill);
    await p.goto(B + "#control"); await p.waitForTimeout(2000); const ct = await p.evaluate(() => [...document.querySelectorAll("#cbRows tr")].map(e => e.title).join(" | "));      // 차단기 줄의 이름(풍선 도움말) d.grades.filter(g => g.n > 0).forEach(g => need("설비 제어", ct, d.items.find(i => i.feeder === g.feeder && i.n > 0).name));
    if (miss.length && !again && miss.every(m => / kW ≠ 물린 부하 /.test(m))) { n = n0; console.log(`  … ${what}: 분기 전력계가 부하 변경을 따라올 때까지 한 번 더 기다린다(${miss[0]})`); return compare(what, true); }      // 전력계는 부하 목록이 바뀐 뒤 몇 초 늦게 따라온다 — 그 어긋남만 한 번 다시 본다
    bad += miss.length; console.log(`${miss.length ? "✕" : "○"} ${what} | ${on.map(i => `${lab(i)}@${i.fsu}`).join(", ")}` + (miss.length ? "\n    " + miss.slice(0, 8).join("\n    ") : ""));
  }
  await p.reload(); await p.waitForTimeout(2000);
  await post("/api/loads", { op: "reset" }); await post("/api/layout/reset", {});
  await compare("기본 목록");
  await post("/api/loads", { op: "count", id: "brk", delta: 1 }); await post("/api/loads", { op: "count", id: "brk", delta: 1 }); await compare("막사 4동으로");
  await post("/api/loads", { op: "set", id: "ammo", grade: 1, save_pct: 0 }); await compare("탄약저장 3등급 → 1등급");
  const add = await post("/api/loads", { op: "add", kind: "hvac" }); await compare("냉난방 추가");
  const free = (await loads()).fsus.map(f => f.id).find(f => !(add.loads.items || []).some(q => q.fsu === f)); await post("/api/loads", { op: "set", id: "med", fsu: free }); await compare(`의무시설을 비어 있던 ${free} 로(배전체계가 따라간다)`);
  await post("/api/loads", { op: "count", id: "med", delta: -1 }); await compare("의무시설 0개(빼기)"); await post("/api/loads", { op: "count", id: "med", delta: 1 });
  // 개요의 [배치 편집]: 탄약저장 그림을 다른 구간분전함 옆으로 옮기고 이름을 고쳐 저장 → 부하 목록 · 결선도 · 환망이 따라가는지
  await p.goto(B + "#overview"); await p.waitForTimeout(4000);
  const moved = await p.evaluate(async () => { layToggleEdit(); const view = layLoads(L.items, true), v = view.find(x => x.load === "ammo"), it = L.items.find(i => i.uid === v.uid), rmap = fsuRing(L.items);
    const ld = S.snap.loads.items.find(q => q.id === "ammo"), f = L.items.find(i => i.kind === "FSU" && rmap.get(i.uid) && rmap.get(i.uid) !== ld.fsu); it.x = f.x + 20; it.y = f.y + 40; it.name = "탄약고 A"; L.dirty = true;
    document.querySelector("#laySave").click(); await new Promise(r => setTimeout(r, 2500)); return rmap.get(f.uid); });
  const after = (await loads()).items.find(i => i.id === "ammo"); n++; if (after.fsu !== moved || after.name !== "탄약고 A") { bad++; console.log(`✕ 배치 편집 반영: 기대 ${moved} · 탄약고 A / 실제 ${after.fsu} · ${after.name}`); }
  await compare(`개요 배치 편집: 탄약저장 → ${moved} 옆 · 이름 '탄약고 A'`);
  // 모선 구성: 자동 보완으로 복합전력 ESS 를 모선 A 로 옮기면 결선도의 자리 · 스냅샷 · 모선 전압이 따라가는지
  await post("/api/bus", { op: "reset" }); await post("/api/bus", { op: "set", node: "G1", bus: "B" }); const fix = await post("/api/bus", { op: "auto" }); await p.goto(B + "#sld"); await p.waitForTimeout(4000);
  const sb = await p.evaluate(() => ({ g1: SRC.find(n => n.id === "G1"), snap: S.snap.bus.assign.G1, issues: S.snap.bus.issues.length, ov: [...document.querySelectorAll("#main svg .node")].length, va: val("BUS.a_v"), vb: val("BUS.b_v") }));
  n += 4; const bm = []; if (!fix.ok || sb.snap !== "A") bm.push("스냅샷의 G1 모선"); if (sb.g1.bus !== "A" || sb.g1.x > 480) bm.push(`결선도의 G1 자리 ${sb.g1.bus}@${Math.round(sb.g1.x)}`); if (sb.issues) bm.push("보완 뒤에도 약점 남음"); if (!(sb.va > 300 && sb.vb > 300)) bm.push("모선 전압");
  bad += bm.length; console.log(`${bm.length ? "✕" : "○"} 모선 구성 자동 보완: ${fix.msg || fix.why}` + (bm.length ? "\n    " + bm.join("\n    ") : "")); await post("/api/bus", { op: "reset" });
  // ── 하나씩 고르기: 추가한 장비의 모선, 나눈 부하, 결선도에서 마우스로 끌어 옮기기
  const chk = (ok, what) => { n++; if (!ok) { bad++; console.log("✕ " + what); } return ok; };
  const toClient = (x, y) => p.evaluate(([x, y]) => { const m = document.getElementById("sldRingG").ownerSVGElement.getScreenCTM(); return [m.a * x + m.e, m.d * y + m.f]; }, [x, y]);
  const drag = async (from, to) => { await p.mouse.move(from[0], from[1]); await p.mouse.down(); await p.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 }); await p.mouse.move(to[0], to[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(4500); };
  const center = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const snapBus = () => p.evaluate(async () => (await (await fetch("/api/snapshot")).json()).bus);
  await post("/api/loads", { op: "reset" }); await post("/api/layout/reset", {}); await post("/api/units", { kind: "ESS", delta: 1 }); await p.waitForTimeout(9000);
  let r1 = await post("/api/bus", { op: "set", node: "ESS", bus: "A" }); const srcBus = b => Object.fromEntries(b.sources.filter(q => q.kind === "ESS").map(q => [q.id, q.bus]));
  chk(r1.ok && srcBus(r1.bus).ESS === "A" && srcBus(r1.bus).ESS2 === "B", "이동형 ESS 1호기만 모선 A 로(2호기는 그대로 B): " + JSON.stringify(r1.ok ? srcBus(r1.bus) : r1.why));
  await p.goto(B + "#sld"); await p.waitForTimeout(4500);
  chk(await p.evaluate(() => { const a = SRC.find(n => n.id === "ESS"), b = SRC.find(n => n.id === "ESS2"); return !!(a && b && a.bus === "A" && a.x < 480 && b.bus === "B" && b.x > 520 && document.querySelector("#n-ESS") && document.querySelector("#n-ESS2") && Math.abs(a.k - b.k) < .01); }), "결선도: ESS 1호기는 모선 A 쪽, 2호기는 모선 B 쪽에 따로 그려진다(같은 크기)");
  chk(await p.evaluate(() => { const u = S.snap.fleet.ESS.units, t = id => document.querySelector("#kw-" + id).textContent; return t("ESS") === F.kw(u[0].kw) && t("ESS2") === F.kw(u[1].kw); }), "결선도: 그림마다 그 한 대의 출력");
  chk(await p.evaluate(() => val("BUS.a_v") > 300 && val("BUS.b_v") > 300), "두 모선 전압");
  await drag(await center("#n-ESS2 .hexbg"), await toClient(250, 200));                       // 2호기 그림을 모선 A 쪽으로 끈다
  let sb2 = await snapBus(); chk(srcBus(sb2).ESS2 === "A", "결선도에서 ESS 2호기 그림을 끌어 모선 A 로: " + JSON.stringify(srcBus(sb2)));
  await drag(await center("#n-ESS .hexbg"), await toClient(760, 200)); sb2 = await snapBus();                             // 전원 그림(첫 장비)을 모선 B 쪽으로 끈다 → 1호기만
  chk(srcBus(sb2).ESS === "B" && srcBus(sb2).ESS2 === "A", "결선도에서 ESS 그림을 끌어 모선 B 로(1호기만): " + JSON.stringify(srcBus(sb2)));
  await p.goto(B + "#overview"); await p.waitForTimeout(4500);
  const ovb = await p.evaluate(() => [...document.querySelectorAll("#siteMk .spt:not(.ppdu)")].map(e => e.textContent.replace(/\s+/g, " ")).filter(t => /이동형 ESS/.test(t)));
  chk(ovb.length === 2 && /모선 B/.test(ovb[0]) && /모선 A/.test(ovb[1]), "개요의 ESS 표지(1호기 모선 B · 2호기 모선 A): " + JSON.stringify(ovb.map(t => t.slice(-14))));
  console.log("○ 장비 한 대 한 대의 모선(창 · 결선도 끌기 · 개요 표지)");
  const sp = await post("/api/loads", { op: "split", id: "brk" }); chk(sp.ok, "막사 나누기: " + (sp.msg || sp.why)); await compare("막사 ×2 를 하나씩 나눔");
  await p.goto(B + "#sld"); await p.waitForTimeout(4500); const fx = await p.evaluate(() => SLD_DRAG.fx), k3 = fx.find(f => f.id === "FSU3"), k6 = fx.find(f => f.id === "FSU6");
  await drag(await center('.sld-ld-drag[data-fsu="FSU6"]'), await toClient(k3.x, 520));                           // 탄약저장 그림을 구간분전함 3 아래로 끈다
  chk((await loads()).items.find(i => i.id === "ammo").fsu === "FSU3", "결선도에서 탄약저장을 끌어 구간분전함 3 으로"); await compare("결선도에서 부하를 끌어 구간분전함 3 으로");
  await p.goto(B + "#sld"); await p.waitForTimeout(4500); await drag(await center('.sld-ld-drag[data-fsu="FSU3"]'), await toClient(760, 300));      // 그 그림을 모선 B 높이로 끈다 → 모선 B 쪽 구간분전함으로
  sb2 = await snapBus(); chk((sb2.loads.find(l => l.id === "ammo") || {}).bus === "B", "결선도에서 탄약저장을 끌어 모선 B 쪽으로: " + JSON.stringify(sb2.loads.map(l => [l.name, l.bus, l.fsu]))); await compare("결선도에서 부하를 끌어 모선 B 쪽으로");
  await post("/api/units", { kind: "ESS", delta: -1 }); await post("/api/bus", { op: "reset" });
  // ── 배치 편집에서 그림을 추가해 저장하면 장비 · 부하도 같이 늘어난다(그림만 '예비 자리'로 남지 않는다)
  await post("/api/loads", { op: "reset" }); await post("/api/layout/reset", {}); await p.goto(B + "#overview"); await p.reload(); await p.waitForTimeout(9000);
  await p.evaluate(async () => { layToggleEdit(); for (const k of ["PV", "BARRACK", "L3"]) { document.querySelector("#layKind").value = k; document.querySelector("#layAdd").click(); await new Promise(r => setTimeout(r, 300)); }
    document.querySelector("#laySave").click(); await new Promise(r => setTimeout(r, 3000)); });
  await p.waitForTimeout(10000);
  const aft = await p.evaluate(async () => { const s = await (await fetch("/api/snapshot")).json(); return { pv: s.fleet.PV.units.length, brk: s.loads.items.filter(q => q.kind === "barrack").reduce((a, q) => a + q.n, 0), ammo: s.loads.items.filter(q => q.kind === "ammo").reduce((a, q) => a + q.n, 0),
    spare: [...document.querySelectorAll("#siteMk .spt:not(.ppdu)")].map(e => e.textContent.replace(/\s+/g, " ")).filter(t => /예비 자리/.test(t)), pvs: [...document.querySelectorAll("#siteMk .spt:not(.ppdu)")].map(e => e.textContent.replace(/\s+/g, " ")).filter(t => /이동형 PV/.test(t)) }; });
  chk(aft.pv === 2 && aft.brk === 3 && aft.ammo === 2 && !aft.spare.length && aft.pvs.length === 2 && aft.pvs.every(t => /모선/.test(t)), "그림을 추가해 저장 → 이동형 PV 2대 · 막사 3 · 탄약저장 2, 예비 자리 없음: " + JSON.stringify(aft));
  const dots = await p.evaluate(() => [...document.querySelectorAll("#siteMk .spt")].map(e => { const g = document.querySelector(`#siteMap .meq[data-uid="${CSS.escape(e.dataset.uid)}"]`); if (!g) return [e.dataset.uid, 999, 999, 1];
    const r = g.getBoundingClientRect(), c = e.querySelector(".core").getBoundingClientRect(); return [e.dataset.uid, Math.round(c.left + c.width / 2 - r.left - r.width / 2), Math.round(c.top + c.height / 2 - r.top), Math.round(r.height)]; }).filter(q => Math.abs(q[1]) > 3 || q[2] < 0 || q[2] > q[3] * .3));
  chk(!dots.length, "개요의 점이 그 그림 바로 위에 있다: " + JSON.stringify(dots));
  await compare("배치 편집에서 장비 · 부하 그림을 추가해 저장");
  await p.goto(B + "#sld"); await p.waitForTimeout(4500); chk(await p.evaluate(() => !!document.querySelector("#n-PV") && !!document.querySelector("#n-PV2")), "결선도에 PV 그림 2개(한 대 = 그림 하나)");
  chk(await p.evaluate(() => { const it = LD.s().items.filter(i => i.n > 0); return it.every(i => document.querySelector(`.sld-ld-drag[data-load="${i.id}"]`)); }), "결선도에 부하마다 그림 하나");
  await p.goto(B + "#control"); await p.waitForTimeout(3500); chk(await p.evaluate(() => /1호기.*모선/.test((document.querySelector("#ur-PV") || {}).textContent || "") && /2호기.*모선/.test(document.querySelector("#ur-PV").textContent)), "설비 제어: PV 카드에 한 대마다 출력 · 모선");
  // 그림을 지우고 저장하면(확인) 장비 · 부하도 같이 빠진다
  await p.goto(B + "#overview"); await p.reload(); await p.waitForTimeout(8000);
  await p.evaluate(async () => { layToggleEdit(); await new Promise(r => setTimeout(r, 500)); for (const k of ["PV", "BARRACK", "L3"]) { const its = L.items.filter(i => i.kind === k); L.sel = its[its.length - 1].uid; layDelete(); }
    document.querySelector("#laySave").click(); await new Promise(r => setTimeout(r, 4000)); });
  await p.waitForTimeout(10000);
  const del = await p.evaluate(async () => { const s = await (await fetch("/api/snapshot")).json(); return { pv: s.fleet.PV.units.length, brk: s.loads.items.filter(q => q.kind === "barrack").reduce((a, q) => a + q.n, 0), ammo: s.loads.items.filter(q => q.kind === "ammo").reduce((a, q) => a + q.n, 0) }; });
  chk(del.pv === 1 && del.brk === 2 && del.ammo === 1, "그림을 지우고 저장 → 이동형 PV 1대 · 막사 2 · 탄약저장 1: " + JSON.stringify(del));
  await compare("배치 편집에서 장비 · 부하 그림을 지우고 저장");
  console.log("○ 배치 편집에서 추가한 그림 = 실제 장비 · 부하");
  await post("/api/units", { kind: "PV", delta: -1 });
  await post("/api/loads", { op: "reset" }); await p.goto(B + "#overview"); await p.waitForTimeout(9000); await post("/api/layout/reset", {});
  await compare("기본 목록으로 되돌림");
  console.log(`\n대조 ${n}건 · 어긋남 ${bad}건 · 화면 오류 ${errs.length}건`, errs.slice(0, 3)); await b.close(); process.exit(bad || errs.length ? 1 : 0);
})();
