// 이동형 전력체계 EMS — AI 예측 논문(초안). 수치는 docs/ppt/ai_paper_eval.json(ai_paper_eval.py 가 만든다)에서 읽는다. 손으로 수치를 적지 않는다.
// node build_ai_paper.js [Rev] [작성일] [출력.docx]
const fs = require("fs"), path = require("path"); const L = require("./lib.js"); const { P, H1, H2, EQ, TBL, GAP, run } = L;
const { Paragraph, AlignmentType } = require("docx");
const E = JSON.parse(fs.readFileSync(path.join(__dirname, "ppt", "ai_paper_eval.json"), "utf8")), LE = JSON.parse(fs.readFileSync(path.join(__dirname, "ppt", "ai_learn_eval.json"), "utf8"));
const REV = process.argv[2] || "Rev00", DATE = process.argv[3] || "", OUT = process.argv[4] || path.join(__dirname, "out", `이동형전력체계EMS_AI예측_논문_${REV}.docx`);
const BN = E.bench, BA = BN.agg;
const WX = JSON.parse(fs.readFileSync(path.join(__dirname, "ppt", "wx_eval.json"), "utf8")), WXK = Object.keys(WX.cases);
const b = [], PV = E.pv, P0 = PV[0], P1 = PV[1], P3 = PV[2], pc = v => v === null || v === undefined ? "—" : Number(v).toFixed(2) + "%", cut = (a, c) => Math.round((1 - c / a) * 100), NP = E.cost.params_ridge + E.cost.params_att + E.cost.params_alpha;
let figN = 0, tabN = 0, eqN = 0;
const C = (t, o = {}) => new Paragraph(Object.assign({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(t, o.run || {})] }, o.p || {}));
function fig(file, w, h, cap) { figN++; b.push(...L.FIG(path.join(__dirname, "ppt", "img", file), w, h, `그림 ${figN}. ${cap}`)); return figN; }
const m3 = (name, cap) => fig(`ai3d_m_${name}.jpg`, 620, 349, cap + " (실제 학습 값을 3차원에 그대로 배치해 그린 것)"), ch = (name, cap) => fig(`aich_${name}.png`, 600, 310, cap);
const eq = t => { eqN++; b.push(new Paragraph({ spacing: { before: 60, after: 100 }, indent: { left: 500 }, tabStops: [{ type: "right", position: 9500 }], children: [run(t, { font: "Cambria Math", size: L.S.body }), run(`\t(${eqN})`, { size: L.S.cap })] })); return eqN; };
const tbl = (cap, head, rows, w, o) => { tabN++; b.push(L.CAP(`표 ${tabN}. ${cap}`, true)); b.push(TBL(head, rows, w, o)); b.push(GAP()); return tabN; };
const para = t => b.push(P(t, { alignment: AlignmentType.JUSTIFIED }));

// ── 제목·요약
b.push(C("기상 예보 없이 동작하는 이동형 마이크로그리드의 부하·태양광 단기 예측:", { run: { size: L.S.title, bold: true }, p: { spacing: { before: 400, after: 60 } } }));
b.push(C("릿지 회귀·하늘 카메라 주의집중 기본 예측과 검증 기반 단기 실측 앙상블", { run: { size: L.S.title, bold: true }, p: { spacing: { after: 200 } } }));
b.push(C("Short-Term Load and PV Forecasting for a Deployable Microgrid without Weather Forecasts: Ridge Regression, Sky-Camera Attention and a Validation-Gated Measurement-Based Ensemble", { run: { size: 22, italics: true }, p: { spacing: { after: 240 } } }));
b.push(C("한화에어로스페이스㈜ 에너지솔루션사업센터", { run: { size: 22 } })); b.push(C(`기술 논문 초안 · ${REV} · ${DATE}`, { run: { size: L.S.cap, color: "595959" }, p: { spacing: { after: 300 } } }));
b.push(P([run("요약  ", { bold: true }), run(`작전지에 전개하는 이동형 전력체계는 통신이 닫힌 환경에서 운용되므로 외부 기상 예보를 받을 수 없고, 연산 장치도 노트북급으로 제한된다. 본 논문은 이런 조건에서 앞으로 24시간의 부하와 태양광 출력을 15분 단위로 예측하는 방법을 제시한다. 태양광은 출력을 청천 출력으로 나눈 청천 지수를 예측 대상으로 삼고, (1) 선행시간 구간별 릿지 회귀, (2) 하늘 카메라 사진의 붉은빛·푸른빛 비율로 구한 구름량, (3) 지금과 닮은 과거 상황을 찾아 그 뒤의 실측을 가중 평균하는 주의집중(어텐션) 예측을 결합한다. 두 예측을 섞는 비율은 선행시간 구간마다 검증 오차가 2% 이상 줄 때만 0 보다 크게 둔다. 운용 중에는 주기적으로 다시 학습하되, 학습에 쓰지 않은 최근 자료에서 현재 모델보다 나쁘지 않을 때만 새 모델을 적용한다. 학습되는 값은 태양광 모델 전체가 ${NP}개이며 노트북 CPU 에서 학습 ${E.cost.train_pv_s}초, 예측 ${E.cost.predict_s}초가 걸린다. 합성 현장 자료 ${E.data.days}일(시험 ${E.data.test_days}일)에서 태양광의 2시간 이내 오차는 릿지 회귀만 쓸 때 ${pc(P0.near)}에서 ${pc(P3.near)}로 ${cut(P0.near, P3.near)}% 줄었고, 24시간 전체 오차는 ${pc(P0.nmae)}에서 ${pc(P3.nmae)}로 거의 같았다. 부하는 전일 같은 시각 기준선 대비 ${cut(E.load.base, E.load.nmae)}% 낮은 ${pc(E.load.nmae)}였다. 여기에 최근 실측으로 만든 참조값을 검증을 통과한 선행시간 구간(4시간 이내)에만 결합하는 단기 실측 앙상블과, 최근 포함률이 낮을 때 예측 구간을 넓히는 변동 여유를 더했다. 합성 카메라 열을 뺀 독립 시험 ${BN.seeds.length}세트에서 15분 앞 오차는 부하 평균 ${BA.load.cut15_mean}%(${BA.load.cut15_min}~${BA.load.cut15_max}%), 태양광 평균 ${BA.pv.cut15_mean}%(${BA.pv.cut15_min}~${BA.pv.cut15_max}%) 줄었고, 24시간 구간 포함률은 태양광 ${BA.pv.cov24_static[0]}~${BA.pv.cov24_static[1]}%에서 ${BA.pv.cov24[0]}~${BA.pv.cov24[1]}%로 목표(80%) 부근에 모였다. 결과는 합성 자료에 한정되며 실제 효과는 현장 자료로 다시 확인해야 한다.`)], { alignment: AlignmentType.JUSTIFIED }));
b.push(P([run("주제어  ", { bold: true }), run("마이크로그리드, 단기 예측, 태양광 발전 예측, 릿지 회귀, 전천 카메라, 주의집중(어텐션), 커널 회귀, 지속 학습, 예측 구간, 실측 앙상블")]));
b.push(P([run("Abstract  ", { bold: true }), run(`A deployable field microgrid operates on a closed network, so it cannot receive external weather forecasts, and its computing is limited to a laptop-class machine. We present a method that forecasts load and PV output for the next 24 hours at 15-minute resolution under these constraints. For PV we forecast the clear-sky index and combine (1) ridge regression per lead-time bucket, (2) cloud cover from the red–blue ratio of all-sky camera images, and (3) an attention predictor that averages what actually followed similar past situations. The blending ratio is set per lead-time bucket and is non-zero only when validation error drops by at least 2%. In operation the model is retrained periodically, but a new model is adopted only if it is not worse than the current one on recent data held out from training. The PV model has ${NP} learned values; training takes ${E.cost.train_pv_s} s and one forecast ${E.cost.predict_s} s on a laptop CPU. On ${E.data.days} days of synthetic site data (${E.data.test_days} test days), PV error within 2 hours fell from ${pc(P0.near)} to ${pc(P3.near)} (${cut(P0.near, P3.near)}% lower), while the 24-hour error was nearly unchanged (${pc(P0.nmae)} to ${pc(P3.nmae)}). We further add a measurement-based ensemble that blends a reference built from the latest observations only in lead-time bands (within 4 hours) that pass validation, and a drift margin that widens the prediction interval when recent coverage is low. In ${BN.seeds.length} independent synthetic tests that exclude the synthetic camera column, 15-minute error fell by ${BA.load.cut15_mean}% on average for load (${BA.load.cut15_min}–${BA.load.cut15_max}%) and ${BA.pv.cut15_mean}% for PV (${BA.pv.cut15_min}–${BA.pv.cut15_max}%), and 24-hour PV interval coverage moved from ${BA.pv.cov24_static[0]}–${BA.pv.cov24_static[1]}% to ${BA.pv.cov24[0]}–${BA.pv.cov24[1]}%. All results are on synthetic data and must be re-measured in the field.`)], { alignment: AlignmentType.JUSTIFIED }));
b.push(P([run("Keywords  ", { bold: true }), run("microgrid, short-term forecasting, PV forecasting, ridge regression, all-sky camera, attention, kernel regression, continual learning, prediction interval, measurement-based ensemble")]));

