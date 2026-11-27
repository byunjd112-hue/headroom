#!/usr/bin/env bash
# 이동형 전력체계 TPCS - 실장치 연동 모드
set -e; cd "$(dirname "$0")"
python3 -m ifps_ems verify
python3 -m ifps_ems_rt config/runtime.json --check || { read -r -p "통신 이상 장치가 있습니다. 그래도 기동합니까? [y/N] " a; [ "$a" = "y" ] || exit 1; }
PLAN=""; [ -f results/model_pv.npz ] && PLAN="--plan results"
exec python3 -m ifps_ems_rt.hmi config/runtime.json $PLAN "$@"
