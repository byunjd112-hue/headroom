// 실제 학습 결과(ai_paper_eval.json)를 3차원 다면체로 그린다. 위치·크기·굵기는 모두 자료의 값이다(장식용 배치 없음).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const W = 1600, H = 900, AMBER = 0xffb347, TEAL = 0x35c9c0, WHITE = 0xffffff;
const name = new URLSearchParams(location.search).get("s"), D = await (await fetch("/data.json")).json();
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d0f13); scene.fog = new THREE.Fog(0x0d0f13, 22, 46);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 200);
const key = new THREE.DirectionalLight(0xfff1dd, 2.2); key.position.set(6, 14, 8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 }); key.shadow.radius = 6; scene.add(key);
scene.add(new THREE.DirectionalLight(0x7fd8ff, 0.5).translateX(-8).translateY(5).translateZ(-6));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.82, metalness: 0.15 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x2a313c, 0x1b2028); grid.position.y = 0.002; scene.add(grid);

const glass = (color, o = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.06, metalness: 0, transmission: 0.92, thickness: 0.6, ior: 1.5, attenuationColor: new THREE.Color(color), attenuationDistance: 1.6, flatShading: true, envMapIntensity: 1.3 }, o));
const gem = (color, o = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true, emissive: new THREE.Color(color), emissiveIntensity: 0.25 }, o));
const metal = new THREE.MeshStandardMaterial({ color: 0xb9bec7, roughness: 0.28, metalness: 1 });
const glow = (color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity: 0.95 });
const add = (geo, mat, x, y, z, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; scene.add(m); return m; };
function rod(a, b, r, mat) {                                             // 두 점을 잇는 막대(빛줄기·축·잔차선)
  const v = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, v.length(), 10, 1), mat);
  m.position.copy(a).addScaledVector(v, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()); scene.add(m); return m;
}
const V3 = (x, y, z) => new THREE.Vector3(x, y, z), mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));
const labels = [];
function label(html, p, cls = "", dx = 0, dy = 0) { labels.push({ html, p: p.clone(), cls, dx, dy }); }
function flush() {
  for (const L of labels) { const v = L.p.clone().project(cam), el = document.createElement("div"); el.className = "lb " + L.cls; el.innerHTML = L.html;
    el.style.left = ((v.x + 1) / 2 * W + L.dx) + "px"; el.style.top = ((1 - v.y) / 2 * H + L.dy) + "px"; document.body.appendChild(el); }
}
function axis(a, b, text, dx = 0, dy = 0) { rod(a, b, 0.025, metal); add(new THREE.ConeGeometry(0.09, 0.3, 12), metal, b.x, b.y, b.z).quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize()); label(text, b, "ax", dx, dy); }
function title(t, sub) { const e = document.createElement("div"); e.className = "ttl"; e.innerHTML = `<b>${t}</b><span>${sub}</span>`; document.body.appendChild(e); }
function formula(html, x, y) { const e = document.createElement("div"); e.className = "fx"; e.style.left = x + "px"; e.style.top = y + "px"; e.innerHTML = html; document.body.appendChild(e); }
let bloom = 0.28;

