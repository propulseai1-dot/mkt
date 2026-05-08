@echo off
rem ====================================================================
rem  Variables partagees : hot wallet + multisig (STAGENET tests)
rem  Mainnet : copiez ce fichier en SET_SILKGENESIS_MAINNET_ENV.bat et
rem  ajustez MONERO_NETWORK, ports, chemins.
rem ====================================================================
set "SILKGENESIS_ENV=development"

rem Reseau Monero (stagenet = test sans XMR reels)
set "MONERO_NETWORK=stagenet"

rem monerod (P2P) : par defaut stagenet ecoute en 127.0.0.1:38080
set "MONERO_DAEMON=127.0.0.1:38080"

rem monero-wallet-rpc (hot + arbitre multisig) — meme instance que START_MULTISIG
set "MONERO_RPC_URL=http://127.0.0.1:18082/json_rpc"
set "RPC_USER=silkgenesis"
set "RPC_PASS=silkgenesis_rpc_2026"
set "MONERO_RPC_USER=%RPC_USER%"
set "MONERO_RPC_PASS=%RPC_PASS%"

rem multisig.py (ports buyers/vendors pour le code Python)
set "RPC_PORT_MARKETPLACE=18082"
set "RPC_PORT_BUYER_BASE=18083"
set "RPC_PORT_VENDOR_BASE=18084"

rem Secret HMAC audit multisig (changer en prod)
if not defined MULTISIG_HMAC_SECRET set "MULTISIG_HMAC_SECRET=silkgenesis_dev_hmac_2026_change_in_prod"

rem Contenu du fichier .rpc_credentials genere pour monero_rpc (optionnel)
rem Le chargement reste prioritaire via MONERO_RPC_USER / MONERO_RPC_PASS
