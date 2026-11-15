/* 등각(아이소메트릭) 벡터 장비 일러스트 — 자체 제작(제안서 이미지는 형태·구성만 참고)
   좌표: x(오른쪽 아래), y(왼쪽 아래), z(위), 단위 m.  면 그룹(faceL/faceR/faceT) 안에서는 면 기준 좌표로 그린다. */
"use strict";
const ISO_C = Math.cos(Math.PI / 6), ISO_S = 0.5;
const OD = { t: "#7b8459", l: "#5a6240", r: "#454c31", dk: "#2e3321", ln: "#23271a", hi: "#98a073", tire: "#1b1d16", rim: "#4a5137", sten: "#d7d9b8" };
let _isoN = 0;
class Iso {
  constructor(ox, oy, S) { this.ox = ox; this.oy = oy; this.S = S; this.id = "iso" + (++_isoN); }
  p(x, y, z = 0) { return [this.ox + (x - y) * ISO_C * this.S, this.oy + (x + y) * ISO_S * this.S - z * this.S]; }
  pts(a) { return a.map(q => this.p(...q).map(v => v.toFixed(1)).join(",")).join(" "); }
  poly(a, fill, extra = "") { return `<polygon points="${this.pts(a)}" fill="${fill}" stroke="#0b0d08" stroke-opacity=".38" stroke-width="${Math.max(.5, this.S * .035).toFixed(2)}" stroke-linejoin="round" ${extra}/>`; }
  ground(x0, y0, x1, y1) { return `<polygon points="${this.pts([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]])}" fill="url(#${this.id}gr)"/><polygon points="${this.pts([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]])}" fill="url(#${this.id}gv)" opacity=".3"/>`; }
  box(x, y, z, w, d, h, c = OD, extra = "") {
    return this.poly([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]], c.t, extra) +
      this.poly([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]], c.l, extra) +
      this.poly([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]], c.r, extra);
  }
  // 왼쪽 면(y=y0 평면, x 방향 폭 w, 높이 h): 원점=왼쪽 위, u→x, v↓
  faceL(x, y, z, h, inner) { const [X, Y] = this.p(x, y, z + h), S = this.S; return `<g transform="matrix(${(ISO_C * S).toFixed(3)},${(ISO_S * S).toFixed(3)},0,${S},${X.toFixed(1)},${Y.toFixed(1)})">${inner}</g>`; }
  // 오른쪽 면(x=x0 평면): 원점=y+d 쪽 위, u→(y 감소), v↓
  faceR(x, y, z, d, h, inner) { const [X, Y] = this.p(x, y + d, z + h), S = this.S; return `<g transform="matrix(${(ISO_C * S).toFixed(3)},${(-ISO_S * S).toFixed(3)},0,${S},${X.toFixed(1)},${Y.toFixed(1)})">${inner}</g>`; }
  // 윗면(z=z0 평면): 원점=(x,y), u→x, v→y
  faceT(x, y, z, inner) { const [X, Y] = this.p(x, y, z), S = this.S; return `<g transform="matrix(${(ISO_C * S).toFixed(3)},${(ISO_S * S).toFixed(3)},${(-ISO_C * S).toFixed(3)},${(ISO_S * S).toFixed(3)},${X.toFixed(1)},${Y.toFixed(1)})">${inner}</g>`; }
  shadow(x, y, w, d, op = .38) { return this.poly([[x - .2, y - .1, 0], [x + w + .5, y - .1, 0], [x + w + .5, y + d + .6, 0], [x - .2, y + d + .6, 0]], "#000", `opacity="${op}" filter="url(#${this.id}b)"`); }
  defs() { return `<defs><filter id="${this.id}b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${(this.S * .18).toFixed(1)}"/></filter>
    <linearGradient id="${this.id}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
    <linearGradient id="${this.id}gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fb7c9"/><stop offset=".45" stop-color="#2a3b4a"/><stop offset="1" stop-color="#16202a"/></linearGradient>
    <linearGradient id="${this.id}cy" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8f9aa8"/><stop offset=".4" stop-color="#eef2f6"/><stop offset="1" stop-color="#6c7684"/></linearGradient>
    <linearGradient id="${this.id}pv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f4f9a"/><stop offset=".5" stop-color="#15295e"/><stop offset="1" stop-color="#0c1a40"/></linearGradient>
    <pattern id="${this.id}camo" patternUnits="userSpaceOnUse" width="3.2" height="2.2"><path d="M.1 .3 C.6 0 1.2 .4 1.0 .8 C.8 1.2 .2 1.1 .1 .3Z" fill="#2f3520"/><path d="M1.5 .1 C2.2 -.1 2.9 .3 2.6 .7 C2.3 1.0 1.6 .8 1.5 .1Z" fill="#8a8a5c"/>
      <path d="M1.9 1.1 C2.6 .9 3.2 1.4 2.8 1.9 C2.4 2.3 1.7 1.8 1.9 1.1Z" fill="#3a2f22"/><path d="M.4 1.4 C1.0 1.2 1.5 1.6 1.2 2.0 C.9 2.3 .3 2.0 .4 1.4Z" fill="#6c7448"/></pattern>
    <radialGradient id="${this.id}gr" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#3a3d31" stop-opacity=".9"/><stop offset="1" stop-color="#3a3d31" stop-opacity="0"/></radialGradient>
    <pattern id="${this.id}gv" patternUnits="userSpaceOnUse" width="7" height="5"><circle cx="1" cy="1" r=".7" fill="#6b6b5c"/><circle cx="4.5" cy="2.4" r=".6" fill="#55554a"/><circle cx="2.6" cy="4" r=".5" fill="#77776a"/><circle cx="6" cy="4.4" r=".45" fill="#4a4a40"/></pattern>
    <radialGradient id="${this.id}lamp"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs>`;
  }
}
const NS = 'vector-effect="non-scaling-stroke"';
/* 컨테이너(골판·모서리 기둥·스텐실) */
function isoContainer(I, x, y, z, w, d, h, o = {}) {
  const c = o.c || OD; let ribs = "";
  for (let u = .35; u < w - .3; u += .32) ribs += `<rect x="${u.toFixed(2)}" y=".12" width=".13" height="${(h - .24).toFixed(2)}" fill="#000" opacity=".14"/>`;
  let ribsR = ""; for (let u = .3; u < d - .25; u += .32) ribsR += `<rect x="${u.toFixed(2)}" y=".12" width=".12" height="${(h - .24).toFixed(2)}" fill="#000" opacity=".12"/>`;
  return I.box(x, y, z, w, d, h, c) +
    I.faceL(x, y + d, z, h, `<rect width="${w}" height="${h}" fill="url(#${I.id}camo)" opacity="${o.camo ?? .42}"/>${ribs}<rect x="0" y="0" width=".16" height="${h}" fill="#000" opacity=".25"/><rect x="${w - .16}" y="0" width=".16" height="${h}" fill="#000" opacity=".25"/>
      <rect x="0" y="0" width="${w}" height=".12" fill="#fff" opacity=".08"/><rect x="0" y="${h - .12}" width="${w}" height=".12" fill="#000" opacity=".3"/>
      ${o.label ? `<text x="${o.lx ?? .6}" y="${o.ly ?? .75}" font-size="${o.fs ?? .34}" font-family="Consolas,monospace" font-weight="700" fill="${OD.sten}" opacity=".78">${o.label}</text>` : ""}
      ${o.sub ? `<text x="${o.lx ?? .6}" y="${(o.ly ?? .75) + .42}" font-size=".24" font-family="Consolas,monospace" fill="${OD.sten}" opacity=".55">${o.sub}</text>` : ""}${o.inL || ""}`) +
    I.faceR(x + w, y, z, d, h, `<rect width="${d}" height="${h}" fill="url(#${I.id}camo)" opacity="${o.camo ?? .42}"/>${ribsR}<rect x="${d / 2 - .02}" y=".1" width=".04" height="${h - .2}" fill="#000" opacity=".4"/>
      <rect x="${d * .25}" y=".2" width=".05" height="${h - .4}" fill="#1a1d14" opacity=".7"/><rect x="${d * .75}" y=".2" width=".05" height="${h - .4}" fill="#1a1d14" opacity=".7"/>${o.inR || ""}`) +
    I.faceT(x, y, z + h, `<rect width="${w}" height="${d}" fill="url(#${I.id}camo)" opacity="${(o.camo ?? .42) * .8}"/><rect x="0" y="0" width="${w}" height="${d}" fill="url(#${I.id}sh)" opacity=".5"/>${o.inT || ""}`);
}
/* 군용 트럭(8×8) — cargo(I, x0, z0, len) 콜백으로 적재물 */
function isoTruck(I, x, y, L, cargo, o = {}) {
  const Wd = 2.5, cabL = 2.3; let s = I.shadow(x, y, L, Wd);
  s += I.box(x + .2, y + .25, .7, L - .3, Wd - .5, .38, { t: OD.dk, l: OD.ln, r: OD.ln });
  const axles = o.axles || [1.2, 2.55, L - 2.6, L - 1.25];
  s += I.faceL(x, y + Wd - .1, 0, 1.2, axles.map(u => `<circle cx="${u}" cy=".62" r=".6" fill="${OD.tire}"/><circle cx="${u}" cy=".62" r=".34" fill="${OD.rim}"/><circle cx="${u}" cy=".62" r=".12" fill="#2a2e22"/>
    <path d="M${u - .6} .62 a.6 .6 0 0 1 1.2 0" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".05"/>`).join("") +
    `<rect x="${L - cabL - .35}" y=".05" width="1.0" height=".14" fill="${OD.dk}"/><rect x=".1" y=".05" width="1.2" height=".14" fill="${OD.dk}"/>`);
  s += cargo(I, x + .15, 1.08, L - cabL - .35);
  const cx = x + L - cabL; s += I.box(cx, y + .12, .95, cabL, Wd - .24, 2.15, { t: OD.t, l: OD.l, r: OD.r });
  s += I.box(cx + .1, y + .2, 3.1, cabL - .5, Wd - .4, .12, { t: OD.hi, l: OD.l, r: OD.r });
  s += I.faceL(cx, y + Wd - .12, .95, 2.15, `<rect width="${cabL}" height="2.15" fill="url(#${I.id}camo)" opacity=".4"/><rect x=".95" y=".22" width="1.15" height=".72" rx=".06" fill="url(#${I.id}gl)"/><rect x=".5" y=".2" width=".05" height="1.75" fill="#000" opacity=".35"/>
    <rect x=".7" y="1.15" width=".35" height=".06" fill="#1a1d14"/><rect x=".15" y="1.45" width="1.9" height=".08" fill="#000" opacity=".25"/>`);
  s += I.faceR(cx + cabL, y + .12, .95, Wd - .24, 2.15, `<rect x=".12" y=".2" width="${Wd - .48}" height=".78" rx=".05" fill="url(#${I.id}gl)"/><rect x="${(Wd - .24) / 2 - .02}" y=".2" width=".04" height=".78" fill="${OD.r}"/>
    <rect x=".12" y="1.15" width="${Wd - .48}" height=".5" fill="#2a2f20"/>${[0, 1, 2, 3, 4, 5].map(i => `<rect x="${.25 + i * .32}" y="1.2" width=".18" height=".4" fill="#151810"/>`).join("")}
    <rect x=".1" y="1.75" width=".35" height=".22" rx=".04" fill="#f3e7b0" opacity="${o.lights ? .95 : .55}"/><rect x="${Wd - .69}" y="1.75" width=".35" height=".22" rx=".04" fill="#f3e7b0" opacity="${o.lights ? .95 : .55}"/>`);
  s += I.box(cx + cabL, y + .05, .55, .25, Wd - .1, .35, { t: OD.dk, l: OD.ln, r: "#1c1f15" });
  return s;
}
function lamp(I, x, y, z, color, on) { const [X, Y] = I.p(x, y, z); return `<g style="color:${color}"><circle cx="${X}" cy="${Y}" r="${Math.min(14, I.S * .4)}" fill="url(#${I.id}lamp)" opacity="${on ? .9 : .25}" class="${on ? "eqpulse" : ""}"/><circle cx="${X}" cy="${Y}" r="${Math.min(3.5, I.S * .1)}" fill="${color}"/></g>`; }