const SC = {
  ridge() {                                                               // ① 릿지 회귀: 실제 학습 표본과, 두 특징에 대한 학습된 단면 평면
    const R = D.viz.ridge, S = 7, H3 = 5, P = (x1, x2, y) => V3((x1 - 0.5) * S, 0.4 + y * H3, (0.5 - x2) * S);
    const g = new THREE.BufferGeometry(), f = (x1, x2) => R.c + R.a * x1 + R.b * x2, c = [[0, 0], [1.1, 0], [1.1, 1], [0, 1]].map(([u, v]) => P(u, v, f(u, v)));
    g.setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]]); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: 0x9fe8ff, transmission: 0.85, roughness: 0.05, thickness: 0.2, side: THREE.DoubleSide, transparent: true, opacity: 0.55, envMapIntensity: 1.5 })));
    for (let i = 0; i < 4; i++) rod(c[i], c[(i + 1) % 4], 0.03, glow(0x9fe8ff, 0.9));
    const ico = new THREE.IcosahedronGeometry(0.085, 0), res = glow(WHITE, 0.55);
    for (const [x1, x2, y, yh] of R.pts) { const p = P(x1, x2, y); add(ico, gem(mix(TEAL, AMBER, y)), p.x, p.y, p.z); if (Math.abs(y - yh) > 0.01) rod(p, P(x1, x2, yh), 0.008, res); }
    axis(P(0, 0, -0.08), P(1.22, 0, -0.08), "x₁ " + R.x1, 10, 4); axis(P(0, 0, -0.08), P(0, 1.14, -0.08), "x₂ " + R.x2, -60, 16); axis(P(0, 0, -0.08), P(0, 0, 1.2), "y  1시간 이내 청천 지수", -230, -10);
    label("학습된 단면  ŷ = c + a·x₁ + b·x₂<br><small>a = " + R.a + " , b = " + R.b + " (나머지 18개 특징은 평균에 고정)</small>", P(1.1, 0, f(1.1, 0)), "tag", -420, -90);
    label("잔차  r = y − ŷ  (흰 선)", P(0.3, 0.75, 0.3), "tag", -250, 40);
    title("릿지 회귀 — 학습 표본과 학습된 평면", `1시간 이내 구간 · 점 ${R.pts.length}개는 실제 학습 표본 ${R.n_fit.toLocaleString()}건에서 뽑은 것 · 가중치 ${R.n_w}개`);
    formula("w = (XᵀX + λI)⁻¹ Xᵀy ,  λ = " + R.lam, 60, 790);
    cam.position.set(-9.5, 12.5, 12.0); cam.lookAt(0, 2.5, 0);
  },
  attn() {                                                                // ② 주의집중: 질의 주변 기억의 실제 위치(가중 거리의 주된 3축)와 실제 가중치
    const A = D.viz.att, dist = m => Math.hypot(m[0] - A.q[0], m[1] - A.q[1], m[2] - A.q[2]), R = Math.max(...A.mem.slice(0, 120).map(dist)) * 1.25, k = 5.6 / R;
    const mem = A.mem.filter(m => dist(m) <= R), P = z => V3((z[0] - A.q[0]) * k, 3.3 + (z[1] - A.q[1]) * k * 0.55, (z[2] - A.q[2]) * k), q = P(A.q), wmax = mem[0][3], oct = new THREE.OctahedronGeometry(1, 0);
    add(new THREE.IcosahedronGeometry(0.4, 0), glass(0xfff3d6, { emissive: new THREE.Color(0xffe2a8), emissiveIntensity: 0.9 }), q.x, q.y, q.z);
    for (const r of [0.5, 1.0]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(R * r * k, 0.012, 8, 120), glow(0x6f7f95, 0.8)); ring.rotation.x = Math.PI / 2; ring.position.set(q.x, 0.02, q.z); scene.add(ring); }
    mem.forEach(m => { const p = P(m), w = m[3], r = 0.05 + 0.27 * (w / wmax), col = m[4] === null ? 0x7a8696 : mix(TEAL, AMBER, (m[4] - 0.3) / 0.7);
      add(oct, gem(col, { emissiveIntensity: 0.05 + 0.22 * w / wmax }), p.x, p.y, p.z).scale.setScalar(r); rod(V3(p.x, 0.01, p.z), p, 0.004, glow(0x55606e, 0.7));
      if (w > 0.1) rod(q, p, 0.005 + 0.055 * (w / wmax), glow(mix(TEAL, AMBER, w / wmax), 0.35 + 0.75 * w / wmax)); });
    mem.slice(0, 3).forEach((m, i) => label(`K<sub>${i + 1}</sub> · ${m[5].slice(5)}<br><small>w<sub>${i + 1}</sub> = ${m[3].toFixed(2)}% · V<sub>${i + 1}</sub> = ${m[4]}</small>`, V3(6.4, 5.9 - i * 0.95, 0), "tag", 0, 0));
    label("질의 q<br><small>" + A.issued.slice(5) + " 발행</small>", q, "tag hot", -190, -70);
    const o = V3(5.6, 0.2, 2.2); axis(o, V3(7.8, 0.2, 2.2), "① " + A.axes[0] + " · s₁=" + A.s[0], 6, 2); axis(o, V3(5.6, 1.8, 2.2), "② " + A.axes[1] + " · s₂=" + A.s[1], 10, -18); axis(o, V3(5.6, 0.2, 0.4), "③ " + A.axes[2] + " · s₃=" + A.s[2], 12, -16);
    label("바닥 고리 = 질의에서 같은 가중 거리", V3(q.x + R * k * 0.72, 0.02, q.z + R * k * 0.72), "ax", 8, 0);
    title("주의집중 — 닮은 과거일수록 굵은 빛줄기", `쓸 수 있는 기억 ${A.n_ok.toLocaleString()}건 중 질의 가까이 ${mem.length}건 표시 · 위치 = sₖ 를 곱한 실제 거리 · 다면체 크기와 빛줄기 굵기 = 실제 가중치 wᵢ · 색 = 그때 1시간 뒤 실제 청천 지수 Vᵢ`);
    formula("wᵢ = exp(−Σₖ sₖ²(qₖ − Kᵢₖ)²) / Σⱼ exp(…)   →   r̂(1h) = Σᵢ wᵢVᵢ = " + A.pred_1h + (A.act_1h === null ? "" : "   (실측 " + A.act_1h + ")"), 60, 790);
    cam.position.set(2.0, 8.6, 17.0); cam.lookAt(0.6, 2.7, 0); bloom = 0.32;
  },
  imp() {                                                                 // ③ 특징별 중요도 sₖ: 기둥 높이 = 학습된 값
    const T = D.att, n = T.names.length, hex = new THREE.CylinderGeometry(0.34, 0.34, 1, 6);
    T.names.forEach((nm, k) => { const x = (k - (n - 1) / 2) * 1.12;
      [[T.s_near[k], AMBER, 1.1], [T.s_far[k], TEAL, -0.9]].forEach(([s, col, z]) => { const h = Math.max(0.03, s * 0.95), m = add(hex, s > 0 ? glass(col, { emissive: new THREE.Color(col), emissiveIntensity: 0.25 }) : metal, x, h / 2, z); m.scale.y = h;
        if (s > 0) label(String(s), V3(x, h + 0.02, z), "num", -10, -22); });
      label(`<i>k=${k + 1}</i> ${nm}`, V3(x, 0, 1.9), "rot", -8, 10); });
    label("가까운 예측 (2시간 이내)  s<sub>near</sub>", V3(7.6, 1.6, 1.1), "tag hot", -330, -150); label("먼 예측 (2~24시간)  s<sub>far</sub>", V3(7.6, 2.4, -0.9), "tag", -330, -190);
    title("특징별 중요도 sₖ — 기둥 높이가 학습된 값", "13개 특징 × 2(가까운·먼 예측) = 26개만 학습 · 0 은 '보지 않는다'는 뜻 · 좌표 하강으로 검증 오차가 줄 때만 값을 바꾼다");
    formula("sₖ ← sₖ × {2, ½, 0}  중 검증 MAE 를 줄이는 값  (특징마다 2회 반복)", 60, 790);
    cam.position.set(0.5, 9.5, 18.5); cam.lookAt(0, 1.3, 0.6);
  },
  band() {                                                                // ④ 예측 구간: 실제 한 번의 태양광 예측(중앙·10~90%)과 실측
    const S = D.sample.pv, n = S.p50.length, mx = Math.max(...S.hi, ...S.act, 1), X = h => (h - n / 2) * 0.16, Y = v => 0.25 + v / mx * 5;
    const sh = new THREE.Shape(); sh.moveTo(X(0), Y(S.lo[0])); for (let h = 1; h < n; h++) sh.lineTo(X(h), Y(S.lo[h])); for (let h = n - 1; h >= 0; h--) sh.lineTo(X(h), Y(S.hi[h]));
    const b = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false }), new THREE.MeshPhysicalMaterial({ color: 0xffd9a0, transmission: 0.8, roughness: 0.35, thickness: 0.9, transparent: true, opacity: 0.5 })); b.position.z = -0.45; scene.add(b);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(S.p50.map((v, h) => V3(X(h), Y(v), 0))), 300, 0.06, 10), glow(AMBER, 1.5)));
    const ico = new THREE.IcosahedronGeometry(0.075, 0); let inb = 0, day = 0;
    S.act.forEach((v, h) => { if (S.hi[h] <= 0.5) return; day++; const ok = v >= S.lo[h] && v <= S.hi[h]; inb += ok; add(ico, gem(ok ? 0xffffff : 0xff5d5d, { emissiveIntensity: 0.6 }), X(h), Y(v), 0); });
    axis(V3(X(0), 0.25, 1.2), V3(X(n) + 0.5, 0.25, 1.2), "선행시간 h (15분 × 96 = 24시간)", -250, 12); axis(V3(X(0), 0.25, 1.2), V3(X(0), 5.9, 1.2), "출력 kW", 10, -16);
    const pk = S.p50.indexOf(Math.max(...S.p50)); label("중앙 예측  ŷ(h)", V3(X(pk), Y(S.p50[pk]), 0), "tag hot", -150, -58); label("80% 구간  [ŷ + Q₁₀(r), ŷ + Q₉₀(r)]", V3(X(pk + 9), Y(S.hi[pk + 9]), 0), "tag", 30, -40);
    label(`실측 (흰 점 = 구간 안 ${inb}/${day})`, V3(X(n - 6), Y(S.act[n - 6]), 0), "tag", 30, -10);
    title("예측 구간 — 실제 한 번의 태양광 24시간 예측", `${S.issued} 발행 · 띠 = 최근 7일 오차의 10~90% 분위수 · 점 = 그 뒤 실제 출력 · 최대 ${Math.round(mx)} kW`);
    formula("r = y − ŷ (최근 7일)  →  구간 = [ ŷ + Q₁₀(r) ,  ŷ + Q₉₀(r) ] × 청천 출력", 60, 790);
    cam.position.set(-3.0, 7.5, 25.0); cam.lookAt(0.2, 2.3, 0);
  },
  alpha() {                                                               // ⑤ 섞는 비율 α_b: 기둥의 주황 부분 = 주의집중, 청록 부분 = 릿지
    const P = D.pv[D.pv.length - 1], bk = D.data.buckets, box = new THREE.BoxGeometry(1.25, 1, 1.25), HT = 4.4;
    P.alpha.forEach((a, i) => { const x = (i - 2.5) * 2.05; if (a < 1) add(box, glass(TEAL), x, (1 - a) * HT / 2, 0).scale.y = Math.max(0.02, (1 - a) * HT);
      if (a > 0) add(box, glass(AMBER, { emissive: new THREE.Color(AMBER), emissiveIntensity: 0.35 }), x, (1 - a) * HT + a * HT / 2, 0).scale.y = a * HT;
      label(`<b>α = ${Math.round(a * 100)}%</b>`, V3(x, HT, 0), "num", -34, -30); label(`≤ ${bk[i]}시간<br><small>오차 ${D.pv[1].by_h[i]} → ${P.by_h[i]}%</small>`, V3(x, 0, 1.0), "tag", -52, 12); });
    label("주의집중 예측 몫", V3(-5.1, HT * 0.8, 0), "tag hot", -200, -10); label("릿지 회귀 몫", V3(3.1, HT * 0.4, 0.7), "tag", 60, -6);
    title("섞는 비율 α — 선행시간 구간마다 검증된 만큼만", "기둥의 주황 = 주의집중 몫, 청록 = 릿지 몫 · 보정 구간 오차가 2% 이상 줄지 않으면 α = 0 · 아래 숫자는 시험 14일의 오차(카메라만 → 주의집중 포함)");
    formula("r̂ = (1 − α_b)·r̂(릿지) + α_b·r̂(주의집중) ,   α_b ∈ {0, ¼, ½, ¾, 1}", 60, 790);
    cam.position.set(2.5, 6.8, 15); cam.lookAt(0, 2.0, 0);
  },
  arch() {                                                                // ⑥ 전체 구조: 블록의 개수가 실제 개수(특징·가중치·중요도·비율)
    const C = D.cost, cube = new THREE.BoxGeometry(0.34, 0.34, 0.34), oct = new THREE.OctahedronGeometry(0.11, 0), pipe = (a, b, col) => rod(a, b, 0.035, glow(col, 0.9));
    const ins = [["발전 실적", AMBER], ["구름량(카메라)", 0x8fd3ff], ["기온", 0xff8a65], ["기압", 0xb39ddb], ["습도", TEAL]];
    ins.forEach(([t, c], i) => { const z = (i - 2) * 1.25; add(new THREE.BoxGeometry(0.8, 0.8, 0.8), glass(c, { emissive: new THREE.Color(c), emissiveIntensity: 0.3 }), -9.2, 0.42, z); label(t, V3(-9.2, 0.9, z), "tag", -150, -14); pipe(V3(-8.8, 0.42, z), V3(-6.9, 0.6, z * 0.35), c); });
    for (let k = 0; k < 20; k++) add(cube, gem(0xdfe6ee), -6.4 + (k % 4) * 0.4, 0.2 + Math.floor(k / 4) * 0.4, -1.2);                    // 릿지 특징 20개
    for (let k = 0; k < 13; k++) add(cube, gem(0xffe0a3), -6.4 + (k % 4) * 0.4, 0.2 + Math.floor(k / 4) * 0.4, 1.3);                    // 상황 벡터 13개
    label("특징 x · 20개", V3(-5.8, 2.2, -1.2), "tag", -60, -34); label("상황 q · 13개", V3(-5.8, 1.8, 1.3), "tag hot", -150, 46);
    for (let b = 0; b < 6; b++) for (let j = 0; j < 21; j++) add(cube, glass(mix(0x7fb8ff, TEAL, b / 5), { emissive: mix(0x7fb8ff, TEAL, b / 5), emissiveIntensity: 0.2 }), -2.6 + (j % 7) * 0.38, 0.2 + b * 0.42, -2.6 + Math.floor(j / 7) * 0.38);   // 가중치 6구간 × 21
    label(`릿지 회귀<br><small>6구간 × 21 = ${C.params_ridge}개 가중치</small>`, V3(-1.4, 2.9, -2.2), "tag", -70, -66);
    const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
    for (let i = 0; i < 252; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(rnd()), r = 1.55; add(oct, gem(mix(TEAL, AMBER, rnd()), { emissiveIntensity: 0.35 }), -1.4 + r * Math.sin(ph) * Math.cos(th), 0.25 + r * Math.cos(ph), 2.3 + r * Math.sin(ph) * Math.sin(th), false); }
    add(new THREE.IcosahedronGeometry(0.34, 0), glass(0xfff3d6, { emissive: new THREE.Color(0xffe2a8), emissiveIntensity: 1.4 }), -1.4, 0.5, 2.3);
    label(`주의집중<br><small>기억 ${D.att.memories.toLocaleString()}건(10건에 1개 표시) · 중요도 ${C.params_att}개</small>`, V3(-1.4, 1.9, 2.3), "tag hot", -110, 96);
    pipe(V3(-4.9, 0.6, -1.2), V3(-2.9, 0.9, -2.2), 0xdfe6ee); pipe(V3(-4.9, 0.6, 1.3), V3(-3.0, 0.6, 2.3), 0xffe0a3);
    const pr = add(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 3), glass(0xffffff), 2.6, 0.78, 0); pr.rotation.y = Math.PI / 6;
    D.pv[D.pv.length - 1].alpha.forEach((a, i) => { const m = add(new THREE.BoxGeometry(0.2, 1, 0.2), a > 0 ? glass(AMBER, { emissive: new THREE.Color(AMBER), emissiveIntensity: 0.5 }) : metal, 1.85 + i * 0.3, 0.05 + Math.max(0.04, a) * 0.5, 1.5); m.scale.y = Math.max(0.08, a); });
    label(`섞기 α<br><small>구간별 비율 ${C.params_alpha}개</small>`, V3(2.6, 1.6, 0), "tag", -40, -70); pipe(V3(0.2, 1.3, -2.2), V3(2.1, 0.9, -0.3), TEAL); pipe(V3(0.2, 0.6, 2.3), V3(2.1, 0.7, 0.3), AMBER);
    const sun = add(new THREE.SphereGeometry(0.42, 32, 16), glow(0xfff0c0, 1.5), 5.0, 2.9, -1.8, false); label("× 청천 출력<br><small>태양 위치로 계산(학습 없음)</small>", sun.position, "tag", 34, -40); pipe(V3(5.0, 2.5, -1.8), V3(5.6, 1.0, 0), 0xfff0c0);
    pipe(V3(3.3, 0.8, 0), V3(5.4, 0.8, 0), 0xfff6e0);
    const S = D.sample.pv, mx = Math.max(...S.hi, 1);
    for (let h = 0; h < 96; h += 2) { const v = S.p50[h] / mx, m = add(new THREE.BoxGeometry(0.075, 1, 0.5), gem(AMBER, { emissiveIntensity: 0.25 + v }), 5.9 + h * 0.047, 0.03 + Math.max(0.02, v * 2.4) / 2, 0); m.scale.y = Math.max(0.02, v * 2.4); }
    label("24시간 예측 · 96구간<br><small>실제 한 번의 예측 모양</small>", V3(8.2, 2.5, 0), "tag hot", -40, -50);
    title("태양광 예측 모델의 전체 구조 — 블록 수가 실제 개수", `학습되는 값: 릿지 ${C.params_ridge} + 중요도 ${C.params_att} + 비율 ${C.params_alpha} = ${C.params_ridge + C.params_att + C.params_alpha}개 · 모델 파일 ${C.pv_kb} KB · 학습 ${C.train_pv_s}초 · 예측 ${C.predict_s}초(노트북 CPU)`);
    cam.position.set(0.6, 12.5, 24.5); cam.lookAt(0.3, 0.6, 0);
  },
};
SC[name](); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
const comp = new EffectComposer(renderer); comp.setSize(W, H); comp.addPass(new RenderPass(scene, cam)); comp.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), bloom, 0.5, 0.9)); comp.addPass(new OutputPass());
comp.render(); flush(); window.__done = true;
