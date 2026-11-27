# AkıllıPark — Görüntü İşleme Destekli Akıllı Otopark Sistemi

Gazi Üniversitesi Teknoloji Fakültesi · BMT-315 Yazılım Mühendisliği · 2026-2027 Güz

Plaka tanıma ile biletsiz giriş-çıkış, tek geniş açılı kamerayla cep doluluğu, web rezervasyonu,
çevrimiçi ödeme (iyzico sandbox taklidi), terk edilmiş araç tespiti ve doluluk/gelir raporları.

## Klasör yapısı

```
OtoparkSistemi/
├── vision-service/   Görüntü işleme servisi (Python, FastAPI, YOLOv8, EasyOCR) — kamera ajanları
│   ├── app/agents/       GateAgent (giriş/çıkış), OccupancyAgent (doluluk), AgentManager
│   ├── app/pipeline/     plaka tespiti, OCR, TR plaka biçimi, araç tespiti, doluluk
│   ├── models/           plate_detector_tr.pt / .onnx (Türk plakası tespit modeli, hazır)
│   ├── config/           cameras.yaml, slots.json (cep poligonları)
│   └── tools/            simulator.py, slot_editor.py, test_image.py
├── training/         Model eğitimi (Roboflow TR veri setleri, YOLOv8 eğitim, ONNX, doğruluk ölçümü)
├── backend/          Ana API (ASP.NET Core 10, EF Core, SignalR, JWT) + xUnit testleri
├── frontend/         Web arayüzü (React 19 + Vite + Bootstrap 5.3)
├── docs/             API_SOZLESMESI.md (tek doğru kaynak), AJANLAR.md (modül/ekip dağılımı)
├── scripts/          Windows için kurulum ve başlatma .bat dosyaları
└── docker-compose.yml  PostgreSQL 17 (+ isteğe bağlı tüm sistem)
```

Modüllerin ekip üyelerine dağılımı ve use-case eşlemesi: **[docs/AJANLAR.md](docs/AJANLAR.md)**

## Hızlı başlangıç (Windows)

### 1. Gerekenler
| Araç | Sürüm | İndirme |
|---|---|---|
| Python | 3.10 – 3.12 (Anaconda olur) | https://www.python.org |
| Node.js | 22 LTS | https://nodejs.org |
| .NET SDK | 10 | https://dotnet.microsoft.com/download |
| Docker Desktop | isteğe bağlı (PostgreSQL için) | https://www.docker.com |

> .NET 10 yerine yalnızca .NET 8 kuruluysa: `backend/README.md` → ".NET 8'e düşürme" bölümüne bakın.

### 2. Kurulum (bir kez)
`scripts\1_kurulum.bat` dosyasına çift tıklayın. Python sanal ortamını kurar, paketleri indirir.
(İlk kurulum torch/ultralytics nedeniyle birkaç dakika sürebilir.)

### 3. Çalıştırma
`scripts\2_baslat.bat` → üç pencere açılır ve tarayıcıda http://localhost:5173 açılır.

| Servis | Adres |
|---|---|
| Web arayüzü | http://localhost:5173 |
| Backend + Swagger | http://localhost:5080/swagger |
| Görüntü servisi + dokümantasyon | http://localhost:8000/docs |

### 4. Giriş bilgileri
| Rol | E-posta | Parola |
|---|---|---|
| Yönetici | admin@otopark.local | Admin123! |
| Operatör | operator@otopark.local | Operator123! |
| Sürücü | surucu@otopark.local | Surucu123! |

### 5. Kamerasız demo
Ayrıntılı adımlar: **[docs/DEMO_TEST_REHBERI.md](docs/DEMO_TEST_REHBERI.md)** (demo videoları, slot çizimi, doğrulamalı senaryo).

- `scripts\6_demo_baslat.bat` → sentetik videolarla demo kameraları (gerçek YOLO + OCR, doluluk ve harita).
- `scripts\7_demo_senaryo.bat` → adım adım, doğrulamalı uçtan uca senaryo (26 kontrol).
- `scripts\3_simulator.bat` → sahte giriş/çıkış ve doluluk olayları üretir; operatör ekranı canlı akar,
  düşük güvenli okumalar Onay Kuyruğu'na düşer.
- Yönetici › Panel › **Demo verisi üret** → son 30 güne ait örnek veriler (raporlar dolu görünür).
- Operatör › **Kamera Testi** → bir araç fotoğrafı yükleyip plaka okumayı canlı deneyin.

Test kartı (sandbox): `5528 7900 0000 0008`, SKT 12/30, CVC 123.

## Kameraları bağlama

1. `vision-service/config/cameras.yaml` içinde kaynakları yazın (webcam `0`, RTSP adresi veya video dosyası)
   ve `enabled: true` yapın.
2. Doluluk kamerası için cepleri çizin: `python tools/slot_editor.py --image kare.jpg` → `config/slots.json`.
3. Ajanlar servis açılınca başlar; Operatör › Kamera Testi'nden başlatılıp durdurulabilir.

## Veritabanı

Varsayılan: **SQLite** (`backend/src/OtoparkSistemi.Api/otopark.db`, kurulum gerektirmez).
PostgreSQL 17'ye geçmek için: `scripts\postgresql_baslat.bat`, ardından `appsettings.json` içinde
`"Database": { "Provider": "PostgreSQL" }`. Şema ve başlangıç verileri ilk açılışta otomatik oluşur.

## Model eğitimi

`training/README.md`: Roboflow'daki Türk plakası veri setleri (plaka tespiti: guler-kandeger/plate-detection-vh2rk,
karakter okuma: metehan-yasar/plaka-cript) ile YOLOv8n eğitimi, Colab defteri, ONNX dışa aktarımı ve
B1 başarı ölçütü (plaka okuma doğruluğu ≥ %90) için `degerlendir.py`.
Eğitilen `char_reader.pt` dosyası `vision-service/models/` içine konursa EasyOCR yerine otomatik kullanılır.

## Testler

```
cd vision-service && .venv\Scripts\activate && pytest
cd backend && dotnet test
```

## KVKK

Ham video ağ dışına çıkmaz; doluluk görüntüsü kaydedilmez; yalnızca plaka kırpıntısı onay için saklanır ve 7 günde silinir;
tamamlanmış oturum plakaları 30 gün sonra SHA-256 ile anonimleştirilir; ödeme kartının yalnızca son 4 hanesi tutulur;
web'de aydınlatma metni ve ilgili kişi başvuru formu bulunur.

## Lisans notları

Ultralytics YOLOv8 **AGPL-3.0**; plaka tespit modeli (Semihocakli/turkish-plate-recognition) **Apache-2.0**;
referans ANPR yaklaşımı computervisioneng/automatic-number-plate-recognition-python-yolov8 (AGPL-3.0).