/* ── 장비 모델 (각각 st = {on, lost, value, soc}) */
const ISO_MODELS = {
  ESS(I, st) {
    return isoTruck(I, 0, 0, 10.2, (I, x, z, len) => {
      let s = isoContainer(I, x, .1, z, len - 1.6, 2.3, 2.6, { label: "IFPS · ESS(GFM)", sub: "LFP 1.0MWh / PCS 500kW", inR: `<rect x=".3" y=".5" width=".7" height=".55" fill="#2b3020"/>${[0, 1, 2].map(i => `<rect x=".35" y="${.58 + i * .16}" width=".6" height=".07" fill="#151810"/>`).join("")}` });
      const rx = x + len - 1.1; s += I.faceL(rx - .8, 2.35, z, 2.4, `<circle cx=".8" cy="1.15" r="1.05" fill="#2a2e22"/><circle cx=".8" cy="1.15" r=".85" fill="#14160f"/>${[0, 1, 2, 3, 4].map(i => `<circle cx=".8" cy="1.15" r="${.8 - i * .14}" fill="none" stroke="#3b4130" stroke-width=".04"/>`).join("")}<circle cx=".8" cy="1.15" r=".14" fill="${OD.rim}"/>`);
      const soc = Math.max(0, Math.min(100, st.soc ?? 60));
      s += I.faceL(x, 2.4, z, 2.6, `<rect x="${len - 3.3}" y=".55" width="1.25" height=".34" rx=".05" fill="#0b0d0a"/><rect x="${len - 3.25}" y=".6" width="${1.15 * soc / 100}" height=".24" rx=".03" fill="#b39ddb"/>`);
      return s + lamp(I, x + len - 2.2, 2.4, z + 2.2, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
    }, { lights: st.on });
  },
  PV(I, st) {
    let s = isoTruck(I, 0, 0, 10.4, (I, x, z, len) => {
      let r = I.box(x, .1, z, len - .2, 2.3, .25, { t: "#6a7350", l: OD.l, r: OD.r });
      r += I.box(x + 1.4, .2, z + .25, .25, 2.1, 2.9, OD) + I.box(x + len - 1.9, .2, z + .25, .25, 2.1, 2.9, OD);
      const cxr = (len - 3.2) / 2 + 1.5;
      r += I.faceL(x, 2.45, z + .2, 3.6, `<circle cx="${cxr}" cy="1.75" r="1.62" fill="#0c1430"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<circle cx="${cxr}" cy="1.75" r="${1.55 - i * .17}" fill="none" stroke="${i % 2 ? "#2a447f" : "#1a2b5c"}" stroke-width=".07"/>`).join("")}
        <circle cx="${cxr}" cy="1.75" r=".32" fill="${OD.rim}"/><circle cx="${cxr}" cy="1.75" r=".12" fill="#1b1e15"/>
        <path d="M${cxr - 1.7} 3.55 L${cxr} 1.75 L${cxr + 1.7} 3.55" stroke="${OD.l}" stroke-width=".22" fill="none"/>`);
      return r + lamp(I, x + .6, 2.4, z + .7, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
    }, { lights: st.on });
    for (let k = 0; k < 3; k++) {                                 // 지면에 펼친 PV 필름 3열(트럭 앞쪽 = 화면 앞)
      const x0 = 2.4 + k * 1.9; let cells = "";
      for (let r = 0; r < 9; r++) for (let c = 0; c < 3; c++) cells += `<rect x="${.06 + c * .56}" y="${.08 + r * .7}" width=".5" height=".62" fill="url(#${I.id}pv)" stroke="#9cb9ff" stroke-opacity=".28" stroke-width=".02"/>`;
      const [ax, ay] = I.p(x0 + .85, 2.7, 2.0), [bx, by] = I.p(x0 + .85, 4.3, .02);
      s += `<path d="M${ax} ${ay} L${bx} ${by}" stroke="#14214a" stroke-width="${I.S * 1.6}" opacity=".95"/>`;
      s += I.faceT(x0, 4.3, .02, `<rect x="-.04" y="0" width="1.76" height="6.5" fill="#c7cfdc" opacity=".55"/>${cells}<rect x="0" y="0" width="1.7" height="6.5" fill="#fff" opacity="${st.on ? .10 : .02}"/>`);
    }
    return s;
  },
  FC(I, st) {
    return isoTruck(I, 0, 0, 11, (I, x, z, len) => {
      const w = len - .2, d = 2.4, h = 2.8; let cyl = "";
      for (let i = 0; i < 4; i++) cyl += `<rect x="${1.0 + i * .5}" y=".35" width=".42" height="${h - .75}" rx=".2" fill="url(#${I.id}cy)"/><rect x="${1.12 + i * .5}" y=".25" width=".18" height=".14" fill="#7b8696"/>`;
      let s = isoContainer(I, x, 0, z, w, d, h, {
        label: "H₂", lx: .3, ly: 1.1, fs: .62, inL: `<rect x=".85" y=".25" width="2.2" height="${h - .5}" fill="#11140d"/>${cyl}
          <rect x="3.3" y=".3" width="1.4" height="${h - .6}" fill="#1a1e15"/>${[0, 1, 2, 3].map(i => `<rect x="3.42" y="${.45 + i * .5}" width="1.16" height=".36" fill="#2b3122"/><rect x="3.5" y="${.55 + i * .5}" width=".3" height=".1" fill="${st.on ? "#8fd36a" : "#566043"}"/>`).join("")}
          <g transform="translate(${w - 1.1} .7)"><polygon points=".35,0 .7,.35 .35,.7 0,.35" fill="#e8c21c"/><text x=".35" y=".46" text-anchor="middle" font-size=".28" font-weight="900" fill="#111">!</text></g>
          <text x="${w - 2.6}" y="${h - .45}" font-size=".24" font-family="Consolas,monospace" fill="${OD.sten}" opacity=".7">HYDROGEN POWER</text>`,
        inT: [0, 1, 2, 3, 4, 5].map(i => `<rect x="${.3 + i * ((w - .6) / 6)}" y=".25" width="${(w - .6) / 6 - .12}" height="${d - .5}" fill="url(#${I.id}pv)" stroke="#8fb0ff" stroke-opacity=".3" stroke-width=".02"/>`).join(""),
      });
      return s + lamp(I, x + w - .4, d, z + h - .3, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
    }, { lights: st.on });
  },
  DG(I, st) {
    return isoTruck(I, 0, 0, 9.4, (I, x, z, len) => {
      let s = isoContainer(I, x, .1, z, len - 2.6, 2.3, 2.5, { label: "HYBRID POWER", sub: "ESS 200kWh + DG 60/30kW" });
      const gx = x + len - 2.4; s += I.box(gx, .25, z, 2.1, 2.0, 1.9, { t: "#6d7550", l: "#4c5336", r: "#3a402a" });
      s += I.faceL(gx, 2.25, z, 1.9, [0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${.2 + i * .26}" y=".3" width=".14" height="1.2" fill="#1d2016"/>`).join(""));
      s += I.box(gx + .7, .8, z + 1.9, .32, .32, 1.0, { t: "#3a3f30", l: "#5d6152", r: "#43473a" });
      if (st.on) { const [sx, sy] = I.p(gx + .86, .96, z + 3.0); s += `<g class="eqsmoke"><circle cx="${sx + 4}" cy="${sy - 8}" r="${I.S * .45}" fill="#aab0bd" opacity=".35"/><circle cx="${sx + 12}" cy="${sy - 22}" r="${I.S * .65}" fill="#aab0bd" opacity=".2"/></g>`; }
      return s + lamp(I, gx + 1.9, 2.25, z + 1.6, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
    }, { lights: st.on });
  },
  G1(I, st) { return ISO_MODELS.DG(I, Object.assign({}, st, { on: false })); },
  DIST(I, st) {
    let s = I.shadow(0, 0, 9.2, 3.2) + I.box(-.2, -.2, 0, 9.6, 3.6, .35, { t: "#4a503a", l: "#363b2a", r: "#2b2f21" });
    let bay = "", w = 8.8, h = 2.7;
    for (let i = 0; i < 4; i++) bay += `<rect x="${.5 + i * 1.05}" y=".3" width=".95" height="2.1" fill="#8c9389"/><rect x="${.6 + i * 1.05}" y=".45" width=".75" height=".45" fill="#2a2f2a"/><circle cx="${.75 + i * 1.05}" cy="1.2" r=".08" fill="${st.on ? "#8fd36a" : "#666"}"/><circle cx="${1.0 + i * 1.05}" cy="1.2" r=".08" fill="#e05040"/>`;
    for (let i = 0; i < 3; i++) bay += `<rect x="${5.0 + i * .65}" y=".75" width=".5" height="1.6" rx=".2" fill="#8b3a22"/><rect x="${5.05 + i * .65}" y=".95" width=".4" height="1.2" rx=".15" fill="#a6482a"/><rect x="${5.15 + i * .65}" y=".55" width=".2" height=".25" fill="#c9c9c0"/>`;
    bay += `<rect x="7.2" y=".3" width="1.2" height="2.1" fill="#7c8279"/>${[0, 1, 2, 3, 4].map(i => `<rect x="7.3" y="${.45 + i * .38}" width="1.0" height=".22" fill="#565c55"/>`).join("")}`;
    s += isoContainer(I, 0, 0, .35, w, 3.0, h, { inL: `<rect x=".3" y=".2" width="${w - .6}" height="${h - .4}" fill="#1a1d17"/>${bay}`, label: "", c: OD });
    s += I.faceL(0, 3.0, .35, h, `<text x=".35" y="-.12" font-size=".3" font-family="Consolas,monospace" font-weight="700" fill="${OD.sten}" opacity=".7">22.9kV / 6.6kV / 380V</text>`);
    for (let i = 0; i < 6; i++) { const [a, b] = I.p(1 + i * 1.3, 3.6, .1), [c2, d2] = I.p(.6 + i * 1.4, 6.4, 0); s += `<path d="M${a} ${b} Q${(a + c2) / 2 - 10} ${(b + d2) / 2 + 8} ${c2} ${d2}" stroke="#15170f" stroke-width="${I.S * .16}" fill="none"/>`; }
    return s + lamp(I, 8.6, 3.0, 3.1, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
  },
  EMS(I, st) {
    let s = I.shadow(0, 0, 9, 3) + I.box(-.2, -.2, 0, 9.4, 3.4, .3, { t: "#4a503a", l: "#363b2a", r: "#2b2f21" });
    let con = ""; const scr = st.on === false ? "#203028" : "#34d2a8";
    for (let i = 0; i < 4; i++) con += `<rect x="${.7 + i * 1.75}" y="1.55" width="1.5" height=".75" fill="#2c3124"/><rect x="${.8 + i * 1.75}" y=".7" width=".62" height=".42" fill="#0a1218"/><rect x="${1.48 + i * 1.75}" y=".7" width=".62" height=".42" fill="#0a1218"/>
      <path d="M${.85 + i * 1.75} 1.0 l.15 -.1 .12 .06 .14 -.16 .12 .08" stroke="${scr}" stroke-width=".035" fill="none"/><rect x="${1.53 + i * 1.75}" y=".76" width=".5" height=".08" fill="${scr}" opacity=".7"/><rect x="${1.53 + i * 1.75}" y=".9" width=".32" height=".08" fill="#e6c552" opacity=".7"/>
      <rect x="${1.05 + i * 1.75}" y="1.25" width=".7" height=".3" rx=".1" fill="#1b1e16"/>`;
    s += isoContainer(I, 0, 0, .3, 8.8, 3.0, 2.7, { inL: `<rect x=".35" y=".25" width="8.1" height="2.25" fill="#141811"/><rect x=".35" y=".25" width="8.1" height="2.25" fill="#34d2a8" opacity="${st.on === false ? 0 : .05}"/>${con}`, label: "" });
    s += I.faceL(0, 3.0, .3, 2.7, `<text x=".35" y="-.12" font-size=".3" font-family="Consolas,monospace" font-weight="700" fill="${OD.sten}" opacity=".7">IFPS EMS · C2 SHELTER</text>`);
    const [ax, ay] = I.p(7.8, .6, 3.0); s += `<line x1="${ax}" y1="${ay}" x2="${ax}" y2="${ay - I.S * 2.2}" stroke="#3b4130" stroke-width="2"/><circle cx="${ax}" cy="${ay - I.S * 2.2}" r="${I.S * .14}" fill="#c9cba8"/>`;
    return s + lamp(I, 8.6, 3.0, 2.8, st.lost ? "#ff5148" : "#8fd36a", true);
  },
  MTR(I, st) { return ISO_MODELS.DIST(I, st); },
  FSU(I, st) {
    let s = I.shadow(0, 0, 1.6, 1.4, .3) + I.box(0, 0, 0, 1.6, 1.3, 1.5, { t: "#727b55", l: "#535a3c", r: "#40462f" });
    s += I.faceL(0, 1.3, 0, 1.5, `<polygon points=".55,.3 .8,.55 .55,.8 .3,.55" fill="#e8c21c"/><rect x=".2" y="1.15" width="1.2" height=".14" fill="#1b1e15"/>`);
    return s + lamp(I, 1.4, 1.3, 1.3, st.lost ? "#ff5148" : st.on === false ? "#f0b23a" : "#8fd36a", true);
  },
  TENT(I, st, o = {}) {
    const w = o.w || 6, d = o.d || 4, h = 1.5, rz = 2.7; let s = I.shadow(0, 0, w, d, .3);
    s += I.box(0, 0, 0, w, d, h, { t: "#6e7652", l: "#5f6746", r: "#4d5439" });
    s += I.poly([[0, d, h], [w, d, h], [w, d / 2, rz], [0, d / 2, rz]], "#6c744f") + I.poly([[w, d, h], [w, 0, h], [w, d / 2, rz]], "#525a3c");
    s += I.faceL(0, d, 0, h, [1, 2, 3, 4, 5].map(i => `<rect x="${i * w / 6}" y="0" width=".05" height="${h}" fill="#000" opacity=".18"/>`).join(""));
    s += I.faceR(w, 0, 0, d, h, [1, 2, 3].map(i => `<rect x="${i * d / 4}" y="0" width=".05" height="${h}" fill="#000" opacity=".2"/>`).join(""));
    if (o.cross) s += I.faceL(w * .35, d * .75, h + .55, .6, `<rect x="0" y="0" width="1.3" height=".6" fill="#f2f0e6"/><rect x=".52" y=".05" width=".26" height=".5" fill="#c62828"/><rect x=".38" y=".19" width=".54" height=".22" fill="#c62828"/>`);
    s += I.faceL(0, d, 0, h, `<rect x="${w * .4}" y=".3" width="1.1" height="1.2" fill="#2c3122"/><rect x="${w * .4 + .1}" y=".4" width=".9" height=".5" fill="${st.on ? "#e6c552" : "#20251a"}" opacity=".8"/>`);
    if (o.mast) { const [ax, ay] = I.p(w + .6, .4, 0); s += `<line x1="${ax}" y1="${ay}" x2="${ax}" y2="${ay - I.S * 4}" stroke="#3b4130" stroke-width="2"/><ellipse cx="${ax - 6}" cy="${ay - I.S * 3.2}" rx="${I.S * .5}" ry="${I.S * .35}" fill="#c8cbb8"/>`; }
    return s + lamp(I, w - .3, d, 1.2, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
  },
  AMMO(I, st) {
    let s = I.shadow(0, 0, 6, 4.5, .3);
    const bag = (x, y, z, w, d) => I.box(x, y, z, w, d, .32, { t: "#a39a73", l: "#857c5a", r: "#6f6849" });
    for (let k = 0; k < 3; k++) { for (let i = 0; i < 8; i++) s += bag(i * .75, 0, k * .33, .7, .6); for (let i = 0; i < 6; i++) s += bag(0, .65 + i * .62, k * .33, .6, .58); }
    s += I.box(1.3, 1.2, 0, 2.6, 2.0, 1.2, { t: "#6d7550", l: "#4f5638", r: "#3d432c" }) + I.box(4.0, 1.6, 0, 1.4, 1.6, .8, { t: "#6d7550", l: "#4f5638", r: "#3d432c" });
    for (let k = 0; k < 3; k++) { for (let i = 0; i < 8; i++) s += bag(i * .75, 3.9, k * .33, .7, .6); for (let i = 0; i < 6; i++) s += bag(5.4, .65 + i * .55, k * .33, .6, .52); }
    return s + lamp(I, 3.9, 3.2, 1.1, st.lost ? "#ff5148" : st.on ? "#8fd36a" : "#f0b23a", true);
  },
  L1(I, st) { return ISO_MODELS.TENT(I, st, { mast: true }); },
  L2(I, st) { return ISO_MODELS.TENT(I, st, { cross: true, w: 6.5 }); },
  L3(I, st) { return ISO_MODELS.AMMO(I, st); },
};
const ISO_EXT = { ESS: [10.2, 2.6, 4.2], PV: [10.6, 10.9, 4.6], FC: [11, 2.6, 4.2], DG: [9.4, 2.6, 4.8], G1: [9.4, 2.6, 4.8], DIST: [9.6, 6.6, 3.5], MTR: [9.6, 6.6, 3.5], EMS: [9.4, 3.4, 5.4], FSU: [1.8, 1.6, 1.8], L1: [7, 4.5, 5.5], L2: [6.8, 4.2, 3.2], L3: [6.2, 4.6, 1.6] };
/* 단독 그림: 뷰박스에 맞춰 축척 자동 계산 */
function isoArt(kind, st = {}, W = 400, H = 250, pad = 14) {
  const [Lx, Ly, Lz] = ISO_EXT[kind] || ISO_EXT.DIST, oy0 = 0;
  const S = Math.min((W - 2 * pad) / ((Lx + Ly) * ISO_C), (H - 2 * pad) / ((Lx + Ly) * ISO_S + Lz));
  const ox = (W - (Lx + Ly) * ISO_C * S) / 2 + (Ly + oy0) * ISO_C * S, oy = (H - ((Lx + Ly) * ISO_S + Lz) * S) / 2 + Lz * S - oy0 * ISO_S * S;
  const I = new Iso(ox, oy, S);
  return `<svg viewBox="0 0 ${W} ${H}" class="isoart" preserveAspectRatio="xMidYMid meet">${I.defs()}${I.ground(-1.5, -1.2, Lx + 1, Ly + 1)}${ISO_MODELS[kind] ? ISO_MODELS[kind](I, st) : ""}</svg>`;
}
/* 다른 SVG 안에 넣는 그룹(배치도용): 기준점(px,py)에 축척 S로 */
function isoPlace(kind, st, px, py, S) { const I = new Iso(px, py, S); return `<g>${I.defs()}${ISO_MODELS[kind](I, st)}</g>`; }
