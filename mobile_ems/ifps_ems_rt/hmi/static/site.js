/* 작전지 전개 현황(배치도 위 실시간 상태), 장비 사진 카드, 발전원 구성 도넛, 경보 매트릭스 */
"use strict";
const EQ_IMG = { PV: "img/eq_pv.jpg", DG: "img/eq_g1.jpg", G1: "img/eq_g1.jpg", FC: "img/eq_fc.jpg", ESS: "img/eq_ess.jpg", MTR: "img/eq_dist.jpg", DIST: "img/eq_dist.jpg",
  EMS: "img/eq_ems.jpg", L1: "img/eq_load_c2.jpg", L2: "img/eq_load_med.jpg", L3: "img/eq_load_amm.jpg" };
// 배치도 위치(이미지 대비 %), 라벨 방향
const SITE_PTS = [
  { id: "G1", no: "①", nm: "기동형 복합전력(디젤)", x: 12, y: 30 }, { id: "ESS", no: "②", nm: "이동형 ESS(GFM)", x: 31.5, y: 27 },
  { id: "PV", no: "③", nm: "이동형 PV 발전", x: 50, y: 19 }, { id: "FC", no: "④", nm: "수소생성·발전", x: 77, y: 25 },
  { id: "DIST", no: "⑥", nm: "배전·변압", x: 53, y: 41 }, { id: "EMS", no: "⑤", nm: "EMS 중앙제어", x: 90, y: 56, left: true },
  { id: "L1", no: "", nm: "1등급 · 지휘통제/의무", x: 10, y: 70 }, { id: "L2", no: "", nm: "2등급 · 정비", x: 73, y: 80, left: true },
  { id: "L3", no: "", nm: "3등급 · 탄약저장", x: 91, y: 77, left: true },
];
function siteHtml() {
  return `<div class="site"><img src="img/site.jpg" alt="작전지 전개 배치도" draggable="false"><div class="site-shade"></div>
    ${SITE_PTS.map(p => `<div class="spt ${p.left ? "l" : ""}" onclick="location.hash='#control'" id="spt-${p.id}" style="left:${p.x}%;top:${p.y}%"><i class="pulse"></i><i class="core"></i>
      <div class="scard"><div class="sh"><b>${p.no}</b> ${p.nm}</div><div class="sv"><span class="mono" id="sptv-${p.id}">—</span><span class="ss" id="spts-${p.id}">—</span></div></div></div>`).join("")}
    <div class="site-leg"><span><i class="ok"></i>운전·급전</span><span><i class="idle"></i>정지·대기</span><span><i class="bad"></i>고장·두절</span></div></div>`;
}
function siteState(s) {
  const k = s.kpi, D = s.devices, gw = D.MTR && D.MTR.link !== "두절", cb = f => gw ? Math.round(val("CB." + f) ?? 1) : 1;
  const lost = n => D[n] && D[n].link === "두절";
  const r = (st, v, t) => ({ st, v, t });
  const out = {
    G1: cb("G1") === 2 || cb("DG") === 2 ? r("bad", `DG ${F.kw(k.dg)} kW`, "차단기 트립") : lost("DG") ? r("bad", "####", "통신 두절")
      : r(D.DG.on ? "ok" : "ok", D.DG.on ? `DG ${F.kw(k.dg)} kW` : "계통 형성 100 kW", D.DG.on ? "디젤 운전" : "계통 형성"),
    ESS: cb("ESS") === 2 ? r("bad", "0 kW", "트립") : lost("ESS") ? r("bad", "####", "통신 두절") : r(Math.abs(k.ess) > 0.5 ? "ok" : "idle", `${k.ess < 0 ? "▲" : "▼"} ${F.kw(Math.abs(k.ess))} kW · ${F.n(k.soc, 0)}%`, k.ess < -0.5 ? "충전" : k.ess > 0.5 ? "방전" : "대기"),
    PV: cb("PV") === 2 ? r("bad", "0 kW", "트립") : r(k.pv > 0.5 ? "ok" : "idle", `${F.kw(k.pv)} kW`, k.pv > 0.5 ? "발전" : "발전 없음"),
    FC: cb("FC") === 2 ? r("bad", "0 kW", "트립") : lost("FC") ? r("bad", "####", "통신 두절") : r(D.FC.on ? "ok" : "idle", `${F.kw(k.fc)} kW · H₂ ${F.n(k.h2, 0)}`, D.FC.on ? "운전" : "정지"),
    DIST: !gw ? r("bad", "####", "게이트웨이 두절") : r((val("BUS.a_v") || 0) > 300 && (val("BUS.b_v") || 0) > 300 ? "ok" : "bad", `${F.n(val("BUS.a_v"), 0)} V · ${F.n(val("BUS.hz"), 2)} Hz`, cb("TIE") === 1 ? "모선 연계" : "연계 개방"),
    EMS: r(s.alarm_cnt[1].act ? "bad" : "ok", `${s.auto ? "AUTO" : "MANUAL"} · ${F.n(s.stats.last_ms, 0)} ms`, s.alarm_cnt[1].act ? `긴급 경보 ${s.alarm_cnt[1].act}` : "정상"),
  };
  ["L1", "L2", "L3"].forEach((f, i) => { const kw = [k.l1, k.l2, k.l3][i], c = cb(f); out[f] = c === 2 ? r("bad", "0 kW", "트립 · 정전") : c === 0 ? r("idle", "0 kW", "개방") : r("ok", `${F.kw(kw)} kW`, "급전 중"); });
  return out;
}
function siteUpdate(s) {
  const st = siteState(s);
  SITE_PTS.forEach(p => { const e = $("#spt-" + p.id); if (!e) return; const x = st[p.id]; e.className = `spt ${p.left ? "l" : ""} ${x.st}`; $("#sptv-" + p.id).textContent = x.v; $("#spts-" + p.id).textContent = x.t; });
}

