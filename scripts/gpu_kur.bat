@echo off
chcp 65001 >nul
REM ===================================================================
REM  AkilliPark - NVIDIA ekran karti (GPU) destegini kurar
REM  Plaka tespiti ve OCR GPU'da 5-20 kat hizli calisir.
REM  Once tum AkilliPark pencerelerini kapatin.
REM ===================================================================
set ROOT=%~dp0..
cd /d "%ROOT%\vision-service"

where nvidia-smi >nul 2>nul || (
  echo NVIDIA ekran karti veya surucusu bulunamadi. Bu bilgisayarda GPU hizlandirmasi kullanilamaz.
  echo Surucu icin: https://www.nvidia.com/Download/index.aspx
  pause
  exit /b 1
)
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv

if not exist .venv\Scripts\activate.bat (
  echo Once scripts\1_kurulum.bat calistirin.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat

echo.
echo CUDA destekli torch kuruluyor (yaklasik 2.5 GB, birkac dakika surer)...
pip uninstall -y torch torchvision
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126 || goto :hata

echo.
python -c "import torch; ok=torch.cuda.is_available(); print('GPU kullanilabilir:', ok); print('Kart:', torch.cuda.get_device_name(0) if ok else '-')"
python -c "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 1)" || goto :hata

echo.
echo ===============================================================
echo  GPU destegi kuruldu. 2_baslat.bat ile sistemi yeniden acin.
echo ===============================================================
pause
exit /b 0

:hata
echo.
echo GPU kurulumu tamamlanamadi. Yukaridaki mesaja bakin.
echo Islemci (CPU) surumune geri donmek icin: pip install --force-reinstall torch torchvision
pause
exit /b 1
