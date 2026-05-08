@echo off
title SilkGenesis - DIAGNOSTIC
color 0E
echo.
echo  ============================================
echo   SILKGENESIS - DIAGNOSTIC COMPLET
echo  ============================================
echo.

cd /d %~dp0api-service

echo [1/4] Installation de TOUTES les dependencies...
pip install fastapi uvicorn python-multipart requests pgpy argon2-cffi bcrypt pyotp qrcode pillow > ..\diagnostic_log.txt 2>&1
echo     Done.

echo [2/4] Test d'import Python...
python -c "import fastapi; import uvicorn; import argon2; import bcrypt; import pgpy; print('OK - Toutes les libs importees')" >> ..\diagnostic_log.txt 2>&1

echo [3/4] Test de startup du serveur (10 secondes)...
echo --- TEST STARTUP SERVEUR --- >> ..\diagnostic_log.txt
python -m uvicorn market_server:app --host 0.0.0.0 --port 5000 --timeout-keep-alive 5 >> ..\diagnostic_log.txt 2>&1 &
timeout /t 8 /nobreak >nul
taskkill /F /IM python.exe >nul 2>&1

echo [4/4] Lecture du log...
echo.
echo  ============================================
echo   RESULTAT DU DIAGNOSTIC :
echo  ============================================
echo.
type ..\diagnostic_log.txt
echo.
echo  ============================================
echo   Log sauvegarde dans : diagnostic_log.txt
echo  ============================================
echo.
pause
