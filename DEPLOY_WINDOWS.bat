@echo off
title SILKGENESIS - DEPLOIEMENT WINDOWS COMPLET
color 0A
setlocal enabledelayedexpansion

echo.
echo  ============================================================
echo   SILKGENESIS - DEPLOIEMENT WINDOWS (Tor + Nginx + React)
echo  ============================================================
echo.

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"
set "API=%ROOT%api-service"
set "GATEWAY=%ROOT%gateway"
set "NGINX_DIR=C:\nginx"
set "TOR_DIR=C:\Tor"
set "NGINX_EXE=%NGINX_DIR%\nginx.exe"
set "TOR_EXE=%TOR_DIR%\tor.exe"

REM ============================================================
REM ETAPE 1: Verifier les prerequis
REM ============================================================
echo  [1/7] Verification des prerequis...

where node >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] Node.js non trouve. Installez depuis https://nodejs.org
    pause & exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] npm non trouve.
    pause & exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] Python non trouve. Installez depuis https://python.org
    pause & exit /b 1
)

echo  [OK] Node.js, npm, Python detectes.

REM ============================================================
REM ETAPE 2: Telecharger Nginx si absent
REM ============================================================
echo.
echo  [2/7] Verification Nginx...

if not exist "%NGINX_EXE%" (
    echo  [INFO] Nginx non trouve dans %NGINX_DIR%
    echo  [INFO] Telechargement de Nginx 1.26...
    
    if not exist "%NGINX_DIR%" mkdir "%NGINX_DIR%"
    
    REM Telecharger Nginx via PowerShell
    powershell -Command "& {$url='https://nginx.org/download/nginx-1.26.3.zip'; $out='%TEMP%\nginx.zip'; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing; Expand-Archive -Path $out -DestinationPath '%TEMP%\nginx_extract' -Force; Copy-Item '%TEMP%\nginx_extract\nginx-1.26.3\*' '%NGINX_DIR%\' -Recurse -Force}" 2>&1
    
    if not exist "%NGINX_EXE%" (
        echo  [ERREUR] Echec telechargement Nginx.
        echo  [MANUEL] Telechargez nginx-1.26.x depuis https://nginx.org/en/download.html
        echo  [MANUEL] Extrayez dans C:\nginx\
        pause & exit /b 1
    )
    echo  [OK] Nginx installe dans %NGINX_DIR%
) else (
    echo  [OK] Nginx trouve: %NGINX_EXE%
)

REM ============================================================
REM ETAPE 3: Telecharger Tor si absent
REM ============================================================
echo.
echo  [3/7] Verification Tor...

if not exist "%TOR_EXE%" (
    echo  [INFO] Tor non trouve dans %TOR_DIR%
    echo  [INFO] Telechargement de Tor Expert Bundle...
    
    if not exist "%TOR_DIR%" mkdir "%TOR_DIR%"
    
    REM Telecharger Tor Expert Bundle via PowerShell
    powershell -Command "& {$url='https://archive.torproject.org/tor-package-archive/torbrowser/13.5.9/tor-expert-bundle-windows-x86_64-13.5.9.tar.gz'; $out='%TEMP%\tor.tar.gz'; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing}" 2>&1
    
    REM Extraire avec tar (disponible Windows 10+)
    tar -xzf "%TEMP%\tor.tar.gz" -C "%TOR_DIR%" --strip-components=1 2>&1
    
    if not exist "%TOR_EXE%" (
        echo  [ERREUR] Echec telechargement Tor.
        echo  [MANUEL] Telechargez Tor Expert Bundle depuis https://www.torproject.org/download/tor/
        echo  [MANUEL] Extrayez tor.exe dans C:\Tor\
        pause & exit /b 1
    )
    echo  [OK] Tor installe dans %TOR_DIR%
) else (
    echo  [OK] Tor trouve: %TOR_EXE%
)

REM ============================================================
REM ETAPE 4: Build React Frontend
REM ============================================================
echo.
echo  [4/7] Build React Frontend...

cd /d "%FRONTEND%"

if not exist "node_modules" (
    echo  [INFO] Installation des dependencies npm...
    call npm install --silent
    if errorlevel 1 (
        echo  [ERREUR] npm install echoue.
        pause & exit /b 1
    )
)

echo  [INFO] Build de production React...
call npm run build 2>&1
if errorlevel 1 (
    echo  [ERREUR] npm run build echoue.
    pause & exit /b 1
)

echo  [OK] Build React termine dans %FRONTEND%\build\

REM ============================================================
REM ETAPE 5: Configurer Nginx
REM ============================================================
echo.
echo  [5/7] Configuration Nginx...

