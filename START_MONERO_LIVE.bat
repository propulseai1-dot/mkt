@echo off
title SILKGENESIS - Monero RPC LIVE (Mainnet)
color 0A
echo.
echo  ========================================
echo   SILKGENESIS - MONERO RPC LIVE MAINNET
echo  ========================================
echo.
echo  [!] MODE: REAL XMR - MAINNET
echo  [!] Transactions are REAL and IRREVERSIBLE
echo  [!] RPC listening on http://127.0.0.1:18082
echo.

set MONERO_CLI=%~dp0monero-cli
set WALLET_DIR=%~dp0monero-data
set WALLET_NAME=silkgenesis_mainnet

REM Check if mainnet wallet exists
if not exist "%WALLET_DIR%\%WALLET_NAME%.keys" (
    echo  ========================================
    echo   CREATION DU WALLET MAINNET
    echo  ========================================
    echo.
    echo  Aucun wallet mainnet trouve.
    echo  Un nouveau wallet va etre cree.
    echo.
    echo  IMPORTANT - Notez ces informations:
    echo    - Le password que vous allez choisir
    echo    - La seed phrase de 25 mots affichee
    echo    - L'address du wallet (commence par 4...)
    echo.
    echo  Ces informations sont IRREPLACABLES.
    echo  Sans elles, vos fonds sont perdus.
    echo.
    pause
    
    "%MONERO_CLI%\monero-wallet-cli.exe" ^
      --generate-new-wallet "%WALLET_DIR%\%WALLET_NAME%" ^
      --daemon-address 127.0.0.1:18081 ^
      --trusted-daemon ^
      --log-level 0
    
    echo.
    echo  ========================================
    echo   WALLET CREE AVEC SUCCES!
    echo  ========================================
    echo.
    echo  Avez-vous bien note votre seed phrase et password?
    pause
    echo.
    echo  Startup du RPC...
    echo.
)

echo  [*] Startup Monero Wallet RPC (Mainnet)...
echo  [*] Connexion au noeud: 127.0.0.1:18081
echo  [*] Entrez votre password wallet quand demande...
echo.

cd /d "%WALLET_DIR%"

"%MONERO_CLI%\monero-wallet-rpc.exe" ^
  --wallet-file "%WALLET_NAME%" ^
  --prompt-for-password ^
  --rpc-bind-port 18082 ^
  --rpc-bind-ip 127.0.0.1 ^
  --daemon-address 127.0.0.1:18081 ^
  --disable-rpc-login ^
  --confirm-external-bind ^
  --trusted-daemon ^
  --log-level 1

echo.
echo  [!] RPC stopped.
pause