// ── 1. 서론
b.push(H1("1. 서론"));
para("이동형 전력체계는 디젤발전기, 연료전지, 에너지저장장치(ESS), 이동형 태양광을 묶어 작전지에 전력을 공급한다. 전술전력통제체계(TPCS)는 연료 소비와 소음을 줄이기 위해 발전기 기동 시점과 ESS 충·방전을 미리 계획하며, 이 계획은 앞으로 24시간의 부하와 태양광 출력 예측에 기댄다. 예측이 크게 틀리면 발전기를 불필요하게 돌리거나, 반대로 야간에 ESS 가 모자라 발전기를 급히 켜게 된다.");
para("일반 전력 계통의 예측과 달리 이 환경에는 세 가지 제약이 있다. 첫째, 폐쇄망에서 운용하므로 수치 예보 등 외부 기상 자료를 받을 수 없다. 둘째, 연산 장치가 노트북급이어서 큰 신경망을 학습하기 어렵고, 학습이 제어 주기를 방해해서는 안 된다. 셋째, 전개 직후에는 현장 자료가 거의 없으며 편성과 계절에 따라 부하와 날씨의 성질이 바뀐다. 여기에 더해, 운용자가 예측 결과를 믿고 쓰려면 왜 그렇게 예측했는지를 설명할 수 있어야 한다.");
para("본 논문의 기여는 다음과 같다. (1) 외부 예보 없이 현장 센서와 하늘 카메라만으로 동작하는 가벼운 예측 구조를 제시한다. (2) 닮은 과거 상황을 가중 평균하는 주의집중 예측을 특징별 중요도만 학습하는 형태로 구성해, 학습 값이 수십 개에 그치고 참고한 과거 시점을 그대로 보여 줄 수 있게 했다. (3) 두 예측을 섞는 비율과 모델 교체를 모두 '학습에 쓰지 않은 자료에서의 오차'로 결정해, 도움이 되지 않는 요소가 스스로 꺼지게 했다. (4) 최근 실측 참조를 검증된 구간에만 결합하는 단기 실측 앙상블과, 예측 구간의 변동 여유를 제시한다. (5) 기본 예측기 구성 요소의 효과와 단기 실측 앙상블의 효과를 서로 다른 시험으로 나누어, 효과가 나타나는 구간과 나타나지 않는 구간을 구분해 보고한다.");

// ── 2. 관련 연구
b.push(H1("2. 관련 연구"));
para("릿지 회귀는 가중치의 크기에 벌점을 주어 특징 사이의 상관이 클 때에도 안정적인 해를 주는 선형 회귀이다[1]. 부하 예측 분야에서는 선형 모형에 시각·요일·기온과 과거 부하를 넣는 방식이 오래 쓰여 왔고, 점 예측과 함께 예측 구간을 내는 확률적 예측의 필요성이 강조되어 왔다[2]. 분위수를 직접 추정하는 방법은 분포를 가정하지 않고 구간을 만들 수 있게 한다[3].");
para("태양광의 수 분~수 시간 앞 예측에서는 지상에서 하늘을 찍는 전천 카메라가 쓰인다. 맑은 하늘과 구름은 붉은빛과 푸른빛의 비가 달라, 화소별 색 비율에 경계값을 적용해 구름을 구분하는 방법이 널리 알려져 있다[4][5][6]. 전천 영상으로 구름의 이동을 추적해 수십 분 앞의 일사를 예측한 연구도 있다[7]. 본 논문은 이 가운데 가장 단순한 색 비율 판정만을 쓰고, 구름 이동 추적은 다루지 않는다.");
para("주의집중(어텐션)은 질의와 열쇠의 닮은 정도를 소프트맥스로 가중치로 바꾸어 값을 가중 합하는 연산으로, 대형 언어 모델의 바탕인 트랜스포머의 핵심이다[8]. 닮은 표본을 거리에 따라 가중 평균하는 생각 자체는 커널 회귀로 오래전에 제시되었으며[9][10], 본 논문의 주의집중 예측은 특징별 척도를 학습하는 커널 회귀로 볼 수 있다. 본 논문은 새로운 학습 이론을 제안하는 것이 아니라, 알려진 요소들을 폐쇄망·저사양·소량 자료라는 조건에 맞게 결합하고 검증 절차로 묶은 것이다.");

