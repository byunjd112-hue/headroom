// 이동형 EMS 정책 설명 자료(군 대상, 16:9 3장).
// 만드는 방법: 슬라이드를 HTML · CSS 로 그려(둥근 카드, 그라데이션, 사진 페이드, 선 아이콘) 브라우저로 찍는다.
//   ① 보기용: 글까지 찍은 그림 한 장 = 슬라이드 한 장(글꼴 · 모양이 어디서나 같다)
//   ② 편집용: 글을 뺀 그림을 바탕에 깔고, 화면에서 잰 자리 그대로 편집 가능한 글상자를 얹는다
// 문서 작성 공통 규칙: 줄표 · 가운뎃점으로 잇지 않는다, 간결한 개조식. 수치는 측정 파일에서 읽는다(시뮬레이터 검증값이라고 밝힌다).
// 실행: NODE_PATH=docs/ppt/node_modules node docs/ppt/build_policy_deck.js [출력 폴더]
const fs = require("fs"), path = require("path"), os = require("os"), pptxgen = require("pptxgenjs"), { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", ".."), J = f => JSON.parse(fs.readFileSync(path.join(ROOT, "docs", f), "utf8"));
const ST = J("static_results.json"), TR = J("test_results.json"), SC = J("scenario_results.json"), BM = J("forecast_benchmark.json"), CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "config/runtime.json"), "utf8"));
const OUTDIR = process.argv[2] || ROOT, U = f => "file://" + f;
const IMG = n => U(path.join(__dirname, "img", n)), PH = n => U(path.join(ROOT, "ifps_ems_rt/hmi/static/photos", n)), PO = n => U(path.join(__dirname, "img", "policy", n)), FT = n => U(path.join(__dirname, "fonts", n));
const LOGO = path.join(__dirname, "img", "policy", "roka_logo.png");                       // 육군 공식 로고(있으면 넣는다. 없으면 자리만 둔다)
const mean = a => a.reduce((x, y) => x + y, 0) / a.length, mx = a => Math.max(...a);
const nmae = tg => mean(BM.runs.map(r => r.targets[tg].enhanced["24h"].nmae_pct)).toFixed(1), QH = CFG.quiet_target_h;

