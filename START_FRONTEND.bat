@echo off
title SilkGenesis - Frontend React
color 0B
echo.
echo  ============================================
echo   SILKGENESIS - FRONTEND REACT
echo  ============================================
echo.

:: Go to folder frontend
cd /d %~dp0frontend



:: Verification des dependencies npm
echo [2/3] Verification des dependencies npm...
if not exist node_modules (
    echo     Installation des packages npm...
    npm install
) else (
    echo     node_modules OK
)

:: Launch frontend React
echo [3/3] Startup du frontend...
echo.
echo  ============================================
echo   Frontend : http://0.0.0.0:3000
echo  ============================================
echo.
echo  IMPORTANT: Tor doit pointer vers 172.21.176.1:3000
echo.
echo  [Ctrl+C pour stoppedr]
echo.

:: --- CONFIGURATION RESEAU & SECURITE ---
:: Empeche l'ouverture auto du navigateur Windows
set BROWSER=none
:: Autorise les connections venant de WSL/Tor
set HOST=0.0.0.0
:: Supprime l'erreur "Invalid Host header" pour l'address .onion
set DANGEROUSLY_DISABLE_HOST_CHECK=true

npm start

echo.
echo  [!] Frontend stopped.
pause