// ── 3. 문제와 자료
b.push(H1("3. 문제 정의와 자료"));
para(`시각은 15분 구간으로 나눈다. 예측을 내는 시점을 o, 선행시간을 h(1~96구간, 24시간)라 하면, 목표는 o 까지의 측정값만으로 부하 L(o+h)와 태양광 출력 P(o+h)의 중앙값과 80% 구간을 내는 것이다. 이력의 한 줄은 15분 평균으로, 부하 합계와 등급별 부하, 태양광 출력, 기온, 기압, 습도, 하늘 카메라 구름량(0~1), 편성 단계, 운전 방식을 담는다. 구름량은 카메라가 없거나 밤이면 비워 둔다. 빠진 구간은 앞 값으로 채우되, 원래 측정된 값인지 채운 값인지를 따로 표시해 둔다. 이 표시는 단기 실측 참조의 유효 판정과 평가 표본 선택에 쓴다.`);
H2 && b.push(H2("3.1 청천 출력과 청천 지수"));
para("태양광 출력은 시각과 계절에 따라 크게 변하므로, 구름이 없을 때 낼 수 있는 출력으로 나눈 비율을 예측 대상으로 삼는다. 태양 천정각 θ 는 위도 φ, 태양 적위 δ, 시간각 ω 로부터");
eq("cos θ = sin φ · sin δ + cos φ · cos δ · cos ω");
para("로 구하며, δ 와 균시차는 날짜의 삼각함수 급수로 계산한다. 청천 전천 일사는 Haurwitz 식을 쓰고, 청천 출력은 설비 용량 P_kWp 와 종합 성능계수 PR 을 곱해 구한다.");
eq("G = 1098 · cos θ · exp(−0.057 / cos θ)  [W/㎡] ,    P_clear = P_kWp · PR · G / 1000");
para("청천 지수와 최종 출력 예측은 다음과 같다. 청천 출력이 설비 용량의 5% 미만인 구간(밤)은 r 을 정의하지 않는다.");
eq("r(t) = clip( P(t) / P_clear(t) , 0 , 1.2 ) ,    P̂(o+h) = r̂(o+h) · P_clear(o+h)");
b.push(H2("3.2 특징"));
para("모든 특징은 o 까지의 측정값으로만 만든다. 부하의 예측 대상은 기준 부하 B(o)(전개 후 14일까지의 평균, 이후 고정)로 나눈 비율 y = L(o+h)/B(o)이다.");
tbl("예측에 쓰는 특징", ["대상", "특징", "수"], [
  ["태양광 (20)", "선행시간 h/96, 목표 시각과 현재의 청천 출력(용량 대비), 목표 시각의 sin·cos", 5], ["", "청천 지수: 최근 1시간·3시간 평균, 2시간 표준편차, 24시간 평균, 전일 같은 시각", 5], ["", "기압: 24시간 평균 대비, 3·12·24시간 변화 / 습도와 6시간 변화 / 기온과 24시간 변화", 8], ["", "하늘 카메라 구름량과 30분 변화", 2],
  ["부하 (18)", "선행시간 h/96, 목표 시각의 1·2·3차 주기(sin·cos), 일요일 여부, 편성 단계", 9], ["", "부하: 현재, 최근 1시간·24시간 평균, 전일·전주 같은 시각, 전일 대비 변화", 6], ["", "기온, 목표 시각의 기온 추정, 목표 시각의 청천 출력", 3]], [16, 74, 10], { bold: [0], center: [2] });

