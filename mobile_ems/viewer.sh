#!/usr/bin/env bash
# 이동형 전력체계 EMS - 기록 조회기(읽기 전용)
set -e; cd "$(dirname "$0")"
exec python3 -m ifps_ems_rt.archview "$@"
