@echo off
title SILKGENESIS - Startup RPC + Backend
color 0A

echo.
echo  ================================================
echo    SILKGENESIS - STARTUP COMPLET
echo  ================================================
echo.
echo  ETAPE 1: Startup du Monero Wallet RPC
echo  ================================================
echo.
echo  Wallet : silkgenesis_mainnet
echo  Port   : 18082
echo  User   : silkgenesis_rpc
echo  Pass   : SG_RPC_2026_secure
echo.
echo  IMPORTANT: Entrez le password du wallet quand demande!
echo  Le wallet doit etre deverrouille pour que le RPC fonctionne.
echo.

set MONERO_CLI=C:\Users\propu\Desktop\SilkGenesis\monero-cli
set WALLET_DIR=C:\Users\propu\Desktop\SilkGenesis\monero-data
set WALLET_NAME=silkgenesis_mainnet
set RPC_USER=silkgenesis_rpc
set RPC_PASS=SG_RPC_2026_secure

REM Tuer l'ancien processus
taskkill /IM monero-wallet-rpc.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul

REM Demarrer le RPC dans une nouvelle fenetre
start "Monero RPC" cmd /k "cd /d "%WALLET_DIR%" && "%MONERO_CLI%\monero-wallet-rpc.exe" --wallet-file "%WALLET_NAME%" --prompt-for-password --rpc-bind-ip 127.0.0.1 --rpc-bind-port 18082 --rpc-login "%RPC_USER%:%RPC_PASS%" --daemon-address 127.0.0.1:18081 --trusted-daemon --log-level 1 --max-concurrency 8"

echo.
echo  RPC demarre dans une nouvelle fenetre.
echo  Entrez le password du wallet dans cette fenetre.
echo.
echo  Attente 10 secondes pour que le RPC soit pret...
timeout /t 10 /nobreak

echo.
echo  ================================================
echo    ETAPE 2: Restartup du Backend
echo  ================================================
echo.
echo  Le backend va redemarrer avec les corrections:
echo  - Admin balance = 0 (plus de 1000 XMR fake)
echo  - Wallet endpoint = vraie balance RPC
echo  - Deposit address = vraie subaddresse blockchain
echo.

cd /d "C:\Users\propu\Desktop\SilkGenesis\api-service"
start "SilkGenesis Backend" cmd /k "python market_server.py"

echo.
echo  Backend demarre dans une nouvelle fenetre.
echo.
echo  ================================================
echo    VERIFICATION
echo  ================================================
echo.
echo  Apres startup, verifier:
echo  1. RPC: http://127.0.0.1:18082/json_rpc (doit repondre)
echo  2. Backend: http://127.0.0.1:8000/api/health
echo  3. Wallet admin: http://127.0.0.1:8000/api/wallet/admin
echo     -> balance doit etre la vraie balance XMR du wallet
echo.
pause
