# -*- coding: utf-8 -*-
"""군 운용 논리: 운용 태세(평시·저소음·자립), 부하 우선순위 자동 차단·복구, 자립 지속시간, 주둔지(상전 연계) 운전.

통신을 하지 않는 순수 계산 함수 모음이다(시험하기 쉽게). 실행기(Runtime)가 값을 넣어 부르고 결과를 장비에 쓴다.

용어
  운용 장소  작전지(island): 상전 없이 자체 전원으로 운전 / 주둔지(grid): 상전(군 전력)에 연계, 역송 없음
  운용 태세  평시 / 저소음(디젤 금지, 연료전지 허용, 3등급 부하 차단) / 자립(외부 보급 없이 목표 시간 버티기)
"""
from dataclasses import dataclass, field, fields

POSTURES = ("평시", "저소음", "자립")
PLACES = ("island", "grid")


@dataclass
class Garrison:
    """주둔지 운전 설정(runtime.json 의 garrison). 요금 단가는 현장 계약에 맞춰 넣는다(0 이면 금액을 계산하지 않는다)."""
    peak_kw: float = 150.0            # 수전 전력 상한 목표(피크 억제). 이 값을 넘으면 ESS 가 방전해 깎는다
    import_min_kw: float = 5.0        # 최소 수전 전력. 역송을 막기 위해 항상 이만큼은 받는다
    reserve_soc: float = 0.50         # 정전 대비 ESS 충전율 하한. 요금 절감 방전은 이 아래로 내려가지 않는다
    charge_kw: float = 150.0          # 경부하 시간대 충전 전력
    peak_hours: list = field(default_factory=lambda: [[10, 12], [13, 17]])        # 최대부하 시간대(방전)
    offpeak_hours: list = field(default_factory=lambda: [[23, 24], [0, 9]])       # 경부하 시간대(충전)
    price_peak: float = 0.0           # 원/kWh (선택)
    price_mid: float = 0.0
    price_off: float = 0.0
    restore_s: float = 30.0           # 복전 뒤 이 시간 동안 안정하면 주둔지 운전으로 복귀
    # 주둔지 기존 디젤발전기(비상발전기, MW급). 정전 중 ESS·태양광과 함께 무정전 자립 운전에 쓴다
    gdg_kw: float = 1000.0            # 정격(대당)
    gdg_min_load: float = 0.30        # 최소 부하율. 이보다 낮으면 ESS 충전으로 부하를 올린다(저부하 운전 방지)
    gdg_delay_s: float = 30.0         # 정전이 이 시간 넘게 이어지면 기동(짧은 정전은 ESS 로만 버틴다)
    gdg_stop_soc: float = 0.85        # ESS 가 이만큼 차면 정지하고 ESS·태양광으로 운전
    gdg_restart_soc: float = 0.35     # 이 아래로 내려가면 다시 기동
    gdg_tank_l: float = 5000.0        # 연료 탱크 용량(L, 대당) — 자립 지속시간 계산용
    gdg_l_per_kwh: float = 0.26       # 연료 소비율(L/kWh)

    @classmethod
    def from_cfg(cls, c):
        c = c or {}; names = {f.name for f in fields(cls)}; return cls(**{k: v for k, v in c.items() if k in names})

    def band(self, hr):
        """시각 → 'peak' / 'off' / 'mid'"""
        inb = lambda bands: any(a <= hr < b for a, b in bands)
        return "peak" if inb(self.peak_hours) else "off" if inb(self.offpeak_hours) else "mid"

    def price(self, hr):
        return {"peak": self.price_peak, "off": self.price_off, "mid": self.price_mid}[self.band(hr)]


