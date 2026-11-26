# Görüntü İşleme Servisi (vision-service)

Görüntü İşleme Destekli Akıllı Otopark Sistemi'nin (BMT-315, Gazi Üniversitesi) görüntü işleme servisidir.

- **Plaka tanıma:** YOLOv8n ile Türk plakası tespiti, ardından OCR (YOLO karakter okuyucu ya da EasyOCR) ve TR plaka biçimine göre düzeltme
- **Doluluk analizi:** YOLOv8n (COCO) ile araç tespiti ve `config/slots.json` içindeki cep poligonlarıyla kesişim
- **Kamera ajanları:** giriş/çıkış ve doluluk kameralarını arka planda işleyip sonucu ana backend'e (ASP.NET Core) gönderir
- **Simülatör:** kamera ve makine öğrenmesi olmadan sunumda sistemi canlı göstermek için

Bütün modüllerin uyduğu sözleşme: [`docs/API_SOZLESMESI.md`](../docs/API_SOZLESMESI.md) (bölüm 3, 9 ve 10).

```
                         ┌───────────────── vision-service (FastAPI :8000) ─────────────────┐
 Webcam / RTSP / video → │ GateAgent ──► plaka tespiti ► kırpma ► OCR ► TR biçim düzeltme ► oylama │──► POST /api/vision/plate-events
                         │ OccupancyAgent ──► araç tespiti ► cep poligonu kesişimi ► yumuşatma    │──► POST /api/vision/occupancy
                         │ AgentManager ──► 10 sn'de bir                                          │──► POST /api/vision/heartbeat
 Web arayüzü (React) ──► │ /recognize, /occupancy/analyze, /agents, /health                      │       backend :5080
                         └────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Kurulum (Windows + Anaconda)

Desteklenen Python sürümleri: **3.10–3.12** (öneri 3.11).

```bat
cd OtoparkSistemi\vision-service
conda create -n otopark python=3.11 -y
conda activate otopark
pip install -r requirements.txt
copy .env.example .env
```

> `ultralytics` kurulurken torch'un **CPU** sürümü de kurulur. NVIDIA ekran kartınız varsa önce aşağıdaki GPU bölümüne bakın.

### GPU (CUDA) kullanmak isterseniz

`requirements.txt`'den **önce** CUDA'lı torch'u kurun (sürücünüze uygun CUDA sürümünü https://pytorch.org adresinden seçin):

```bat
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

Sonra `.env` içinde `DEVICE=0` ve `OCR_GPU=true` yapın. Kontrol: `python -c "import torch; print(torch.cuda.is_available())"`.

### Modeller

| Dosya | Görev | Kaynak |
|---|---|---|
| `models/plate_detector_tr.pt` (+ `.onnx`) | Türk plakası tespiti (tek sınıf) | [Semihocakli/turkish-plate-recognition](https://github.com/Semihocakli/turkish-plate-recognition) — hazır |
| `models/yolov8n.pt` | Araç tespiti (COCO: car, motorcycle, bus, truck) | İlk çalıştırmada ultralytics **otomatik indirir** (internet gerekir) |
| `models/char_reader.pt` + `models/char_classes.txt` | (isteğe bağlı) YOLO karakter okuyucu | `training/egit_karakter_okuyucu.py` ile eğitilir |

EasyOCR ilk kullanımda kendi modellerini (~100 MB) `%USERPROFILE%\.EasyOCR` altına indirir; ilk açılış bu yüzden uzun sürebilir.

### ONNX notu

ultralytics/torch kurulamazsa ya da CPU'da daha hızlı çalışmak isterseniz servis aynı modelin `.onnx` sürümünü
`onnxruntime` ile çalıştırabilir (`.env` → `PREFER_ONNX=true`). `.pt` dosyası yoksa ONNX zaten otomatik denenir.
Kendi modellerinizi dönüştürmek için: `python ..\training\onnx_aktar.py --model models\yolov8n.pt`.
Not: EasyOCR torch gerektirir; tamamen torch'suz kurulumda OCR için `char_reader.onnx` kullanılmalıdır.

---

## 2. Çalıştırma

```bat
conda activate otopark
cd OtoparkSistemi\vision-service
uvicorn app.main:app --port 8000
```

- Etkileşimli API belgesi: http://localhost:8000/docs
- Modeller arka planda yüklenir; servis hemen açılır. Durum: http://localhost:8000/health
- Model yüklenemezse servis yine çalışır; `/health` hangi modelin eksik olduğunu gösterir ve `/recognize` **503** + Türkçe açıklama döner.

`/health` örnek yanıtı:
```json
{ "status": "ok",
  "models": { "plateDetector": true, "vehicleDetector": true, "ocr": "easyocr" },
  "details": { "loading": false, "plateDetectorBackend": "ultralytics", "errors": {} },
  "agents": 3 }
```

### Uç noktalar (sözleşme bölüm 9)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/health` | model durumu |
| GET | `/agents` | `[{id, type, gate, source, enabled, status, fps, lastPlate, lastError}]` |
| POST | `/agents/{id}/start`, `/agents/{id}/stop` | ajanı başlat/durdur |
| GET | `/agents/{id}/snapshot` | son işlenmiş kare (JPEG, yalnızca bellekte) |
| POST | `/recognize?gate=Entry&forward=false[&cameraId=web-test]` | multipart `file` → plaka sonuçları + çizimli görüntü |
| POST | `/occupancy/analyze?forward=false[&cameraId=web-test]` | multipart `file` → cep durumları + çizimli görüntü |
| GET | `/config/slots` | cep poligonları |

`annotatedImageBase64` ve `imageBase64` alanları **öneksiz** base64 JPEG'dir; tarayıcıda
`data:image/jpeg;base64,` + değer şeklinde gösterilir. Hatalar `{ "message": "..." }` biçimindedir.

Windows'ta deneme (PowerShell'de `curl.exe` yazın):
```bat
curl.exe -F "file=@samples\arac.jpg" "http://localhost:8000/recognize?gate=Entry&forward=false"
```

