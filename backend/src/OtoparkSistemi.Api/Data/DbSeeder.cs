using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Data;

/// <summary>
/// Başlangıç verisi: 3 kullanıcı, 4 otopark (GAZI, MERKEZ, AVM, HASTANE — sözleşme 11.6), 5 tarife dilimi,
/// sistem ayarları ve örnek engelli izinleri.
/// Saha referansı krokileri kod bazında eklenir. Demo oturum verisi burada üretilmez.
/// Kroki koordinatları ve süsler (yol, giriş/çıkış, bina, asansör, etiket) programatik üretilir ve
/// her cebin kendi otoparkının tuvaline sığdığı üretim sırasında denetlenir.
/// </summary>
public static class DbSeeder
{
    /// <summary>
    /// Otoparkların varsayılan konumları (Ankara, WGS84). Yaklaşık değerlerdir; Yönetici > Otoparklar
    /// sayfasından ya da PUT /api/admin/lots/{code} ile düzeltilebilir.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, (double Lat, double Lng)> DefaultLocations =
        new Dictionary<string, (double Lat, double Lng)>
        {
            ["GAZI"] = (39.93830, 32.82230),     // Gazi Üni. Teknoloji Fakültesi, Emniyet Mah., Yenimahalle
            ["MERKEZ"] = (39.92080, 32.85410),   // Kızılay Meydanı yanı, Çankaya
            ["AVM"] = (39.91050, 32.78400),      // Eskişehir Yolu üzeri (Çarşı AVM — kurgusal)
            ["HASTANE"] = (39.90098, 32.75704)   // Ankara Bilkent Şehir Hastanesi, Çankaya
        };