// ── 4. 방법
b.push(H1("4. 방법"));
m3("arch", "태양광 예측 모델의 전체 구조. 블록의 개수가 실제 특징·가중치·중요도·비율의 개수이다");
b.push(H2("4.1 선행시간 구간별 릿지 회귀"));
para("선행시간을 6개 구간(1·2·4·8·16·24시간 이내)으로 나누고 구간 b 마다 따로 학습한다. 특징을 평균 μ, 표준편차 σ 로 표준화한 행렬 Z 에 대해 가중치는 닫힌 식으로 구한다(절편에는 벌점을 주지 않는다).");
eq("w_b = (ZᵀZ + λI)⁻¹ Zᵀy ,    λ = 3");
para("예측은 모형 출력에 전일 같은 시각의 값을 20% 섞는다. 입력이 학습 범위를 벗어났을 때 선형 모형이 크게 벗어나는 것을 줄이기 위한 것이다.");
eq("r̂_R(o, h) = 0.8 · w_bᵀ z(o, h) + 0.2 · r(o + h − 96)");
para(`학습 표본은 o 를 3구간마다 옮기며 선행시간 14종에 대해 만든다. 반복 최적화가 없으므로 같은 자료에서는 항상 같은 모델이 나온다. 그림 ${figN + 1}은 1시간 이내 구간에서 학습된 결과를 두 특징에 대한 단면으로 보인 것이다.`);
m3("ridge", `릿지 회귀(1시간 이내 구간)의 학습 표본 ${E.viz.ridge.pts.length}개와 학습된 단면 ŷ = c + a·x₁ + b·x₂ (a = ${E.viz.ridge.a}, b = ${E.viz.ridge.b}). 나머지 18개 특징은 평균에 고정했다`);
b.push(H2("4.2 예측 구간"));
para("모델 학습에서 빼 둔 마지막 7일(보정 구간)에서 오차 e = r − r̂ 의 10%·90% 분위수를 구간 b 별로 구해 80% 예측 구간을 만든다. 운전 계획은 배치 초기일수록 큰 계수 κ 로 부하는 위쪽, 태양광은 아래쪽 경계 쪽으로 치우친 값을 쓴다.");
eq("[ r̂ + Q₁₀(e_b) ,  r̂ + Q₉₀(e_b) ] × P_clear");
m3("band", "한 번의 태양광 24시간 예측. 띠는 80% 예측 구간, 점은 그 뒤의 실측이다");
para("날씨나 부하의 성질이 바뀌는 시기에는 지난 오차로 만든 구간이 좁게 나온다. 이를 줄이기 위해 변동 여유 s 를 둔다. 보정 구간의 앞 5일로 구한 분위수에 s 를 곱했을 때 뒤 2일(가장 최근)의 오차를 80% 이상 덮는 가장 작은 s 를 후보(1, 1.15, 1.3, 1.5, 1.75, 2, 2.5) 가운데 고르고, 전체 7일의 분위수에 곱한다. 최근 2일의 포함률이 75% 이상이면 표본 수에 따른 흔들림으로 보아 넓히지 않는다(s = 1).");
eq("s = min{ s ≥ 1 : Cov₂일( s · Q(e₅일) ) ≥ 0.8 } ,    구간 = [ r̂ + s·Q₁₀(e) ,  r̂ + s·Q₉₀(e) ] × P_clear");
b.push(H2("4.3 하늘 카메라 구름량"));
para("카메라가 찍은 하늘 사진의 각 화소에서 붉은빛 R 과 푸른빛 B 의 정규화 차이를 구한다. 맑은 하늘은 R 이 B 보다 훨씬 작고 구름은 R 과 B 가 비슷하므로, 경계값보다 큰 화소를 구름으로 센다. 포화된 태양 원반은 세지 않으며, 평균 밝기가 낮은 사진(야간)은 판정하지 않는다.");
eq("ρ = (R − B) / (R + B + 1) ,    c = |{ρ > −0.12}| / |하늘 화소|");
para("구름량 c 는 10초마다 읽어 15분 평균으로 이력에 남긴다. 사진이 없거나 3분 넘게 갱신되지 않았거나 읽기에 실패하면 값을 비우고, 그때는 구름량 자리에 (1 − 최근 1시간 청천 지수)/0.85 를 대신 넣는다. 따라서 카메라 고장이 예측을 멈추게 하지 않는다.");
b.push(H2("4.4 주의집중 예측"));
para(`지금 상황을 나타내는 벡터 q(o)와 과거 시점 i 의 상황 K_i 를 같은 방법으로 만든다. 성분은 ${E.att.features}개로, ${E.att.names.join(", ")}이다. 값 V_i(h)는 시점 i 에서 h 구간 뒤에 실제로 관측된 청천 지수이다. 표준화한 성분에 특징별 중요도 s_k 를 곱한 거리로 가중치를 정한다.`);
const EQW = eq("d_i = Σ_k s_k² ( q̃_k − K̃_ik )² ,    w_i = m_i · exp(−d_i) / Σ_j m_j · exp(−d_j)");
eq("r̂_A(o, h) = Σ_i w_i · V_i(h)");
para(`여기서 m_i 는 기억 i 의 값이 예측 시점 전에 모두 관측된 경우(O_i + 96 ≤ o)에만 1 이다. 즉 미래의 자료는 쓰지 않으며, 이는 예측 시점 뒤의 자료를 바꿔도 예측이 변하지 않음을 확인하는 시험으로 검증한다. 식 (${EQW})은 질의–열쇠의 닮음을 소프트맥스로 가중치로 바꾸는 주의집중 연산과 같은 꼴이며, 통계적으로는 대각 척도를 학습하는 Nadaraya–Watson 커널 회귀에 해당한다.`);
para(`중요도 s 는 가까운 예측(2시간 이내)과 먼 예측(2~24시간)에 따로 두어 모두 ${E.cost.params_att}개이다. 학습은 최근 7일의 시점들을 그 이전 기억만으로 맞혀 본 평균 절대 오차를 목표로, 한 번에 한 성분씩 2배·1/2배·0 으로 바꿔 보아 오차가 줄 때만 받아들이는 좌표 하강을 2회 반복한다. 기억은 1시간 간격으로 만들며 본 실험에서는 ${E.att.memories.toLocaleString()}건이다.`);
m3("attn", `한 번의 예측(${E.viz.att.issued})에서 질의 q 주변의 기억. 다면체 크기와 빛줄기 굵기는 가중치 w_i, 색은 1시간 뒤 실측 V_i 이다. 가중 합 ${E.viz.att.pred_1h}, 실측 ${E.viz.att.act_1h}`);
m3("imp", "학습된 특징별 중요도 s_k (주황: 2시간 이내, 청록: 2~24시간). 0 은 그 특징을 보지 않는다는 뜻이다");
b.push(H2("4.5 검증된 비율로 섞기"));
para("최종 예측은 두 예측을 구간별 비율 α_b 로 섞는다. α_b 는 보정 구간에서 평균 절대 오차가 가장 작은 값을 5개 후보 가운데 고르되, 릿지 회귀만 쓸 때보다 2% 이상 줄지 않으면 0 으로 둔다.");
eq("r̂ = (1 − α_b) · r̂_R + α_b · r̂_A ,    α_b ∈ {0, ¼, ½, ¾, 1}");
eq("α_b = 0   if   MAE_b(α_b) ≥ 0.98 · MAE_b(0)");
m3("alpha", "학습된 구간별 섞는 비율 α_b. 주황이 주의집중의 몫이다");
b.push(H2("4.6 검증 기반 지속 학습"));
para("운용 중에는 정해진 주기(기본 24시간)로 다시 학습한다. 먼저 자료의 행 수, 결측 비율, 값이 멈춘 비율을 점검해 기준에 못 미치면 학습하지 않는다. 도전 모델은 최근 3일을 빼고 학습하고, 그 3일에서 6시간 간격으로 24시간 예측을 발행해 현재 모델과 같은 방법으로 채점한다.");
eq("NMAE = (1/N) Σ_t | ŷ_t − y_t | / S");
eq("교체  ⇔  NMAE(도전) ≤ NMAE(현재) − δ");
para("S 는 부하에서는 평균 부하, 태양광에서는 설비 용량(낮 구간만)이다. 판단은 부하와 태양광을 따로 하며, 통과한 종류만 전체 자료로 다시 학습해 적용하고 이전 판은 보관해 한 번에 되돌릴 수 있게 한다. 모델을 유지하는 주기에도 예측 구간은 최근 자료로 다시 맞춘다. 적용 중인 모델의 NMAE 가 한도(15%)를 넘으면 계획 운전을 쉬고 규칙 운전으로 넘어간다. 학습은 별도 프로세스에서 실행해 제어 주기를 방해하지 않는다.");
para("학습 주기 사이에는 직전 2시간의 한 구간 앞 예측 오차로 가까운 구간을 보정한다. 부하는 오차 평균 b 를 더하고 태양광은 실측과 예측의 비 ρ 를 곱하며, 선행시간에 따라 지수적으로 줄인다(τ = 2시간). 이 보정은 검증에서 2시간 이내 오차를 줄일 때만 켠다.");
eq("ŷ′(h) = ŷ(h) + b · e^(−(h−1)/τ)  (부하) ,    ŷ′(h) = ŷ(h) · (1 + (ρ − 1) · e^(−(h−1)/τ))  (태양광)");

b.push(H2("4.7 실측 기반 단기 앙상블"));
para("가까운 미래에 대해서는 방금 잰 값이 이어진다는 가정이 강한 기준선이다. 4.1~4.6절의 예측 ŷ_h(최근 오차 보정을 거친 값)와 별도로, 발행 시점 o 까지의 계측값만으로 참조 R_h 를 만들고 유효 표시 M_h 와 구간별 가중치로 둘을 결합한다.");
para("부하 참조는 최신 실측 L_o 와 전일 같은 시각의 값으로 만든다. Δ 는 최근 최대 3개 유효 구간에서 구한 전일 대비 차이의 중앙값이며 설정 기준 부하 B 의 ±30%로 제한한다. 선행시간이 길어질수록 최신 실측의 몫 a 가 줄고 전일 곡선의 몫이 커진다.");
eq("Δ = clip( median( L_(o−j) − L_(o−j−96) ) , ±0.3B ) ,    a = e^(−(h−1)/3) ,  q = e^(−(h−1)/12)");
eq("R_L(h) = max( 0 ,  a·L_o + (1 − a)·( L_(o+h−96) + q·Δ ) )");
para("태양광 참조는 최근 최대 3개 유효 구간의 청천 지수 r = clip(P/C, 0, 1.1)에 미래의 청천 출력을 곱한다. 현재 청천 출력이 정격의 8% 미만이거나 현재 발전 실측이 없으면 참조를 쓰지 않고, 미래 청천 출력이 정격의 2% 미만인 구간도 보정에서 뺀다.");
eq("R_P(h) = clip( C_(o+h) · ( 0.7·r_o + 0.3·median(r) ) ,  0 ,  P정격 )");
const EQN = eq("δ_h = M_h · w_b · t_h · ( R_h − ŷ_h ) ,    ŷ′_h = clip( ŷ_h + δ_h , 0 , 상한 )");
para("t_h 는 태양광의 첫 네 구간에만 두는 감쇠 계수(1, 0.6, 0.3, 0.15)이며 그 밖에는 1 이다. 가중치 w_b 는 0~1시간, 1~2시간, 2~4시간 구간에서만 고르고 그 뒤는 0 이다. 상한은 태양광에서는 정격이고 부하에는 두지 않는다. 예측 구간의 양쪽 경계에도 같은 δ_h 를 더한 뒤 물리 범위와 새 중앙값에 맞춘다.");
para("가중치 후보는 0, 0.25, 0.5, 0.75, 1 이다. 유효 표본이 40개 이상이고, 평균 절대 오차가 2% 이상 줄며, 예측 구간 포함률의 하락이 2%p 이내인 후보 가운데 오차가 가장 작은 값을 고른다. 통과한 후보가 없으면 0 이다. 고른 가중치는 지속 학습의 판(버전) 정보에 함께 기록하며, 화면의 예측과 운전 계획이 같은 값을 쓴다. 가중치 기록이 없는 이전 판 모델에서는 기존 예측을 그대로 쓴다.");
m3("now", `식 (${EQN})의 보정량 응답면. 실제 결합 함수에 기존 예측 100 kW, 참조와의 차이 −50~+50 kW 를 넣어 계산했다. 가중치는 첫 시험 세트에서 채택된 값(부하 [${E.viz.nowcast.load.w.join(", ")}], 태양광 [${E.viz.nowcast.pv.w.join(", ")}])이다`);

