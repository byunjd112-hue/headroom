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
  const maxDrafts = 40, maxBatch = 20;
  const isModeCase = item => item.steps.some(step => step.type === "policy");
  let cases;
  try { cases = JSON.parse(localStorage.getItem(key)); } catch (_) { /* use built-in presets */ }
  if (!Array.isArray(cases)) cases = [];
  let active = 0, stepIndex = 0, config = null, selected = new Set(), presetIndex = "0";
  cases.slice(0, maxBatch).forEach((_, i) => selected.add(i));
  let output = null, busy = false, mountId = 0, revision = 0, search = "";

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

  function sequence() {
    const lanes = ["EMS", ...new Set(scene().steps.map(lane).filter(d => d !== "EMS"))];
    const columns = `grid-template-columns:repeat(${lanes.length},minmax(135px,1fr))`;
    return `<div class="sc-scroll"><div class="sc-grid" style="${columns}">
      ${lanes.map((d, i) => `<div class="sc-lane" style="grid-column:${i + 1};grid-row:1"><b>${esc(d)}</b><small>${esc(deviceName(d))}</small></div>`).join("")}
      ${lanes.map((_, i) => `<div class="sc-life" style="grid-column:${i + 1};grid-row:2 / ${scene().steps.length + 3}"></div>`).join("")}
      ${scene().steps.map((s, i) => {
        const end = lanes.indexOf(lane(s)) + 1, last = Math.max(2, end + 1);
        const direction = s.type === "expect" || s.type === "branch" ? "back" : "forward";
        const state = output?.results.find(r => r.index === active)?.rows.find(row => row.step === i)?.state || "";
        return `<button type="button" class="sc-message ${end === 1 ? "local" : direction} ${state} ${i === stepIndex ? "chosen" : ""}" data-step="${i}" style="grid-column:1 / ${last};grid-row:${i + 2}" aria-pressed="${i === stepIndex}">
          <span>${i + 1}. ${esc(description(s))}</span><i aria-hidden="true"></i>
        </button>`;
      }).join("")}</div></div>`;
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
      </div>
      ${config.presets.length ? `<div class="sc-actions sc-presets">
        <label for="scPreset">기본 운전 시나리오</label>
        <select class="in" id="scPreset">${config.presets.map((preset, i) => option(String(i), preset.name, presetIndex)).join("")}</select>
        ${button("preset", "편집본으로 추가", "", cases.length >= maxDrafts)}
        ${button("mode-pack", "운전 모드 기본안 전체 추가", "", !config.presets.some(p => isModeCase(p) && !cases.some(c => c.name === p.name)) || cases.length >= maxDrafts)}
        ${button("mode-select", "모드 시나리오 선택", "", !cases.some(isModeCase))}
        <span class="muted">${selected.size}/${maxBatch}개 선택</span>
      </div>` : ""}
      <div class="sc-tabs" aria-label="시나리오 선택">${cases.map((c, i) => `<div class="sc-tab ${i === active ? "on" : ""}">
        <input type="checkbox" data-check="${i}" aria-label="${esc(c.name)} 검증 선택" ${selected.has(i) ? "checked" : ""}>
        <button class="btn sm" type="button" data-case="${i}" aria-pressed="${i === active}">${esc(c.name || "이름 없음")}</button></div>`).join("")}</div>
      <div class="sc-layout">
        <aside class="sc-panel"><h3>장비·신호</h3>
          <input class="in" id="scSearch" aria-label="장비·신호 검색" placeholder="장비 또는 신호 검색" value="${esc(search)}">
          <div id="scPalette">${palette()}</div>
        </aside>
        <section class="sc-panel" id="scDrop">
          <label class="sc-name">시나리오 이름 <input class="in" id="scName" maxlength="80" value="${esc(scene().name)}"></label>
          <div class="sc-actions"><h3>시퀀스</h3><span class="sc-spacer"></span>
            <select class="in" id="scAdd" aria-label="추가할 단계">${Object.entries(labels).map(([id, name]) => option(id, name)).join("")}</select>
            ${button("add", "＋ 단계")}</div>
          ${scene().note ? `<p class="sc-note">${esc(scene().note)}</p>` : ""}
          <p class="muted">장비 목록의 신호를 클릭하거나 이 영역으로 끌어오세요.</p>${sequence()}
        </section>
        <aside class="sc-panel"><h3>단계 설정 ${scene().steps.length ? "· " + (stepIndex + 1) : ""}</h3>${inspector()}</aside>
      </div>
      <section class="sc-panel sc-bottom"><h3>검증 결과</h3><div aria-live="polite">${busy ? '<p>독립 가상 장치에서 검증 중입니다.</p>' : results()}</div></section>`;
    root.ondragstart = e => {
      const item = e.target.closest("[data-point],[data-device]");
      if (item) e.dataTransfer.setData("application/x-ems-scenario", JSON.stringify(item.dataset));
    };
    const drop = $("#scDrop");
    drop.ondragover = e => { if (e.dataTransfer.types.includes("application/x-ems-scenario")) e.preventDefault(); };
    drop.ondrop = e => {
      const data = e.dataTransfer.getData("application/x-ems-scenario");
      if (!data) return;
      e.preventDefault();
      try { addPalette(JSON.parse(data)); } catch (_) { /* ignore other drag data */ }
    };
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

  function append(step) {
    if (!step) return;
    if (scene().steps.length >= 30) return toast("시나리오당 최대 30단계입니다", "bad");
    scene().steps.push(step);
    stepIndex = scene().steps.length - 1;
    changed();
    paint();
  }

  function addPalette(data) {
    if (config.commands.includes(data.device)) append(make("command", null, data.device));
    if (point(data.point)) append(make(point(data.point).rw === "w" ? "set" : "expect", data.point));
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

  function click(e) {
    const el = e.target.closest("button");
    if (!el) return;
    const d = el.dataset;
    if (d.case !== undefined || d.step !== undefined || d.jump) {
      if (d.case !== undefined) { active = Number(d.case); stepIndex = 0; }
      if (d.step !== undefined) stepIndex = Number(d.step);
      if (d.jump) [active, stepIndex] = d.jump.split(":").map(Number);
      return paint();
    }
    if (d.point || d.device) return addPalette(d);
    const action = d.sc;
    if (!action) return;
    if (["verify", "improve", "export"].includes(action)) return run(action);
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
        return toast("한 번에 최대 20개 시나리오를 검증할 수 있습니다", "bad");
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
      const tab = $(`[data-case="${active}"]`);
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
      main.innerHTML = `<div class="pagehd"><h1>운영 시나리오</h1><div class="sub">가상 장치에서 운전 순서를 편집하고 여러 시험을 비교합니다.</div></div>
        <div id="scWorkspace"><p>${S.snap.sim ? "장비·신호 불러오는 중…" : "이 기능은 가상 장치 모드(run_sim)에서 사용할 수 있습니다."}</p></div>`;
      if (!S.snap.sim) return;
      try { config ||= await api("/api/scenarios/catalog"); }
      catch (_) { config = null; }
      const root = $("#scWorkspace");
      if (!root || id !== mountId) return;
      if (!config?.points) {
        config = null;
        root.textContent = "장비 목록을 불러오지 못했습니다. 화면을 다시 열어주세요.";
        return;
      }
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
    update() {}
  };
})();
