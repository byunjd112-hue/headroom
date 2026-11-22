"use strict";
/* 날씨 입력 · AI 예측과 비교(발전·예측 화면 아래): 장병이 본 하늘 상태를 손으로 넣고(작전지), 주둔지에서는 군 통신망의 날씨 자료를 받아 온다.
   넣은 날씨로 만든 태양광 예측을 AI 예측과 섞고, 실측이 나오면 둘의 오차를 견주어 반영 비율을 스스로 조정한다. */
const WX = {
  d: null,
  html() {
    return `<div class="panel" id="wxPanel" style="margin-top:18px"><div class="hd"><h3>날씨 입력 · AI 예측과 비교</h3><span class="sub" style="margin-left:10px">휴대폰 날씨 앱(구글 날씨 등)에 보이는 대로 넣으면 태양광 예측을 고치고, 실측이 나오면 AI 예측과 견주어 반영 비율을 조정한다</span>
        <div class="spacer"></div><button class="btn sm" id="wxFetch" title="설정의 주소(weather.url)에서 지금 받아 온다">통신망에서 지금 받기</button><button class="btn sm" id="wxImp">받은 자료 붙여넣기</button></div>
      <div class="bd"><div class="arc-form" id="wxForm"><b>지금 날씨 넣기</b>
          <label title="휴대폰 날씨 앱에 적힌 그대로 고른다">날씨 <select class="in sm" id="wxSky"></select></label>
          <label title="날씨 앱의 강수 확률(%). 없으면 비워 둔다">강수 확률 % <input class="in sm" id="wxPop" type="number" min="0" max="100" step="10" style="width:64px"></label>
          <label>기온 ℃ <input class="in sm" id="wxTemp" type="number" step="1" style="width:64px"></label>
          <label title="날씨 앱의 시간별 · 일별 예보를 보고 고른다">기간 <select class="in sm" id="wxWhen"><option value="h3">지금부터 3시간</option><option value="h6" selected>지금부터 6시간</option><option value="h12">지금부터 12시간</option><option value="d1">내일 하루</option><option value="d2">모레 하루</option></select></label>
          <input class="in sm" id="wxNote" maxlength="60" placeholder="적어 둘 말(선택)" style="width:180px"><button class="btn sm pri" id="wxAdd">넣기 · 반영</button></div>
        <div class="arc-grid" style="margin-top:12px"><div><div class="lab" style="margin-bottom:6px">지금과 앞으로의 날씨 기록 <span class="sub">— 겹치면 손으로 넣은 것을 먼저 쓴다</span></div>
            <div class="scroll arc-table" style="max-height:230px"><table class="t"><thead><tr><th>기간</th><th>날씨</th><th class="n">강수 확률</th><th class="n">기온</th><th class="n" title="하늘 상태와 강수 확률로 바꾼 값(0 = 구름 없음, 10 = 다 덮임). 예측 계산에 쓴다">환산 운량</th><th>출처</th><th></th></tr></thead><tbody id="wxRows"></tbody></table></div>
            <p class="sub" id="wxNet" style="margin:8px 0 0"></p></div>
          <div><div class="lab" style="margin-bottom:6px">AI 예측과 비교</div><div id="wxCmp"></div></div></div></div></div>`;
  },
  bind() {
    const ask = async body => { if (!can("operator")) { toast("운용자 권한 필요", "bad"); return loginDialog(); } const r = await api("/api/weather", body); toast(r.ok ? "반영했습니다 — 예측을 다시 계산합니다" : (r.why || "실패"), r.ok ? "ok" : "bad"); setTimeout(() => this.load(), 600); return r; };
    this.ask = ask;
    $("#wxAdd").onclick = () => { const v = id => $(id).value.trim(); const w = v("#wxWhen"); ask(Object.assign({ do: "manual", sky: v("#wxSky"), pop: v("#wxPop"), temp: v("#wxTemp"), note: v("#wxNote") }, w[0] === "d" ? { day: +w.slice(1) } : { hours: +w.slice(1) })); };
    $("#wxFetch").onclick = () => ask({ do: "fetch" });
    $("#wxImp").onclick = () => modal(`<h3>받은 날씨 자료 붙여넣기</h3><p class="sub">통신망에서 파일로 받은 자료를 붙여 넣는다. JSON <span class="mono">{"hours":[{"t":"2026-11-22 13:00","sky":"대체로 흐림","pop":30,"temp":12}, …]}</span> 또는 CSV <span class="mono">시각,운량,기온,강수</span> (한 줄에 한 시각). 하늘 상태 대신 <span class="mono">"cloud":3</span> 처럼 운량(0~10)을 써도 된다.</p>
        <textarea class="in" id="wxText" rows="12" style="width:100%;font-family:var(--mono);font-size:12px" placeholder="2026-11-22 13:00,3,12,0"></textarea>
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" id="wxNo">닫기</button><button class="btn pri" id="wxOk">넣기 · 반영</button></div>`, box => {
      box.querySelector("#wxNo").onclick = closeModal; box.querySelector("#wxOk").onclick = async () => { const r = await ask({ do: "import", text: box.querySelector("#wxText").value }); if (r && r.ok) closeModal(); }; });
  },
  async load() { if (!$("#wxPanel")) return; this.d = await api("/api/archive/weather"); this.paint(); },
  paint() {
    const d = this.d; if (!d || !d.ok || !$("#wxRows")) return; const sk = $("#wxSky"); if (!sk.options.length) sk.innerHTML = d.sky.map(x => `<option>${esc(x)}</option>`).join("");
    const n = (v, u = "") => v == null ? "—" : v + u;
    $("#wxRows").innerHTML = d.rows.length ? d.rows.map(r => `<tr class="${r.use ? "arc-on" : ""}"><td class="mono">${esc(r.t0.slice(5))} ~ ${esc(r.t1.slice(11))}${r.use ? ' <span class="pill ok">지금 사용</span>' : ""}</td><td>${esc(r.sky || "")}</td><td class="n">${n(r.pop, "%")}</td><td class="n">${n(r.temp, "℃")}</td><td class="n sub">${r.cloud}</td>
        <td>${esc(r.src)}${r.who ? ` <span class="sub">${esc(r.who)}</span>` : ""}${r.note ? ` <span class="sub">· ${esc(r.note)}</span>` : ""}</td><td>${r.src === "수기" ? `<button class="btn sm" data-del="${esc(r.at)}">지우기</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">날씨 기록이 없습니다 — AI 예측만 씁니다</td></tr>`;
    $$("#wxRows [data-del]").forEach(b => b.onclick = () => this.ask({ do: "delete", at: b.dataset.del }));
    const nt = d.net; $("#wxNet").innerHTML = `통신망 받기: ${nt.url ? `<span class="mono">${esc(nt.url)}</span> · ${nt.interval_min}분마다${nt.only_garrison ? " · 주둔지에서만" : ""} · ${nt.active ? "켜짐" : "지금은 쉬는 중(작전지)"}` : "주소가 설정되지 않음(runtime.json 의 weather.url)"} — 마지막: ${nt.t ? esc(nt.t) + " " : ""}<span class="${nt.ok === false ? "warnc" : ""}">${esc(nt.msg || "")}</span>`;
    const L = d.last || {}, s = L.stats || {}, k = L.kwh || {};
    $("#wxCmp").innerHTML = !L.on ? `<p class="sub">${esc(L.why || (d.enabled ? "예측을 계산하면 표시됩니다" : "날씨 반영이 꺼져 있습니다(runtime.json 의 weather.enabled)"))}</p>` : `<div class="kv">
        <span class="k">앞으로 24시간 태양광(예상)</span><span class="v">AI 만 ${n(k.ai)} · 날씨 기반 ${n(k.wx)} · <b>반영 ${n(k.final)}</b> kWh</span>
        <span class="k">날씨 기록이 덮는 구간</span><span class="v">${Math.round((L.cover || 0) / 4)}시간 / 24시간</span>
        <span class="k" title="최종 = (1 − 비율) × AI + 비율 × 날씨 기반. 선행시간마다 따로 정한다 — 가까운 시간은 AI, 먼 시간은 날씨 정보가 유리할 수 있다">날씨 반영 비율(선행시간별)</span><span class="v">${Object.entries(L.w_by || {}).map(([h, x]) => `<span title="비교 ${x[1].n}건${x[1].n ? " · AI " + x[1].ai + " / 날씨 " + x[1].wx + " kW" : ""}">${h / 4}시간 <b>${Math.round(x[0] * 100)}%</b></span>`).join(" · ")} <span class="sub">${s.n >= 8 ? "실측과 견준 오차로 정함" : `비교 ${s.n || 0}건 — 쌓이기 전 기본 ${Math.round(d.w0 * 100)}%`} · 한도 ${Math.round(d.w_max * 100)}%</span></span>
        <span class="k" title="넣은 날씨 표기가 실제로 맑은 하늘의 몇 배 발전으로 이어졌는지 — 실측이 쌓이면 환산값을 이 현장의 값으로 고쳐 쓴다">날씨 표기별 실측(배운 값)</span><span class="v">${(L.learned || []).length ? L.learned.map(x => `${esc(x.sky)} <b>${x.seen}</b><span class="sub">(표 ${x.table ?? "—"} · ${x.n}건)</span>`).join(" · ") : '<span class="sub">아직 없음 — 낮 시간 실측이 쌓이면 표시</span>'}</span>
        <span class="k" title="1 · 3 · 6 · 12시간 앞 예측을 낮 시간 실측과 견준 평균 절대 오차">견준 오차(kW)</span><span class="v">${s.n ? `AI ${s.ai} · 날씨 기반 ${s.wx} · 반영 ${s.final} <span class="sub">(${s.n}건 · ${s.wx < s.ai ? "날씨 입력이 더 정확" : "AI 가 더 정확"})</span>` : `아직 없음 <span class="sub">— 실측을 기다리는 예측 ${L.waiting || 0}건</span>`}</span>
        <span class="k" title="맑은 날 이 설비가 맑은 하늘 계산값의 몇 배를 내는지(최근 14일)">설비 보정</span><span class="v">${n(L.cal)}</span></div>
      ${d.recent.length ? `<div class="scroll arc-table" style="max-height:130px;margin-top:8px"><table class="t"><thead><tr><th>시각</th><th class="n">앞</th><th class="n">AI</th><th class="n">날씨</th><th class="n">반영</th><th class="n">실측 kW</th></tr></thead><tbody>${d.recent.map(x => `<tr><td class="mono">${esc(x[0].slice(5))}</td><td class="n">${x[1] / 4}h</td><td class="n">${x[2]}</td><td class="n">${x[3]}</td><td class="n">${x[4]}</td><td class="n"><b>${x[5]}</b></td></tr>`).join("")}</tbody></table></div>` : ""}`;
  },
};
