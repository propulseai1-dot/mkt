@echo off
title SilkGenesis - Connection Test
color 0E
echo.
echo  ============================================
echo   TEST DE CONNEXION BACKEND
echo  ============================================
echo.

echo Test 1: Backend sur port 5000...
curl -s http://localhost:5000/api/health 2>&1
echo.

echo Test 2: Backend sur port 8000...
curl -s http://localhost:8000/api/health 2>&1
echo.

echo Test 3: Processus Python actifs...
tasklist /FI "IMAGENAME eq python.exe" 2>&1
echo.

echo Test 4: Ports en ecoute...
netstat -ano | findstr ":5000 "
netstat -ano | findstr ":8000 "
echo.

echo  ============================================
echo   Si aucun port n'est en ecoute = backend mort
echo   Relance START_BACKEND.bat
echo  ============================================
echo.
pause
