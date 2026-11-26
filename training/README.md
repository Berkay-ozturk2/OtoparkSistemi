# Model Eğitimi (training/)

Akıllı Otopark Sistemi'nin görüntü işleme modellerini eğitmek, değerlendirmek ve `vision-service/models/` klasörüne
koymak için scriptler. Eğitim **Google Colab / Kaggle** (ücretsiz GPU) ya da NVIDIA ekran kartlı yerel bilgisayarda yapılabilir.

> Sistemin çalışması için eğitim **zorunlu değildir**: hazır plaka tespit modeli (`plate_detector_tr.pt`) depoda,
> araç modeli (`yolov8n.pt`) otomatik iniyor, OCR için EasyOCR kullanılıyor. Eğitim; plaka **okuma** doğruluğunu
> artırmak (karakter okuyucu) ve kendi kamera açınıza uyarlamak (ince ayar) içindir.

| Model | Script | Çıktı (`vision-service/models/`) | Veri seti |
|---|---|---|---|
| Plaka tespiti (1 sınıf) | `egit_plaka_tespit.py` | `plate_detector_tr.pt` | Roboflow `guler-kandeger/plate-detection-vh2rk` v2 |
| Karakter okuyucu (36 sınıf, 320 px) | `egit_karakter_okuyucu.py` | `char_reader.pt` + `char_classes.txt` | Roboflow `metehan-yasar/plaka-cript` v1 |
| (isteğe bağlı) Araç/doluluk | `egit_doluluk.py` | `vehicle_tr.pt` | PKLot / CNRPark+EXT / kendi çekimleriniz |

## 0. Kurulum

```bat
conda activate otopark            :: vision-service ile aynı ortam
pip install "ultralytics>=8.3" roboflow pyyaml onnx onnxruntime
cd OtoparkSistemi\training
```
GPU için önce CUDA'lı torch kurun (bkz. `vision-service/README.md` → GPU). Kontrol: `python -c "import torch; print(torch.cuda.is_available())"`.

## 1. Veri setlerini indirme

**A) Roboflow API anahtarıyla** (app.roboflow.com → Settings → Roboflow API → Private API Key; ücretsiz hesap yeterli):
```bat
set ROBOFLOW_API_KEY=anahtariniz
python indir_veri.py                         :: iki veri seti de (datasets.yaml)
python indir_veri.py --set karakter_okuma    :: yalnızca biri
```
PowerShell'de: `$env:ROBOFLOW_API_KEY="anahtariniz"`. Anahtarı koda/depoya yazmayın.

**B) Elle:** veri seti sayfasında *Download Dataset → YOLOv8 → Download zip to computer*, sonra:
```bat
python indir_veri.py --zip plate-detection.v2i.yolov8.zip --hedef data\plaka_tespit
python indir_veri.py --zip plaka-cript.v1i.yolov8.zip --hedef data\karakter
```
Her iki yolda da `data.yaml` yolları otomatik düzeltilir ve küme boyutları yazdırılır.

### %70 / %20 / %10 bölme (`bolme.py`)
Test kümesi yoksa ya da **kendi pilot çekimlerinizi** eklediyseniz:
```bat
python bolme.py --kaynak data\plaka_tespit --hedef data\plaka_tespit_bolunmus
python bolme.py --kaynak pilot_cekim --hedef data\pilot --siniflar plaka          :: images/ + labels/ ya da yan yana .jpg/.txt
```
Bölme tekrarlanabilirdir (`--seed 42`). Etiketsiz resimler boş etiketle (negatif örnek) eklenir.
Kendi çekimlerinizi etiketlemek için Roboflow (web) ya da `labelImg`/CVAT kullanabilirsiniz (YOLO biçimi).

## 2. Plaka tespit modeli

```bat
python egit_plaka_tespit.py --data data\plaka_tespit\data.yaml --epochs 100 --patience 30 --imgsz 640 --batch 16 --device 0
:: Hazır modeli kendi pilot çekimlerinizle ince ayar:
python egit_plaka_tespit.py --data data\pilot\data.yaml --model ..\vision-service\models\plate_detector_tr.pt --epochs 30 --kopyala
```
- CPU'da: `--device cpu --batch 8` (çok yavaştır; Colab önerilir). Windows'ta "DataLoader" hatası alırsanız `--workers 0`.
- Yarım kalan eğitim: `--resume`.
- `--kopyala` en iyi modeli `vision-service/models/` altına **`plate_detector_tr_yeni.pt`** olarak koyar (hazır model
  korunur). Kullanmak için `.env` → `PLATE_MODEL=plate_detector_tr_yeni.pt`, ya da `--uzerine-yaz`.

