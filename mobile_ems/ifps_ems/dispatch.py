# -*- coding: utf-8 -*-
"""24시간 운전계획(동적계획법)과 규칙 운전, 자립 운전 N-1 예비력. 로직 설명서 7·8장.

상태: ESS 충전율(41) × 수소 잔량(13) × 직전 디젤 운전 여부(2)
결정: (디젤, 연료전지, 수전해) 6가지 조합
비용: 모든 항을 디젤 연료 L로 환산해 더한다.
"""
import numpy as np
from .config import HORIZON, DT_H

SHED_COST = (100.0, 5.0, 0.5)      # 1·2·3등급 부하 차단 벌점(L/kWh)
START_L = 1.5                      # 디젤 기동 손실(L/회)
SILENT_L = 4.0                     # 무소음 시간대(20~06시) 디젤 운전 벌점(L/구간)
RESERVE = 0.08                     # 예비 침범 기준: 하한 + 8%p
RESERVE_L = 3.0                    # 예비 침범 벌점(L/kWh)
CURTAIL_L = 0.002                  # 출력 제한 벌점(L/kWh)
FC_IDLE = 0.05                     # 연료전지 대기(순동 예비) 소비율
TERM_ESS, TERM_H2 = 0.9, 0.5       # 끝 구간 잔량 가치(디젤 연료 환산 배수)
ACTIONS = np.array([(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 1)], dtype=int)
N_SOC, N_H2 = 41, 13


def silent_hour(hr):
    return hr >= 20 or hr < 6


def kappa_for(days_since_deploy):
    """보수 계수: 전개 첫 7일은 1.0, 이후 0.5."""
    return 1.0 if days_since_deploy < 7 else 0.5


def reserve_need(load12_kw, online_kw):
    """N-1 순동 예비력: (병렬 전원 합 − 가장 큰 1대) < 1·2등급 부하 이면 True."""
    online_kw = [x for x in online_kw if x > 0]
    if not online_kw: return load12_kw > 0
    return sum(online_kw) - max(online_kw) < load12_kw


def rule_action(site, soc, h2, dg_on, fc_on, load_kw, pv_kw, hr):
    """충전율 문턱값 규칙(이력 현상 포함). 반환: (디젤, 연료전지, 수전해) 0/1."""
    lo = site.soc_min
    dg = 1 if soc < lo + 0.10 else (0 if soc > lo + 0.45 else int(bool(dg_on)))
    h2_ok = h2 > site.h2_nm3 * site.h2_min * 1.2
    fc = 1 if (soc < lo + 0.20 and h2_ok) else (0 if (soc > lo + 0.40 or not h2_ok) else int(bool(fc_on)))
    surplus = pv_kw - load_kw
    elz = 1 if (surplus > site.elz_kw * 0.8 and soc > site.soc_max - 0.10 and h2 < site.h2_nm3 * 0.95 and not dg) else 0
    if fc and elz: elz = 0
    return dg, fc, elz


