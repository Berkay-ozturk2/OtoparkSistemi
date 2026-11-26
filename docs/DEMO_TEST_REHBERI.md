# Demo / Simülasyon Test Rehberi

Gerçek kamera ve fiziksel otopark olmadan iki zinciri uçtan uca test etmek için:

1. **Kamera tabanlı doluluk → harita:** doluluk kamerası → `POST /api/vision/occupancy` → SignalR → krokide cep rengi
2. **Plakayla giriş-çıkış (LPR):** giriş/çıkış kamerası → plaka tespiti (YOLOv8) + OCR → `POST /api/vision/plate-events` → bariyer kararı, aktif araç, ücret

Üç yol var. Kamera ve model gerektirmeyen en hızlısı **3. bölümdeki** senaryodur; önce onunla başlayın.

| Yol | Ne test eder | Kamera / model |
|---|---|---|
| 1. Demo videoları (`6_demo_baslat.bat`) | Video → ajan → YOLO + OCR → backend → harita | Gerçek modeller, sentetik video |
| 2. Kamera Testi'ne fotoğraf yükleme | Tek fotoğrafta plaka okuma ve backend'e gönderim | Gerçek modeller |
| 3. Uçtan uca senaryo (`7_demo_senaryo.bat`) | Backend iş kuralları + harita, adım adım ✔/✘ | Gerekmez |

> Önkoşul: `scripts\1_kurulum.bat` bir kez çalıştırılmış olmalı.

---

## 1. Video ile doluluk ve plaka testi (demo kameraları)