`/recognize` yanıtı:
```json
{ "plates": [ { "plate": "34ABC123", "rawText": "34ABC123", "confidence": 0.82, "formatValid": true,
                "bbox": [224, 361, 421, 390], "detectionConfidence": 0.90, "ocrConfidence": 0.91 } ],
  "backendResponse": null, "elapsedMs": 180.4, "annotatedImageBase64": "/9j/4AAQ...", "ocr": "easyocr", "message": null }
```
`confidence = tespit güveni × OCR güveni`. `forward=true` ise en iyi sonuç backend'e gönderilir ve backend yanıtı
`backendResponse` alanında döner.

### Komut satırından tek resim denemesi

```bat
python tools\test_image.py samples\arac.jpg --out sonuc.jpg --show
python tools\test_image.py samples\ --mode plate                 :: klasördeki tüm resimler
python tools\test_image.py samples\otopark.jpg --mode occupancy
```

---

## 3. Plaka okuma hattı

1. **Tespit:** `plate_detector_tr.pt` (eşik `CONFIDENCE=0.40`)
2. **Kırpma:** plaka kutusu %6 payla kırpılır (KVKK: yalnızca plaka bölgesi saklanır/gönderilir)
3. **OCR** (`OCR_ENGINE=auto`):
   1. `models/char_reader.pt` varsa **YOLO karakter okuyucu** — her karakter bir nesne; karakterler satırlara
      gruplanır (iki satırlı kare plakalar için), x'e göre sıralanır. Sınıf sırası `models/char_classes.txt`'den okunur.
   2. Yoksa **EasyOCR** (`['en']`, yalnızca `A-Z0-9`)
   3. Hiçbiri yoksa `none` (yalnızca konum bulunur)
4. **Ön işleme varyantları:** gri, yeniden boyutlandırma (96 px yükseklik), CLAHE, adaptif eşik, Otsu. Her varyant
   okunur; **en yüksek skorlu geçerli** sonuç seçilir (yeterince iyi sonuçta erken durulur).
5. **TR biçim düzeltme** (`app/pipeline/tr_plate.py`): il kodu 01–81 + 1–3 harf + 2–5 rakam
   (1 harf+4/5 rakam, 2 harf+3/4 rakam, 3 harf+2/3 rakam); Q, W, X ve Türkçe karakterler yok.
   "TR" ön eki, boşluk ve noktalama silinir; rakam bölgesinde O→0, I→1, Z→2, S→5, B→8, G→6, harf bölgesinde
   tersi uygulanır; olası tüm harf/rakam bölmeleri denenip en az düzeltmeyle geçerli olan seçilir.

## 4. Kamera ajanları (`config/cameras.yaml`)

