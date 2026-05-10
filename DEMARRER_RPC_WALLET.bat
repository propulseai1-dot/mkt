@echo off
title SILKGENESIS - Startup RPC + Backend
color 0A

REM ============================================================
REM  SILKGENESIS - DEMARRAGE COMPLET
REM ============================================================
REM  Pre-requis (a definir dans votre environnement, jamais
REM  commiter les vraies valeurs):
REM    set RPC_USER=...
REM    set RPC_PASS=...
REM    set MONERO_RPC_USER=%RPC_USER%
REM    set MONERO_RPC_PASS=%RPC_PASS%
REM    set MONERO_DAEMON_HOST=127.0.0.1:18081
REM
REM  Recommande: charger via un fichier non-versionne :
REM    call "%~dp0local_secrets.bat"
REM ============================================================

if exist "%~dp0local_secrets.bat" call "%~dp0local_secrets.bat"

if "%RPC_USER%"=="" (
    echo [ERREUR] RPC_USER non defini. Definissez-le dans local_secrets.bat
    exit /b 1
)
if "%RPC_PASS%"=="" (
    echo [ERREUR] RPC_PASS non defini. Definissez-le dans local_secrets.bat
    exit /b 1
)

if "%MONERO_DAEMON_HOST%"=="" set "MONERO_DAEMON_HOST=127.0.0.1:18081"

set "MONERO_CLI=%~dp0monero-cli"
set "WALLET_DIR=%~dp0monero-data"
set "WALLET_NAME=silkgenesis_mainnet"

echo.
echo  ================================================
echo    SILKGENESIS - STARTUP COMPLET
echo  ================================================
echo.
echo  Wallet : %WALLET_NAME%
echo  Port   : 18082
echo  User   : %RPC_USER%
echo  Pass   : (defini hors-source)
echo.
echo  Le wallet doit etre deverrouille pour que le RPC fonctionne.
echo.

REM Tuer l'ancien processus
taskkill /IM monero-wallet-rpc.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

REM Demarrer le RPC dans une nouvelle fenetre
start "Monero RPC" cmd /k "cd /d "%WALLET_DIR%" && "%MONERO_CLI%\monero-wallet-rpc.exe" --wallet-file "%WALLET_NAME%" --prompt-for-password --rpc-bind-ip 127.0.0.1 --rpc-bind-port 18082 --rpc-login "%RPC_USER%:%RPC_PASS%" --daemon-address %MONERO_DAEMON_HOST% --trusted-daemon --log-level 1 --max-concurrency 8"

echo.
echo  RPC demarre dans une nouvelle fenetre.
echo  Entrez le password du wallet dans cette fenetre.
echo.
echo  Attente 10 secondes pour que le RPC soit pret...
timeout /t 10 /nobreak

echo.
echo  ================================================
echo    ETAPE 2: Demarrage du Backend
echo  ================================================
echo.

cd /d "%~dp0api-service"
start "SilkGenesis Backend" cmd /k "python market_server.py"

echo.
echo  Backend demarre dans une nouvelle fenetre.
echo.
echo  ================================================
echo    VERIFICATION
echo  ================================================
echo.
echo  Apres demarrage, verifier:
echo  1. RPC: http://127.0.0.1:18082/json_rpc (doit repondre)
echo  2. Backend: http://127.0.0.1:5000/api/health
echo.
pause
