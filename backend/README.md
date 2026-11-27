# Akıllı Otopark Sistemi – Ana Backend

Gazi Üniversitesi BMT-315 Yazılım Mühendisliği dönem projesi **"Görüntü İşleme Destekli Akıllı Otopark Sistemi"**
için ASP.NET Core Web API (Controller tabanlı) ana servisi.

Uç noktalar, alan adları ve iş kuralları için tek kaynak: [`../docs/API_SOZLESMESI.md`](../docs/API_SOZLESMESI.md).

| Bileşen | Teknoloji |
|---|---|
| Çatı | .NET 10 (`net10.0`), ASP.NET Core Web API |
| Veri erişimi | EF Core 10 — SQLite (varsayılan) veya PostgreSQL 17 (Npgsql) |
| Gerçek zamanlı | SignalR (`/hubs/parking`) |
| Kimlik doğrulama | JWT Bearer, BCrypt parola özetleri |
| Belgeleme | Swagger (`/swagger`) |
| Test | xUnit + SQLite bellek içi veritabanı |

## Gereksinimler

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- (İsteğe bağlı) Docker — PostgreSQL ile çalıştırmak için

## Çalıştırma (kurulumsuz, SQLite)

```powershell
cd backend
dotnet run --project src/OtoparkSistemi.Api
```

- API: http://localhost:5080
- Swagger: http://localhost:5080/swagger  (sağ üstteki **Authorize** ile `Bearer` token veya `X-Api-Key` girilebilir)
- SignalR hub: http://localhost:5080/hubs/parking
- Veritabanı dosyası: `src/OtoparkSistemi.Api/otopark.db` (ilk açılışta otomatik oluşturulur ve seed edilir)

Veritabanını sıfırlamak için uygulamayı durdurup `otopark.db` dosyasını silmeniz yeterlidir.

> **Şema sıfırlama notu (v2 – çoklu otopark):** Migration kullanılmadığı için eski (tek otoparklı) sürümden kalan
> `otopark.db` yeni tabloları içermez. Uygulama açılışta şemayı denetler (`ParkingLots` tablosu ve
> `Settings.SchemaVersion` sütunu); eski şema bulunursa konsola **uyarı** yazar, veritabanını **silip yeniden
> oluşturur** ve seed eder. Önceki oturum/ödeme/rezervasyon kayıtları kaybolur (prototip için kabul edilmiştir).
> Şema güncelse hiçbir veri silinmez. Kalıcı ortamda bu davranış yerine migration kullanılmalıdır (aşağıya bakın).

### Hazır kullanıcılar (seed)

| E-posta | Parola | Rol |
|---|---|---|
| admin@otopark.local | Admin123! | Admin |
| operator@otopark.local | Operator123! | Operator |
| surucu@otopark.local | Surucu123! | Driver (araçları: 06ABC123, 06ENG061) |

Seed ayrıca 4 otopark (kroki koordinatları ve süsleriyle), 5 tarife dilimi, varsayılan sistem ayarları ve örnek
engelli izinlerini ekler:

| Kod | Ad | Bölgeler | Cep | Engelli | Tuval |
|---|---|---|---|---|---|
| `GAZI` (varsayılan) | Gazi Teknoloji Fakültesi Otoparkı (pilot) | A(10) B(10) C(8) — eski kodlar/koordinatlar aynen | 28 | A01, A02 | 1000×600 |
| `MERKEZ` | Merkez Katlı Otopark | B1 (Kat -1), ZM (Zemin), K1 (Kat 1); her kat 32 | 96 | her katta 3 | 1400×700 |
| `AVM` | Çarşı AVM Açık Otopark | A…F, her biri 24 | 144 | 10 (A ve B'nin binaya bakan uçları) | 1600×1000 |
| `HASTANE` | Şehir Hastanesi Otoparkı | P(20) A(12) Z(28) | 60 | P01–P06, A01–A04 | 1200×800 |

Kroki koordinatları `Data/DbSeeder.cs` içindeki `LotLayouts.Row(...)` yardımcısıyla programatik üretilir (engelli cep
%40 daha geniş, sonraki ceplerin x'i kayar); üretim sırasında her cebin tuvale sığdığı denetlenir.

Örnek engelli izinleri: `06ENG061` → **Approved** (Ayşe Yılmaz, EK-2026-0001, 1 yıl geçerli, sürücüye bağlı);
`34ENG034` → **Pending** (Mehmet Demir, kullanıcıya bağlı değil — yönetici listesinde görünür).

### Rapor demosu

Uygulama açılışta **örnek oturum üretmez**. Rapor ekranlarını doldurmak için Admin olarak:

```
POST /api/admin/demo-data
```

Son 30 güne ait (08-10 ve 17-19 pikli) tamamlanmış oturumlar, kart/nakit ödemeler, birkaç açık ve terk edilmiş oturum üretir.
Her çağrı yeni veri ekler.

## Çoklu otopark ve engelli park yerleri (sözleşme bölüm 11)

- **Otopark seçimi:** `lot` sorgu parametresi / `lotCode` gövde alanı verilmeyen her istek varsayılan otoparka
  (`GAZI`, tek yerde: `Services/LotHelpers.cs` → `LotDefaults.DefaultLotCode`) uygulanır. Bilinmeyen kod → `404 "Otopark bulunamadı"`.
  Bölge ve cep kodları otopark içinde benzersizdir; tüm cep sorguları otopark kodu + cep kodu ile yapılır.
- **Yeni uç noktalar:** `GET /api/parking/lots`, `GET /api/parking/lots/{code}/layout` (pasif otoparklar dâhil),
  `GET/POST /api/permits/my|/api/permits`, `GET /api/permits/check/{plate}` (Operator/Admin),
  `GET /api/operator/violations`, `POST /api/operator/violations/{id}/resolve`,
  `GET/POST /api/admin/permits`, `PUT /api/admin/permits/{id}`, `PUT /api/admin/slots/{id}`,
  `GET /api/admin/lots`, `PUT /api/admin/lots/{code}`; mevcut uç noktalara `lot` parametresi.
- **Kapasite ayrımı:** normal araç için boş yer = boş *Standard* cep; geçerli engelli izinli araç için boş Standard + boş
  Disabled. Yalnızca engelli cepler boşsa izinsiz araç `Denied` alır ("Otopark dolu. Kalan yerler engelli araçlara
  ayrılmıştır."). `summary.free`, `zones[].freeSlots` ve `lots[].freeSlots` normal araçlar için boş yeri gösterir.
- **Engelli izni:** yalnızca `Approved` ve süresi dolmamış izin geçerlidir; plaka normalize edilerek eşleşir. Oturum açılırken
  `isDisabledPermit` oturuma yazılır. KVKK saklama görevi izin kayıtlarına **dokunmaz** (izin süresi boyunca saklanır).
- **İhlal tespiti:** doluluk güncellemesinde bir engelli cep boştan doluya geçtiğinde, otoparktaki dolu engelli cep sayısı
  içerideki geçerli izinli araç sayısından fazlaysa `Open` ihlal açılır (SignalR `ViolationDetected`, AuditLog).
  Cep boşalınca ihlal "Araç ayrıldı" notuyla `Resolved` olur (`ViolationResolved`). Operatör `Resolved`/`FalseAlarm` yapabilir.
- **SignalR:** tüm yüklerde `lotCode` bulunur; yeni olaylar `ViolationDetected`, `ViolationResolved`, `PermitsChanged`.

## PostgreSQL'e geçiş

```powershell
cd backend
docker compose up -d          # postgres:17, kullanıcı: otopark, parola: otopark123, veritabanı: otopark
```

`src/OtoparkSistemi.Api/appsettings.json` içinde:

```json
"Database": { "Provider": "PostgreSQL" }
```

Bağlantı dizesi `ConnectionStrings:PostgreSQL` altındadır. Ortam değişkeniyle de verilebilir:
`Database__Provider=PostgreSQL`.

### Docker

```powershell
cd backend
docker build -t otopark-backend .
docker run -p 5080:5080 -e Database__Provider=PostgreSQL `
  -e ConnectionStrings__PostgreSQL="Host=host.docker.internal;Port=5432;Database=otopark;Username=otopark;Password=otopark123" `
  -e Cors__Origins__0=http://localhost:5173 otopark-backend
```

Ezilebilir anahtarlar: `Database__Provider`, `ConnectionStrings__Sqlite`, `ConnectionStrings__PostgreSQL`,
`Cors__Origins__0`, `Vision__ApiKey`, `Jwt__Key`, `Urls` (imajda `http://+:5080`).

### Migration notu

Geliştirme kolaylığı için şema `Database.EnsureCreated()` ile oluşturulur (migration dosyası yoktur).
Kalıcı bir ortama geçerken:

```powershell
dotnet tool install --global dotnet-ef
cd backend/src/OtoparkSistemi.Api
dotnet ef migrations add Baslangic
```

ardından `Program.cs` içindeki `EnsureCreatedAsync()` çağrısını `MigrateAsync()` ile değiştirin.
(EnsureCreated ile oluşturulmuş bir veritabanına migration uygulanamaz; boş veritabanıyla başlayın.)
SQLite ve PostgreSQL için ayrı migration seti gerekir; ekip tek sağlayıcıda (PostgreSQL) karar kılmalıdır.

## Testler

```powershell
cd backend
dotnet test
```

Kapsam: ücret hesabı (ücretsiz süre, dilimler, günlük tavan, çok günlü), TR plaka normalize/doğrulama,
sahte ödeme sağlayıcısı (test kartları, Luhn), giriş/çıkış senaryoları (çift giriş reddi, ödeme gerekli → ödeme → çıkış,
grace aşımı fark ücreti, düşük güven → onay kuyruğu, dolu otopark reddi, rezervasyonlu giriş ve ön ödeme düşümü),
rezervasyon kapasitesi, rezervasyon süre aşımı ve KVKK anonimleştirme.
Çoklu otopark / engelli yerleri: seed (4 otopark, cep ve engelli sayıları, tuvale sığma, aynı katta çakışmama),
izinsiz aracın yalnızca engelli yer boşken reddi, izinli araca engelli cep önerisi, izinsiz engelli rezervasyonu → 403,
ihlalin açılması/kapanması, izinli araç içerideyken ihlal açılmaması, izin başvurusu/onayı/iptali.

## Yapılandırma (`appsettings.json`)

| Anahtar | Açıklama | Varsayılan |
|---|---|---|
| `Urls` | Dinlenen adres | `http://localhost:5080` |
| `Database:Provider` | `Sqlite` veya `PostgreSQL` | `Sqlite` |
| `Jwt:Key` | İmza anahtarı (≥ 32 bayt). **Üretimde değiştirin.** | geliştirme anahtarı |
| `Jwt:ExpiresMinutes` | Token süresi | 480 |
| `Vision:ApiKey` | Görüntü servisinin `X-Api-Key` değeri | `dev-vision-key` |
| `Payment:Provider` | `Mock` (iyzico için `IPaymentProvider` uygulanmalı) | `Mock` |
| `Cors:Origins` | İzinli web adresleri | `http://localhost:5173` |

İş ayarları (güven eşiği, ücretsiz süre, günlük tavan, grace süresi, rezervasyon saatlik ücreti, veri saklama süresi)
veritabanındadır ve `GET/PUT /api/admin/settings` ile yönetilir.

## Mimari özet

```
src/OtoparkSistemi.Api/
  Domain/              Varlıklar ve enum'lar
  Data/                AppDbContext (UTC dönüştürücüleri), DbSeeder + LotLayouts (kroki üretimi), SchemaGuard (eski şema tespiti)
  Dtos/                İstek/yanıt record'ları (camelCase JSON, enum'lar string)
  Services/            FeeCalculator (saf), GateService (giriş/çıkış kararı), ParkingService (doluluk/öneri/konum),
                       ReservationService, PaymentService + IPaymentProvider/MockPaymentProvider, ReportService,
                       AuditService, TokenService, AgentStatusStore, RealtimeNotifier, DemoDataService,
                       PermitService (+ PermitRules), LotHelpers (varsayılan otopark, kat/süs JSON)
  BackgroundServices/  DataRetentionWorker (KVKK, saatlik), ReservationExpiryWorker (dakikalık)
  Hubs/                ParkingHub (operators grubu)
  Controllers/         Auth, Parking, Vision, Vehicles, Reservations, Sessions, Payments, Privacy, Permits, Operator, Admin, Reports
  Middleware/          Hata → { message }, X-Api-Key filtresi
tests/OtoparkSistemi.Tests/
```

### Önemli kurallar

- **Doluluk:** `dolu = max(kameranın dolu dediği cep, aktif oturum sayısı)`; böylece doluluk kamerası çalışmasa da sistem
  giriş/çıkış oturumlarıyla çalışır. `boş = toplam − dolu − şu an geçerli onaylı rezervasyonlar`.
- **Ücret:** `freeMinutes` (dahil) ücretsiz; süre yukarı yuvarlanan dakikayla dilime eşlenir (`min < dk ≤ max`);
  24 saati aşan her tam gün `dailyMaxFee`. Çıkış ücreti = tarife − rezervasyon ön ödemesi − ödenen.
  Ödemeden sonra `gracePeriodMinutes` içinde çıkış ücretsizdir; aşılırsa fark ücreti istenir.
- **Rezervasyon:** başlangıçtan 30 dk önce gelen araç rezervasyonlu kabul edilir. Ödenmeyen rezervasyon 15 dk sonra iptal,
  süresi biten onaylı rezervasyon `Expired` olur.
- **KVKK:** kart numarasının yalnızca son 4 hanesi saklanır; `dataRetentionDays` sonrası plakalar SHA-256 özetine çevrilir,
  plaka görüntüleri en geç 7 günde silinir, denetim kayıtları 90 günde silinir. Plaka içeren SignalR olayları yalnızca
  `operators` grubuna gider.
- **Saat:** tüm tarihler UTC saklanır ve ISO-8601 (`Z`) döner; raporlarda saat/gün gruplaması Türkiye saatine göredir.

## .NET 8'e düşürme

.NET 10 SDK kurulamıyorsa:

1. Her iki `.csproj` dosyasında `net10.0` → `net8.0`.
2. Paket sürümleri: `Microsoft.EntityFrameworkCore*` ve `Microsoft.AspNetCore.Authentication.JwtBearer` → `8.0.11`,
   `Npgsql.EntityFrameworkCore.PostgreSQL` → `8.0.11`. Swashbuckle `9.0.6` net8 ile de çalışır.
3. Kod C# 12 özellikleri (birincil oluşturucular) kullanır; .NET 8 SDK bunları destekler, başka değişiklik gerekmez.
