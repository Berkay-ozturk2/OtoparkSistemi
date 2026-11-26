@echo off
chcp 65001 >nul
REM ===================================================================
REM  AkilliPark - Tum servisleri ayri pencerelerde baslatir
REM    Backend  : http://localhost:5080  (Swagger: /swagger)
REM    Goruntu  : http://localhost:8000  (Dokuman: /docs)
REM    Arayuz   : http://localhost:5173
REM ===================================================================
set ROOT=%~dp0..

REM Yeni arayuz paketleri (ornegin harita icin leaflet) eksikse kur
if not exist "%ROOT%\frontend\node_modules\leaflet\package.json" (
  echo Yeni arayuz paketleri kuruluyor - npm install...
  pushd "%ROOT%\frontend"
  call npm install
  popd
)

start "AkilliPark - Backend (5080)" cmd /k "cd /d "%ROOT%\backend" && dotnet run --project src\OtoparkSistemi.Api"
start "AkilliPark - Goruntu Isleme (8000)" cmd /k "cd /d "%ROOT%\vision-service" && call .venv\Scripts\activate.bat && uvicorn app.main:app --host 0.0.0.0 --port 8000"
start "AkilliPark - Arayuz (5173)" cmd /k "cd /d "%ROOT%\frontend" && npm run dev"

echo Servisler aciliyor... 15 saniye sonra tarayici acilacak.
timeout /t 15 /nobreak >nul
start "" http://localhost:5173