### 1.1 Başlatma
1. Açık AkıllıPark pencereleri varsa **görüntü işleme penceresini kapatın**. Backend ve arayüz açık kalabilir.
2. `scripts\6_demo_baslat.bat` dosyasını çalıştırın. Betik sırasıyla şunları yapar:
   - **Demo içeriğini üretir** (ilk seferde, ~20 sn). İçerik `vision-service\samples\demo\` klasörüne gider:
     - `doluluk.mp4`: üstten görünüşlü GAZI otoparkı. Cepler `config/slots.json` ile **birebir** aynı. Araçlar zamanla park edip ayrılır; engelli cep A02'ye izinsiz araç park eder.
     - `giris.mp4` / `cikis.mp4`: Türk plakalı araçlar bariyere yaklaşır. Çıkış videosu girişten 2 araç sonra başlar.
     - `plaka_*.jpg`: Kamera Testi'ne yüklemek için araç fotoğrafları.
     - `plakalar.txt`: videolardaki plakalar.
   - **Görüntü servisini demo kameralarıyla başlatır.** `CAMERAS_FILE=config/cameras.demo.yaml` kullanılır; üç kamera da otomatik açılır.
   - **Açık değillerse backend ve arayüzü başlatır.**
3. Tarayıcıda http://localhost:5173 açılır.

Videolar **bitince başa sarar**, sistem sürekli canlı kamera gibi çalışır.

### 1.2 Ne görmelisiniz?
- **Operatör → Kamera Testi:**
  - `giris-demo`, `cikis-demo` ve `doluluk-demo` **Running** görünmeli. FPS sütununda kamera ve tespit hızı yazar.
  - Bir ajanı seçince canlı önizleme gelir. Giriş/çıkışta plaka kutusu ve okunan metin, dolulukta cepler (yeşil/kırmızı) çizilir.
- **Operatör → Canlı İzleme (otopark: GAZI):**
  - Araçlar girdikçe geçiş akışında `Allowed` olayları görünür ve bariyer AÇIK olur.
  - Çıkışlarda ücretsiz süre (15 dk) içindeyse onay, ödeme gerekiyorsa `Denied` gelir.
  - Krokide cepler videoyla birlikte dolar ve boşalır.
  - A02'ye izinsiz araç park edince **ihlal** uyarısı çıkar; araç ayrılınca kapanır.
- `06 ENG 061` plakalı araç engelli izinlidir; girişte engelli cebe (A01) yönlendirilir.

### 1.3 Webcam ile test
`config/cameras.demo.yaml` (ya da normal `cameras.yaml`) içinde ilgili kameranın `source` değerini `"0"` yapın.
- Aynı webcam'i kullanan giriş ve çıkıştan **yalnızca biri** çalışır; Kamera Testi'nde birini başlatmak diğerini durdurur.
- Webcam'e `samples\demo\plaka_*.jpg` fotoğraflarından birini ekranda ya da basılı olarak gösterebilirsiniz.
- Kamera numarasını bulmak için `scripts\5_kamera_bul.bat` kullanın.

### 1.4 Kendi videonuzla
1. Videoyu `vision-service\samples\` içine koyun (ör. `otopark.mp4`).
2. `cameras.demo.yaml` içinde `source: "samples/otopark.mp4"` yazın.
3. Gerçek araç görüntülerinde `detector: color` satırını **silin** (ya da `detector: yolo` yapın). Renk dedektörü yalnızca sentetik demo videosu içindir.
4. Cepleri o videoya göre çizin (bölüm 3).

### 1.5 Ayrıntılar
- **Demo yapılandırmasını seçmek:** görüntü servisi `CAMERAS_FILE` ortam değişkenini okur. Elle başlatmak için:
  ```
  cd vision-service
  .venv\Scripts\activate
  set CAMERAS_FILE=config/cameras.demo.yaml
  uvicorn app.main:app --port 8000
  ```
  Kalıcı yapmak için `vision-service\.env` içine `CAMERAS_FILE=config/cameras.demo.yaml` satırını ekleyin.
- **Demo içeriğini yeniden üretmek:** `python tools\demo_uret.py`. Seçenekler: `--seconds 120`, `--plates 34ABC123,06XYZ456`, `--only giris`.
- **Normal (webcam) moda dönmek:** görüntü işleme penceresini kapatıp `scripts\2_baslat.bat` çalıştırın.

---

## 2. Kamera Testi'ne fotoğraf yükleyerek plaka testi

1. Arayüzde **üst menüden otoparkı seçin.** Kamera Testi olayları artık seçili otoparka gönderir.
2. **Operatör → Kamera Testi** sayfasındaki **Plaka Tanıma Testi** kartını açın.
3. `vision-service\samples\demo\plaka_01_34DMO101.jpg` gibi bir fotoğraf seçin (ya da gerçek bir araç fotoğrafı).
4. Kapı listesinden **Giriş kapısı**'nı seçin. "Backend'e olay olarak gönder" kutusunu açarsanız gerçek bir giriş oluşur.
5. **Tanı** düğmesine basın. Okunan plaka, güven değerleri, kutu çizilmiş görüntü ve backend kararı (Allowed / PendingReview…) görünür.
6. Aynı fotoğrafla **Çıkış kapısı**'nı seçerek çıkışı deneyin.

Doğrulanan sonuç: sentetik plaka fotoğrafı gerçek modellerle (YOLOv8 + EasyOCR, CPU) ~0,5 sn'de, OCR güveni 1.0 ile okundu. Plaka tespit güveni 0,87–0,90.

---

## 3. `slot_editor.py` ile yeni bir video karesine park yeri çizme

Doluluk kamerası cepleri `vision-service\config\slots.json` dosyasındaki poligonlardan okur.

Cep **kodları**, backend'deki otopark krokisiyle **aynı olmalıdır**. Örneğin GAZI'de A01–A10, B01–B10, C01–C08 (`DbSeeder.cs`). Bilinmeyen kodlar backend'de yok sayılır.

1. Sanal ortamı açın:
   ```
   cd vision-service
   .venv\Scripts\activate
   ```
2. Editörü açın (biri):
   ```
   python tools\slot_editor.py --video samples\otopark.mp4 --frame 50
   python tools\slot_editor.py --image samples\otopark.jpg
   python tools\slot_editor.py --camera 0
   python tools\slot_editor.py --image samples\otopark.jpg --load config\slots.json   (mevcut çizimi düzenle)
   ```
3. Pencerede:

   | Tuş / fare | İşlev |
   |---|---|
   | sol tık | cebin köşe noktası |
   | sağ tık / Enter | cebi kapat (≥3 nokta). Kod otomatik verilir: A01, A02… |
   | `r` | sıra harfini değiştir (A → B → C), numara 01'den başlar |
   | `c` | sıradaki kodu konsoldan elle yaz (ör. `B07`) |
   | `u` | son noktayı / son cebi geri al |
   | `s` | kaydet (`config\slots.json`, başka dosya için `--out`) |
   | `q` / Esc | çık |
4. Kaydettikten sonra görüntü servisini yeniden başlatın. Kamera Testi'nde doluluk ajanının önizlemesinde cep çerçeveleri görünür.
5. Farklı bir otopark için ayrı bir dosya kaydedin (`--out config\slots_hastane.json`). Kamerada `slotsFile: config/slots_hastane.json` ve `lotCode: HASTANE` yazın.

İpuçları:
- Cepleri aracın **zemine değen** kısmına göre çizin.
- Eğik açılı kamerada `footprint: 0.5` ile yalnızca araç kutusunun alt yarısı sayılır.
- Demo videosunun cepleri `slots.json`'dan üretildiği için demo modunda çizim gerekmez. `slots.json`'ı değiştirirseniz demo videosunu `python tools\demo_uret.py` ile yeniden üretin.

---

## 4. Uçtan uca demo senaryosu (simülatör)

Kamera ve model gerektirmez. Görüntü servisinin yapacağı istekleri gönderir ve her adımın sonucunu backend'den **kontrol eder**.

1. Sistem açıkken (`2_baslat.bat` ya da `6_demo_baslat.bat`) `scripts\7_demo_senaryo.bat` çalıştırın.
2. Yan pencerede **Operatör → Canlı İzleme** (otopark GAZI) açık olsun; adımlar canlı görünür. Senaryo adım aralarında 3 sn bekler.

| Adım | Ne olur | Kontrol |
|---|---|---|
| 0 | Backend, operatör/yönetici girişi; **ücretsiz süre geçici olarak 0 dk** yapılır | ayarlar sonunda geri alınır |
| 1 | Plakayla giriş | `Allowed`, bariyer AÇIK, aktif araçlarda, önerilen cep |
| 2 | Doluluk: araç önerilen cebe park eder | cep haritada DOLU |
| 3 | İkinci araç girer | `Allowed` |
| 4 | Düşük güvenli/hatalı okuma | `PendingReview` → onay kuyruğunda → operatör düzeltir → `Allowed` |
| 5 | Ödeme yapmadan çıkış | `Denied`, ücret > 0, bariyer KAPALI |
| 6 | Kartla ödeme (sanal POS test kartı) + çıkış | ödeme `Success`, çıkış `Allowed`, cep tekrar BOŞ |
| 7 | Gişede nakit ödeme + çıkış | nakit `Success`, çıkış `Allowed` |
| 8 | Engelli izinli araç (`06 ENG 061`) | ♿ giriş, engelli cep önerilir, ihlal YOK |
| 9–10 | İzinsiz araç engelli cebe park eder, sonra ayrılır | ihlal açılır → kendiliğinden kapanır |

Sonunda senaryo araçları çıkarılır ve `SONUÇ: TÜM KONTROLLER BAŞARILI (26/26)` yazar. Başarısız adım olursa `[HATA]` satırı nedenini gösterir ve çıkış kodu 1 olur.

Seçenekler (`python tools\simulator.py --scenario full-demo ...`):
- `--lot HASTANE`: başka bir otoparkta çalıştır. Demo videosu GAZI'yi değiştirirken senaryonun cep kontrolleri karışmasın diye önerilir.
- `--step-delay 0`: beklemeden, test gibi hızlı çalıştır.

Sürekli rastgele trafik için eski mod: `scripts\3_simulator.bat`.

---

## 5. Testler

`scripts\4_testler.bat`:
- **Backend (`dotnet test`):** 77 test. Derleme çıktısı `backend\.test-artifacts` klasörüne yazılır, böylece sistem açıkken de çalışır.
- **Görüntü servisi (`pytest`):** demo modu testleri (`tests/test_demo_mode.py`) dahil.

Demo modu testlerinin doğruladıkları:
- `cameras.demo.yaml` 3 ajanı doğru kurar (doluluk ajanı `color` dedektörüyle).
- Demo dedektörü sentetik karede doğru cepleri dolu bulur; engelli cep işareti araç sayılmaz.
- Demo videoları yazılabiliyor ve videolar hatasız başa sarıyor.