// ── 5. 실험
b.push(H2("4.8 운용자 · 통신망 날씨 정보의 결합(선택 입력)"));
para("앞의 방법은 외부 기상 예보 없이 동작한다. 다만 사람이 얻을 수 있는 날씨 정보가 있으면 버릴 이유가 없다. 작전지에서는 장병이 개인 휴대폰의 날씨 앱에서 본 날씨 표기(맑음, 대체로 흐림, 비 등)와 강수 확률, 그 날씨가 이어질 기간을 손으로 넣고, 주둔지에서는 군 통신망으로 시간별 운량 자료를 받는다. EMS 자체는 외부망에 연결하지 않는다. 이 입력은 선택 사항이며, 없는 시간에는 AI 예측을 그대로 쓴다.");
para("날씨 기록이 있는 시각 t 에 대해 날씨 기반 예측을 따로 만든다. 운량 N(0~10할)과 일사의 관계는 Kasten 과 Czeplak 의 식[11]을 쓴다(원식은 8분위 운량).");
eq("P_wx(t) = P_clear(t) · k · c,      k = 1 − 0.75 · (N / 10)^3.4");
para("여기서 P_clear 는 청천 출력, c 는 설비 보정(최근 14일 낮 시간의 실측 ÷ 청천 출력의 위쪽 10% 값)이다. 날씨 표기는 환산표로 N 이 되고(맑음 0.5, 대체로 맑음 2.5, 구름 조금 4, 대체로 흐림 7, 흐림 9, 비 · 눈 10), 강수 확률 p% 가 있으면 N ≥ p/10 − 1 로 본다. 환산표는 현장마다 맞지 않을 수 있으므로, 같은 표기가 쓰인 시각의 실측 비율 y/(P_clear · c) 를 모아 k 를 그 평균 쪽으로 옮긴다(실측 n 건일 때 k ← (6·k_표 + Σ 실측) / (6 + n), 오래된 실측은 2%씩 잊는다).");
para("최종 예측은 두 예측의 가중 합이다. 가중치 w_h 는 선행시간 묶음 h(1 · 3 · 6시간 이내와 그 뒤)마다 따로 두며, 그동안 적어 둔 예측과 실측에서 제곱 오차를 가장 작게 하는 값으로 정하고 0 ~ 0.8 로 자른다.");
eq("P(t) = (1 − w_h) · P_AI(t) + w_h · P_wx(t),      w_h = Σ (y − P_AI)(P_wx − P_AI) / Σ (P_wx − P_AI)²");
para("비교가 쌓이기 전(묶음마다 6건 미만, 전체 8건 미만)에는 w = 0.3 을 쓴다. 날씨 정보가 도움이 되지 않던 묶음에서는 w_h 가 0 에 가까워지므로, 틀린 입력이 이어져도 예측이 계속 나빠지지 않는다. 같은 시각에 수기 입력과 통신망 자료가 겹치면 현지에서 본 수기 입력을 쓴다. 이 결합은 화면의 예측, 자립 지속시간의 하루 태양광 예상량, 운전계획의 태양광 입력에 함께 적용된다.");

b.push(H1("5. 실험"));
b.push(H2("5.1 기본 예측 비교 시험의 설정"));
para(`현장 실측이 아직 없어 합성 현장 자료를 썼다. 자료는 ${E.data.days}일(15분 간격)이며 난수 씨앗을 고정해 다시 만들 수 있다. 날씨는 맑음·구름·비의 세 상태를 하루 단위로 옮겨 다니고, 구름에 의한 투과율은 평균으로 돌아가는 1차 자기회귀 과정으로 만들었다. 부하는 고정 부하와 주간 활동 부하, 기온에 따른 냉방 부하, 편성 단계에 따른 배율로 구성했다. 하늘 카메라 구름량은 '카메라가 하늘 전체를 보므로 15~30분 뒤 태양을 가릴 구름을 미리 본다'는 가정에 따라, 한두 구간 뒤 투과율의 평균에 잡음을 더해 만들었다. 설비 용량은 ${E.data.kwp} kW, 시험 기간 평균 부하는 ${E.data.mean_load} kW 이다.`);
para(`앞 ${E.data.train_days}일로 학습·보정하고 뒤 ${E.data.test_days}일을 시험에 썼다. 시험 기간에는 2시간마다 24시간 예측을 발행했다(${E.data.issues}회). 오차는 평균 절대 오차를 부하는 평균 부하로, 태양광은 설비 용량으로 나눈 값(%)이며 태양광은 낮 구간만 센다. 기준선은 전일 같은 시각의 값이다.`);
b.push(H2("5.2 기본 예측 비교 결과"));
tbl(`시험 ${E.data.test_days}일의 예측 오차와 구간 포함률`, ["대상", "방법", "24시간", "2시간 이내", "80% 구간 포함률"],
  [["부하", "전일 같은 시각", pc(E.load.base), pc(E.load.base_near), "—"], ["부하", "릿지 회귀", pc(E.load.nmae), pc(E.load.near), E.load.cov + "%"], ["태양광", "전일 같은 시각", pc(P0.base), pc(P0.base_near), "—"]].concat(PV.map(p => ["태양광", p.name, pc(p.nmae), pc(p.near), p.cov + "%"])), [12, 36, 16, 18, 18], { bold: [0], center: [2, 3, 4] });
tbl("태양광 예측의 선행시간 구간별 오차(설비 용량 대비 %)와 섞는 비율", ["구간"].concat(E.data.buckets.map(x => "≤ " + x + "h")),
  [["전일 같은 시각"].concat(P0.base_by_h.map(pc)), ["릿지 회귀"].concat(P0.by_h.map(pc)), ["＋하늘 카메라"].concat(P1.by_h.map(pc)), ["＋주의집중"].concat(P3.by_h.map(pc)), ["α_b"].concat(P3.alpha.map(a => Math.round(a * 100) + "%"))], [22, 13, 13, 13, 13, 13, 13], { bold: [0], center: [1, 2, 3, 4, 5, 6] });
