@echo off
title SilkGenesis - VRAI Backend (market_server.py)
color 0A
echo.
echo  ============================================
echo   VRAI BACKEND - market_server.py
echo   Port: 5000
echo   Login: admin / admin2026
echo  ============================================
echo.

REM Kill previous processes sur port 5000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5000 " 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo Startup du backend complet...
echo.

python c:\Users\propu\Desktop\SilkGenesis\api-service\market_server.py 2>&1

echo.
echo BACKEND ARRETE - Appuie sur une touche...
pause