## 3. Karakter okuyucu (OCR) modeli

```bat
python egit_karakter_okuyucu.py --data data\karakter\data.yaml --epochs 100 --imgsz 320 --batch 32 --device 0 --kopyala
```
- Script, veri setinin sınıf sırasını `data.yaml`'dan okuyup **`char_classes.txt`** üretir; görüntü servisi
  karakter indekslerini bu dosyaya göre harfe çevirir (Roboflow sınıf sırası 0-9A-Z olmayabilir!).
- Karakterler aynalanınca anlam değiştiği için `fliplr=0` ile eğitilir.
- `--kopyala` → `vision-service/models/char_reader.pt` + `char_classes.txt`. Servisi yeniden başlatınca
  `/health` → `"ocr": "yolo-char"` görünür (OCR_ENGINE=auto iken karakter okuyucu EasyOCR'a tercih edilir).

## 4. Değerlendirme (`degerlendir.py`) — B1: gündüz ≥ %90

**Uçtan uca** (tespit + OCR + TR düzeltme; servisle birebir aynı kod):
```bat
python degerlendir.py --csv etiketler.csv --resimler test_resimleri --cikti sonuc.csv
```
`etiketler.csv` (başlık isteğe bağlı, `;` da olur):
```
dosya,plaka,kosul
arac001.jpg,34ABC123,gunduz
arac002.jpg,06 AB 1234,gece
```
Çıktı: plaka doğruluğu (**tüm karakterler doğru**), karakter doğruluğu, tespit oranı, geçerli biçim oranı,
ortalama/medyan/p95 süre (ms), koşul bazında kırılım ve **B1 GEÇTİ/KALDI**. `--hizli` canlı kameradaki gibi az
ön işleme varyantıyla ölçer; `--ocr easyocr|yolo-char` motoru zorlar.

**Karakter veri setinin test kümesinde** (gerçek metin etiket kutularından üretilir):
```bat
python degerlendir.py --karakter-test data\karakter --model ..\vision-service\models\char_reader.pt
```
**Plaka tespit mAP:** `python degerlendir.py --tespit-test data\plaka_tespit\data.yaml`

Rapor için öneri: pilot alanda gündüz ve gece en az 100'er araç görüntüsü toplayıp CSV ile ölçün; sonuç CSV'sini
rapora ekleyin. (KVKK: test görüntülerini depoya eklemeyin, yalnızca ölçüm sonuçlarını paylaşın.)

## 5. ONNX dışa aktarım (`onnx_aktar.py`)

```bat
python onnx_aktar.py --model ..\vision-service\models\char_reader.pt --imgsz 320
python onnx_aktar.py --model yolov8n.pt --hedef ..\vision-service\models
```
`.onnx` dosyası `.pt` ile aynı ada sahip olur; servis `.env` → `PREFER_ONNX=true` ile (ya da torch kurulu değilse
otomatik) onnxruntime kullanır. Çıktı onnxruntime ile doğrulanıp CPU süresi yazdırılır.

## 6. Google Colab

1. `colab_egitim.ipynb` dosyasını Colab'da açın (Dosya → Not defteri yükle).
2. Çalışma zamanı türü: **T4 GPU**.
3. Projeyi Drive'a yükleyin (ya da `training` klasörünü zip'leyip yükleyin) ve hücreleri sırayla çalıştırın.
4. Son hücre `char_reader.pt` ve `char_classes.txt` dosyalarını indirir → `vision-service/models/` altına koyun.

Kaggle'da: *Settings → Accelerator → GPU T4*, `training` klasörünü *Add Data* ile yükleyip aynı komutları çalıştırın
(`/kaggle/working` yazılabilir klasördür).

## 7. (İsteğe bağlı) Doluluk / araç modeli

Varsayılan doluluk yöntemi eğitim gerektirmez (COCO yolov8n + cep poligonları). Kamera çok tepeden bakıyorsa ve
araçlar kaçırılıyorsa `egit_doluluk.py` dosyasındaki açıklamalara bakın (PKLot / CNRPark+EXT, tek sınıflı "car"
modeli, `.env` → `VEHICLE_MODEL=vehicle_tr.pt`, `VEHICLE_CLASSES=0`).

## Lisans notları

- Ultralytics YOLOv8: **AGPL-3.0** (eğitilen ağırlıklar da bu lisansın kapsamında değerlendirilir).
- Semihocakli/turkish-plate-recognition: **Apache-2.0**. Roboflow Universe veri setlerinin lisansı her veri setinin
  sayfasında yazar (genellikle CC BY 4.0) — raporda atıf yapın.
