@echo off
REM 이동형 전력체계 EMS - 기록 조회기(읽기 전용). EMS 를 켜지 않고 보관소 파일(archive.db)만 읽는다
chcp 65001 >nul
set PYTHONUTF8=1
cd /d "%~dp0"
where python >nul 2>nul || (echo [오류] Python 3.10 이상을 설치하십시오. & pause & exit /b 1)
python -m ifps_ems_rt.archview %*
pause
