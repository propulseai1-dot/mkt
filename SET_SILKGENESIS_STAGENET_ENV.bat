@echo off
rem ====================================================================
rem  Variables partagees : hot wallet + multisig (STAGENET tests)
rem  Mainnet : copiez ce fichier en SET_SILKGENESIS_MAINNET_ENV.bat et
rem  ajustez MONERO_NETWORK, ports, chemins.
rem
rem  IMPORTANT : ce fichier ne contient AUCUN secret. Les credentials
rem  doivent etre definis dans %~dp0local_secrets.bat (non versionne).
rem ====================================================================
set "SILKGENESIS_ENV=development"

rem Reseau Monero (stagenet = test sans XMR reels)
set "MONERO_NETWORK=stagenet"

rem monerod (P2P) : par defaut stagenet ecoute en 127.0.0.1:38080
set "MONERO_DAEMON=127.0.0.1:38080"

rem monero-wallet-rpc (hot + arbitre multisig) — meme instance que START_MULTISIG
set "MONERO_RPC_URL=http://127.0.0.1:18082/json_rpc"

rem multisig.py (ports buyers/vendors pour le code Python)
set "RPC_PORT_MARKETPLACE=18082"
set "RPC_PORT_BUYER_BASE=18083"
set "RPC_PORT_VENDOR_BASE=18084"

rem ====================================================================
rem  Charger les secrets locaux (RPC_USER, RPC_PASS, MS_WALLET_PASS,
rem  MULTISIG_HMAC_SECRET, SILKGENESIS_PEPPER, etc.).
rem  Le fichier local_secrets.bat n'est PAS commite (voir .gitignore).
rem ====================================================================
if exist "%~dp0local_secrets.bat" call "%~dp0local_secrets.bat"

if defined RPC_USER set "MONERO_RPC_USER=%RPC_USER%"
if defined RPC_PASS set "MONERO_RPC_PASS=%RPC_PASS%"

if not defined MULTISIG_HMAC_SECRET (
    echo [WARN] MULTISIG_HMAC_SECRET non defini. Definissez-le dans local_secrets.bat avant de lancer le serveur en prod.
)
