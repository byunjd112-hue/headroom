# -*- coding: utf-8 -*-
"""PIN 해시 생성: python -m ifps_ems_rt.hmi.pin  → runtime.json hmi.pin_operator_hash / pin_engineer_hash 에 붙여 넣고 평문 pin_* 는 지운다."""
import getpass, sys
from .engine import pin_hash

if __name__ == "__main__":
    a = getpass.getpass("새 PIN(6자리 이상 권장): "); b = getpass.getpass("다시 입력: ")
    if a != b or len(a) < 4: print("불일치 또는 4자리 미만", file=sys.stderr); sys.exit(1)
    print(pin_hash(a))
