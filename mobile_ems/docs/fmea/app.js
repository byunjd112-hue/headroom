const LS_KEY = "ifps-ems-fmea-fta-state-v1";
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = n => Number(n).toLocaleString("ko-KR");
const pct = (n, d=1) => (n*100).toFixed(d) + "%";
const sci = n => n === 0 ? "0" : Number(n).toExponential(1).replace("e-", "E-").replace("e+", "E+");

/* ───────────── state */
let state = { ov:{}, act:{}, params:{...DATA.params}, sel:"본체", updatedAt:null, note:"" };
let shared = null, dbDoc = null, downloadsCap = null, userCap = null, canWrite = true, dirty = false, saveTimer = null;
function loadLocal(){ try{ const s = localStorage.getItem(LS_KEY); if(s){ const o = JSON.parse(s); state = {...state, ...o, params:{...state.params, ...(o.params||{})}}; } }catch(e){} }
function saveLocal(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }catch(e){} }
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),2400); }

/* ───────────── model */
function row(f){
  const o = state.ov[f.id] || {};
  const r = {...f, ...o};
  for (const k of ["S","O","D","S2","O2","D2"]) r[k] = Number(r[k]);
  r.RPN = r.S*r.O*r.D; r.RPN2 = r.S2*r.O2*r.D2;
  r.grade = r.RPN>=100?"고":r.RPN>=60?"중":"저"; r.grade2 = r.RPN2>=100?"고":r.RPN2>=60?"중":"저";
  r.action = r.S>=9?"필수조치":r.RPN>=100?"중점관리":"일반관리";
  r.red = r.RPN? 1-r.RPN2/r.RPN : 0; r.changed = !!state.ov[f.id];
  return r;
}
function rows(){ return DATA.fmea.map(row); }
function stats(rs){
  const org = rs.filter(r=>r.grp==="본체"), sup = rs.filter(r=>r.grp!=="본체");
  const sum = a=>a.reduce((x,y)=>x+y,0);
  const s = {
    n:rs.length, nOrg:org.length, nSup:sup.length,
    rpn:sum(org.map(r=>r.RPN)), rpn2:sum(org.map(r=>r.RPN2)), max:Math.max(...org.map(r=>r.RPN)), max2:Math.max(...org.map(r=>r.RPN2)),
    hi:org.filter(r=>r.grade==="고").length, mid:org.filter(r=>r.grade==="중").length, lo:org.filter(r=>r.grade==="저").length,
    hi2:org.filter(r=>r.grade2==="고").length, mid2:org.filter(r=>r.grade2==="중").length, lo2:org.filter(r=>r.grade2==="저").length,
    must:org.filter(r=>r.action==="필수조치").length,
    supRpn:sum(sup.map(r=>r.RPN)), supRpn2:sum(sup.map(r=>r.RPN2)), supHi:sup.filter(r=>r.grade==="고").length, supMust:sup.filter(r=>r.action==="필수조치").length,
    allRpn:sum(rs.map(r=>r.RPN)), allRpn2:sum(rs.map(r=>r.RPN2)),
  };
  s.avg = s.rpn/s.nOrg; s.avg2 = s.rpn2/s.nOrg; s.red = 1-s.rpn2/s.rpn; s.supRed = s.supRpn? 1-s.supRpn2/s.supRpn:0;
  return s;
}
function fta(rs){
  const P = state.params, byId = Object.fromEntries(rs.map(r=>[r.id,r]));
  const lam = o => DATA.oscale[o-1][2], tau = d => DATA.oscale[d-1][4];
  const q = (l,t) => 1-Math.exp(-l*(t/2+P.tm)/P.hours);
  const be = DATA.be.map(b=>{
    const x = {...b};
    if (b.type==="조건"){ x.q0 = P.he0; x.q1 = P.he1; x.O=x.D=x.O2=x.D2=null; }
    else {
      const f = byId[b.fm]; x.O=f.O; x.D=f.D; x.O2=f.O2; x.D2=f.D2;
      x.lam0=lam(f.O); x.tau0=tau(f.D); x.lam1=lam(f.O2); x.tau1=tau(f.D2);
      x.q0 = q(x.lam0,x.tau0); x.q1 = q(x.lam1,x.tau1);
      if (b.type==="CCF"){ x.q0*=P.beta; x.q1*=P.beta; }
      else if ((b.note||"").includes("1−β")){ x.q0*=(1-P.beta); x.q1*=(1-P.beta); }
    }
    x.red = x.q0? 1-x.q1/x.q0:0; return x;
  });
  const beMap = Object.fromEntries(be.map(b=>[b.id,b]));
  const gates = {}; DATA.gates.forEach(g=>gates[g.id]={...g, in:g.inputs.split(",").map(s=>s.trim())});
  const val = (id,k) => beMap[id] ? beMap[id][k] : evalGate(id,k);
  function evalGate(id,k){ const g=gates[id]; if (g["_"+k]!==undefined) return g["_"+k];
    const qs = g.in.map(i=>val(i,k)); const v = g.logic==="AND" ? qs.reduce((a,b)=>a*b,1) : 1-qs.reduce((a,b)=>a*(1-b),1); g["_"+k]=v; return v; }
  const glist = DATA.gates.map(g=>{ const x=gates[g.id]; x.q0=evalGate(g.id,"q0"); x.q1=evalGate(g.id,"q1"); x.red=x.q0?1-x.q1/x.q0:0; return x; });
  const top = gates["TOP"];
  const cs = id => { if (beMap[id]) return [[id]]; const g=gates[id]; const parts=g.in.map(cs);
    if (g.logic!=="AND") return parts.flat();
    return parts.reduce((acc,p)=>acc.flatMap(x=>p.map(y=>[...new Set([...x,...y])])), [[]]); };
  let raw=[]; top.in.forEach(br=>cs(br).forEach(ids=>raw.push({ids:[...ids].sort(), gate:br})));
  raw = raw.filter((m,i)=>!raw.some((o,j)=>j!==i && o.ids.every(x=>m.ids.includes(x)) && (o.ids.length<m.ids.length || j<i)));
  const mcs = raw.map((m,i)=>({id:"MCS-"+String(i+1).padStart(2,"0"), order:m.ids.length, ids:m.ids, gate:m.gate, desc:m.ids.map(x=>beMap[x].fm+" "+beMap[x].desc).join(" ∧ "), p0:m.ids.reduce((a,x)=>a*beMap[x].q0,1), p1:m.ids.reduce((a,x)=>a*beMap[x].q1,1)}));
  const sum0 = mcs.reduce((a,m)=>a+m.p0,0), sum1 = mcs.reduce((a,m)=>a+m.p1,0);
  mcs.forEach(m=>{ m.share=m.p0/sum0; m.red=m.p0?1-m.p1/m.p0:0; });
  const ranked=[...mcs].sort((a,b)=>b.p0-a.p0); mcs.forEach(m=>m.rank=ranked.indexOf(m)+1);
  const imp = be.map(b=>{
    const in0 = mcs.filter(m=>m.ids.includes(b.id));
    const fv0 = in0.reduce((a,m)=>a+m.p0,0)/sum0, fv1 = in0.reduce((a,m)=>a+m.p1,0)/sum1;
    const single = in0.some(m=>m.order===1);
    const birn = b.q0? fv0*sum0/b.q0 : 0, raw = b.q0? (sum0-fv0*sum0+fv0*sum0/b.q0)/sum0 : 0, rrw = fv0>=1?Infinity:1/(1-fv0);
    const dP = fv0*sum0 - fv1*sum1;
    return {...b, fv0, fv1, single, birn, raw, rrw, dP};
  });
  const r2=[...imp].sort((a,b)=>b.fv0-a.fv0); imp.forEach(b=>{ b.rank=r2.indexOf(b)+1; b.mgmt = b.rank<=5?"최우선 관리":b.fv0>=0.03?"중점 관리":"일반 관리"; });
  const dPsum = imp.reduce((a,b)=>a+Math.max(b.dP,0),0); imp.forEach(b=>b.dPshare = dPsum? Math.max(b.dP,0)/dPsum:0);
  return { be, beMap, gates, glist, top, mcs, sum0, sum1, imp, top0:top.q0, top1:top.q1, single:mcs.filter(m=>m.order===1).length, dual:mcs.filter(m=>m.order>=2).length, approxErr: sum0/top.q0-1 };
}
function integrity(rs, F, st){
  const c=[];
  const bad = rs.filter(r=>["S","O","D","S2","O2","D2"].some(k=>!(r[k]>=1&&r[k]<=10&&Number.isInteger(r[k])))).length;
  c.push(["S·O·D 입력범위 (1~10 정수)", bad===0, `범위 밖 ${bad}건`]);
  c.push(["고장모드 번호 중복 없음", new Set(rs.map(r=>r.id)).size===rs.length, "중복 0"]);
  c.push(["심각도 불변 원칙 (S'=S)", rs.every(r=>r.S===r.S2), `S'≠S ${rs.filter(r=>r.S!==r.S2).length}건`]);
  c.push(["개선 후 발생도 비증가 (O'≤O)", rs.every(r=>r.O2<=r.O), `O'>O ${rs.filter(r=>r.O2>r.O).length}건`]);
  c.push(["개선 후 검출도 비증가 (D'≤D)", rs.every(r=>r.D2<=r.D), `D'>D ${rs.filter(r=>r.D2>r.D).length}건`]);
  const miss = DATA.be.filter(b=>b.type!=="조건" && !rs.find(r=>r.id===b.fm)).length;
  c.push(["FTA 기본사상 → FMEA 참조 유효", miss===0, `미매칭 ${miss}건 (인적 오류 사상 제외)`]);
  c.push(["기본사상 확률 범위 (0≤q≤1)", F.be.every(b=>b.q0>=0&&b.q0<=1&&b.q1>=0&&b.q1<=1), "범위 밖 0"]);
  c.push(["희귀사상 근사오차 ΣP(MCS)/P(TOP)−1 < 15%", F.approxErr<0.15, pct(F.approxErr)]);
  c.push(["개선 후 정점확률 감소", F.top1<F.top0, `${sci(F.top0)} → ${sci(F.top1)}`]);
  c.push(["단일고장점 판정 정합 (FV '예' = 1차 MCS 수)", F.imp.filter(b=>b.single).length===F.single, `${F.imp.filter(b=>b.single).length} / ${F.single}`]);
  c.push(["FV 합계 ≥ 100% (MCS 중첩)", F.imp.reduce((a,b)=>a+b.fv0,0)>=0.9999, pct(F.imp.reduce((a,b)=>a+b.fv0,0))]);
  c.push(["고장모드 수 = EMS 본체 "+DATA.meta.nOrg+" + 연동 "+DATA.meta.nSup, st.nOrg===DATA.meta.nOrg && st.nSup===DATA.meta.nSup, `${st.nOrg} + ${st.nSup}`]);
  c.push(["개선 후 전건 관리기준(<60) 진입", rs.every(r=>r.RPN2<60), `${rs.filter(r=>r.RPN2<60).length}/${rs.length}건`]);
  c.push(["보완설계 반영표 FM 참조 유효", DATA.b_design.every(d=>rs.find(r=>r.id===d[0])), "미매칭 "+DATA.b_design.filter(d=>!rs.find(r=>r.id===d[0])).length]);
  const hiNo = rs.filter(r=>(r.grade==="고"||r.action==="필수조치") && !DATA.b_design.find(d=>d[0]===r.id)).map(r=>r.id);
  c.push(["고위험·필수조치 전건이 보완설계 반영표에 있음", hiNo.length===0, hiNo.length? "누락 "+hiNo.join(", ") : "누락 0"]);
  const ftaBad = rs.filter(r=>{ const ids=F.be.filter(b=>b.fm===r.id).map(b=>b.id).join("·").replace(/·BE-/g,"·"); return (ids||"—")!==r.fta; }).map(r=>r.id);
  c.push(["FMEA 'FTA 사상' 열 = 기본사상 표 역참조", ftaBad.length===0, ftaBad.length? "불일치 "+ftaBad.join(", ") : "불일치 0"]);
  const used = new Set(DATA.gates.flatMap(g=>g.inputs.split(",").map(x=>x.trim())));
  c.push(["기본사상·게이트 전건이 수목에 연결", DATA.be.every(b=>used.has(b.id)) && DATA.gates.every(g=>g.id==="TOP"||used.has(g.id)), "미연결 "+(DATA.be.filter(b=>!used.has(b.id)).length+DATA.gates.filter(g=>g.id!=="TOP"&&!used.has(g.id)).length)]);
  return c;
}
function compute(){ const rs=rows(); const st=stats(rs); const F=fta(rs); const chk=integrity(rs,F,st); return {rs,st,F,chk,ok:chk.every(c=>c[1])}; }

