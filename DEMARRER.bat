@echo off
title SilkGenesis - Start
color 0A
echo.
echo  ============================================
echo   SILKGENESIS MARKETPLACE - STARTUP
echo  ============================================
echo.

:: Kill previous Python processes on port 5000
echo [1/3] Stopping previous processes...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Start backend
echo [2/3] Starting backend (port 5000)...
start "SilkGenesis Backend" cmd /k "cd /d %~dp0api-service && set SILKGENESIS_PUBLIC=1 && python market_server.py"

:: Wait until backend is ready
echo     Waiting for backend...
timeout /t 4 /nobreak >nul

:: Start React frontend
echo [3/3] Starting React frontend (port 3000)...
start "SilkGenesis Frontend" cmd /k "cd /d %~dp0frontend && npm start"

echo.
echo  ============================================
echo   SILKGENESIS STARTED!
echo  ============================================
echo.
echo   Backend API : http://localhost:5000
echo   Frontend    : http://localhost:3000
echo   Admin login : admin / admin2026
echo.
echo   Press any key to close...
pause >nul
