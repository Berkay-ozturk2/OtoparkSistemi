using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Data;

public static partial class LotLayouts
{
    internal sealed record ReferenceLot(string Code, ParkingSiteReferenceDto Source, Func<DateTime, ParkingLot> Build);

    internal static IReadOnlyList<ReferenceLot> ReferenceLots { get; } =
    [
        new("AKARBASI", new("Eskişehir Büyükşehir Belediyesi",
            "https://www.eskisehir.bel.tr/icerik-detay.php?cat_icerik=1&icerik_id=12290&menu_id=24"), Akarbasi),
        new("MAHMUDIYE", new("İnegöl Belediyesi",
            "https://inegol.bel.tr/haber/genel/mahmudiye-de-46-araclik-otopark-hizmete-girdi"), Mahmudiye),
        new("ERTUGRULGAZI", new("İnegöl Belediyesi",
            "https://inegol.bel.tr/haber/belediye-calismalari/ertugrulgazi-mahallesinde-43-araclik-otopark-hizmete-girdi"),
            Ertugrulgazi)
    ];

    internal static ParkingSiteReferenceDto? SiteReference(string code) =>
        ReferenceLots.FirstOrDefault(lot => lot.Code == code)?.Source;

    private static ParkingLot Akarbasi(DateTime now)
    {
        var lot = NewLot("AKARBASI", "Akarbaşı Açık Otoparkı",
            "Atatürk Bulvarı ve Şehit Güngören Bostan Sokak kesişimi, Odunpazarı / Eskişehir",
            "Eskişehir Büyükşehir Belediyesinin hava fotoğrafındaki karşılıklı iki sıra ve çevre yolu esas alındı.",
            1200, 578, [new(0, "Zemin")], now);
        var a = new Zone { Code = "A", Name = "İç sıra" };
        var b = new Zone { Code = "B", Name = "Sokak tarafı" };
        Row(a, i => $"A{i:00}", 1, 20, 146, 202, 41, 89, Indices(0), now, gap: 5);
        Row(b, i => $"B{i:00}", 1, 20, 146, 306, 41, 89, null, now, gap: 5);
        lot.Zones.AddRange([a, b]);

        return Finish(lot,
        [
            D("island", 63, 27, 1074, 58, "Atatürk Bulvarı yönü"),
            D("surface", 63, 105, 1074, 388),
            D("walkway", 140, 119, 920, 19),
            D("walkway", 140, 293, 920, 11),
            D("walkway", 214, 467, 772, 22),
            D("road", 0, 504, 1200, 66, "Şehit Güngören Bostan Sokak"),
            D("access", 63, 471, 150, 30, "Araç bağlantısı"),
            D("access", 987, 471, 150, 30, "Araç bağlantısı"),
            D("label", 98, 225, 34, 34, "A"),
            D("label", 98, 337, 34, 34, "B")
        ]);
    }