/* ───────────── rendering helpers */
let charts=[];
function killCharts(){ charts.forEach(c=>c.destroy()); charts=[]; }
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function mkChart(id, cfg){ const el=$("#"+id); if(!el||!window.Chart) return; const ink=cssVar("--ink2"), line=cssVar("--line");
  Chart.defaults.color=ink; Chart.defaults.borderColor=line; Chart.defaults.font.family=getComputedStyle(document.body).fontFamily; Chart.defaults.font.size=15;
  charts.push(new Chart(el, cfg)); }
function gradeB(g){ return `<span class="badge b-${g}">${g}</span>`; }
function setMain(h){ killCharts(); $("#main").innerHTML=h; }
function rpnCls(v){ return v>=100?"rpn-hi":v>=60?"rpn-mid":"rpn-lo"; }
function head(title, sub, extra=""){ const M=compute(); return `<div class="topbar"><div><h1>${title}</h1><div class="sub">${sub}</div></div><div class="actions"><span class="pill dot ${M.ok?"ok":"bad"}">무결성 ${M.ok?"정상":"점검 필요"} · OK ${M.chk.filter(c=>c[1]).length}/${M.chk.length}</span><span class="pill" id="savepill">${dirty?"변경사항 있음":"저장됨"}</span>${extra}</div></div>`; }

/* ───────────── views */
function vDashboard(){
  const M=compute(), st=M.st, F=M.F;
  const pareto = M.rs.filter(r=>state.sel==="전체"||r.grp==="본체").sort((a,b)=>b.RPN-a.RPN);
  const ss = ["ES-01","ES-02","ES-03","ES-04","ES-05","ES-06","ES-07","ES-08","ES-09","IF"].map(c=>{ const g=M.rs.filter(r=>r.code===c); return {c, n:g.length, a:g.reduce((x,r)=>x+r.RPN,0), b:g.reduce((x,r)=>x+r.RPN2,0)}; });
  const top3 = F.glist.filter(g=>["G1","G2","G3","G4","G5"].includes(g.id)).sort((a,b)=>b.q0-a.q0);
  const fvTop = [...F.imp].sort((a,b)=>b.fv0-a.fv0).slice(0,10);
  setMain(head("대시보드", "IFPS 이동형 전력체계 EMS 소프트웨어 FMEA(IEC 60812)·FTA(IEC 61025) 통합 분석 · "+DATA.meta.rev+" 기준 · 전 지표 실시간 재계산") + `
  <div class="grid kpis" style="margin-bottom:12px">
    <div class="kpi"><div class="l">고장모드</div><div class="v">${st.n}건</div><div class="d">EMS 본체 ${st.nOrg} + 연동 장치측(제안) ${st.nSup}</div></div>
    <div class="kpi"><div class="l">개선 전 RPN 합 (본체)</div><div class="v">${fmt(st.rpn)}</div><div class="d">평균 ${st.avg.toFixed(1)} · 최대 ${st.max}</div></div>
    <div class="kpi good"><div class="l">개선 후 RPN 합 (본체)</div><div class="v">${fmt(st.rpn2)}</div><div class="d">평균 ${st.avg2.toFixed(1)} · 최대 ${st.max2}</div></div>
    <div class="kpi good"><div class="l">RPN 저감률</div><div class="v">${pct(st.red)}</div><div class="d">전체 ${st.n}건 기준 ${pct(1-st.allRpn2/st.allRpn)}</div></div>
    <div class="kpi sm ${st.hi2?"crit":"good"}"><div class="l">고위험 (RPN≥100) 전→후</div><div class="v">${st.hi} → ${st.hi2}</div><div class="d">중 ${st.mid}→${st.mid2} · 저 ${st.lo}→${st.lo2}</div></div>
    <div class="kpi crit"><div class="l">필수조치 (S≥9)</div><div class="v">${st.must}건</div><div class="d">연동 장치측 ${st.supMust}건 별도</div></div>
    <div class="kpi good sm"><div class="l">FTA q(TOP) 72h 전→후</div><div class="v">${pct(F.top0)}→${pct(F.top1)}</div><div class="d">저감 ${pct(1-F.top1/F.top0)} · MCS ${F.mcs.length}개</div></div>
    <div class="kpi crit"><div class="l">단일고장점 (1차 MCS)</div><div class="v">${F.single}개</div><div class="d">2차 이상 MCS ${F.dual}개 (중복·운용자 방호)</div></div>
  </div>
  <div class="grid row2">
    <div class="card" style="grid-column:1/-1"><h2>RPN 파레토 (개선 전·후, 내림차순)</h2><div class="hint">대상: <select id="selPareto"><option ${state.sel==="본체"?"selected":""}>본체</option><option ${state.sel==="전체"?"selected":""}>전체</option></select> · 막대 = 개선 전/후 RPN, 선 = 누적 구성비</div><div class="chart tall"><canvas id="cPareto"></canvas></div></div>
    <div class="card"><h2>서브시스템별 RPN 합</h2><div class="chart"><canvas id="cSS"></canvas></div></div>
    <div class="card"><h2>위험등급 분포 (본체 ${st.nOrg}건)</h2><div class="chart"><canvas id="cGrade"></canvas></div></div>
    <div class="card"><h2>FTA 중간사상 발생확률 q (72시간 임무)</h2><div class="chart"><canvas id="cGate"></canvas></div></div>
    <div class="card"><h2>기본사상 중요도 FV 상위 10</h2><div class="chart"><canvas id="cFV"></canvas></div></div>
    <div class="card" style="grid-column:1/-1"><h2>핵심 결론 (수치 자동 생성)</h2><ol class="list">
      <li>EMS 본체 ${st.nOrg}건: RPN 합 ${fmt(st.rpn)} → ${fmt(st.rpn2)} (저감률 ${pct(st.red)}), 고위험 ${st.hi}건 → ${st.hi2}건, 필수조치(S≥9) ${st.must}건${st.hi2?` <span class="rpn-hi">(개선 후 고위험 ${st.hi2}건 잔존 — 보완설계 재검토)</span>`:""}. '개선 전'은 ${DATA.meta.rev} 소프트웨어의 현 설계 상태, '개선 후'는 권고 조치가 구현·검증된 뒤의 목표값이다.</li>
      <li>RPN 상위 5건: ${[...M.rs].sort((a,b)=>b.RPN-a.RPN).slice(0,5).map(r=>r.id+" "+r.mode+" ("+r.RPN+")").join(" > ")}.</li>
      <li>연동 장치측 ${st.nSup}건(제작사·체계통합 협의 대상): 고위험 ${st.supHi}건, 필수조치 ${st.supMust}건, RPN ${fmt(st.supRpn)} → ${fmt(st.supRpn2)}. EMS 소프트웨어만으로 낮출 수 없으며 장치별 안내서 회신과 실장비 시험이 전제다.</li>
      <li>FTA: 72시간 임무 중 정점사상 확률 ${pct(F.top0)} → ${pct(F.top1)}. 단일 고장점(1차 MCS) ${F.single}개. 중간사상 기여 ${top3.map(g=>g.id+" "+g.desc).join(" > ")}. FV 상위: ${fvTop.slice(0,3).map(b=>b.id+" "+b.fm+" "+b.desc).join(" > ")}.</li>
      <li>현 리비전은 가상 장치로만 검증했다. 발생도(O)는 설계 단계 추정값이고 확률은 상대 비교용이다. 실장비 연동시험(FAT)·현장 시운전(SAT) 결과로 다시 평가해야 한다.</li></ol></div>
  </div>`);
  $("#selPareto").onchange=e=>{ state.sel=e.target.value; markDirty(); vDashboard(); };
  const ac=cssVar("--accent"), g1=cssVar("--ink2"), cr=cssVar("--crit"), gd=cssVar("--good");
  mkChart("cPareto",{type:"bar",data:{labels:pareto.map(r=>r.id.replace("FM-","")),datasets:[{label:"개선 전 RPN",data:pareto.map(r=>r.RPN),backgroundColor:g1+"99",order:2},{label:"개선 후 RPN",data:pareto.map(r=>r.RPN2),backgroundColor:ac,order:2},{type:"line",label:"누적 구성비",data:(()=>{let t=pareto.reduce((a,r)=>a+r.RPN,0),c=0;return pareto.map(r=>{c+=r.RPN;return c/t*100;});})(),yAxisID:"y2",borderColor:cr,pointRadius:2,tension:.2,order:1}]},options:{maintainAspectRatio:false,scales:{y:{title:{display:true,text:"RPN"},grid:{color:cssVar("--line")}},y2:{position:"right",min:0,max:100,grid:{display:false},ticks:{callback:v=>v+"%"}}},plugins:{legend:{position:"bottom"}}}});
  mkChart("cSS",{type:"bar",data:{labels:ss.map(s=>s.c),datasets:[{label:"개선 전",data:ss.map(s=>s.a),backgroundColor:g1+"99"},{label:"개선 후",data:ss.map(s=>s.b),backgroundColor:ac}]},options:{maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}}});
  mkChart("cGrade",{type:"bar",data:{labels:["고 (≥100)","중 (60~99)","저 (<60)","필수조치 S≥9"],datasets:[{label:"개선 전",data:[st.hi,st.mid,st.lo,st.must],backgroundColor:g1+"99"},{label:"개선 후",data:[st.hi2,st.mid2,st.lo2,st.must],backgroundColor:ac}]},options:{maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}}});
  const gl=F.glist.filter(g=>["G1","G2","G3","G4","G5"].includes(g.id));
  mkChart("cGate",{type:"bar",data:{labels:gl.map(g=>g.id+" "+g.desc.slice(0,10)),datasets:[{label:"개선 전",data:gl.map(g=>g.q0*100),backgroundColor:g1+"99"},{label:"개선 후",data:gl.map(g=>g.q1*100),backgroundColor:ac}]},options:{maintainAspectRatio:false,scales:{y:{ticks:{callback:v=>v+"%"}}},plugins:{legend:{position:"bottom"},tooltip:{callbacks:{label:c=>c.dataset.label+": "+c.parsed.y.toFixed(2)+"%"}}}}});
  mkChart("cFV",{type:"bar",data:{labels:fvTop.map(b=>b.id+" "+b.fm),datasets:[{label:"FV 개선 전",data:fvTop.map(b=>b.fv0*100),backgroundColor:g1+"99"},{label:"FV 개선 후",data:fvTop.map(b=>b.fv1*100),backgroundColor:ac}]},options:{indexAxis:"y",maintainAspectRatio:false,scales:{x:{ticks:{callback:v=>v+"%"}}},plugins:{legend:{position:"bottom"}}}});
}

