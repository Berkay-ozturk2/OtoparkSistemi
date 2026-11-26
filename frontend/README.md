# AkıllıPark — Web Arayüzü

Görüntü İşleme Destekli Akıllı Otopark Sistemi (Gazi Üniversitesi BMT-315) için React tabanlı web arayüzü.
Tüm uç noktalar `docs/API_SOZLESMESI.md` sözleşmesine (bölüm 11: çoklu otopark ve engelli park yerleri dâhil) göre yazılmıştır.

**Teknolojiler:** React 19 · Vite 6 · Bootstrap 5.3 + Bootstrap Icons · react-router-dom 7 · @microsoft/signalr 8 · Chart.js 4 + react-chartjs-2 5 (JavaScript/JSX, Node 22)

## Kurulum ve çalıştırma

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

- `npm run build` → `dist/` klasörüne üretim derlemesi; `npm run preview` → derlemeyi http://localhost:4173 adresinde sunar (proxy dahil).
- Önce backend'i (http://localhost:5080) ve isteğe bağlı olarak görüntü işleme servisini (http://localhost:8000) başlatın.
  Windows'ta `scripts\2_baslat.bat` üçünü birlikte açar.

### Proxy / ortam değişkenleri

Geliştirmede tarayıcı yalnızca Vite'a (5173) konuşur; `vite.config.js` istekleri yönlendirir:

| Önek | Hedef | Not |
|---|---|---|
| `/api` | http://localhost:5080 | REST |
| `/hubs` | http://localhost:5080 | SignalR (WebSocket, `ws: true`) |
| `/vision` | http://localhost:8000 | önek silinir (`/vision/health` → `/health`) |

`.env.example` dosyasını `.env` olarak kopyalayarak değiştirebilirsiniz:
`VITE_API_URL` (boş = proxy), `VITE_VISION_URL` (varsayılan `/vision`), `PROXY_API_TARGET`, `PROXY_VISION_TARGET`.

## Giriş bilgileri (seed)

| Rol | E-posta | Parola | Giriş sonrası |
|---|---|---|---|
| Yönetici | admin@otopark.local | Admin123! | `/yonetim` |
| Otopark Görevlisi | operator@otopark.local | Operator123! | `/operator` |
| Sürücü | surucu@otopark.local | Surucu123! | `/surucu` (araç: 06 ABC 123) |

Giriş sayfasındaki demo hesap kartlarına tıklayınca form otomatik dolar.

**Test kartları (Mock / iyzico sandbox):** `5528 7900 0000 0008` ve `4766 6200 0000 0001` başarılı,
`4111 1111 1111 1129` "Yetersiz bakiye" ile başarısız. Son kullanma 12/2030, CVC 123.

## Sayfa → use-case eşlemesi

| Yol | Sayfa | Rol | Use-case |
|---|---|---|---|
| `/` | Ana Sayfa: otopark kartları (doluluk, boş yer, ♿ boş engelli yeri, "Krokiyi gör"), seçili otoparkın canlı özeti, kroki, önerilen bölge, tarifeler | herkes | UC-05 |
| `/aracim-nerede` | Aracım Nerede? (otopark adı + o otoparkın krokisinde bölge) | herkes | UC-06 |
| `/ucret-ode` | Ücret Öde (plaka → kart → sonuç) | herkes | UC-03 |
| `/giris`, `/kayit` | Giriş / Sürücü kaydı (KVKK onayı + ayrı açık rıza) | herkes | — |
| `/kvkk` | KVKK aydınlatma metni + ilgili kişi başvuru formu | herkes | KVKK |
| `/surucu` | Sürücü paneli: araçlarım (♿ izin durumu rozeti), engelli izni başvurusu + başvurularım, aktif oturumlar, geçmiş | Driver | UC-03, UC-06, UC-15 |
| `/surucu/rezervasyon` | Rezervasyon: otopark, bölge, "Engelli park yeri" (yalnız onaylı izinli plaka), zaman, fiyat teklifi, ön ödeme, iptal | Driver | UC-04 |
| `/operator` | Canlı İzleme: otopark seçici, kroki (katlar, zoom), bariyerler, geçiş olayı akışı (♿ rozeti), ihlal paneli (toast + ses + krokide vurgu), cep düzeltme, hızlı izin kontrolü | Operator, Admin | UC-01, UC-02, UC-08, UC-16 |
| `/operator/ihlaller` | Engelli yeri ihlalleri: otopark/durum filtresi, Çözüldü / Yanlış alarm, CSV | Operator, Admin | UC-16 |
| `/operator/onay-kuyrugu` | Onay Kuyruğu: düşük güvenli okumalar (otopark filtresi) | Operator, Admin | UC-07 |
| `/operator/aktif-araclar` | Aktif Araçlar: otopark filtresi, arama, nakit ödeme, manuel çıkış | Operator, Admin | UC-03, UC-02 |
| `/operator/manuel-gecis` | Manuel giriş / çıkış (otopark seçimi) + gişede engelli izni kontrolü | Operator, Admin | UC-01, UC-02, UC-15 |
| `/operator/kamera-testi` | Görüntü servisi: sağlık, ajanlar, canlı kare, test yüklemesi | Operator, Admin | — |
| `/yonetim` | Yönetim paneli (otopark filtresi, "Tüm otoparklar") + "Demo verisi üret" | Admin | — |
| `/yonetim/otoparklar` | Otoparklar: ad/adres/aktiflik düzenleme; krokide cebe tıkla → Standart/Engelli, kullanım dışı | Admin | UC-14 |
| `/yonetim/engelli-izinleri` | Engelli izinleri: durum filtresi, Onayla/Reddet/İptal, geçerlilik tarihi, "Yeni izin ekle" | Admin | UC-15 |
| `/yonetim/tarifeler` | Tarife dilimleri CRUD + sistem ayarları | Admin | UC-12 |
| `/yonetim/kullanicilar` | Kullanıcı CRUD, rol, aktif/pasif | Admin | UC-13 |
| `/yonetim/terk-edilmis` | Terk edilmiş araçlar (otopark filtresi) | Admin | UC-09 |
| `/yonetim/raporlar/doluluk` | Doluluk raporu (otopark filtresi, grafik, tablo, CSV) | Admin | UC-10 |
| `/yonetim/raporlar/gelir` | Gelir raporu (otopark filtresi, seri, yönteme göre dağılım, CSV) | Admin | UC-11 |
| `/yonetim/denetim-kayitlari` | Denetim kayıtları | Admin | — |
| `/yonetim/kvkk-talepleri` | KVKK başvurularını işleme | Admin | KVKK |

