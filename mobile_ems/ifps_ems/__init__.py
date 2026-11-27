# -*- coding: utf-8 -*-
"""이동형 전력체계 TPCS 핵심 프로그램.

예측(forecast), 24시간 운전계획(dispatch), 운영 감시 판정(supervisor), 감사 기록(security),
태양 위치(solar), 자료 입출력(dataio)을 담는다. 이 패키지는 통신 모듈(socket 등)을 쓰지 않는다.
장치 통신은 실장치 연동 계층(ifps_ems_rt)에만 둔다.
"""
import os as _os
for _k in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):      # 수치 계산(예측 · 학습)을 한 가닥으로 묶는다: 여러 가닥이 바쁘게 돌며 수집 · 제어 주기와 CPU 를 다투지 않게(numpy 를 불러오기 전에 정해야 한다)
    _os.environ.setdefault(_k, "1")

__version__ = "0.6.0"