| Ajan | Ne yapar |
|---|---|
| **GateAgent** (Entry/Exit) | Saniyede ~5 kare plaka okur. Aynı aracın kareleri **oylanır**: 1,5 sn pencerede en az 3 okuma, en sık geçerli metin, ortalama güven. Aynı plaka (ya da 1 karakter farklı okuması) **30 sn** tekrar gönderilmez. Sonuç `POST /api/vision/plate-events`. |
| **OccupancyAgent** | Saniyede 1 kare. Cep alanının ≥%35'i araç kutusuyla kaplıysa dolu; son 5 karede çoğunlukla titreme önlenir. Yalnızca **değişen** cepler + her **60 sn**'de tüm cepler `POST /api/vision/occupancy`. |
| **AgentManager** | Ajanları yaml'dan oluşturur, `enabled: true` olanları açılışta başlatır, 10 sn'de bir `POST /api/vision/heartbeat`. |

Kaynak (`source`): `"0"` webcam, `"rtsp://kullanici:parola@ip:554/stream"` IP kamera, `"samples/otopark.mp4"` video
(bitince başa sarar). Bağlantı koparsa ajan `Error` durumuna geçer ve artan aralıklarla yeniden bağlanır.
`/agents` çıktısında RTSP parolaları gizlenir.

Örnek yaml ajanlarının hepsi `enabled: false` gelir; arayüzden ya da şöyle başlatılır:
```bat
curl.exe -X POST http://localhost:8000/agents/giris-1/start
```
Canlı görüntü: http://localhost:8000/agents/giris-1/snapshot (yenileyerek)

## 5. Cep poligonlarını çizme (`tools/slot_editor.py`)

Örnek `config/slots.json` 1280×720 görüntü için 28 cep içerir (A01–A10, B01–B10, C01–C08; 3 sıra) ve
backend'deki cep kodlarıyla aynıdır. Gerçek kameranız için yeniden çizin:

```bat
python tools\slot_editor.py --video samples\otopark.mp4 --frame 30
python tools\slot_editor.py --image samples\otopark.jpg --load config\slots.json   :: var olanı düzenle
```
Sol tık: nokta · Sağ tık/Enter: cebi kapat (kod sırayla A01, A02 …) · `c`: kodu elle yaz · `r`: sonraki sıra harfi ·
`u`: geri al · `s`: kaydet · `q`: çık. Poligonlar farklı çözünürlükteki karelere otomatik ölçeklenir.

Eğik açılı kamerada araç kutusu komşu cebe taşar; `.env` → `OCCUPANCY_FOOTPRINT=0.5` (kutunun yalnızca alt yarısı) deneyin.

## 6. Simülatör — kamera/ML olmadan canlı demo

Sunumda backend + arayüz açıkken:
```bat
python tools\simulator.py
python tools\simulator.py --interval 2 --low-confidence-rate 0.2 --seed 42
```
| Argüman | Açıklama |
|---|---|
| `--backend` | backend adresi (vars. `http://localhost:5080`) |
| `--api-key` | `X-Api-Key` (vars. `dev-vision-key`) |
| `--interval` | olaylar arası ortalama süre, sn (vars. 4) |
| `--low-confidence-rate` | düşük güvenli/bozuk okuma oranı → operatör onay kuyruğu (vars. 0.1) |
| `--pay-rate` | çıkıştan önce test kartıyla ödeme olasılığı (vars. 0.7) — ödenmeyenler `Denied` alır |
| `--count`, `--seed`, `--no-occupancy`, `--initial-occupancy`, `--exit-rate` | diğer ayarlar |

Simülatör yalnızca Python standart kütüphanesini kullanır; giriş/çıkışlarla tutarlı doluluk değişiklikleri ve sahte
ajan heartbeat'leri de gönderir. Seed sürücünün aracı `06ABC123` ara sıra giriş yapar.

Backend hazır değilse sahte backend ile deneyin: `python -m tests.mock_backend --port 5080`.

## 7. Testler

```bat
python -m pytest            :: ya da: python -m unittest discover tests
```
Testler TR plaka biçimi/düzeltme, poligon doluluk hesabı ve yumuşatma, oylama/tekrar önleme, karakter birleştirme
(iki satırlı plaka), YOLO çıktı çözümleme, backend istemcisi (sahte HTTP sunucusu), ajan mantığı ve video döngüsünü
kapsar. Model gerektirmezler; `ultralytics`/`onnxruntime` varsa plaka modeli için bir duman testi de çalışır
(`samples/test_plate.jpg` koyarsanız gerçek tespit de denenir).

## 8. Backend'e gönderilen JSON örnekleri (sözleşme bölüm 3)