function vFmea(){
  const M=compute();
  const q = (state._q||"").toLowerCase(), fg=state._fg||"", fss=state._fss||"";
  const list = M.rs.filter(r=>(!fg||r.grade===fg)&&(!fss||r.code===fss)&&(!q||[r.id,r.ss,r.comp,r.mode,r.cause,r.effect,r.rec].join(" ").toLowerCase().includes(q)));
  const codes=[...new Set(M.rs.map(r=>r.code))];
  setMain(head("FMEA 워크시트", `EMS 본체 ${M.st.nOrg}건 + 연동 장치측 ${M.st.nSup}건 · S·O·D·S'·O'·D' 편집 시 RPN·등급·조치구분·FTA·MCS 즉시 재계산 (등급: 고 ≥100 / 중 60~99 / 저 <60, S≥9 필수조치)`, `<button class="btn" id="btnReset">편집값 초기화</button>`) + `
  <div class="filters"><label>검색 <input type="text" id="fq" value="${esc(state._q||"")}" placeholder="번호·구성품·고장모드·원인…" style="width:220px"></label>
   <label>등급 <select id="fg"><option value="">전체</option>${["고","중","저"].map(g=>`<option ${fg===g?"selected":""}>${g}</option>`).join("")}</select></label>
   <label>서브시스템 <select id="fss"><option value="">전체</option>${codes.map(c=>`<option ${fss===c?"selected":""}>${c}</option>`).join("")}</select></label>
   <span class="small">${list.length}건 표시 · 노란 셀 = 입력값 · 행 번호 클릭 → 상세 편집</span></div>
  <div class="card"><div class="tbl-wrap"><table class="wide"><thead><tr><th>번호</th><th>구분</th><th>코드</th><th class="l">구성품</th><th class="l">고장모드</th><th class="l">최종영향</th><th>S</th><th>O</th><th>D</th><th>RPN</th><th>등급</th><th>조치구분</th><th class="l">권고 조치사항</th><th>담당</th><th>S'</th><th>O'</th><th>D'</th><th>RPN'</th><th>저감률</th><th>잔여</th><th>FTA</th></tr></thead><tbody>
  ${list.map(r=>`<tr data-id="${r.id}"><td><a href="#fmea" class="edit" data-id="${r.id}" style="font-weight:700">${r.id}</a>${r.changed?' <span class="pill" style="padding:0 5px;font-size:11pt">수정</span>':""}</td><td>${r.grp}</td><td>${r.code}</td><td class="l">${esc(r.comp)}</td><td class="l">${esc(r.mode)}</td><td class="l small">${esc(r.effect)}</td>
   ${["S","O","D"].map(k=>`<td><input class="sc ${state.ov[r.id]&&state.ov[r.id][k]!==undefined&&state.ov[r.id][k]!=DATA.fmea.find(f=>f.id===r.id)[k]?"changed":""}" type="number" min="1" max="10" data-id="${r.id}" data-k="${k}" value="${r[k]}" aria-label="${r.id} ${k}"></td>`).join("")}
   <td class="n ${rpnCls(r.RPN)}">${r.RPN}</td><td>${gradeB(r.grade)}</td><td><span class="badge b-${r.action}">${r.action}</span></td><td class="l small">${esc(r.rec)}</td><td class="small">${esc(r.owner)}</td>
   ${["S2","O2","D2"].map(k=>`<td><input class="sc ${state.ov[r.id]&&state.ov[r.id][k]!==undefined&&state.ov[r.id][k]!=DATA.fmea.find(f=>f.id===r.id)[k]?"changed":""}" type="number" min="1" max="10" data-id="${r.id}" data-k="${k}" value="${r[k]}" aria-label="${r.id} ${k}"></td>`).join("")}
   <td class="n ${r.RPN2>=60?"rpn-hi":r.RPN2>=50?"rpn-mid":"rpn-lo"}">${r.RPN2}</td><td class="n">${pct(r.red,0)}</td><td>${gradeB(r.grade2)}</td><td class="small">${esc(r.fta)}</td></tr>`).join("")}
  <tr class="sum"><td colspan="6" class="l">합계 / 평균 (표시 ${list.length}건)</td><td>${(list.reduce((a,r)=>a+r.S,0)/list.length||0).toFixed(1)}</td><td>${(list.reduce((a,r)=>a+r.O,0)/list.length||0).toFixed(1)}</td><td>${(list.reduce((a,r)=>a+r.D,0)/list.length||0).toFixed(1)}</td><td class="n">${fmt(list.reduce((a,r)=>a+r.RPN,0))}</td><td colspan="4"></td><td>${(list.reduce((a,r)=>a+r.S2,0)/list.length||0).toFixed(1)}</td><td>${(list.reduce((a,r)=>a+r.O2,0)/list.length||0).toFixed(1)}</td><td>${(list.reduce((a,r)=>a+r.D2,0)/list.length||0).toFixed(1)}</td><td class="n">${fmt(list.reduce((a,r)=>a+r.RPN2,0))}</td><td class="n">${pct(1-list.reduce((a,r)=>a+r.RPN2,0)/(list.reduce((a,r)=>a+r.RPN,0)||1),0)}</td><td colspan="2"></td></tr>
  </tbody></table></div>
  <p class="small">※ S'는 설계 고유값으로 S와 동일 유지 원칙(무결성 점검 4번). 개선 후 O'·D'는 권고 조치가 이행·검증된 경우의 목표치. 전 항목의 S·O·D는 작성자 제안값이며 발주처·제작사 협의 후 확정한다. '현 예방대책'은 ${DATA.meta.rev} 소프트웨어에 구현된 기능만 적었다(근거는 「정합성·무결성」의 근거 추적표).</p></div>`);
  $("#fq").oninput=e=>{state._q=e.target.value; clearTimeout(window._ft); window._ft=setTimeout(vFmea,250);};
  $("#fg").onchange=e=>{state._fg=e.target.value; vFmea();}; $("#fss").onchange=e=>{state._fss=e.target.value; vFmea();};
  $("#btnReset").onclick=()=>{ if(!Object.keys(state.ov).length){toast("편집값이 없습니다");return;} state.ov={}; markDirty(); vFmea(); toast("편집값을 기준 값으로 되돌렸습니다"); };
  document.querySelectorAll("input.sc").forEach(inp=>{ inp.onchange=e=>{ let v=Math.round(Number(e.target.value)); if(!(v>=1&&v<=10)){toast("1~10 정수만 입력");e.target.value=row(DATA.fmea.find(f=>f.id===e.target.dataset.id))[e.target.dataset.k];return;} setOv(e.target.dataset.id,e.target.dataset.k,v); vFmea(); }; });
  document.querySelectorAll("a.edit").forEach(a=>a.onclick=e=>{e.preventDefault(); openEditor(a.dataset.id);});
}
function setOv(id,k,v){ const base=DATA.fmea.find(f=>f.id===id); state.ov[id]=state.ov[id]||{}; if(String(base[k])===String(v)) delete state.ov[id][k]; else state.ov[id][k]=v; if(!Object.keys(state.ov[id]).length) delete state.ov[id]; markDirty(); }
function openEditor(id){
  const r=row(DATA.fmea.find(f=>f.id===id)); const d=$("#drawer"), p=$("#panel");
  p.innerHTML=`<h2>${r.id} · ${esc(r.comp)}</h2><div class="kv"><b>서브시스템</b><span>${esc(r.ss)} (${r.code})</span><b>고장모드</b><span>${esc(r.mode)}</span><b>고장원인</b><span>${esc(r.cause)}</span><b>최종영향</b><span>${esc(r.effect)}</span><b>현 예방대책</b><span>${esc(r.prev)}</span><b>현 검출수단</b><span>${esc(r.det)}</span><b>FTA 사상</b><span>${esc(r.fta)}</span></div><hr style="border:0;border-top:1px solid var(--line);margin:12px 0">
  <div class="sev">${["S","O","D"].map(k=>`<div class="field"><label>${k} (개선 전)</label><input class="sc" type="number" min="1" max="10" id="e_${k}" value="${r[k]}"></div>`).join("")}</div>
  <div class="sev">${["S2","O2","D2"].map(k=>`<div class="field"><label>${k.replace("2","'")} (개선 후)</label><input class="sc" type="number" min="1" max="10" id="e_${k}" value="${r[k]}"></div>`).join("")}</div>
  <div class="field"><label>권고 조치사항</label><textarea id="e_rec">${esc(r.rec)}</textarea></div>
  <div class="field"><label>검증 방법</label><textarea id="e_verify">${esc(r.verify)}</textarea></div>
  <div class="field"><label>담당</label><input type="text" id="e_owner" value="${esc(r.owner)}" style="width:100%"></div>
  <div class="actions"><button class="btn primary" id="e_save">적용</button><button class="btn" id="e_revert">기준 값으로</button><button class="btn" id="e_close">닫기</button></div>
  <p class="small">RPN ${r.RPN} (${r.grade}·${r.action}) → RPN' ${r.RPN2} (${r.grade2}) · 저감률 ${pct(r.red)}</p>`;
  d.classList.add("open");
  $("#e_close").onclick=()=>d.classList.remove("open");
  $("#e_revert").onclick=()=>{delete state.ov[id]; markDirty(); d.classList.remove("open"); route();};
  $("#e_save").onclick=()=>{ for(const k of ["S","O","D","S2","O2","D2"]){const v=Math.round(Number($("#e_"+k).value)); if(!(v>=1&&v<=10)){toast(k+"는 1~10 정수");return;} setOv(id,k,v);} for(const k of ["rec","verify","owner"]) setOv(id,k,$("#e_"+k).value.trim()); d.classList.remove("open"); route(); toast(id+" 적용됨"); };
  d.onclick=e=>{ if(e.target===d) d.classList.remove("open"); };
}

