# -*- coding: utf-8 -*-
"""디젤 연료 감시: 잔량·남은 시간 계산과 보충 경보. 전시·유사시 지속 운용을 위해 고갈 최소 8시간 전에 알리고, 보충될 때까지 다시 알린다."""
import time


def status(eng):
    """[(장치, 이름, 잔량 %, 잔량 L, 정격 운전 기준 남은 시간)]. 남은 시간은 가장 빨리 줄어드는 경우(정격 연속 운전)로 계산한다."""
    rt = eng.rt; g = lambda k, d=0.0: rt.val.get(k, d); s = rt.site; gar = rt.gar; f = eng.fuel_cfg; out = []
    if "DG.fuel_l" in rt.val:
        lit = g("DG.fuel_l"); out.append(("DG", "이동형 디젤발전기", 100.0 * lit / max(1.0, f["dg_tank_l"]), lit, lit / max(1e-6, s.dg_kw * s.dg_l_per_kwh)))
    for n in rt.gdgs:
        if f"{n}.fuel_pct" in rt.val:
            pct = g(f"{n}.fuel_pct"); lit = pct / 100.0 * gar.gdg_tank_l; out.append((n, "주둔지 디젤발전기", pct, lit, lit / max(1e-6, gar.gdg_kw * gar.gdg_l_per_kwh)))
    return out


def alarms(eng):
    """잔량이 warn_pct(기본 50%) 이하이거나 정격 운전 기준 warn_h(기본 8시간) 이내면 경보. 보충될 때까지 repeat_min 마다 다시 알린다(확인해도 다시 울린다)."""
    f = eng.fuel_cfg; A = eng.alarms; now = time.time()
    for n, nm, pct, lit, hrs in status(eng):
        low = pct <= f["warn_pct"] or hrs <= f["warn_h"]; urgent = hrs <= f["warn_h"]; key = f"fuel.{n}"
        A.set(key, low, 1 if urgent else 2, n, f"{nm} 연료 {pct:.0f}%({lit:.0f}L) — 정격 운전 기준 약 {hrs:.1f}시간분. 연료 보충 요청" + (f" [긴급: {f['warn_h']:.0f}시간 이내 고갈]" if urgent else ""))
        if not low: eng._fuel_t.pop(n, None)
        elif now - eng._fuel_t.setdefault(n, now) >= 60.0 * f["repeat_min"]: A.renew(key); eng._fuel_t[n] = now
