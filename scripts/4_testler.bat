@echo off
chcp 65001 >nul
REM AkilliPark - Backend (xUnit) ve goruntu servisi (pytest) testlerini calistirir
set ROOT=%~dp0..
echo.
echo ===== Backend testleri (dotnet test) =====
cd /d "%ROOT%\backend"
REM Derleme ciktisi ayri klasore yazilir: sistem aciksa calisan backend dosyalari kilitler
dotnet test --nologo --artifacts-path "%ROOT%\backend\.test-artifacts" --logger "console;verbosity=normal"
set B=%errorlevel%
if %B%==0 (echo BACKEND TESTLERI GECTI) else (echo BACKEND TESTLERINDE HATA VAR)
echo.
echo ===== Goruntu isleme testleri (pytest) =====
cd /d "%ROOT%\vision-service"
call .venv\Scripts\activate.bat
python -m pytest -q
set V=%errorlevel%
echo.
if %B%==0 if %V%==0 (echo TUM TESTLER GECTI & goto :son)
echo BAZI TESTLER BASARISIZ - yukaridaki ciktiya bakin.
:son
pause
