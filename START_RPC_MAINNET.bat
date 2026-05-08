@echo off
title SILKGENESIS - Monero RPC Mainnet [LIVE]
color 0A

echo.
echo  ================================================
echo    MONERO WALLET RPC - MAINNET [LIVE]
echo  ================================================
echo  Wallet : silkgenesis_mainnet  Port: 18082
echo  User   : silkgenesis_rpc
echo  ================================================
echo.

set MONERO_CLI=C:\Users\propu\Desktop\SilkGenesis\monero-cli
set WALLET_DIR=C:\Users\propu\Desktop\SilkGenesis\monero-data
set WALLET_NAME=silkgenesis_mainnet
set RPC_USER=silkgenesis_rpc
set RPC_PASS=SG_RPC_2026_secure

REM Tuer l'ancien processus (evite "keys opened by another program")
echo Stopping previous processes...
taskkill /IM monero-wallet-rpc.exe /F >nul 2>&1
timeout /t 3 /nobreak >nul
echo OK - Ready to start.
echo.
echo Enter wallet password when prompted...
echo.

cd /d "%WALLET_DIR%"

"%MONERO_CLI%\monero-wallet-rpc.exe" ^
  --wallet-file "%WALLET_NAME%" ^
  --prompt-for-password ^
  --rpc-bind-ip 127.0.0.1 ^
  --rpc-bind-port 18082 ^
  --rpc-login "%RPC_USER%:%RPC_PASS%" ^
  --daemon-address 127.0.0.1:18081 ^
  --trusted-daemon ^
  --log-level 1 ^
  --max-concurrency 8

echo.
echo [!] RPC stopped. Press any key...
pause
