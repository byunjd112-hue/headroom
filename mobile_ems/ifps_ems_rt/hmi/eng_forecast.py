# -*- coding: utf-8 -*-
"""예측 · 지속 학습: 예측 사전 계산(백그라운드), 시연용 자료, 학습 · 되돌리기.Engine(hmi/engine.py)의 한 부분이다 — 기능별로 파일을 나눈 것이며 메서드는 Engine 의 것으로 쓴다.
"""
import json, os, threading, time
from datetime import datetime, timedelta
from . import fcstats


class ForecastMixin:
    """Engine 에 섞어 쓰는 묶음(자체 상태는 없다 — self 는 Engine 이다)."""

    # ── 예측·정밀도(백테스트). 무거우므로 10분마다 백그라운드 갱신
    def forecast(self, force=False):
        with self.fc_lock:
            c = self.fc_cache
            stale = c is not None and c.get("ok") and c.get("_slot") != self._slot_now()          # 15분 구간이 넘어가면 새 실측을 넣어 다시 예측한다
            if c is None or force or stale or time.time() - c["_t"] > (600 if c.get("ok") else 20):       # 실패는 20초 뒤 다시 시도
                if not self._fc_busy:
                    self._fc_busy = True; threading.Thread(target=self._compute_forecast, daemon=True).start()
            return c or {"ok": False, "why": "예측 계산 중…"}

    # ── 지속 학습
    def _models_dir(self):
        return self.plan_dir or os.path.join(os.path.dirname(self.cfg_path), "..", "results")

    def _ai_loop(self):
        while self.running:
            time.sleep(5.0)
            try: self.skyw.step(self); self.wxw.step(self)
            except Exception as e: self.rt.note("예측", f"하늘 카메라 처리 실패: {type(e).__name__}: {e}")          # 카메라 문제로 학습 주기가 멈추면 안 된다
            if self.ai_cfg.get("enabled") and not self.ai_busy and time.time() >= self.ai_next: self.ai_train("주기")

    def ai_train(self, who="주기"):
        """학습 한 주기를 별도 프로세스로 돌린다(제어 주기를 방해하지 않고, 학습이 죽어도 EMS 는 계속 돈다). 반환: 기록."""
        import subprocess, sys  # nosec B404 — 같은 파이썬으로 학습 모듈을 실행(고정 인자)
        from ifps_ems import learner
        if self.ai_busy: return {"ok": False, "why": "학습이 이미 진행 중"}
        self.ai_busy = True; rec = {"adopted": False, "why": ""}; md = self._models_dir()
        try:
            site = self.rt.site; hist, md, src = self._forecast_source(site, training=True)
            opt = os.path.join(self.rt.state_dir, "ai_train.json")
            with open(opt, "w", encoding="utf-8") as f: json.dump({"site": site.to_dict(), "ai": {k: v for k, v in self.ai_cfg.items() if k in learner.DEFAULTS}, "source": src}, f, ensure_ascii=False)
            r = subprocess.run([sys.executable, "-m", "ifps_ems.learner", hist, md, opt], capture_output=True, text=True, timeout=900,   # nosec B603 — 고정 인자, shell 미사용
                               cwd=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
            rec = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 and r.stdout.strip() else {"adopted": False, "why": f"학습 프로세스 오류: {(r.stderr or '')[-200:]}"}
        except Exception as e:                            # 학습 실패는 기록만 한다(현재 모델 유지)
            rec = {"adopted": False, "why": str(e) if isinstance(e, ValueError) else f"학습 실패: {type(e).__name__}: {e}"}
        finally:
            self.ai_busy = False; self.ai_next = time.time() + 3600.0 * float(self.ai_cfg["sim_retrain_h" if self.sim else "retrain_h"])
        self.ai_last = rec; self.rt.ai_degraded = bool(rec.get("degraded"))
        self.rt.note("예측", f"지속 학습({who}): {rec.get('why', '')}" + (f" — 판 {rec['ver']}" if rec.get("ver") else ""), actor=who if who != "주기" else "ems")
        if rec.get("adopted") or rec.get("recal"): self._ai_adopted()
        return dict(rec, ok=True)

    def _ai_adopted(self):
        """새 모델(또는 되돌린 모델)을 운전 계획과 예측 화면에 반영한다."""
        if self.rt.policy is not None and hasattr(self.rt.policy, "reload"): self.rt.policy.reload()
        self.forecast(force=True)

    def ai_rollback(self, who):
        from ifps_ems import learner
        rec = learner.rollback(self._models_dir()); self.rt.note("예측", f"예측 모델 되돌리기: {rec['why']}", actor=who)
        if rec.get("adopted"): self._ai_adopted()
        return dict(rec, ok=bool(rec.get("adopted")))

    def ai_status(self):
        from ifps_ems import learner
        md = self._models_dir(); act = learner.active(md)
        return {"ok": True, "enabled": bool(self.ai_cfg.get("enabled")), "busy": self.ai_busy, "active": act, "history": learner.history(md)[-12:][::-1], "degraded": self.rt.ai_degraded,
                "next_s": max(0, round(self.ai_next - time.time())), "retrain_h": float(self.ai_cfg["sim_retrain_h" if self.sim else "retrain_h"]), "limit": float(self.ai_cfg.get("nmae_limit", learner.DEFAULTS["nmae_limit"])),
                "min_rows": learner.MIN_FIT + int(self.ai_cfg.get("holdout_days", learner.DEFAULTS["holdout_days"])) * 96}

    @staticmethod
    def _slot_now():
        """마지막으로 끝난 15분 구간의 시작 시각."""
        n = datetime.now(); return n.replace(minute=n.minute // 15 * 15, second=0, microsecond=0) - timedelta(minutes=15)

    def _compute_forecast(self):
        from ifps_ems import attn
        try:
            import numpy as np
            from ifps_ems import dataio
            from ifps_ems.forecast import LoadForecaster, PVForecaster
            attn.set_cancel(lambda: getattr(self, "halted", False)); site = self.rt.site; hist, md, src = self._forecast_source(site)      # EMS 가 멈추면 이 계산도 그만둔다
            d = dataio.load_csv(hist, site); n = d["n"]; attn._check()      # pylint: disable=protected-access
            fl, fp = LoadForecaster(site), PVForecaster(site); tl = dataio.load_model(os.path.join(md, "model_load.npz"), fl); tp = dataio.load_model(os.path.join(md, "model_pv.npz"), fp) and fp.trained
            from ifps_ems import learner
            meta = learner.active(md); o = n - 1                                # 적용 중인 모델 정보(최근 오차 보정을 켤지 포함)
            l50, llo, lhi, bl = learner.predict(fl, d, o, "load", site, meta); p50, plo, phi, bp = learner.predict(fp, d, o, "pv", site, meta); p50, plo, phi, wx = self.wxw.apply(d, p50, plo, phi)      # 날씨 입력을 섞는다
            acc, daily = fcstats.backtest(d, fl, fp, site, meta, lambda: getattr(self, "halted", False))
            r = lambda a: [round(float(x), 2) for x in a]; ts = d["ts"]
            out = {"ok": True, "source": src, "trained": {"load": tl, "pv": tp}, "issued": ts[-1], "hist_ts": ts[-96:], "load_act": r(d["load"][-96:]), "pv_act": r(d["pv"][-96:]),
                   "clear_hist": r(d["clear"][-96:]), "load": r(l50), "load_lo": r(llo), "load_hi": r(lhi), "pv": r(p50), "pv_lo": r(plo), "pv_hi": r(phi),
                   "acc": acc,
                   "daily": daily, "_t": time.time(), "_slot": self._slot_now(), "calc_s": None,
                   "ai": {"ver": meta.get("ver"), "t": meta.get("t"), "bias_load": None if bl is None else round(bl, 2), "bias_pv": None if bp is None else round(bp, 3)},
                   "sky": self.skyw.status(), "pv_ai": fp.explain(d, o), "weather": wx}
            self.rt.pv_day_kwh = float(np.sum(p50)) * 0.25                     # 자립 지속시간 계산에 쓰는 하루 태양광 예상량
            with self.fc_lock: self.fc_cache = out
        except Exception as e:
            with self.fc_lock: self.fc_cache = {"ok": False, "why": str(e) if isinstance(e, ValueError) else f"예측 계산 실패: {type(e).__name__}: {e}", "_t": time.time()}
        finally:
            self._fc_busy = False; attn.set_cancel(None)      # 이 가닥에 건 중단 조건을 지운다 — 남으면 EMS 가 멈춘 뒤 같은 가닥의 다른 예측 계산까지 중단된다

    def _forecast_source(self, site, training=False):
        """예측에 쓸 이력 파일을 고른다. 반환: (이력 경로, 모델 폴더, 출처 설명)"""
        hist = os.path.join(self.rt.state_dir, "history.csv"); md = self.plan_dir or os.path.join(os.path.dirname(self.cfg_path), "..", "results")
        rows = 0
        if os.path.exists(hist):
            with open(hist, encoding="utf-8") as f: rows = sum(1 for _ in f) - 1
        if rows >= 8 * 96: return hist, md, "현장 실측 이력(history.csv)"
        hist = os.path.join(md, "sample_site_data.csv")
        if not os.path.exists(hist):
            if not self.sim: raise ValueError(f"실측 이력이 {rows}줄(8일 = 768줄 필요)입니다. 이력이 쌓이면 자동으로 예측을 시작합니다")
            self._make_demo_data(md, site)                    # 시연 모드: 합성 자료와 모델이 없으면 만들어 쓴다
        if self.sim:
            live = self._live_demo(md, site, rows); src = f"합성 현장 자료 + 가상 장치 실측 {max(rows, 0)}구간(지금 시각까지 이어 붙임)"
            from ifps_ems import learner
            if not learner.active(md) and self.ai_cfg.get("enabled") and self.ai_last is None:      # 시연 첫 기동: 곧바로 한 번 학습·검증한다(별도 프로세스 — 제어 주기를 방해하지 않게)
                if not self.ai_busy: self.ai_next = min(self.ai_next, time.time())
                if not training: raise ValueError("첫 기동 학습 중입니다(1분 안팎). 끝나면 지금 자료에 맞춘 예측을 표시합니다")     # 다른 자료로 만든 기본 모델의 수치를 보여 주지 않는다
            return live, md, src
        return hist, md, "합성 현장 자료(실측 8일 미만)"

    def _live_demo(self, md, site, rows):
        """시연 모드: 합성 자료를 '지금'까지 이어지게 만들고 가상 장치의 실측 이력(history.csv)을 덮어쓴다 → 시간이 지나면 예측도 따라 움직인다.
        합성 자료는 그해 1월 1일부터 내일까지를 하루에 한 번 만든다(같은 씨앗이라 지난 구간의 값은 바뀌지 않는다)."""
        import csv
        from ifps_ems import dataio
        now = datetime.now(); slot = self._slot_now(); ref = now - timedelta(days=45); anchor = datetime(ref.year, 1, 1)
        base = os.path.join(md, f"demo_base_s{anchor:%Y}_{now:%Y%m%d}.csv"); fmt = "%Y-%m-%d %H:%M"
        if not os.path.exists(base):
            for f in os.listdir(md):
                if f.startswith("demo_base_"): os.remove(os.path.join(md, f))
            dataio.gen_sample(site, base + ".tmp", days=(now.date() - anchor.date()).days + 2, start=anchor.strftime(fmt)); os.replace(base + ".tmp", base)
        lo = (slot - timedelta(days=60)).strftime(fmt); hi = slot.strftime(fmt); real = {}
        if rows > 0:
            with open(os.path.join(self.rt.state_dir, "history.csv"), encoding="utf-8") as f: real = {r[0]: r for r in csv.reader(f) if r and lo < r[0] <= hi}
        live = os.path.join(md, "demo_live.csv")
        with open(base, encoding="utf-8") as f, open(live + ".tmp", "w", newline="", encoding="utf-8") as g:
            rd = csv.reader(f); wr = csv.writer(g); wr.writerow(next(rd))
            for r in rd:
                if lo < r[0] <= hi: wr.writerow(real.get(r[0], r))
        os.replace(live + ".tmp", live)
        return live

    def _make_demo_data(self, md, site):
        """시연용 합성 현장 자료(120일)와 예측 모델을 만든다. 실행 파일(run_sim)을 거치지 않고 기동했거나 results 폴더가 비었을 때."""
        from ifps_ems import dataio
        from ifps_ems.forecast import LoadForecaster, PVForecaster
        os.makedirs(md, exist_ok=True); csvp = os.path.join(md, "sample_site_data.csv"); tmp = csvp + ".tmp"
        dataio.gen_sample(site, tmp); os.replace(tmp, csvp); d = dataio.load_csv(csvp, site)
        for name, cls in (("model_load.npz", LoadForecaster), ("model_pv.npz", PVForecaster)):
            if not os.path.exists(os.path.join(md, name)): dataio.save_model(os.path.join(md, name), cls(site).fit(d))
        self.rt.note("예측", f"시연용 합성 현장 자료와 예측 모델 생성: {md}")