    private static ParkingLot Mahmudiye(DateTime now)
    {
        var lot = NewLot("MAHMUDIYE", "Mahmudiye Mahalle Otoparkı",
            "Fethiye Çıkmazı ve Pehlivan Sokak arası, İnegöl / Bursa",
            "Konutlar arasındaki dar bağlantı ve doğudaki geniş park avlusu belediyenin hava fotoğrafına göre sadeleştirildi.",
            1200, 710, [new(0, "Zemin")], now);
        var a = new Zone { Code = "A", Name = "Bağlantı koridoru" };
        var b = new Zone { Code = "B", Name = "Park avlusu" };
        Row(a, i => $"A{i:00}", 1, 14, 112, 258, 35, 81, null, now);
        Row(a, i => $"A{i:00}", 15, 11, 135, 439, 35, 81, null, now);
        Row(b, i => $"B{i:00}", 1, 6, 718, 196, 43, 81, null, now);
        Row(b, i => $"B{i:00}", 7, 7, 728, 558, 35, 81, null, now);
        for (var i = 0; i < 8; i++)
        {
            b.Slots.Add(new ParkingSlot
            {
                Code = $"B{i + 14:00}",
                Type = SlotType.Standard,
                IsActive = true,
                UpdatedAt = now,
                MapX = 1034,
                MapY = 253 + i * 44,
                MapW = 90,
                MapH = 37
            });
        }
        lot.Zones.AddRange([a, b]);

        return Finish(lot,
        [
            Polygon("surface", (61, 230), (696, 230), (696, 165), (1145, 165), (1145, 656),
                (696, 656), (696, 549), (61, 549)),
            D("road", 0, 119, 66, 470),
            D("road", 687, 657, 476, 48, "Pehlivan Sokak"),
            D("building", 105, 106, 240, 100, "Konutlar"),
            D("green", 362, 124, 302, 82),
            D("building", 774, 47, 351, 104, "Konutlar"),
            D("building", 126, 562, 252, 102, "Konutlar"),
            D("green", 398, 562, 253, 102),
            D("walkway", 112, 240, 550, 13),
            D("walkway", 136, 524, 442, 13),
            D("walkway", 717, 176, 291, 13),
            D("access", 12, 360, 175, 31, "Fethiye Çıkmazı"),
            D("access", 1016, 616, 130, 30, "Bağlantı"),
            D("label", 348, 375, 37, 37, "A"),
            D("label", 877, 414, 37, 37, "B")
        ]);
    }

    private static ParkingLot Ertugrulgazi(DateTime now)
    {
        var lot = NewLot("ERTUGRULGAZI", "Ertuğrulgazi Mahalle Otoparkı",
            "Zincirlikuyu Caddesi ve Tunç Sokak arası, İnegöl / Bursa",
            "Yağlı Tohumlar Kavşağı yanındaki eğimli parsel sınırı, kaldırım ve üçgen ada hava fotoğrafından yorumlandı.",
            1390, 636, [new(0, "Zemin")], now);
        var a = new Zone { Code = "A", Name = "Tunç Sokak tarafı" };
        var b = new Zone { Code = "B", Name = "Cadde tarafı" };
        Row(a, i => $"A{i:00}", 1, 10, 180, 230, 45, 79, null, now);
        Row(a, i => $"A{i:00}", 11, 10, 180, 365, 45, 79, null, now);
        Row(b, i => $"B{i:00}", 1, 4, 718, 230, 45, 79, null, now);
        Row(b, i => $"B{i:00}", 5, 11, 718, 318, 45, 75, null, now);
        Row(b, i => $"B{i:00}", 16, 8, 873, 428, 45, 75, null, now);
        lot.Zones.AddRange([a, b]);

        return Finish(lot,
        [
            Polygon("surface", (89, 230), (245, 118), (1240, 258), (1350, 392), (1310, 534),
                (96, 534)),
            Polygon("walkway", (111, 512), (1292, 512), (1305, 535), (105, 535)),
            Polygon("walkway", (241, 124), (1236, 264), (1254, 281), (222, 139)),
            Polygon("island", (683, 504), (744, 414), (853, 492), (853, 504)),
            D("road", 0, 548, 1390, 81, "Zincirlikuyu Caddesi"),
            D("road", 13, 155, 74, 390),
            D("building", 115, 31, 184, 73, "Konutlar"),
            D("building", 436, 65, 220, 71, "Konutlar"),
            D("building", 810, 117, 235, 70, "Konutlar"),
            D("access", 44, 252, 122, 30, "Tunç Sokak"),
            D("access", 1210, 517, 146, 30, "Araç bağlantısı"),
            D("label", 295, 320, 34, 34, "A"),
            D("label", 966, 276, 34, 34, "B")
        ]);
    }

    private static MapDecorDto Polygon(string type, params (int X, int Y)[] points)
    {
        var x = points.Min(p => p.X);
        var y = points.Min(p => p.Y);
        return new MapDecorDto(type, x, y, points.Max(p => p.X) - x, points.Max(p => p.Y) - y, null,
            Points: points.Select(p => new MapPointDto(p.X, p.Y)).ToList());
    }
}
