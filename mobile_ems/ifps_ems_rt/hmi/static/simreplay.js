/* 가상 자료 가져오기 · 재생(디버그 → 가상 장치 탭). CSV 를 골라 가상 장치에 시간 순서대로 넣는다. 서버: hmi/simreplay.py */
const SimReplay = {
  SAMPLE: "t,LOAD.p1_kw,LOAD.p2_kw,LOAD.p3_kw,PV.kw,ENV.temp\n0,28,30,15,40,18\n60,28,34,18,55,19\n120,29,38,22,70,20\n180,28,36,20,20,20\n240,28,30,15,5,19\n",
  mount(act) {
    const box = $("#engBody"); if (!box || $("#rpBox")) return; this.act = act;
    box.insertAdjacentHTML("beforeend", `<div class="panel" id="rpBox" style="margin-top:18px"><div class="hd"><h3>가상 자료 가져오기 · 재생</h3><div class="spacer"></div><span class="sub">현장에서 잰 값이나 만들어 둔 상황(CSV)을 가상 장치에 시간 순서대로 넣는다</span></div>
      <div class="bd"><div class="form"><label>CSV 파일<input class="in" id="rpFile" type="file" accept=".csv,text/csv"></label>
        <label>배속<select class="in" id="rpSpeed"><option value="1">1배(실시간)</option><option value="10">10배</option><option value="60" selected>60배(1분 → 1초)</option><option value="600">600배</option></select></label>
        <label style="flex-direction:row;gap:6px;align-items:center;text-transform:none"><input type="checkbox" id="rpLoop">끝나면 처음부터</label>
        <button class="btn eng" id="rpGo">재생 시작</button><button class="btn" id="rpStop">멈춤(값 유지 해제)</button><button class="btn" id="rpSample">양식 받기</button></div>
        <div id="rpState" class="muted" style="margin-top:10px"></div>
        <div class="muted" style="margin-top:8px;font-size:12px">형식: 첫 열 t(초) 또는 시각(2026-05-01 13:00), 나머지 열은 신호 이름(LOAD.p1_kw · PV.kw · ESS.soc · ENV.temp …). TPCS 의 운전 이력(history.csv)도 그대로 넣을 수 있다. 한 번에 5,000줄 · 120KB 까지. 상태 · 지령 신호는 넣을 수 없다(가상 장치가 스스로 만든다).</div></div></div>`);
    $("#rpGo").onclick = () => { const f = $("#rpFile").files[0]; if (!f) return toast("CSV 파일을 고르십시오", "bad"); if (f.size > 120 * 1024) return toast("파일이 120KB 를 넘습니다 — 나누어 넣으십시오", "bad");
      const rd = new FileReader(); rd.onload = async () => { await act({ action: "replay", op: "start", text: String(rd.result), name: f.name, speed: +$("#rpSpeed").value, loop: $("#rpLoop").checked }); this.update(); }; rd.readAsText(f, "utf-8"); };
    $("#rpStop").onclick = async () => { await act({ action: "replay", op: "stop" }); this.update(); };
    $("#rpSample").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + this.SAMPLE], { type: "text/csv" })); a.download = "가상자료_양식.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
    this.update();
  },
  update() {
    const el = $("#rpState"); if (!el) return; const r = ((S.snap || {}).sim_state || {}).replay || { on: false };
    if (!r.on) { el.textContent = "재생 중인 자료 없음 — 가상 장치가 스스로 부하 · 태양광 값을 만든다."; return; }
    const mm = s => s >= 3600 ? (s / 3600).toFixed(1) + "시간" : s >= 60 ? Math.round(s / 60) + "분" : Math.round(s) + "초";
    el.innerHTML = `<b>${esc(r.name || "자료")}</b> — ${r.done ? "끝(마지막 값 유지 중)" : "재생 중"} · ${r.at}/${r.rows}줄 · 자료 길이 ${mm(r.span_s)} · ${r.speed}배${r.loop ? " · 되풀이" : ""} · 신호 ${r.tags.map(esc).join(", ")}${(r.skipped || []).length ? ` · 건너뛴 열 ${r.skipped.map(esc).join(", ")}` : ""}`;
  },
};