REM Copier le build React dans le dossier html de Nginx
if not exist "%NGINX_DIR%\html\silkgenesis" mkdir "%NGINX_DIR%\html\silkgenesis"
xcopy /E /Y /Q "%FRONTEND%\build\*" "%NGINX_DIR%\html\silkgenesis\" >nul

REM Creer la configuration Nginx pour SilkGenesis
(
echo worker_processes 1;
echo events { worker_connections 1024; }
echo http {
echo     include mime.types;
echo     default_type application/octet-stream;
echo     sendfile on;
echo     keepalive_timeout 65;
echo     gzip on;
echo     gzip_types text/plain text/css application/json application/javascript;
echo.
echo     server {
echo         listen 127.0.0.1:8080;
echo         server_name localhost;
echo.
echo         # Frontend React
echo         root html/silkgenesis;
echo         index index.html;
echo.
echo         # SPA routing
echo         location / {
echo             try_files $uri $uri/ /index.html;
echo         }
echo.
echo         # API proxy vers FastAPI
echo         location /api/ {
echo             proxy_pass http://127.0.0.1:5000;
echo             proxy_set_header Host $host;
echo             proxy_set_header X-Real-IP $remote_addr;
echo             proxy_read_timeout 60s;
echo         }
echo.
echo         # Security headers
echo         add_header X-Frame-Options DENY;
echo         add_header X-Content-Type-Options nosniff;
echo         add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;";
echo     }
echo }
) > "%NGINX_DIR%\conf\nginx.conf"

echo  [OK] Nginx configure sur 127.0.0.1:8080

REM ============================================================
REM ETAPE 6: Configurer Tor Hidden Service
REM ============================================================
echo.
echo  [6/7] Configuration Tor Hidden Service...

set "TOR_DATA=%ROOT%tor-data"
if not exist "%TOR_DATA%" mkdir "%TOR_DATA%"
if not exist "%TOR_DATA%\hidden_service" mkdir "%TOR_DATA%\hidden_service"

REM Creer torrc
(
echo SocksPort 9050
echo ControlPort 9051
echo DataDirectory %TOR_DATA%
echo HiddenServiceDir %TOR_DATA%\hidden_service
echo HiddenServicePort 80 127.0.0.1:8080
echo HiddenServiceVersion 3
echo Log notice stdout
) > "%TOR_DATA%\torrc"

echo  [OK] Tor configure avec Hidden Service v3

REM ============================================================
REM ETAPE 7: Demarrer tous les services
REM ============================================================
echo.
echo  [7/7] Startup des services...

REM Install dependencies Python
echo  [INFO] Installation dependencies Python...
python -m pip install -r "%API%\requirements.txt" -q 2>&1

REM Demarrer Nginx en arriere-plan
echo  [INFO] Startup Nginx...
start /B "" "%NGINX_EXE%" -p "%NGINX_DIR%" -c "%NGINX_DIR%\conf\nginx.conf"
timeout /t 2 /nobreak >nul

REM Demarrer Tor en arriere-plan
echo  [INFO] Startup Tor...
start "Tor Hidden Service" /MIN "%TOR_EXE%" -f "%TOR_DATA%\torrc"

REM Demarrer le backend Python
echo  [INFO] Startup Backend Python (FastAPI)...
start "SilkGenesis API" /MIN python "%API%\market_server.py"

REM Attendre que Tor genere l'address .onion
echo.
echo  [*] Attente generation address .onion (30 secondes)...
timeout /t 30 /nobreak >nul

REM Lire l'address .onion
set "ONION_FILE=%TOR_DATA%\hidden_service\hostname"
if exist "%ONION_FILE%" (
    set /p ONION_ADDR=<"%ONION_FILE%"
) else (
    set "ONION_ADDR=EN_COURS_DE_GENERATION..."
)

echo.
echo  ============================================================
echo   DEPLOIEMENT TERMINE !
echo  ============================================================
echo.
echo   Adresse .onion  : !ONION_ADDR!
echo   Frontend local  : http://127.0.0.1:8080
echo   Backend API     : http://127.0.0.1:5000
echo   Tor SOCKS proxy : 127.0.0.1:9050
echo.
echo   Pour acceder via Tor Browser:
echo   http://!ONION_ADDR!
echo.
echo   Pour stoppedr tous les services:
echo   Fermez les fenetres Tor et SilkGenesis API
echo   Executez: %NGINX_DIR%\nginx.exe -s stop
echo.
echo  ============================================================

if "!ONION_ADDR!"=="EN_COURS_DE_GENERATION..." (
    echo  [INFO] L'address .onion n'est pas encore prete.
    echo  [INFO] Verifiez dans 1-2 minutes: %ONION_FILE%
)

pause