ch("pv_h", "태양광 예측의 선행시간 구간별 오차"); ch("load_h", "부하 예측의 선행시간 구간별 오차");
para(`부하는 전 구간에서 기준선보다 낮았다(24시간 ${pc(E.load.base)} → ${pc(E.load.nmae)}, ${cut(E.load.base, E.load.nmae)}% 감소). 태양광은 릿지 회귀만으로 기준선 대비 24시간 오차가 ${cut(P0.base, P0.nmae)}% 낮았고, 하늘 카메라를 넣으면 1시간 이내 오차가 ${pc(P0.by_h[0])}에서 ${pc(P1.by_h[0])}로, 주의집중을 섞으면 ${pc(P3.by_h[0])}로 줄었다. 2시간 이내로 보면 ${pc(P0.near)} → ${pc(P1.near)} → ${pc(P3.near)}이다. 반면 4시간 이후 구간에서는 세 구성의 차이가 0.05%p 이내였고, 24시간 전체 오차는 ${pc(P0.nmae)}에서 ${pc(P3.nmae)}로 사실상 같았다.`);
para(`섞는 비율은 ${E.data.buckets.map((x, i) => "≤" + x + "h " + Math.round(P3.alpha[i] * 100) + "%").join(", ")}로 정해졌다. 가까운 두 구간에서 주의집중의 몫이 크고 중간 구간은 0 이다. 16시간 이내 구간에서는 25%가 선택되었으나 시험 오차는 ${pc(P1.by_h[4])}에서 ${pc(P3.by_h[4])}로 오히려 조금 늘어, 보정 구간에서의 선택이 시험 구간에서 항상 유지되지는 않음을 보인다. 80% 구간 포함률은 부하 ${E.load.cov}%, 태양광 ${P3.cov}%로 목표 부근이었다.`);
ch("fc_pv", "태양광 24시간 예측의 한 예"); ch("att_w", "한 번의 예측에서 가중치가 큰 기억 40건의 가중치");
para(`그림 ${figN - 1}·${figN}의 예측에서 가중치가 가장 큰 기억은 ${E.sample.refs.slice(0, 3).map(r => r[0] + "(" + r[1] + "%)").join(", ")}였다. 위 10건의 합은 ${E.sample.top10_share}%, 유효 기억 수(1/Σw²)는 ${E.sample.eff_n}건으로, 예측이 소수의 특이한 날에 좌우되지 않고 닮은 상황 수백 건의 평균에 가깝다. 학습된 중요도는 가까운 예측에서 ${E.att.top_near.slice(0, 2).map(r => r[0] + "(" + r[1] + ")").join(", ")}, 먼 예측에서 ${E.att.top_far.slice(0, 3).map(r => r[0] + "(" + r[1] + ")").join(", ")} 순으로 컸다.`);
b.push(H2("5.3 지속 학습과 계산 비용"));
{ const c = LE.cycles, d = LE.drift, r = (lab, k, kn) => [lab, kn, pc(k.current), pc(k.new), k.better ? "교체" : "유지"];
  tbl("학습 주기별 판단(자료가 쌓이는 경우와 부하가 30% 늘어난 경우)", ["상황", "종류", "현재 모델", "도전 모델", "판단"], [r("45일째", c[1].kinds.load, "부하"), r("45일째", c[1].kinds.pv, "태양광"), r("60일째", c[2].kinds.load, "부하"), r("60일째", c[2].kinds.pv, "태양광"), r("부하 30% 증가 뒤", d.kinds.load, "부하")], [30, 14, 19, 19, 18], { bold: [0], center: [1, 2, 3, 4] });
  para(`자료의 성질이 변하지 않는 동안에는 개선 폭이 작고, 검증 오차가 더 큰 도전 모델은 걸러졌다. 부하가 30% 늘어난 경우에는 이전 모델의 오차가 ${pc(d.kinds.load.current)}까지 커졌다가 다시 학습한 모델에서 ${pc(d.kinds.load.new)}로 돌아왔다.`); }
tbl("계산 비용(노트북 CPU, 단일 프로세스)", ["항목", "값"], [["학습되는 값(태양광)", `릿지 ${E.cost.params_ridge} + 중요도 ${E.cost.params_att} + 비율 ${E.cost.params_alpha} = ${NP}개`], ["학습 시간", `부하 ${E.cost.train_load_s}초, 태양광 ${E.cost.train_pv_s}초`], ["24시간 예측 한 번(부하+태양광)", `${E.cost.predict_s}초`], ["모델 파일", `부하 ${E.cost.load_kb} KB, 태양광 ${E.cost.pv_kb} KB`]], [40, 60], { bold: [0] });

b.push(H2("5.4 실측 앙상블과 예측 구간의 독립 평가"));
para(`5.1~5.2절의 시험은 합성 하늘 카메라 열을 포함한다. 이 열은 한두 구간 뒤의 투과율로 만든 것이어서 미래 정보를 일부 담고 있으므로, 단기 실측 앙상블의 효과는 이 열을 지운 별도 시험으로 쟀다. 서로 다른 난수 씨앗 ${BN.seeds.length}개(${BN.seeds.join(", ")})로 120일 자료를 만들고, 각각 ${BN.fit_days}일 학습, ${BN.tune_days}일 가중치 선택, ${BN.test_days}일 시험으로 나누었다. 시험 기간에는 2시간마다 24시간 예측을 발행했다(세트당 ${BN.origins}회). 같은 기본 모델에 대해 단기 실측 결합 전후를 비교했다.`);
{ const nm = k => k === "pv" ? "태양광" : "부하", f2 = v => v.toFixed(2), rows = [...BN.rows].sort((x, y) => x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : x.seed - y.seed);
  tbl("단기 실측 앙상블 적용 전후의 NMAE(%)", ["시드 · 대상", "가중치", "15분", "1시간 누적", "24시간 누적", "15분 변화"], rows.map(r => [`${r.seed} · ${nm(r.kind)}`, r.w.join(" / "), `${f2(r.nmae["15m"][0])} → ${f2(r.nmae["15m"][1])}`, `${f2(r.nmae["1h"][0])} → ${f2(r.nmae["1h"][1])}`, `${f2(r.nmae["24h"][0])} → ${f2(r.nmae["24h"][1])}`, r.nmae["15m"][0] === r.nmae["15m"][1] ? "미적용" : cut(r.nmae["15m"][0], r.nmae["15m"][1]) + "% 감소"]), [17, 19, 17, 17, 17, 13], { bold: [0], center: [1, 2, 3, 4, 5] });
  ch("bench15", "독립 시험 세트별 15분 앞 예측 오차(적용 전후)");
  para(`15분 앞 오차는 부하에서 평균 ${BA.load.cut15_mean}%(${BA.load.cut15_min}~${BA.load.cut15_max}%), 태양광에서 평균 ${BA.pv.cut15_mean}%(${BA.pv.cut15_min}~${BA.pv.cut15_max}%) 줄었다. 부하는 ${BA.load.n}세트 중 ${BA.load.used}세트, 태양광은 ${BA.pv.used}세트에서 0 이 아닌 가중치가 채택되었고, 채택 조건을 통과하지 못한 세트에서는 결합을 쓰지 않아 오차가 그대로였다. 오차가 늘어난 세트는 없었다. 1시간 누적으로 보면 부하 ${BA.load.nmae1h[0]}% → ${BA.load.nmae1h[1]}%, 태양광 ${BA.pv.nmae1h[0]}% → ${BA.pv.nmae1h[1]}%이고, 24시간 누적은 부하 ${BA.load.nmae24[0]}% → ${BA.load.nmae24[1]}%, 태양광 ${BA.pv.nmae24[0]}% → ${BA.pv.nmae24[1]}%로 사실상 같다. 결합 가중치를 4시간 이후에는 쓰지 않으므로 예상된 결과이다.`);
  tbl("24시간 예측 구간 포함률(%) — 보정 방식별", ["대상", "한 번 보정 (최소~최대, 평균)", "매일 보정 + 변동 여유 (최소~최대, 평균)", "배율 s (세트 평균의 범위)"], ["load", "pv"].map(k => [nm(k), `${BA[k].cov24_static[0]} ~ ${BA[k].cov24_static[1]},  ${BA[k].cov24_static[2]}`, `${BA[k].cov24[0]} ~ ${BA[k].cov24[1]},  ${BA[k].cov24[2]}`, `${BA[k].scale[0]} ~ ${BA[k].scale[1]}`]), [14, 30, 34, 22], { bold: [0], center: [1, 2, 3] });
  ch("cov24", "독립 시험 세트별 24시간 예측 구간 포함률");
  para(`예측 구간은 재점검에서 문제가 드러난 부분이다. 학습 때 한 번만 보정한 구간으로 학습 8~22일 뒤를 재면 태양광의 24시간 포함률이 세트에 따라 ${BA.pv.cov24_static[0]}%까지 내려갔다. 실제 운용에서는 학습 주기(24시간)마다 구간을 다시 맞추므로 시험도 그렇게 재도록 고쳤고, 여기에 4.2절의 변동 여유를 더했다. 그 결과 24시간 포함률은 부하 ${BA.load.cov24[0]}~${BA.load.cov24[1]}%(평균 ${BA.load.cov24[2]}%), 태양광 ${BA.pv.cov24[0]}~${BA.pv.cov24[1]}%(평균 ${BA.pv.cov24[2]}%)로 목표 80% 부근에 모였다. 다만 배율을 모든 선행시간 구간에 같이 쓰기 때문에 15분~1시간 구간의 태양광 포함률은 90% 안팎으로 목표보다 넓게 나온다.`); }