```json
POST /api/vision/plate-events      (X-Api-Key: dev-vision-key)
{ "cameraId": "giris-1", "gate": "Entry", "plate": "34ABC123", "confidence": 0.8712,
  "formatValid": true, "timestamp": "2026-11-25T08:30:00Z", "imageBase64": "/9j/4AAQ..." }

POST /api/vision/occupancy
{ "cameraId": "doluluk-1", "timestamp": "2026-11-25T08:30:00Z",
  "slots": [ { "code": "A01", "occupied": true, "confidence": 0.93 } ] }

POST /api/vision/heartbeat
{ "agents": [ { "id": "giris-1", "type": "Gate", "status": "Running", "fps": 4.8, "lastError": null } ] }
```
Okunan metin TR biçimine uymuyorsa `plate` normalize edilmiş ham metindir ve `formatValid=false` gönderilir
(backend `PendingReview` yapar). Backend kapalıysa istekler yeniden denenir, hata loglanır; servis çökmez.

## 9. Ayarlar (`.env`)

Tümü `.env.example` içinde açıklamalıdır. En önemlileri: `BACKEND_URL`, `VISION_API_KEY`, `CONFIDENCE`,
`OCR_ENGINE`, `DEVICE`, `PREFER_ONNX`, `VOTE_*`, `PLATE_COOLDOWN_SECONDS`, `OCCUPANCY_*`, `CORS_ORIGINS`.
Ortam değişkenleri `.env` değerlerini ezer.

## 10. KVKK notları

- Kamera kareleri **diske yazılmaz**; `/agents/{id}/snapshot` yalnızca bellekteki son kareyi sunar (`Cache-Control: no-store`).
- Backend'e yalnızca **plaka kırpıntısı** gönderilir (tam kare/yüz/araç içi gönderilmez). `SEND_PLATE_CROP=false` ile tamamen kapatılabilir.
- Doluluk kamerası hiçbir görüntü göndermez; yalnızca cep kodu + dolu/boş bilgisi.
- RTSP kullanıcı adı/parolası API çıktısında ve loglarda gizlenir.
- Saklama süresi (`dataRetentionDays`) ve ilgili kişi talepleri backend tarafındadır.
- Demo görüntülerini (`samples/`) git'e eklemeyin (`.gitignore` hazır).

## 11. Lisanslar

- **ultralytics (YOLOv8): AGPL-3.0.** Kaynak kodu açık bir akademik projede kullanmak uygundur; kapalı ticari
  ürünlerde Ultralytics'ten kurumsal lisans gerekir.
- **Plaka tespit modeli** (Semihocakli/turkish-plate-recognition): **Apache-2.0**. Not: model ultralytics ile
  eğitildiği için ağırlık dosyasının üst verisinde AGPL-3.0 ibaresi bulunur.
- EasyOCR: Apache-2.0 · FastAPI: MIT · OpenCV: Apache-2.0.
- Referans alınan fikirler: computervisioneng ANPR (araç + plaka + EasyOCR + karakter eşleme), Semihocakli
  (YOLO karakter okuyucu, x'e göre sıralama). Kod bu projeye özgü yeniden yazılmıştır.

## 12. Sorun giderme

| Belirti | Çözüm |
|---|---|
| `/recognize` 503 "Modeller hâlâ yükleniyor" | Birkaç saniye bekleyin (EasyOCR ilk açılışta model indirir). |
| `vehicleDetector: false` | İnternet yoksa `yolov8n.pt` indirilemez; dosyayı elle `models/` altına koyun. |
| Webcam açılmıyor | Başka uygulama kamerayı kullanıyor olabilir; `source: "1"` deneyin. |
| `ocr: "none"` | `pip install easyocr` ya da `models/char_reader.pt` ekleyin. |
| torch DLL hatası (Windows) | Microsoft Visual C++ Redistributable kurun ya da `PREFER_ONNX=true` kullanın. |
| Sürekli `PendingReview` | Kamera açısı/ışık; `CONFIDENCE` ve backend `confidenceThreshold` ayarlarına bakın; karakter okuyucu eğitin. |

## Çoklu otopark (v2)

Her kamera tek bir otoparka bağlıdır: `config/cameras.yaml` içinde `lotCode: GAZI | MERKEZ | AVM | HASTANE`.
Görüntü servisi bu kodu plaka ve doluluk olaylarına `lotCode` olarak ekler. `/recognize` ve `/occupancy/analyze`
uç noktaları `?lot=AVM` gibi bir otopark parametresi alır (varsayılan `GAZI`).

Simülatör artık backend'deki tüm otoparkları ve engelli cepleri kullanır; ara sıra izinsiz bir aracı engelli cebe
park ettirerek ihlal senaryosu üretir:
```
python tools/simulator.py --lots GAZI,AVM --violation-rate 0.2
```
