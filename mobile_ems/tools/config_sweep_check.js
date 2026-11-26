// 구성 변경 점검: 장비 대수를 늘리고 줄이고, 장비 한 대 한 대의 모선을 옮기고, 부하를 늘리고 나누고 옮기고, 상시 개방점을 옮겨 가며
// ① 설치 점검이 그 구성 그대로 검사하는지(인식한 장비마다 통신 줄, 종류마다 대수 줄, 부하마다 경로 줄, 이상 0)
// ② 개요 · 결선도 · 환망 · 설비 제어 · 부하 관리 · 운영 시나리오(실시간) · FMEA·FAT 내보내기가 같은 구성을 보이는지를 대조한다.
// 상시 개방점을 옮길 때 설정 파일(config/runtime.json)이 다시 쓰여 줄 맞춤이 바뀐다(내용은 끝에 되돌린다) — 끝난 뒤 git checkout -- config/runtime.json 으로 되돌린다.
// 가상 장치를 띄워 두고 실행한다: python -m ifps_ems_rt.hmi config/runtime.json --sim --plan results --port 8088 → node tools/config_sweep_check.js  (약 6분, 어긋남 0 이어야 한다)
const { chromium } = require("playwright");
const B = process.env.EMS_URL || "http://127.0.0.1:8088/";
const KN = { PV: "태양광", DG: "디젤 발전기", FC: "연료전지", ESS: "ESS", G1: "복합전력 G1" };           // 운영 시나리오 구성도의 블록 이름
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } }); const errs = []; let n = 0, bad = 0;
  p.on("pageerror", e => errs.push(String(e))); p.on("dialog", d => d.accept());
  await p.goto(B);
  const tok = await p.evaluate(async () => { const r = await (await fetch("/api/login", { method: "POST", body: JSON.stringify({ pin: "2222", name: "점검" }) })).json(); sessionStorage.setItem("ems.token", r.token); return r.token; });
  const post = (path, body) => p.evaluate(async ([tok, path, body]) => (await fetch(path, { method: "POST", headers: { "X-EMS-Token": tok }, body: JSON.stringify(body) })).json(), [tok, path, body]);
  const get = path => p.evaluate(async ([tok, path]) => (await (await fetch(path, { headers: { "X-EMS-Token": tok } })).json()), [tok, path]);
  const snap = () => p.evaluate(async () => (await (await fetch("/api/snapshot")).json()));
  const go = async (pg, ms = 3500) => { await p.goto(B + "#" + pg); await p.waitForTimeout(ms); };
  const same = (a, c) => JSON.stringify([...a].sort()) === JSON.stringify([...c].sort());
  async function sweep(what) {
    await p.waitForTimeout(2500); const s = await snap(), miss = [], chk = (ok, t) => { n++; if (!ok) miss.push(t); };
    const src = s.bus.sources.filter(q => q.present && !["GRID", "GDG"].includes(q.kind)), seen = Object.entries(s.devices).filter(([, d]) => !(d.slot && d.absent)).map(([k]) => k);
    const loads = s.loads.items.filter(i => i.n > 0), units = k => (s.fleet[k] ? s.fleet[k].units : []);
    // ① 설치 점검
    const ic = await get("/api/archive/initcheck?run=1"), items = ic.ok ? ic.last.items : [], id = Object.fromEntries(items.map(i => [i.id, i]));
    chk(ic.ok && ic.last.bad === 0, "설치 점검: 이상 " + (ic.ok ? ic.last.bad + "건 — " + items.filter(i => i.level === "bad").map(i => i.name + ": " + i.text).join(" / ") : ic.why));
    seen.forEach(d => chk(id["comm." + d] && id["comm." + d].level !== "bad", `설치 점검: 장비 통신 줄 ${d}`));
    chk(same(items.filter(i => i.id.startsWith("comm.")).map(i => i.id.slice(5)), seen), "설치 점검: 통신 줄 = 인식한 장비 — " + items.filter(i => i.id.startsWith("comm.")).map(i => i.id.slice(5)).join() + " ≠ " + seen.join());
    ["DG", "ESS", "PV", "FC"].forEach(k => chk(id["count." + k] && id["count." + k].text.startsWith(units(k).length + "대"), `설치 점검: ${k} 대수 줄(${units(k).length}대) — ${id["count." + k] ? id["count." + k].text : "없음"}`));
    loads.forEach(i => chk(id["load." + i.id] && id["load." + i.id].text.includes(i.fsu_name), `설치 점검: 부하 경로 줄 ${i.name} → ${i.fsu_name}`));
    chk(same(items.filter(i => i.id.startsWith("load.")).map(i => i.id.slice(5)), loads.map(i => i.id)), "설치 점검: 부하 줄 = 부하 목록");
    ["ring.order", "ring.feedA", "ring.feedB", "ring.nop", "ring.fed"].forEach(k => chk(id[k] && id[k].level === "ok", `설치 점검: ${k} — ${id[k] ? id[k].text : "없음"}`));
    chk(id["ring.nop"] && id["ring.nop"].text.includes("구간 " + s.ring.open + " "), `설치 점검: 상시 개방점 구간 ${s.ring.open} — ${id["ring.nop"] ? id["ring.nop"].text : ""}`);
    // ② 결선도: 전원 한 대 = 그림 하나, 그 한 대의 모선. 부하 하나 = 그림 하나, 그 구간분전함 아래
    await go("sld", 4500);
    const sl = await p.evaluate(() => ({ src: SRC.filter(q => !["GRID", "GDG"].includes(q.kind)).map(q => [q.id, q.bus, !!document.querySelector("#n-" + q.id)]), ld: [...document.querySelectorAll(".sld-ld-drag")].map(e => [e.dataset.load, e.dataset.fsu]) }));
    chk(same(sl.src.map(q => q[0] + q[1] + q[2]), src.map(q => q.id + q.bus + true)), "결선도 전원 = 모선 구성 — " + JSON.stringify(sl.src) + " ≠ " + JSON.stringify(src.map(q => [q.id, q.bus])));
    chk(same(sl.ld.map(q => q.join("@")), loads.map(i => i.id + "@" + i.fsu)), "결선도 부하 = 부하 목록 — " + JSON.stringify(sl.ld));
    // ③ 환망: 부하가 같은 구간분전함 아래
    await go("ring", 4000); const rg = await p.evaluate(() => [...document.querySelectorAll("#rgBody .rv-load")].map(e => e.dataset.load + "@" + e.dataset.fsu));
    chk(same(rg, loads.map(i => i.id + "@" + i.fsu)), "환망 부하 = 부하 목록 — " + JSON.stringify(rg));
    // ④ 설비 제어: 여러 대인 종류는 한 대마다 줄(모선), 추가 장비의 차단기 줄
    await go("control", 3500);
    const ct = await p.evaluate(() => ({ ur: Object.fromEntries(["DG", "ESS", "PV", "FC"].map(k => [k, [...document.querySelectorAll(`#ur-${k} span`)].map(e => e.textContent)])), cb: [...document.querySelectorAll("#cbRows tr b")].map(e => e.textContent.replace("CB-", "")) }));
    ["DG", "ESS", "PV", "FC"].forEach(k => { const us = units(k), want = us.length > 1 ? us.length : 0; chk(ct.ur[k].length === want && us.every((u, i) => !want || ct.ur[k][i].includes("모선 " + (src.find(q => q.id === u.id) || {}).bus)), `설비 제어 ${k}: 한 대별 줄 ${ct.ur[k].length}(기대 ${want}) — ${ct.ur[k].join(" | ")}`); });
    const extra = ["DG", "ESS", "PV", "FC"].flatMap(k => units(k).slice(1).map(u => u.id)).concat(units("DG").slice(1).map(u => "G1_" + u.id.replace(/\D/g, "")));
    chk(extra.every(x => ct.cb.includes(x)) && ct.cb.filter(x => /\d$/.test(x) && !/^L\d$/.test(x)).every(x => extra.includes(x) || x === "G1"), "설비 제어 차단기 표 = 추가 장비 — " + ct.cb.join() + " / " + extra.join());
    // ⑤ 부하 관리
    await go("loads", 3000); const lp = await p.evaluate(() => [...document.querySelectorAll("#ldRows tr")].map(e => e.textContent).join(" | ")); loads.forEach(i => chk(lp.includes(i.name) && lp.includes(i.fsu_name), `부하 관리: ${i.name} · ${i.fsu_name}`));
    // ⑥ 개요: 장비 한 대 = 표지 하나(그 한 대의 모선), 예비 자리 없음
    await go("overview", 5000);
    const ov = await p.evaluate(() => ({ k: Object.fromEntries(["DG", "ESS", "PV", "FC"].map(k => [k, L.view.filter(i => i.kind === k && !i.spare && !i.absent).length])), sp: L.view.filter(i => i.spare).length, lb: [...document.querySelectorAll("#siteMk .spt:not(.ppdu)")].map(e => e.textContent.replace(/\s+/g, " ")), btn: document.querySelector("#initBtn").textContent }));
    ["DG", "ESS", "PV", "FC"].forEach(k => chk(ov.k[k] === units(k).length, `개요 ${k} 그림 ${ov.k[k]}(인식 ${units(k).length})`)); chk(ov.sp === 0, "개요에 예비 자리 " + ov.sp + "개");
    src.filter(q => q.kind !== "G1" && q.kind !== "DG").forEach(q => chk(ov.lb.some(t => t.includes("모선 " + q.bus) && (units(q.kind).length < 2 || t.includes(q.id + " "))), `개요 표지: ${q.id} 모선 ${q.bus}`));
    chk(ic.ok && (ic.last.done ? /설치 점검 완료/ : /남은/).test(ov.btn) && ic.last.done === (ic.last.bad + ic.last.warn === 0), `개요의 설치 점검 단추 — ${ov.btn}(이상 ${ic.ok ? ic.last.bad : "?"} · 주의 ${ic.ok ? ic.last.warn : "?"})`);
    // ⑦ 운영 시나리오 실시간: 장비 한 대 = 블록 하나
    await go("scenarios", 3500); await p.evaluate(() => { const e = [...document.querySelectorAll("#main button")].find(x => x.textContent.trim() === "실시간"); if (e) e.click(); }); await p.waitForTimeout(3500);
    const tx = await p.evaluate(() => [...document.querySelectorAll("#main svg text")].map(e => e.textContent.trim()));
    Object.entries(KN).forEach(([k, nm]) => { const m = units(k === "G1" ? "DG" : k).length, got = tx.filter(t => m > 1 ? new RegExp("^" + nm + " \\d$").test(t) : t === nm).length; chk(m > 1 ? got === m : got >= 1, `운영 시나리오 실시간: ${nm} 블록 ${got}(기대 ${Math.max(1, m)})`); });      // 한 대일 때는 같은 글자가 다른 곳(차단기 이름 등)에도 있어 '있다'만 본다
    // ⑧ FMEA · FAT 내보내기: 전원 한 대마다 · 부하마다 줄
    const fm = await get("/api/archive/fmexport?doc=site&fmt=json"), f02 = fm.fmea.filter(r => r[0] === "FM-02").length;
    chk(f02 === s.bus.sources.filter(q => q.present).length, `FMEA 내보내기: 전원 줄 ${f02}(전원 ${s.bus.sources.filter(q => q.present).length})`); loads.forEach(i => chk(JSON.stringify(fm.fat).includes(i.name), `FAT 점검표: ${i.name}`));
    bad += miss.length; console.log(`${miss.length ? "✕" : "○"} ${what} | 전원 ${src.map(q => q.id + ":" + q.bus).join(" ")} | 부하 ${loads.map(i => i.name + (i.n > 1 ? "×" + i.n : "") + "@" + i.fsu).join(", ")} | 개방점 ${s.ring.open}` + (miss.length ? "\n    " + miss.slice(0, 10).join("\n    ") : ""));
  }
  const reset = async () => { await post("/api/loads", { op: "reset" }); await post("/api/layout/reset", {}); await post("/api/bus", { op: "reset" }); await post("/api/ring", { do: "config", open: 4 }); };
  const one = async () => { const fl = (await snap()).fleet; let moved = 0;                                      // 장비 대수를 종류마다 한 대로 맞춘다(앞서 돌린 도구 · 사람이 남긴 대수에 기대지 않는다)
    for (const k of ["ESS", "PV", "DG", "FC"]) for (let m = fl[k].units.length; m !== 1; m += m < 1 ? 1 : -1) { await post("/api/units", { kind: k, delta: m < 1 ? 1 : -1 }); moved++; }
    if (moved) await p.waitForTimeout(13000); };
  await post("/api/sim", { action: "clock", hour: 13 }); await reset(); await one(); await p.reload(); await p.waitForTimeout(6000);
  await sweep("기본 구성");
  for (const k of ["ESS", "PV", "DG", "FC"]) await post("/api/units", { kind: k, delta: 1 }); await p.waitForTimeout(13000);
  await sweep("장비를 종류마다 한 대씩 늘림(8대)");
  for (const [nd, bus] of [["ESS2", "A"], ["PV2", "B"], ["DG2", "B"], ["G1_2", "B"], ["FC2", "B"]]) { const r = await post("/api/bus", { op: "set", node: nd, bus }); n++; if (!r.ok) { bad++; console.log("✕ 모선 옮김 " + nd + ": " + r.why); } }
  await sweep("추가 장비를 반대쪽 모선으로 옮김");
  await post("/api/bus", { op: "set", node: "ESS", bus: "A" }); await post("/api/bus", { op: "set", node: "ESS2", bus: "B" }); await sweep("ESS 1 · 2호기의 모선을 서로 바꿈");
  await post("/api/loads", { op: "count", id: "brk", delta: 1 }); const sp = await post("/api/loads", { op: "split", id: "brk" }), bk = sp.loads.items.filter(i => i.kind === "barrack");
  await post("/api/loads", { op: "set", id: bk[1].id, fsu: "FSU5" }); await post("/api/loads", { op: "set", id: bk[2].id, fsu: "FSU3" }); await post("/api/loads", { op: "add", kind: "hvac" }); await p.waitForTimeout(9000);
  await sweep("부하를 늘리고 나누고 구간분전함을 옮김");
  const mv = await post("/api/bus", { op: "load", id: "ammo", bus: "A" }); n++; if (!mv.ok) { bad++; console.log("✕ 부하의 모선 옮김: " + mv.why); } await p.waitForTimeout(9000);
  await sweep("탄약저장을 모선 A 쪽으로 옮김");
  const oc = await post("/api/ring", { do: "config", open: 3 }); n++; if (!oc.ok) { bad++; console.log("✕ 상시 개방점 옮김: " + oc.why); } await p.waitForTimeout(12000);
  await sweep("상시 개방점을 구간 3 으로 옮김");
  await post("/api/units", { kind: "PV", delta: -1 }); await post("/api/units", { kind: "FC", delta: -1 }); await p.waitForTimeout(12000);
  await sweep("태양광 · 연료전지 2호기를 뺌");
  // 고장 → 안내 → 고침 → 해결됨: 구성을 바꾼 상태에서도 같은 흐름
  await post("/api/sim", { action: "mute", target: "ESS2", on: true }); await p.waitForTimeout(6000);
  let ic = await get("/api/archive/initcheck?run=1"), it = ic.last.items.find(i => i.id === "comm.ESS2"); n += 2;
  if (!(it && it.level === "bad" && it.pic === "ESS" && it.guide.length >= 3 && !ic.last.done)) { bad++; console.log("✕ ESS 2호기 무응답 → 이상 · 안내: " + JSON.stringify(it)); }
  await post("/api/sim", { action: "mute", target: "ESS2", on: false }); await p.waitForTimeout(7000); ic = await get("/api/archive/initcheck?run=1&only=comm.ESS2"); it = ic.last.items.find(i => i.id === "comm.ESS2");
  if (!(it && it.level === "ok" && it.was === "bad")) { bad++; console.log("✕ 고친 뒤 그 줄만 다시 검사 → 해결됨: " + JSON.stringify(it)); } else console.log("○ 구성을 바꾼 상태에서 무응답 → 이상 · 안내 → 고침 → 해결됨");
  await reset(); await one(); await p.waitForTimeout(4000);
  await sweep("모두 되돌림(기본 구성)");
  await post("/api/sim", { action: "clock", hour: null });
  console.log(`\n대조 ${n}건 · 어긋남 ${bad}건 · 화면 오류 ${errs.length}건`, errs.slice(0, 3)); await b.close(); process.exit(bad || errs.length ? 1 : 0);
})();
