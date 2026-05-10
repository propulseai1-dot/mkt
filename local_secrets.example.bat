@echo off
rem ============================================================
rem  SILKGENESIS - LOCAL SECRETS (template)
rem  Copier ce fichier en local_secrets.bat et remplir.
rem  NE JAMAIS commiter local_secrets.bat (deja dans .gitignore).
rem ============================================================

rem --- Monero wallet-rpc credentials -------------------------
rem Generer avec: openssl rand -hex 24
set "RPC_USER=__REPLACE_ME_LONG_USER__"
set "RPC_PASS=__REPLACE_ME_LONG_RANDOM__"

rem --- Mot de passe des wallets multisig (Monero) ------------
rem Generer avec: openssl rand -hex 32
set "MS_WALLET_PASS=__REPLACE_ME_STRONG_WALLET_PASS__"

rem --- HMAC du journal d'audit multisig ----------------------
rem Generer avec: openssl rand -hex 32
set "MULTISIG_HMAC_SECRET=__REPLACE_ME_HMAC__"

rem --- Pepper applique aux hash mots de passe ----------------
rem Generer avec: openssl rand -hex 32
set "SILKGENESIS_PEPPER=__REPLACE_ME_PEPPER__"

rem --- Daemon Monero (optionnel, defaut stagenet 38080) ------
rem set "MONERO_DAEMON=127.0.0.1:38080"
