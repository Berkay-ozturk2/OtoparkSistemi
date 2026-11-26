@echo off
chcp 65001 >nul
REM ===================================================================
REM  AkilliPark - DEMO MODU (gercek kamera / otopark olmadan)
REM    * samples\demo\ yoksa sentetik videolari ve plaka fotograflarini uretir
REM    * Goruntu servisini config\cameras.demo.yaml ile baslatir:
REM        giris-demo  -> samples\demo\giris.mp4   (plakali araclar)
REM        cikis-demo  -> samples\demo\cikis.mp4
REM        doluluk-demo-> samples\demo\doluluk.mp4 (GAZI otoparki, renk dedektoru)
REM    * Backend ve arayuzu normal sekilde baslatir
REM  Normal (webcam) moda donmek icin 2_baslat.bat kullanin.
REM ===================================================================
set ROOT=%~dp0..

cd /d "%ROOT%\vision-service"
if not exist .venv\Scripts\activate.bat (
  echo Once scripts\1_kurulum.bat calistirin.
  pause
  exit /b 1
)
if not exist samples\demo\doluluk.mp4 (
  echo Demo videolari uretiliyor (ilk sefer, ~10-20 sn)...
  call .venv\Scripts\activate.bat
  python tools\demo_uret.py || (echo Demo icerigi uretilemedi. & pause & exit /b 1)
  call deactivate
)

start "AkilliPark - Backend (5080)" cmd /k "cd /d "%ROOT%\backend" && dotnet run --project src\OtoparkSistemi.Api"
start "AkilliPark - Goruntu Isleme DEMO (8000)" cmd /k "cd /d "%ROOT%\vision-service" && call .venv\Scripts\activate.bat && set CAMERAS_FILE=config/cameras.demo.yaml&& uvicorn app.main:app --host 0.0.0.0 --port 8000"
start "AkilliPark - Arayuz (5173)" cmd /k "cd /d "%ROOT%\frontend" && npm run dev"

echo Demo modu aciliyor... 15 saniye sonra tarayici acilacak.
echo Ardindan uctan uca senaryo icin: scripts\7_demo_senaryo.bat
timeout /t 15 /nobreak >nul
start "" http://localhost:5173
