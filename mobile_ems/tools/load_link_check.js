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
  async function compare(what) {
    await p.waitForTimeout(2500); const d = await loads(), on = d.items.filter(i => i.n > 0), miss = [], tot = d.grades.reduce((a, g) => a + g.n, 0), pill = `부하 ${tot}개`;
    const need = (scr, txt, want) => { n++; if (!txt.includes(want)) miss.push(`${scr}: '${want}' 없음`); };
    const lp = await text("loads", "#ldRows tr"); on.forEach(i => { need("부하 관리", lp, i.name); need("부하 관리", lp, i.fsu_name); });
    const ov = await text("overview", "#siteMk .spt:not(.ppdu)", 4500); on.forEach(i => { need("개요", ov, i.name); need("개요", ov, `${i.grade}등급 · ${i.fsu_name}`); });
    const spare = await p.evaluate(() => [...document.querySelectorAll("#siteMk .spt:not(.ppdu)")].filter(e => /예비 자리/.test(e.querySelector(".sh").textContent)).map(e => e.querySelector(".ss").textContent));
    n++; if (spare.some(t => /급전 중|kW/.test(t))) miss.push(`개요: 예비 자리에 '${spare.find(t => /급전 중|kW/.test(t))}'`);      // 부하가 없는 예비 자리는 급전 중이라고 나오면 안 된다
    const cnt = await p.evaluate(() => document.querySelector("#layCnt").textContent); need("개요", cnt, pill.replace("개", "").trim());
    const sl = await text("sld", "#main svg text, #sldCb", 3500); on.forEach(i => need("결선도", sl, lab(i).slice(0, 10)));
    const rg = await text("ring", "#rgBody", 3500); on.forEach(i => need("환망", rg, lab(i)));
    // 환망 구성도: 부하가 개요 · 결선도와 같은 구간분전함 아래에 그려지는지, 분기 전력계(구간분전함 · 배전체계)가 그 자리에 물린 부하의 추정 전력과 맞는지
    const dg = await p.evaluate(() => ({ at: Object.fromEntries([...document.querySelectorAll("#rgBody .rv-load")].map(e => [e.dataset.load, e.dataset.fsu])), ring: S.snap.ring, items: S.snap.loads.items }));
    on.forEach(i => { n++; if (dg.at[i.id] !== i.fsu) miss.push(`환망 구성도: ${i.name} 이 ${dg.at[i.id] || "없음"} 아래(목록은 ${i.fsu})`); });
    const est = f => dg.items.filter(f).reduce((a, i) => a + (i.n > 0 ? i.est_kw || 0 : 0), 0), near = (a, b) => Math.abs(a - b) <= Math.max(2.5, 0.12 * Math.max(a, b));
    on.forEach(i => { n++; if ((i.ppdus || []).length !== i.need && dg.ring.ppdu.length < 8) miss.push(`${i.name}: 배전체계 ${(i.ppdus || []).length}대(필요 ${i.need}대)`); });      // 부하 앞에 필요한 대수만큼 붙었는지(가상 장치의 자리 8개가 다 차면 모자랄 수 있다)
    dg.ring.fsu.forEach(f => { n++; const e = est(i => i.fsu === f.id); if (f.kw != null && !near(f.kw, e)) miss.push(`분기 전력계 ${f.id} ${f.kw.toFixed(1)} kW ≠ 물린 부하 ${e.toFixed(1)} kW`); });
    dg.ring.ppdu.forEach(q => { n++; const e = dg.items.reduce((a, i) => a + (i.n > 0 && (i.ppdus || []).includes(q.id) ? (i.est_kw || 0) / i.ppdus.length : 0), 0); if (q.kw != null && !near(q.kw, e)) miss.push(`배전체계 ${q.id} ${q.kw.toFixed(1)} kW ≠ 물린 부하 ${e.toFixed(1)} kW`); n++; const v = dg.items.some(i => (i.ppdus || []).includes(q.id) && i.grade === 1 && i.n > 0); if (!!q.vital !== v) miss.push(`배전체계 ${q.id} 중요 부하 표시(★) ${q.vital} — 1등급 부하 ${v ? "있음" : "없음"}`); });
    for (const [pg, nm] of [["control", "설비 제어"], ["energy", "발전·예측"], ["trends", "추세"], ["scenarios", "운영 시나리오"]]) need(nm, await text(pg, "#main .pagehd .ld-note", 2200), pill);
    await p.goto(B + "#control"); await p.waitForTimeout(2000); const ct = await p.evaluate(() => [...document.querySelectorAll("#cbRows tr")].map(e => e.title).join(" | "));      // 차단기 줄의 이름(풍선 도움말) d.grades.filter(g => g.n > 0).forEach(g => need("설비 제어", ct, d.items.find(i => i.feeder === g.feeder && i.n > 0).name));
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
  await post("/api/bus", { op: "reset" }); const fix = await post("/api/bus", { op: "auto" }); await p.goto(B + "#sld"); await p.waitForTimeout(4000);
  const sb = await p.evaluate(() => ({ g1: SRC.find(n => n.id === "G1"), snap: S.snap.bus.assign.G1, issues: S.snap.bus.issues.length, ov: [...document.querySelectorAll("#main svg .node")].length, va: val("BUS.a_v"), vb: val("BUS.b_v") }));
  n += 4; const bm = []; if (!fix.ok || sb.snap !== "A") bm.push("스냅샷의 G1 모선"); if (sb.g1.bus !== "A" || sb.g1.x > 480) bm.push(`결선도의 G1 자리 ${sb.g1.bus}@${Math.round(sb.g1.x)}`); if (sb.issues) bm.push("보완 뒤에도 약점 남음"); if (!(sb.va > 300 && sb.vb > 300)) bm.push("모선 전압");
  bad += bm.length; console.log(`${bm.length ? "✕" : "○"} 모선 구성 자동 보완: ${fix.msg || fix.why}` + (bm.length ? "\n    " + bm.join("\n    ") : "")); await post("/api/bus", { op: "reset" });
  await post("/api/loads", { op: "reset" }); await p.goto(B + "#overview"); await p.waitForTimeout(2500); await post("/api/layout/reset", {});
  await compare("기본 목록으로 되돌림");
  console.log(`\n대조 ${n}건 · 어긋남 ${bad}건 · 화면 오류 ${errs.length}건`, errs.slice(0, 3)); await b.close(); process.exit(bad || errs.length ? 1 : 0);
})();
