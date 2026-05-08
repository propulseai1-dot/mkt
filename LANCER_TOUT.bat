@echo off
title SilkGenesis - Full Launch
color 0A
echo.
echo  ============================================
echo   SILKGENESIS - FULL LAUNCH
echo  ============================================
echo.

echo [0/2] (optionnel) Pour Monero stagenet : START_STAGENET_STACK.bat
echo.
echo [1/2] Starting BACKEND sur port 5000...
start "SilkGenesis BACKEND" cmd /k "cd /d %~dp0 && if exist SET_SILKGENESIS_STAGENET_ENV.bat call SET_SILKGENESIS_STAGENET_ENV.bat && cd api-service && python run_server.py"

echo Waiting 8 seconds for backend startup...
timeout /t 8 /nobreak >nul

echo [2/2] Starting FRONTEND sur port 3000...
start "SilkGenesis FRONTEND" cmd /k "cd /d %~dp0frontend && npm start"

echo.
echo  ============================================
echo   Backend  : http://127.0.0.1:5000
echo   Frontend : http://localhost:3000
echo   Login    : admin / admin2026
echo  ============================================
echo.
echo If the backend shows a RED ERROR,
echo copy it and report it for troubleshooting.
echo.
pause
