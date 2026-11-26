@echo off
chcp 65001 >nul
REM Bilgisayardaki kameralari bulur ve hangi numaranin calistigini gosterir.
REM Once 2_baslat.bat ile acilan pencereleri kapatin (kamera baska programda acikken bulunamaz).
set ROOT=%~dp0..
cd /d "%ROOT%\vision-service"
call .venv\Scripts\activate.bat
python tools\kamera_bul.py
pause
