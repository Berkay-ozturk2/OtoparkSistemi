@echo off
chcp 65001 >nul
setlocal
REM ===================================================================
REM  AkilliPark - Ilk kurulum (bir kez calistirin)
REM  Gerekenler: Python 3.10-3.12, Node.js 22 LTS, .NET 10 SDK
REM ===================================================================
set ROOT=%~dp0..
cd /d "%ROOT%"

echo.
echo [1/4] Araclar kontrol ediliyor...
REM Gercek Python'u bul (Windows Store'un sahte "python" kisayolunu atla)
set PY=
for %%P in ("%USERPROFILE%\anaconda3\python.exe" "%USERPROFILE%\miniconda3\python.exe" "%ProgramData%\anaconda3\python.exe" "%LOCALAPPDATA%\anaconda3\python.exe") do (
  if not defined PY if exist %%P set PY=%%~P
)
if not defined PY (
  py -3 --version >nul 2>nul && set PY=py -3
)
if not defined PY (
  python -c "import sys" >nul 2>nul && set PY=python
)
if not defined PY (echo HATA: Python bulunamadi. Anaconda veya python.org'dan Python 3.10-3.12 kurun. & goto :hata)
echo Kullanilan Python: %PY%
where node   >nul 2>nul || (echo HATA: Node.js bulunamadi. https://nodejs.org adresinden 22 LTS kurun. & goto :hata)
where dotnet >nul 2>nul || (echo HATA: .NET SDK bulunamadi. https://dotnet.microsoft.com/download adresinden .NET 10 SDK kurun. & goto :hata)
"%PY%" --version 2>nul || %PY% --version
node --version
dotnet --version

echo.
echo [2/4] Goruntu isleme servisi icin sanal ortam (vision-service\.venv) kuruluyor...
cd /d "%ROOT%\vision-service"
if not exist .venv\Scripts\python.exe (
  if "%PY%"=="py -3" ( py -3 -m venv .venv ) else ( "%PY%" -m venv .venv )
  if errorlevel 1 goto :hata
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt || goto :hata
if not exist .env if exist .env.example copy .env.example .env >nul
call deactivate

echo.
echo [3/4] Backend paketleri indiriliyor...
cd /d "%ROOT%\backend"
dotnet restore || goto :hata

echo.
echo [4/4] Arayuz paketleri indiriliyor...
cd /d "%ROOT%\frontend"
call npm install || goto :hata

echo.
echo ===============================================================
echo  Kurulum tamamlandi. Simdi scripts\2_baslat.bat calistirin.
echo ===============================================================
pause
exit /b 0

:hata
echo.
echo Kurulum yarida kaldi. Yukaridaki hata mesajina bakin.
pause
exit /b 1
