#!/usr/bin/env bash
# 이동형 전력체계 EMS - 가상 장치 모드
set -e; cd "$(dirname "$0")"
python3 -c "import numpy" 2>/dev/null || python3 -m pip install -r requirements.txt
if [ ! -f results/model_pv.npz ]; then
  python3 -m ifps_ems gen-sample results/sample_site_data.csv && python3 -m ifps_ems train results/sample_site_data.csv results
fi
python3 -m ifps_ems verify
exec python3 -m ifps_ems_rt.hmi config/runtime.json --sim --plan results "$@"
