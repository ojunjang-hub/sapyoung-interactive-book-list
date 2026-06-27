@echo off
REM Run uvicorn from this script's folder (machine/user path independent).
REM '%~dp0' expands to the .bat directory; switch into its 'backend' subfolder.
cd /d "%~dp0backend"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
