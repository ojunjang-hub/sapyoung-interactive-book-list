@echo off
REM 배치 파일 위치 기준으로 backend로 이동 (머신/사용자 경로에 독립적)
cd /d "%~dp0backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
