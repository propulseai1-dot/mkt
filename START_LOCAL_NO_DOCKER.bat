@echo off
setlocal ENABLEEXTENSIONS
title SILKGENESIS - LOCAL NO DOCKER
cd /d "%~dp0"
color 0A

echo.
echo ============================================
echo  SILKGENESIS - LOCAL NO DOCKER
echo ============================================
echo  Frontend: http://127.0.0.1:3000
echo  API:      http://127.0.0.1:5000
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Python introuvable dans PATH.
  echo Installe Python 3.11+ puis relance.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js introuvable dans PATH.
  echo Installe Node 20 LTS puis relance.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] npm introuvable dans PATH.
  echo Reinstalle Node.js LTS ^(npm inclus^) puis relance.
  pause
  exit /b 1
)

set "NODE_VERSION_RAW="
for /f %%v in ('node -v 2^>nul') do set "NODE_VERSION_RAW=%%v"
if "%NODE_VERSION_RAW%"=="" (
  echo [ERREUR] Impossible de lire la version Node.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%m in ("%NODE_VERSION_RAW%") do set "NODE_MAJOR=%%m"
set "NODE_MAJOR=%NODE_MAJOR:v=%"

if not "%NODE_MAJOR%"=="18" (
  if not "%NODE_MAJOR%"=="20" (
    echo [AVERTISSEMENT] Node %NODE_VERSION_RAW% detecte.
    echo React-scripts est plus stable en Node 18/20.
    echo Je continue, mais si ca echoue installe Node 20 LTS.
    echo.
  )
)

if not exist "%~dp0frontend\package.json" (
  echo [ERREUR] frontend\package.json introuvable.
  pause
  exit /b 1
)

if not exist "%~dp0api-service\market_server.py" (
  echo [ERREUR] api-service\market_server.py introuvable.
  pause
  exit /b 1
)

echo [1/3] Installation des deps frontend...
pushd "%~dp0frontend"
call npm install
if errorlevel 1 (
  echo [ERREUR] npm install a echoue.
  popd
  pause
  exit /b 1
)
popd

echo [2/3] Installation des deps backend...
pushd "%~dp0api-service"
python -m pip install fastapi uvicorn python-multipart requests pgpy argon2-cffi bcrypt pyotp qrcode pillow cryptography >nul
if errorlevel 1 (
  echo [ERREUR] pip install backend a echoue.
  popd
  pause
  exit /b 1
)
popd

echo [3/3] Lancement backend + frontend...
start "SilkGenesis Backend API" cmd /k "cd /d ""%~dp0api-service"" && python -m uvicorn market_server:app --host 0.0.0.0 --port 5000 --reload --log-level info"
start "SilkGenesis Frontend" cmd /k "cd /d ""%~dp0frontend"" && set BROWSER=none && set HOST=0.0.0.0 && set DANGEROUSLY_DISABLE_HOST_CHECK=true && npm start"

echo.
echo [OK] Services lances dans 2 fenetres.
echo Frontend: http://127.0.0.1:3000
echo API:      http://127.0.0.1:5000
echo.
echo Pour stopper: ferme les 2 fenetres ouvrees.
pause
endlocal

