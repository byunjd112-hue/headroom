# -*- coding: utf-8 -*-
"""환망 감시: 구간분전함(FSU)·휴대용 배전체계(PPDU) 상태 판단, 자리마다 읽은 ID 로 배치 자동 인식, 경보, 설정 검사, 화면부 연결."""
import copy, json, os, shutil, sys, tempfile, time, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from ifps_ems_rt import ring, branchfc                  # noqa: E402
from ifps_ems_rt.hmi.engine import Engine                # noqa: E402
from ifps_ems_rt.hmi.ringwatch import http_post          # noqa: E402

R = ring.settings(copy.deepcopy(ring.DEFAULT))


def values(open_at=4, cut=(), dead=(), ids=None):
    """정상 상태의 신호 값(고칠 것만 인자로)."""
    v = {"RING.auto": 1.0}
    for i, t in enumerate(ring.sw_tags(R)): v[t] = 2.0 if i in cut else 0.0 if i == open_at else 1.0
    for x in R["fsu"] + R["ppdu"]: v[x["id"] + ".id"] = float((ids or {}).get(x["id"], x["code"])); v[x["id"] + ".v"] = 0.0 if x["id"] in dead else 380.0
    for p in R["ppdu"]:
        v.update({p["id"] + ".kw": 10.0, p["id"] + ".mccb": 1.0, p["id"] + ".gnd": 35.0, p["id"] + ".lamp": 0.0})
        for n in range(1, 7): v[f"{p['id']}.ch{n}"] = 1.0; v[f"{p['id']}.ch{n}_kw"] = 1.5
    return v


class BranchForecastTest(unittest.TestCase):
    """분기별 부하 예측(ifps_ems_rt/branchfc.py)."""
    def run_days(self, book, days, kw, kwh0=None, n=900):
        e = kwh0
        for d in range(days):
            for slot in range(branchfc.SLOTS):
                x = kw(slot)
                for k in range(n):
                    if e is not None: e += x / 3600.0
                    if k in (0, n - 1) or n < 20: book.feed(f"2026-05-{d + 1:02d}", slot, {"P": (x, e)})
                    elif k == 1: book.acc["P"][0] += x * (n - 2); book.acc["P"][1] += n - 2      # 같은 값의 표본을 한 번에 넣는다(시험 시간 단축)
        return e

    def test_profile_level_and_error(self):
        kw = lambda s: 10.0 + (8.0 if 32 <= s < 72 else 0.0); b = branchfc.Book(); self.assertEqual(b.forecast("P", 0, 4), [None] * 4)
        e = self.run_days(b, 3, kw, 100.0); f = b.forecast("P", 0); self.assertAlmostEqual(f[10], 10.0, delta=0.3); self.assertAlmostEqual(f[40], 18.0, delta=0.4)        # 시간대 평균(전력량계 차이로 구한 값)
        r = b.row("P", 95, 10.0, e); self.assertAlmostEqual(r["next24_kwh"], sum(kw(s) for s in range(96)) / 4, delta=6); self.assertEqual(r["peak_kw"] > 17, True); self.assertLess(r["err_pct"], 3.0); self.assertGreater(r["err_n"], 100)
        self.assertAlmostEqual(r["today_kwh"], sum(kw(s) for s in range(96)) / 4, delta=1.0)
        b2 = branchfc.Book(json.loads(json.dumps(b.state()))); self.assertEqual(b2.forecast("P", 0)[40], f[40])                                                             # 저장했다 되살려도 같다
        for slot in range(4): b2.feed("2026-05-04", slot, {"P": (15.0, None)}); b2.acc["P"][0] += 15.0 * 898; b2.acc["P"][1] += 898
        b2.feed("2026-05-04", 4, {"P": (15.0, None)}); g = b2.forecast("P", 4); self.assertGreater(g[0], 13.0); self.assertLess(g[60], 19.5); self.assertGreater(b2.level("P"), 1.2)   # 최근 실측이 크면 가까운 시각을 올리고 먼 시각은 덜 올린다

    def test_meter_reset_falls_back_to_power_samples(self):
        b = branchfc.Book(); b.feed("d", 0, {"P": (10.0, 500.0)}); b.acc["P"][0] += 10.0 * 898; b.acc["P"][1] += 898; b.feed("d", 0, {"P": (10.0, 2.0)}); b.feed("d", 1, {"P": (10.0, 2.1)})      # 전력량계가 초기화됐다
        self.assertAlmostEqual(b.b["P"]["prof"][0], 10.0, places=3)
        b = branchfc.Book(); b.seed("X", 6.0, [1.0] * 96); self.assertTrue(b.demo); self.assertEqual(b.forecast("X", 0, 2), [6.0, 6.0])