class Planner:
    def __init__(self, site):
        self.s = site
        self.soc = np.linspace(site.soc_min, site.soc_max, N_SOC)
        self.h2 = np.linspace(0.0, site.h2_nm3, N_H2)
        self.last = None

    # ── 한 구간의 물리 모델 (soc: 배열 가능)
    def step(self, soc, h2, a, load, pv, lclass):
        s = self.s; dg, fc, elz = a
        net = load + elz * s.elz_kw - pv - dg * s.dg_kw - fc * s.fc_kw
        dis = np.minimum(s.ess_kw, np.maximum(soc - s.soc_min, 0) * s.ess_kwh * s.ess_eff / DT_H)
        chg = np.minimum(s.ess_kw, np.maximum(s.soc_max - soc, 0) * s.ess_kwh / (s.ess_eff * DT_H))
        p = np.clip(net, -chg, dis)
        short = np.maximum(net - p, 0); curt = np.maximum(p - net, 0)
        soc2 = soc - np.where(p > 0, p / s.ess_eff, p * s.ess_eff) * DT_H / s.ess_kwh
        h2b = h2 - fc * s.fc_kw * DT_H * s.fc_nm3_per_kwh + elz * s.elz_kw * DT_H / s.elz_kwh_per_nm3
        return soc2, h2b, short, curt

    def shed_cost(self, short, lclass):
        """부족 전력을 3등급 → 2등급 → 1등급 순으로 차단할 때의 벌점."""
        c = np.zeros_like(np.asarray(short, dtype=float)); rem = np.asarray(short, dtype=float)
        for k in (2, 1, 0):
            cut = np.minimum(rem, lclass[k]); c = c + cut * DT_H * SHED_COST[k]; rem = rem - cut
        return c + rem * DT_H * SHED_COST[0]

    def stage_cost(self, soc, h2, a, load, pv, lclass, hr, dg_prev):
        s = self.s; dg = a[0]
        soc2, h2b, short, curt = self.step(soc, h2, a, load, pv, lclass)
        c = dg * s.dg_kw * DT_H * s.dg_l_per_kwh + (START_L if dg and not dg_prev else 0.0) + (SILENT_L if dg and silent_hour(hr) else 0.0)
        c = c + self.shed_cost(short, lclass) + curt * DT_H * CURTAIL_L
        c = c + np.maximum(s.soc_min + RESERVE - soc2, 0) * s.ess_kwh * RESERVE_L
        return c, np.clip(soc2, s.soc_min, s.soc_max), h2b

    def terminal(self):
        s = self.s
        ve = -(self.soc - s.soc_min) * s.ess_kwh * s.dg_l_per_kwh * TERM_ESS
        vh = -(self.h2 / s.fc_nm3_per_kwh) * s.dg_l_per_kwh * TERM_H2
        v = ve[:, None] + vh[None, :]
        return np.repeat(v[:, :, None], 2, axis=2)

    def _interp(self, Vn, soc2, h2b):
        """Vn: (N_SOC, N_H2) 에서 (soc2[i], h2b[j]) 쌍선형 보간. soc2: (N_SOC,), h2b: (N_H2,) → (N_SOC, N_H2)."""
        fi = np.clip((soc2 - self.soc[0]) / (self.soc[1] - self.soc[0]), 0, N_SOC - 1 - 1e-9)
        fj = np.clip((h2b - self.h2[0]) / (self.h2[1] - self.h2[0]), 0, N_H2 - 1 - 1e-9)
        i0 = fi.astype(int); wi = fi - i0; j0 = fj.astype(int); wj = fj - j0
        a = Vn[i0][:, j0]; b = Vn[i0 + 1][:, j0]; c = Vn[i0][:, j0 + 1]; d = Vn[i0 + 1][:, j0 + 1]
        wi = wi[:, None]; wj = wj[None, :]
        return a * (1 - wi) * (1 - wj) + b * wi * (1 - wj) + c * (1 - wi) * wj + d * wi * wj

    def _h2_ok(self, h2b):
        s = self.s
        return (h2b >= s.h2_nm3 * s.h2_min - 1e-9) & (h2b <= s.h2_nm3 + 1e-9)

    def plan(self, load, pv, lclass, hrs):
        """load, pv: (T,), lclass: (T, 3), hrs: (T,). 반환: 가치함수 V (T+1, N_SOC, N_H2, 2)."""
        T = len(load); V = np.zeros((T + 1, N_SOC, N_H2, 2)); V[T] = self.terminal()
        for t in range(T - 1, -1, -1):
            best = np.full((N_SOC, N_H2, 2), np.inf)
            for a in ACTIONS:
                for dp_ in (0, 1):
                    c, soc2, h2b = self.stage_cost(self.soc, self.h2, a, load[t], pv[t], lclass[t], hrs[t], dp_)
                    h2b = np.broadcast_to(h2b, self.h2.shape)
                    cont = self._interp(V[t + 1][:, :, a[0]], soc2, h2b)
                    tot = c[:, None] + cont
                    # 수소 하한·상한 밖으로 가는 결정 제외(현재 이미 하한 아래인데 쓰지 않는 결정은 허용)
                    bad = ~self._h2_ok(h2b) & ((a[1] == 1) | (a[2] == 1))
                    tot[:, bad] = np.inf
                    best[:, :, dp_] = np.minimum(best[:, :, dp_], tot)
            V[t] = np.where(np.isfinite(best), best, 1e6)
        self.last = {"load": np.asarray(load), "pv": np.asarray(pv)}
        return V

    def act(self, Vn, soc, h2, dg_prev, load, pv, lclass, hr):
        """현재 실측 상태에서 다음 구간 가치함수 Vn으로 결정을 고르고 실행 보호 계층을 적용한다."""
        s = self.s; best, ba = np.inf, (0, 0, 0)
        soc = float(np.clip(soc, s.soc_min - 0.2, 1.0))
        for a in ACTIONS:
            c, soc2, h2b = self.stage_cost(np.array([soc]), h2, a, load, pv, lclass, hr, dg_prev)
            if (a[1] or a[2]) and not self._h2_ok(np.array([h2b]))[0]: continue
            v = float(c[0] + self._interp(Vn[:, :, a[0]], soc2, np.array([h2b]))[0, 0])
            if v < best: best, ba = v, tuple(int(x) for x in a)
        dg, fc, elz = ba
        if soc < s.soc_min + 0.04: dg, elz = 1, 0                         # 디젤 강제 기동
        nh = h2 - fc * s.fc_kw * DT_H * s.fc_nm3_per_kwh + elz * s.elz_kw * DT_H / s.elz_kwh_per_nm3
        if nh < s.h2_nm3 * s.h2_min: fc = 0
        if nh > s.h2_nm3: elz = 0
        return dg, fc, elz


def simulate(site, load, pv, lclass, hrs, policy, soc0=0.6, h2_0=None):
    """논리 모형 시뮬레이션. policy(k, soc, h2, dg_prev) → 결정. 반환: 집계 사전."""
    pl = Planner(site); soc, h2, dgp = soc0, site.h2_nm3 * 0.7 if h2_0 is None else h2_0, 0
    fuel = shed = 0.0; starts = silent = 0
    for k in range(len(load)):
        a = policy(k, soc, h2, dgp)
        soc2, h2b, short, curt = pl.step(np.array([soc]), h2, a, load[k], pv[k], lclass[k])
        fuel += a[0] * site.dg_kw * DT_H * site.dg_l_per_kwh; starts += int(a[0] and not dgp); silent += int(a[0] and silent_hour(hrs[k]))
        shed += float(short[0]) * DT_H; soc = float(np.clip(soc2[0], site.soc_min, site.soc_max)); h2 = float(h2b); dgp = a[0]
    return {"fuel_l": fuel, "dg_starts": starts, "dg_silent_h": silent * DT_H, "shed_kwh": shed, "soc_end": soc, "h2_end": h2}
