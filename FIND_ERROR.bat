@echo off
title SilkGenesis - Error Search
color 0C
echo.
echo  ============================================
echo   RECHERCHE DE L'ERREUR DE STARTUP
echo  ============================================
echo.

cd /d %~dp0api-service

echo Etape 1: Test imports de base...
python -c "import fastapi, uvicorn, requests, json, os, threading, time; print('OK: imports de base')" 2>&1
echo.

echo Etape 2: Test argon2...
python -c "import argon2; print('OK: argon2')" 2>&1
echo.

echo Etape 3: Test bcrypt...
python -c "import bcrypt; print('OK: bcrypt')" 2>&1
echo.

echo Etape 4: Test pgpy...
python -c "import pgpy; print('OK: pgpy')" 2>&1
echo.

echo Etape 5: Test pyotp...
python -c "import pyotp; print('OK: pyotp')" 2>&1
echo.

echo Etape 6: Test config.py...
python -c "from config import get_vendor_level_info; print('OK: config')" 2>&1
echo.

echo Etape 7: Test security.py...
python -c "from security import hash_password; print('OK: security')" 2>&1
echo.

echo Etape 8: Test db_persist.py...
python -c "from db_persist import init_db; print('OK: db_persist')" 2>&1
echo.

echo Etape 9: Test monero_integration.py...
python -c "from monero_integration import MoneroWallet; print('OK: monero_integration')" 2>&1
echo.

echo Etape 10: Test pgp_utils.py...
python -c "from pgp_utils import generate_pgp_keypair; print('OK: pgp_utils')" 2>&1
echo.

echo Etape 11: Test monero_rpc.py...
python -c "from monero_rpc import get_rpc; print('OK: monero_rpc')" 2>&1
echo.

echo Etape 12: Test audit_log.py...
python -c "from audit_log import log; print('OK: audit_log')" 2>&1
echo.

echo Etape 13: Test sauvegarde (db_persist)...
python -c "from db_persist import backup_now; print('OK: db_persist backup_now')" 2>&1
echo.

echo Etape 14: Test rate_limiter.py...
python -c "from rate_limiter import check_rate_limit; print('OK: rate_limiter')" 2>&1
echo.

echo Etape 15: Test market_server import complet...
python -c "import market_server; print('OK: market_server charge')" 2>&1
echo.

echo.
echo  ============================================
echo   FIN DU DIAGNOSTIC - Cherche les ERREURS
echo   ci-dessus (lignes sans 'OK:')
echo  ============================================
echo.
pause