def garrison_step(site, g, hr, load_kw, pv_kw, elz_kw, soc, h2_nm3):
    """주둔지(상전 연계) 한 주기의 목표값. 역송 없음·피크 억제·시간대 충방전·정전 대비 충전율 유지.

    반환: {grid: 목표 수전 kW, ess: ESS 지령 kW(+방전/−충전), pv_lim: PV 출력 제한 kW(0 = 제한 없음), elz: 수전해 기동 여부, why: 설명}
    """
    elz_on = elz_kw > 1.0                                           # 수전해 운전 중(소비 전력으로 판단)
    net = load_kw + elz_kw - pv_kw                                  # ESS 가 가만히 있을 때의 수전 전력(음수면 남는 전력)
    band = g.band(hr); why = []
    can_dis = max(0.0, min(site.ess_kw, (soc - g.reserve_soc) * site.ess_kwh * site.ess_eff * 4))        # 15분 안에 하한에 닿지 않는 범위
    can_chg = max(0.0, min(site.ess_kw, (site.soc_max - soc) * site.ess_kwh / site.ess_eff * 4))
    if band == "peak" and can_dis > 0: target = g.import_min_kw; why.append("최대부하 시간대: ESS 방전으로 수전 축소")
    elif band == "off" and can_chg > 0: target = min(g.peak_kw, net + min(g.charge_kw, can_chg)); why.append("경부하 시간대: ESS 충전")
    else: target = net
    if soc < g.reserve_soc - 0.02 and can_chg > 0:                    # 정전 대비 하한 아래면 시간대와 무관하게 채운다
        target = max(target, min(g.peak_kw, net + min(g.charge_kw, can_chg))); why.append("정전 대비 충전율 회복")
    target = min(target, g.peak_kw) if net > g.peak_kw and can_dis > 0 else target                     # 피크 억제
    if net > g.peak_kw and can_dis > 0: why.append(f"피크 억제({g.peak_kw:.0f}kW)")
    target = max(target, g.import_min_kw)                           # 역송 금지: 최소 수전 유지
    ess = max(-can_chg, min(can_dis, net - target))
    grid = net - ess; pv_lim = 0.0; elz = bool(elz_on)
    surplus = g.import_min_kw - grid                                # ESS 로도 못 받는 남는 전력
    h2_room = h2_nm3 < site.h2_nm3 * 0.95
    if surplus > 0:
        if not elz_on and h2_room and surplus >= site.elz_kw * 0.5: elz = True; why.append("남는 전력 → 수전해 기동")
        else: pv_lim = max(1.0, pv_kw - surplus); why.append("남는 전력 → PV 출력 제한(역송 방지)")
    elif elz_on and (not h2_room or grid - g.import_min_kw > site.elz_kw * 0.5):
        elz = False; why.append("남는 전력 없음 → 수전해 정지")       # 상전을 사서 수소를 만들지는 않는다
    return {"grid": round(g.import_min_kw if pv_lim else grid, 1), "ess": round(ess, 1), "pv_lim": round(pv_lim, 1), "elz": elz, "band": band, "why": " · ".join(why) or "수전으로 부하 공급"}


def gdg_step(site, g, outage_s, soc, running, net_kw):
    """주둔지 정전 중 기존 디젤발전기 운용 판단. net_kw = 부하 + 수전해 − 태양광 − (이동형 디젤·연료전지 출력).

    기동: 정전이 gdg_delay_s 넘게 이어지고 ESS 에 여유가 없거나, 충전율이 gdg_restart_soc 아래일 때.
    정지: ESS 가 gdg_stop_soc 까지 차고 ESS 만으로 부하를 감당할 수 있을 때(그 뒤 충전율이 내려가면 다시 기동).
    운전 중: 발전기 부하가 최소 부하율 아래면 ESS 충전으로 올리고, 정격을 넘으면 ESS 방전으로 메운다.
    반환: {run: 기동 여부, ess: ESS 지령 kW(+방전/−충전), gdg: 예상 발전기 부하 kW, why}"""
    can_chg = max(0.0, min(site.ess_kw, (site.soc_max - soc) * site.ess_kwh / site.ess_eff * 4))
    can_dis = max(0.0, min(site.ess_kw, (soc - site.soc_min) * site.ess_kwh * site.ess_eff * 4))
    if running:
        run = not (soc >= g.gdg_stop_soc and net_kw <= can_dis); why = "ESS 충전 완료 → 발전기 정지, ESS·태양광으로 운전" if not run else "발전기 운전"
    else:
        low = soc < g.gdg_restart_soc; run = low or (outage_s >= g.gdg_delay_s and soc < g.gdg_stop_soc - 0.10) or net_kw > can_dis
        why = ("충전율 낮음 → 발전기 기동" if low else "정전 지속 → 발전기 기동" if run else "ESS·태양광으로 운전(발전기 대기)")
    if not run: return {"run": False, "ess": 0.0, "gdg": 0.0, "why": why}
    target = min(g.gdg_kw, max(net_kw, g.gdg_min_load * g.gdg_kw))          # 발전기에 지울 부하
    ess = max(-can_chg, min(can_dis, net_kw - target))
    if ess < -1.0: why += f" · ESS 충전으로 부하율 {g.gdg_min_load * 100:.0f}% 유지"
    return {"run": True, "ess": round(ess, 1), "gdg": round(max(0.0, net_kw - ess), 1), "why": why}


