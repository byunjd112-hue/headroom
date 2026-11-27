@echo off
REM 이동형 전력체계 TPCS - 현장 간편 진단 도구 (더블클릭 실행). 인자를 주면 그대로 넘긴다: diag.bat --auto / diag.bat --demo
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
where python >nul 2>nul || (echo [오류] Python 3.10 이상을 설치하십시오. & pause & exit /b 1)
python -m ifps_ems_rt.diag config\runtime.json %*
pause
