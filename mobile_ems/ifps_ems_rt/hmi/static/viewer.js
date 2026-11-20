"use strict";
/* 기록 조회기 시작: EMS 화면 없이 archive.js 만 띄운다(읽기 전용). */
ARC.standalone = true; ARC.mount(document.getElementById("main"));
fetch("/api/archive/info").then(r => r.json()).then(i => { document.getElementById("vwFile").textContent = i.file ? "— " + i.file : ""; });