// ── 6. 고찰
b.push(H2("5.5 날씨 정보 결합의 평가"));
{ const R = (k, m) => WX.cases[k][m].rows, fx = v => v == null ? "—" : v.toFixed(2), cutp = (a, b) => ((a - b) / a * 100).toFixed(1), A = R(WXK[0], "full"), B = R(WXK[1], "full"), Ap = R(WXK[0], "plain"), n = A.length - 1;
  para(`합성 자료 ${WX.method.days}일 가운데 마지막 ${WX.method.hold_days}일을 빼고 학습한 뒤, 그 ${WX.method.hold_days}일을 시간 순서대로 지나가며 1시간마다 24시간 예측을 내고 제품과 같은 코드로 날씨 기록을 섞었다. 수기 입력은 하루 세 번(07 · 12 · 17시) 넣는 것으로, 앱의 표기는 그 기간의 실제 평균 구름에 가장 가까운 다섯 가지 가운데 하나이고 한 칸 어긋날 확률을 오늘 25%, 내일 35% 로 두었다. 통신망 자료는 6시간마다 받는 시간별 운량이며 오차의 표준편차를 1.0 + 0.05 × 선행시간(시간)으로 두었다. 씨앗 ${WX.method.seeds.length}개의 결과를 합쳤고, 오차는 날씨 기록이 있는 낮 시간만 설비 용량 대비 평균 절대 오차로 쟀다.`);
  tbl("날씨 정보 결합의 효과(설비 용량 대비 평균 절대 오차 %, 합성 자료)", ["선행시간", "수기: AI", "수기: 날씨만", "수기: 결합", "통신망: AI", "통신망: 날씨만", "통신망: 결합"], A.map((r, i) => [r.h.replace("(날씨 기록이 있는 낮 시간)", ""), fx(r.ai), fx(r.wx), fx(r.mix), fx(B[i].ai), fx(B[i].wx), fx(B[i].mix)]), [22, 13, 13, 13, 13, 13, 13], { bold: [0], center: [1, 2, 3, 4, 5, 6] });
  para(`날씨 기록이 있는 낮 시간 전체에서 수기 입력은 ${fx(A[n].ai)}% 를 ${fx(A[n].mix)}% 로(${cutp(A[n].ai, A[n].mix)}% 감소), 통신망 자료는 ${fx(B[n].ai)}% 를 ${fx(B[n].mix)}% 로(${cutp(B[n].ai, B[n].mix)}% 감소) 줄였다. 효과는 먼 선행시간에서 크다 — 6~24시간에서 수기 ${fx(A[3].ai)} → ${fx(A[3].mix)}%, 통신망 ${fx(B[3].ai)} → ${fx(B[3].mix)}%. 1시간 이내는 직전 실측을 쓰는 기본 예측이 이미 정확해서 수기 입력에서는 ${fx(A[0].ai)}% 가 ${fx(A[0].mix)}% 로 ${A[0].mix > A[0].ai ? "오히려 조금 커졌고" : "거의 같았고"}, 통신망 자료에서는 ${fx(B[0].ai)} → ${fx(B[0].mix)}% 였다. 표기별 실측 보정은 수기 입력의 '날씨만' 오차를 ${fx(Ap[n].wx)}% 에서 ${fx(A[n].wx)}% 로 줄였다.`);
  para("이 결과는 합성 자료가 날씨를 하루 단위의 맑음 · 구름 · 흐림 상태로 바꾸게 만들어져 '내일 날씨'가 실제 정보가 되는 조건에서 얻은 것이다. 앱과 통신망 예보의 오차 크기는 가정이다. 현장에서는 화면에 표시되는 견준 오차와 선행시간별 가중치로 효과를 다시 확인해야 한다."); }

