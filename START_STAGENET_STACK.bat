@echo off
title SilkGenesis - Pile complete STAGENET
cd /d "%~dp0"
color 0A
call SET_SILKGENESIS_STAGENET_ENV.bat

echo ============================================================
echo  SILKGENESIS - demarrage pile STAGENET
echo  1) monerod  2) wallet-rpc marketplace  3) API FastAPI
echo ============================================================
echo.

if exist "monero-cli\monerod.exe" (
  if not exist "stagenet-lmdb" mkdir "stagenet-lmdb"
  echo [1/3] monerod (stagenet)...
  start "monerod stagenet" /MIN "monero-cli\monerod.exe" --stagenet --data-dir "%~dp0stagenet-lmdb" --log-level 1
  echo   Attente 6s (daemon)...
  timeout /t 6 /nobreak >nul
) else (
  echo [AVIS] monerod.exe absent — lancez monerod a la main ou installez monero-cli
  echo Puis relancez ce script ou seulement START_MULTISIG_WALLETS + START_BACKEND
  echo.
  timeout /t 3
)

echo [2/3] monero-wallet-rpc marketplace (port 18082, stagenet^)...
call "%~dp0START_MULTISIG_WALLETS.bat" nopause
timeout /t 3 /nobreak >nul

echo [3/3] Backend API (port 5000)...
cd /d "%~dp0api-service"
if exist "requirements.txt" (
  python -m pip install -q -r requirements.txt 2>nul
) else (
  python -m pip install -q fastapi uvicorn python-multipart requests pgpy argon2-cffi bcrypt pyotp qrcode pillow cryptography 2>nul
)
echo.
echo  Backend: http://0.0.0.0:5000  Docs: /docs
echo  Multisig + hot wallet RPC: %MONERO_RPC_URL%
echo  Faucet stagenet: https://community.xmr.to/faucet/stagenet/
echo  [Ctrl+C pour arreter l'API]
echo.
python -m uvicorn market_server:app --host 0.0.0.0 --port 5000 --log-level info
pause
