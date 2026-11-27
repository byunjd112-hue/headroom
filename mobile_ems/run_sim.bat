@echo off
REM 이동형 전력체계 TPCS - 가상 장치 모드(실장치 없이 시연·교육·시험)
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
where python >nul 2>nul || (echo [오류] Python 3.10 이상을 설치하십시오. & pause & exit /b 1)
python -c "import numpy" 2>nul || python -m pip install -r requirements.txt
if not exist results\model_pv.npz (
  echo 예측 모델 준비 중 - 합성 현장 자료 생성 및 학습
  python -m ifps_ems gen-sample results\sample_site_data.csv
  python -m ifps_ems train results\sample_site_data.csv results
)
python -m ifps_ems verify || (pause & exit /b 1)
python -m ifps_ems_rt.hmi config\runtime.json --sim --plan results --open
pause
