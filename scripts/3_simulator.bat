@echo off
chcp 65001 >nul
REM Kamera ve model olmadan sistemi canli gostermek icin sahte giris/cikis ve doluluk olaylari uretir.
REM Once 2_baslat.bat ile backend calisiyor olmali.
set ROOT=%~dp0..
cd /d "%ROOT%\vision-service"
call .venv\Scripts\activate.bat
python tools\simulator.py --backend http://localhost:5080 --api-key dev-vision-key --interval 4
pause