b.push(H1("6. 고찰과 한계"));
para("효과는 가까운 구간에 집중되었다. 하늘 카메라는 태양을 가리기 전의 구름을 먼저 보므로 수십 분~2시간의 예측을 돕지만, 반나절 뒤의 날씨에 대해서는 정보를 주지 못한다. 외부 예보를 쓸 수 없는 조건에서 먼 구간의 오차는 계절과 최근 추세가 설명하는 수준에 머문다. EMS 의 발전기 기동과 ESS 충·방전 판단은 가까운 구간의 예측에 민감하므로 이 개선은 실용적 의미가 있으나, 연료 절감량으로 환산한 효과는 본 논문에서 측정하지 않았다.");
para("본 연구의 가장 큰 한계는 합성 자료이다. 예측 정확도만 쟀으며 발전기 기동 횟수, ESS 여유, 연료 소비에 주는 운전 효과는 재지 않았다. 실제 부하와 날씨는 합성 과정보다 불규칙하며, 특히 '카메라가 15~30분 뒤의 구름을 본다'는 가정은 결과에 직접 영향을 준다. 실제 선행 시간은 구름 높이와 풍속에 따라 달라지고, 색 비율과 고정 경계값에 의한 구름 판정은 태양 주변의 눈부심, 렌즈 오염, 박무에 약하다고 알려져 있다. 따라서 표의 개선 폭을 현장에서 그대로 기대할 수는 없다. 다만 섞는 비율과 모델 교체가 모두 검증 오차로 결정되므로, 현장에서 카메라나 주의집중이 도움이 되지 않으면 해당 요소가 자동으로 꺼지고 릿지 회귀 수준의 성능이 유지되도록 설계되어 있다.");
para("그 밖의 한계로, 비교 대상이 전일 같은 시각과 자체 구성 요소에 한정되어 다른 학습 방법(나무 기반 모형, 순환·합성곱 신경망 등)과의 비교가 없다. 시험 기간이 14일로 짧아 계절 변화에 대한 평가가 부족하고, 16시간 이내 구간의 예에서 보듯 보정 구간에서 고른 비율이 시험 구간에서 유지되지 않는 경우가 있다. 단기 실측 앙상블의 효과는 4시간 이내에 한정되며, 독립 시험 역시 합성 자료 여섯 세트에 그친다. 변동 여유는 포함률을 목표 부근으로 올리지만 가까운 구간에서는 구간을 필요 이상으로 넓힌다. 또한 본 모델은 학습 값이 백수십 개인 통계 모형으로, 주의집중 연산의 원리를 빌렸을 뿐 대형 언어 모델과 같은 일반적 능력을 갖는 것은 아니다.");

// ── 7. 결론
b.push(H1("7. 결론"));
para(`외부 기상 예보 없이 노트북급 장치에서 동작하는 부하·태양광 24시간 예측 방법을 제시했다. 릿지 회귀에 하늘 카메라 구름량과 주의집중 예측을 검증된 비율로 결합했으며, 운용 중 재학습은 학습에 쓰지 않은 자료에서 나쁘지 않을 때만 적용한다. 합성 자료에서 태양광의 2시간 이내 오차는 ${cut(P0.near, P3.near)}% 줄었고 24시간 전체는 거의 같았다. 여기에 검증 기반 단기 실측 앙상블을 더해 독립 시험에서 15분 앞 오차를 부하 평균 ${BA.load.cut15_mean}%, 태양광 평균 ${BA.pv.cut15_mean}% 줄였고, 변동 여유로 24시간 예측 구간 포함률을 목표 부근으로 맞췄다. 앞으로 시험 운용에서 얻는 실측 자료와 실제 카메라 사진으로 같은 평가를 반복하고, 구름 판정의 현장 보정과 예측 개선이 연료 소비에 주는 영향을 측정할 계획이다.`);

// ── 참고문헌·부록
b.push(H1("참고문헌"));
["[1] A. E. Hoerl and R. W. Kennard, “Ridge regression: Biased estimation for nonorthogonal problems,” Technometrics, vol. 12, no. 1, pp. 55–67, 1970.",
 "[2] T. Hong and S. Fan, “Probabilistic electric load forecasting: A tutorial review,” International Journal of Forecasting, vol. 32, no. 3, pp. 914–938, 2016.",
 "[3] R. Koenker and G. Bassett, “Regression quantiles,” Econometrica, vol. 46, no. 1, pp. 33–50, 1978.",
 "[4] C. N. Long, J. M. Sabburg, J. Calbó, and D. Pagès, “Retrieving cloud characteristics from ground-based daytime color all-sky images,” Journal of Atmospheric and Oceanic Technology, vol. 23, no. 5, pp. 633–652, 2006.",
 "[5] A. Heinle, A. Macke, and A. Srivastav, “Automatic cloud classification of whole sky images,” Atmospheric Measurement Techniques, vol. 3, no. 3, pp. 557–567, 2010.",
 "[6] Q. Li, W. Lu, and J. Yang, “A hybrid thresholding algorithm for cloud detection on ground-based color images,” Journal of Atmospheric and Oceanic Technology, vol. 28, no. 10, pp. 1286–1296, 2011.",
 "[7] C. W. Chow et al., “Intra-hour forecasting with a total sky imager at the UC San Diego solar energy testbed,” Solar Energy, vol. 85, no. 11, pp. 2881–2893, 2011.",
 "[8] A. Vaswani et al., “Attention is all you need,” in Advances in Neural Information Processing Systems 30, 2017.",
 "[9] E. A. Nadaraya, “On estimating regression,” Theory of Probability and Its Applications, vol. 9, no. 1, pp. 141–142, 1964.",
 "[10] G. S. Watson, “Smooth regression analysis,” Sankhyā: The Indian Journal of Statistics, Series A, vol. 26, no. 4, pp. 359–372, 1964.",
 "[11] F. Kasten and G. Czeplak, “Solar and terrestrial radiation dependent on the amount and type of cloud,” Solar Energy, vol. 24, no. 2, pp. 177–189, 1980."].forEach(t => b.push(P(t, { spacing: { after: 60, line: 280 }, indent: { left: 420, hanging: 420 } })));
b.push(H1("부록 A. 재현 방법과 설정값"));
tbl("주요 설정값", ["항목", "값", "항목", "값"], [["시간 간격 / 예측 범위", "15분 / 96구간", "릿지 벌점 λ", "3"], ["선행시간 구간", "≤1·2·4·8·16·24시간", "전일 값 혼합", "20%"], ["보정 구간", "최근 7일", "예측 구간", "10~90% 분위수"], ["변동 여유", "최근 2일, 하한 75%", "배율 후보", "1 ~ 2.5 (7단계)"], ["실측 가중치 후보", "0, ¼, ½, ¾, 1", "실측 채택 조건", "40표본, MAE 2%↓, 포함률 −2%p 이내"], ["구름 판정 경계", "ρ > −0.12", "사진 유효 시간", "180초"], ["기억 간격", "1시간", "중요도 후보", "×2, ×½, 0 (2회)"], ["섞는 비율 후보", "0, ¼, ½, ¾, 1", "최소 개선", "2%"], ["검증 구간", "최근 3일", "재학습 주기", "24시간"], ["정확도 한도", "NMAE 15%", "보관 판 수", "10"]], [26, 24, 26, 24], { bold: [0, 2] });
para("수치와 그림은 다음 순서로 다시 만들 수 있다: python docs/ppt/ai_paper_eval.py (수치) → node docs/ppt/ai_render3d.js (입체 그림) → node docs/ppt/ai_charts.js (그래프) → python docs/build_all.py (문서). 독립 시험은 python -m tools.forecast_benchmark --out docs/forecast_benchmark.json (매일 보정) 과 --static-interval (한 번 보정) 로 다시 잴 수 있다. 구현은 ifps_ems/forecast.py, attn.py, skycam.py, nowcast.py, learner.py 에 있으며 시험은 tests/test_sky.py, test_learner.py, test_nowcast.py, test_interval.py 이다.");
para("입체 그림(어두운 바탕의 그림)은 꾸민 그림이 아니라 학습된 값(가중치·거리·중요도·비율), 실제 예측, 실제 결합 함수의 출력을 3차원 좌표에 그대로 놓고 렌더링한 것이다. 본 문서는 심사를 거치지 않은 기술 논문 초안이다.");
L.save(b, OUT, `이동형 전력체계 EMS AI 예측 논문(초안) ${REV}`);
