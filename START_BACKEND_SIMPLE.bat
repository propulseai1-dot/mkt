@echo off
title SilkGenesis - Backend SIMPLE (debug)
color 0C
echo.
echo  ============================================
echo   BACKEND - MODE DEBUG (log detaille)
echo   Meme API que le backend principal (market_server)
echo  ============================================
echo.

cd /d %~dp0api-service

echo Stopping previous processes on port 5000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000 " 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo Demarrage uvicorn (debug)...
echo.
echo  Backend : http://127.0.0.1:5000
echo  Health  : http://127.0.0.1:5000/api/health
echo  Login   : admin / admin2026
echo.
echo  [Ctrl+C to stop]
echo.

python -m uvicorn market_server:app --host 0.0.0.0 --port 5000 --log-level debug

echo.
echo  [!] Server stopped.
pause