    public static async Task SeedAsync(AppDbContext db, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;

        if (!await db.Users.AnyAsync(ct))
        {
            var admin = new User
            {
                FullName = "Sistem Yöneticisi",
                Email = "admin@otopark.local",
                Phone = "05000000001",
                PasswordHash = Passwords.Hash("Admin123!"),
                Role = UserRole.Admin,
                KvkkAccepted = true,
                KvkkAcceptedAt = now,
                CreatedAt = now
            };
            var op = new User
            {
                FullName = "Otopark Görevlisi",
                Email = "operator@otopark.local",
                Phone = "05000000002",
                PasswordHash = Passwords.Hash("Operator123!"),
                Role = UserRole.Operator,
                KvkkAccepted = true,
                KvkkAcceptedAt = now,
                CreatedAt = now
            };
            var driver = new User
            {
                FullName = "Örnek Sürücü",
                Email = "surucu@otopark.local",
                Phone = "05000000003",
                PasswordHash = Passwords.Hash("Surucu123!"),
                Role = UserRole.Driver,
                KvkkAccepted = true,
                KvkkAcceptedAt = now,
                CreatedAt = now
            };
            driver.Vehicles.Add(new Vehicle { Plate = "06ABC123", Nickname = "Aile aracı", CreatedAt = now });
            driver.Vehicles.Add(new Vehicle { Plate = "06ENG061", Nickname = "Annemin aracı", CreatedAt = now });

            db.Users.AddRange(admin, op, driver);
            await db.SaveChangesAsync(ct);
        }

        if (!await db.ParkingLots.AnyAsync(ct))
        {
            // Sırayla eklenir: Id sırası = listeleme sırası (GAZI, MERKEZ, AVM, HASTANE)
            foreach (var lot in new[] { LotLayouts.Gazi(now), LotLayouts.Merkez(now), LotLayouts.Avm(now), LotLayouts.Hastane(now) })
            {
                db.ParkingLots.Add(lot);
                await db.SaveChangesAsync(ct);
            }
        }

        var existingLotCodes = (await db.ParkingLots.Select(lot => lot.Code).ToListAsync(ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missingReferenceLots = LotLayouts.ReferenceLots
            .Where(lot => !existingLotCodes.Contains(lot.Code))
            .Select(lot => lot.Build(now))
            .ToList();
        if (missingReferenceLots.Count > 0)
        {
            db.ParkingLots.AddRange(missingReferenceLots);
            await db.SaveChangesAsync(ct);
        }

        // Konumu olmayan otoparklara varsayılan konum (eski veritabanları için de çalışır; elle girilen konuma dokunmaz)
        var lotsWithoutLocation = await db.ParkingLots.Where(l => l.Latitude == null || l.Longitude == null).ToListAsync(ct);
        foreach (var lot in lotsWithoutLocation)
        {
            if (DefaultLocations.TryGetValue(lot.Code, out var loc))
            {
                lot.Latitude = loc.Lat;
                lot.Longitude = loc.Lng;
            }
        }
        if (lotsWithoutLocation.Count > 0) await db.SaveChangesAsync(ct);

        if (!await db.Tariffs.AnyAsync(ct))
        {
            db.Tariffs.AddRange(
                new Tariff { Name = "0-1 saat", MinMinutes = 0, MaxMinutes = 60, Price = 30m, IsActive = true },
                new Tariff { Name = "1-2 saat", MinMinutes = 60, MaxMinutes = 120, Price = 45m, IsActive = true },
                new Tariff { Name = "2-4 saat", MinMinutes = 120, MaxMinutes = 240, Price = 60m, IsActive = true },
                new Tariff { Name = "4-8 saat", MinMinutes = 240, MaxMinutes = 480, Price = 80m, IsActive = true },
                new Tariff { Name = "8-24 saat", MinMinutes = 480, MaxMinutes = 1440, Price = 100m, IsActive = true });
            await db.SaveChangesAsync(ct);
        }

        if (!await db.Settings.AnyAsync(ct))
        {
            db.Settings.Add(new SystemSettings { Id = 1, SchemaVersion = SchemaInfo.CurrentVersion, UpdatedAt = now });
            await db.SaveChangesAsync(ct);
        }

        if (!await db.DisabledPermits.AnyAsync(ct))
        {
            var driverId = await db.Users.AsNoTracking()
                .Where(u => u.Email == "surucu@otopark.local")
                .Select(u => (int?)u.Id)
                .FirstOrDefaultAsync(ct);
            var adminEmail = "admin@otopark.local";

            db.DisabledPermits.AddRange(
                // Sürücünün ikinci aracı: onaylı engelli izni (1 yıl geçerli)
                new DisabledPermit
                {
                    Plate = "06ENG061",
                    HolderName = "Ayşe Yılmaz",
                    UserId = driverId,
                    DocumentNo = "EK-2026-0001",
                    Status = PermitStatus.Approved,
                    ValidUntil = now.AddYears(1),
                    Note = "Örnek (seed) onaylı izin",
                    CreatedAt = now,
                    ReviewedAt = now,
                    ReviewedBy = adminEmail
                },
                // Yönetici listesinde görünsün diye bekleyen başvuru (kullanıcıya bağlı değil)
                new DisabledPermit
                {
                    Plate = "34ENG034",
                    HolderName = "Mehmet Demir",
                    UserId = null,
                    DocumentNo = "EK-2026-0002",
                    Status = PermitStatus.Pending,
                    Note = "Örnek (seed) bekleyen başvuru",
                    CreatedAt = now
                });
            await db.SaveChangesAsync(ct);
        }
    }
}

/// <summary>
/// Seed otoparklarının krokileri (sözleşme 11.6). Koordinatlar her otoparkın kendi tuvalindedir.
/// Sıralar yollara bakar (sıra çiftleri arasında yol); engelli cepler normal cepten %40 daha geniştir
/// (GAZI hariç: görüntü servisi ve eski kroki uyumu için eski koordinatlar AYNEN korunur).
/// </summary>
public static partial class LotLayouts
{
    /// <summary>Sıradaki cepler arası boşluk (px).</summary>
    public const int SlotGap = 6;

    /// <summary>Engelli cep genişlik çarpanı.</summary>
    public const double DisabledWidthFactor = 1.4;

    /// <summary>
    /// Bir cep sırası üretir. Cepler (x, y)'den başlayarak sağa dizilir; engelli indekslerindeki (0 tabanlı)
    /// cepler %40 daha geniş çizilir ve sonraki ceplerin x'i buna göre kayar.
    /// Dönen değer: sıranın bittiği x (son cebin sağ kenarı).
    /// </summary>
    public static int Row(
        Zone zone,
        Func<int, string> code,
        int firstNumber,
        int count,
        int x,
        int y,
        int slotWidth,
        int slotHeight,
        ISet<int>? disabledIndices,
        DateTime now,
        bool widenDisabled = true,
        int gap = SlotGap)
    {
        var cursor = x;
        var right = x;
        for (var i = 0; i < count; i++)
        {
            var isDisabled = disabledIndices != null && disabledIndices.Contains(i);
            var width = isDisabled && widenDisabled
                ? (int)Math.Round(slotWidth * DisabledWidthFactor, MidpointRounding.AwayFromZero)
                : slotWidth;
            zone.Slots.Add(new ParkingSlot
            {
                Code = code(firstNumber + i),
                Type = isDisabled ? SlotType.Disabled : SlotType.Standard,
                IsActive = true,
                IsOccupied = false,
                UpdatedAt = now,
                MapX = cursor,
                MapY = y,
                MapW = width,
                MapH = slotHeight
            });
            right = cursor + width;
            cursor = right + gap;
        }
        return right;
    }

    private static HashSet<int> Indices(params int[] values) => new(values);

    /// <summary>Süs öğesi. floor verilirse yalnızca o katta çizilir (katlı otopark), null ise tüm katlarda.</summary>
    private static MapDecorDto D(string type, int x, int y, int w, int h, string? text = null, int? floor = null) =>
        new(type, x, y, w, h, text, floor);

    private static ParkingLot NewLot(string code, string name, string address, string description, int width, int height,
        List<FloorDto> floors, DateTime now) =>
        new()
        {
            Code = code,
            Name = name,
            Address = address,
            Description = description,
            MapWidth = width,
            MapHeight = height,
            FloorsJson = LotJson.Serialize(floors),
            IsActive = true,
            CreatedAt = now
        };

    /// <summary>Tüm ceplerin tuvale sığdığını denetler (taşma varsa seed başarısız olur — geliştirici hatası).</summary>
    private static ParkingLot Finish(ParkingLot lot, List<MapDecorDto> decor)
    {
        foreach (var slot in lot.Zones.SelectMany(z => z.Slots))
        {
            if (slot.MapX < 0 || slot.MapY < 0 || slot.MapX + slot.MapW > lot.MapWidth || slot.MapY + slot.MapH > lot.MapHeight)
                throw new InvalidOperationException(
                    $"Seed kroki hatası: {lot.Code}/{slot.Code} tuvalin dışına taşıyor ({slot.MapX},{slot.MapY},{slot.MapW},{slot.MapH}).");
        }
        foreach (var d in decor)
        {
            if (d.X < 0 || d.Y < 0 || d.X + d.W > lot.MapWidth || d.Y + d.H > lot.MapHeight)
                throw new InvalidOperationException($"Seed kroki hatası: {lot.Code} süsü ({d.Type} {d.Text}) tuvalin dışına taşıyor.");
            if (d.Points is { } points && (points.Count < 3 || points.Any(p =>
                    p.X < 0 || p.X > lot.MapWidth || p.Y < 0 || p.Y > lot.MapHeight)))
                throw new InvalidOperationException($"Seed kroki hatası: {lot.Code}/{d.Type} çokgeni geçersiz.");
        }
        lot.DecorJson = LotJson.Serialize(decor);
        return lot;
    }

    // ------------------------------------------------------------------
    // GAZI — pilot alan (1000×600). Eski kodlar ve koordinatlar AYNEN korunur:
    // A/B/C sıraları y=60/260/460, cep 80×120, x = 60 + (i-1)×88. A01, A02 engelli (girişe en yakın).
    // ------------------------------------------------------------------
    public static ParkingLot Gazi(DateTime now)
    {
        var lot = NewLot("GAZI", "Gazi Teknoloji Fakültesi Otoparkı (pilot)",
            "Gazi Üniversitesi Teknoloji Fakültesi, Yenimahalle / Ankara",
            "Pilot alan: 3 bölge, 28 cep. Görüntü işleme servisinin doluluk kamerası bu otoparkı izler.",
            1000, 600, new List<FloorDto> { new(0, "Zemin") }, now);

        var a = new Zone { Code = "A", Name = "A Bölgesi – Giriş Yanı", Floor = 0 };
        var b = new Zone { Code = "B", Name = "B Bölgesi – Orta", Floor = 0 };
        var c = new Zone { Code = "C", Name = "C Bölgesi – Arka", Floor = 0 };
        // Eski krokiyle birebir aynı: aralık 88 − 80 = 8 px, engelli cepler genişletilmez
        Row(a, i => $"A{i:00}", 1, 10, 60, 60, 80, 120, Indices(0, 1), now, widenDisabled: false, gap: 8);
        Row(b, i => $"B{i:00}", 1, 10, 60, 260, 80, 120, null, now, widenDisabled: false, gap: 8);
        Row(c, i => $"C{i:00}", 1, 8, 60, 460, 80, 120, null, now, widenDisabled: false, gap: 8);
        lot.Zones.AddRange(new[] { a, b, c });

        var decor = new List<MapDecorDto>
        {
            D("road", 0, 180, 1000, 80, "Ana yol"),
            D("road", 0, 380, 1000, 80, "İç yol"),
            D("entry", 4, 195, 50, 50, "Giriş"),
            D("exit", 946, 395, 50, 50, "Çıkış"),
            D("building", 780, 470, 210, 110, "Teknoloji Fakültesi"),
            D("label", 8, 100, 44, 40, "A"),
            D("label", 8, 300, 44, 40, "B"),
            D("label", 8, 500, 44, 40, "C")
        };
        return Finish(lot, decor);
    }

    // ------------------------------------------------------------------
    // MERKEZ — katlı otopark (1400×700, her kat aynı tuval). B1 (-1), ZM (0), K1 (1).
    // Her katta 2 sıra × 16 = 32 cep; asansör solda, asansöre en yakın 3 cep engelli
    // (1. sıranın ilk 2'si, 2. sıranın ilki).
    // ------------------------------------------------------------------
    public static ParkingLot Merkez(DateTime now)
    {
        var floors = new List<FloorDto> { new(-1, "B1 (Kat -1)"), new(0, "Zemin"), new(1, "Kat 1") };
        var lot = NewLot("MERKEZ", "Merkez Katlı Otopark",
            "Kızılay Meydanı yanı, Çankaya / Ankara",
            "3 katlı kapalı otopark. Engelli park yerleri her katta asansörün yanındadır.",
            1400, 700, floors, now);

        const int w = 64, h = 110, startX = 140, row1Y = 170, row2Y = 370;
        var specs = new[] { ("B1", "B1 – Kat -1", -1), ("ZM", "ZM – Zemin Kat", 0), ("K1", "K1 – Kat 1", 1) };
        foreach (var (code, name, floor) in specs)
        {
            var zone = new Zone { Code = code, Name = name, Floor = floor };
            var prefix = code;
            Row(zone, i => $"{prefix}-{i:00}", 1, 16, startX, row1Y, w, h, Indices(0, 1), now);
            Row(zone, i => $"{prefix}-{i:00}", 17, 16, startX, row2Y, w, h, Indices(0), now);
            lot.Zones.Add(zone);
        }

        var decor = new List<MapDecorDto>
        {
            D("road", 0, 40, 1400, 90, "Rampa / katlar arası geçiş"),
            D("road", 130, 282, 1270, 86, "Ana koridor"),
            D("entry", 1324, 287, 70, 36, "Giriş"),
            D("exit", 1324, 327, 70, 36, "Çıkış"),
            D("elevator", 30, 282, 90, 86, "Asansör"),
            D("building", 30, 170, 90, 108, "Merdiven"),
            D("building", 30, 372, 90, 108, "WC / Ödeme"),
            D("label", 140, 136, 260, 30, "1. sıra (01–16)"),
            D("label", 140, 486, 260, 30, "2. sıra (17–32)"),
            D("label", 140, 560, 700, 40, "Her kat aynı düzende: B1 (Kat -1), ZM (Zemin), K1 (Kat 1)")
        };
        // Kat bazlı süsler (yalnızca ilgili katta çizilir)
        decor.Add(D("label", 900, 560, 460, 40, "B1 – Kat -1 (otopark girişi rampadan)", floor: -1));
        decor.Add(D("label", 900, 560, 460, 40, "ZM – Zemin kat (cadde girişi)", floor: 0));
        decor.Add(D("label", 900, 560, 460, 40, "K1 – Kat 1 (AVM köprüsü)", floor: 1));
        decor.Add(D("green", 900, 620, 460, 50, "Zemin: yeşil alan", floor: 0));
        return Finish(lot, decor);
    }

    // ------------------------------------------------------------------
    // AVM — açık otopark (1600×1000). AVM binası solda. Bölgeler 2 sütun × 3 bant:
    // sol sütun (binaya yakın) A, B, C; sağ sütun D, E, F. Her bölge 2 sıra × 12 = 24 cep, sıralar arasında yol.
    // Engelli: A ve B'nin binaya bakan uçları (1. sıranın ilk 3'ü + 2. sıranın ilk 2'si) = 10 cep.
    // ------------------------------------------------------------------
    public static ParkingLot Avm(DateTime now)
    {
        var lot = NewLot("AVM", "Çarşı AVM Açık Otopark",
            "Çarşı AVM, Eskişehir Yolu / Ankara",
            "6 bölge, 144 cep. Engelli park yerleri AVM girişine en yakın A ve B bölgelerindedir.",
            1600, 1000, new List<FloorDto> { new(0, "Zemin") }, now);

        const int w = 44, h = 90, roadH = 80;
        int[] columnX = { 240, 940 };
        int[] bandY = { 60, 360, 660 };
        var zoneSpecs = new[]
        {
            ("A", "A Bölgesi – AVM Girişi", 0, 0, true),
            ("B", "B Bölgesi – AVM Yanı", 0, 1, true),
            ("C", "C Bölgesi – Sinema Girişi", 0, 2, false),
            ("D", "D Bölgesi – Market Tarafı", 1, 0, false),
            ("E", "E Bölgesi – Orta", 1, 1, false),
            ("F", "F Bölgesi – Arka", 1, 2, false)
        };

        var decor = new List<MapDecorDto>
        {
            D("building", 20, 60, 160, 860, "Çarşı AVM"),
            D("road", 185, 8, 1410, 44, "Servis yolu"),
            D("road", 185, 930, 1410, 60, "Ana yol"),
            D("road", 185, 52, 50, 878, null),
            D("road", 892, 52, 44, 878, null),
            D("road", 1540, 52, 55, 878, null),
            D("entry", 1535, 935, 60, 50, "Giriş"),
            D("exit", 1535, 4, 60, 48, "Çıkış")
        };

        foreach (var (code, name, col, band, hasDisabled) in zoneSpecs)
        {
            var zone = new Zone { Code = code, Name = name, Floor = 0 };
            var x = columnX[col];
            var y = bandY[band];
            var prefix = code;
            Row(zone, i => $"{prefix}-{i:00}", 1, 12, x, y, w, h, hasDisabled ? Indices(0, 1, 2) : null, now);
            Row(zone, i => $"{prefix}-{i:00}", 13, 12, x, y + h + roadH, w, h, hasDisabled ? Indices(0, 1) : null, now);
            lot.Zones.Add(zone);

            decor.Add(D("road", x, y + h, col == 0 ? 652 : 600, roadH, null));
            decor.Add(D("label", x + 4, y + h + 20, 40, 40, code));
        }

        // Bantlar arası yeşil alan
        decor.Add(D("green", 240, 320, 1295, 40, null));
        decor.Add(D("green", 240, 620, 1295, 40, null));
        return Finish(lot, decor);
    }

    // ------------------------------------------------------------------
    // HASTANE — 1200×800. Hastane binası üstte, önünde ambulans/bırakma yolu.
    // P (Poliklinik, 2 sıra × 10) ve A (Acil, 2 sıra × 6) binaya bakar; Z (Ziyaretçi, 2 sıra × 14) arkada.
    // Engelli: P01–P06 ve A01–A04 (hastane binası yanında) = 10 cep.
    // ------------------------------------------------------------------
    public static ParkingLot Hastane(DateTime now)
    {
        var lot = NewLot("HASTANE", "Şehir Hastanesi Otoparkı",
            "Ankara Şehir Hastanesi, Çankaya / Ankara",
            "Poliklinik, acil ve ziyaretçi bölgeleri; 60 cep. Engelli yerleri hastane binasının hemen önündedir.",
            1200, 800, new List<FloorDto> { new(0, "Zemin") }, now);

        const int w = 50, h = 90;
        var p = new Zone { Code = "P", Name = "P – Poliklinik", Floor = 0 };
        var a = new Zone { Code = "A", Name = "A – Acil", Floor = 0 };
        var z = new Zone { Code = "Z", Name = "Z – Ziyaretçi", Floor = 0 };

        Row(p, i => $"P{i:00}", 1, 10, 30, 215, w, h, Indices(0, 1, 2, 3, 4, 5), now);
        Row(p, i => $"P{i:00}", 11, 10, 30, 395, w, h, null, now);
        Row(a, i => $"A{i:00}", 1, 6, 780, 215, w, h, Indices(0, 1, 2, 3), now);
        Row(a, i => $"A{i:00}", 7, 6, 780, 395, w, h, null, now);
        Row(z, i => $"Z{i:00}", 1, 14, 30, 525, w, h, null, now);
        Row(z, i => $"Z{i:00}", 15, 14, 30, 705, w, h, null, now);
        lot.Zones.AddRange(new[] { p, a, z });

        var decor = new List<MapDecorDto>
        {
            D("building", 30, 20, 1140, 110, "Şehir Hastanesi (Poliklinik / Acil girişi)"),
            D("road", 0, 140, 1200, 70, "Ambulans ve bırakma yolu"),
            D("road", 0, 310, 1200, 80, "İç yol"),
            D("road", 714, 210, 60, 280, null),
            D("green", 0, 490, 1200, 30, null),
            D("road", 0, 620, 1200, 80, "Ziyaretçi yolu"),
            D("entry", 1120, 625, 70, 70, "Giriş"),
            D("exit", 1120, 145, 70, 60, "Çıkış"),
            D("label", 30, 330, 220, 40, "P – Poliklinik"),
            D("label", 780, 330, 160, 40, "A – Acil"),
            D("label", 840, 640, 220, 40, "Z – Ziyaretçi")
        };
        return Finish(lot, decor);
    }
}
