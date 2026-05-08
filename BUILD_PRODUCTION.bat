@echo off
title SILKGENESIS - BUILD PRODUCTION
color 0A
echo.
echo  ========================================
echo   SILKGENESIS - BUILD PRODUCTION
echo  ========================================
echo.
echo  Ce script compile le frontend React en mode production.
echo  Le build sera dans frontend/build/
echo.

cd /d %~dp0frontend

echo  [1/3] Installation des dependances...
call npm install --silent
if errorlevel 1 (
    echo  [ERREUR] npm install a echoue!
    pause
    exit /b 1
)

echo  [2/3] Build React production...
set GENERATE_SOURCEMAP=false
set INLINE_RUNTIME_CHUNK=false
call npm run build
if errorlevel 1 (
    echo  [ERREUR] npm run build a echoue!
    pause
    exit /b 1
)

echo  [3/3] Verification du build...
if exist "build\index.html" (
    echo.
    echo  ========================================
    echo   BUILD REUSSI!
    echo  ========================================
    echo.
    echo  Fichiers generes dans: frontend/build/
    echo.
    dir build /b
    echo.
    echo  Pour deployer sur Tor:
    echo  1. Copier frontend/build/ sur le serveur
    echo  2. Configurer nginx avec gateway/nginx.prod.conf
    echo  3. Demarrer le backend: python api-service/market_server.py
    echo.
) else (
    echo  [ERREUR] Build incomplet - index.html manquant!
)

pause
