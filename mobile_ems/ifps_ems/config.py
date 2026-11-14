# -*- coding: utf-8 -*-
"""설비 정격·위치(Site)와 운영 감시 시간 한도(SUP). 값은 설계 표준값(안)이며 발주처 협의로 확정한다."""
from dataclasses import dataclass, asdict, fields

HORIZON = 96          # 24시간 = 15분 × 96구간
DT_H = 0.25           # 구간 길이(시간)


@dataclass
class Site:
    name: str = "IFPS-FOB-01"
    lat: float = 37.5             # 북위(°)
    lon: float = 127.0            # 동경(°)
    tz: float = 9.0               # 표준시 오프셋(시간)
    pv_kwp: float = 400.0         # PV 80kWp × 5식
    pv_pr: float = 0.78           # 종합 성능계수(유연 모듈, 평면 설치)
    ess_kwh: float = 1000.0
    ess_kw: float = 500.0
    soc_min: float = 0.15
    soc_max: float = 0.90
    ess_eff: float = 0.95         # 편도 효율
    dg_kw: float = 100.0
    dg_l_per_kwh: float = 0.28
    fc_kw: float = 100.0
    fc_nm3_per_kwh: float = 0.75
    elz_kw: float = 50.0
    elz_kwh_per_nm3: float = 5.0
    h2_nm3: float = 1000.0
    h2_min: float = 0.10
    base_load_kw: float = 80.0    # 전개 계획서의 편성 기준 부하

    def to_dict(self):
        return asdict(self)

    @classmethod
    def keys(cls):
        return [f.name for f in fields(cls)]


# 운영 감시 시간 한도(초). 상세 근거: 예측·계산 로직 설명서 11장
SUP = {
    "comm_s": 2.0,              # 두 경로 모두 무응답 → 두절 (감지 한도 3초 = 2.0 + 감시 주기)
    "ack_s": 1.5,               # 지령 응답 대기
    "retry": 1,                 # 재지령 횟수 (대체 전원까지 한도 5초)
    "stale_s": 5.0,             # 값 갱신 지연 판정
    "wd_s": 3.0,                # 프로세스 생존 신호 간격 한도
    "failover_detect_s": 2.0,   # 주 서버 무응답 판정
    "failover_take_s": 1.0,     # 예비 서버 지령권 인수
    "sync_df_hz": 0.2, "sync_dv_pct": 5.0, "sync_dph_deg": 10.0, "sync_use": 0.8,
    "cb_close_s": 0.05,         # 차단기 투입 시간(위상 보정)
    "ts_err_ms": 1.0, "ts_drift_ppm": 0.5,
}

# 요구 규격(판정 기준)
REQ = {"comm_detect_s": 3.0, "fallback_s": 5.0, "failover_s": 5.0, "wd_detect_s": 5.0, "load_err_pct": 15.0, "pv_err_pct": 15.0}
