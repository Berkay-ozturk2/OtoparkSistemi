@echo off
chcp 65001 >nul
REM PostgreSQL 17'yi Docker ile baslatir (Docker Desktop gerekli).
REM Ardindan backend\src\OtoparkSistemi.Api\appsettings.json icinde Database:Provider = "PostgreSQL" yapin.
set ROOT=%~dp0..
cd /d "%ROOT%"
docker compose up -d db
echo PostgreSQL: localhost:5432  kullanici: otopark  parola: otopark123  veritabani: otopark
pause
