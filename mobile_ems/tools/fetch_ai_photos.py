# -*- coding: utf-8 -*-
"""AI 생성 장비 실사 이미지(Higgsfield, 2026-11-15 생성)를 제어화면 photos 폴더로 내려받는다.
인터넷 되는 PC에서 한 번 실행한 뒤 photos 폴더째 폐쇄망 노트북으로 옮긴다.  사용: python tools/fetch_ai_photos.py"""
import os, urllib.request
BASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3G1lrqe7HpJoxxp7X4ZEBNoNiBf/"
FILES = {"ess": "hf_20261115_010141_57f8b3f8-dae6-416e-b40a-338600edeb1d", "pv": "hf_20261123_000834_d8ca91fb-ca15-45c0-b7b2-558601f14577",
         "fc": "hf_20261115_010241_b7143caf-9d32-46b1-9b17-9ab254ecf3fa", "dg": "hf_20261115_010141_8ddbd6bb-4bd7-4f1f-8bac-8eb35b5e7775",
         "dist": "hf_20261115_010140_ce0a7fa6-4aba-40bf-bf8e-636cb8a06a87", "ems": "hf_20261115_010141_6ec591ae-4afc-46b4-bd1b-9fc5c8af09f5",
         "l1": "hf_20261115_010243_b2849db0-96f1-46b4-8815-4a43343b2289", "l2": "hf_20261115_010141_910d7576-104e-499e-af71-78e81ddfcf28",
         "l3": "hf_20261115_010140_cb33fdb7-d308-4e95-a0c0-8a1c48d6e2e7", "barrack": "hf_20261115_010241_29ebdaf2-388c-4006-a5b5-7338c80bf800",
         "fsu": "hf_20261115_010140_e8470644-1f3d-442b-9ed6-bb030642ac2d",
         "gdg": "hf_20261116_011041_b239454d-e21e-47e5-a477-34b322d492da.png"}                      # 주둔지 기존 디젤발전기(컨테이너형 고정식)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ifps_ems_rt", "hmi", "static", "photos")
os.makedirs(out, exist_ok=True)
for name, f in FILES.items():
    dst = os.path.join(out, name + ".jpg")
    try:
        if not BASE.startswith("https://"): raise ValueError("https 주소만 허용")
        urllib.request.urlretrieve(BASE + (f if "." in f else f + ".jpeg"), dst)  # nosec B310 — 고정 https 주소만 사용
        print(f"{name}.jpg  {os.path.getsize(dst) // 1024} KB")
    except Exception as e:
        print(f"{name}: 실패 {e}")
