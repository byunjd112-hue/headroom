#!/usr/bin/env bash
# 이동형 전력체계 TPCS - 현장 간편 진단 도구. 예: ./diag.sh --auto  /  ./diag.sh --demo
cd "$(dirname "$0")"
exec python3 -m ifps_ems_rt.diag config/runtime.json "$@"