class RingTest(unittest.TestCase):
    def test_settings_and_check(self):
        self.assertIsNone(ring.settings(None)); self.assertIsNone(ring.settings({"enabled": False, "fsu": R["fsu"]})); bad = []; ring.check(R, bad); self.assertEqual(bad, [])
        for change in ({"open": 99}, {"fsu": [{"id": "X1"}]}, {"ppdu": [{"id": "PPDU1", "at": "FSU99", "load": "L1"}]}, {"ppdu": [{"id": "PPDU1", "at": "FSU1", "ch": [{"cls": 7}]}]}, {"trip_ms": -1}, {"auto": 1}, {"fsu_slots": 0}, {"ppdu_slots": 99},
                       {"fsu": [{"id": "FSU1", "code": 70000}]}, {"fsu": [{"id": "FSU1"}, {"id": "FSU1"}]}, {"fsu": [{"id": f"FSU{k}"} for k in range(1, 15)]}):
            bad = []; ring.check(dict(copy.deepcopy(R), **change), bad); self.assertTrue(bad, change)
        self.assertEqual(len(ring.tags(R)), 8 + 1 + 14 + 3 * 18)                           # 구간 개폐기 8 + 자동 1 + FSU 7×2 + PPDU 3×(6 + 회로 12)

    def test_status_normal_cut_and_isolated(self):
        s = ring.status(R, values()); self.assertTrue(s["ok"]); self.assertFalse(s["switched"]); self.assertEqual(s["missing"], []); self.assertTrue(all(f["fed"] for f in s["fsu"]))
        s = ring.status(R, values(open_at=99, cut=(2,))); self.assertEqual(s["cut"], [2]); self.assertTrue(s["switched"]); self.assertTrue(all(f["fed"] for f in s["fsu"]))       # 구간 2 차단 + 상시 개방점 닫힘 → 모두 공급
        self.assertTrue(all(f["comm"] for f in s["fsu"])); self.assertTrue(all(f["comm"] for f in ring.status(R, values())["fsu"]))                                              # 통신은 환형: 한 구간이 끊겨도(상시 개방점이 열려 있어도) 모두 닿는다
        s2 = ring.status(R, values(open_at=99, cut=(2, 5))); self.assertEqual([f["id"] for f in s2["fsu"] if f["comm"] is False], ["FSU3", "FSU4", "FSU5"])                       # 두 구간이 끊기면 그 사이만 통신 고립
        a2 = {k: on for k, on, *_ in ring.alarms(R, s2)}; self.assertTrue(a2["ring.comm.FSU4"]); self.assertFalse(a2["ring.comm.FSU1"]); self.assertFalse({k: on for k, on, *_ in ring.alarms(R, s)}["ring.comm.FSU3"])
        s = ring.status(R, values(open_at=99, cut=(2, 3), dead=("FSU3",))); self.assertEqual(s["isolated"], ["FSU3"]); self.assertFalse(s["ok"]); self.assertFalse(s["fsu"][2]["fed"])
        s = ring.status(R, {}, lost=True); self.assertFalse(s["ok"]); self.assertIsNone(s["fsu"][0]["live"]); self.assertEqual(len(s["missing"]), 77)

    def test_auto_layout_follows_ids(self):
        d = ring.discover(R, values()); self.assertTrue(d["ok"] and d["auto"]); self.assertEqual([x["id"] for x in d["rows"]][:4], ["FSU1", "FSU2", "PPDU1", "FSU3"])           # 고리 순서, FSU 뒤에 거기 붙은 PPDU
        v = values(ids={"FSU2": R["fsu"][4]["code"], "FSU5": R["fsu"][1]["code"]}); s = ring.status(R, v); d = ring.discover(R, v)                                           # 두 대를 바꿔 놓아도 문제가 아니다 — 이름이 ID 를 따라간다
        self.assertTrue(d["ok"]); self.assertEqual((s["fsu"][1]["name"], s["fsu"][4]["name"]), ("구간분전함 5", "구간분전함 2")); self.assertFalse([a for a in ring.alarms(R, s) if a[1]])
        v = values(ids={"PPDU2": 0, "FSU7": 0}); s = ring.status(R, v); d = ring.discover(R, v)                                                                               # 대수가 달라도 된다: 빈 자리는 뺀다
        self.assertEqual((len(s["fsu"]), len(s["ppdu"]), len(s["sections"]), d["empty"]), (6, 2, 7, 2)); self.assertTrue(s["ok"] and d["ok"]); self.assertEqual(s["missing"], [])
        self.assertEqual([x["state"] for x in d["rows"] if x["id"] == "PPDU2"], ["비어 있음"])
        v = values(open_at=3, ids={"FSU4": 0}); s = ring.status(R, v); self.assertEqual(s["open"], 3); self.assertFalse(s["switched"])                                                   # 상시 개방점 자리의 장치가 빠지면 지금 열린 구간을 개방점으로 본다
        v = values(ids={"FSU3": 0x4699}); s = ring.status(R, v); self.assertEqual((s["fsu"][2]["new"], s["fsu"][2]["name"], s["recog"]["new"]), (True, f"구간분전함 (ID {0x4699})", ["FSU3"])); self.assertTrue(ring.discover(R, v)["ok"])    # 처음 보는 장치도 바로 넣는다
        for ids in ({"FSU3": R["fsu"][0]["code"]}, {"FSU3": R["ppdu"][0]["code"]}):                                                                                          # 같은 ID 가 둘, 종류가 다른 장치 → 확인 필요
            d = ring.discover(R, values(ids=ids)); self.assertFalse(d["ok"]); self.assertEqual(d["bad"], 1); self.assertIn("ring.id.FSU3", {a[0] for a in ring.alarms(R, ring.status(R, values(ids=ids))) if a[1]})
        v = values(); v.update({"PPDU1.up": float(R["fsu"][6]["code"]), "PPDU2.up": 9.0}); s = ring.status(R, v)                                                              # 배전체계가 물린 곳은 상위 ID 신호로 안다
        self.assertEqual((s["ppdu"][0]["at"], s["ppdu"][0]["at_auto"], s["ppdu"][1]["at"], s["ppdu"][2]["at"]), ("FSU7", True, "", "FSU6")); self.assertIn("ring.at.PPDU2", {a[0] for a in ring.alarms(R, s) if a[1]})
        v["PPDU2.v"] = 0.0; a = {x[0]: x[2] for x in ring.alarms(R, ring.status(R, v)) if x[1]}; self.assertEqual(a.get("ring.dead.PPDU2"), 1)                     # 어디 물렸는지 몰라도 정전 경보는 낸다(1등급 회로가 있으면 1등급)

    def test_fixed_layout_reports_swapped_units(self):
        F = dict(R, auto=False); d = ring.discover(F, values(ids={"FSU2": R["fsu"][4]["code"], "FSU5": R["fsu"][1]["code"]})); bad = [x for x in d["rows"] if x["state"] != "일치"]
        self.assertEqual([x["id"] for x in bad], ["FSU2", "FSU5"]); self.assertIn("FSU5 의 ID", bad[0]["hint"]); self.assertEqual(d["bad"], 2)
        d = ring.discover(F, values(ids={"PPDU2": 0})); self.assertEqual([x["state"] for x in d["rows"] if x["id"] == "PPDU2"], ["무응답"])
        self.assertIn("ring.id.FSU1", {a[0] for a in ring.alarms(F, ring.status(F, values(ids={"FSU1": 1}))) if a[1]})

    def test_alarms_priority_follows_vital_load(self):
        on = lambda s: {k: (p, t) for k, a, p, _, t in ring.alarms(R, s) if a}
        self.assertEqual(on(ring.status(R, values())), {})
        a = on(ring.status(R, values(open_at=99, cut=(2,), dead=("FSU2", "FSU4", "PPDU3")))); self.assertEqual(a["ring.cut.2"][0], 2); self.assertEqual(a["ring.switched"][0], 3)
        self.assertEqual(a["ring.dead.FSU2"][0], 1); self.assertIn("중요 부하", a["ring.dead.FSU2"][1]); self.assertEqual(a["ring.dead.PPDU3"][0], 1)      # 1등급 회로가 물린 배전체계와 그것이 붙은 구간분전함은 1등급 경보
        low = copy.deepcopy(R); [c.update(cls=3) for c in low["ppdu"][1]["ch"] if c["cls"] == 1]; b = on(ring.status(low, values(open_at=99, cut=(2,), dead=("FSU4", "PPDU2", "FSU1"))))
        self.assertEqual((b["ring.dead.FSU4"][0], b["ring.dead.FSU1"][0]), (2, 2))                                                                                    # 1등급 회로가 없거나 배전체계가 안 붙은 곳은 2등급
        self.assertNotIn("ring.id.FSU1", on(ring.status(R, values(ids={"FSU1": 1}))))                                                                                  # 자동 인식: 처음 보는 ID 는 경보가 아니다

    def test_ppdu_circuits_overload_ground_and_trip(self):
        s = ring.status(R, values()); p = s["ppdu"][0]; self.assertEqual(len(p["ch"]), 6); self.assertEqual((p["ch"][1]["cls"], p["ch"][2]["cls"], p["ch"][0]["limit"], p["ch"][2]["limit"]), (0, 1, 10.5, 4.4)); self.assertTrue(p["vital"])
        v = values(); v.update({"PPDU1.kw": 23.0, "PPDU2.gnd": 180.0, "PPDU3.mccb": 2.0, "PPDU1.ch3": 2.0, "PPDU1.ch6": 2.0, "PPDU1.ch2": 2.0}); a = {k: (pr, t) for k, on, pr, _, t in ring.alarms(R, ring.status(R, v)) if on}
        self.assertEqual(a["ring.over.PPDU1"][0], 2); self.assertIn("정격 20", a["ring.over.PPDU1"][1]); self.assertEqual(a["ring.gnd.PPDU2"][0], 2); self.assertEqual(a["ring.mccb.PPDU3"][0], 1)
        self.assertEqual((a["ring.ch.PPDU1.3"][0], a["ring.ch.PPDU1.6"][0]), (1, 3)); self.assertNotIn("ring.ch.PPDU1.2", a)                    # 회로 트립은 그 회로의 부하 등급대로, 환상 연결용 회로는 경보 없음