def autonomy(site, soc, h2_nm3, fuel_l, loads, pv_kwh_day=0.0, quiet=False, extra_kwh=0.0):
    """외부 보급 없이 버틸 수 있는 시간(시간). 전 부하 / 3등급 차단 / 1등급만. quiet(저소음)면 디젤 연료를 세지 않는다.
    저장 에너지(ESS·수소·연료)에 하루 평균 태양광을 더해 계산한다. 반환: {full, shed3, p1, store_kwh}"""
    p1_kw, p2_kw, p3_kw = loads                                     # 1·2·3등급 부하(kW)
    e_ess = max(0.0, soc - site.soc_min) * site.ess_kwh * site.ess_eff
    e_h2 = max(0.0, h2_nm3 - site.h2_nm3 * site.h2_min) / site.fc_nm3_per_kwh
    e_dg = 0.0 if quiet else max(0.0, fuel_l) / site.dg_l_per_kwh
    store = e_ess + e_h2 + e_dg + max(0.0, extra_kwh); pv_avg = max(0.0, pv_kwh_day) / 24.0
    def hours(load):
        if load <= 0.5: return 999.0
        need = load - pv_avg
        return 999.0 if need <= 0.5 else min(999.0, store / need)
    return {"full": round(hours(p1_kw + p2_kw + p3_kw), 1), "shed3": round(hours(p1_kw + p2_kw), 1), "p1": round(hours(p1_kw), 1), "store_kwh": round(store, 0),
            "ess_kwh": round(e_ess, 0), "h2_kwh": round(e_h2, 0), "dg_kwh": round(e_dg, 0), "gdg_kwh": round(max(0.0, extra_kwh), 0)}


class LoadShedder:
    """부하 우선순위 자동 차단·복구. 3등급 → 2등급 순으로 끊고 반대 순서로 살린다. 1등급은 끊지 않는다.

    차단 조건이 hold_s(기본 3초) 이어지면 차단하고, 해소된 상태가 restore_s(기본 60초) 이어지면 복구한다.
    EMS 가 스스로 끊은 급전선만 되살린다(운용자·보호 IED 가 연 차단기는 건드리지 않는다)."""

    def __init__(self, hold_s=3.0, restore_s=60.0):
        self.hold_s, self.restore_s = hold_s, restore_s; self.t_bad = {}; self.t_ok = {}; self.mine = set(); self.why = {}

    @staticmethod
    def want(site, posture, soc, src_avail_kw, load12_kw, load_kw, auto_h=None, target_h=72.0):
        """지금 끊어야 할 등급과 이유. 반환: {"L3": 사유 또는 "", "L2": 사유 또는 ""}"""
        w = {"L3": "", "L2": ""}; lo = site.soc_min
        if posture == "저소음": w["L3"] = "저소음 태세: 3등급 차단으로 지속시간 연장"
        if posture == "자립" and auto_h:
            if auto_h["full"] < target_h: w["L3"] = f"자립 태세: 전 부하 {auto_h['full']:.0f}시간 < 목표 {target_h:.0f}시간"
            if auto_h["shed3"] < target_h * 0.5: w["L2"] = f"자립 태세: 3등급 차단 후에도 {auto_h['shed3']:.0f}시간"
        if soc < lo + 0.06: w["L3"] = w["L3"] or f"ESS 충전율 {soc * 100:.0f}% — 자원 부족"
        if soc < lo + 0.03: w["L2"] = w["L2"] or f"ESS 충전율 {soc * 100:.0f}% — 자원 고갈 임박"
        if src_avail_kw is not None and load_kw > src_avail_kw + 1.0: w["L3"] = w["L3"] or f"공급 능력 {src_avail_kw:.0f}kW < 부하 {load_kw:.0f}kW"
        if src_avail_kw is not None and load12_kw > src_avail_kw + 1.0: w["L2"] = w["L2"] or f"공급 능력 {src_avail_kw:.0f}kW < 1·2등급 {load12_kw:.0f}kW"
        if w["L2"] and not w["L3"]: w["L3"] = w["L2"]                # 2등급을 끊을 상황이면 3등급은 당연히 끊는다
        return w

    def step(self, t, want, cb, soc, soc_min):
        """t: 시각(초), want: want() 결과, cb: {"L2": 0/1/2/None, "L3": …}. 반환: [(급전선, "shed"|"restore", 사유)]"""
        acts = []
        for f in ("L3", "L2"):
            if want[f]:
                self.t_ok.pop(f, None); self.t_bad.setdefault(f, t)
                if cb.get(f) == 1 and t - self.t_bad[f] >= self.hold_s: acts.append((f, "shed", want[f])); self.mine.add(f); self.why[f] = want[f]
            else:
                self.t_bad.pop(f, None)
                if f in self.mine:
                    if cb.get(f) == 1: self.mine.discard(f); self.why.pop(f, None); continue      # 운용자가 이미 살렸다
                    self.t_ok.setdefault(f, t)
                    ready = soc is None or soc > soc_min + 0.10
                    if ready and t - self.t_ok[f] >= self.restore_s and (f == "L2" or "L2" not in self.mine or cb.get("L2") == 1):
                        acts.append((f, "restore", "차단 사유 해소")); self.t_ok.pop(f, None)
        order = {"shed": {"L3": 0, "L2": 1}, "restore": {"L2": 0, "L3": 1}}
        return sorted(acts, key=lambda a: order[a[1]][a[0]])
