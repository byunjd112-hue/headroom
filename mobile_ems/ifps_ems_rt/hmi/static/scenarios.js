/* Scenario authoring and isolated simulation inside the existing EMS HMI. */
const P_SCENARIOS = (() => {
  const key = "ems.scenarios.v1";
  const labels = {command: "기동·정지 지령", expect: "응답·조건 검증", set: "모의 입력", wait: "대기",
    branch: "조건 분기", response: "응답 지연·무응답", policy: "EMS 운전 정책 실행", policy_check: "EMS 판단 검증"};
  const names = {DG: "디젤 발전기", FC: "연료전지", ESS: "에너지저장장치", PV: "태양광",
    MTR: "계측·배전", ELZ: "수전해", GDG: "주둔지 발전기", EMS: "EMS"};
  const modes = {island: "작전지", grid: "주둔지"};
  const postures = {"평시": "평시", "저소음": "저소음", "자립": "자립"};
  const controls = {auto: "AUTO", manual: "MANUAL", immediate: "MANUAL · 제어 즉시 실행"};
  const metrics = {executed: "급전 판단 실행", writes: "쓰기 건수", tied: "상전 연계", outage: "정전 감지",
    DG: "디젤 목표", FC: "연료전지 목표", GDG: "예비 발전기 목표", ELZ: "수전해 목표", reserve: "예비력 규칙",
    ess_target: "ESS 목표 (kW)", grid_target: "수전 목표 (kW)", full_hours: "전 부하 자립 예상 (h)"};
  const maxDrafts = 96, maxBatch = 48;
  const isModeCase = item => (item.cat || "").endsWith("운전 모드") || (!item.cat && /^(AUTO|MANUAL) · /.test(item.name));
  let cases;
  try { cases = JSON.parse(localStorage.getItem(key)); } catch (_) { /* use built-in presets */ }
  if (!Array.isArray(cases)) cases = [];
  let active = 0, stepIndex = 0, config = null, selected = new Set(), presetIndex = "0";
  cases.slice(0, maxBatch).forEach((_, i) => selected.add(i));
  let output = null, busy = false, mountId = 0, revision = 0, search = "";
  let view = "seq", picked = "", pickedPart = "", playing = null;      // 보기(시퀀스·구성도), 구성도에서 고른 블록, 단계 자동 재생 타이머
  try { const saved = localStorage.getItem("ems.scenario.view"); view = ["topo", "live"].includes(saved) ? saved : "seq"; } catch (_) { /* 기본값 사용 */ }

  const scene = () => cases[active];
  const point = tag => config.points.find(p => p.tag === tag);
  const lane = step => step.device || point(step.tag)?.device || "EMS";
  const deviceName = d => names[d] || d;
  const option = (id, caption, current) => `<option value="${esc(id)}"${id === current ? " selected" : ""}>${esc(caption)}</option>`;
  const button = (action, label, cls = "", disabled = false) =>
    `<button type="button" class="btn sm ${cls}" data-sc="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
  const select = (key, caption, options) => `<label>${caption}<select class="in" data-field="${key}">${options}</select></label>`;
  const field = (key, caption, value, min, max, step = "1") =>
    `<label>${caption}<input class="in" type="number" data-field="${key}" value="${esc(value)}" min="${min}" max="${max}" step="${step}" required></label>`;
  const description = step => {
    if (step.type === "policy") return `${controls[step.control]} · ${modes[step.mode]} · ${step.posture}`;
    if (step.type === "policy_check") return `${metrics[step.metric]} ${{eq: "=", ge: "≥", le: "≤"}[step.op]} ${step.value}`;
    if (step.type === "command") return step.value === 1 ? "기동 지령" : "정지 지령";
    if (step.type === "wait") return `대기 ${step.ms} ms`;
    if (step.type === "response") return step.ms === -1 ? "지령 응답 없음" : `상태 응답 지연 ${step.ms} ms`;
    if (step.type === "set") return `${step.tag} ← ${step.value}`;
    const op = {eq: "=", ge: "≥", le: "≤"}[step.op];
    return `${step.tag} ${op} ${step.value}`;
  };

  function save() {
    try { localStorage.setItem(key, JSON.stringify(cases)); }
    catch (_) { toast("브라우저에 시나리오를 저장하지 못했습니다", "bad"); }
  }

  function changed() {
    revision++;
    output = null;
    save();
  }

  // ── 시퀀스 다이어그램(UML 식): 머리에 실제 장비 사진, 생명선과 활성 막대, 호출은 실선·응답과 판정은 점선
  const photo = {DG: "dg", FC: "fc", ESS: "ess", PV: "pv", MTR: "dist", GDG: "gdg", EMS: "ems", ELZ: "elz"};
  const tint = {TEST: "#c9a6c0", EMS: "#f2d27a", DG: "#e59866", FC: "#7fc8c0", ESS: "#9aa8e8", PV: "#f0c05a", MTR: "#a9d18e", ELZ: "#8fd3ff", GDG: "#d7a86e"};
  const SQ = {w: 138, row: 50, top: 14};
  function route(step) {                                   // [보내는 쪽, 받는 쪽, 선 모양]
    const dev = step.device || point(step.tag)?.device || "EMS";
    if (step.type === "command") return ["EMS", dev, "call"];
    if (step.type === "policy") return ["TEST", "EMS", "call"];
    if (step.type === "policy_check") return ["EMS", "TEST", "return"];
    if (step.type === "wait") return ["TEST", "TEST", "self"];
    if (step.type === "set") return ["TEST", dev, "call"];
    if (step.type === "response") return ["TEST", dev, "inject"];
    return [dev, "TEST", "return"];                        // expect · branch: 장비 값을 읽어 판정
  }
  const runOf = () => output?.results.find(r => r.index === active);

  function sequence() {
    const steps = scene().steps, routes = steps.map(route), rows = runOf()?.rows || [];
    const lanes = ["TEST", "EMS", ...new Set(routes.flatMap(r => [r[0], r[1]]).filter(d => d !== "TEST" && d !== "EMS"))];
    const x = d => lanes.indexOf(d) * SQ.w + SQ.w / 2, y = i => SQ.top + i * SQ.row + 30, width = lanes.length * SQ.w, height = SQ.top + Math.max(1, steps.length) * SQ.row + 18;
    const state = i => rows.find(row => row.step === i);
    const heads = lanes.map(d => `<div class="sq-head" style="--c:${tint[d] || "#9fb0ad"}">
      ${d === "TEST" ? `<svg viewBox="0 0 40 44" class="sq-actor" aria-hidden="true"><circle cx="20" cy="9" r="6.5"/><path d="M20 16v15M7 22h26M20 31l-9 12M20 31l9 12"/></svg>`
        : `<span class="sq-photo"><img src="photos/${photo[d] || d.toLowerCase()}.jpg" alt="" loading="lazy" onerror="this.remove()"><em>${esc(d)}</em></span>`}
      <b>${d === "TEST" ? "검증기" : esc(d)}</b><small>${d === "TEST" ? "시험 입력 · 판정" : esc(deviceName(d))}</small></div>`).join("");
    const life = lanes.map(d => `<line class="sq-life" x1="${x(d)}" x2="${x(d)}" y1="0" y2="${height}"/>`).join("");
    const bars = lanes.map(d => {                           // 활성 막대: 그 장비가 관여한 연속 구간
      const used = steps.map((_, i) => i).filter(i => routes[i][0] === d || routes[i][1] === d), out = [];
      for (let k = 0; k < used.length; k++) { let e = k; while (e + 1 < used.length && used[e + 1] - used[e] <= 1) e++; out.push([used[k], used[e]]); k = e; }
      return out.map(([a, b]) => `<rect class="sq-bar" x="${x(d) - 5}" y="${y(a) - 13}" width="10" height="${y(b) - y(a) + 26}" rx="2" fill="${tint[d] || "#9fb0ad"}"/>`).join("");
    }).join("");
    const arrows = steps.map((s, i) => {
      const [from, to, kind] = routes[i], row = state(i), st = row?.state || "", yy = y(i), a = x(from), b = x(to), dir = b >= a ? 1 : -1;
      const text = `${i + 1}. ${description(s)}`, seen = row ? [row.actual !== undefined && row.expected !== undefined ? `관측 ${row.actual}` : "", row.elapsed !== undefined ? `${row.elapsed} ms` : ""].filter(Boolean).join(" · ") : "";
      const mark = st === "pass" ? "✓" : st === "fail" ? "✕" : st === "skip" ? "–" : "";
      if (kind === "self") return `<g class="sq-msg ${st}"><path d="M${a + 6} ${yy - 8}h26v16h-22" marker-end="url(#sqOpen)"/><text x="${a + 40}" y="${yy + 4}">${esc(text)}</text>${mark ? `<text class="sq-mark" x="${a - 16}" y="${yy + 5}">${mark}</text>` : ""}</g>`;
      const mid = (a + b) / 2;
      return `<g class="sq-msg ${kind} ${st}"><line x1="${a + 6 * dir}" x2="${b - 7 * dir}" y1="${yy}" y2="${yy}" marker-end="url(#${kind === "return" ? "sqOpen" : "sqFill"})"/>
        <text x="${mid}" y="${yy - 7}" text-anchor="middle">${kind === "inject" ? "⚡ " : ""}${esc(text)}</text>
        ${seen || row?.why ? `<text class="sq-seen" x="${mid}" y="${yy + 14}" text-anchor="middle">${esc(st === "fail" && row.why ? row.why : seen)}</text>` : ""}
        ${mark ? `<text class="sq-mark" x="${Math.min(a, b) - 16}" y="${yy + 5}">${mark}</text>` : ""}</g>`;
    }).join("");
    const hit = steps.map((s, i) => `<div class="sq-row ${i === stepIndex ? "chosen" : ""} ${state(i)?.state || ""}" role="button" tabindex="0" draggable="true" data-step="${i}" style="top:${SQ.top + i * SQ.row}px;height:${SQ.row}px" aria-pressed="${i === stepIndex}" aria-label="${i + 1}단계 ${esc(description(s))}">
      ${i === stepIndex ? `<span class="sq-tools">${button("up", "↑", "", i === 0)}${button("down", "↓", "", i === steps.length - 1)}${button("dup", "복제", "", steps.length >= 30)}${button("remove", "삭제")}</span>` : ""}</div>`).join("");
    const done = rows.length, pass = rows.filter(r => r.state === "pass").length, fail = rows.filter(r => r.state === "fail").length, ms = rows.length ? rows[rows.length - 1].elapsed : 0;
    return `<div class="sq-summary"><span>${steps.length}단계</span>${done ? `<span class="sc-ok">통과 ${pass}</span>${fail ? `<span class="sc-fail">실패 ${fail}</span>` : ""}<span>${ms} ms</span>` : '<span class="muted">아직 검증하지 않음</span>'}
        <span class="sc-spacer"></span><span class="sq-legend"><i class="l-call"></i>지령·입력 <i class="l-ret"></i>응답 판정 <i class="l-inj"></i>고장 주입</span></div>
      <div class="sc-scroll sq-wrap"><div class="sq-heads" style="width:${width}px">${heads}</div>
      <div class="sq-body" style="width:${width}px;height:${height}px"><svg width="${width}" height="${height}" aria-hidden="true">
        <defs><marker id="sqFill" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L9 4L0 8z" fill="context-stroke"/></marker>
        <marker id="sqOpen" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L9 4L0 8" fill="none" stroke="context-stroke"/></marker></defs>
        ${life}${bars}${arrows}</svg>${hit}${steps.length ? "" : '<p class="muted sq-empty">왼쪽 장비의 신호를 누르거나 끌어다 놓으면 단계가 생깁니다.</p>'}</div></div>`;
  }

  // 단계 표시줄: 번호를 눌러 이동, 재생하면 한 단계씩 넘어간다(두 보기 공통)
  function stepper() {
    const steps = scene().steps, rows = runOf()?.rows || [], cur = steps[stepIndex], row = rows.find(r => r.step === stepIndex);
    if (!steps.length) return "";
    const dots = steps.map((_, i) => `<button type="button" class="sp-dot ${rows.find(r => r.step === i)?.state || ""} ${i === stepIndex ? "on" : ""}" data-step="${i}" aria-label="${i + 1}단계" aria-pressed="${i === stepIndex}">${i + 1}</button>`).join("");
    const seen = row ? (row.state === "fail" && row.why ? row.why : [row.actual !== undefined && row.expected !== undefined ? `기준 ${row.expected} · 관측 ${row.actual}` : "", `${row.elapsed} ms`].filter(Boolean).join(" · ")) : "";
    return `<div class="sp-bar"><div class="sp-ctl">${button("first", "⟲", "", stepIndex === 0)}${button("prev", "◀", "", stepIndex === 0)}${button("play", playing ? "⏸ 멈춤" : "▶ 재생", "pri")}${button("next", "▶", "", stepIndex >= steps.length - 1)}</div>
      <div class="sp-dots">${dots}</div><span class="sp-count">${stepIndex + 1} / ${steps.length} 단계</span></div>
      <div class="sp-now ${row?.state || ""}"><b>${stepIndex + 1}. ${esc(labels[cur.type])}</b> ${esc(description(cur))}${seen ? ` <span>— ${esc(seen)}</span>` : ""}</div>`;
  }

  // 실시간 보기: 지금 장치에서 읽은 값으로 구성도를 그린다(실장비 모드에서도 열린다 — 표시 전용, 지령은 나가지 않는다)
  const liveSnap = () => Object.fromEntries(Object.entries(S.snap?.values || {}).map(([k, o]) => [k, o && typeof o === "object" ? o.v : o]).filter(([, v]) => typeof v === "number"));
  function liveView() {
    const html = ScTopo.html({steps: [], rows: [{step: 0, snap: liveSnap()}], stepIndex: 0, describe: description, picked: "", part: "", live: true});
    return `<div class="sq-summary"><span>실시간 상태</span><span class="muted">${S.snap?.sim ? "가상 장치" : "실장비"} · 1초마다 갱신 · 표시 전용(지령 없음)</span><span class="sc-spacer"></span>
        <span class="sq-legend"><i class="l-pow"></i>전력 흐름</span>${ScTopo.custom() ? button("layout-reset", "배치 초기화") : ""}</div><div class="tp-wrap" id="tpLive">${html}</div>
      <p class="muted tp-pick">차단기 색: 초록 투입 · 회색 개방 · 빨강 트립. 값이 없는 신호(대응표에 없거나 통신 두절)는 회색으로 보입니다.${S.snap?.sim ? "" : " 시나리오 편집·실행과 추가 설비는 가상 장치 모드에서만 쓸 수 있습니다."}</p>`;
  }
  function refreshLive() {
    const box = $("#tpLive");
    if (!box || ScTopo.dragging()) return;
    box.innerHTML = ScTopo.html({steps: [], rows: [{step: 0, snap: liveSnap()}], stepIndex: 0, describe: description, picked: "", part: "", live: true});
    ScTopo.bind(box, () => {}, refreshLive);
  }

  function topology() {
    const ctx = {steps: scene().steps, rows: runOf()?.rows || [], stepIndex, describe: description, picked, part: pickedPart};
    return `<div class="sq-summary"><span>${ctx.steps.length}단계</span>${ctx.rows.length ? `<span class="sc-ok">통과 ${ctx.rows.filter(r => r.state === "pass").length}</span>${ctx.rows.some(r => r.state === "fail") ? `<span class="sc-fail">실패 ${ctx.rows.filter(r => r.state === "fail").length}</span>` : ""}` : '<span class="muted">아직 검증하지 않음</span>'}
        <span class="sc-spacer"></span><span class="sq-legend"><i class="l-call"></i>지령·입력 <i class="l-ret"></i>응답 판정 <i class="l-inj"></i>고장 주입 <i class="l-pow"></i>전력 흐름</span>
        ${button("extra", "설비 구성")}${ScTopo.custom() ? button("layout-reset", "배치 초기화") : ""}</div>
      <div class="tp-wrap">${ScTopo.html(ctx)}</div>${ringStrip(ctx)}${pickPanel()}`;
  }
  /* 환망: 구간분전함(FSU)·휴대용 배전체계(PPDU)·구간 개폐기를 한 줄 그림으로(환망 화면과 같은 그림). 단계마다 검증기가 남긴 값을 쓴다 */
  function ringStrip(ctx) {
    const R = config?.extra?.ring; if (!R || !R.fsu || !R.fsu.length) return "";
    const rows = ctx.rows || [], row = rows.filter(r => r.step <= ctx.stepIndex && r.snap).pop(), v = row ? row.snap : null;
    return `<div class="rg"><div class="rg-h"><b>${esc(R.name || "환망")}</b><span class="muted">전원에서 나가 구간분전함(FSU)을 돌아 다시 전원으로 — 한 구간이 끊어지면 그 구간을 떼어 내고 상시 개방점을 닫아 반대쪽에서 공급한다${v ? "" : " · 검증하면 단계별 상태가 나온다"}</span></div>${RingView.svg(RingView.fromValues(R, v))}</div>`;
  }

  // 구성도에서 블록(장비·차단기·배전반)을 누르면 그 블록의 신호로 단계를 바로 넣는다
  function pickPanel() {
    if (!picked) return '<p class="muted tp-pick">블록을 누르면 그 장비·차단기의 신호로 단계를 바로 넣을 수 있습니다. 블록을 끌면 배치가 바뀌고 이 브라우저에 저장됩니다.</p>';
    const tags = ScTopo.tagsOf(picked, config.points).filter(p => !pickedPart || /^(CB|FLT|LDS)\./.test(p.tag)), dev = config.commands.includes(picked) && !pickedPart;
    const quick = pickedPart && tags.some(p => p.tag.startsWith("CB.")) ? `<span class="tp-quick">${[[1, "투입"], [0, "개방"], [2, "트립"]].map(([v, t]) => `<button type="button" class="btn sm" data-topo="set" data-tag="${esc(tags.find(p => p.tag.startsWith("CB.")).tag)}" data-value="${v}">＋ ${t} 입력</button>`).join("")}</span>` : "";
    return `<div class="tp-pick"><b>${esc(ScTopo.title(picked))}${pickedPart ? " · 차단기" : ""}</b>
      ${dev ? `<button type="button" class="btn sm" data-topo="command" data-device="${esc(picked)}" data-value="1">＋ 기동 지령</button><button type="button" class="btn sm" data-topo="command" data-device="${esc(picked)}" data-value="2">＋ 정지 지령</button><button type="button" class="btn sm" data-topo="response" data-device="${esc(picked)}">＋ 응답 지연 주입</button>` : ""}${quick}
      <span class="tp-tags">${tags.map(p => `<span class="tp-tag"><code>${esc(p.tag)}</code><button type="button" class="btn sm" data-topo="set" data-tag="${esc(p.tag)}">입력</button><button type="button" class="btn sm" data-topo="expect" data-tag="${esc(p.tag)}">판정</button></span>`).join("") || '<span class="muted">대응표에 등록된 신호가 없습니다.</span>'}</span>
      <button type="button" class="btn sm" data-topo="close">닫기</button></div>`;
  }

  function inspector() {
    const s = scene().steps[stepIndex];
    if (!s) return '<p class="muted">단계를 추가하거나 왼쪽에서 신호를 선택하세요.</p>';
    let fields = select("type", "단계 유형", Object.entries(labels).map(([id, name]) => option(id, name, s.type)).join(""));
    const options = (items, value) => Object.entries(items).map(([id, text]) => option(id, text, value)).join("");
    if (s.type === "policy") {
      fields += select("mode", "운용 장소", options(modes, s.mode));
      fields += select("posture", "운용 태세", options(postures, s.posture));
      fields += select("control", "제어 방식", options(controls, s.control));
      fields += field("hour", "모의 시각 (시)", s.hour, 0, 23.99, "any");
    } else if (s.type === "policy_check") {
      fields += select("metric", "판정 항목", options(metrics, s.metric));
      fields += select("op", "비교", options({eq: "같음 (=)", ge: "이상 (≥)", le: "이하 (≤)"}, s.op));
      fields += field("value", "기준값 (켜짐·참 = 1, 꺼짐·거짓 = 0)", s.value, -1e12, 1e12, "any");
    } else if (s.type === "wait") fields += field("ms", "대기 시간 (ms)", s.ms, 0, 10000);
    else if (s.type === "command" || s.type === "response") {
      fields += select("device", "장비", config.commands.map(d => option(d, deviceName(d), s.device)).join(""));
      fields += s.type === "command"
        ? select("value", "지령", option("1", "기동", String(s.value)) + option("2", "정지", String(s.value)))
        : field("ms", "상태 응답 지연 (ms), 무응답 −1", s.ms, -1, 10000);
    } else {
      fields += select("tag", "신호", config.points.map(p => option(p.tag, `${p.tag} · ${p.device}`, s.tag)).join(""));
      const p = point(s.tag);
      if (s.type !== "set") fields += select("op", "비교", option("eq", "같음 (=)", s.op) + option("ge", "이상 (≥)", s.op) + option("le", "이하 (≤)", s.op));
      fields += field("value", `${s.type === "set" ? "입력값" : "기준값"}${p?.unit ? " (" + esc(p.unit) + ")" : ""}`, s.value, s.type === "set" ? p?.lo ?? -1e12 : -1e12, s.type === "set" ? p?.hi ?? 1e12 : 1e12, "any");
      if (s.type === "expect") {
        fields += field("ms", "대기 한도 (ms)", s.ms, 0, 10000);
        fields += field("limit", "개선 시 허용 상한 (ms)", s.limit ?? s.ms, s.ms, 10000);
      }
      if (s.type === "branch") fields += field("skip", "거짓일 때 건너뛸 단계 수", s.skip, 0, scene().steps.length - stepIndex - 1);
    }
    return `<div class="sc-fields">${fields}</div><div class="sc-actions">
      ${button("up", "위로", "", stepIndex === 0)}${button("down", "아래로", "", stepIndex === scene().steps.length - 1)}
      ${button("remove", "삭제")}</div>`;
  }

  function results() {
    if (!output) return '<p class="muted">검증할 시나리오를 선택하고 실행하세요.</p>';
    const tag = row => ({pass: "통과", fail: "실패", skip: "건너뜀"}[row.state]);
    const runs = output.results.map(run => `<article class="sc-run"><h4>${esc(run.name)} <span class="${run.ok ? "sc-ok" : "sc-fail"}">${run.ok ? "통과" : "실패"}</span></h4>
      ${run.rows.map(row => `<button class="sc-result" type="button" data-jump="${run.index}:${row.step}">
        <strong>${row.step + 1}단계 · ${tag(row)}</strong><span>${row.elapsed} ms</span>
        ${row.expected !== undefined ? `<span>기준 ${esc(row.expected)} · 관측 ${esc(row.actual)}</span>` : ""}
        ${row.why ? `<small>${esc(row.why)}</small>` : ""}
        ${row.detail ? `<small>${esc(row.detail)}</small>` : ""}
        ${row.source ? `<small>${esc(row.source)}</small>` : ""}</button>`).join("")}</article>`).join("");
    const changes = (output.changes || []).map(c => `<li>${esc(output.results[c.case].name)} · ${c.step + 1}단계 대기 한도 ${c.before} → ${c.after} ms</li>`).join("");
    return `<div class="sc-results">${runs}</div>
      ${output.improve ? `<div class="sc-review"><h4>자동 개선 결과</h4>
        ${changes ? `<ul>${changes}</ul><p>재검증 · ${output.retest.filter(r => r.ok).length}/${output.retest.length} 통과</p>
          ${output.candidate ? button("apply", "검증된 변경 적용", "pri") : '<p>후보가 전체 시나리오를 통과해야 적용할 수 있습니다.</p>'}`
        : '<p>설정한 허용 상한 내에서 적용할 수 있는 대기 시간 변경이 없습니다.</p>'}</div>` : ""}`;
  }

  function palette() {
    const query = search.trim().toLowerCase();
    return config.devices.map(d => {
      const points = config.points.filter(p => p.device === d && `${d} ${deviceName(d)} ${p.tag}`.toLowerCase().includes(query));
      const titleMatch = `${d} ${deviceName(d)}`.toLowerCase().includes(query);
      if (!titleMatch && !points.length) return "";
      return `<details ${query ? "open" : ""}><summary>${esc(deviceName(d))} <small>${esc(d)}</small></summary>
        ${config.commands.includes(d) ? `<button class="sc-point" data-device="${esc(d)}" draggable="true">＋ 기동·정지 지령</button>` : ""}
        ${points.map(p => `<button class="sc-point" data-point="${esc(p.tag)}" draggable="true" title="${esc(p.rw === "w" ? "쓰기 신호" : "읽기 신호")}">${esc(p.tag)} <small>${esc(p.unit)}</small></button>`).join("")}</details>`;
    }).join("") || '<p class="muted">일치하는 장비나 신호가 없습니다.</p>';
  }

  function paint() {
    const root = $("#scWorkspace");
    if (!root) return;
    root.innerHTML = `<div class="sc-actions">
      ${button("new", "＋ 새 시나리오", "", cases.length >= maxDrafts)}${button("copy", "복제", "", cases.length >= maxDrafts)}
      ${button("delete", "시나리오 삭제", "", cases.length === 1)}
      <span class="sc-spacer"></span>
      ${button("verify", busy ? "실행 중…" : "선택 병렬 검증", "pri", busy || !selected.size)}
      ${button("improve", "자동 진단·개선", "", busy || !selected.size)}
      ${button("export", "Python 회귀시험 저장", "", busy || !selected.size)}
      ${button("pptx", "시퀀스 PPT 내보내기", "", busy || !selected.size)}${button("pptx-in", "고친 PPT 올리기", "", busy)}
      </div>
      <div class="sc-actions sc-pickbar">
        ${button("pick", "시나리오 고르기 ▾", "pri")}${button("prev-case", "◀", "", cases.length < 2)}${button("next-case", "▶", "", cases.length < 2)}
        <span class="sc-cur"><b>${esc(scene().name || "이름 없음")}</b> <span class="pill ${catClass(scene())}">${esc(catOf(scene()))}</span>${scene().ref ? ` <span class="pill info" title="FMEA 고장 모드">${esc(scene().ref)}</span>` : ""}</span>
        <span class="sc-spacer"></span><span class="muted">${active + 1} / ${cases.length}건 · 검증 선택 ${selected.size}/${maxBatch} · ${CATS.map(c => `${c.split(" (")[0].replace("정상 운전 · ", "")} ${cases.filter(x => catOf(x) === c).length}`).join(" · ")}</span>
      </div>
      ${scene().fat ? `<p class="sc-fat"><b>실장비 시험(FAT)에서 확인할 것</b> ${esc(scene().fat)}</p>` : ""}
      <div class="sc-layout ${view === "topo" ? "wide" : view === "live" ? "wide live" : ""}">
        <aside class="sc-panel sc-palette"><h3>장비·신호</h3>
          <input class="in" id="scSearch" aria-label="장비·신호 검색" placeholder="장비 또는 신호 검색" value="${esc(search)}">
          <div id="scPalette">${palette()}</div>
        </aside>
        <section class="sc-panel" id="scDrop">
          <label class="sc-name">시나리오 이름 <input class="in" id="scName" maxlength="80" value="${esc(scene().name)}"></label>
          <div class="sc-actions"><div class="sc-view" role="tablist" aria-label="보기"><button type="button" role="tab" class="btn sm ${view === "seq" ? "pri" : ""}" data-view="seq" aria-selected="${view === "seq"}">시퀀스</button><button type="button" role="tab" class="btn sm ${view === "topo" ? "pri" : ""}" data-view="topo" aria-selected="${view === "topo"}">구성도</button><button type="button" role="tab" class="btn sm ${view === "live" ? "pri" : ""}" data-view="live" aria-selected="${view === "live"}">실시간</button></div><span class="sc-spacer"></span>
            <select class="in" id="scAdd" aria-label="추가할 단계">${Object.entries(labels).map(([id, name]) => option(id, name)).join("")}</select>
            ${button("add", "＋ 단계")}</div>
          ${scene().note ? `<p class="sc-note">${esc(scene().note)}</p>` : ""}
          ${view === "live" ? "" : stepper()}
          ${view === "live" ? liveView() : view === "topo" ? topology() : `<p class="muted">신호를 누르거나 끌어다 놓아 단계를 만들고, 단계를 끌어 순서를 바꿉니다. 키보드: ↑↓ 선택 · Alt+↑↓ 이동 · Delete 삭제.</p>${sequence()}`}
        </section>
        <aside class="sc-panel"><h3>단계 설정 ${scene().steps.length ? "· " + (stepIndex + 1) : ""}</h3>${inspector()}</aside>
      </div>
      <section class="sc-panel sc-bottom"><h3>검증 결과</h3><div aria-live="polite">${busy ? '<p>독립 가상 장치에서 검증 중입니다.</p>' : results()}</div></section>`;
    root.ondragstart = e => {
      const item = e.target.closest("[data-point],[data-device],[data-step]");
      if (item) e.dataTransfer.setData("application/x-ems-scenario", JSON.stringify(item.dataset));
    };
    if (view === "live") ScTopo.bind(root, () => {}, refreshLive);
    else ScTopo.bind(root, (id, part) => { picked = picked === id && pickedPart === part ? "" : id; pickedPart = picked ? part : ""; paint(); }, paint);
    const drop = $("#scDrop");
    drop.ondragover = e => { if (e.dataTransfer.types.includes("application/x-ems-scenario")) e.preventDefault(); };
    drop.ondrop = e => {
      const data = e.dataTransfer.getData("application/x-ems-scenario");
      if (!data) return;
      e.preventDefault();
      const over = e.target.closest("[data-step]"), at = over ? Number(over.dataset.step) : scene().steps.length - 1;
      try {
        const item = JSON.parse(data);
        if (item.step !== undefined) move(Number(item.step), at); else addPalette(item, at + 1);      // 단계를 끌면 순서 이동, 신호를 끌면 그 단계 다음에 삽입
      } catch (_) { /* ignore other drag data */ }
    };
    root.onkeydown = e => {
      const row = e.target.closest?.("[data-step]");
      if (!row) return;
      const i = Number(row.dataset.step), n = scene().steps.length, go = to => { e.preventDefault(); stepIndex = to; paint(); $(`.sq-row[data-step="${to}"]`)?.focus(); };
      if (e.key === "Enter" || e.key === " ") return go(i);
      if (e.key === "Delete") { e.preventDefault(); stepIndex = i; scene().steps.splice(i, 1); stepIndex = Math.max(0, Math.min(i, n - 2)); changed(); return paint(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const to = i + (e.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= n) return;
        if (e.altKey) { e.preventDefault(); move(i, to); return $(`.sq-row[data-step="${to}"]`)?.focus(); }
        go(to);
      }
    };
  }

  // ── 설비 구성: 시나리오용 추가 설비(모의 급전선·변압기·보호 계전기)를 고친다. 실제 대응표는 바뀌지 않는다
  const EX_COLS = {
    feeders: [["id", "이름(영문)", "text", "L4"], ["name", "설명", "text", "정비고 부하"], ["kind", "종류", {load: "부하", src: "전원"}], ["bus", "모선", {A: "A", B: "B"}], ["kw", "전력 kW", "number", 40],
      ["ems", "EMS 수급 반영", {false: "아니오", true: "예"}], ["photo", "사진", "photo"]],
    transformers: [["id", "이름(영문)", "text", "TR2"], ["name", "설명", "text", "변압기"], ["on", "급전선", "feeder"], ["kva", "정격 kVA", "number", 500], ["pf", "역률", "number", 0.9]],
    relays: [["id", "이름", "text", "51-L4"], ["name", "설명", "text", "과전류"], ["kind", "요소", {oc: "과전류(kW)", gf: "지락(A)", uv: "부족전압(V)"}], ["cb", "차단기", "breaker"],
      ["target", "감시 대상", "text", "L4"], ["pickup", "정정값", "number", 60], ["curve", "시간 특성", {dt: "정한시", si: "표준 반한시", vi: "강반한시", ei: "초반한시"}], ["delay_ms", "시간 ms(정한시)", "number", 200],
      ["tms", "배율(반한시)", "number", 0.1], ["code", "고장 코드", "number", 51], ["backup", "후비 차단기", "backup"], ["bf_ms", "후비 시간 ms", "number", 300]]};
  const EX_TITLE = {feeders: "급전선 (차단기 포함)", transformers: "변압기", relays: "보호 계전기 — 과전류 · 지락 · 부족전압, 정한시 · 반한시, 차단 실패 후비"};
  // 저장 형식 ↔ 편집 형식: 계전기의 감시 대상은 요소에 따라 급전선 목록(과전류)·급전선(지락)·모선(부족전압)이다
  const relayIn = r => { const kind = r.kind || "oc"; return {id: r.id, name: r.name || "", kind, cb: r.cb, target: kind === "oc" ? (r.sum || []).join(", ") : kind === "gf" ? r.on || "" : r.bus || "B",
    pickup: r.pickup ?? r.pickup_kw, curve: r.curve || "dt", delay_ms: r.delay_ms ?? 0, tms: r.tms ?? 0.1, code: r.code ?? {oc: 51, gf: 64, uv: 27}[kind], backup: r.backup || "", bf_ms: r.bf_ms ?? 300}; };
  const relayOut = r => { const o = {id: r.id, name: r.name, kind: r.kind, cb: r.cb, pickup: r.pickup, curve: r.curve, delay_ms: r.delay_ms, tms: r.tms, code: r.code, bf_ms: r.bf_ms};
    if (r.kind === "oc") o.sum = String(r.target).split(",").map(x => x.trim()).filter(Boolean); else if (r.kind === "gf") o.on = String(r.target).trim(); else o.bus = String(r.target).trim().toUpperCase();
    if (r.backup) o.backup = r.backup; return o; };
  let photoNames = null;
  async function extraDialog() {
    if (!can("engineer")) return loginDialog();
    if (!photoNames) { try { photoNames = ((await api("/api/photos")).files || []).map(n => n.replace(/\.[a-z]+$/i, "")); } catch (_) { photoNames = []; } }
    const src = config.extra || {feeders: [], transformers: [], relays: []};
    const draft = {feeders: structuredClone(src.feeders).map(f => ({...f, ems: String(!!f.ems), photo: f.photo || ""})), transformers: structuredClone(src.transformers), relays: src.relays.map(relayIn)};
    const feeders = () => ["GRID", "PV", "DG", "FC", "GDG", "ESS", "L1", "L2", "L3", "ELZ", ...draft.feeders.map(f => f.id)], breakers = () => [...feeders().filter(x => x !== "ELZ"), "TIE", "G1"];
    const pick = (list, val, at) => `<select class="in" ${at}>${list.map(k => option(k, k || "—", val)).join("")}</select>`;
    const cell = (key, i, [name, , type], item) => { const val = item[name], at = `data-ex="${key}.${i}.${name}"`;
      if (typeof type === "object") return `<select class="in" ${at}>${Object.entries(type).map(([k, t]) => option(k, t, String(val))).join("")}</select>`;
      if (type === "feeder") return pick(feeders(), val, at);
      if (type === "breaker") return pick(breakers(), val, at);
      if (type === "backup") return pick(["", ...breakers()], val, at);
      if (type === "photo") return pick(["", ...photoNames], val, at);
      return `<input class="in" ${at} ${type === "number" ? 'type="number" step="any"' : ""} value="${esc(val ?? "")}">`; };
    const table = key => `<h4>${EX_TITLE[key]} <button type="button" class="btn sm" data-exadd="${key}">＋ 추가</button></h4>
      ${draft[key].length ? `<div class="ex-scroll"><table class="ex-tbl"><tr>${EX_COLS[key].map(c => `<th>${c[1]}</th>`).join("")}<th></th></tr>${draft[key].map((item, i) => `<tr>${EX_COLS[key].map(c => `<td>${cell(key, i, c, item)}</td>`).join("")}<td><button type="button" class="btn sm" data-exdel="${key}.${i}">삭제</button></td></tr>`).join("")}</table></div>` : '<p class="muted">없음</p>'}`;
    const draw = box => { box.querySelector("#exBody").innerHTML = ["feeders", "transformers", "relays"].map(table).join(""); };
    const fresh = key => Object.fromEntries(EX_COLS[key].map(([n, , t, dflt]) => [n, typeof t === "object" ? Object.keys(t)[0] : t === "feeder" ? "GRID" : t === "breaker" ? "L3" : t === "backup" || t === "photo" ? "" : dflt]));
    modal(`<div class="wide xl"><h3>설비 구성 — 시나리오용 추가 설비</h3>
      <p class="muted">대응표에 아직 없는 급전선·차단기, 변압기, 보호 계전기를 가상 장치에만 추가합니다. 실제 대응표와 운전 설정은 바뀌지 않습니다. 정정값은 시험용 가정값이며 실제 값은 보호 협조 검토서로 정합니다.<br>
      감시 대상: 과전류는 급전선 이름(여럿이면 쉼표), 지락은 급전선 이름 하나, 부족전압은 모선 A 또는 B. 지락 전류는 GF.&lt;급전선&gt;, 차단 실패는 STK.&lt;차단기&gt; = 1 로 시나리오에서 넣습니다.</p>
      <div id="exBody"></div><p class="sc-fail" id="exWhy"></p>
      <div class="sc-actions"><span class="sc-spacer"></span><button type="button" class="btn" id="exClose">닫기</button><button type="button" class="btn pri" id="exSave">저장</button></div></div>`, box => {
      draw(box);
      box.onchange = e => { const k = e.target.dataset.ex; if (!k) return; const [key, i, name] = k.split("."), col = EX_COLS[key].find(c => c[0] === name);
        draft[key][i][name] = col[2] === "number" ? Number(e.target.value) : e.target.value.trim();
        if (name === "id" || name === "kind") { if (key === "relays" && name === "kind") { draft[key][i].target = {oc: "L3", gf: "L3", uv: "B"}[e.target.value]; draft[key][i].code = {oc: 51, gf: 64, uv: 27}[e.target.value]; if (e.target.value === "uv") draft[key][i].curve = "dt"; } draw(box); } };
      box.onclick = async e => { const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.exadd) { draft[b.dataset.exadd].push(fresh(b.dataset.exadd)); return draw(box); }
        if (b.dataset.exdel) { const [key, i] = b.dataset.exdel.split("."); draft[key].splice(Number(i), 1); return draw(box); }
        if (b.id === "exClose") return closeModal();
        if (b.id === "exSave") { const out = {feeders: draft.feeders.map(f => { const o = {...f, ems: f.ems === "true" || f.ems === true}; if (!o.photo) delete o.photo; return o; }), transformers: draft.transformers, relays: draft.relays.map(relayOut)};
          const r = await api("/api/scenarios/extra", {extra: out});
          if (r.ok === false) { box.querySelector("#exWhy").textContent = r.why || "저장하지 못했습니다"; return; }
          config = await api("/api/scenarios/catalog"); ScTopo.configure(config.extra); output = null; revision++; closeModal(); toast("설비 구성을 저장했습니다", "ok"); paint(); } };
    });
  }

  function play(on) {
    clearInterval(playing); playing = null;
    if (!on) return;
    if (stepIndex >= scene().steps.length - 1) stepIndex = 0;
    playing = setInterval(() => {
      if (!$("#scWorkspace") || stepIndex >= scene().steps.length - 1) { clearInterval(playing); playing = null; if ($("#scWorkspace")) paint(); return; }
      stepIndex++; paint();
    }, 1500);
  }

  function make(type, tag, device) {
    if (type === "policy") return {type, mode: "island", posture: "평시", control: "auto", hour: 11};
    if (type === "policy_check") return {type, metric: "executed", op: "eq", value: 1};
    if (type === "wait") return {type, ms: 500};
    if (type === "command" || type === "response") {
      if (!config.commands.length) { toast("지령 규약이 등록된 장비가 없습니다", "bad"); return null; }
      return type === "command" ? {type, device: device || config.commands[0], value: 1}
        : {type, device: device || config.commands[0], ms: 800};
    }
    if (!config.points.length) { toast("등록된 신호가 없습니다", "bad"); return null; }
    const p = point(tag) || config.points.find(p => p.rw === (type === "set" ? "w" : "r")) || config.points[0];
    const base = {type, tag: p.tag, value: type === "set" ? Math.max(p.lo ?? 0, Math.min(p.hi ?? 0, 0)) : 1};
    if (type === "expect") return {...base, op: "eq", ms: 500, limit: 500};
    if (type === "branch") return {...base, op: "eq", skip: 0};
    return base;
  }

  function append(step, at) {
    if (!step) return;
    if (scene().steps.length >= 30) return toast("시나리오당 최대 30단계입니다", "bad");
    const steps = scene().steps, index = at === undefined ? steps.length : Math.max(0, Math.min(at, steps.length));
    steps.splice(index, 0, step);
    stepIndex = index;
    changed();
    paint();
  }

  function move(from, to) {
    const steps = scene().steps;
    if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return;
    steps.splice(to, 0, steps.splice(from, 1)[0]);
    stepIndex = to;
    changed();
    paint();
  }

  function addPalette(data, at) {
    if (config.commands.includes(data.device)) append(make("command", null, data.device), at);
    if (point(data.point)) append(make(point(data.point).rw === "w" ? "set" : "expect", data.point), at);
  }

  async function run(action) {
    if (!can("engineer")) return loginDialog();
    const indexes = [...selected].sort((a, b) => a - b);
    const currentRevision = revision;
    const payload = {cases: indexes.map(i => cases[i]), improve: action === "improve"};
    busy = true;
    paint();
    try {
      const r = await api(action === "export" ? "/api/scenarios/export" : "/api/scenarios/verify", payload);
      if (r.ok === false) return toast(r.why, "bad");
      if (action === "export") {
        const url = URL.createObjectURL(new Blob([r.source], {type: "text/x-python"}));
        const link = document.createElement("a");
        link.href = url;
        link.download = "test_ems_scenario_generated.py";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (revision === currentRevision) {
        output = {...r, indexes, improve: payload.improve, results: r.results.map((item, i) => ({...item, index: indexes[i]}))};
      }
    } catch (_) { toast("시나리오 서버에 연결하지 못했습니다", "bad"); }
    finally { busy = false; paint(); }
  }

  /* 시퀀스 문서(PPT): 고른 시나리오를 검증한 시간과 함께 내보내고, 회의에서 고친 파일을 다시 올려 반영한다 */
  async function pptxOut() {
    if (!can("engineer")) return loginDialog();
    const indexes = [...selected].sort((a, b) => a - b); busy = true; paint();
    try {
      const r = await fetch("/api/scenarios/pptx", {method: "POST", headers: {"X-EMS-Token": S.token || ""}, body: JSON.stringify({cases: indexes.map(i => cases[i]), verify: indexes.length <= maxBatch})});
      if (!r.ok) { let why = ""; try { why = (await r.json()).why; } catch (_) { /* 무시 */ } return toast(why || "PPT 를 만들지 못했습니다", "bad"); }
      const link = document.createElement("a"); link.href = URL.createObjectURL(await r.blob()); link.download = `EMS_sequence_${new Date().toISOString().slice(0, 10)}.pptx`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      toast(`시퀀스 문서를 내보냈습니다 (${indexes.length}건)`, "ok");
    } catch (_) { toast("시나리오 서버에 연결하지 못했습니다", "bad"); }
    finally { busy = false; paint(); }
  }
  function pptxIn() {
    if (!can("engineer")) return loginDialog();
    const pick = document.createElement("input"); pick.type = "file"; pick.accept = ".pptx";
    pick.onchange = async () => {
      const file = pick.files[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) return toast("파일이 너무 큽니다(8 MB 까지)", "bad");
      let r; try { r = await (await fetch("/api/scenarios/import", {method: "POST", headers: {"X-EMS-Token": S.token || "", "Content-Type": "application/octet-stream"}, body: file})).json(); } catch (_) { return toast("올리지 못했습니다", "bad"); }
      if (r.ok === false) return toast(r.why || "읽지 못했습니다", "bad");
      const canon = st => st ? JSON.stringify(Object.keys(st).filter(k => k !== "limit").sort().map(k => [k, st[k]])) : "";      // 열쇠 순서와 판정 여유(limit)는 비교에서 뺀다
      const same = (a, b) => a.steps.length === b.steps.length && a.steps.every((st, i) => canon(st) === canon(b.steps[i]));
      r.cases.forEach(c => { const o = cases.find(x => x.name === c.name); if (o) c.steps = c.steps.map((st, i) => canon(st) === canon(o.steps[i]) ? o.steps[i] : st); });      // 안 바뀐 단계는 원래 것을 그대로 둔다
      const rows = r.cases.map(c => { const at = cases.findIndex(x => x.name === c.name); return {c, at, kind: at < 0 ? "새 시나리오" : same(c, cases[at]) && (c.note || "") === (cases[at].note || "") ? "같음" : "바뀜"}; });
      const diff = x => x.at < 0 ? `${x.c.steps.length}단계` : x.kind === "같음" ? "" : `${cases[x.at].steps.length} → ${x.c.steps.length}단계` + x.c.steps.map((st, i) => canon(st) !== canon(cases[x.at].steps[i]) ? i + 1 : 0).filter(Boolean).slice(0, 8).map(n => ` #${n}`).join("");
      modal(`<h3>고친 시퀀스 문서 반영</h3><p class="sub">${esc(file.name)} — 시나리오 ${r.found}건을 읽었습니다. 반영할 것을 고르십시오. 틀린 시나리오는 반영하지 않습니다.</p>
        <div class="scroll" style="max-height:340px"><table class="t"><thead><tr><th></th><th>시나리오</th><th>구분</th><th>바뀐 곳</th></tr></thead><tbody>
        ${rows.map((x, i) => `<tr><td><input type="checkbox" data-in="${i}" ${x.kind === "같음" ? "" : "checked"}></td><td>${esc(x.c.name)}</td><td><span class="pill ${x.kind === "바뀜" ? "warn" : x.kind === "같음" ? "info" : "ok"}">${x.kind}</span></td><td class="mono">${esc(diff(x))}</td></tr>`).join("")}
        ${r.errors.map(e => `<tr><td></td><td>${esc(e.name)}</td><td><span class="pill bad">틀림</span></td><td>${e.row ? e.row + "번 줄: " : ""}${esc(e.why)}</td></tr>`).join("")}</tbody></table></div>
        ${r.comments.length ? `<h4>검토 의견 ${r.comments.length}건</h4><div class="scroll" style="max-height:140px">${r.comments.map(m => `<p class="sub">· ${esc(m.name)} ${m.step}단계 — ${esc(m.text)}</p>`).join("")}</div>` : ""}
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" id="inNo">닫기</button><button class="btn pri" id="inOk">고른 것 반영</button></div>`, box => {
        box.querySelector("#inNo").onclick = closeModal;
        box.querySelector("#inOk").onclick = () => {
          let n = 0; box.querySelectorAll("[data-in]:checked").forEach(el => { const x = rows[+el.dataset.in]; if (x.at >= 0) cases[x.at] = x.c; else if (cases.length < maxDrafts) cases.push(x.c); else return; n++; });
          save(); output = null; revision++; closeModal(); toast(`${n}건을 반영했습니다. 검증을 다시 돌려 확인하십시오`, "ok"); paint();
        };
      });
    };
    pick.click();
  }

  /* ── 시나리오 분류와 고르기 창: 정상 운전(운전 모드 · 장비 시퀀스), 고장 대응(FMEA), 보호 협조(FAT 시험 항목), 내가 만든 것 */
  const CATS = ["정상 운전 · 운전 모드", "정상 운전 · 장비 시퀀스", "고장 대응 (FMEA)", "보호 협조 (FAT 시험 항목)", "내가 만든 것"];
  const catOf = c => c.cat || (config && config.presets.find(p => p.name === c.name) || {}).cat || CATS[4];
  const catClass = c => ({[CATS[2]]: "bad", [CATS[3]]: "warn", [CATS[4]]: "info"}[catOf(c)] || "ok");
  const adopt = preset => { if (cases.length >= maxDrafts) { toast("편집본이 가득 찼습니다", "bad"); return -1; } cases.push(structuredClone(preset)); return cases.length - 1; };
  let pickCat = "", pickQ = "";
  function picker() {
    const rows = () => [...cases.map((c, i) => ({c, i})), ...config.presets.filter(q => !cases.some(c => c.name === q.name)).map(c => ({c, i: -1}))]
      .filter(x => (!pickCat || catOf(x.c) === pickCat) && (!pickQ || (x.c.name + " " + (x.c.ref || "") + " " + (x.c.note || "")).includes(pickQ)));
    const body = () => {
      const list = rows(), count = k => cases.filter(c => catOf(c) === k).length + config.presets.filter(q => catOf(q) === k && !cases.some(c => c.name === q.name)).length;
      return `<h3>시나리오 고르기</h3><p class="sub">분류를 고르고, 이름을 누르면 그 시나리오를 연다. 표시(✔)한 것이 [선택 병렬 검증]과 [시퀀스 PPT 내보내기]의 대상이다(최대 ${maxBatch}건).</p>
        <div class="sc-pk-bar"><div class="seg">${["", ...CATS].map(k => `<button data-pk-cat="${esc(k)}" class="${k === pickCat ? "on" : ""}">${esc(k || "전체")}${k ? ` <small>${count(k)}</small>` : ""}</button>`).join("")}</div>
          <input class="in" id="pkQ" placeholder="이름 · FMEA 번호로 찾기" value="${esc(pickQ)}" style="width:190px"></div>
        <div class="sc-pk-bar"><button class="btn sm" data-pk="all">보이는 것 모두 표시</button><button class="btn sm" data-pk="only">보이는 것만 표시</button><button class="btn sm" data-pk="none">표시 모두 해제</button><span class="sc-spacer"></span><span class="muted">표시 ${selected.size}/${maxBatch} · 보이는 것 ${list.length}건</span></div>
        <div class="scroll sc-pk-list"><table class="t"><thead><tr><th style="width:34px">검증</th><th>시나리오</th><th>분류</th><th>근거</th><th class="n">단계</th><th>실장비 시험(FAT)에서 확인할 것</th></tr></thead><tbody>
        ${list.map((x, k) => `<tr class="${x.i === active ? "sel" : ""}"><td><input type="checkbox" data-pk-check="${k}" ${x.i >= 0 && selected.has(x.i) ? "checked" : ""}></td><td><a class="sc-pk-name" data-pk-open="${k}">${esc(x.c.name)}</a>${x.i < 0 ? ' <span class="pill info">기본안 · 아직 안 가져옴</span>' : ""}${x.c.note ? `<div class="sub">${esc(x.c.note)}</div>` : ""}</td>
          <td><span class="pill ${catClass(x.c)}">${esc(catOf(x.c))}</span></td><td class="mono">${esc(x.c.ref || "")}</td><td class="n">${x.c.steps.length}</td><td class="sub">${esc(x.c.fat || "")}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">해당하는 시나리오가 없습니다</td></tr>'}</tbody></table></div>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn pri" data-pk="close">닫기</button></div>`;
    };
    const idx = x => x.i >= 0 ? x.i : (x.i = adopt(x.c));
    const mark = (x, on) => { const i = on ? idx(x) : x.i; if (i < 0) return; if (on) { if (selected.size >= maxBatch && !selected.has(i)) return toast(`한 번에 최대 ${maxBatch}건을 검증할 수 있습니다`, "bad"); selected.add(i); } else selected.delete(i); };
    const done = () => { save(); revision++; output = null; };
    const bind = box => {
      const list = rows(); box.classList.add("wide");
      box.querySelectorAll("[data-pk-cat]").forEach(b => b.onclick = () => { pickCat = b.dataset.pkCat; redraw(box); });
      box.querySelector("#pkQ").onchange = e => { pickQ = e.target.value.trim(); redraw(box); };
      box.querySelectorAll("[data-pk-check]").forEach(c => c.onchange = () => { mark(list[+c.dataset.pkCheck], c.checked); done(); redraw(box); });
      box.querySelectorAll("[data-pk-open]").forEach(a => a.onclick = () => { const i = idx(list[+a.dataset.pkOpen]); if (i < 0) return; active = i; stepIndex = 0; done(); box.classList.remove("wide"); closeModal(); paint(); });
      box.querySelectorAll("[data-pk]").forEach(b => b.onclick = () => {
        const k = b.dataset.pk; if (k === "close") { box.classList.remove("wide"); closeModal(); return paint(); }
        if (k !== "all") selected.clear(); if (k !== "none") list.forEach(x => mark(x, true)); done(); redraw(box);
      });
    };
    const redraw = box => { box.innerHTML = body(); bind(box); };
    play(false); modal(body(), bind);
  }
  /* 다른 스크립트(화면 캡처·교육)에서 이름이나 분류로 고를 때 쓴다 */
  function use(name) { let i = cases.findIndex(c => c.name === name); if (i < 0) { const q = config.presets.find(x => x.name === name); if (q) i = adopt(q); } if (i < 0) return false; active = i; stepIndex = 0; selected.add(i); save(); paint(); return true; }
  function choose(test) { config.presets.filter(test).forEach(q => { if (!cases.some(c => c.name === q.name)) adopt(q); }); selected = new Set(cases.map((c, i) => test(c) ? i : -1).filter(i => i >= 0).slice(0, maxBatch)); save(); revision++; output = null; paint(); return selected.size; }

  function click(e) {
    const el = e.target.closest("button,[data-step]");
    if (!el) return;
    const d = el.dataset;
    if (d.view) { view = d.view; picked = ""; try { localStorage.setItem("ems.scenario.view", view); } catch (_) { /* 무시 */ } return paint(); }
    if (d.topo) {
      if (d.topo === "close") { picked = pickedPart = ""; return paint(); }
      const step = make(d.topo, d.tag, d.device);
      if (step && d.value !== undefined) step.value = Number(d.value);
      return append(step, scene().steps.length ? stepIndex + 1 : 0);
    }
    if (["first", "prev", "next", "play"].includes(d.sc)) {
      if (d.sc === "play") play(!playing); else { play(false); stepIndex = d.sc === "first" ? 0 : Math.max(0, Math.min(scene().steps.length - 1, stepIndex + (d.sc === "prev" ? -1 : 1))); }
      return paint();
    }
    if (d.sc === "layout-reset") { ScTopo.reset(); return paint(); }
    if (d.sc === "extra") return extraDialog();
    if (d.case !== undefined || d.step !== undefined || d.jump) {
      play(false);
      if (d.case !== undefined) { active = Number(d.case); stepIndex = 0; }
      if (d.step !== undefined) stepIndex = Number(d.step);
      if (d.jump) [active, stepIndex] = d.jump.split(":").map(Number);
      return paint();
    }
    if (d.point || d.device) return addPalette(d);
    const action = d.sc;
    if (!action) return;
    if (["verify", "improve", "export"].includes(action)) return run(action);
    if (action === "pick") return picker();
    if (action === "prev-case" || action === "next-case") { play(false); active = (active + (action === "prev-case" ? -1 : 1) + cases.length) % cases.length; stepIndex = 0; return paint(); }
    if (action === "pptx") return pptxOut();
    if (action === "pptx-in") return pptxIn();
    if (action === "add") return append(make($("#scAdd").value));
    if (action === "mode-select") {
      selected = new Set(cases.map((item, i) => isModeCase(item) ? i : -1).filter(i => i >= 0).slice(0, maxBatch));
      revision++;
      output = null;
      return paint();
    }
    if (action === "mode-pack") {
      const missing = config.presets.filter(p => isModeCase(p) && !cases.some(c => c.name === p.name));
      if (cases.length + missing.length > maxDrafts) return toast("운전 모드 기본안을 추가할 공간이 부족합니다", "bad");
      if (missing.length) {
        active = cases.length;
        stepIndex = 0;
        cases.push(...structuredClone(missing));
        selected = new Set(cases.map((item, i) => isModeCase(item) ? i : -1).filter(i => i >= 0).slice(0, maxBatch));
      }
    }
    if (["new", "copy", "preset"].includes(action)) {
      if (cases.length >= maxDrafts) return;
      const source = action === "preset" ? config.presets[Number(presetIndex)] : scene();
      const draft = action === "new" ? {name: "새 시나리오", steps: []} : structuredClone(source);
      if (action === "copy" || cases.some(item => item.name === draft.name)) {
        draft.name = (draft.name + " 복사").slice(0, 80);
      }
      cases.push(draft);
      active = cases.length - 1;
      if (selected.size < maxBatch) selected.add(active);
      stepIndex = 0;
    }
    if (action === "delete") {
      if (!confirm(`‘${scene().name}’ 시나리오를 삭제할까요?`)) return;
      cases.splice(active, 1);
      selected = new Set([...selected].filter(i => i !== active).map(i => i > active ? i - 1 : i));
      active = Math.min(active, cases.length - 1);
      stepIndex = 0;
    }
    if (action === "dup") {
      if (scene().steps.length >= 30) return toast("시나리오당 최대 30단계입니다", "bad");
      scene().steps.splice(stepIndex + 1, 0, structuredClone(scene().steps[stepIndex]));
      stepIndex++;
    }
    if (action === "remove") {
      scene().steps.splice(stepIndex, 1);
      stepIndex = Math.max(0, Math.min(stepIndex, scene().steps.length - 1));
    }
    if (action === "up" || action === "down") {
      const target = stepIndex + (action === "up" ? -1 : 1);
      const steps = scene().steps;
      [steps[target], steps[stepIndex]] = [steps[stepIndex], steps[target]];
      stepIndex = target;
    }
    if (action === "apply" && output?.candidate) {
      output.candidate.forEach((item, i) => { cases[output.indexes[i]] = item; });
      toast("재검증을 통과한 대기 한도를 시나리오에 반영했습니다", "ok");
    }
    changed();
    paint();
  }

  function change(e) {
    const el = e.target;
    if (el.id === "scPreset") {
      presetIndex = el.value;
      return;
    }
    if (el.dataset.check !== undefined) {
      if (el.checked && selected.size >= maxBatch) {
        el.checked = false;
        return toast(`한 번에 최대 ${maxBatch}건을 검증할 수 있습니다`, "bad");
      }
      const i = Number(el.dataset.check);
      if (el.checked) selected.add(i); else selected.delete(i);
      revision++;
      output = null;
      paint();
      return;
    }
    if (el.id === "scName") {
      scene().name = el.value.trim();
      changed();
      const tab = $(".sc-cur b");
      if (tab) tab.textContent = scene().name || "이름 없음";
      const tick = $(`[data-check="${active}"]`);
      if (tick) tick.setAttribute("aria-label", (scene().name || "이름 없음") + " 검증 선택");
      $(".sc-bottom [aria-live]").innerHTML = results();
      return;
    }
    const key = el.dataset.field;
    if (!key) return;
    if (!el.checkValidity()) {
      el.reportValidity();
      return;
    }
    const s = scene().steps[stepIndex];
    if (key === "type") {
      const next = make(el.value);
      if (next) scene().steps[stepIndex] = next;
    } else {
      s[key] = ["value", "ms", "limit", "skip", "hour"].includes(key) ? Number(el.value) : el.value;
      if (s.type === "expect" && key === "ms") s.limit = Math.max(s.limit ?? 0, s.ms);
    }
    changed();
    paint();
    $(`[data-field="${key}"]`)?.focus();
  }

  return {
    async mount(main) {
      const id = ++mountId;
      main.innerHTML = `<div class="pagehd"><h1>운영 시나리오</h1><div class="sub">${S.snap.sim ? "가상 장치에서 운전 순서를 편집하고 여러 시험을 비교합니다." : "실장비 모드 — 구성도로 현재 상태를 봅니다(표시 전용)."}</div></div>
        <div id="scWorkspace"><p>장비·신호 불러오는 중…</p></div>`;
      if (!S.snap.sim) {                                  // 실장비 모드: 구성도로 현재 상태만 보여 준다
        const box = $("#scWorkspace"); ScTopo.configure(null);
        box.innerHTML = `<section class="sc-panel">${liveView()}</section>`; box.onclick = e => { if (e.target.closest('[data-sc="layout-reset"]')) { ScTopo.reset(); refreshLive(); } };
        return ScTopo.bind(box, () => {}, refreshLive);
      }
      try { config ||= await api("/api/scenarios/catalog"); }
      catch (_) { config = null; }
      const root = $("#scWorkspace");
      if (!root || id !== mountId) return;
      if (!config?.points) {
        config = null;
        root.textContent = "장비 목록을 불러오지 못했습니다. 화면을 다시 열어주세요.";
        return;
      }
      ScTopo.configure(config.extra);
      if (!cases.length) {
        cases = config.presets.length ? structuredClone(config.presets) : [{name: "새 시나리오", steps: []}];
        selected = new Set(cases.slice(0, maxBatch).map((_, i) => i));
        save();
      }
      root.onclick = click;
      root.onchange = change;
      root.oninput = e => {
        if (e.target.id !== "scSearch") return;
        search = e.target.value;
        $("#scPalette").innerHTML = palette();
      };
      paint();
    },
    update() { refreshLive(); },
    use, choose, cats: () => CATS
  };
})();