// 선 아이콘(24 × 24)
const IC = { bolt: "M13 2 4 14h7l-1 8 9-12h-7z", moon: "M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z", plus: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z", star: "m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.400l1.5-7.1L1.8 9.400 9 8.600z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4.200 4.200l2.100 2.100M17.700 17.700l2.100 2.100M4.200 19.800l2.100-2.100M17.700 6.300l2.100-2.100",
  gear: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 12h3M18 12h3M12 3v3M12 18v3M5.600 5.600l2.200 2.200M16.200 16.200l2.200 2.200M5.600 18.400l2.200-2.200M16.200 7.800l2.200-2.200", shield: "M12 2 4 5v6c0 5 3.400 9.300 8 11 4.600-1.700 8-6 8-11V5z",
  fuel: "M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16zM14 10h2a2 2 0 0 1 2 2v5a1.500 1.500 0 0 0 3 0V8l-3-3M6 7h6v4H6z", eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" };
const ico = (k, c, fill) => `<svg viewBox="0 0 24 24" fill="${fill ? c : "none"}" stroke="${c}" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[k]}"/></svg>`;
const li = (a, m) => a.map(t => `<div class="li"><i class="${m}"></i><div class="t">${t}</div></div>`).join("");

const CSS = `
@font-face{font-family:BHS;src:url(${FT("black-han-sans-korean-400-normal.woff2")}),url(${FT("black-han-sans-latin-400-normal.woff2")})}
${[400, 700, 900].map(w => `@font-face{font-family:NSK;font-weight:${w};src:url(${FT(`noto-sans-kr-korean-${w}-normal.woff2`)})}@font-face{font-family:NSK;font-weight:${w};src:url(${FT(`noto-sans-kr-latin-${w}-normal.woff2`)});unicode-range:U+0000-00FF}`).join("")}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1920px;height:1080px;overflow:hidden}
body{font-family:NSK;color:#0d1626;position:relative;background:#eaf1f8}
.bg{position:absolute;inset:0;background:url(${PO("sky.jpg")}) center/cover}.bg:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(244,248,253,.80),rgba(244,248,253,.62) 55%,rgba(244,248,253,.30))}
.t{white-space:nowrap}.d{font-family:BHS;font-weight:400}.hide .t{visibility:hidden}
/* 위 띠 */
.top{position:absolute;left:0;top:0;width:1920px;height:76px;background:linear-gradient(90deg,rgba(8,26,52,0) 20%,#0b2447 34%,#0a1f3f 100%)}
.tab{position:absolute;top:22px;width:300px;text-align:center;font-size:22px;color:#b9c9e2;font-weight:400}.tab.on{color:#ffd66b;font-weight:700}.tabu{position:absolute;top:62px;height:5px;width:210px;border-radius:3px;background:linear-gradient(90deg,#ffd66b,#f5a800)}
.army{position:absolute;right:210px;top:11px;display:flex;align-items:center;gap:12px}.army .lg{width:54px;height:54px;border-radius:50%;border:2px dashed #ffd66b;display:flex;align-items:center;justify-content:center}.army img{width:54px;height:54px;object-fit:contain}
.army .n1{font-size:25px;font-weight:900;color:#fff;line-height:28px}.army .n2{font-size:12px;color:#c9d6ea;line-height:16px}.lgt{font-size:11px;color:#ffd66b}
.tag{position:absolute;right:28px;top:26px;font-size:15px;color:#c9d6ea;text-align:right;width:170px}
/* 왼쪽 단 */
.no{position:absolute;left:44px;top:84px;font-size:168px;line-height:160px;background:linear-gradient(160deg,#1f8f6a 10%,#12497f 95%);-webkit-background-clip:text;color:transparent;letter-spacing:-2px}
.hide .no{color:transparent}.lab{position:absolute;left:50px;top:246px;font-size:30px;font-weight:900}.labu{position:absolute;left:52px;top:294px;width:92px;height:7px;border-radius:4px;background:linear-gradient(90deg,#f08a00,#ffc04d)}
.h1{position:absolute;left:48px;top:322px;font-size:50px;line-height:62px;color:#0d1626}.h1 .g{color:#128a5c}
.en{position:absolute;left:52px;top:456px;font-size:12.500px;letter-spacing:3.500px;color:#59657a;line-height:18px}
.lead{position:absolute;left:50px;top:506px;font-size:19px;line-height:31px;color:#1b2536}
.sol{position:absolute;left:0;top:640px;width:470px;height:384px;background:url(${PO("soldier.jpg")}) center 30%/cover;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 22%),linear-gradient(90deg,#000 72%,transparent);-webkit-mask-composite:source-in}
/* 아래 띠 */
.bot{position:absolute;left:0;bottom:0;width:1920px;height:56px;background:linear-gradient(90deg,#081a34,#0e2c57 60%,#0b2447)}.bot:before{content:"";position:absolute;left:0;top:-4px;width:100%;height:4px;background:linear-gradient(90deg,#ffd66b,#f5a800 40%,rgba(245,168,0,0))}
.bi{position:absolute;top:10px;display:flex;align-items:center;gap:10px;font-size:18px;color:#fff}.bi svg{width:30px;height:30px;padding:5px;border-radius:50%;background:rgba(255,255,255,.14)}
.bf{position:absolute;right:30px;top:13px;font-size:20px;font-weight:900;color:#ffd66b;text-align:right;width:560px}
/* 본문 공통 */
.rb{position:absolute;height:50px;display:flex;align-items:center;border-radius:12px 26px 26px 12px;background:linear-gradient(90deg,#0b2a55,#1c5fae 70%,#3b8be0);box-shadow:0 6px 16px rgba(13,40,80,.28);overflow:hidden}
.rb.gr{background:linear-gradient(90deg,#0a5a3f,#149467 70%,#35c08e)}.rb.rd{background:linear-gradient(90deg,#8f1d18,#cf362e 70%,#f06a5e)}.rb.or{background:linear-gradient(90deg,#a85a00,#ea8c0c 70%,#ffb84a)}
.rb .k{height:100%;display:flex;align-items:center;padding:0 22px 0 20px;background:rgba(255,255,255,.14);font-size:24px;font-weight:900;color:#fff;clip-path:polygon(0 0,100% 0,calc(100% - 16px) 100%,0 100%)}.rb .s{padding-left:14px;font-size:18px;color:#e4eefb}
.card{position:absolute;background:rgba(255,255,255,.94);border-radius:18px;box-shadow:0 10px 26px rgba(20,45,85,.20),0 1px 0 rgba(255,255,255,.9) inset;overflow:hidden}
.ph{position:absolute;left:0;top:0;width:100%;background-size:cover;background-position:center}.ph:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,0) 55%,rgba(255,255,255,.96))}.ph.dk:after{background:linear-gradient(180deg,rgba(6,18,36,0) 45%,rgba(6,18,36,.86))}
.ib{position:absolute;width:58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px rgba(15,40,80,.35);border:3px solid #fff}.ib svg{width:30px;height:30px}
.ct{position:absolute;left:0;width:100%;text-align:center;font-size:22px;font-weight:900;color:#0b2a55}.cs{position:absolute;left:0;width:100%;text-align:center;font-size:15.500px;line-height:22px;color:#263246}
.q{position:absolute;left:452px;width:1434px;text-align:center;font-size:38px;line-height:50px;color:#0d1626}.q .g{color:#128a5c}.q .b{color:#1c5fae}.q .m{color:#1c5fae;font-size:46px}
.li{display:flex;align-items:center;gap:10px;height:31px;font-size:17.500px;color:#111a2a}.li i{flex:none;width:20px;height:20px;border-radius:50%;position:relative}
.li i.ok{background:#149467}.li i.ok:after{content:"";position:absolute;left:6px;top:3px;width:5px;height:10px;border:solid #fff;border-width:0 2.500px 2.500px 0;transform:rotate(45deg)}
.li i.ng{background:#cf362e}.li i.ng:before,.li i.ng:after{content:"";position:absolute;left:9px;top:4px;width:2.500px;height:12px;background:#fff;transform:rotate(45deg)}.li i.ng:after{transform:rotate(-45deg)}
.pill{position:absolute;height:48px;border-radius:24px;display:flex;align-items:center;gap:10px;padding:0 20px 0 8px;background:#fff;box-shadow:0 6px 16px rgba(20,45,85,.18);font-size:18.500px;font-weight:700;color:#0b2a55}.pill .o{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center}.pill svg{width:20px;height:20px}
.cl{position:absolute;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff}
.im{position:absolute;border-radius:12px;background-size:cover;background-position:center;box-shadow:0 4px 12px rgba(10,30,60,.25)}
.cap{position:absolute;font-size:14px;font-weight:700;color:#fff;text-align:center;background:linear-gradient(180deg,rgba(6,18,36,0),rgba(6,18,36,.88));border-radius:0 0 12px 12px;height:34px;line-height:40px}
.fn{position:absolute;font-size:12px;color:#55607a}
.kv{position:absolute;text-align:center;font-size:54px;line-height:60px;background:linear-gradient(180deg,#1c5fae,#0b2a55);-webkit-background-clip:text;color:transparent}.kv.g{background:linear-gradient(180deg,#19a877,#0a5a3f);-webkit-background-clip:text}.kv.o{background:linear-gradient(180deg,#f39a1a,#b25e00);-webkit-background-clip:text}
.kl{position:absolute;text-align:center;font-size:16.500px;font-weight:700;color:#4a566b}.ks{position:absolute;text-align:center;font-size:14px;line-height:20px;color:#263246}
.site{position:absolute;border-radius:18px;overflow:hidden;box-shadow:0 10px 26px rgba(20,45,85,.25)}.site .ph{height:100%}.site .ph:after{background:linear-gradient(180deg,rgba(6,18,36,.10) 0,rgba(6,18,36,.55) 38%,rgba(6,18,36,.93) 70%)}
.site .nm{position:absolute;left:22px;top:104px;font-size:40px;color:#fff}.site .sb{position:absolute;left:24px;top:152px;font-size:15.500px;color:#ffd66b;font-weight:700}.site .li{color:#fff;font-size:16.500px;height:29px}.site .ls{position:absolute;left:22px;top:182px}
.st{position:absolute;height:86px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%,22px 50%)}.st.f{clip-path:polygon(0 0,calc(100% - 22px) 0,100% 50%,calc(100% - 22px) 100%,0 100%)}
.st .a{font-size:13px;color:#ffd66b;line-height:18px}.st .b{font-size:16.500px;font-weight:900;line-height:22px}
`;
const frame = (n, lab, h1, h2, en, lead, foot, body) => `<div class="bg"></div><div class="top"></div>
${["01. 필요성", "02. 체계 구성과 운용", "03. 작전 성능과 추진"].map((t, i) => `<div class="tab t ${i === n - 1 ? "on" : ""}" style="left:${470 + i * 310}px">${t}</div>${i === n - 1 ? `<div class="tabu" style="left:${515 + i * 310}px"></div>` : ""}`).join("")}
<div class="army">${fs.existsSync(LOGO) ? `<img src="${U(LOGO)}">` : `<div class="lg"><div class="lgt t">로고</div></div>`}<div><div class="n1 t">대한민국 육군</div><div class="n2 t">Republic of Korea Army</div></div></div><div class="tag t">이동형 전력체계 EMS</div>
<div class="no d t">0${n}</div><div class="lab t">${lab}</div><div class="labu"></div><div class="h1 d t">${h1}<br><span class="g">${h2}</span></div><div class="en t">${en}</div><div class="lead t">${lead}</div><div class="sol"></div>
${body}
<div class="t" style="position:absolute;left:452px;top:1000px;width:1434px;font-size:16px;line-height:20px;color:#3d4a60">약어  TPCS: 전술전력통제체계 / IFPS: 작전지 종합전력공급체계 / ESS: 에너지저장장치 / N-1: 전원 1대 상실에도 공급을 유지하는 기준</div>
<div class="bot">${[["bolt", "작전지속능력 강화"], ["moon", "피탐 위험 감소"], ["fuel", "연료와 인력 절감"], ["shield", "무정전 전력 공급"]].map((b, i) => `<div class="bi" style="left:${48 + i * 300}px">${ico(b[0], "#ffd66b")}<span class="t">${b[1]}</span></div>`).join("")}<div class="bf t">${foot}</div></div>`;
const rb = (x, y, w, k, s, c) => `<div class="rb ${c || ""}" style="left:${x}px;top:${y}px;width:${w}px"><div class="k t">${k}</div>${s ? `<div class="s t">${s}</div>` : ""}</div>`;
const X = 452, CWD = 1434;

/* ── 1장 */
const need = [["cp.jpg", "지휘통제 고도화", "상황 공유와 지휘 결심이<br>전력에 의존", "star", "#1c5fae"], ["comms.jpg", "통신과 감시 확대", "위성, 전술통신, 감시 장비의<br>무중단 전원 필요", "bolt", "#2d86d9"], ["drone.jpg", "무인체계 운용", "드론과 로봇의<br>충전 전력 수요 증가", "gear", "#0f7f78"], ["medic.jpg", "의무와 생존 지원", "순간 정전도<br>허용되지 않는 부하", "plus", "#cf362e"], ["garrison.jpg", "장기 주둔과 정비", "연료 소모의<br>대부분을 차지", "sun", "#ea8c0c"]];
const S1 = frame(1, "필요성", "전력이 끊기면", "작전도 멈춘다", "WITHOUT POWER, THE MISSION STOPS", "지휘통제, 통신, 감시, 의무 시설은<br>전력이 끊기는 순간 기능을 잃음.<br>작전지에서도 주둔지에서도<br>전원을 하나로 묶는 통제가 필요함.", "전력 통제가 곧 작전지속능력",
  rb(X, 92, CWD, "변화하는 전장", "전력 수요는 늘고, 전력 중단의 대가는 커짐") +
  need.map((c, i) => { const w = 274, x = X + i * (w + 16); return `<div class="card" style="left:${x}px;top:158px;width:${w}px;height:272px"><div class="ph" style="height:170px;background-image:url(${PO(c[0])})"></div>
    <div class="ib" style="left:${w / 2 - 29}px;top:126px;background:${c[4]}">${ico(c[3], "#fff")}</div><div class="ct t" style="top:188px">${c[1]}</div><div class="cs t" style="top:220px">${c[2]}</div></div>`; }).join("") +
  `<div class="q d t" style="top:444px"><span class="m">“</span> 전원이 여럿이어도 <span class="g">통제가 하나</span>여야 작전이 이어짐 <span class="m">”</span></div>` +
  [["bolt", "작전지속능력", "#1c5fae"], ["moon", "생존성 향상", "#0f7f78"], ["fuel", "군수 부담 경감", "#ea8c0c"], ["star", "지휘통제 무중단", "#2d86d9"], ["sun", "미래 에너지 대응", "#149467"]].map((c, i) => `<div class="pill" style="left:${X + 20 + i * 284}px;top:508px;width:258px"><div class="o" style="background:${c[2]}">${ico(c[0], "#fff")}</div><span class="t">${c[1]}</span></div>`).join("") +
  [[0, "rd", "현재", "발전기별 개별 운용의 한계", "legacy.jpg", "convoy.jpg", ["발전기마다 운용 인원 배치", "1대 고장 시 해당 시설 정전", "소음과 열로 위치 노출", "연료 보급 수송 부담", "태양광, ESS 연계 불가", "새 전원 추가 시 통합 수단 없음"], "ng", "전원이 늘수록 운용 부담과 취약점이 함께 늘어남", "linear-gradient(90deg,#b3261e,#e2554b)"],
   [1, "gr", "도입 후", "EMS 가 전원 전체를 통합 통제", "field.jpg", "console.jpg", ["화면 1개로 전체 감시와 지령", "고장 시 대체 전원 자동 기동", "저소음 태세에서 디젤 정지", "예측 기반 연료, 충전 계획", "다종 전원 통합 운용", "작전지와 주둔지에 같은 체계 적용"], "ok", "전원이 늘수록 여유와 생존성이 함께 늘어남", "linear-gradient(90deg,#0a6a49,#22b07f)"]].map(c => { const w = 694, x = X + c[0] * (w + 46);
    return `<div class="card" style="left:${x}px;top:572px;width:${w}px;height:390px">${rb(0, 0, w, c[2], c[3], c[1]).replace('class="rb', 'style="position:absolute;border-radius:0" class="rb').replace(/left:0px;top:0px;/, "")}
      <div class="im" style="left:16px;top:64px;width:270px;height:124px;background-image:url(${PO(c[4])})"></div><div class="im" style="left:16px;top:196px;width:270px;height:124px;background-image:url(${PO(c[5])})"></div>
      <div style="position:absolute;left:306px;top:70px">${li(c[6], c[7])}</div><div class="cl" style="left:16px;top:328px;width:${w - 32}px;background:${c[9]}"><span class="t">${c[8]}</span></div></div>`; }).join("") +
  `<div style="position:absolute;left:${X + 694 + 2}px;top:740px;width:42px;height:42px;border-radius:50%;background:linear-gradient(180deg,#ffd66b,#f5a800);box-shadow:0 4px 10px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="24" height="24" fill="#0b2a55"><path d="M4 9h9V4l8 8-8 8v-5H4z"/></svg></div>
  <div class="fn t" style="left:${X}px;top:972px;width:${CWD}px;text-align:right">현장 사진은 이해를 돕기 위한 개념도(생성 이미지)임</div>`);

/* ── 2장 */
const eq = [["dg.jpg", "① 기동형 복합전력", "발전기 90 kW, ESS 200 kWh"], ["ess.jpg", "② 이동형 ESS", "1000 kWh, 500 kW"], ["pv.jpg", "③ 이동형 태양광", "400 kWp(80 kWp × 5)"], ["fc.jpg", "④ 수소 생성 및 발전", "연료전지 100 kW"], ["dist.jpg", "⑥ 배전 및 변압", "모선 A, B, 연계 차단기"], ["fsu.jpg", "구간분전함", "환망 구성, 부하 직전 배전"]];
const S2 = frame(2, "체계 구성과 운용", "작전지와 주둔지,", "하나의 EMS 로", "ONE EMS FOR FIELD AND GARRISON", "차량형 전원 4종과 배전 장비를<br>EMS 가 통신으로 연결함.<br>같은 장비와 같은 화면을<br>작전지와 주둔지에서 그대로 사용함.", "작전지에서도, 주둔지에서도 같은 체계",
  rb(X, 92, CWD, "체계 구성", "이동형 전원 4종, 배전 장비, EMS 중앙제어. 연결하면 종류와 수량을 자동 인식") +
  eq.map((e, i) => { const w = 226, x = X + i * (w + 15.600); return `<div class="card" style="left:${x}px;top:156px;width:${w}px;height:188px"><div class="ph" style="height:128px;background-image:url(${PH(e[0])})"></div><div class="ct t" style="top:122px;font-size:18px">${e[1]}</div><div class="cs t" style="top:152px;font-size:13.500px">${e[2]}</div></div>`; }).join("") +
  // 작전지 · 주둔지 겸용
  rb(X, 358, CWD, "하나의 체계, 두 곳의 임무", "장소 선택 한 번으로 운전 논리가 바뀜. 장비와 화면, 운용 교육은 같음", "gr") +
  [[0, "field.jpg", "작전지", "상전 없음. 자립 운전", ["태양광과 ESS 우선, 부족 시 디젤 자동 기동", `저소음 태세: 디젤 정지, ${QH}시간 유지 목표`, "전원 1대 상실에도 1, 2등급 부하 공급", "장비 추가와 철수를 자동 인식", "전개 즉시 자동 점검 후 운용"]], [1, "garrison.jpg", "주둔지", "상전 연계. 평시 절감, 유사시 자립", ["기존 군 전력망과 시설 변경 최소화", "수전점에 연결만 하면 운용 가능", "상전 수전 최소화와 피크 억제", "상전 상실 시 정전 논리로 자동 전환", "주둔지 발전기와 연계 운전"]]].map(c => `<div class="site" style="left:${X + 606 + c[0] * 420}px;top:424px;width:408px;height:330px"><div class="ph" style="background-image:url(${PO(c[1])})"></div><div class="nm d t">${c[2]}</div><div class="sb t">${c[3]}</div><div class="ls">${li(c[4], "ok")}</div></div>`).join("") +
  `<div style="position:absolute;left:${X + 606 + 408 - 30}px;top:468px;width:72px;height:72px;border-radius:50%;background:linear-gradient(180deg,#ffd66b,#f5a800);border:4px solid #fff;box-shadow:0 6px 14px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center"><div class="d t" style="font-size:22px;color:#0b2a55">겸용</div></div>
  <div class="card" style="left:${X}px;top:424px;width:592px;height:538px;background:#0c1a2e"><div class="im" style="left:14px;top:14px;width:564px;height:317px;border-radius:10px;background-image:url(${IMG("overview.jpg")})"></div>
    <div class="t" style="position:absolute;left:14px;top:338px;width:564px;text-align:center;font-size:16px;font-weight:700;color:#ffd66b">⑤ EMS 중앙제어 운용 화면(실제 화면)</div>
    ${[["fleet_sld.jpg", "단선 결선도"], ["ring_ok.jpg", "환망 배전 감시"], ["energy.jpg", "예측과 운전계획"]].map((t, i) => `<div class="im" style="left:${14 + i * 191}px;top:372px;width:182px;height:102px;border-radius:8px;background-image:url(${IMG(t[0])})"></div><div class="cap t" style="left:${14 + i * 191}px;top:440px;width:182px;border-radius:0 0 8px 8px">${t[1]}</div>`).join("")}
    <div class="t" style="position:absolute;left:14px;top:486px;width:564px;text-align:center;font-size:15px;color:#dbe6f6;line-height:21px">화면 1개로 전체 감시와 지령. 선택 후 실행 2단계로 오조작 방지.<br>경보 발생 시 조치 방법을 함께 안내</div></div>` +
  [["평시", "태양광과 ESS 우선, 연료 절감", "#1c5fae"], ["저소음", `디젤 정지, ${QH}시간 유지 목표`, "#149467"], ["자립", "목표 시간 유지, 3등급부터 절감", "#ea8c0c"]].map((t, i) => `<div class="card" style="left:${X + 606 + i * 278}px;top:768px;width:272px;height:92px"><div style="position:absolute;left:0;top:0;width:8px;height:100%;background:${t[2]}"></div><div class="t d" style="position:absolute;left:24px;top:12px;font-size:26px;color:${t[2]}">${t[0]}</div><div class="t" style="position:absolute;left:24px;top:52px;font-size:15px;color:#263246">${t[1]}</div></div>`).join("") +
  `<div class="cl" style="left:${X + 606}px;top:874px;width:828px;height:50px;background:linear-gradient(90deg,#0b2a55,#1c5fae)"><span class="t">태세 3종은 작전지와 주둔지 모두에서 선택 가능(운전 정의 9가지)</span></div>
  <div class="fn t" style="left:${X + 606}px;top:936px;width:828px;text-align:right">정격은 설계 표준안이며 제작사 제원으로 확정함. 현장 사진은 개념도(생성 이미지)임</div>`);

/* ── 3장 */
const kp = [["moon", "저소음 지속 목표", `${QH}시간`, "디젤 정지 상태 유지<br>부족 시 3등급부터 절감", "g"], ["bolt", "고장 감지 시간", `${mx(TR.comm_lost_s).toFixed(1)}초`, "통신 두절 판정 후<br>대체 전원 자동 기동", ""], ["star", "지령 응답", `${mx(TR.sbo_ack_s).toFixed(2)}초`, "선택 후 실행 지령의<br>수용 응답 시간", ""], ["sun", "24시간 예측 오차", `${nmae("load")} %`, `부하 기준, 태양광 ${nmae("pv")} %<br>합성 자료로 검증`, "g"], ["shield", "무정전 구성", "N-1", "전원 1대 상실에도<br>1, 2등급 부하 공급", ""], ["link", "적용 장소", "겸용", "작전지와 주둔지에<br>같은 체계 적용", "o"]];
const S3 = frame(3, "작전 성능과 추진", "조용히, 오래,", "끊김 없이", "QUIET, ENDURING, UNINTERRUPTED", "소음과 연료를 줄이고 정전을 막음.<br>SMR, MMR, 대용량 수소 등<br>미래 전원을 받아들이기 위해서도<br>통합 통제 체계가 먼저 필요함.", "검증된 설계를 전력화로 연결",
  rb(X, 92, CWD, "작전 성능", "무엇이 좋아지는가") +
  kp.map((k, i) => { const w = 226, x = X + i * (w + 15.600), c = k[4] === "g" ? "#149467" : k[4] === "o" ? "#ea8c0c" : "#1c5fae"; return `<div class="card" style="left:${x}px;top:158px;width:${w}px;height:196px"><div style="position:absolute;left:0;top:0;width:100%;height:8px;background:${c}"></div>
    <div class="ib" style="left:14px;top:22px;width:44px;height:44px;border-width:0;background:${c}">${ico(k[0], "#fff").replace("<svg", '<svg style="width:24px;height:24px"')}</div><div class="kl t" style="left:64px;top:31px;width:${w - 70}px;text-align:left">${k[1]}</div>
    <div class="kv d t ${k[4]}" style="left:0;top:76px;width:${w}px">${k[2]}</div><div class="ks t" style="left:0;top:142px;width:${w}px">${k[3]}</div></div>`; }).join("") +
  `<div class="card" style="left:${X}px;top:366px;width:${CWD}px;height:58px;background:linear-gradient(90deg,#081a34,#123a6b 55%,#0e6b52)"><div class="d t" style="position:absolute;left:22px;top:13px;font-size:26px;color:#ffd66b">미래 에너지 대응</div>
    ${["SMR, MMR", "대용량 수소", "신규 전원"].map((t, i) => `<div style="position:absolute;left:${236 + i * 150}px;top:12px;width:140px;height:34px;border-radius:17px;border:1.500px solid #ffd66b;display:flex;align-items:center;justify-content:center"><span class="t" style="font-size:15.500px;font-weight:700;color:#fff">${t}</span></div>`).join("")}
    <div class="t" style="position:absolute;left:700px;top:9px;font-size:16px;line-height:21px;color:#fff">전원이 다양해질수록 통합 통제는 필수. 통신 연동 규격만 더하면<br>새 전원도 같은 화면과 같은 운전 논리로 수용하는 구조(향후 확장)</div></div>` +
  rb(X, 434, CWD, "작전 효과", "현장에서 달라지는 것", "gr") +
  [["night.jpg", "피탐 위험 감소", "야간 디젤 정지로 소음과 열 노출 감소"], ["convoy.jpg", "보급 부담 경감", "재생에너지 우선 사용으로 연료 수송 감소"], ["cp.jpg", "지휘통제 무중단", "전원 1대 상실에도 1등급 부하 유지"], ["field.jpg", "전개 시간 단축", "설치 직후 자동 점검과 장비 자동 인식"]].map((c, i) => { const w = 346, x = X + i * (w + 16.700);
    return `<div class="site" style="left:${x}px;top:498px;width:${w}px;height:214px"><div class="ph" style="background-image:url(${PO(c[0])})"></div><div class="nm d t" style="left:18px;top:128px;font-size:30px">${c[1]}</div><div class="t" style="position:absolute;left:19px;top:172px;font-size:15.500px;color:#fff">${c[2]}</div></div>`; }).join("") +
  `<div class="card" style="left:${X}px;top:728px;width:600px;height:158px">${rb(0, 0, 600, "검증 현황", "참조 구현 기준").replace('class="rb', 'style="position:absolute;border-radius:0;height:44px" class="rb').replace(/left:0px;top:0px;/, "")}
    ${[[`${ST.n_tests}건`, "자동 시험 통과"], [`${SC.total}건`, "운영 시나리오 검증"], [`${TR.soak.overruns}건`, "300회 연속 운전 지연"], ["FMEA", "고장모드와 시나리오 연결"]].map((v, i) => `<div class="kv d t" style="left:${i * 150}px;top:56px;width:150px;font-size:40px;line-height:46px">${v[0]}</div><div class="ks t" style="left:${i * 150}px;top:108px;width:150px;font-size:13.500px">${v[1]}</div>`).join("")}</div>
  <div class="card" style="left:${X + 616}px;top:728px;width:818px;height:158px">${rb(0, 0, 818, "추진 방안", "48개월 단계별 개발과 검증", "gr").replace('class="rb', 'style="position:absolute;border-radius:0;height:44px" class="rb').replace(/left:0px;top:0px;/, "")}
    ${[["1단계", "착수와 분석"], ["2단계", "설계"], ["3단계", "구현 1차"], ["4단계", "구현 2차, 통합"], ["5단계", "인수 시험"], ["6단계", "안정화, 준공"]].map((t, i) => `<div class="st ${i ? "" : "f"}" style="left:${12 + i * 132}px;top:58px;width:142px;background:${i < 4 ? "linear-gradient(180deg,#1c5fae,#0b2a55)" : "linear-gradient(180deg,#19a877,#0a5a3f)"}"><div class="a t">${t[0]}</div><div class="b t">${t[1]}</div></div>`).join("")}</div>
  <div class="cl" style="left:${X}px;top:900px;width:${CWD}px;height:58px;font-size:22px;background:linear-gradient(90deg,#081a34,#123a6b 50%,#081a34);border:2px solid #f5b800"><span class="t"><span style="color:#ffd66b">건의</span>　EMS 중앙제어를 전력화 소요에 반영하고, 실장비 연동 시험으로 작전 성능을 확정할 것을 건의함</span></div>
  <div class="fn t" style="left:${X}px;top:968px;width:${CWD}px">수치는 시뮬레이터와 합성 자료에서 측정한 값임. 보호 동작(선택 차단, 절체)은 보호 및 배전 자동화 장치가 수행하며 EMS 는 감시와 지령을 담당함. SMR, MMR, 대용량 수소 연동은 향후 확장 방향이며 현재 구현 범위가 아님</div>`);

// 화면의 글(.t)을 자리 · 크기 · 색과 함께 잰다
const MEASURE = () => [...document.querySelectorAll(".t")].map(el => {
  const b = el.getBoundingClientRect(), cs = getComputedStyle(el), runs = [], pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
  const lhp = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45, flex = cs.display === "flex", r = { left: b.left + pl, top: flex ? b.top + (b.height - lhp) / 2 : b.top + pt, width: b.width - pl - pr, height: flex ? lhp : b.height - pt - pb };
  const walk = (n, c, b) => n.childNodes.forEach(k => { if (k.nodeType === 3) { if (k.textContent) runs.push({ text: k.textContent.replace(/\s+/g, " "), color: c, bold: b }); }
    else if (k.tagName === "BR") runs.push({ br: true }); else { const s = getComputedStyle(k); walk(k, s.color === "rgba(0, 0, 0, 0)" ? c : s.color, +s.fontWeight >= 700 || s.fontFamily.includes("BHS")); } });
  walk(el, cs.color, +cs.fontWeight >= 700);
  return { x: r.left, y: r.top, w: r.width, h: r.height, fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45, al: cs.textAlign, disp: cs.fontFamily.includes("BHS"), bold: +cs.fontWeight >= 700, ls: parseFloat(cs.letterSpacing) || 0, grad: cs.backgroundClip === "text" || cs.webkitBackgroundClip === "text" ? el.className : "", runs };
});
const hex = c => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c || ""); return m ? [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, "0")).join("").toUpperCase() : "111111"; };
const GRAD = k => /\bno\b/.test(k) ? "167E72" : /\bkv\b.*\bg\b/.test(k) ? "128A5C" : /\bkv\b.*\bo\b/.test(k) ? "D97E0A" : "174F92";

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pol")), br = await chromium.launch(), pg = await br.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
  const view = new pptxgen(), edit = new pptxgen(), IN = 13.333 / 1920;
  for (const d of [view, edit]) { d.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 }); d.layout = "WIDE"; d.title = "전술전력통제체계(TPCS) 정책 설명 자료"; }
  let n = 0;
  const RN = require("../lib.js").rename;                          // 체계 명칭: EMS → 전술전력통제체계(TPCS)
  for (const body of [S1, S2, S3].map(h => RN(h).replace(/ONE EMS FOR/g, "ONE TPCS FOR"))) { n++; const f = path.join(tmp, `s${n}.html`);
    fs.writeFileSync(f, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`);
    await pg.goto(U(f)); await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(400);
    const full = path.join(tmp, `v${n}.jpg`), plate = path.join(tmp, `p${n}.jpg`); await pg.screenshot({ path: full, type: "jpeg", quality: 90 });
    const items = await pg.evaluate(MEASURE); await pg.evaluate(() => document.body.classList.add("hide")); await pg.screenshot({ path: plate, type: "jpeg", quality: 90 });
    view.addSlide().addImage({ path: full, x: 0, y: 0, w: 13.333, h: 7.5 });
    const s = edit.addSlide(); s.addImage({ path: plate, x: 0, y: 0, w: 13.333, h: 7.5 });
    for (const it of items) { const al = it.al === "center" ? "center" : it.al === "right" || it.al === "end" ? "right" : "left", runs = []; let cur = null;
      it.runs.forEach(r => { if (r.br) { if (cur) cur.options.breakLine = true; } else { cur = { text: r.text, options: { color: it.grad ? GRAD(it.grad) : hex(r.color), bold: it.disp || r.bold || it.bold } }; runs.push(cur); } });
      if (!runs.length) continue; const grow = al === "left" ? it.w * 0.35 + 20 : 0, pad = al === "center" ? 30 : 0;
      s.addText(runs, { x: (it.x - pad) * IN, y: it.y * IN, w: (it.w + grow + pad * 2) * IN, h: it.h * IN, fontFace: it.disp ? "Black Han Sans" : "맑은 고딕", fontSize: Math.round(it.fs * 5) / 10, lineSpacing: it.lh * 0.5, charSpacing: it.ls ? it.ls * 0.5 : undefined, align: al, valign: "top", margin: 0, wrap: false }); } }
  await br.close();
  await view.writeFile({ fileName: path.join(OUTDIR, "IFPS_TPCS_정책설명자료_보기용.pptx") }); await edit.writeFile({ fileName: path.join(OUTDIR, "IFPS_TPCS_정책설명자료_편집용.pptx") });
  for (let i = 1; i <= 3; i++) fs.copyFileSync(path.join(tmp, `v${i}.jpg`), path.join(os.tmpdir(), `pol_v${i}.jpg`));
  console.log("saved", OUTDIR);
})();
