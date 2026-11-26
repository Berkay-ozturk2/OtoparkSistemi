# Proje Ajanları / Modül Dağılımı

Proje, birbirinden bağımsız geliştirilip test edilebilen **ajanlara (modüllere)** bölünmüştür.
Ajanlar yalnızca [API_SOZLESMESI.md](API_SOZLESMESI.md) üzerinden konuşur; bir ekip üyesi kendi
ajanını diğerlerini beklemeden geliştirebilir.

```
                    ┌──────────────────────── KENAR BİRİMİ (saha dizüstü) ─────────────────────────┐
  Giriş kamerası ──►│  GateAgent (Entry)  ─┐                                                        │
  Çıkış kamerası ──►│  GateAgent (Exit)   ─┼─► vision-service (FastAPI :8000)                       │
  Doluluk kamerası ►│  OccupancyAgent     ─┘     YOLOv8 TR plaka modeli + EasyOCR + araç tespiti    │
                    └───────────────────────────────┬──────────────────────────────────────────────┘
                                                    │ yalnızca olay (plaka metni, güven, cep durumu)
                                                    ▼  X-Api-Key
                    ┌──────────────────────── SUNUCU ──────────────────────────────────────────────┐
                    │  backend (ASP.NET Core 10 :5080)  ── EF Core ──► PostgreSQL / SQLite          │
                    │   GateService · FeeCalculator · Reservation · Payment(Mock/iyzico) · Report   │
                    │   SignalR /hubs/parking  ·  KVKK DataRetentionWorker                          │
                    └───────────────────────────────┬──────────────────────────────────────────────┘
                                                    │ REST + SignalR (canlı)
                                                    ▼
                    ┌──────────────── frontend (React + Vite + Bootstrap :5173) ───────────────────┐
                    │  Sürücü paneli · Operatör canlı izleme / onay kuyruğu · Yönetici raporları    │
                    └──────────────────────────────────────────────────────────────────────────────┘
```

## Ajan listesi

| # | Ajan / Modül | Klasör | Görev | Sorumlu (fizibilite Tablo 13) | Yedek |
|---|---|---|---|---|---|
| 1 | **GateAgent – Giriş** | `vision-service/app/agents/gate_agent.py` | Giriş kamerasından plaka tespit + OCR, çok karede oylama, backend'e giriş olayı | Berkay Öztürk | İsmail Onur Koru |
| 2 | **GateAgent – Çıkış** | aynı sınıf, `gate: Exit` | Çıkış plakası doğrulama | Berkay Öztürk | İsmail Onur Koru |
| 3 | **OccupancyAgent** | `vision-service/app/agents/occupancy_agent.py` | Tek geniş açılı kamerayla cep doluluğu (araç tespiti × cep poligonu) | İsmail Onur Koru | Berkay Öztürk |
| 4 | **AgentManager + Vision API** | `vision-service/app/` | Ajanları başlat/durdur, heartbeat, `/recognize` test uç noktaları | İsmail Onur Koru | Berkay Öztürk |
| 5 | **Eğitim ajanı** | `training/` | Roboflow TR plaka / karakter veri setleri, YOLOv8 eğitimi, ONNX, doğruluk ölçümü (B1) | Berkay Öztürk | İsmail Onur Koru |
| 6 | **Geçiş karar servisi** | `backend/.../Services/GateService.cs` | Giriş/çıkış kararı, rezervasyon eşleştirme, onay kuyruğu | Çağatay Oğuz | Osmancan Küçdemir |
| 7 | **Ücret & ödeme** | `FeeCalculator`, `PaymentService` | Tarife dilimleri, günlük tavan, sanal POS (Mock / iyzico sandbox) | Çağatay Oğuz | Osmancan Küçdemir |
| 8 | **Rezervasyon & rapor** | `ReservationService`, `ReportService` | UC-04, UC-09, UC-10, UC-11 | Osmancan Küçdemir | Çağatay Oğuz |
| 9 | **Veritabanı & KVKK** | `backend/.../Data`, `DataRetentionWorker`, `database/` | Şema, seed, 30 gün sonra plaka hash'leme | Ramazan Ay | Osmancan Küçdemir |
| 10 | **Web arayüzü** | `frontend/` | Sürücü, operatör, yönetici panelleri; canlı kroki | Osmancan Küçdemir | Berkay Öztürk |
| 11 | **Test & dokümantasyon** | `backend/tests`, `vision-service/tests`, `docs/` | xUnit, pytest, kabul testleri, UML | Ramazan Ay | Çağatay Oğuz |
| 12 | **DevOps** | `docker-compose.yml`, `scripts/` | Tek komutla çalıştırma, CI | İsmail Onur Koru | Çağatay Oğuz |

## Use-case → ajan eşlemesi

| Use-case | Ajan(lar) | Arayüz sayfası |
|---|---|---|
| UC-01 Otoparka Giriş Yap | 1 → 6 | Operatör › Canlı İzleme |
| UC-02 Otoparktan Çıkış Yap | 2 → 6, 7 | Operatör › Canlı İzleme |
| UC-03 Otopark Ücretini Öde | 7 | Ücret Öde (herkese açık), Operatör › Aktif Araçlar (nakit) |
| UC-04 Çevrimiçi Yer Rezerve Et | 8, 7 | Sürücü › Rezervasyon |
| UC-05 Boş Park Yeri Durumunu Görüntüle | 3 → 6 | Ana Sayfa |
| UC-06 Araç Park Konumunu Sorgula | 6 | Aracım Nerede? |
| UC-07 Plaka Okumasını Manuel Düzelt | 6 | Operatör › Onay Kuyruğu |
| UC-08 Anlık Doluluk Durumunu İzle | 3 → SignalR | Operatör › Canlı İzleme |
| UC-09 Terk Edilmiş Araçları Görüntüle | 8 | Yönetici › Terk Edilmiş |
| UC-10 Doluluk Raporunu Al | 8 | Yönetici › Doluluk Raporu |
| UC-11 Gelir Raporunu Al | 8 | Yönetici › Gelir Raporu |
| UC-12 Fiyat Tarifesini Belirle | 7 | Yönetici › Tarifeler |
| UC-13 Kullanıcı Yetkilerini Yönet | 6 | Yönetici › Kullanıcılar |

## Çalışma kuralları

1. Sözleşmeyi değiştiren kişi PR açıklamasında belirtir ve diğer ajan sahiplerini etiketler.
2. Her ajan kendi testleriyle gelir (`pytest`, `dotnet test`).
3. Kamera/model hazır değilken `vision-service/tools/simulator.py` backend'i besler; arayüz ve backend ekipleri beklemez.
