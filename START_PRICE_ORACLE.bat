@echo off
title SILKGENESIS - Price Oracle
color 0A

echo.
echo  ================================================
echo    SILKGENESIS - INTERNAL PRICE ORACLE
echo  ================================================
echo.
echo  Endpoint : http://127.0.0.1:9000/latest
echo  Health   : http://127.0.0.1:9000/health
echo.

cd /d "%~dp0price-oracle"

python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] Failed to install dependencies.
  pause
  exit /b 1
)

python -m uvicorn app:app --host 127.0.0.1 --port 9000
