# -*- coding: utf-8 -*-
"""장치 대수 조정 — 설비 제어 화면의 [−] · [＋].
대수는 EMS 가 응답하는 장치를 세어 정한다(자동 인식, ifps_ems_rt/fleet.py). 이 모듈은 그 인식을 사람이 거들 뿐이다:
  · ＋ : 가상 장치 모드에서는 그 종류의 다음 자리에 가상 장치를 놓는다. 실장비 모드에서는 빈 자리를 지금 바로 다시 불러 본다(장치는 사람이 연결한다).
  · − : 가상 장치 모드에서는 마지막 장치를 빼고, 실장비 모드에서는 통신이 끊긴(철수한) 장치를 인식 목록에서 지운다. 응답하는 장치는 지우지 않는다(곧 다시 인식되므로).
바뀐 대수는 스냅샷의 fleet 으로 나가 개요 · 결선도 · 설비 제어 · 시나리오 화면이 같이 따라간다. 자리 수는 runtime.json 의 devices 에 둔 추가 자리(DG2 …) 수다.
"""
import time

MATE = {"FC": "ELZ", "ELZ": "FC"}  # 한 차량에 함께 실린 장치(④ 수소생성 · 발전체계 = 연료전지 + 수전해): 대수를 같이 바꾼다. ① 복합전력의 계통 형성 ESS(G1)는 통신 장치가 따로 없어 디젤 대수를 따른다(runtime.g1_kw)
HOLD_S = 30.0                     # 뺀 장치의 통신 상태가 '두절'로 정리되기를 기다리는 시간(초). 그동안 두절 경보를 내지 않는다


def _drop(eng):
    return eng.__dict__.setdefault("unit_drop", {})


def _mate(eng, n):
    """같은 차량의 짝 장치 이름(FC2 ↔ ELZ2). 없으면 None."""
    from .. import fleet
    k = fleet.kind(n); m = MATE.get(k) and MATE[k] + n[len(k):]
    return m if m in eng.rt.links else None


def change(eng, k, delta, who):
    """한 차량 단위로 대수를 바꾼다: 그 종류의 장치와, 같은 차량의 짝 장치(있으면)."""
    r = _change1(eng, k, delta, who); m = r.get("ok") and _mate(eng, r["unit"])
    if m and (m in eng.rt.seen) != (delta > 0) and (delta > 0 or eng.sim or eng.rt.lm.state.get(m) == "두절"): _apply(eng, m, delta, who); r["msg"] += f" (같은 차량의 {m} 포함)"
    return r


def _apply(eng, n, delta, who):
    """장치 하나를 놓거나(＋) 뺀다(−)."""
    rt = eng.rt; drop = _drop(eng)
    if delta > 0:
        rt.fleet.park.pop(n, None); rt.hb_seen.pop(n, None); rt.hb_stop.pop(n, None); drop.pop(n, None); rt.hb_skip.discard(n)
        if eng.sim: eng.plant.gone.discard(n)
        return
    if eng.sim: eng.plant.gone.add(n)
    drop[n] = time.time() + HOLD_S; rt.hb_skip.add(n); rt.note("장치", f"{n} 빼기(대수 조정)", actor=who)


def _change1(eng, k, delta, who):
    rt = eng.rt; names = rt.fleet.slots.get(k) or []; drop = _drop(eng)
    if not names or delta not in (1, -1): raise ValueError("대수를 바꿀 수 없는 종류")
    if delta > 0:
        free = [n for n in names if n not in rt.seen and (not eng.sim or n in eng.plant.gone)]      # 가상 장치: 이미 놓아 인식을 기다리는 자리는 다시 잡지 않는다(연달아 눌러도 한 자리씩)
        if not free: return {"ok": False, "why": f"{k} 자리가 더 없습니다(최대 {len(names)}대). 더 늘리려면 설정 파일의 devices 에 다음 자리를 넣습니다"}
        for m in free: rt.fleet.park.pop(m, None); rt.hb_seen.pop(m, None); rt.hb_stop.pop(m, None); drop.pop(m, None); rt.hb_skip.discard(m)      # 기다리지 않고 지금 불러 본다. 예전에 있던 장치의 묵은 생존 계수는 지운다(다시 놓을 때 '정지' 경보가 뜨지 않게)
        n = free[0]
        if eng.sim: eng.plant.gone.discard(n); rt.note("장치", f"{n} 가상 장치 놓기(대수 조정)", actor=who); return {"ok": True, "unit": n, "msg": f"{n} 을 놓았습니다. 몇 초 안에 자동으로 인식됩니다"}
        return {"ok": True, "unit": n, "msg": f"빈 자리를 지금 다시 찾습니다. 장치를 연결해 켜면 자동으로 인식됩니다(다음 자리 {n} · {eng.cfg['devices'][n]['paths'][0][0]})"}
    have = [n for n in names if n in rt.seen and n not in drop]
    if not have: return {"ok": False, "why": f"뺄 {k} 장치가 없습니다"}
    n = have[-1]
    if not eng.sim and rt.lm.state.get(n) != "두절": return {"ok": False, "why": f"{n} 이 아직 응답합니다. 장치를 끄거나 통신선을 뺀 뒤 다시 누르십시오(응답하는 장치는 자동으로 다시 인식됩니다)"}
    _apply(eng, n, -1, who); cycle(eng)
    return {"ok": True, "unit": n, "msg": f"{n} 을 뺐습니다"}


def cycle(eng):
    """주기마다: 빼기로 한 장치의 통신이 끊긴 것을 확인하면 인식 목록에서 지운다(빈 자리로 돌아간다)."""
    drop = _drop(eng); rt = eng.rt
    for n in list(drop):
        rt.fleet.forget(n)                                             # 바로 빈 자리로 돌린다(재기동 뒤에도 잊은 채로): 수집 주기가 없는 장치의 응답을 기다리며 멈추지 않게(빈 자리는 주기 밖에서 불러 본다)
        if rt.lm.state.get(n) == "두절": rt.fleet.forget(n); drop.pop(n); eng.alarms.set(f"link.{n}", False, 1, n, ""); rt.hb_seen.pop(n, None); rt.hb_stop.pop(n, None); rt.hb_skip.discard(n)
        elif time.time() > drop[n]: drop.pop(n); rt.hb_skip.discard(n)      # 끝내 끊기지 않았다 — 응답하면 다시 인식된다


def http_post(eng, b, sess):
    """POST /api/units {kind, delta: 1 | -1} — 운용자."""
    return change(eng, str(b.get("kind")), int(b.get("delta", 0)), sess["name"])