/* 장비 사진 카드: 사진 + 상태 띠 */
function equipPhoto(kind, st = {}) {
  const cls = st.lost || st.fault ? "bad" : st.on ? "ok" : "idle";
  const tag = st.lost ? "COMM LOSS" : st.fault ? "FAULT" : st.on ? "RUNNING" : "STANDBY";
  return `<div class="eqph ${cls}"><img src="${EQ_IMG[kind] || EQ_IMG.DIST}" alt="${kind}" loading="lazy"><span class="eqtag"><i></i>${tag}</span>${st.value !== undefined && st.value !== null && st.value !== "" ? `<span class="eqval mono">${st.value}</span>` : ""}</div>`;
}

/* 도넛(발전원 구성) */
function mixDonut(parts, total, size = 148) {
  const r = size / 2 - 12, c = 2 * Math.PI * r, sum = parts.reduce((a, p) => a + p[1], 0); let off = 0;
  const segs = sum > 0 ? parts.filter(p => p[1] > 0).map(([n, v, col]) => { const len = v / sum * c, gap = Math.min(3, len / 3); const sg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return sg; }).join("") : "";
  return `<svg width="${size}" height="${size}" class="donut"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(var(--edge),.08)" stroke-width="14"/>${segs}
    <text x="50%" y="47%" text-anchor="middle" class="dv">${F.n(total, 0)}</text><text x="50%" y="62%" text-anchor="middle" class="du">kW 발전</text></svg>`;
}

/* 경보 매트릭스(장비 × 우선순위) */
const MTX_ROWS = [["DG", ["DG", "CB-DG"]], ["FC", ["FC", "CB-FC"]], ["ESS", ["ESS", "CB-ESS"]], ["PV·계측", ["MTR", "CB-PV", "PV"]], ["모선·배전", ["BUS-A", "BUS-B", "CB-TIE", "CB-G1"]], ["부하", ["CB-L1", "CB-L2", "CB-L3"]], ["EMS", ["EMS"]]];
function alarmMatrix(alarms) {
  const cnt = MTX_ROWS.map(([, srcs]) => [1, 2, 3, 4].map(p => alarms.filter(a => a.prio === p && srcs.includes(a.src) && (a.state === "ACT" || !a.acked)).length));
  return `<div class="mtx"><span></span>${[1, 2, 3, 4].map(p => `<span class="mh">${prioTxt(p)}</span>`).join("")}
    ${MTX_ROWS.map(([nm], i) => `<span class="mr">${nm}</span>${cnt[i].map((n, j) => `<span class="mc ${n ? "p" + (j + 1) : ""}">${n}</span>`).join("")}`).join("")}</div>`;
}
