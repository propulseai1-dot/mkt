@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION
title SILKGENESIS - monerod MAINNET
cd /d "%~dp0"
color 0A

set "MONERO_EXE=%~dp0monero-cli\monerod.exe"
set "DATA_DIR=%~dp0mainnet-lmdb"
set "LOG_FILE=%~dp0monero-cli\monerod-mainnet.log"
set "RPC_IP=127.0.0.1"
set "RPC_PORT=18081"
set "P2P_PORT=18080"
set "ZMQ_PORT=18083"

echo.
echo ================================================
echo   SILKGENESIS - MONEROD MAINNET
echo ================================================
echo   RPC : %RPC_IP%:%RPC_PORT%
echo   P2P : %RPC_IP%:%P2P_PORT%
echo   ZMQ : %RPC_IP%:%ZMQ_PORT%
echo ================================================
echo.

if not exist "%MONERO_EXE%" (
  echo [ERREUR] monerod.exe introuvable:
  echo          %MONERO_EXE%
  echo.
  echo Placez les binaires Monero dans le dossier monero-cli.
  pause
  exit /b 1
)

if not exist "%DATA_DIR%" (
  mkdir "%DATA_DIR%"
)

echo [1/4] Verification du port wallet-rpc ^(18082^)...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":18082 .*LISTENING"') do (
  echo [ALERTE] Le port 18082 est deja utilise par PID %%P.
  echo          Le wallet-rpc utilise aussi 18082, evitez les conflits.
  echo.
)

echo [2/4] Nettoyage des anciens processus monerod...
taskkill /IM monerod.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo [3/4] Verification que %RPC_PORT% est libre...
netstat -ano | findstr /R /C:":%RPC_PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERREUR] Le port %RPC_PORT% est deja occupe.
  echo Fermez le processus qui utilise %RPC_PORT%, puis relancez ce script.
  pause
  exit /b 1
)

echo [4/4] Lancement de monerod mainnet...
echo Log file: %LOG_FILE%
echo.

"%MONERO_EXE%" ^
  --rpc-bind-ip %RPC_IP% ^
  --rpc-bind-port %RPC_PORT% ^
  --p2p-bind-ip %RPC_IP% ^
  --p2p-bind-port %P2P_PORT% ^
  --zmq-rpc-bind-ip %RPC_IP% ^
  --zmq-rpc-bind-port %ZMQ_PORT% ^
  --data-dir "%DATA_DIR%" ^
  --log-file "%LOG_FILE%" ^
  --log-level 1

echo.
echo [INFO] monerod a ete ferme.
pause
endlocal
