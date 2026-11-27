@echo off
REM 이동형 전력체계 TPCS - 실장치 연동 모드. config\runtime.json의 장치 주소와 노트북 IP(192.168.10.x)를 먼저 맞추십시오.
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
python -m ifps_ems verify || (pause & exit /b 1)
echo [1/2] 대응표 검증 및 전 장치 1회 수집
python -m ifps_ems_rt config\runtime.json --check
if errorlevel 1 (
  echo [경고] 통신 이상 장치가 있습니다. 통신 진단 화면에서 확인하십시오.
  choice /m "그래도 기동합니까"
  if errorlevel 2 exit /b 1
)
echo [2/2] 운전 시작
if exist results\model_pv.npz (python -m ifps_ems_rt.hmi config\runtime.json --plan results --open) else (python -m ifps_ems_rt.hmi config\runtime.json --open)
pause
