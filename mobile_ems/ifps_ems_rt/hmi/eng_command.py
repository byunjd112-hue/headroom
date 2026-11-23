# -*- coding: utf-8 -*-
"""지령 처리: 지령 줄(선택 → 실행), 자동 제어, 운용 장소 · 태세. 오래 걸리는 계산을 이 가닥에 넣지 않는다(운용자 지령이 기다린다).Engine(hmi/engine.py)의 한 부분이다 — 기능별로 파일을 나눈 것이며 메서드는 Engine 의 것으로 쓴다.
"""
import math, queue, secrets, time
from .. import hybrid
from .engdefs import wall_iso


LATE_S = 5.0                      # 실행 요청 뒤 이 시간 넘게 밀린 운용자 지령은 버린다


class CommandMixin:
    """Engine 에 섞어 쓰는 묶음(자체 상태는 없다 — self 는 Engine 이다)."""

    # ── 지령 처리
    def _exec_loop(self):
        while self.running:
            try: job = self.jobs.get(timeout=0.5)
            except queue.Empty:
                self.rt.wd.kick("제어", self.rt.now()); continue
            self.busy = job
            try:
                if job["kind"] == "auto": self._auto_control(job.get("who", "EMS"))
                elif job["kind"] == "cmd": self._do_cmd(job)
            except Exception as e:
                self.rt.note("오류", f"지령 처리 예외: {type(e).__name__}: {e}")
            finally:
                self.busy = None; self.rt.wd.kick("제어", self.rt.now())

    def _send(self, dev, cmd, who):
        n0 = len(self.rt.cmd.log); ok, dt = self.rt.cmd.send(dev, cmd)
        for e in self.rt.cmd.log[n0:]:
            e["wall"] = wall_iso(); e["who"] = who; self.rt.note("지령", e["text"], actor=who)
        if len(self.rt.cmd.log) > 2000: del self.rt.cmd.log[:1000]
        return ok, dt

    def _auto_control(self, who):
        rt = self.rt; rt.t_ctl = rt.now(); t0 = time.monotonic()
        want = rt.decide(); note = getattr(rt.policy, "note", "") if rt.policy else "규칙 운전"
        want["ELZ"] = bool(want["_policy"][2]) and not want.get("DG")      # 수전해: 계획이 고르고 디젤 운전 중이 아닐 때만
        done = []
        if want.get("_hold"):                                              # 수전 차단기 상태를 못 읽는다: 기동 · 정지를 보류(경보 grid.blind)
            self.last_decision = {"t": wall_iso(), "want": {}, "reserve": False, "policy": "보류 — 수전 차단기 상태를 읽지 못함", "action": list(want["_policy"]), "done": [], "ms": 0}; return
        for n, k in rt.targets(("DG", "FC", "ELZ")):
            if n not in rt.dev or (n in rt.gdgs and "GDG" not in want): continue
            w_n = want["GDG"] if n in rt.gdgs else want[k]
            if w_n != rt.dev[n].on:
                ok, dt = self._send(n, "start" if w_n else "stop", who); done.append({"dev": n, "on": w_n, "ok": ok, "dt": round(dt, 2)})
        self._fc_setpoint(want, who); hybrid.apply(self.rt, want, who)
        self.last_decision = {"t": wall_iso(), "want": {k: bool(v) for k, v in want.items() if not k.startswith("_")}, "reserve": bool(want.get("_reserve")),
                              "policy": note or "규칙 운전", "action": list(want["_policy"]), "done": done, "ms": round((time.monotonic() - t0) * 1000)}

    def _fc_setpoint(self, want, who):
        """연료전지 출력 설정: 예비력만으로 병렬했으면 대기(0 kW), 계획이 골랐으면 정격."""
        rt = self.rt; us = [n for n in rt.fleet.live("FC") if n in rt.dev and rt.dev[n].on and f"{n}.kw_set" in rt.links[n].by_tag and rt.can_write(n)]
        if rt.rewrite.intersection(us): self.fc_set_written = None; rt.rewrite.difference_update(us)      # 통신이 끊겼다 돌아온 장치: 설정값을 다시 쓴다      # 운전 중인 연료전지 모두(여러 대면 대마다 정격)
        if not us: self.fc_set_written = None; return                            # 정지했다가 다시 기동하면 설정값을 다시 쓴다
        sp = 0.0 if (want.get("_reserve") and not bool(want["_policy"][1])) else rt.site.fc_kw
        if self.fc_set_written != (sp, tuple(us)) and all([rt.links[n].write(f"{n}.kw_set", sp) for n in us]):
            self.fc_set_written = (sp, tuple(us)); rt.note("지령", f"FC 출력 설정 {sp:.0f}kW ({'순동 예비 대기' if sp == 0 else '정격 운전'})", actor=who)

    def _do_cmd(self, job):
        dev, cmd, who = job["dev"], job["cmd"], job["who"]
        if time.monotonic() > job.get("exp", float("inf")) + LATE_S:        # 앞선 지령(발전기 기동 대기 등)에 밀려 너무 늦었다: 운용자가 잊은 지령이 뒤늦게 나가지 않게 버린다
            text = f"{dev} {cmd} 지령 버림 — 앞선 지령 처리로 {LATE_S:.0f}초 넘게 밀림. 다시 지령하십시오"
            self.rt.cmd.log.append({"t": 0, "dev": dev, "cmd": cmd, "ok": False, "text": text, "wall": wall_iso(), "who": who}); self.rt.note("지령", text, actor=who); return
        if cmd == "set":
            tag, val = job["tag"], job["value"]
            us = [n for n in self.rt.fleet.live(dev) if self.rt.can_write(n)] if tag.startswith(dev + ".") else [dev] * int(self.rt.can_write(dev))      # 같은 종류가 여러 대면 있는 장치 모두에(선택 뒤 통신이 끊긴 장치에는 보내지 않는다)
            each = val if tag in ("FC.kw_set", "DG.mode_set") else val / max(1, self.rt.fleet.share(dev) if len(us) > 1 else 1)        # 합으로 다루는 설정값(ESS·PV)은 똑같이 나누고, 연료전지 출력은 대마다
            ok = bool(us) and all([self._set1(n, n + tag[len(dev):] if n != dev else tag, each) for n in us])
            self.rt.cmd.log.append({"t": 0, "dev": dev, "cmd": f"set {tag}={val}", "ok": ok, "text": f"{tag} 설정 {val} {'완료' if ok else '실패'}", "wall": wall_iso(), "who": who})
            self.rt.note("지령", f"{tag} 설정 {val} {'완료' if ok else '실패'}", actor=who)
            if tag == "FC.kw_set" and ok: self.fc_set_written = (val, ("FC",))
            return
        for n in self.rt.fleet.live(dev) or [dev]: self._send(n, cmd, who)                    # 손으로 낸 기동·정지도 그 종류의 있는 장치 모두에게

    def _set1(self, n, tag, value):
        ok = self.rt.links[n].write(tag, value)
        if ok: self.rt._w[tag] = value                                      # pylint: disable=protected-access — 자동 제어가 같은 값을 다시 쓰지 않게, 다른 값이면 다시 쓰게
        return ok

    # ── 선택-실행(SBO) 지령: 선택 후 sbo_s초 안에 실행해야 한다
    def _ready_why(self, dev, cmd):
        """지령·설정을 받을 수 있는지. 같은 종류가 여러 대면 있는 장치로 확인한다(첫 자리가 비어도, 한 대라도 받을 수 있으면 통과). 반환: 못 받는 까닭(받을 수 있으면 빈 글)."""
        rt = self.rt
        if cmd is None:
            one = next(iter(rt.fleet.live(dev)), dev)
            return "" if rt.can_write(one) else "통신 두절" if not rt.lm.controllable(one) else "장치 생존 계수(hb) 정지" if rt.hb_stop.get(one) else "현장 수동 모드"
        whys = [rt.cmd.check(n, cmd) for n in (rt.fleet.live(dev) or [dev])]; return "" if not all(whys) else whys[0]

    def select(self, dev, cmd, who, tag=None, value=None):
        rt = self.rt
        if dev not in rt.links: return {"ok": False, "why": "정의되지 않은 장치"}
        if cmd == "set":
            p = rt.links[dev].by_tag.get(tag)
            if p is None or p["rw"] != "w": return {"ok": False, "why": f"쓰기 점 아님: {tag}"}
            if not (str(tag).endswith("_set") or str(tag).startswith("LDS.")): return {"ok": False, "why": f"설정 대상 아님: {tag} (기동·정지는 지령으로, 순번·지령 레지스터는 직접 쓸 수 없음)"}
            try: value = float(value)
            except (TypeError, ValueError): return {"ok": False, "why": "설정값 오류"}
            if not math.isfinite(value): return {"ok": False, "why": "설정값 오류(유한한 수가 아님)"}
            if (p["lo"] is not None and value < p["lo"]) or (p["hi"] is not None and value > p["hi"]): return {"ok": False, "why": f"설정 범위 {p['lo']}~{p['hi']} 밖"}
            why = self._ready_why(dev, None)
        else:
            if dev not in rt.dev: return {"ok": False, "why": "지령 대상 아님(감시 전용 장치)"}
            why = self._ready_why(dev, cmd)
        if why: return {"ok": False, "why": why}
        sid = secrets.token_hex(8); self.selects[sid] = {"dev": dev, "cmd": cmd, "who": who, "tag": tag, "value": value, "exp": time.monotonic() + float(self.hcfg["sbo_s"])}
        rt.note("선택", f"{dev} {cmd}{' ' + str(tag) + '=' + str(value) if cmd == 'set' else ''} 선택(SBO)", actor=who)
        return {"ok": True, "sid": sid, "exp_s": float(self.hcfg["sbo_s"])}

    def operate(self, sid, who):
        s = self.selects.pop(sid, None)
        if s is None: return {"ok": False, "why": "선택 없음 또는 이미 사용"}
        if time.monotonic() > s["exp"]: return {"ok": False, "why": "선택 시간 초과 — 다시 선택"}
        if s["who"] != who: return {"ok": False, "why": "선택한 운용자와 다름"}
        self.jobs.put({"kind": "cmd", **s}); return {"ok": True, "queued": self.jobs.qsize()}

    def cancel(self, sid, who):
        s = self.selects.pop(sid, None)
        if s: self.rt.note("선택", f"{s['dev']} {s['cmd']} 선택 취소", actor=who)
        return {"ok": True}

    def set_ops(self, q, who):
        """운용 장소(작전지·주둔지)와 운용 태세(평시·저소음·자립) 변경."""
        mode, posture = q.get("mode"), q.get("posture")
        if mode is None and posture is None: raise ValueError("mode 또는 posture 가 필요합니다")
        with self.lock:
            self.rt.set_ops(mode=mode, posture=posture, who=who)
            if self.sim and "CB.GRID" in self.plant.by_tag:
                # 가상 장치: 주둔지 평시·저소음이면 상전이 붙은 상태, 주둔지 자립(전시·유사시 상전 상실)이면 수전 차단기가 열린 상태로 모사한다
                self.plant.set("CB.GRID", 1 if (self.rt.mode == "grid" and self.rt.posture != "자립") else 0); self.plant.set("FLT.GRID", 0)
                if self.rt.mode != "grid": self.plant.set("ESS.kw_set", 0)
        self.rt.t_ctl = -1e9                                                         # 다음 주기에 곧바로 다시 판단
        return {"ok": True, "ops": self.ops()}

    def ops(self):
        rt = self.rt; g = rt.gar; hr = rt.hr()
        return {"mode": rt.mode, "tied": rt.tied(), "outage": rt.mode == "grid" and not rt.tied(), "posture": rt.posture, "autonomy": rt.auto_h, "target_h": rt.auto_target_h,
                "target_left_h": round(max(0.0, rt.auto_target_h - (rt.now() - rt.t_posture) / 3600.0), 1) if rt.posture == "자립" else None,
                "shed": sorted(rt.shedder.mine), "shed_why": dict(rt.shedder.why), "garrison": rt.gar_last, "gdg": rt.gdg_last, "gdgs": list(rt.gdgs), "gdg_kw": g.gdg_kw, "can_grid": any(p["tag"] == "GRID.kw" for p in rt.pts),
                "gcfg": {"peak_kw": g.peak_kw, "import_min_kw": g.import_min_kw, "reserve_soc": g.reserve_soc, "band": g.band(hr), "priced": bool(g.price_peak or g.price_mid or g.price_off)}}

    def set_auto(self, on, who):
        self.auto = bool(on); self.rt.ops_auto = self.auto
        try: self.rt.save_ops()
        except OSError: pass
        self.rt.note("운전", f"자동 제어 {'설정' if on else '해제'}", actor=who); return {"ok": True, "auto": self.auto}

    def control_now(self, who):
        self.jobs.put({"kind": "auto", "who": who}); self.rt.note("운전", "제어 주기 즉시 실행 요청", actor=who); return {"ok": True}
