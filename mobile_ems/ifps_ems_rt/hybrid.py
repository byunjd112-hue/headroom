# -*- coding: utf-8 -*-
"""기동형 복합전력공급체계(발전기 + ESS 를 PCS 가 묶은 한 제품)의 운전 모드.

EMS 는 이 체계의 PCS 와만 통신한다. 발전기와 ESS 의 감시 · 제어는 모두 PCS 를 거친다(대응표의 장치 이름 DG = 복합전력 PCS).
  PCS 가 알려 주는 것  발전기 운전 · 출력 · 연료(DG.status · kw · fuel_l), ESS 충전율 · 충방전 전력(DG.ess_soc · ess_kw), 지금 모드(DG.pcs_mode)
  EMS 가 내리는 것     발전기 기동 · 정지(DG.cmd — 선택 · 실행 규약), 운전 모드(DG.mode_set)
운전 모드
  0 정지              발전기 정지, ESS 대기
  1 발전기 단독       발전기만 공급(ESS 는 가득 차 있거나 쉬게 함)
  2 발전기 + ESS 충전 발전기가 공급하면서 ESS 를 충전
  3 ESS 방전          발전기 정지, ESS 가 공급(계통 형성 · 저소음)
자동 제어의 모드 선택: 디젤이 필요하면 2(충전율이 soc_full 이상이면 1), 필요 없으면 3.
복합전력의 ESS 가 soc_low 아래로 내려가면 발전기를 돌려 충전하고(want.DG 를 켬) soc_ok 를 넘으면 그친다(저소음 태세에서는 디젤을 켜지 않는다).
모드의 뜻 · 값과 한계값은 가정이다 — 제작사 PCS 사양을 받으면 맞춘다(runtime.json 의 hybrid).
"""
MODES = {0: "정지", 1: "발전기 단독", 2: "발전기 + ESS 충전", 3: "ESS 방전"}
DEFAULT = {"soc_low": 20.0, "soc_ok": 50.0, "soc_full": 90.0}


def settings(cfg):
    c = dict(DEFAULT); c.update({k: float(v) for k, v in (cfg or {}).items() if k in DEFAULT}); return c


def check(cfg, bad):
    """runtime.json 의 hybrid 검사(설정 편집기 · 기동 전 점검)."""
    if cfg is None: return
    if not isinstance(cfg, dict): bad.append("hybrid: 객체여야 함"); return
    try: c = settings(cfg)
    except (TypeError, ValueError): bad.append("hybrid: 값은 숫자여야 함"); return
    if not 0 <= c["soc_low"] < c["soc_ok"] < c["soc_full"] <= 100: bad.append("hybrid: 0 ≤ soc_low < soc_ok < soc_full ≤ 100 이어야 함")


def units(rt):
    """모드 지령을 받을 수 있는 복합전력 PCS(있는 장치)."""
    return [n for n in rt.fleet.live("DG") if n in rt.links and f"{n}.mode_set" in rt.links[n].by_tag]


def mode_for(on, soc, c):
    """그 장치에 내릴 모드: 발전기를 돌릴 때 2(충전율이 가득이면 1), 아니면 3."""
    return (1 if soc is not None and soc >= c["soc_full"] else 2) if on else 3


def need(rt, want):
    """복합전력의 ESS 가 낮으면 발전기를 돌려 충전하게 한다(이력: soc_low 아래에서 켜고 soc_ok 위에서 끈다). 저소음 태세에서는 켜지 않는다."""
    c = settings(rt.cfg.get("hybrid")); socs = [s for s in (rt.fleet.unit(n, "ess_soc", rt.val) for n in units(rt)) if s is not None]
    was = getattr(rt, "hy_charge", False)
    rt.hy_charge = bool(socs) and (min(socs) < c["soc_low"] or (was and min(socs) < c["soc_ok"]))
    if rt.hy_charge and not want.get("DG") and not want.get("_quiet"): want["DG"] = True; want["_hybrid"] = True


def apply(rt, want, who="자동"):
    """자동 제어의 결정대로 모드를 내린다. 현장 수동인 장치와 지령할 수 없는 장치는 건너뛴다. 반환: [(장치, 모드)] 이번에 바뀐 것"""
    c = settings(rt.cfg.get("hybrid")); last = rt.__dict__.setdefault("hy_last", {}); out = []
    for n in units(rt):
        if n in rt.dev and rt.dev[n].manual: continue
        m = mode_for(bool(want.get("DG")), rt.fleet.unit(n, "ess_soc", rt.val), c)
        if rt._write1(n, f"{n}.mode_set", float(m), 0.0) and last.get(n) != m:      # pylint: disable=protected-access
            last[n] = m; out.append((n, m)); rt.note("지령", f"{n} 복합전력 모드 {m} {MODES[m]}", actor=who)
    return out
