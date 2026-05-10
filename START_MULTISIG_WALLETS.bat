@echo off
if /i "%~1"=="nopause" set "SG_MS_NO_PAUSE=1"
title SilkGenesis - Multisig Wallets RPC
color 0A
call "%~dp0SET_SILKGENESIS_STAGENET_ENV.bat" 2>nul

echo ============================================================
echo  SILKGENESIS - WALLET-RPC market (multisig arbitre + hot)
echo  Reseau: STAGENET (config: SET_SILKGENESIS_STAGENET_ENV.bat)
echo ============================================================
echo.

set MONERO_DIR=%~dp0monero-cli
set WALLETS_DIR=%~dp0api-service\multisig_wallets
if not defined MONERO_DAEMON set "MONERO_DAEMON=127.0.0.1:38080"
set "DAEMON=%MONERO_DAEMON%"

REM Charger les secrets locaux (jamais versionnes)
if exist "%~dp0local_secrets.bat" call "%~dp0local_secrets.bat"

if not defined RPC_USER (
    echo [ERREUR] RPC_USER non defini.
    echo   Creez %~dp0local_secrets.bat avec:
    echo     set "RPC_USER=..."
    echo     set "RPC_PASS=..."
    exit /b 1
)
if not defined RPC_PASS (
    echo [ERREUR] RPC_PASS non defini ^(voir local_secrets.bat^).
    exit /b 1
)

REM Mot de passe wallet multisig (jamais vide). Genere par operateur.
if not defined MS_WALLET_PASS (
    echo [ERREUR] MS_WALLET_PASS non defini.
    echo   Definissez un passphrase fort dans local_secrets.bat:
    echo     set "MS_WALLET_PASS=..."
    exit /b 1
)

:: Creer le dossier wallets si necessaire
if not exist "%WALLETS_DIR%" mkdir "%WALLETS_DIR%"

echo [1/3] Verification de monero-wallet-rpc.exe...
if not exist "%MONERO_DIR%\monero-wallet-rpc.exe" (
    echo ERREUR: monero-wallet-rpc.exe introuvable dans %MONERO_DIR%
    pause
    exit /b 1
)
echo OK: monero-wallet-rpc.exe trouve

echo.
echo [2/3] Verification de monerod (stagenet)...
echo Assurez-vous que monerod --stagenet est en cours d'execution
echo Daemon attendu sur: %DAEMON%
echo.

:: ============================================================
:: WALLET MARKETPLACE (port 18082) - Permanent, arbitre
:: ============================================================
echo [MARKETPLACE] Startup wallet-rpc sur port 18082...

if exist "%WALLETS_DIR%\marketplace.keys" (
    echo   Wallet existant: marketplace
    start "Marketplace RPC :18082" /MIN "%MONERO_DIR%\monero-wallet-rpc.exe" ^
        --stagenet ^
        --wallet-file "%WALLETS_DIR%\marketplace" ^
        --rpc-bind-port 18082 ^
        --rpc-login %RPC_USER%:%RPC_PASS% ^
        --daemon-address %DAEMON% ^
        --trusted-daemon ^
        --log-level 1 ^
        --log-file "%WALLETS_DIR%\marketplace_rpc.log"
) else (
    echo   Creation nouveau wallet: marketplace
    start "Marketplace RPC :18082 (NEW)" /MIN "%MONERO_DIR%\monero-wallet-rpc.exe" ^
        --stagenet ^
        --generate-new-wallet "%WALLETS_DIR%\marketplace" ^
        --rpc-bind-port 18082 ^
        --rpc-login %RPC_USER%:%RPC_PASS% ^
        --daemon-address %DAEMON% ^
        --trusted-daemon ^
        --password "%MS_WALLET_PASS%" ^
        --log-level 1 ^
        --log-file "%WALLETS_DIR%\marketplace_rpc.log"
)

timeout /t 4 /nobreak >nul
echo   Marketplace RPC demarre (port 18082)

:: ============================================================
:: NOTE: Les wallets buyer et vendor sont crees dynamiquement
:: par le code Python pour chaque commande.
:: Ports 18083-18183 (buyer) et 18084-18184 (vendor)
:: ============================================================

echo.
echo [3/3] Verification des ports...
timeout /t 2 /nobreak >nul

:: Test rapide du marketplace RPC
curl -s -u %RPC_USER%:%RPC_PASS% ^
    -X POST http://127.0.0.1:18082/json_rpc ^
    -H "Content-Type: application/json" ^
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_version\"}" ^
    2>nul | findstr "version" >nul

if %errorlevel% == 0 (
    echo   [OK] Marketplace RPC repond sur port 18082
) else (
    echo   [WARN] Marketplace RPC ne repond pas encore (normal si daemon pas sync)
    echo   Verifiez: %WALLETS_DIR%\marketplace_rpc.log
)

echo.
echo ============================================================
echo  STATUT:
echo  - Marketplace RPC: http://127.0.0.1:18082/json_rpc
echo  - Buyer RPC:       cree dynamiquement (18083+)
echo  - Vendor RPC:      cree dynamiquement (18084+)
echo.
echo  Pour obtenir des XMR stagenet (test):
echo  https://community.xmr.to/faucet/stagenet/
echo.
echo  Adresse marketplace:
curl -s -u %RPC_USER%:%RPC_PASS% ^
    -X POST http://127.0.0.1:18082/json_rpc ^
    -H "Content-Type: application/json" ^
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_address\"}" ^
    2>nul
echo.
echo ============================================================
if defined SG_MS_NO_PAUSE (
  echo  (mode no-pause, les wallets continuent en arriere-plan^)
) else (
  echo  Appuyez sur une touche pour fermer. Les RPC restent en fond.
  pause
)
set SG_MS_NO_PAUSE=
echo ============================================================
