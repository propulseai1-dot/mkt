@echo off
title SilkGenesis - Backend API
color 0A
if exist "%~dp0SET_SILKGENESIS_STAGENET_ENV.bat" (
  call "%~dp0SET_SILKGENESIS_STAGENET_ENV.bat"
)
echo.
echo  ============================================
echo   SILKGENESIS - BACKEND API (FastAPI)
echo  ============================================
if defined MONERO_NETWORK echo   Reseau Monero: %MONERO_NETWORK% ^(RPC %MONERO_RPC_URL%^)
echo  ============================================
echo.

:: Aller dans le dossier api-service
cd /d "%~dp0api-service"

:: Tuer les anciens processus sur port 5000

:: Installer les dependances
echo [2/3] Installation des dependances...
pip install fastapi uvicorn python-multipart requests pgpy argon2-cffi bcrypt pyotp qrcode pillow cryptography 2>nul

:: Lancer le backend avec uvicorn sur TOUTES les interfaces (0.0.0.0)
echo [3/3] Demarrage du backend...
echo.
echo  ============================================
echo   Backend API : http://0.0.0.0:5000
echo   Docs API    : http://0.0.0.0:5000/docs
echo  ============================================
echo.
echo  [Ctrl+C pour arreter]
echo.

:: IMPORTANT : --host 0.0.0.0 permet a WSL/Tor de se connecter
python -m uvicorn market_server:app --host 0.0.0.0 --port 5000 --reload --log-level info

echo.
echo  [!] Backend arrete.
pause
