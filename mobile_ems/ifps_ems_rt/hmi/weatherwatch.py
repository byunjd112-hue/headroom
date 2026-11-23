# -*- coding: utf-8 -*-
"""날씨 정보를 화면부에 잇는다: 장병의 수기 입력(작전지), 군 통신망에서 받아 오기·파일 불러오기(주둔지), 태양광 예측에 섞기, AI 예측과 견주기.
계산은 ifps_ems_rt/weather.py 가 한다. 받아 오는 주소는 runtime.json 의 weather.url 만 쓴다(요청으로 받지 않는다).
통신망 자료의 형식은 weather.parse 의 JSON·CSV 다 — 실제 군 기상 체계의 형식이 정해지면 parse 를 맞춘다(가정).
"""
import json, os, time, urllib.request
from datetime import datetime, timedelta
from threading import RLock
from ifps_ems.solar import clear_pv_kw
from .. import weather, fsio

STEP = timedelta(minutes=15)


class WeatherWatch:
    def __init__(self, eng):
        self.eng = eng; self.cfg = weather.settings(eng.cfg.get("weather")); self.path = os.path.join(eng.rt.state_dir, "weather.json"); self.lock = RLock()
        st = {}
        try:
            with open(self.path, encoding="utf-8") as f: st = json.load(f)
        except (OSError, ValueError): st = {}
        self.book = weather.Book(st.get("rows")); self.score = weather.Score(st.get("score")); self.net = st.get("net") or {"t": "", "ok": None, "msg": "받은 적 없음", "n": 0}
        self.t_fetch = 0.0; self.last = {"on": False}

    def _save(self):
        fsio.write_json(self.path, {"rows": self.book.rows, "score": self.score.state(), "net": self.net})

    def _slots(self, n):
        """앞으로 n 칸의 (시각, 맑은 하늘 발전량, 그 시각에 쓸 날씨 기록 또는 None)."""
        now = datetime.now(); base = now.replace(minute=now.minute // 15 * 15, second=0, microsecond=0); off = timedelta(hours=self.eng.rt.hr_off); out = []
        for j in range(1, n + 1):
            t = base + STEP * j; sun = t + off; r = self.book.at(t)
            out.append((t, float(clear_pv_kw(self.eng.rt.site, sun.timetuple().tm_yday, sun.hour + sun.minute / 60)), r))
        return out

    def _mix(self, d, p50):
        """섞은 예측과 그 재료. 반환: (최종, 날씨 기반, 칸 목록, 반영 비율, 설비 보정)"""
        site = self.eng.rt.site; sl = self._slots(len(p50)); cal = weather.calibrate(list(d["pv"]), list(d["clear"]), site.pv_kwp) if d is not None else self.last.get("cal", 1.0)
        w = self.score.weights(self.cfg["w0"], self.cfg["w_max"], len(p50)); out, wx = weather.blend([float(x) for x in p50], [s[1] for s in sl], [None if s[2] is None else self.score.factor(s[2]) for s in sl], cal, w)
        return out, wx, sl, w, cal

    def apply(self, d, p50, plo, phi):
        """예측에 날씨를 섞는다. 반환: (p50, plo, phi, 화면용 정보). 어떤 실패에도 AI 예측을 그대로 돌려준다."""
        if not self.cfg["enabled"]: return p50, plo, phi, {"on": False}
        try:
            with self.lock:
                kwp = self.eng.rt.site.pv_kwp; n = min(len(d["ts"]), 3 * 96)
                self.score.settle({d["ts"][-i]: (float(d["pv"][-i]), bool(d["clear"][-i] > 0.05 * kwp)) for i in range(1, n + 1)}, d["ts"][-1])
                out, wx, sl, w, cal = self._mix(d, p50)
                for h in weather.HORIZONS:
                    if h <= len(out): self.score.note(sl[h - 1][0], h, float(p50[h - 1]), wx[h - 1], out[h - 1], (sl[h - 1][2] or {}).get("sky", ""), sl[h - 1][1] * cal)
                self.book.prune(datetime.now(), self.cfg["keep_days"]); self._save()
                k = [o / a if a > 1e-6 else 1.0 for o, a in zip(out, p50)]; r = lambda xs: [None if x is None else round(float(x), 2) for x in xs]; kwh = lambda xs: round(sum(xs) * 0.25, 1)
                self.last = {"on": True, "w": w[0], "w_by": {str(h): [self.score.weight(self.cfg["w0"], self.cfg["w_max"], h), self.score.stats(h=h)] for h in weather.HORIZONS}, "learned": self.score.learned(), "cal": round(cal, 3), "cover": sum(1 for x in wx if x is not None), "stats": self.score.stats(), "waiting": len(self.score.wait),
                             "kwh": {"ai": kwh([float(x) for x in p50]), "wx": kwh([a if x is None else x for a, x in zip(p50, wx)]), "final": kwh(out)}, "pv_ai": r(p50), "pv_wx": r(wx)}
                return type(p50)(out) if isinstance(p50, list) else p50 * 0 + out, plo * k, phi * k, self.last
        except Exception as e:                                         # 날씨 반영 실패가 예측을 막으면 안 된다
            self.last = {"on": False, "why": f"{type(e).__name__}: {e}"}; return p50, plo, phi, self.last

    def adjust(self, p50, plo):
        """운전계획용: 같은 비율로 섞되 채점은 하지 않는다."""
        if not self.cfg["enabled"]: return p50, plo
        try:
            with self.lock: out = self._mix(None, p50)[0]
            k = [o / a if a > 1e-6 else 1.0 for o, a in zip(out, p50)]; return p50 * 0 + out, plo * k
        except Exception: return p50, plo                              # 실패하면 AI 예측 그대로

    def _changed(self, who, text):
        with self.lock: self._save()
        self.eng.rt.note("날씨", text, actor=who); self.eng.forecast(force=True); return {"ok": True}

    def manual(self, b, who):
        """장병이 넣는 날씨(휴대폰 날씨 앱에 보이는 수준): 하늘 상태 · 강수 확률 · 기온. 기간은 지금부터 hours 시간, 또는 day(1 내일 · 2 모레) 하루."""
        now = datetime.now().replace(second=0, microsecond=0); day = int(b.get("day") or 0)
        if day not in (0, 1, 2): raise ValueError("기간 오류")
        t0 = (now + timedelta(days=day)).replace(hour=0, minute=0) if day else weather._time(b["t0"], "시작") if b.get("t0") else now         # pylint: disable=protected-access
        rec = weather.record(t0, t0 + timedelta(hours=24.0 if day else float(b.get("hours", 6))), b.get("cloud"), b.get("sky"), b.get("temp"), b.get("rain"), "수기", who=who, note=b.get("note", ""), pop=b.get("pop"))
        with self.lock: self.book.add([rec])
        return self._changed(who, f"날씨 수기 입력: {rec['t0']} ~ {rec['t1'][11:]} {rec['sky'] or ''}{'' if rec['pop'] is None else f" 강수 확률 {rec['pop']:g}%"}")

    def load_text(self, text, who, src="통신망(파일)"):
        """받은 글(JSON·CSV)을 넣는다. 같은 출처의 겹치는 기록은 새것으로 바꾼다."""
        recs = weather.parse(text, src)
        with self.lock: self.book.add(recs, replace_src=src)
        return dict(self._changed(who, f"날씨 자료 반영({src}): {len(recs)}건 {recs[0]['t0']} ~ {recs[-1]['t1']}"), n=len(recs))

    def delete(self, at, who):
        with self.lock: n = self.book.remove(str(at))
        return self._changed(who, "날씨 수기 입력 삭제") if n else {"ok": False, "why": "지울 수기 입력이 없습니다"}

    def fetch(self, who="주기"):
        """군 통신망의 날씨 자료를 받아 온다(설정의 주소만)."""
        url = self.cfg["url"]; self.t_fetch = time.time()
        if not url.startswith(("http://", "https://")): return {"ok": False, "why": "받아 올 주소가 설정되지 않았습니다(runtime.json 의 weather.url)"}
        try:
            with urllib.request.urlopen(url, timeout=float(self.cfg["timeout_s"])) as f: text = f.read(262145).decode("utf-8")      # nosec B310 — http·https 만(위에서 확인), 주소는 설정 파일의 값
            r = self.load_text(text, who, "통신망"); self.net = {"t": datetime.now().strftime(weather.FMT), "ok": True, "msg": f"{r['n']}건 받음", "n": r["n"]}
        except Exception as e:                                         # 통신망이 끊겨도 운전은 이어 간다(직전 자료와 AI 예측으로)
            was = self.net.get("ok"); self.net = {"t": datetime.now().strftime(weather.FMT), "ok": False, "msg": f"{type(e).__name__}: {e}"[:120], "n": 0}
            if was is not False: self.eng.rt.note("날씨", f"날씨 자료 받기 실패: {self.net['msg']}", actor=who)
        with self.lock: self._save()
        return {"ok": bool(self.net["ok"]), "why": "" if self.net["ok"] else self.net["msg"]}

    def step(self, eng):
        """주기 작업: 주둔지에서(또는 only_garrison 이 거짓이면 어디서나) 정한 간격으로 받아 온다."""
        c = self.cfg
        if c["enabled"] and c["url"] and (not c["only_garrison"] or eng.rt.mode == "grid") and time.time() - self.t_fetch >= 60.0 * c["interval_min"]: self.fetch()

    def view(self):
        now = datetime.now()
        with self.lock:
            use = self.book.at(now); rows = [dict(r, use=r is use) for r in self.book.ahead(now)][:60]
            return {"ok": True, "enabled": self.cfg["enabled"], "now": now.strftime(weather.FMT), "sky": list(weather.PHONE), "rows": rows, "net": dict(self.net, url=self.cfg["url"], interval_min=self.cfg["interval_min"],
                    only_garrison=self.cfg["only_garrison"], active=bool(self.cfg["url"]) and (not self.cfg["only_garrison"] or self.eng.rt.mode == "grid")), "last": {k: v for k, v in self.last.items() if not k.startswith("pv_")},
                    "w0": self.cfg["w0"], "w_max": self.cfg["w_max"], "recent": self.score.done[-8:][::-1]}

    def sample(self):
        """가상 장치 모드의 시험용 날씨 자료(통신망 자료와 같은 형식). 가상 장치의 구름을 시간별 운량으로 바꾼 것 + 조금의 오차."""
        drv = self.eng.simdrv
        if drv is None: return {"ok": False, "why": "가상 장치 모드가 아닙니다"}
        now = datetime.now().replace(minute=0, second=0, microsecond=0); seq = list(drv.ahead); base = sum(seq[-300:]) / 300
        hours = [{"t": (now + timedelta(hours=h)).strftime(weather.FMT), "cloud": round(weather.cloud_of(seq[min(len(seq) - 1, h * 3600)] if h * 3600 < len(seq) else base), 1), "temp": round(16 + 7 * ((h % 24) / 24), 1), "rain": 0} for h in range(24)]
        return {"issued": now.strftime(weather.FMT), "source": "가상 장치(시험용)", "hours": hours}


def http_get(eng, p):
    return eng.wxw.sample() if p.endswith("weather_sample") else eng.wxw.view()


def http_post(eng, b, sess):
    """POST /api/weather — 운용자: 수기 입력·삭제, 받은 글 넣기, 지금 받아 오기."""
    w = eng.wxw; kind = b.get("do"); who = sess["name"]
    if kind == "manual": return w.manual(b, who)
    if kind == "import": return w.load_text(b.get("text", ""), who)
    if kind == "delete": return w.delete(b.get("at"), who)
    if kind == "fetch": return w.fetch(who)
    raise ValueError("날씨 요청 종류 오류")
