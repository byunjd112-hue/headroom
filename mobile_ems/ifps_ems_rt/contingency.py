# -*- coding: utf-8 -*-
"""무정전 점검(단일 고장, N-1): '지금 구성에서 무엇 하나가 고장 나면 어느 부하가 끊기는가'를 따져 약점과 고치는 방법을 낸다.

따지는 고장(하나씩): ① 환망 한 구간의 단선 ② 한쪽 급전만 남았을 때의 환망 간선 전류 ③ 배전체계 한 대 ④ 구간분전함 한 대 ⑤ 모선 하나(연계 차단기 개방) ⑥ 전원 한 대.
두 곳이 동시에 고장 나는 경우(N-2)는 따지지 않는다 — 한 곳이 이미 고장 나 있으면 '여유 없음'으로 알린다.
계산만 한다(통신 · 화면 없음). 값은 환망 상태(ring.status), 부하 목록의 공급 경로(loads.attach), 정격 · 가정값(ring.spec), 모선 점검(busplan.check), 예비력(kpi)이다.
여기서 '끊기지 않는다'는 모형의 판단이다: 실제 차단 · 절체는 보호 · 배전 자동화 장치가 하고, 그 시간은 정격 · 가정값과 FAT 로 확정한다."""


def _item(area, level, text, fix=""):
    return {"area": area, "level": level, "text": text, "fix": fix}


def _ring(st, on, sp):
    """환망: 이미 끊긴 구간 · 닫힌 개방점 · 한쪽 급전 때의 간선 전류."""
    out = []; g1 = any(i["grade"] == 1 for i in on)
    if st.get("cut"):
        out.append(_item("환망", "bad" if g1 else "warn", f"환망 구간 {', '.join(str(i) for i in st['cut'])} 이(가) 차단되어 반대쪽에서 받는 중이다 — 구간이 하나 더 끊기면 그 뒤의 부하가 정전된다(여유 없음).", "차단된 구간의 케이블 · 접속부를 고쳐 환망을 되돌린다"))
    elif st.get("switched"): out.append(_item("환망", "warn", "상시 개방점이 닫혀 있다 — 고리가 닫힌 채로는 순환 전류가 흐를 수 있고 고장 구간을 가려 끊기 어렵다.", "상시 개방점을 다시 연다"))
    if st.get("auto") is False: out.append(_item("환망", "warn", "자동 구간 차단 · 절체가 꺼져 있다 — 한 구간이 끊기면 사람이 개폐기를 조작할 때까지 그 뒤의 부하가 정전된다.", "자동 절체를 켠다"))
    tot = sum(i["rated"] for i in on)
    if tot > sp["fsu_kw"]: out.append(_item("환망", "bad", f"환망에 물린 정격 합 {tot:.0f} kW 가 간선 정격 {sp['fsu_a']:.0f} A(약 {sp['fsu_kw']:.0f} kW)를 넘는다 — 한 구간이 끊겨 한쪽에서만 받으면 과부하다.", "부하를 줄이거나 낮은 등급부터 끊도록 둔다"))
    return out


def _paths(on, sp):
    """부하마다의 공급 경로: 배전체계 한 대가 고장 났을 때 남은 것으로 받을 수 있는가."""
    out = []; lone = 0
    for i in on:
        have = len(i["ppdus"]); base = i.get("base", i["need"]); nm = i["name"]
        if have < base: out.append(_item("공급 경로", "bad", f"{nm}: 배전체계가 {have}대뿐이다(정격을 감당하려면 {base}대) — 지금도 과부하가 될 수 있다.", f"{nm} 앞에 배전체계를 {base - have}대 더 놓는다")); continue
        if i["grade"] == 1 and have < base + 1: out.append(_item("공급 경로", "warn", f"{nm}(1등급): 배전체계가 {have}대로 정격에 딱 맞다 — 한 대가 고장 나면 남은 것으로 감당하지 못한다.", f"{nm} 앞에 배전체계를 한 대 더 놓는다(N+1)"))
        elif i["grade"] != 1 and have < base + 1: lone += 1
        if i.get("out_over"): out.append(_item("공급 경로", "warn", f"{nm}: 물린 구간분전함의 출력 회로({sp['fsu_out']}개)보다 배전체계가 많다.", "일부를 다른 구간분전함으로 옮긴다"))
    if lone: out.append(_item("공급 경로", "info", f"2 · 3등급 부하 {lone}건은 배전체계 한 대가 고장 나면 그 부하만 정전된다(예비 배전체계로 바꿔 복구).", ""))
    if any(i["grade"] == 1 for i in on):
        if not sp["sts"]: out.append(_item("공급 경로", "warn", "1등급 부하에 STS 절체가 없는 것으로 설정되어 있다 — 환망 구간이 끊기면 절체가 끝날 때까지 1등급도 끊긴다.", "1등급 부하의 배전체계에 반대쪽 급전을 받는 STS 를 둔다"))
        f1 = sorted({i["fsu_name"] for i in on if i["grade"] == 1})
        out.append(_item("공급 경로", "info", f"1등급 부하가 물린 구간분전함({', '.join(f1)}) 자체가 고장 나면 환망으로는 메우지 못한다 — 그 부하의 둘째 입력을 이웃 구간분전함에서 받아야 끊기지 않는다(결선 확인).", ""))
    return out


def check(st, items, sp, bus=None, kpi=None):
    """반환: {"ok": 정전으로 이어질 약점(bad)이 없음, "n1": 주의(warn)도 없음, "items": [{area, level: bad | warn | info, text, fix}]}"""
    on = [i for i in items if i["n"] > 0 and i.get("fsu")]; out = (_ring(st, on, sp) if st else []) + _paths(on, sp)
    for x in (bus or {}).get("issues", []): out.append(_item("모선", x["level"], x["text"], "[모선 구성]의 자동 보완" if x.get("fix") else ""))
    k = kpi or {}
    if k.get("reserve_margin") is not None and k.get("mode") != "grid" and k["reserve_margin"] < 0:
        out.append(_item("전원", "warn", f"전원 한 대가 빠지면 1 · 2등급 부하를 감당할 용량이 {-k['reserve_margin']:.0f} kW 모자란다.", "자동 제어가 연료전지를 병렬로 올린다(예비력 규칙) — 꺼져 있으면 켠다"))
    rank = {"bad": 0, "warn": 1, "info": 2}; out.sort(key=lambda x: rank[x["level"]])
    return {"ok": not any(x["level"] == "bad" for x in out), "n1": not any(x["level"] in ("bad", "warn") for x in out), "items": out}
