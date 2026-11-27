# -*- coding: utf-8 -*-
"""이동형 전력체계 TPCS 실장치 연동 계층(런타임).

핵심 프로그램(ifps_ems)은 통신 모듈을 쓰지 않는다. 장치와의 통신은 이 패키지에만 두고, 접속 대상은 폐쇄망 안의 허용 목록으로 묶는다.
"""
import os as _os
for _k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):      # 수치 계산(예측 · 학습)을 한 가닥으로 묶는다: 여러 가닥이 바쁘게 돌며 수집 · 제어 주기와 CPU 를 다투지 않게(numpy 를 불러오기 전에 정해야 한다)
    _os.environ.setdefault(_k, "1")

__version__ = "0.1.0"
