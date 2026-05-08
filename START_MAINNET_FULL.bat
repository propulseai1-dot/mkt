@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
title SILKGENESIS - START MAINNET FULL
cd /d "%~dp0"
color 0A

set "MONERO_CLI=%~dp0monero-cli"
set "WALLET_DIR=%~dp0monero-data"
set "DATA_DIR=%~dp0mainnet-lmdb"
set "MONEROD_EXE=%MONERO_CLI%\monerod.exe"
set "WALLET_RPC_EXE=%MONERO_CLI%\monero-wallet-rpc.exe"
set "WALLET_NAME=silkgenesis_mainnet"
set "RPC_USER=silkgenesis_rpc"
set "RPC_PASS=SG_RPC_2026_secure"
set "DAEMON_HOST=127.0.0.1"
set "DAEMON_PORT=18081"
set "WALLET_RPC_PORT=18082"
set "MONEROD_ZMQ_PORT=18083"
set "MONEROD_LOG=%MONERO_CLI%\monerod-mainnet.log"

echo.
echo ======================================================
echo   SILKGENESIS - MAINNET FULL START
echo ======================================================
echo   1^) monerod      : %DAEMON_HOST%:%DAEMON_PORT%
echo      monerod ZMQ   : 127.0.0.1:%MONEROD_ZMQ_PORT%
echo   2^) wallet-rpc   : 127.0.0.1:%WALLET_RPC_PORT%
echo ======================================================
echo.

if not exist "%MONEROD_EXE%" (
  echo [ERREUR] monerod.exe introuvable: %MONEROD_EXE%
  pause
  exit /b 1
)

if not exist "%WALLET_RPC_EXE%" (
  echo [ERREUR] monero-wallet-rpc.exe introuvable: %WALLET_RPC_EXE%
  pause
  exit /b 1
)

if not exist "%WALLET_DIR%\%WALLET_NAME%.keys" (
  echo [ERREUR] Wallet introuvable: %WALLET_DIR%\%WALLET_NAME%.keys
  echo Creez d'abord votre wallet mainnet.
  pause
  exit /b 1
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo [1/6] Arret des anciennes instances...
taskkill /IM monero-wallet-rpc.exe /F >nul 2>&1
taskkill /IM monerod.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/6] Verification des ports...
netstat -ano | findstr /R /C:":%DAEMON_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERREUR] Port %DAEMON_PORT% deja occupe.
  pause
  exit /b 1
)
netstat -ano | findstr /R /C:":%WALLET_RPC_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERREUR] Port %WALLET_RPC_PORT% deja occupe.
  pause
  exit /b 1
)
netstat -ano | findstr /R /C:":%MONEROD_ZMQ_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERREUR] Port %MONEROD_ZMQ_PORT% deja occupe.
  pause
  exit /b 1
)

echo [3/6] Lancement monerod mainnet...
start "monerod mainnet" /MIN "%MONEROD_EXE%" ^
  --rpc-bind-ip %DAEMON_HOST% ^
  --rpc-bind-port %DAEMON_PORT% ^
  --zmq-rpc-bind-ip 127.0.0.1 ^
  --zmq-rpc-bind-port %MONEROD_ZMQ_PORT% ^
  --data-dir "%DATA_DIR%" ^
  --log-file "%MONEROD_LOG%" ^
  --log-level 1

echo [4/6] Attente du daemon sur %DAEMON_HOST%:%DAEMON_PORT% ...
set "READY=0"
for /L %%I in (1,1,90) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://%DAEMON_HOST%:%DAEMON_PORT%/get_height' -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }"
  if !errorlevel! EQU 0 (
    set "READY=1"
    goto :daemon_ready
  )
  timeout /t 1 /nobreak >nul
)

:daemon_ready
if "%READY%" NEQ "1" (
  echo [ERREUR] monerod ne repond pas sur %DAEMON_HOST%:%DAEMON_PORT%.
  echo Verifiez le log: %MONEROD_LOG%
  pause
  exit /b 1
)

echo [5/6] Daemon OK.
echo [6/6] Lancement monero-wallet-rpc...
echo Entrez le mot de passe wallet quand demande.
echo.

cd /d "%WALLET_DIR%"
"%WALLET_RPC_EXE%" ^
  --wallet-file "%WALLET_NAME%" ^
  --prompt-for-password ^
  --rpc-bind-ip 127.0.0.1 ^
  --rpc-bind-port %WALLET_RPC_PORT% ^
  --rpc-login "%RPC_USER%:%RPC_PASS%" ^
  --daemon-address %DAEMON_HOST%:%DAEMON_PORT% ^
  --trusted-daemon ^
  --log-level 1 ^
  --max-concurrency 8

echo.
echo [INFO] wallet-rpc ferme.
pause
endlocal
