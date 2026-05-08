@echo off
setlocal ENABLEEXTENSIONS
title SILKGENESIS - STAGING LOCAL
cd /d "%~dp0"
color 0A

echo.
echo ============================================
echo  SILKGENESIS - STAGING LOCAL (Docker)
echo ============================================
echo  URL: http://127.0.0.1:8080
echo ============================================
echo.

if not exist ".env.staging" (
  if exist "env.staging.example" (
    copy /Y "env.staging.example" ".env.staging" >nul
    echo [OK] .env.staging cree depuis env.staging.example
    echo [!] Edite .env.staging ^(admin password + pepper^) avant prod.
  ) else (
    echo [ERREUR] env.staging.example introuvable.
    pause
    exit /b 1
  )
)

echo.
echo [1/2] Demarrage services (frontend-build + gateway + api + price-oracle)...
docker compose -f docker-compose.staging.yml --env-file .env.staging up -d --build
if errorlevel 1 (
  echo [ERREUR] docker compose a echoue.
  pause
  exit /b 1
)

echo.
echo [2/2] Etat...
docker compose -f docker-compose.staging.yml ps

echo.
echo [OK] Staging local pret: http://127.0.0.1:8080
echo Pour stopper: docker compose -f docker-compose.staging.yml down
pause
endlocal