UC-14/15/16 numaraları bölüm 11 için önerilen yeni use-case'lerdir (isterler belgesine eklenmelidir):
**UC-14** Otopark ve kroki yönetimi · **UC-15** Engelli park izni başvurusu/onayı · **UC-16** Engelli yeri ihlali takibi.

## Çoklu otopark ve engelli park yerleri (sözleşme bölüm 11)

- **Seçili otopark:** `src/lot/LotContext.jsx` — liste `/api/parking/lots` (30 sn'de bir tazelenir), seçili kod
  `localStorage["akillipark_lot"]` (varsayılan `GAZI`). Üst menüdeki **otopark seçici** (ad + boş yer + ♿ rozeti) tüm ilgili
  çağrılara `lot` parametresini taşır (summary, zones, slots/layout, recommendation, operatör listeleri, raporlar).
  Filtre ekranlarında aynı bileşen "Tüm otoparklar" seçeneğiyle kontrollü kullanılır (`<LotSelector value onChange allowAll />`).
- **Kroki (`ParkingMap`):** `/api/parking/lots/{code}/layout` ile çizilir; `viewBox = mapWidth × mapHeight`. Önce `decor`
  (yol, giriş/çıkış okları, bina, asansör, bölge harfi, yeşil alan), sonra cepler. Renkler: boş yeşil, dolu kırmızı,
  rezerve turuncu, kullanım dışı çizgili gri, engelli mavi + ♿ (yazı tipinden bağımsız SVG simgesi), ihlal kırmızı yanıp sönen
  kenarlık + ünlem. Çok katlıda kat sekmeleri; `+ / − / Sığdır` yakınlaştırma (yakınken sürükleyerek kaydırma); fareyle
  üzerine gelince ipucu. Backend eski sürümse (layout yok) 1000×600 eski düzene geri düşer.
- **SignalR:** `SlotsUpdated` / `SummaryUpdated` öğelerindeki `lotCode` ile seçili otoparka göre süzülür.
  Operatör olayları: `ViolationDetected`, `ViolationResolved`, `PermitsChanged` (menüde açık ihlal ve bekleyen izin rozetleri).
- **Ses:** İhlal uyarı sesi, Canlı İzleme'deki "Ses açık/kapalı" ayarına bağlıdır (`src/utils/sound.js`).

## Klasör yapısı

```
src/
  api/          client.js (fetch sarmalayıcı: JWT, {message} hataları, 401 → çıkış, ağ hatası uyarısı) + uç nokta modülleri
  auth/         AuthContext (localStorage'da token+user), ProtectedRoute (rol bazlı), roles.js
  lot/          LotContext (otopark listesi + seçili otopark)
  realtime/     useParkingHub (SignalR, otomatik yeniden bağlanma), useParkingLive (seçili otoparkın düzeni + REST + canlı veri)
  components/   Navbar, Layout, ParkingMap (çok otoparklı/katlı SVG kroki), LotSelector, LotCards, PermitCheckBox,
                ViolationResolveModal, PlateBadge, BarrierIndicator, StatCard, CardPaymentForm, Modal, ...
  pages/        public/ driver/ operator/ admin/
  utils/        plate.js (normalize/biçim), format.js (TL, tarih, süre, etiketler, izin/ihlal durumları), csv.js, sound.js, chartSetup.js
```

## Canlı güncelleme (SignalR)

`/hubs/parking` hub'ına bağlanılır. Herkese açık sayfalar anonim bağlanır (`SlotsUpdated`, `SummaryUpdated`).
Operatör ekranları JWT ile (`accessTokenFactory` → `?access_token=`) bağlanır ve ayrıca `GateEvent`, `ReviewQueueChanged`,
`AgentsUpdated`, `ViolationDetected`, `ViolationResolved`, `PermitsChanged` olaylarını alır. Bağlantı koparsa otomatik yeniden bağlanılır ve veriler yeniden yüklenir.

## Notlar

- Kart bilgileri tarayıcıda saklanmaz; yalnızca `/api/payments/pay` isteğinde gönderilir.
- CSV dosyaları Excel (Türkçe) uyumludur: UTF-8 BOM, `;` ayırıcı, virgüllü ondalık.
- Backend kapalıysa sayfanın üstünde "Sunucuya ulaşılamıyor" uyarısı çıkar ve 15 sn'de bir yeniden denenir.