function vRpn(){
  const M=compute(), all=state.sel==="전체";
  const base=M.rs.filter(r=>all||r.grp==="본체");
  const pareto=[...base].sort((a,b)=>b.RPN-a.RPN); const tot=pareto.reduce((a,r)=>a+r.RPN,0); let cum=0;
  const ss=["ES-01","ES-02","ES-03","ES-04","ES-05","ES-06","ES-07","ES-08","ES-09","IF"].map(c=>{const g=M.rs.filter(r=>r.code===c);return {c,name:g[0]?g[0].ss:"",n:g.length,a:g.reduce((x,r)=>x+r.RPN,0),b:g.reduce((x,r)=>x+r.RPN2,0),hi:g.filter(r=>r.grade==="고").length,hi2:g.filter(r=>r.grade2==="고").length};});
  const mat=(pre)=>{ const m=[]; for(let s=10;s>=1;s--){ const rw=[]; for(let o=1;o<=10;o++) rw.push(base.filter(r=>(pre?r.S:r.S2)===s&&(pre?r.O:r.O2)===o).length); m.push(rw);} return m; };
  const matHtml=(m)=>`<div class="matrix"><div class="h">S＼O</div>${[1,2,3,4,5,6,7,8,9,10].map(o=>`<div class="h">${o}</div>`).join("")}${m.map((rw,i)=>{const s=10-i;return `<div class="h">${s}</div>`+rw.map((v,j)=>{const so=s*(j+1);const c=so>=48?4:so>=30?3:so>=18?2:so>=10?1:0;return `<div class="c${v?c:0}" title="S${s}×O${j+1}">${v||""}</div>`;}).join("");}).join("")}</div>`;
  setMain(head("RPN 분석 · 위험 매트릭스", "파레토(자동 정렬) · 서브시스템 집계 · 위험등급 분포 · S×O 매트릭스", `<label class="pill">대상 <select id="sel2"><option ${!all?"selected":""}>본체</option><option ${all?"selected":""}>전체</option></select></label>`) + `
  <div class="grid row2">
   <div class="card"><h2>4.1 위험도 우선순위 (파레토)</h2><div class="tbl-wrap"><table><thead><tr><th>순위</th><th>번호</th><th>코드</th><th class="l">고장모드</th><th>RPN</th><th>구성비</th><th>누적</th><th>RPN'</th><th>저감률</th><th>잔여</th></tr></thead><tbody>
   ${pareto.map((r,i)=>{cum+=r.RPN;return `<tr><td>${i+1}</td><td>${r.id}</td><td>${r.code}</td><td class="l">${esc(r.mode)}</td><td class="n ${rpnCls(r.RPN)}">${r.RPN}</td><td class="n">${pct(r.RPN/tot)}</td><td class="n">${pct(cum/tot)}</td><td class="n">${r.RPN2}</td><td class="n">${pct(r.red,0)}</td><td>${gradeB(r.grade2)}</td></tr>`;}).join("")}
   <tr class="sum"><td colspan="4" class="l">${pareto.length}개 고장모드 합계</td><td class="n">${fmt(tot)}</td><td>100%</td><td></td><td class="n">${fmt(pareto.reduce((a,r)=>a+r.RPN2,0))}</td><td class="n">${pct(1-pareto.reduce((a,r)=>a+r.RPN2,0)/tot)}</td><td></td></tr></tbody></table></div></div>
   <div>
    <div class="card"><h2>4.2 서브시스템별 집계</h2><div class="tbl-wrap"><table><thead><tr><th>코드</th><th class="l">서브시스템</th><th>건수</th><th>RPN 합</th><th>평균</th><th>고위험</th><th>RPN' 합</th><th>저감률</th><th>후 고위험</th></tr></thead><tbody>
    ${ss.map(s=>`<tr><td>${s.c}</td><td class="l">${esc(s.name)}</td><td>${s.n}</td><td class="n">${fmt(s.a)}</td><td class="n">${(s.a/s.n).toFixed(1)}</td><td class="n ${s.hi?"rpn-hi":""}">${s.hi}</td><td class="n">${fmt(s.b)}</td><td class="n ${1-s.b/s.a<0.55?"rpn-hi":"rpn-lo"}">${pct(1-s.b/s.a)}</td><td class="n ${s.hi2?"rpn-hi":""}">${s.hi2}</td></tr>`).join("")}
    <tr class="sum"><td colspan="2" class="l">계 (본체 ES-01~09)</td><td>${M.st.nOrg}</td><td class="n">${fmt(M.st.rpn)}</td><td class="n">${M.st.avg.toFixed(1)}</td><td class="n">${M.st.hi}</td><td class="n">${fmt(M.st.rpn2)}</td><td class="n">${pct(M.st.red)}</td><td>${M.st.hi2}</td></tr></tbody></table></div></div>
    <div class="card" style="margin-top:12px"><h2>4.3 위험등급 분포 (본체)</h2><div class="tbl-wrap"><table><thead><tr><th>등급</th><th>기준</th><th>개선 전</th><th>개선 후</th><th class="l">변화</th></tr></thead><tbody>
     <tr><td>${gradeB("고")}</td><td>RPN ≥ 100</td><td class="n">${M.st.hi}</td><td class="n">${M.st.hi2}</td><td class="l small">${M.st.hi2?`고위험 ${M.st.hi2}건 잔존 — 보완설계 재검토`:"전건 해소 — 보완설계 반영 완료"}</td></tr>
     <tr><td>${gradeB("중")}</td><td>60 ≤ RPN < 100</td><td class="n">${M.st.mid}</td><td class="n">${M.st.mid2}</td><td class="l small">${M.st.mid2?`중위험 ${M.st.mid2}건 잔존`:"전건 해소 — 운영·점검 대책 반영"}</td></tr>
     <tr><td>${gradeB("저")}</td><td>RPN < 60</td><td class="n">${M.st.lo}</td><td class="n">${M.st.lo2}</td><td class="l small">${M.st.lo2}건이 관리기준 이내</td></tr>
     <tr><td><span class="badge b-필수조치">필수조치</span></td><td>S ≥ 9</td><td class="n">${M.st.must}</td><td class="n">${M.st.must}</td><td class="l small">심각도는 설계 고유값 — O·D 개선으로 대응</td></tr></tbody></table></div></div>
   </div>
   <div class="card"><h2>S × O 매트릭스 — 개선 전 (${base.length}건)</h2>${matHtml(mat(true))}<p class="small">음영: S×O ≥48 / 30~47 / 18~29 / 10~17 · 빈칸 0건</p></div>
   <div class="card"><h2>S' × O' 매트릭스 — 개선 후</h2>${matHtml(mat(false))}<p class="small">개선 후 ${base.filter(r=>r.O2<=3).length}/${base.length}건이 O'≤3 열에 위치, 이 중 O'=2는 ${base.filter(r=>r.O2===2).length}건 — O'=2 가정의 타당성이 개선효과를 좌우하므로 실장비 시험과 운용 이력으로 재평가 필요.</p></div>
  </div>`);
  $("#sel2").onchange=e=>{state.sel=e.target.value; markDirty(); vRpn();};
}

