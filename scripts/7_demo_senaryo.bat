@echo off
chcp 65001 >nul
REM ===================================================================
REM  AkilliPark - Uctan uca DEMO SENARYOSU (dogrulamali)
REM  Giris -> park -> dusuk guvenli okuma (onay kuyrugu) -> odemesiz cikis reddi -> odeme -> cikis
REM  -> engelli yer ihlali -> ihlalin kapanmasi. Her adim [OK]/[HATA] olarak raporlanir.
REM  Once 2_baslat.bat ya da 6_demo_baslat.bat ile sistem acik olmali.
REM  Operator ekranini (Canli Izleme) yan pencerede acip adimlari canli izleyin.
REM ===================================================================
set ROOT=%~dp0..
cd /d "%ROOT%\vision-service"
call .venv\Scripts\activate.bat
python tools\simulator.py --scenario full-demo --step-delay 3 %*
pause
