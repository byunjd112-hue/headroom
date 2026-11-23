# -*- coding: utf-8 -*-
"""경보 관리자: 발생 · 복귀 · 확인 상태와 경보 일지.
"""
import collections, threading, time


# ───────────────────────────────── 경보 관리 (ISA-18.2 형식: 발생·복귀·확인)
class AlarmManager:
    def __init__(self):
        self.items = {}; self.hist = collections.deque(maxlen=2000); self.n = 0; self.lock = threading.Lock()

    def _new(self, key, prio, src, text, state):
        self.n += 1
        a = {"id": self.n, "key": key, "prio": prio, "src": src, "text": text, "state": state, "acked": False,
             "t_on": time.time(), "t_off": None if state == "ACT" else time.time(), "ack_by": None}
        self.items[key] = a; self.hist.appendleft({"t": a["t_on"], "ev": "발생", "prio": prio, "src": src, "text": text})
        return a

    def set(self, key, cond, prio, src, text):
        with self.lock:
            a = self.items.get(key)
            if cond:
                if a is None: self._new(key, prio, src, text, "ACT")
                elif a["state"] == "RTN":
                    a.update(state="ACT", acked=False, t_on=time.time(), t_off=None, text=text, prio=prio)
                    self.hist.appendleft({"t": time.time(), "ev": "재발생", "prio": prio, "src": src, "text": text})
                else:
                    a["text"] = text
                    if prio < a["prio"]:                  # 더 급해졌다(예: 연료 보충 요청 → 긴급): 등급을 올리고 다시 미확인으로
                        a["acked"] = False; a["ack_by"] = None; self.hist.appendleft({"t": time.time(), "ev": "격상", "prio": prio, "src": src, "text": text})
                    a["prio"] = prio
            elif a is not None and a["state"] == "ACT":
                a["state"] = "RTN"; a["t_off"] = time.time()
                self.hist.appendleft({"t": time.time(), "ev": "복귀", "prio": a["prio"], "src": a["src"], "text": a["text"]})
                if a["acked"]: del self.items[key]

    def renew(self, key):
        """확인한 경보를 다시 '미확인'으로 돌린다(조치될 때까지 주기적으로 다시 알릴 때)."""
        with self.lock:
            a = self.items.get(key)
            if a is not None and a["state"] == "ACT" and a["acked"]:
                a["acked"] = False; a["ack_by"] = None; a["t_on"] = time.time()
                self.hist.appendleft({"t": time.time(), "ev": "재통보", "prio": a["prio"], "src": a["src"], "text": a["text"]})

    def event(self, prio, src, text):
        """한 번 생기고 끝나는 사건 경보(지령 실패 등). 확인하면 사라진다."""
        with self.lock:
            for a in self.items.values():                                # 같은 내용의 미확인 사건은 횟수만 올린다(주기마다 반복되는 차단 사유가 목록을 채우지 않게)
                if a["key"].startswith("evt.") and not a["acked"] and a["src"] == src and a.get("base", a["text"]) == text:
                    a["count"] = a.get("count", 1) + 1; a["base"] = text; a["text"] = f"{text} (×{a['count']})"; a["t_on"] = a["t_off"] = time.time(); return
            self._new(f"evt.{self.n + 1}", prio, src, text, "RTN")

    def ack(self, ids, who):
        with self.lock:
            n = 0
            for k, a in list(self.items.items()):
                if ids == "all" or a["id"] in ids:
                    if not a["acked"]:
                        a["acked"] = True; a["ack_by"] = who; n += 1
                        self.hist.appendleft({"t": time.time(), "ev": "확인", "prio": a["prio"], "src": a["src"], "text": a["text"] + f" (확인: {who})"})
                    if a["state"] == "RTN": del self.items[k]
            return n

    def snapshot(self):
        with self.lock:
            lst = sorted(self.items.values(), key=lambda a: (a["acked"], a["state"] != "ACT", a["prio"], -a["t_on"]))
            cnt = {p: {"act": 0, "unack": 0} for p in (1, 2, 3, 4)}
            for a in lst:
                if a["state"] == "ACT": cnt[a["prio"]]["act"] += 1
                if not a["acked"]: cnt[a["prio"]]["unack"] += 1
            return [dict(a) for a in lst], cnt

    def journal(self, n=300):
        with self.lock:
            return list(self.hist)[:n]