function vFta(){
  const M=compute(), F=M.F, P=state.params;
  const treeLines = DATA.tree.map(t=>{ const g=F.gates[t.id]||F.beMap[t.id]; return `<tr><td class="l tree">${esc(t.lvl)}</td><td>${t.logic}</td><td class="l">${esc(t.desc)}</td><td>${esc(t.basis||"")}</td><td class="n">${sci(g.q0)}</td><td class="n rpn-lo">${sci(g.q1)}</td><td class="n">${pct(g.red,0)}</td><td class="l small">${esc(t.note||"")}</td></tr>`; });
  setMain(head("FTA 고장수목 (IEC 61025)", "정점사상: "+F.top.desc+" · q = 1−exp(−λ·(τ/2+t_m)/8760) · λ: O 환산 고장률, τ: D 환산 잠복기간") + `
  <div class="card"><h2>고장수목 도식 (게이트·사상 자동 배치, 확률 연동)</h2><div class="hint"><label><input type="checkbox" id="fitTree"> 전체 축소 보기</label> · 도형에 마우스를 올리면 사상 내용·확률 표시</div><div class="tbl-wrap" id="svgwrap"></div><p class="small">사각형 = 게이트/중간사상 · 타원 = 기본사상 · 팔각형 = CCF · 점선 = 조건사상(인적오류) · 숫자 = q 개선 전 → 후</p></div>
  <div class="grid row2" style="margin-top:12px">
   <div class="card"><h2>5.1 가정값 (변경 시 전체 재계산)</h2><div class="sev">
     <div class="field"><label>임무시간 t_m (h)</label><input type="number" id="p_tm" value="${P.tm}" step="1" min="1" style="width:90px"></div>
     <div class="field"><label>CCF β인자 (통신 경로 A·B)</label><input type="number" id="p_beta" value="${P.beta}" step="0.01" min="0" max="1" style="width:90px"></div>
     <div class="field"><label>인적 오류 HE-01·02 (전/후)</label><input type="number" id="p_he0" value="${P.he0}" step="0.01" min="0" max="1" style="width:70px"> <input type="number" id="p_he1" value="${P.he1}" step="0.01" min="0" max="1" style="width:70px"></div></div>
     <div class="actions"><button class="btn primary" id="p_apply">적용</button><button class="btn" id="p_reset">기본값</button></div>
     <h3>O → λ, D → τ 환산표</h3><div class="tbl-wrap"><table><thead><tr><th>점수</th><th class="l">발생도 O</th><th>λ (/년)</th><th class="l">검출도 D</th><th>τ (h)</th></tr></thead><tbody>${DATA.oscale.map(r=>`<tr><td>${r[0]}</td><td class="l">${esc(r[1])}</td><td class="n">${r[2]}</td><td class="l">${esc(r[3])}</td><td class="n">${r[4]}</td></tr>`).join("")}</tbody></table></div>
     <p class="small">※ 산출 확률은 FMEA 의 O·D 를 환산한 설계 단계 상대 비교용 추정치이며 신뢰도 보증값이 아니다. G1(오제어)은 하나만 일어나도 정점에 이른다고 보수적으로 가정했고, G4 는 임무 중 주둔지 운용·정전 구간이 있다고 가정했다. 인적 오류(HE-01·02)는 훈련 전/후 가정값이다.</p></div>
   <div class="card"><h2>5.3 게이트 연산 (OR: 1−Π(1−qᵢ), AND: Πqᵢ)</h2><div class="tbl-wrap"><table><thead><tr><th>게이트</th><th>논리</th><th class="l">내용</th><th class="l">입력</th><th>q 전</th><th>q 후</th><th>저감률</th><th>분류</th></tr></thead><tbody>
    ${F.glist.map(g=>`<tr ${g.id==="TOP"?'class="sum"':""}><td>${g.id}</td><td>${g.logic}</td><td class="l">${esc(g.desc)}</td><td class="l small">${esc(g.inputs)}</td><td class="n">${sci(g.q0)}</td><td class="n rpn-lo">${sci(g.q1)}</td><td class="n">${pct(g.red,0)}</td><td class="small">${esc(g.cls)}</td></tr>`).join("")}</tbody></table></div></div>
  </div>
  <div class="card" style="margin-top:12px"><h2>5.2 기본사상(Basic Event) 확률</h2><div class="tbl-wrap"><table class="wide"><thead><tr><th>ID</th><th>유형</th><th>근거 FM</th><th class="l">사상</th><th>게이트</th><th>O</th><th>D</th><th>λ</th><th>τ(h)</th><th>q 전</th><th>O'</th><th>D'</th><th>λ'</th><th>τ'(h)</th><th>q 후</th><th>저감률</th></tr></thead><tbody>
   ${F.be.map(b=>`<tr><td>${b.id}</td><td>${b.type}</td><td>${b.fm}</td><td class="l">${esc(b.desc)}</td><td>${b.gate}</td><td>${b.O??"—"}</td><td>${b.D??"—"}</td><td class="n">${b.lam0??"—"}</td><td class="n">${b.tau0??"—"}</td><td class="n">${sci(b.q0)}</td><td>${b.O2??"—"}</td><td>${b.D2??"—"}</td><td class="n">${b.lam1??"—"}</td><td class="n">${b.tau1??"—"}</td><td class="n rpn-lo">${sci(b.q1)}</td><td class="n">${pct(b.red,0)}</td></tr>`).join("")}</tbody></table></div></div>
  <div class="card" style="margin-top:12px"><h2>계층 구조 및 정성 분석</h2><div class="tbl-wrap"><table><thead><tr><th class="l">계층</th><th>논리</th><th class="l">사상</th><th>근거</th><th>q 전</th><th>q 후</th><th>저감</th><th class="l">판정 근거·가정</th></tr></thead><tbody>${treeLines.join("")}</tbody></table></div>
   <ol class="list" style="margin-top:10px">
    <li>1차 MCS ${F.single}개(단일 고장점)가 ΣP(MCS)의 ${pct(F.mcs.filter(m=>m.order===1).reduce((a,m)=>a+m.p0,0)/F.sum0)} 차지 — 중복으로 방호되지 않으므로 발생도(O)·검출도(D)를 낮추는 것이 유일한 수단이다.</li>
    <li>G1 오제어 q=${sci(F.gates["G1"].q0)} 대 G2 감시·제어 상실 q=${sci(F.gates["G2"].q0)} — EMS 가 멈추는 것보다 틀린 값·틀린 설정으로 잘못 제어하는 쪽이 약 ${Math.round(F.gates["G1"].q0/F.gates["G2"].q0)}배 위험하다. 자동 감시·제어 상실(G2.1) 자체는 q=${sci(F.gates["G2.1"].q0)}이나 수동 운전 전환(HE-01)이 방호한다.</li>
    <li>통신 이중화: 경로 A·B 독립 동시 고장(G2.3) q=${sci(F.gates["G2.3"].q0)}에 비해 공통 원인(BE-16) q=${sci(F.beMap["BE-16"].q0)} — 약 ${Math.round(F.beMap["BE-16"].q0/F.gates["G2.3"].q0).toLocaleString()}배. 스위치 전원·위치를 나누지 않으면 이중화 효과가 사라진다.</li>
    <li>G4(주둔지 정전 대응)의 BE-27(PCS 무순단 전환)은 EMS 로 막을 수 없는 장치측 사상으로 q=${sci(F.beMap["BE-27"].q0)} — PCS·STS 사양 확인과 실부하 전환 시험이 필요하다.</li>
    <li>G3 은 모두 2차 MCS(재지령·대체 전원·부하 자동 차단·지휘 결심이 방호)다. 방호 수단 쪽 사상(BE-19·22)의 정기 시험이 효과를 좌우한다.</li></ol></div>`);
  drawTree(F); $("#fitTree").onchange=e=>$("#svgwrap").classList.toggle("fit",e.target.checked);
  $("#p_apply").onclick=()=>{ const g=id=>Number($("#"+id).value); const tm=g("p_tm"),b=g("p_beta"),h0=g("p_he0"),h1=g("p_he1"); if(!(tm>0&&b>=0&&b<=1&&h0>=0&&h0<=1&&h1>=0&&h1<=1)){toast("입력 범위를 확인하세요");return;} state.params={...state.params,tm,beta:b,he0:h0,he1:h1}; markDirty(); vFta(); toast("가정값 적용"); };
  $("#p_reset").onclick=()=>{ state.params={...DATA.params}; markDirty(); vFta(); };
}
function drawTree(F){
  const kids = id => F.gates[id] ? F.gates[id].in : [];
  const W = id => { const k=kids(id); return k.length? k.reduce((a,c)=>a+W(c),0) : 1; };
  const bw=232, bh=76, gx=14, gy=122, nodes=[], links=[];
  function place(id, x0, depth){ const w=W(id)*(bw+gx); const cx=x0+w/2; nodes.push({id,x:cx,y:depth*gy+30}); let x=x0; kids(id).forEach(c=>{ const cw=W(c)*(bw+gx); links.push([cx,depth*gy+30+bh/2, x+cw/2, (depth+1)*gy+30-bh/2]); place(c,x,depth+1); x+=cw; }); }
  place("TOP",0,0);
  const totW=W("TOP")*(bw+gx), totH=(Math.max(...nodes.map(n=>n.y))+bh+20);
  const ink=cssVar("--ink"), line=cssVar("--line"), acc=cssVar("--accent"), surf=cssVar("--surface"), s2=cssVar("--surface2"), crit=cssVar("--crit");
  const sh = n => { const g=F.gates[n.id], b=F.beMap[n.id]; const x=n.x-bw/2,y=n.y-bh/2;
    const label = g ? `${n.id} [${g.logic}]` : `${n.id} (${b.fm})`;
    const desc = (g?g.desc:b.desc); const q0=g?g.q0:b.q0, q1=g?g.q1:b.q1;
    let shape;
    if (g) shape=`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4" fill="${n.id==="TOP"?ink:s2}" stroke="${ink}" stroke-width="${n.id==="TOP"?1.5:1}"/>`;
    else if (b.type==="CCF") shape=`<polygon points="${x+12},${y} ${x+bw-12},${y} ${x+bw},${y+12} ${x+bw},${y+bh-12} ${x+bw-12},${y+bh} ${x+12},${y+bh} ${x},${y+bh-12} ${x},${y+12}" fill="${surf}" stroke="${crit}" stroke-width="1.2"/>`;
    else if (b.type==="조건") shape=`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="23" fill="${surf}" stroke="${ink}" stroke-dasharray="4 3"/>`;
    else shape=`<ellipse cx="${n.x}" cy="${n.y}" rx="${bw/2}" ry="${bh/2}" fill="${surf}" stroke="${ink}"/>`;
    const tc = n.id==="TOP"?"#fff":ink;
    return `<g>${shape}<title>${esc(desc)}\nq ${sci(q0)} → ${sci(q1)}</title><text x="${n.x}" y="${n.y-15}" text-anchor="middle" font-size="15" font-weight="700" fill="${tc}">${esc(label)}</text><text x="${n.x}" y="${n.y+5}" text-anchor="middle" font-size="15" fill="${tc}">${esc(desc.length>14?desc.slice(0,13)+"…":desc)}</text><text x="${n.x}" y="${n.y+25}" text-anchor="middle" font-size="15" font-family="IBM Plex Mono,monospace" fill="${tc}">${sci(q0)} → ${sci(q1)}</text></g>`; };
  $("#svgwrap").innerHTML=`<svg width="${totW}" height="${totH}" viewBox="0 0 ${totW} ${totH}" role="img" aria-label="고장수목">${links.map(l=>`<path d="M${l[0]},${l[1]} V${(l[1]+l[3])/2} H${l[2]} V${l[3]}" fill="none" stroke="${line}" stroke-width="1.2"/>`).join("")}${nodes.map(sh).join("")}</svg>`;
}

function vMcs(){
  const M=compute(), F=M.F; const imp=[...F.imp].sort((a,b)=>b.fv0-a.fv0);
  setMain(head("최소절단집합(MCS) · 중요도", `MCS ${F.mcs.length}개 (1차 ${F.single} · 2차 이상 ${F.dual}) · 게이트 구조에서 자동 산출 · ΣP(MCS) ${sci(F.sum0)} vs P(TOP) ${sci(F.top0)} (근사오차 ${pct(F.approxErr)}) · FV = 해당 사상 포함 MCS 확률 합 / ΣP(MCS)`) + `
  <div class="grid row2">
   <div class="card"><h2>6.1 최소절단집합</h2><div class="tbl-wrap"><table><thead><tr><th>MCS</th><th>차수</th><th>사상</th><th class="l">내용</th><th>경로</th><th>P 전</th><th>P 후</th><th>구성비</th><th>순위</th><th>저감률</th></tr></thead><tbody>
    ${F.mcs.map(m=>`<tr><td>${m.id}</td><td>${m.order}</td><td class="small">${m.ids.join(" ∧ ")}</td><td class="l small">${esc(m.desc)}</td><td>${m.gate}</td><td class="n">${sci(m.p0)}</td><td class="n rpn-lo">${sci(m.p1)}</td><td class="n">${pct(m.share)}</td><td class="n">${m.rank}</td><td class="n">${pct(m.red,0)}</td></tr>`).join("")}
    <tr class="sum"><td colspan="5" class="l">ΣP(MCS)</td><td class="n">${sci(F.sum0)}</td><td class="n">${sci(F.sum1)}</td><td colspan="2"></td><td class="n">${pct(1-F.sum1/F.sum0,0)}</td></tr></tbody></table></div></div>
   <div class="card"><h2>6.2 기본사상 중요도 (Fussell-Vesely · Birnbaum · RAW · RRW)</h2><div class="tbl-wrap"><table><thead><tr><th>순위</th><th>ID</th><th>근거</th><th class="l">사상</th><th>FV 전</th><th>FV 후</th><th>단일고장점</th><th>관리 판단</th><th>Birnbaum</th><th>RAW</th><th>RRW</th><th>개선 기여</th></tr></thead><tbody>
    ${imp.map(b=>`<tr><td>${b.rank}</td><td>${b.id}</td><td>${b.fm}</td><td class="l small">${esc(b.desc)}</td><td class="n ${b.fv0>=0.03?"rpn-hi":""}">${pct(b.fv0)}</td><td class="n">${pct(b.fv1)}</td><td>${b.single?'<span class="badge b-고">예</span>':"아니오"}</td><td class="small">${b.mgmt}</td><td class="n">${b.birn.toFixed(3)}</td><td class="n">${b.raw.toFixed(1)}</td><td class="n">${b.rrw===Infinity?"∞":b.rrw.toFixed(3)}</td><td class="n">${pct(b.dPshare)}</td></tr>`).join("")}</tbody></table></div>
    <p class="small">※ Birnbaum = ∂P(TOP)/∂q · RAW = 사상 확정 발생 시 정점확률 배수 · RRW = 사상 완전 제거 시 저감 배수 · 개선 기여 = 개선 전후 해당 사상 경유 확률 감소분 구성비. HE-01 을 포함한 2차 MCS(EMS 정지·통신 상실)는 인적 오류 확률에 비례한다 — 수동 운전 전환 훈련이 EMS 플랫폼 고장 전체에 대한 효과적 방호 수단이다.</p></div>
  </div>`);
}

