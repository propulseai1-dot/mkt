@echo off
title monerod - STAGENET
cd /d "%~dp0"
call SET_SILKGENESIS_STAGENET_ENV.bat
if not exist "monero-cli\monerod.exe" (
  echo [ERREUR] monerod.exe introuvable dans %~dp0monero-cli
  echo Telechargez les binaires Monero et placez monerod.exe ici.
  pause
  exit /b 1
)
if not exist "stagenet-lmdb" mkdir "stagenet-lmdb"
echo Lancement monerod --stagenet (donnees: stagenet-lmdb^)
echo Le port P2P par defaut est 38080 — aligne avec MONERO_DAEMON dans SET_SILKGENESIS_STAGENET_ENV.bat
echo.
start "monerod stagenet" /MIN "monero-cli\monerod.exe" --stagenet --data-dir "%~dp0stagenet-lmdb" --log-level 1
echo [OK] Fenetre monerod lancee (minimisee). Laissez tourner la sync.
timeout /t 2 /nobreak
