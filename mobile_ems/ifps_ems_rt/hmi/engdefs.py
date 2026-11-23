# -*- coding: utf-8 -*-
"""제어화면 엔진의 공용 상수와 작은 함수: 경보 등급 글 · 급전선 이름 · 보호 요소 번호 · 권한, PIN 해시, 벽시계 글, 서비스 알림.
"""
import os, secrets, time
from datetime import datetime


PRIO_TXT = {1: "긴급", 2: "높음", 3: "보통", 4: "낮음"}


def _pkg_rev():
    """패키지 리비전(VERSION 파일). 소프트웨어·문서·보고자료가 같은 번호를 쓴다."""
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "VERSION"), encoding="utf-8") as f: return f.read().strip()
    except OSError:
        return "?"


PKG_REV = _pkg_rev()


FEEDERS = ("PV", "DG", "FC", "ESS", "G1", "TIE", "L1", "L2", "L3")


FEEDER_TXT = {"PV": "태양광", "DG": "디젤", "FC": "연료전지", "ESS": "ESS", "G1": "복합전력", "TIE": "모선 연계", "L1": "1등급 부하", "L2": "2등급 부하", "L3": "3등급 부하"}


ANSI = {0: "", 27: "27 저전압", 32: "32 역전력", 50: "50 순시 과전류", 51: "51 한시 과전류", 59: "59 과전압", 64: "64 지락", 81: "81 주파수 이상", 87: "87 차동"}


ROLES = {"viewer": 0, "operator": 1, "engineer": 2}


FLAG_TXT = {0: "정상", 1: "급변", 2: "고착", 3: "갱신 지연", 5: "범위 밖"}


def pin_hash(pin, iters=200_000):
    """PIN 저장 형식: pbkdf2_sha256$반복$솔트hex$해시hex"""
    import hashlib
    salt = secrets.token_bytes(16); dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, iters)
    return f"pbkdf2_sha256${iters}${salt.hex()}${dk.hex()}"


def pin_verify(pin, stored):
    import hashlib
    try:
        alg, iters, salt, h = stored.split("$")
        if alg != "pbkdf2_sha256": return False
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), int(iters))
        return secrets.compare_digest(dk.hex(), h)
    except (ValueError, TypeError):
        return False


def wall_iso(ts=None):
    return datetime.fromtimestamp(time.time() if ts is None else ts).strftime("%Y-%m-%d %H:%M:%S")


def sd_notify(msg):
    """systemd 알림(Type=notify, WatchdogSec). NOTIFY_SOCKET이 없으면(Windows·수동 실행) 아무것도 하지 않는다."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr or not hasattr(__import__("socket"), "AF_UNIX"): return
    import socket
    if addr.startswith("@"): addr = "\0" + addr[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as so: so.sendto(msg.encode(), addr)
    except OSError:
        pass
