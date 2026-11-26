# API Sözleşmesi (Tüm modüllerin uyacağı tek kaynak)

Bu belge görüntü işleme servisi, ana backend ve web arayüzü arasındaki sözleşmedir.
Bir uç nokta değişecekse önce bu belge güncellenir.

## 1. Portlar ve adresler (yerel geliştirme)

| Servis | Teknoloji | Adres |
|---|---|---|
| Ana API (backend) | ASP.NET Core 10 | http://localhost:5080 |
| SignalR hub | ASP.NET Core SignalR | http://localhost:5080/hubs/parking |
| Görüntü işleme servisi | FastAPI + Uvicorn | http://localhost:8000 |
| Web arayüzü | React + Vite | http://localhost:5173 |
| Veritabanı | PostgreSQL 17 (veya geliştirmede SQLite) | localhost:5432 |

- Tüm JSON alan adları **camelCase**'dir. Tarihler ISO-8601 UTC (`2026-11-25T08:30:00Z`).
- Para birimi TL, `decimal` (JSON'da sayı, ör. `45.5`).
- Hata yanıtı: HTTP 4xx/5xx + `{ "message": "Türkçe açıklama" }`.
- Plaka normal biçimi: **boşluksuz, büyük harf** (`34ABC123`). Görüntülerken `34 ABC 123` biçimine çevrilir.

## 2. Kimlik doğrulama ve roller

JWT Bearer. Roller: `Driver` (Sürücü), `Operator` (Otopark Görevlisi), `Admin` (Yönetici).

| Yöntem | Yol | Rol | Gövde → Yanıt |
|---|---|---|---|
| POST | /api/auth/login | herkes | `{email, password}` → `{token, user:{id, fullName, email, phone, role}}` |
| POST | /api/auth/register | herkes | `{fullName, email, phone, password, kvkkAccepted:true, marketingConsent:bool}` → login yanıtı ile aynı (rol `Driver`) |
| GET | /api/auth/me | giriş yapmış | → `user` |

Hazır (seed) kullanıcılar:

| E-posta | Parola | Rol |
|---|---|---|
| admin@otopark.local | Admin123! | Admin |
| operator@otopark.local | Operator123! | Operator |
| surucu@otopark.local | Surucu123! | Driver (araçları: 06ABC123) |

## 3. Görüntü servisi → Backend (makineler arası)

Başlık: `X-Api-Key: <Vision:ApiKey>` (varsayılan `dev-vision-key`). JWT gerekmez.

### POST /api/vision/plate-events
Giriş/çıkış kamerası bir plaka okuduğunda gönderilir (aynı plaka için ajan tarafında tekrar önleme yapılır).
```json
{
  "cameraId": "giris-1",
  "gate": "Entry",            // "Entry" | "Exit"
  "plate": "34ABC123",        // normalize edilmiş; okunamadıysa ham metin
  "confidence": 0.87,         // 0..1 (tespit × OCR güveni)
  "formatValid": true,        // TR plaka biçimine uyuyor mu
  "timestamp": "2026-11-25T08:30:00Z",
  "imageBase64": "..."        // isteğe bağlı, plaka kırpıntısı JPEG (KVKK: yalnızca plaka bölgesi)
}
```
Yanıt:
```json
{
  "eventId": 15,
  "decision": "Allowed",      // "Allowed" | "Denied" | "PendingReview"
  "message": "Hoş geldiniz. Önerilen bölge: A",
  "sessionId": 42,
  "suggestedZone": "A",
  "fee": 0
}
```
İş kuralları:
- `confidence < settings.confidenceThreshold` **veya** `formatValid=false` → `PendingReview` (operatör onay kuyruğuna düşer, UC-07).
- Giriş: plakanın açık oturumu varsa `Denied` ("Araç zaten içeride"). Otopark doluysa ve plakaya ait aktif rezervasyon yoksa `Denied`. Rezervasyon varsa `Allowed`, rezervasyon `CheckedIn` olur. Aksi hâlde yeni `ParkingSession` açılır, en çok boş yeri olan bölge önerilir ve oturuma yazılır.
- Çıkış: açık oturum yoksa `PendingReview`. Ücret 0 ise veya ödenmişse (ödeme sonrası `gracePeriodMinutes` içinde çıkış) `Allowed`, oturum kapanır. Aksi hâlde `Denied` + "Ödeme gerekli: 45,00 TL".
- Her olay `GateEvent` olarak kaydedilir ve SignalR `GateEvent` yayınlanır.

### POST /api/vision/occupancy
Doluluk kamerası değişen (veya periyodik tüm) cep durumlarını gönderir.
```json
{
  "cameraId": "doluluk-1",
  "timestamp": "2026-11-25T08:30:00Z",
  "slots": [ { "code": "A01", "occupied": true, "confidence": 0.93 } ]
}
```
Yanıt: `204 No Content`. Backend `SlotsUpdated` ve `SummaryUpdated` yayınlar. Bilinmeyen cep kodları yok sayılır.

### POST /api/vision/heartbeat
`{ "agents": [ { "id": "giris-1", "type": "Gate", "status": "Running", "fps": 4.2, "lastError": null } ] }` → 204.
Backend son durumu bellekte tutar; `GET /api/operator/agents` ile operatöre sunar.

## 4. Herkese açık uç noktalar (giriş gerekmez)

| Yöntem | Yol | Yanıt |
|---|---|---|
| GET | /api/parking/summary | `{total, occupied, free, reserved, occupancyRate}` (occupancyRate 0..1) |
| GET | /api/parking/zones | `[{id, code, name, floor, totalSlots, freeSlots}]` |
| GET | /api/parking/slots | `[{id, code, zoneCode, isOccupied, isReserved, updatedAt, mapX, mapY, mapW, mapH}]` (kroki koordinatları 0..1000 × 0..600 tuval) |
| GET | /api/parking/recommendation | `{zoneCode, zoneName, freeSlots, slotCode}` (en çok boş yeri olan bölge, içinden ilk boş cep) |
| GET | /api/parking/locate/{plate} | `{plate, zoneCode, zoneName, floor, entryTime, durationMinutes, currentFee, isPaid}`; 404 "Araç içeride bulunamadı" (UC-06) |
| GET | /api/parking/tariffs | aktif tarife listesi (aşağıdaki Tariff nesnesi) |
| GET | /api/payments/quote/{plate} | `{sessionId, plate, entryTime, durationMinutes, amount, isPaid}`; 404 (UC-03, girişsiz ödeme) |
| POST | /api/payments/pay | aşağıya bakın — girişsiz de çalışır |
| POST | /api/privacy/requests | `{fullName, email, plate, type:"Delete"|"Objection"|"Info", message}` → 201 (KVKK ilgili kişi talebi) |

### Ödeme (UC-03, UC-04) — POST /api/payments/pay
```json
{ "sessionId": 42, "reservationId": null,
  "card": { "holderName": "Ad Soyad", "number": "5528790000000008", "expireMonth": "12", "expireYear": "2030", "cvc": "123" } }
```
Yanıt: `{paymentId, status:"Success"|"Failed", amount, message, transactionId}`.
- Kart bilgisi **hiçbir zaman veritabanına yazılmaz ve loglanmaz** (yalnızca son 4 hane).
- Varsayılan sağlayıcı `Mock` (iyzico sandbox davranışını taklit eder): `5528790000000008` ve `4766620000000001` başarılı, `4111111111111129` "Yetersiz bakiye" ile başarısız, diğerleri Luhn kontrolü geçerse başarılı.
- `Payment:Provider = Iyzico` yapılandırması için arayüz (`IPaymentProvider`) hazırdır.

## 5. Sürücü (rol: Driver)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | /api/vehicles/my | `[{id, plate, nickname}]` |
| POST | /api/vehicles | `{plate, nickname}` |
| DELETE | /api/vehicles/{id} | |
| GET | /api/reservations/my | `[Reservation]` |
| POST | /api/reservations/quote | `{zoneCode, startTime, endTime}` → `{amount, available:bool, message}` |
| POST | /api/reservations | `{plate, zoneCode, startTime, endTime}` → `Reservation` (Status `PendingPayment`) |
| DELETE | /api/reservations/{id} | iptal (`Cancelled`) |
| GET | /api/sessions/my | sürücünün plakalarına ait oturum geçmişi `[Session]` |

`Reservation`: `{id, plate, zoneCode, zoneName, startTime, endTime, amount, status, createdAt}`;
status: `PendingPayment | Confirmed | CheckedIn | Completed | Cancelled | Expired`.
Rezervasyon ön ödemesi `/api/payments/pay` ile `reservationId` verilerek yapılır → `Confirmed`.
Rezervasyon sırasında bölgede çakışan rezervasyon sayısı bölge kapasitesini aşamaz.
Ön ödenen tutar çıkışta oturum ücretinden düşülür.

## 6. Operatör (rol: Operator veya Admin)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | /api/operator/review-queue | `[{id, gateEventId, cameraId, gate, plateRead, confidence, imageBase64, createdAt}]` (UC-07) |
| POST | /api/operator/review-queue/{id}/resolve | `{correctedPlate, approve:bool}` → gate-event yanıtı ile aynı yapı (`decision`, `message`, …) |
| GET | /api/operator/sessions/active | `[Session]` |
| GET | /api/operator/gate-events?limit=50 | `[GateEvent]` (yeniden eskiye) |
| POST | /api/operator/manual-entry | `{plate}` → gate-event yanıtı |
| POST | /api/operator/manual-exit | `{plate}` → gate-event yanıtı |
| POST | /api/operator/sessions/{id}/cash-payment | gişe nakit ödemesi → `{paymentId, status, amount, message}` |
| POST | /api/operator/slots/{code}/override | `{occupied:bool}` el ile cep durumu düzeltme |
| GET | /api/operator/agents | görüntü ajanlarının son heartbeat durumu |

`Session`: `{id, plate, zoneCode, entryTime, exitTime, durationMinutes, fee, paidAmount, isPaid, status:"Active"|"Completed"}`
`GateEvent`: `{id, cameraId, gate, plate, confidence, decision, message, isManual, createdAt}`

## 7. Yönetici (rol: Admin)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET/POST | /api/admin/tariffs | `Tariff`: `{id, name, minMinutes, maxMinutes, price, isActive}` — süre dilimi tarifesi (UC-12) |
| PUT/DELETE | /api/admin/tariffs/{id} | |
| GET/PUT | /api/admin/settings | `{confidenceThreshold, abandonedThresholdHours, gracePeriodMinutes, freeMinutes, dailyMaxFee, reservationHourlyPrice, dataRetentionDays}` |
| GET | /api/admin/users | `[{id, fullName, email, phone, role, isActive, createdAt}]` (UC-13) |
| POST | /api/admin/users | `{fullName, email, phone, password, role}` |
| PUT | /api/admin/users/{id} | `{fullName, phone, role, isActive}` |
| DELETE | /api/admin/users/{id} | |
| GET | /api/admin/abandoned | azami süreyi aşan açık oturumlar: `[Session + overdueHours]` (UC-09) |
| GET | /api/admin/reports/occupancy?from=&to= | UC-10 — aşağıda |
| GET | /api/admin/reports/revenue?from=&to=&groupBy=day\|week\|month | UC-11 — aşağıda |
| GET | /api/admin/audit-logs?limit=100 | `[{id, userEmail, action, details, ipAddress, createdAt}]` |
| GET | /api/admin/privacy-requests | KVKK talepleri |
| PUT | /api/admin/privacy-requests/{id} | `{status:"Open"|"Resolved"|"Rejected", note}` |
| POST | /api/admin/demo-data | son 30 güne ait örnek oturum/ödeme üretir (rapor demosu için) |

Ücret hesabı: `freeMinutes` (vars. 15 dk) altı ücretsiz; aksi hâlde süreyi kapsayan aktif tarife dilimi uygulanır;
24 saati aşan sürelerde her tam gün için `dailyMaxFee` + kalan süre dilimi. Sonuç `dailyMaxFee × gün` tavanını geçmez.

Varsayılan tarife (seed): 0–60 dk 30 TL, 60–120 dk 45 TL, 120–240 dk 60 TL, 240–480 dk 80 TL, 480–1440 dk 100 TL.

Doluluk raporu yanıtı:
```json
{ "from": "...", "to": "...", "totalEntries": 120, "averageDurationMinutes": 96.5,
  "hourly": [ { "hour": 8, "entries": 14, "averageOccupancyRate": 0.62 } ],
  "daily":  [ { "date": "2026-11-20", "entries": 25, "averageDurationMinutes": 88.0, "peakHour": 9 } ] }
```
Gelir raporu yanıtı:
```json
{ "from": "...", "to": "...", "total": 4520.0, "count": 96, "averagePerSession": 47.1,
  "series":   [ { "period": "2026-11-20", "amount": 640.0, "count": 14 } ],
  "byMethod": [ { "method": "Card", "amount": 3000.0 }, { "method": "Cash", "amount": 1520.0 } ] }
```

## 8. SignalR — /hubs/parking

Anonim bağlantıya izin verilir (yalnızca toplu doluluk verisi yayınlanır; plaka içeren olaylar `operators` grubuna gider).
Operatör/Yönetici, bağlantı kurarken `?access_token=<JWT>` ile bağlanırsa otomatik olarak `operators` grubuna eklenir.

| Olay | Alıcı | Veri |
|---|---|---|
| `SlotsUpdated` | herkes | `[Slot]` (yalnızca değişen cepler) |
| `SummaryUpdated` | herkes | `Summary` |
| `GateEvent` | operators | `GateEvent` + `suggestedZone` (bariyer durumu: Allowed → "AÇIK") |
| `ReviewQueueChanged` | operators | `{ pendingCount }` |
| `AgentsUpdated` | operators | heartbeat listesi |

## 9. Görüntü işleme servisi uç noktaları (http://localhost:8000)

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | /health | `{status:"ok", models:{plateDetector:bool, vehicleDetector:bool, ocr:"easyocr"|"yolo-char"|"none"}}` |
| GET | /agents | `[{id, type:"Gate"|"Occupancy", gate, source, enabled, status, fps, lastPlate, lastError}]` |
| POST | /agents/{id}/start , /agents/{id}/stop | ajanı başlat/durdur |
| GET | /agents/{id}/snapshot | son işlenmiş kare (JPEG, yalnızca bellekte, kaydedilmez) |
| POST | /recognize?gate=Entry&forward=false | multipart `file` (resim) → `{plates:[{plate, rawText, confidence, formatValid, bbox:[x1,y1,x2,y2]}], backendResponse, elapsedMs, annotatedImageBase64}` ; `forward=true` ise en iyi sonuç backend'e plaka olayı olarak gönderilir |
| POST | /occupancy/analyze?forward=false | multipart `file` → `{slots:[{code, occupied, confidence}], vehicles:int, annotatedImageBase64, elapsedMs}` |
| GET | /config/slots | doluluk kamerası cep poligonları |

CORS: http://localhost:5173 izinli.

## 10. Kroki / cep düzeni (seed)

3 bölge, 28 cep (pilot alan 20–30 araç):
- **A** "A Bölgesi – Giriş Yanı", kat 0, A01–A10
- **B** "B Bölgesi – Orta", kat 0, B01–B10
- **C** "C Bölgesi – Arka", kat 0, C01–C08

Kroki koordinatları (1000×600 tuval): A sırası y=60, B sırası y=260, C sırası y=460; cep genişliği 80, yüksekliği 120,
x = 60 + (i-1)×88. Görüntü servisi `config/slots.json` dosyasındaki cep kodları bu kodlarla aynıdır.

---

## 11. Çoklu otopark ve engelli park yerleri (v2)

Bu bölüm önceki bölümleri **genişletir**. Çelişki olursa bu bölüm geçerlidir. Geriye dönük uyum:
`lot` parametresi verilmeyen her istek **varsayılan otoparka** (`GAZI`) uygulanır; mevcut ekranlar ve görüntü servisi bozulmaz.

### 11.1 Kavramlar
- **Otopark (ParkingLot):** `{id, code, name, address, description, mapWidth, mapHeight, floors:[{floor, name}], decor:[MapDecor], isActive}`.
  Bir otoparkın birden çok bölgesi (Zone) vardır; bölge bir kata aittir. Bölge ve cep kodları **otopark içinde** benzersizdir.
- **Cep türü (SlotType):** `"Standard" | "Disabled"`. Engelli cepler krokide mavi + ♿ simgesiyle gösterilir.
- **Engelli izni (DisabledPermit):** `{id, plate, holderName, userId, userEmail, documentNo, status:"Pending"|"Approved"|"Rejected"|"Revoked", validUntil, note, createdAt, reviewedAt, reviewedBy}`.
  Yalnızca `Approved` ve süresi dolmamış (`validUntil` boş ya da gelecekte) izin geçerlidir. Plaka normalize edilerek eşleşir.
- **İhlal (Violation):** `{id, lotCode, lotName, slotCode, zoneCode, floor, detectedAt, resolvedAt, status:"Open"|"Resolved"|"FalseAlarm", note, resolvedBy}`.
- **MapDecor** (krokide çizilecek öğeler) `{type, x, y, w, h, text, floor?, points?}` biçimindedir. Mevcut `road`, `entry`, `exit`, `building`, `elevator`, `label` ve `green` türlerine ek olarak `access` araç erişim noktasını gösterir. `surface`, `island` ve `walkway` için isteğe bağlı `points: [{x,y}]` dizisi, tuval koordinatlarında bir çokgen tanımlar.

### 11.2 Engelli yeri kuralları ("normal araçlar park edemez")
1. **Kapasite ayrımı:** Bir otoparkta normal araçlar için boş yer = boş **Standard** cepler. Engelli izinli araçlar için boş yer = boş Standard + boş Disabled cepler.
2. **Giriş:** İzinsiz araç, yalnızca Disabled cepler boşsa `Denied` alır: "Otopark dolu. Kalan yerler engelli araçlara ayrılmıştır."
   İzinli araçta öneri, boş Disabled cebi olan bölgedir (`suggestedSlot` engelli cep kodu). Yanıta `isDisabledPermit: true` eklenir.
3. **Yönlendirme / öneri:** `/recommendation` normal sürücüye asla engelli cep önermez. `?disabled=true` ile izinli sürücüye engelli cep önerilir.
4. **Rezervasyon:** Varsayılan rezervasyon Standard kapasiteden düşer. `slotType:"Disabled"` istenirse plakanın geçerli engelli izni olmalı; yoksa `403` "Engelli park yeri rezervasyonu için onaylı engelli izni gerekir".
5. **İhlal tespiti (kamera):** Doluluk güncellemesinde bir Disabled cep **boştan doluya** geçtiğinde backend kontrol eder:
   otoparktaki dolu Disabled cep sayısı > o otoparkta içeride olan (aktif oturumlu) geçerli izinli araç sayısı ise o cep için `Open` ihlal açılır,
   SignalR `ViolationDetected` (operators) yayınlanır ve AuditLog yazılır. Cep boşalınca açık ihlali otomatik `Resolved` (not: "Araç ayrıldı") olur.
   Operatör el ile `Resolved` veya `FalseAlarm` (izinli araç ama oturum eşleşmedi) yapabilir. Aynı cepte aynı anda tek açık ihlal olur.
6. Oturum (Session) açılırken plakanın izin durumu `isDisabledPermit` olarak oturuma yazılır.

### 11.3 Yeni / değişen uç noktalar

Herkese açık:
| Yöntem | Yol | Yanıt |
|---|---|---|
| GET | /api/parking/lots | `[{id, code, name, address, description, floors, totalSlots, freeSlots, disabledTotal, disabledFree, occupancyRate}]` (`freeSlots` = normal araçlar için boş = boş Standard) |
| GET | /api/parking/lots/{code}/layout | `{lot:{...ParkingLot}, zones:[{id, code, name, floor}], slots:[Slot]}` — krokiyi çizmek için tek çağrı |
| GET | /api/parking/summary?lot= | `{lotCode, total, occupied, free, reserved, occupancyRate, disabledTotal, disabledOccupied, disabledFree}` |
| GET | /api/parking/zones?lot= | `[{id, code, name, floor, totalSlots, freeSlots, disabledTotal, disabledFree}]` |
| GET | /api/parking/slots?lot= | `[Slot]` |
| GET | /api/parking/recommendation?lot=&disabled=false | `{lotCode, zoneCode, zoneName, floor, freeSlots, slotCode, slotType}` |
| GET | /api/parking/locate/{plate} | önceki alanlara ek `lotCode, lotName` (otopark parametresi gerekmez; aktif oturum hangi otoparktaysa) |

`Slot` (genişletilmiş): `{id, code, lotCode, zoneCode, floor, type:"Standard"|"Disabled", isOccupied, isReserved, hasViolation, isActive, updatedAt, mapX, mapY, mapW, mapH}`.

Otopark listesinde ve kroki yanıtının `lot` nesnesinde `siteReference` alanı belediye kaynağına dayanan demo krokileri için `{sourceName, sourceUrl}` bilgisini taşır. Bu krokilerde kapasite yayımlanan toplamı, cep numaraları ve doluluk ise uygulamadaki demo verisini gösterir.

Sürücü:
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | /api/permits/my | sürücünün başvuruları `[DisabledPermit]` |
| POST | /api/permits | `{plate, holderName, documentNo}` → `DisabledPermit` (status `Pending`). Plaka sürücünün araçlarından biri olmalı. Aynı plaka için bekleyen/onaylı başvuru varsa 409. |
| POST | /api/reservations/quote | gövdeye `lotCode` (zorunlu değil, vars. GAZI) ve `slotType` eklenir |
| POST | /api/reservations | `{plate, lotCode, zoneCode, slotType, startTime, endTime}` |
`Reservation` ve `Session` nesnelerine `lotCode, lotName` eklenir; Reservation'a `slotType`, Session'a `isDisabledPermit`.
`GET /api/vehicles/my` öğelerine `disabledPermitStatus` (`null|"Pending"|"Approved"|...`) eklenir.

Operatör (Operator veya Admin):
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | /api/operator/violations?lot=&status=Open | `[Violation]` |
| POST | /api/operator/violations/{id}/resolve | `{status:"Resolved"|"FalseAlarm", note}` |
| POST | /api/operator/slots/{code}/override?lot= | önceki gibi (lot eklendi) |
| POST | /api/operator/manual-entry, manual-exit | gövdeye isteğe bağlı `lotCode` |
| GET | /api/operator/sessions/active?lot= | lot verilmezse tümü |
| GET | /api/operator/gate-events?lot=&limit= | |
| GET | /api/operator/review-queue?lot= | öğelere `lotCode` eklenir |
| GET | /api/permits/check/{plate} | `{plate, valid:bool, permit}` — gişede hızlı kontrol |

Yönetici (Admin):
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | /api/admin/permits?status= | tüm engelli izin başvuruları |
| POST | /api/admin/permits | `{plate, holderName, documentNo, validUntil}` → doğrudan `Approved` izin (gişede belge görülerek) |
| PUT | /api/admin/permits/{id} | `{status, validUntil, note}` (onay/ret/iptal) |
| PUT | /api/admin/slots/{id} | `{type, isActive}` — krokide cebe tıklayıp engelli/normal yapma, cebi kullanım dışı bırakma |
| GET | /api/admin/lots | otopark listesi (pasifler dâhil) |
| PUT | /api/admin/lots/{code} | `{name, address, description, isActive}` |
| GET | /api/admin/reports/occupancy, revenue | isteğe bağlı `lot` parametresi (verilmezse tüm otoparklar) |
| GET | /api/admin/abandoned?lot= | |

### 11.4 Görüntü servisi → backend
`plate-events`, `occupancy` gövdelerine **`lotCode`** alanı eklenir (yoksa `GAZI`). Heartbeat ajan öğelerine `lotCode` eklenir.
Bir kamera tek otoparka bağlıdır (`cameras.yaml` içinde `lotCode`).

### 11.5 SignalR
- `SlotsUpdated`: Slot listesi (her öğede `lotCode`). İstemci seçili otoparka göre süzer.
- `SummaryUpdated`: Summary (içinde `lotCode`).
- `GateEvent`: ek `lotCode`, `isDisabledPermit`.
- `ViolationDetected` (operators): Violation. `ViolationResolved` (operators): `{id, lotCode, slotCode, status}`.
- `PermitsChanged` (operators): `{pendingCount}`.

### 11.6 Seed otoparklar (kroki tuvali her otoparkta ayrı)
| Kod | Ad | Kat/Bölge | Cep | Engelli | Tuval |
|---|---|---|---|---|---|
| `GAZI` | Gazi Teknoloji Fakültesi Otoparkı (pilot) | Kat 0: A(10) B(10) C(8) — **eski kodlar korunur** (A01…C08) | 28 | A01, A02 (girişe en yakın) | 1000×600 |
| `MERKEZ` | Merkez Katlı Otopark | B1 (Kat -1), ZM (Zemin), K1 (Kat 1); her katta 2 sıra × 16 = 32 cep, kodlar `B1-01`…`ZM-32`…`K1-32` | 96 | her katta asansöre en yakın 3 cep | 1400×700 (her kat aynı tuval, katlar sekmeyle) |
| `AVM` | Çarşı AVM Açık Otopark | Kat 0: A…F, her bölge 2 sıra × 12 = 24 cep (`A-01`…`F-24`) | 144 | AVM girişine en yakın 10 cep (A ve B bölgelerinin binaya bakan uçları) | 1600×1000 |
| `HASTANE` | Şehir Hastanesi Otoparkı | Kat 0: P (Poliklinik, 20), A (Acil, 12), Z (Ziyaretçi, 28) | 60 | 10 cep: P'nin ilk 6'sı, A'nın ilk 4'ü (hastane binası yanında) | 1200×800 |

Her otoparkta `decor`: sıralar arasında yollar (`road`), giriş (`entry`) ve çıkış (`exit`) işaretleri, bina/AVM/hastane bloğu (`building`), katlı otoparkta asansör (`elevator`), bölge etiketleri (`label`).
Cepler yollara bakacak şekilde dizilir (sıra çiftleri arasında yol). Engelli cepler normal cepten **%40 daha geniş** çizilir (gerçek engelli yerleri gibi), dolayısıyla sıradaki sonraki ceplerin x'i buna göre kayar.