class RingWatchTest(unittest.TestCase):
    """가상 장치를 띄워 감시 → 경보 → 자동 인식 → 배전체계 구성 저장까지."""
    def setUp(self):
        self.td = tempfile.mkdtemp(); shutil.copytree(os.path.join(ROOT, "config"), os.path.join(self.td, "config"), ignore=shutil.ignore_patterns("state*", "backup"))
        self.cfg = os.path.join(self.td, "config", "runtime.json"); self.eng = Engine(self.cfg, sim=True); self.eng.start(); time.sleep(3.5)

    def tearDown(self):
        self.eng.stop(); shutil.rmtree(self.td, ignore_errors=True)

    def _wait(self, test, limit=8.0):
        t0 = time.monotonic()
        while time.monotonic() - t0 < limit:
            if test(): return True
            time.sleep(0.2)
        return False

    def test_branch_meters_and_forecast_view(self):
        """분기 전력계: 부하 앞에 배전체계가 필요한 대수만큼(정격이 모자라면 병렬) 붙고, 구간분전함 전력 = 아래 배전체계의 합 = 물린 부하의 합, 전력량이 쌓이고, 환망 화면에 분기별 전력 · 전력량 · 예측이 나온다. 전력계가 어긋나면 알린다."""
        e = self.eng; w = e.ringw; self.assertTrue(self._wait(lambda: (e.snapshot()["ring"] or {}).get("ok")))
        used = lambda: {x["fsu"] for x in w.status().get("w", [])}
        full = lambda: all(len(i["ppdus"]) == i["need"] for i in e.snapshot()["loads"]["items"])
        self.assertTrue(self._wait(lambda: used() and full() and all(f.get("kwh") for f in w.status()["fsu"] if f["id"] in used()), 15.0)); s = w.status(); self.assertEqual(s["meters_missing"], [])
        with e.lock: snap = e.snapshot()
        s = snap["ring"]; items = snap["loads"]["items"]; self.assertEqual({i["id"]: (i["fsu"], i["ppdus"]) for i in items}, {"c2": ("FSU2", ["PPDU1", "PPDU2", "PPDU3", "PPDU4"]), "med": ("FSU4", ["PPDU5"]), "brk": ("FSU4", ["PPDU6", "PPDU7"]), "ammo": ("FSU6", ["PPDU8"])})      # 30 kW 1등급: 정격으로는 2대, N+1 로 3대, 우회 결선 한 줄(16 A · 약 9.5 kW)에 맞추면 4대. 막사는 동마다 1대
        self.assertEqual([p["name"] for p in s["ppdu"]][:3], ["지휘통제(C2) 배전 1", "지휘통제(C2) 배전 2", "지휘통제(C2) 배전 3"]); self.assertFalse(any(p["over"] for p in s["ppdu"])); self.assertFalse(any(f["over"] for f in s["fsu"]))
        for f in s["fsu"]:                                                # 구간분전함 전력계 = 그 자리에 물린 부하의 추정 전력 합(개요 · 결선도 · 환망이 같은 값)
            self.assertAlmostEqual(f["kw"], sum(i["est_kw"] for i in items if i["fsu"] == f["id"]), delta=3.0, msg=f["id"])
            self.assertAlmostEqual(f["kw"], sum(p["kw"] for p in s["ppdu"] if p["at"] == f["id"]) + (w._direct(e, f["id"]) or 0), delta=0.6, msg=f["id"])
        for p in s["ppdu"]: self.assertAlmostEqual(p["kw"], sum(i["est_kw"] / len(i["ppdus"]) for i in items if p["id"] in i["ppdus"]), delta=2.0, msg=p["id"])
        self.assertEqual([f["id"] for f in s["fsu"] if f.get("vital")], ["FSU2"]); self.assertEqual([p["id"] for p in s["ppdu"] if p["vital"]], ["PPDU1", "PPDU2", "PPDU3", "PPDU4"])      # ★ = 1등급 부하가 물린 자리
        p0 = next(p for p in s["ppdu"] if p["id"] == "PPDU5"); self.assertGreater(p0["kwh"], 0); self.assertAlmostEqual(sum(c["kwh"] for c in p0["ch"]), p0["kwh"], delta=0.3)
        b = w.view(e)["branch"]; self.assertEqual(len(b["rows"]), len(s["fsu"]) + len(s["ppdu"])); self.assertTrue(b["demo"])                 # 가상 장치: 실측이 쌓이기 전에는 시연용 초기값
        r = next(x for x in b["rows"] if x["id"] == p0["id"]); self.assertIsNotNone(r["next1h"]); self.assertIsNotNone(r["next24_kwh"]); self.assertEqual(len(r["spark"]), 48); self.assertIsNotNone(b["total"]["next24_kwh"])
        f = next(x for x in s["fsu"] if x["id"] == "FSU4"); rt = e.rt; t = [1000.0]; now = rt.now; rt.now = lambda: t[0]
        try:
            with e.lock:
                w.last = copy.deepcopy(w.status()); next(x for x in w.last["fsu"] if x["id"] == f["id"])["kw"] = f["kw"] + 30.0
                w._meters(e); t[0] += 31.0; w._meters(e); self.assertIn(f"ring.meter.{f['id']}", {k for k, a in e.alarms.items.items() if a["state"] == "ACT"})
        finally: rt.now = now
        self.assertTrue(self._wait(lambda: f"ring.meter.{f['id']}" not in {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}))      # 다시 맞으면 사라진다

    def _plain(self):
        """부하 목록을 비우고 배전체계를 설정에 적힌 배치로 되돌린다(장치 인식 · 구성 저장 자체를 볼 때)."""
        e = self.eng
        with e.lock: e.ringw.model.want = None; e.loadw.items = []; e.ringw.sim({"action": "restore"})

    def test_ring_keeps_supplying_through_a_break(self):
        """무정전 원칙(원본 자료의 기준): 한 구간이 끊겨도 환망이 반대쪽에서 보낸다 — 1등급 부하는 STS 절체로 끊기지 않고, 나머지는 3초 안에 복구된다. 환망 전체가 간선 정격을 넘으면 알린다."""
        e = self.eng; w = e.ringw; full = lambda: all(len(i["ppdus"]) == i["need"] for i in e.snapshot()["loads"]["items"])
        self.assertTrue(self._wait(lambda: (e.snapshot()["ring"] or {}).get("ok") and full(), 15.0)); self.assertLessEqual(w.r["trip_ms"] + w.r["close_ms"], 3000)
        pp = lambda i: next(p for p in w.status()["ppdu"] if p["id"] == i); seen = {"c2": [], "med": [], "fsu": []}; w.sim({"action": "break", "section": 1}); t0 = time.monotonic()      # 지휘통제(FSU2) · 의무(FSU4)가 물린 쪽의 급전 구간을 끊는다
        while time.monotonic() - t0 < 6.0:
            s = w.status(); seen["c2"].append(pp("PPDU1")["live"] and pp("PPDU2")["live"] and pp("PPDU3")["live"] and pp("PPDU4")["live"]); seen["med"].append((time.monotonic() - t0, pp("PPDU5")["live"])); seen["fsu"].append(next(f for f in s["fsu"] if f["id"] == "FSU2")["live"]); time.sleep(0.1)
        self.assertTrue(all(seen["c2"]), "1등급 부하의 배전체계가 끊겼다"); self.assertIn(False, seen["fsu"])                                   # 구간분전함은 잠깐 무전압이 됐지만 1등급은 STS 로 이어 받았다
        dead = [t for t, v in seen["med"] if v is False]; self.assertTrue(dead); self.assertLess(max(dead) - min(dead), 5.0)                  # 2등급은 끊겼다가 복구(설정은 2.6초 — 가상 장치의 걸음과 수집 주기 때문에 화면에는 1~2초 늦게 보인다)
        s = w.status(); self.assertTrue(s["ok"] and s["switched"] and s["cut"] == [1]); w.sim({"action": "restore"})
        self.assertTrue(self._wait(lambda: w.status()["ok"] and not w.status()["cut"], 12.0))
        w.sim({"action": "ppdu", "id": "PPDU1", "what": "mccb", "value": 2})                                                                 # 1등급 부하 앞의 배전체계 한 대가 트립해도 남은 두 대가 떠안는다(N+1) — 과부하 없이
        self.assertTrue(self._wait(lambda: pp("PPDU1")["kw"] == 0 and pp("PPDU2")["kw"] > 8 and not pp("PPDU2")["over"] and abs(pp("PPDU2")["kw"] + pp("PPDU3")["kw"] + pp("PPDU4")["kw"] - e.rt.val["LOAD.p1_kw"]) < 2.0, 10.0))
        n1 = w.status()["n1"]; self.assertTrue(n1["ok"]); self.assertEqual({x["level"] for x in n1["items"]} - {"info", "warn"}, set()); w.sim({"action": "ppdu", "id": "PPDU1", "what": "mccb", "value": 1})
        it = next(i for i in e.snapshot()["loads"]["items"] if i["id"] == "c2"); self.assertEqual((it["fsu"], it["alt"]), ("FSU2", "FSU5"))        # 우회 결선: 상시 개방점 건너편(반대쪽 급전)에서 받는다 — 평소 열림
        self.assertFalse(any(p["bypass"] for p in w.status()["ppdu"])); w.sim({"action": "break", "section": 1}); w.sim({"action": "break", "section": 2}); ok = []; t0 = time.monotonic()      # 구간분전함 2 를 양쪽에서 끊어 고립시킨다(구간분전함 자체 고장과 같은 상황)
        while time.monotonic() - t0 < 7.0: ok.append(all(pp(x)["live"] for x in ("PPDU1", "PPDU2", "PPDU3", "PPDU4"))); time.sleep(0.1)
        self.assertTrue(all(ok), "구간분전함이 고립된 동안 1등급 부하가 끊겼다"); s = w.status(); self.assertEqual(s["isolated"], ["FSU2"]); self.assertTrue(all(pp(x)["bypass"] and pp(x)["kw"] > 5 for x in ("PPDU1", "PPDU2", "PPDU3", "PPDU4")))
        self.assertTrue(any(x["area"] == "우회 결선" and x["level"] == "info" for x in s["n1"]["items"])); w.sim({"action": "restore"}); self.assertTrue(self._wait(lambda: w.status()["ok"] and not any(p["bypass"] for p in w.status()["ppdu"]), 12.0))   # 돌아오면 우회 결선을 다시 연다
        with e.lock:                                                                                                                         # 환망 전체 부하가 간선 정격(630 A)을 넘으면 경보
            w.last = copy.deepcopy(w.status()); [f.update(kw=80.0) for f in w.last["fsu"]]; tot = sum(f["kw"] for f in w.last["fsu"])
            e.alarms.set("ring.over.total", tot > ring.FSU_KW, 2, "환망", "시험"); self.assertGreater(tot, ring.FSU_KW); self.assertEqual((ring.FSU_A, ring.FSU_OUT, ring.FSU_KVA), (630.0, 4, 415))

    def test_ratings_and_assumptions_are_settings(self):
        """정격 · 가정값(ring.spec)은 엔지니어가 고친다: 고치면 배전체계 대수 · 용량 점검이 따라가고, 틀린 값은 막는다. 기본값은 문서의 값이다."""
        e = self.eng; w = e.ringw; sp = ring.spec(w.r); self.assertEqual((sp["fsu_a"], sp["fsu_out"], sp["ppdu_kw"], sp["fsu_kva"], sp["ppdu_ok"], sp["sts"], sp["n1"]), (630.0, 4, 20.0, 415, 20.0, 1, 1))
        need = lambda: {i["id"]: i["need"] for i in e.snapshot()["loads"]["items"]}; self.assertEqual(need(), {"c2": 4, "med": 1, "brk": 2, "ammo": 1}); self.assertEqual(sp["bypass_kw"], 9.48)
        self.assertFalse(http_post(e, {"do": "spec", "spec": {"ppdu_use": 0.8}}, {"role": "operator", "name": "운용"})["ok"])                        # 엔지니어만
        r = http_post(e, {"do": "spec", "spec": {"ppdu_use": 0.8, "pf": 0.85}}, {"role": "engineer", "name": "시험"}); self.assertTrue(r["ok"], r)
        self.assertEqual(need(), {"c2": 4, "med": 1, "brk": 2, "ammo": 2}); self.assertEqual(ring.spec(w.r)["fsu_kw"], round(415 * 0.85)); self.assertEqual(e.snapshot()["loads"]["ppdu_ok"], 16.0)   # 한 대에 16 kW 까지만 싣는다 → 20 kW 부하는 2대
        with open(self.cfg, encoding="utf-8") as f: self.assertEqual(json.load(f)["ring"]["spec"], {"ppdu_use": 0.8, "pf": 0.85})
        for bad in ({"pf": 1.4}, {"fsu_a": 5}, {"nope": 1}): self.assertFalse(http_post(e, {"do": "spec", "spec": bad}, {"role": "engineer", "name": "시험"}).get("ok") and ring.spec(w.r).get("pf") == 1.4)
        self.assertEqual(ring.spec({"spec": {"pf": 1.4, "fsu_a": 800}})["fsu_a"], 800); self.assertEqual(ring.spec({"spec": {"pf": 1.4}})["pf"], 0.9)        # 범위를 벗어난 값은 기본값
        self.assertTrue(http_post(e, {"do": "spec", "spec": {"n1": 0, "bypass": 0}}, {"role": "engineer", "name": "시험"})["ok"]); self.assertEqual(need()["c2"], 2)                         # N+1 을 끄면 정격에 딱 맞는 대수 — 무정전 점검이 주의를 낸다
        with e.lock: w.step(e)
        self.assertTrue(any("N+1" in x["fix"] for x in w.status()["n1"]["items"]))
        self.assertTrue(http_post(e, {"do": "spec", "reset": True}, {"role": "engineer", "name": "시험"})["ok"]); self.assertEqual((need()["ammo"], need()["c2"]), (1, 4))

    def test_monitor_break_discover_and_configure(self):
        e = self.eng; w = e.ringw; self.assertTrue(self._wait(lambda: (e.snapshot()["ring"] or {}).get("ok")))
        v = w.view(e); self.assertEqual(v["status"]["missing"], []); self.assertTrue(self._wait(lambda: w.view(e)["discover"]["n"] == 15 and w.view(e)["discover"]["ok"], 12.0))      # 구간분전함 7 + 부하 앞 배전체계 8
        w.sim({"action": "break", "section": 2}); self.assertTrue(self._wait(lambda: w.status()["cut"] == [2] and w.status()["switched"] and w.status()["ok"]))                  # 구간 차단 뒤 반대쪽 공급
        keys = {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}; self.assertIn("ring.cut.2", keys); self.assertIn("ring.switched", keys)
        w.sim({"action": "break", "section": 3}); self.assertTrue(self._wait(lambda: w.status()["isolated"] == ["FSU3"]))
        w.sim({"action": "break", "section": 3, "on": False}); w.sim({"action": "break", "section": 2, "on": False})                                                     # 단선을 풀면(고치면) 복구 절차: 구간 재투입 → 상시 개방점 다시 개방
        self.assertTrue(self._wait(lambda: w.status()["cut"] == [] and not w.status()["switched"] and w.status()["ok"], 12.0)); self.assertEqual([x["state"] for x in w.status()["sections"]], [1, 1, 1, 1, 0, 1, 1, 1])
        self.assertTrue(self._wait(lambda: not [k for k in {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"} if k.startswith("ring.")]))
        for i in (0, 4, 7):                                                                                                                                          # 급전 구간 · 상시 개방점 구간 · 급전 B 구간을 차례로 끊었다 풀어도 매번 평소 상태로 돌아온다
            w.sim({"action": "break", "section": i}); time.sleep(5.5); w.sim({"action": "break", "section": i, "on": False})
            self.assertTrue(self._wait(lambda: [x["state"] for x in w.status()["sections"]] == [1, 1, 1, 1, 0, 1, 1, 1] and w.status()["ok"], 12.0), i)
        w.sim({"action": "break", "section": 2}); self.assertTrue(self._wait(lambda: w.status()["cut"] == [2] and w.status()["switched"] and w.status()["ok"])); w.sim({"action": "break", "section": 3}); self.assertTrue(self._wait(lambda: w.status()["isolated"] == ["FSU3"]))
        w.sim({"action": "restore"}); w.sim({"action": "swap", "a": "FSU2", "b": "FSU5"}); self.assertTrue(self._wait(lambda: w.status()["fsu"][1]["name"] == "구간분전함 5"))      # 자리를 바꿔 놓아도 조작 없이 따라간다
        self.assertTrue(w.view(e)["discover"]["ok"]); self.assertEqual(w.status()["ppdu"][0]["at"], "FSU2"); self.assertFalse(w.accept(e, "시험")["ok"]); w.sim({"action": "swap"})
        vit = lambda: [(p["id"], p["at"]) for p in w.status()["ppdu"] if p["vital"]]
        self.assertTrue(self._wait(lambda: vit() == [("PPDU1", "FSU2"), ("PPDU2", "FSU2"), ("PPDU3", "FSU2"), ("PPDU4", "FSU2")], 12.0), vit()); self.assertTrue(e.loadw.change({"op": "set", "id": "c2", "fsu": "FSU6"}, "시험")["ok"])            # ★(중요 부하)와 배전체계의 자리는 1등급 부하가 물린 자리를 따른다
        self.assertTrue(self._wait(lambda: vit() == [("PPDU1", "FSU6"), ("PPDU2", "FSU6"), ("PPDU3", "FSU6"), ("PPDU4", "FSU6")], 12.0)); self.assertTrue(e.loadw.change({"op": "set", "id": "c2", "fsu": ""}, "시험")["ok"])
        self._plain(); self.assertTrue(self._wait(lambda: len(w.status()["ppdu"]) == 3 and w.status()["ppdu"][2]["vital"], 12.0))                                             # 부하 목록이 비어 있으면 설정에 적힌 배전체계 · 회로 등급을 쓴다
        ch = [{"name": "통신 중계", "cls": 3}] + [{"name": c["name"], "cls": min(3, c["cls"] + 1) if c["cls"] else 0} for c in w.r["ppdu"][2]["ch"][1:]]      # 1등급 회로를 모두 낮춘다
        r = w.configure(e, {"ppdu": [{"id": "PPDU3", "at": "FSU1", "name": "통신소", "ch": ch}], "open": 3}, "시험"); self.assertTrue(r["ok"])
        with open(self.cfg, encoding="utf-8") as f: saved = json.load(f)["ring"]
        self.assertEqual((saved["ppdu"][2]["at"], saved["ppdu"][2]["name"], saved["ppdu"][2]["ch"][0], saved["open"]), ("FSU6", "통신소", {"name": "통신 중계", "cls": 3}, 3))      # 붙은 곳은 자동으로 알므로 화면에서 고치지 않는다
        self.assertTrue(os.listdir(os.path.join(self.td, "config", "backup"))); self.assertTrue(self._wait(lambda: not w.status()["ppdu"][2]["vital"]))                    # 1등급 회로가 없으면 중요 부하가 아니다
        w.sim({"action": "ppdu", "id": "PPDU1", "what": "ch3", "value": 2}); self.assertTrue(self._wait(lambda: "ring.ch.PPDU1.3" in {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}))
        self.assertRaises(ValueError, w.sim, {"action": "ppdu", "id": "PPDU1", "what": "id", "value": 1})
        self.assertTrue(w.configure(e, {"ppdu": []}, "시험").get("same"))
        self.assertRaises(ValueError, w.sim, {"action": "모름"}); self.assertRaises(ValueError, w.sim, {"action": "swap", "a": "PPDU1", "b": "PPDU6"}); self.assertRaises(ValueError, w.sim, {"action": "swap", "a": "FSU1", "b": "PPDU1"})
        self.assertRaises(ValueError, w.configure, e, {"ppdu": [], "open": -1}, "시험")
        import io, zipfile
        from ifps_ems_rt.hmi import report
        w.sim({"action": "restore"}); w.sim({"action": "break", "section": 5}); self.assertTrue(self._wait(lambda: w.status()["cut"] == [5]))
        x = zipfile.ZipFile(io.BytesIO(report.build(e, e.archw.store, {"days": "1"})[1])).read("word/document.xml").decode("utf-8")                    # 보고서에도 환망 화면과 같은 이름 · 상태가 들어간다
        for t in ("1.4 환망", "구간분전함 5", "차단된 구간 5", "상시 개방점", "배전체계 1"): self.assertIn(t, x)

    def test_units_removed_added_and_shuffled_without_any_setting(self):
        e = self.eng; w = e.ringw; n = lambda: (len(w.status()["fsu"]), len(w.status()["ppdu"])); act = lambda: {a["key"] for a in e.snapshot()["alarms"] if a["state"] == "ACT"}
        self.assertTrue(self._wait(lambda: w.status() and w.status()["ok"] and n() == (7, 8), 12.0))      # 부하 목록대로 배전체계 8대
        self._plain(); self.assertTrue(self._wait(lambda: w.status()["ok"] and n() == (7, 3), 12.0))     # 아래는 장치 인식 자체의 시험 — 부하 목록을 비우고 설정의 배치로
        w.sim({"action": "ppdu", "id": "PPDU2", "what": "mccb", "value": 2}); self.assertTrue(self._wait(lambda: "ring.mccb.PPDU2" in act()))
        w.sim({"action": "remove", "id": "PPDU2"}); w.sim({"action": "remove", "id": "FSU4"}); self.assertTrue(self._wait(lambda: n() == (6, 2) and w.status()["ok"]))            # 대수가 줄어도 화면이 따라가고
        self.assertTrue(self._wait(lambda: not [k for k in act() if k.startswith("ring.")])); self.assertFalse(w.status()["switched"])                                       # 빠진 장치의 경보는 내려간다
        w.sim({"action": "add", "kind": "ppdu", "at": 1}); w.sim({"action": "add", "kind": "fsu"}); self.assertTrue(self._wait(lambda: n() == (7, 3) and w.status()["ok"]))
        s = w.status(); self.assertEqual(len(s["recog"]["new"]), 2); p = next(x for x in s["ppdu"] if x["new"]); self.assertEqual((p["at"], len(p["ch"])), ("FSU1", 6))             # 처음 보는 장치도 바로 쓴다
        r = w.configure(e, {"ppdu": [{"id": p["id"], "name": "취사장 배전"}]}, "시험"); self.assertTrue(r["ok"]); self.assertTrue(self._wait(lambda: next(x for x in w.status()["ppdu"] if x["id"] == p["id"])["name"] == "취사장 배전"))
        before = {x["id_read"]: x["name"] for x in w.status()["fsu"] + w.status()["ppdu"]}; order = [x["id_read"] for x in w.status()["fsu"]]
        w.sim({"action": "shuffle"}); self.assertTrue(self._wait(lambda: [x["id_read"] for x in w.status()["fsu"]] == order[::-1])); s = w.status()
        self.assertEqual({x["id_read"]: x["name"] for x in s["fsu"] + s["ppdu"]}, before); self.assertTrue(s["ok"] and w.view(e)["discover"]["ok"])                       # 이름·구성이 ID 를 따라간다
        self.assertTrue([x for x in e.rt.events if "장치 자동 인식" in str(x)]); self.assertRaises(ValueError, w.sim, {"action": "remove", "id": "PPDU8"})


class AutoDeviceTest(unittest.TestCase):
    """주 장치 자동 인식: 켠 뒤 한 번도 응답하지 않은 장치는 미설치로 보고 경보를 낮춘다. 응답하던 장치가 끊기면 1등급 그대로."""
    def test_never_answered_device_is_treated_as_not_installed(self):
        from types import SimpleNamespace as NS
        from ifps_ems_rt.hmi import autodev
        got = {}; eng = NS(rt=NS(lm=NS(state={"DG": "두절", "FC": "정상"}), seen={"FC"}, fleet=NS(slots={"DG": ["DG", "DG2"], "FC": ["FC"]})), alarms=NS(set=lambda k, on, pr, src, text: got.__setitem__(k, (on, pr))))
        for n, st in eng.rt.lm.state.items(): autodev.link_alarm(eng, n, st)
        self.assertEqual((got["link.DG"], got["absent.DG"], got["link.FC"], got["absent.FC"]), ((False, 1), (True, 3), (False, 1), (False, 3)))
        eng.rt.lm.state["FC"] = "두절"; autodev.link_alarm(eng, "FC", "두절"); self.assertEqual((got["link.FC"][0], got["absent.FC"][0]), (True, False))            # 응답하던 장치의 두절은 그대로 1등급
        eng.rt.lm.state["DG2"] = "두절"; autodev.link_alarm(eng, "DG2", "두절"); self.assertEqual((got["link.DG2"][0], got["absent.DG2"][0]), (False, False))            # 추가 자리가 빈 것은 알리지 않는다
        eng.rt.seen.add("DG2"); autodev.link_alarm(eng, "DG", "두절"); self.assertEqual((got["link.DG"][0], got["absent.DG"][0]), (False, False))                      # 같은 종류가 한 대라도 있으면 첫 자리가 비어도 알리지 않는다
        eng.rt.seen.add("DG"); autodev.link_alarm(eng, "DG", "두절"); self.assertEqual((got["link.DG"][0], got["absent.DG"][0]), (True, False))
        eng.rt.val = {"BUS.a_v": 441.0, "BUS.b_v": 440.0}; eng.rt.lm.state["MTR"] = "정상"; autodev.ems_power(eng); self.assertEqual(got["ems.power"], (False, 2))                 # EMS 주 전원(배전 모선)
        eng.rt.val = {"BUS.a_v": 0.0, "BUS.b_v": 0.0}; autodev.ems_power(eng); self.assertEqual(got["ems.power"], (True, 2)); eng.rt.val = {"BUS.a_v": 0.0, "BUS.b_v": 440.0}; autodev.ems_power(eng); self.assertFalse(got["ems.power"][0])
        eng.rt.val = {"BUS.a_v": 0.0, "BUS.b_v": 0.0}; eng.rt.lm.state["MTR"] = "두절"; autodev.ems_power(eng); self.assertFalse(got["ems.power"][0])                              # 게이트웨이가 끊겨 값을 못 믿으면 내지 않는다


if __name__ == "__main__":
    unittest.main()
