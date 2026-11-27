// 화면 연동 점검: 가상 장치에 상황을 하나씩 넣고(환망 구간 단선 · 해제, 장치 추가 · 제거, 구간분전함 빼기 · 뒤섞기),
// 개요 · 결선도 · 환망 · 설비 제어 · 경보 화면이 모두 같은 상태를 보이는지(운영 시나리오는 장비 목록이 자동 인식과 맞는지) 화면의 글자로 대조한다.
//   python -m ifps_ems_rt.hmi config/runtime.json --sim --plan results --port 8088   (다른 창에서 먼저 실행)
//   node tools/link_check.js [주소] [결과 파일]
// 기준은 서버가 내보낸 상태(스냅샷의 ring · fleet)다. 약 6분 걸린다.
const { chromium } = require("playwright"); const fs = require("fs");
const B = process.argv[2] || "http://127.0.0.1:8088/", OUT = process.argv[3] || "";
const WAIT = 7000, PAGE = 2200;

(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1920, height: 1080 } }), errs = [], rows = [];
  p.on("pageerror", e => errs.push(String(e))); p.on("dialog", d => d.accept());
  await p.goto(B);
  const tok = await p.evaluate(async () => { const r = await (await fetch("/api/login", { method: "POST", body: JSON.stringify({ pin: "2222", name: "김상사" }) })).json(); sessionStorage.setItem("ems.token", r.token); return r.token; });
  const post = (path, body) => p.evaluate(async ([tok, path, body]) => (await fetch(path, { method: "POST", headers: { "X-TPCS-Token": tok }, body: JSON.stringify(body) })).json(), [tok, path, body]);
  const ring = body => post("/api/ring", { do: "sim", ...body }), sim = body => post("/api/sim", body);
  await p.evaluate(() => localStorage.setItem("ems.scenario.view", "live")); await p.reload(); await p.waitForTimeout(1500);
  const text = async (pg, sel) => { await p.goto(B + "#" + pg); await p.waitForTimeout(PAGE); return p.evaluate(sel => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ") : null; }, sel); };
  const truth = () => p.evaluate(() => ({ ring: S.snap.ring, fleet: S.snap.fleet, alarms: (S.snap.alarms || []).map(a => a.id || a.key || "") }));

  // 한 상황에서 모든 화면을 본다. 기준(t)과 어긋나는 화면을 모은다
  async function look(name) {
    const bad = [], see = {};
    see.ov = await text("overview", "#siteMap"); see.sld = await text("sld", "#sldRingG"); see.rg = await text("ring", "main"); see.ctl = await text("control", "#ringRows"); await text("scenarios", "#tpLive");
    const pal = await p.evaluate(() => [...document.querySelectorAll("#scWorkspace summary")].map(e => e.textContent.replace(/\s+/g, " ").trim()).join("|"));
    see.al = await text("alarms", "main");
    const t = await truth(), r = t.ring, cut = r.cut || [];
    const need = (k, ok, what) => { if (!ok) bad.push(`${k}: ${what}`); };
    for (const k of ["ov", "sld", "rg", "ctl"]) {
      if (see[k] == null) { bad.push(`${k}: 화면에 환망 없음`); continue; }
      for (const f of r.fsu) if (k !== "ctl" || r.fsu.length) need(k, see[k].includes(f.name), `${f.name} 없음`);
      for (const s of r.sections) { const shown = new RegExp(`구간 ${s.i}(?:\\([^)]*\\)| · 상시 개방점)? ?(?:단선 · )?차단(?!된)`).test(see[k]);
        need(k, shown === cut.includes(s.i), `구간 ${s.i} ${cut.includes(s.i) ? "차단이 안 보임" : "차단으로 잘못 보임"}`); }
    }
    need("ctl", (see.ctl.match(/구간 \d+/g) || []).length === r.sections.length, `구간 줄 수 ${(see.ctl.match(/구간 \d+/g) || []).length} ≠ ${r.sections.length}`);
    for (const i of cut) need("al", new RegExp(`환망 구간 ${i}`).test(see.al), `구간 ${i} 경보 없음`);
    for (const [kd, f] of Object.entries(t.fleet || {})) for (const u of f.units) if (u.id !== kd) need("sc", pal.includes(u.id), `장비 목록에 ${u.id} 없음`);
    for (const m of pal.match(/\b(DG|FC|ESS|PV|ELZ)\d+\b/g) || []) need("sc", Object.values(t.fleet || {}).some(f => f.units.some(u => u.id === m)), `인식되지 않은 ${m} 가 목록에 있음`);
    rows.push({ name, fsu: r.fsu.length, cut, switched: !!r.switched, dead: r.fsu.filter(f => f.live === false).map(f => f.name), units: Object.fromEntries(Object.entries(t.fleet || {}).map(([k, f]) => [k, f.units.length])), bad });
    console.log(`${bad.length ? "✕" : "○"} ${name} | 구간분전함 ${r.fsu.length} · 차단 [${cut}] · 우회 ${!!r.switched}${bad.length ? " | " + bad.join(" / ") : ""}`);
  }
  const step = async (name, fn) => { await fn(); await p.waitForTimeout(WAIT); await look(name); };

  await sim({ action: "clock", hour: 13 }); await ring({ action: "restore" }); await p.waitForTimeout(WAIT); await look("평소");
  const n = (await truth()).ring.sections.length;
  for (let i = 0; i < n; i++) { await step(`구간 ${i} 단선`, () => ring({ action: "break", section: i, on: true })); await step(`구간 ${i} 단선 해제`, () => ring({ action: "break", section: i, on: false })); }
  await step("겹친 단선(구간 2 · 5)", async () => { await ring({ action: "break", section: 2, on: true }); await ring({ action: "break", section: 5, on: true }); });
  await step("겹친 단선 해제", async () => { await ring({ action: "break", section: 2, on: false }); await ring({ action: "break", section: 5, on: false }); });
  const f3 = (await truth()).ring.fsu[2];
  await step("구간분전함 한 대 빼기", () => ring({ action: "remove", id: f3.id })); await step("구간분전함 뒤섞기", () => ring({ action: "shuffle" })); await step("환망 처음 상태로", () => ring({ action: "restore" }));
  await step("디젤 DG2 추가", () => sim({ action: "unit", target: "DG2", on: true })); await step("ESS2 추가", () => sim({ action: "unit", target: "ESS2", on: true }));
  await step("DG2 · ESS2 제거", async () => { await sim({ action: "unit", target: "DG2", on: false }); await sim({ action: "unit", target: "ESS2", on: false }); });
  const fail = rows.filter(r => r.bad.length);
  console.log(`\n상황 ${rows.length}건 · 어긋남 ${fail.length}건 · 화면 오류 ${errs.length}건`); if (errs.length) console.log(errs.slice(0, 5));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ rows, page_errors: errs, n: rows.length, fail: fail.length }, null, 1));
  await b.close(); process.exit(fail.length || errs.length ? 1 : 0);
})();