function tbl(hdr, rows, lefts=[]){ return `<div class="tbl-wrap"><table><thead><tr>${hdr.map((h,i)=>`<th class="${lefts.includes(i)?"l":""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td class="${lefts.includes(i)?"l":""} ${typeof c==="string"&&c.startsWith("__")?"":""}">${c==null?"":esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`; }
function vComm(){
  setMain(head("연동·CCF·일정 리스크", "근거: 실장치 통신 연동 방안서, 장치별 연동·디버깅 안내서 01~07, 대응표(pointmap.csv), 시험 결과 보고서 — 모두 "+DATA.meta.rev) + `
  <div class="card"><h2>7.1 통신 경로 고장 지점</h2>${tbl(["지점","구간","역무","주요 고장 메커니즘","관련 고장모드","근거"],DATA.s07_1,[1,3])}
   <p class="small">※ ③·⑤는 여러 장치가 함께 쓰는 지점 — 한 곳의 고장이 여러 장치의 동시 두절로 번진다(공통 원인).</p></div>
  <div class="card" style="margin-top:12px"><h2>7.2 통신 두절 시 EMS 거동과 2차 위험</h2>${tbl(["설비","운전 상태","두절 시 EMS 거동","복구 시","2차 위험","위험도","검증"],DATA.s07_2,[2,3,4])}<p class="small">${esc(DATA.s07_note)}</p></div>
  <div class="card" style="margin-top:12px"><h2>7.3 검출도(D') 전제의 감시 점 정합성</h2>${tbl(["FM","D' 전제 감시 항목","대응 태그 (pointmap.csv)","판정","조치","관련"],DATA.s07_3,[1,2,4])}<p class="small">※ '미확보·미구현' 항목은 해당 기능이 구현·검증되기 전까지 개선 후 D' 를 인정하지 않는다.</p></div>
  <div class="card" style="margin-top:12px"><h2>7.4 문서·설계 간 상충과 미결 사항</h2>${tbl(["No","한쪽 내용","다른 쪽 내용","조치 권고"],DATA.s07_4,[1,2,3])}</div>
  <div class="card" style="margin-top:12px"><h2>8.1 공통 원인 고장(CCF) 후보</h2>${tbl(["No","공통 원인","동시 영향 범위","관련 항목","FTA 반영","권고 검증"],DATA.s08_1,[1,2,5])}</div>
  <div class="card" style="margin-top:12px"><h2>${esc(DATA.s08_h2)}</h2>${tbl(["리스크","근거","목표","연계 고장모드 / 영향","대응","상태"],DATA.s08_2,[0,3,4])}</div>`);
}
function vDesign(){
  const M=compute(); const today=new Date();
  const acts=DATA.s10.map(a=>{ const o=state.act[a[0]]||{}; const status=o.status||a[6]; const note=o.note||a[7]||""; const late = status!=="완료" && new Date(a[5])<today; return {no:a[0],cat:a[1],txt:a[2],rel:a[3],owner:a[4],due:a[5],status,note,late}; });
  setMain(head("보완설계 반영 · 조치계획", "고위험·필수조치 항목의 보완설계 반영과 검증 계획 + 조치 우선순위·이행 관리 (상태 편집 가능)") + `
  <div class="card"><h2>14. 보완설계 반영 및 검증계획</h2>${tbl(["번호","보완설계 반영 내용","반영 대상 (소스·문서)","검증 방법","검증 시기","담당"],DATA.b_design.map(d=>[d[0],d[1],d[2],d[3],d[4],d[5]]),[1,2,3])}
   <p class="small">${esc(DATA.b_design_note)}</p>
   <h3>사후관리 연계</h3><ul class="list">${DATA.b_after.map(x=>`<li>${esc(x.replace(/^· /,""))}</li>`).join("")}</ul></div>
  <div class="card" style="margin-top:12px"><h2>16. 조치 우선순위 및 이행 관리</h2><div class="tbl-wrap"><table><thead><tr><th>No</th><th>구분</th><th class="l">조치 내용</th><th class="l">관련</th><th>담당</th><th>목표</th><th>상태</th><th class="l">비고</th></tr></thead><tbody>
   ${acts.map(a=>`<tr><td>${a.no}</td><td>${a.cat}</td><td class="l">${esc(a.txt)}</td><td class="l small">${esc(a.rel)}</td><td class="small">${esc(a.owner)}</td><td class="n">${a.due}</td><td><select data-no="${a.no}" class="actst">${["미착수","진행중","완료","보류"].map(s=>`<option ${a.status===s?"selected":""}>${s}</option>`).join("")}</select></td><td class="l small">${a.late?'<span class="rpn-hi">목표일 경과 — 상태 확인 필요</span><br>':""}<input type="text" class="actnote" data-no="${a.no}" value="${esc(a.note)}" placeholder="비고" style="width:100%;min-width:140px"></td></tr>`).join("")}</tbody></table></div>
   <p class="small">완료 ${acts.filter(a=>a.status==="완료").length} · 진행중 ${acts.filter(a=>a.status==="진행중").length} · 미착수 ${acts.filter(a=>a.status==="미착수").length} · 목표일 경과 ${acts.filter(a=>a.late).length}건</p></div>`);
  document.querySelectorAll(".actst").forEach(s=>s.onchange=e=>{ const no=e.target.dataset.no; state.act[no]={...(state.act[no]||{}),status:e.target.value}; markDirty(); vDesign(); });
  document.querySelectorAll(".actnote").forEach(s=>s.onchange=e=>{ const no=e.target.dataset.no; state.act[no]={...(state.act[no]||{}),note:e.target.value}; markDirty(); });
}
function vQa(){
  const M=compute();
  setMain(head("정합성 검토 · 무결성 점검", "현 예방대책의 근거 추적(소스·시험) "+DATA.s09.length+"건과 데이터 무결성 자동 점검 "+M.chk.length+"개 항목") + `
  <div class="grid row2">
   <div class="card"><h2>17. 데이터 무결성 자동 점검 — <span class="${M.ok?"rpn-lo":"rpn-hi"}">${M.ok?"정상":"점검 필요"}</span> (OK ${M.chk.filter(c=>c[1]).length} / NG ${M.chk.filter(c=>!c[1]).length})</h2><div class="tbl-wrap"><table><thead><tr><th>No</th><th class="l">점검 항목</th><th>판정</th><th class="l">상세값</th></tr></thead><tbody>${M.chk.map((c,i)=>`<tr><td>${i+1}</td><td class="l">${esc(c[0])}</td><td><span class="badge ${c[1]?"b-저":"b-고"}">${c[1]?"OK":"NG"}</span></td><td class="l n small">${esc(c[2])}</td></tr>`).join("")}</tbody></table></div></div>
   <div class="card"><h2>분석 개요 · 평가 기준 · 시스템 정의</h2>
    <div class="kv"><b>목적</b><span>EMS 소프트웨어의 잠재 고장모드를 찾아 위험도(RPN)로 우선순위를 정하고 보완설계·시험 계획에 반영</span><b>범위</b><span>EMS 소프트웨어와 그 실행 플랫폼(노트북·제어망), 장치와의 연동 인터페이스. 장치 자체(PCS·발전기·배터리 등)의 고장은 범위 밖이며 EMS 에 영향을 주는 인터페이스 사상만 '연동' 항목으로 다룸</span><b>기준</b><span>${esc(DATA.meta.rev)} 소프트웨어·문서 — 가상 장치 검증 상태</span><b>전제</b><span>보호 차단·계통 형성·순간 절체는 보호 IED·PCS·STS 가 EMS 와 독립으로 수행. EMS 는 1등급 부하를 차단하지 않음</span></div>
    <h3>1.4 분석 결과 요약 (자동)</h3><div class="kv"><b>고장모드</b><span>총 ${M.st.nOrg}건 (${["ES-01","ES-02","ES-03","ES-04","ES-05","ES-06","ES-07","ES-08","ES-09"].map(c=>c+" "+M.rs.filter(r=>r.code===c).length+"건").join(", ")}) + 연동 장치측 ${M.st.nSup}건(제안, 별도 집계)</span><b>개선 전</b><span>RPN 합계 ${fmt(M.st.rpn)}점 / 평균 ${M.st.avg.toFixed(1)}점 / 최댓값 ${M.st.max}점 — 고위험 ${M.st.hi}건, 중위험 ${M.st.mid}건, 저위험 ${M.st.lo}건, 필수조치 ${M.st.must}건</span><b>개선 후</b><span>RPN 합계 ${fmt(M.st.rpn2)}점 / 평균 ${M.st.avg2.toFixed(1)}점 / 최댓값 ${M.st.max2}점 — ${M.st.lo2}건 관리기준 이내 (${pct(M.st.red)} 저감)</span></div>
    <h3>2.1 평가 척도</h3>${tbl(["점수","심각도 S","발생도 O","검출도 D"],DATA.b_crit.slice(1,6),[1,2,3])}
    <p class="small">등급: 고 RPN ≥ 100 (보완설계 필수) · 중 60~99 (운영·점검 대책) · 저 < 60 · S ≥ 9 는 RPN 과 무관하게 필수조치</p>
    <h3>3.2 EMS 기능 블록 9종</h3>${tbl(["코드","기능 블록","주요 구성","규모","요구 기능"],DATA.b_sys2,[1,2,3,4])}
    <h3>약어 · 참고 기준</h3>${tbl(["약어","원어","뜻"],DATA.b_abbr,[1,2])}${tbl(["구분","기준·문서","내용"],DATA.b_ref,[1,2])}</div>
  </div>
  <div class="card" style="margin-top:12px"><h2>15. 현 예방대책 근거 추적 (소스 · 자동 시험)</h2>${tbl(["No","고장모드","현 예방대책","구현 위치","검증 시험 (tests/)","판정"],DATA.s09,[2,3,4,5])}<p class="small">※ 시험은 모두 가상 장치(Modbus TCP 모의 서버) 대상 자동 시험이다. 실장비에서의 유효성은 FAT·SAT 로 확인해야 한다.</p></div>`);
}
function vTools(){
  const M=compute();
  setMain(head("저장 · 내보내기 · 배포", "편집 상태 저장(이 브라우저 / 공유 저장소), Excel 내보내기, 설정 백업·복원, 링크 공유") + `
  <div class="grid row2">
   <div class="card"><h2>상태 저장</h2><div class="status-line" id="stline"></div>
    <p class="small">편집값(S·O·D, 권고·검증·담당, 조치 상태, FTA 가정값)은 입력 즉시 이 브라우저에 자동 저장됩니다. 공유 저장소가 연결된 경우(claude.ai에서 열람·권한 보유) 「공유 저장」으로 팀 전체에 동일 상태를 배포하고, 다른 사람의 변경은 자동으로 반영됩니다.</p>
    <div class="actions"><button class="btn primary" id="btnShare" ${shared?"":"disabled"}>공유 저장소에 저장</button><button class="btn" id="btnPull" ${shared?"":"disabled"}>공유 저장소에서 불러오기</button><button class="btn" id="btnClear">편집값 전체 초기화</button></div>
    <div class="field" style="margin-top:10px"><label>변경 메모 (공유 저장 시 함께 기록)</label><textarea id="note" placeholder="예) FAT 결과 반영 — FM-05 O' 재평가">${esc(state.note||"")}</textarea></div>
    <h3>백업 · 복원 (JSON)</h3><div class="actions"><button class="btn" id="btnJson">편집 상태 JSON 내보내기</button><label class="btn">JSON 불러오기 <input type="file" id="fileJson" accept="application/json" hidden></label><button class="btn" id="btnCopy">편집 상태 클립보드 복사</button></div></div>
   <div class="card"><h2>Excel 내보내기</h2>
    <p class="small">군 MG FMEA·FTA 통합분석서와 같은 시트 구성·순서(00 표지 ~ 18 약어·참고문헌, 19 변경 이력)로 EMS 분석 내용을 내보냅니다. 화면의 편집값이 반영되고 계산 열은 수식입니다. 편집하지 않았으면 기준값 그대로 나옵니다.</p>
    <div class="actions"><button class="btn primary" id="btnXlsx">Excel 워크북 생성</button><button class="btn" id="btnCsv">FMEA 워크시트 CSV</button></div>
    <p class="small" id="dlnote"></p>
    <h3>배포 · 공유</h3><p class="small">이 페이지의 주소(상단 공유 버튼 또는 브라우저 주소)를 전달하면 동일한 분석 도구를 열람·편집할 수 있습니다. 공유 저장소 권한(열람/기여/편집)은 아티팩트 공유 설정에서 관리합니다. 이 파일은 인터넷 없이도 열립니다(글꼴·도표·Excel 기능 내장).</p>
    <div class="actions"><button class="btn" id="btnLink">페이지 링크 복사</button></div></div>
   <div class="card" style="grid-column:1/-1"><h2>변경 이력 (현재 세션 편집값 요약)</h2>${changeLog(M)}</div>
  </div>`);
  renderStatusLine();
  $("#btnShare").onclick=()=>sharedSave(true); $("#btnPull").onclick=()=>sharedPull();
  $("#btnClear").onclick=()=>{ state.ov={}; state.act={}; state.params={...DATA.params}; markDirty(); vTools(); toast("편집값을 모두 초기화했습니다"); };
  $("#note").onchange=e=>{ state.note=e.target.value; markDirty(); };
  $("#btnJson").onclick=()=>saveFile("IFPS_EMS_FMEA_FTA_편집상태_"+stamp()+".json", JSON.stringify({...state, exportedAt:new Date().toISOString()},null,1));
  $("#fileJson").onchange=e=>{ const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const o=JSON.parse(rd.result); state={...state, ov:o.ov||{}, act:o.act||{}, params:{...DATA.params,...(o.params||{})}, sel:o.sel||"본체", note:o.note||""}; markDirty(); vTools(); toast("편집 상태를 불러왔습니다"); }catch(err){ toast("JSON 형식 오류"); } }; rd.readAsText(f); };
  $("#btnCopy").onclick=()=>copyText(JSON.stringify(state));
  $("#btnXlsx").onclick=()=>exportXlsx();
  $("#btnCsv").onclick=()=>{ const rs=compute().rs; const h=["번호","구분","코드","서브시스템","구성품","고장모드","고장원인","최종영향","S","O","D","RPN","등급","조치구분","권고 조치사항","담당","S'","O'","D'","RPN'","저감률","잔여등급","검증 방법","FTA 사상"]; const lines=[h].concat(rs.map(r=>[r.id,r.grp,r.code,r.ss,r.comp,r.mode,r.cause,r.effect,r.S,r.O,r.D,r.RPN,r.grade,r.action,r.rec,r.owner,r.S2,r.O2,r.D2,r.RPN2,(r.red*100).toFixed(1)+"%",r.grade2,r.verify,r.fta])); saveFile("FMEA_워크시트_"+stamp()+".csv", "﻿"+lines.map(l=>l.map(c=>'"'+String(c??"").replace(/"/g,'""')+'"').join(",")).join("\r\n")); };
  $("#btnLink").onclick=()=>copyText(location.href.split("#")[0]);
}
function changeLog(M){
  const items=[]; for(const [id,o] of Object.entries(state.ov)){ const b=DATA.fmea.find(f=>f.id===id); for(const [k,v] of Object.entries(o)) items.push([id,k,String(b[k]).slice(0,40),String(v).slice(0,40)]); }
  for(const [no,o] of Object.entries(state.act)){ const b=DATA.s10.find(a=>a[0]===no); if(o.status&&o.status!==b[6]) items.push(["조치 "+no,"상태",b[6],o.status]); if(o.note) items.push(["조치 "+no,"비고","",o.note.slice(0,40)]); }
  for(const k of ["tm","beta","he0","he1"]) if(state.params[k]!==DATA.params[k]) items.push(["FTA 가정값",k,DATA.params[k],state.params[k]]);
  if(!items.length) return '<p class="small">편집값 없음 — 기준값 그대로입니다.</p>';
  return tbl(["항목","필드","기준 값","편집 값"],items,[2,3]);
}
function stamp(){ const d=new Date(); return d.toISOString().slice(0,10).replace(/-/g,""); }
function renderStatusLine(){ const el=$("#stline"); if(!el) return; el.innerHTML=`<span class="pill ${shared?"ok":""}">${shared?"공유 저장소 연결됨":"공유 저장소 미연결 (이 브라우저에만 저장)"}</span><span class="pill ${canWrite?"":"warn"}">${canWrite?"편집 가능":"열람 전용 (공유 저장 불가)"}</span><span>${state.updatedAt?"마지막 저장 "+new Date(state.updatedAt).toLocaleString("ko-KR"):""}</span>`; }
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast("복사했습니다"); }catch(e){ const ta=document.createElement("textarea"); ta.value=t; document.body.appendChild(ta); ta.select(); toast("복사 권한이 없어 텍스트를 선택했습니다 — Ctrl+C"); setTimeout(()=>ta.remove(),4000); } }
async function saveFile(name, data){
  if (downloadsCap){ try{ await downloadsCap.save({filename:name, data}); toast("저장했습니다: "+name); }catch(e){ if(e&&e.code==="declined") toast("저장을 취소했습니다"); else if(e&&e.code==="too_large") toast("파일이 너무 큽니다"); else toast("저장 불가: "+(e&&e.message||e&&e.code||"알 수 없음")); } return; }
  try{ const blob = data instanceof Blob? data : new Blob([data]); const u=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),2000); toast("다운로드: "+name); }catch(e){ toast("다운로드를 시작할 수 없습니다"); }
}
function exportXlsx(){
  // 군 MG FMEA·FTA 통합분석서(Rev06)와 같은 시트 구성·순서(00~18)로 EMS 분석 내용을 내보낸다. 화면의 편집값이 반영되며, 계산 열은 수식이다.
  if(!window.XLSX){ toast("Excel 라이브러리를 불러오지 못했습니다"); return; }
  const M=compute(), F=M.F, rs=M.rs, st=M.st; const wb=XLSX.utils.book_new();
  const aoa=(name, rows, cols)=>{ const ws=XLSX.utils.aoa_to_sheet(rows); if(cols) ws["!cols"]=cols.map(w=>({wch:w})); XLSX.utils.book_append_sheet(wb, ws, name); return ws; };
  const par=[...rs].filter(r=>state.sel==="전체"||r.grp==="본체").sort((a,b)=>b.RPN-a.RPN); let cum=0, tot=par.reduce((a,r)=>a+r.RPN,0);
  const cnt=(k,v)=>par.filter(r=>r[k]===v).length, when=new Date().toLocaleString("ko-KR");
  aoa("00_표지",[["IFPS 이동형 전력체계 EMS FMEA·FTA 통합 분석서"],[DATA.meta.project+" | "+DATA.meta.docno+" "+DATA.meta.rev],[],["항목","내용"],["문서번호",DATA.meta.docno],["리비전",DATA.meta.rev],["작성일",DATA.meta.date],["내보낸 시각",when],["분석 대상","EMS 본체 9개 서브시스템 "+st.nOrg+"건 + 연동 장치측 "+st.nSup+"건"],["적용 기준","IEC 60812 (FMEA) · IEC 61025 (FTA)"],["시트 구성","00 표지 · 01 대시보드 · 02 분석개요 · 03 평가기준 · 04 시스템정의 · 05 FMEA 워크시트 · 06 RPN 분석 · 07 위험 매트릭스 · 08 FTA 트리 · 09 FTA 도형 · 10 FTA 계산 · 11 최소절단집합 · 12 통신연동분석 · 13 CCF·일정리스크 · 14 보완설계반영 · 15 정합성검토 · 16 조치계획 · 17 무결성점검 · 18 약어·참고문헌"],["비고","S·O·D 는 제안값이며 사업 검토에서 확정한다. 화면에서 편집한 값이 반영되어 있다(19_변경이력)."]],[16,110]);
  aoa("01_대시보드",[["핵심 지표"],["항목","개선 전","개선 후","비고"],["고장모드 수(본체)",par.length,par.length,"연동 장치측 "+st.nSup+"건 별도"],["RPN 합(본체)",st.rpn,st.rpn2,"저감률 "+(st.red*100).toFixed(1)+"%"],["위험등급 '고' (RPN≥100)",cnt("grade","고"),cnt("grade2","고"),""],["위험등급 '중' (60≤RPN<100)",cnt("grade","중"),cnt("grade2","중"),""],["위험등급 '저'",cnt("grade","저"),cnt("grade2","저"),""],["P(TOP) — "+state.params.tm+"시간 임무",F.top0,F.top1,"저감률 "+((1-F.top1/F.top0)*100).toFixed(1)+"%"],["최소절단집합 수",F.mcs.length,F.mcs.length,"1차 "+F.mcs.filter(m=>m.order===1).length+"개"],["무결성 점검",M.ok?"정상":"점검 필요","","OK "+M.chk.filter(c=>c[1]).length+" / NG "+M.chk.filter(c=>!c[1]).length],[],["RPN 상위 10"],["순위","번호","코드","고장모드","개선 전 RPN","개선 후 RPN","잔여등급"]].concat(par.slice(0,10).map((r,i)=>[i+1,r.id,r.code,r.mode,r.RPN,r.RPN2,r.grade2])),[30,16,16,46,12,12,10]);
  aoa("02_분석개요",[["분석 개요"],["항목","내용"],["목적","EMS 소프트웨어와 연동 구간의 고장모드를 찾아 위험도를 평가하고, 중요부하 급전 상실에 이르는 경로를 정량화한다"],["대상",DATA.meta.project+" — 본체 9개 서브시스템과 연동 장치측"],["방법","FMEA: 고장모드별 S·O·D 평가와 RPN / FTA: 기본사상 확률과 최소절단집합, 중요도"],["정상사상(TOP)",state.params.tm+"시간 임무 중 EMS 기인 중요부하(1·2등급) 급전 상실"],["전제","임무시간 "+state.params.tm+" h, CCF β "+state.params.beta+", 인적 오류 전/후 "+state.params.he0+"/"+state.params.he1],["근거","같은 리비전의 시험 결과 보고서·신뢰성 시험 결과서·실장치 통신 연동 방안서·장치별 안내서"],["한계","가상 장치 검증 결과에 근거한다. 실장비 연동(FAT·SAT) 전에는 개선 후 값(S'·O'·D')을 확정값으로 보지 않는다"],[],["보완설계 반영 후 확인"]].concat(DATA.b_after.map(t=>[t])),[18,120]);
  aoa("03_평가기준",[["평가 기준 (제안값)"]].concat(DATA.b_crit).concat([[],["위험등급","기준","조치구분"],["고","RPN ≥ 100","중점관리 (S ≥ 9 는 RPN 과 관계없이 필수조치)"],["중","60 ≤ RPN < 100","일반관리"],["저","RPN < 60","일반관리"]]),[10,50,34,40]);
  aoa("04_시스템정의",[["시스템 정의 — 서브시스템"],["코드","서브시스템","구성","규모·주기","핵심 기능"]].concat(DATA.b_sys2),[8,22,46,34,60]);
  const H=["번호","구분","코드","서브시스템","구성품 (Level 2)","기능 요구사항","고장모드","고장원인","국부영향","최종영향 (시스템·임무)","현 예방대책 (설계)","현 검출수단","S","O","D","RPN","위험등급","조치구분","권고 조치사항","조치유형","담당","완료 목표","S'","O'","D'","개선 후 RPN","저감률","잔여등급","검증 방법","FTA 사상"];
  const fm=[H]; rs.forEach((r,i)=>{ const n=i+2; fm.push([r.id,r.grp,r.code,r.ss,r.comp,r.func,r.mode,r.cause,r.local,r.effect,r.prev,r.det,r.S,r.O,r.D,{f:`M${n}*N${n}*O${n}`},{f:`IF(P${n}>=100,"고",IF(P${n}>=60,"중","저"))`},{f:`IF(M${n}>=9,"필수조치",IF(P${n}>=100,"중점관리","일반관리"))`},r.rec,r.atype,r.owner,r.due,r.S2,r.O2,r.D2,{f:`W${n}*X${n}*Y${n}`},{f:`IF(P${n}=0,0,1-Z${n}/P${n})`,z:"0.0%"},{f:`IF(Z${n}>=100,"고",IF(Z${n}>=60,"중","저"))`},r.verify,r.fta]); });
  const n=rs.length+2; fm.push(["합계/평균","","","","","","","","","","","",{f:`AVERAGE(M2:M${n-1})`},{f:`AVERAGE(N2:N${n-1})`},{f:`AVERAGE(O2:O${n-1})`},{f:`SUM(P2:P${n-1})`},"","","","","","",{f:`AVERAGE(W2:W${n-1})`},{f:`AVERAGE(X2:X${n-1})`},{f:`AVERAGE(Y2:Y${n-1})`},{f:`SUM(Z2:Z${n-1})`},{f:`1-Z${n}/P${n}`,z:"0.0%"}]);
  aoa("05_FMEA워크시트",fm,[7,9,7,18,22,30,30,30,24,30,26,20,4,4,4,6,6,9,40,9,12,16,4,4,4,8,7,7,30,12]);
  aoa("06_RPN분석",[["순위","번호","코드","고장모드","개선 전 RPN","구성비","누적 구성비","개선 후 RPN","저감률","잔여등급"]].concat(par.map((r,i)=>{cum+=r.RPN;return [i+1,r.id,r.code,r.mode,r.RPN,r.RPN/tot,cum/tot,r.RPN2,r.red,r.grade2];})).concat([["계","","",par.length+"개",tot,1,"",par.reduce((a,r)=>a+r.RPN2,0),1-par.reduce((a,r)=>a+r.RPN2,0)/tot,""]]),[6,8,7,46,12,10,12,12,10,10]);
  const mat=(pre)=>{ const out=[["S＼O",1,2,3,4,5,6,7,8,9,10,"계"]]; for(let s=10;s>=1;s--){ const rw=[s]; let t=0; for(let o=1;o<=10;o++){ const v=par.filter(r=>(pre?r.S:r.S2)===s&&(pre?r.O:r.O2)===o).length; rw.push(v); t+=v; } rw.push(t); out.push(rw);} return out; };
  aoa("07_위험매트릭스",[["개선 전 S×O ("+par.length+"건)"]].concat(mat(true)).concat([[],["개선 후 S'×O'"]]).concat(mat(false)));
  aoa("08_FTA트리",[["정상사상: "+state.params.tm+"시간 임무 중 EMS 기인 중요부하 급전 상실"],["게이트","논리","내용","입력","q 전","q 후","저감률","분류"]].concat(F.glist.map(g=>[g.id,g.logic,g.desc,g.inputs,g.q0,g.q1,g.red,g.cls])),[8,6,50,40,12,12,8,12]);
  aoa("09_FTA도형",[["고장수목 전개 (들여쓰기 = 하위 사상, ○ 기본사상 · ◇ 조건 · ⬡ 공통 원인)"],["구조","유형","내용","근거 FM","비고"]].concat(DATA.tree.map(t=>[t.lvl,t.logic,t.desc,t.basis||"",t.note||""])),[44,8,60,14,50]);
aoa("10_FTA계산",[["임무시간 t_m",state.params.tm,"CCF β",state.params.beta,"HE-01 전/후",state.params.he0,state.params.he1],[],["ID","유형","근거 FM","사상","게이트","O","D","λ","τ","q 전","O'","D'","λ'","τ'","q 후","저감률"]].concat(F.be.map(b=>[b.id,b.type,b.fm,b.desc,b.gate,b.O,b.D,b.lam0,b.tau0,b.q0,b.O2,b.D2,b.lam1,b.tau1,b.q1,b.red])).concat([[],["게이트","논리","내용","입력","q 전","q 후","저감률","분류"]]).concat(F.glist.map(g=>[g.id,g.logic,g.desc,g.inputs,g.q0,g.q1,g.red,g.cls])),[8,6,8,40,8,4,4,6,7,12,4,4,6,7,12,8]);
aoa("11_최소절단집합",[["MCS","차수","사상","—","내용","경로","P 전","P 후","구성비","순위","저감률"]].concat(F.mcs.map(m=>[m.id,m.order,m.ids.join(" ∧ "),"",m.desc,m.gate,m.p0,m.p1,m.share,m.rank,m.red])).concat([["ΣP(MCS)","","","","","",F.sum0,F.sum1],["P(TOP)","","","","","",F.top0,F.top1],[],["ID","근거 FM","사상","경로","FV 전","FV 후","순위","단일고장점","관리 판단","Birnbaum","RAW","RRW","개선 기여"]]).concat(F.imp.map(b=>[b.id,b.fm,b.desc,b.gate,b.fv0,b.fv1,b.rank,b.single?"예":"아니오",b.mgmt,b.birn,b.raw,b.rrw===Infinity?"∞":b.rrw,b.dPshare])),[8,6,8,8,46,8,12,12,8,6,8]);
  aoa("12_통신연동분석",[["7.1 통신 경로 고장 지점"],["지점","구간","역무","주요 고장 메커니즘","관련 고장모드","근거"]].concat(DATA.s07_1).concat([[],["7.2 통신 두절 시 EMS 거동"],["설비","운전 상태","두절 시 EMS 거동","복구 시","2차 위험","위험도","검증"]]).concat(DATA.s07_2).concat([[],[DATA.s07_note],[],["7.3 검출도 전제 감시 점"],["FM","감시 항목","대응 태그","판정","조치","관련"]]).concat(DATA.s07_3),[16,34,30,44,40,20,16]);
  aoa("13_CCF·일정리스크",[["8.1 공통 원인 고장(CCF) 후보"],["No","공통 원인","동시 영향 범위","관련 항목","FTA 반영","권고 검증"]].concat(DATA.s08_1).concat([[],[DATA.s08_h2],["리스크","근거","목표","연계 고장모드 / 영향","대응","상태"]]).concat(DATA.s08_2),[26,36,36,36,30,30]);
  aoa("14_보완설계반영",[["번호","보완설계 반영 내용","반영 대상","검증 방법","검증 시기","담당"]].concat(DATA.b_design).concat([[],[DATA.b_design_note]]),[8,60,30,40,12,12]);
  aoa("15_정합성검토",[["9.1 현 예방대책의 근거 추적 (소스·시험)"],["No","고장모드","현 예방대책","구현 위치","검증 시험","판정"]].concat(DATA.s09).concat([[],["9.2 문서·설계 간 상충과 미결 사항"],["No","한쪽 내용","다른 쪽 내용","조치 권고"]]).concat(DATA.s07_4),[5,22,44,36,70,28]);
  aoa("16_조치계획",[["No","구분","조치 내용","관련 항목","담당","목표일","상태","비고"]].concat(DATA.s10.map(a=>{const o=state.act[a[0]]||{};return [a[0],a[1],a[2],a[3],a[4],a[5],o.status||a[6],o.note||a[7]||""];})),[5,8,60,22,12,12,8,30]);
  aoa("17_무결성점검",[["종합 판정",M.ok?"정상":"점검 필요","OK "+M.chk.filter(c=>c[1]).length+" / NG "+M.chk.filter(c=>!c[1]).length],["No","점검 항목","판정","상세값"]].concat(M.chk.map((c,i)=>[i+1,c[0],c[1]?"OK":"NG",c[2]])),[10,50,16,30]);
  aoa("18_약어·참고문헌",[["약어"],["약어","원어","뜻"]].concat(DATA.b_abbr).concat([[],["참고문헌·근거 문서"],["구분","문서","내용"]]).concat(DATA.b_ref),[16,70,60]);
  const log=[["항목","필드","기준 값","편집 값"]]; for(const [id,o] of Object.entries(state.ov)){ const b=DATA.fmea.find(f=>f.id===id); for(const [k,v] of Object.entries(o)) log.push([id,k,b[k],v]); } for(const [no,o] of Object.entries(state.act)) log.push(["조치 "+no,"상태/비고",DATA.s10.find(a=>a[0]===no)[6],(o.status||"")+" / "+(o.note||"")]);
  aoa("19_변경이력",log.length>1?log:[["편집값 없음 — 기준값 그대로"]],[12,10,40,40]);
  const out=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  saveFile("IFPS_EMS_FMEA_FTA_통합분석서_"+DATA.meta.rev+"_"+stamp()+".xlsx", new Blob([out],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}


/* ───────────── persistence */
function markDirty(){ dirty=true; state.updatedAt=Date.now(); saveLocal(); const p=$("#savepill"); if(p) p.textContent="이 브라우저에 저장됨 · 공유 저장소 미반영"; if(shared && canWrite){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>sharedSave(false),1500); } $("#railstate").textContent=(shared?"공유 저장소 연결":"로컬 저장")+" · "+new Date(state.updatedAt).toLocaleTimeString("ko-KR"); }
let suppress=false;
async function sharedSave(explicit){ if(!shared) { if(explicit) toast("공유 저장소가 연결되어 있지 않습니다"); return; } try{ suppress=true; await dbDoc.set({ov:state.ov,act:state.act,params:state.params,sel:state.sel,note:state.note||"",updatedAt:Date.now()}); dirty=false; const p=$("#savepill"); if(p) p.textContent="공유 저장소에 저장됨"; if(explicit) toast("공유 저장소에 저장했습니다"); }catch(e){ canWrite=false; if(explicit) toast("저장 권한이 없습니다 (열람 전용)"); } finally{ setTimeout(()=>suppress=false,500); } }
async function sharedPull(){ if(!shared) return; try{ const s=await dbDoc.get(); if(s.exists){ applyShared(s.data()); route(); toast("공유 저장소 상태를 불러왔습니다"); } else toast("공유 저장소에 저장된 상태가 없습니다"); }catch(e){ toast("불러오기 실패"); } }
function applyShared(d){ if(!d) return; state={...state, ov:d.ov||{}, act:d.act||{}, params:{...DATA.params,...(d.params||{})}, sel:d.sel||state.sel, note:d.note||"", updatedAt:d.updatedAt||state.updatedAt}; saveLocal(); }
async function initCaps(){
  if(!(window.claude && window.claude.use)) return;
  try{ downloadsCap = await window.claude.use("downloads"); }catch(e){}
  try{ userCap = await window.claude.use("user"); if(userCap){ const w = await userCap.can("data.write"); if(w===false) canWrite=false; } }catch(e){}
  try{ const db = await window.claude.use("db"); if(db){ dbDoc = db.doc("shared/state"); shared=true; let got=false; const t=setTimeout(()=>{ if(!got) renderStatusLine(); },10000);
      dbDoc.onSnapshot(s=>{ got=true; clearTimeout(t); if(suppress) return; if(s.exists){ const d=s.data(); if(!state.updatedAt || (d.updatedAt||0)>state.updatedAt){ applyShared(d); route(); } } renderStatusLine(); }, e=>{ renderStatusLine(); }); } }catch(e){}
  renderStatusLine(); $("#railstate").textContent=shared?"공유 저장소 연결":"로컬 저장";
}

/* ───────────── router */
const VIEWS={dashboard:vDashboard, fmea:vFmea, rpn:vRpn, fta:vFta, mcs:vMcs, comm:vComm, design:vDesign, qa:vQa, tools:vTools};
function route(){ const h=(location.hash||"#dashboard").slice(1); const v=VIEWS[h]||vDashboard; document.querySelectorAll("#nav a").forEach(a=>a.classList.toggle("on", a.getAttribute("href")==="#"+(VIEWS[h]?h:"dashboard"))); v(); window.scrollTo(0,0); }
loadLocal(); route(); window.addEventListener("hashchange", route); initCaps();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>route());
