using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>
/// Rapor ekranları için son 30 güne ait gerçekçi örnek veri üretir
/// (sabah 08-10 ve akşam 17-19 pikli girişler, kart/nakit ödemeler, açık ve terk edilmiş oturumlar).
/// Oturumlar aktif otoparklara dağıtılır (her otopark için ayrı günlük giriş sayısı, kapasiteyle orantılı).
/// Yalnızca /api/admin/demo-data ile çağrılır; uygulama açılışında otomatik çalışmaz.
/// </summary>
public class DemoDataService(AppDbContext db, ParkingService parking, TimeProvider clock)
{
    // Saat bazında giriş ağırlıkları (Türkiye saati 00..23)
    private static readonly int[] HourWeights =
    {
        0, 0, 0, 0, 0, 1, 2, 6, 12, 12, 6, 5, 6, 6, 5, 5, 6, 11, 12, 9, 5, 3, 2, 1
    };

    private const string PlateLetters = "ABCDEFGHJKLMNPRSTUVYZ";

    public async Task<DemoDataResultDto> GenerateAsync(CancellationToken ct = default)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var rnd = new Random();
        var lots = await db.ParkingLots.AsNoTracking()
            .Where(l => l.IsActive)
            .OrderBy(l => l.Id)
            .ToListAsync(ct);
        var lotIds = lots.Select(l => l.Id).ToList();
        var zones = await db.Zones.AsNoTracking()
            .Include(z => z.Slots)
            .Where(z => lotIds.Contains(z.LotId))
            .OrderBy(z => z.Code)
            .ToListAsync(ct);
        if (zones.Count == 0) throw AppException.BadRequest("Önce otopark/bölge/cep verisi oluşturulmalıdır.");

        // Otopark → bölgeleri ve kapasitesi (günlük giriş sayısı kapasiteyle orantılı)
        var lotZones = lots
            .Select(l => (Lot: l, Zones: zones.Where(z => z.LotId == l.Id).ToList()))
            .Where(x => x.Zones.Count > 0)
            .Select(x => (x.Lot, x.Zones, Capacity: x.Zones.Sum(z => z.Slots.Count(s => s.IsActive))))
            .ToList();

        var ctx = await parking.GetFeeContextAsync(ct);
        var settings = ctx.Settings;
        var todayLocal = TurkeyTime.ToLocal(now).Date;

        var sessions = new List<ParkingSession>();
        var payments = new List<Payment>();

        for (var offset = 30; offset >= 0; offset--)
        {
            var dayLocal = todayLocal.AddDays(-offset);
            var weekend = dayLocal.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            foreach (var (lot, lotZoneList, capacity) in lotZones)
            {
                // Pilot otopark (28 cep) için günde 25-45 giriş; diğerleri kapasiteyle orantılı
                var scale = Math.Max(0.5, capacity / 28d);
                var count = (int)(rnd.Next(25, 46) * Math.Min(scale, 3d));
                if (weekend) count = (int)(count * 0.6);

                for (var i = 0; i < count; i++)
                {
                    var hour = PickHour(rnd);
                    var entryLocal = dayLocal.AddHours(hour).AddMinutes(rnd.Next(60));
                    var entryUtc = TurkeyTime.ToUtc(entryLocal);
                    var exitUtc = entryUtc.AddMinutes(PickDurationMinutes(rnd));
                    if (exitUtc > now.AddMinutes(-5)) continue; // gelecekte biten oturum üretme

                    var fee = FeeCalculator.Calculate(exitUtc - entryUtc, ctx.Tariffs, settings.FreeMinutes, settings.DailyMaxFee);
                    DateTime? paidAt = fee > 0m ? exitUtc.AddMinutes(-rnd.Next(1, 10)) : null;
                    var session = new ParkingSession
                    {
                        Plate = RandomPlate(rnd),
                        LotId = lot.Id,
                        ZoneId = lotZoneList[rnd.Next(lotZoneList.Count)].Id,
                        EntryTime = entryUtc,
                        ExitTime = exitUtc,
                        Fee = fee,
                        PaidAmount = fee,
                        IsPaid = true,
                        PaidAt = paidAt,
                        Status = SessionStatus.Completed
                    };
                    sessions.Add(session);

                    if (fee > 0m && paidAt.HasValue)
                    {
                        var isCard = rnd.NextDouble() < 0.7;
                        payments.Add(new Payment
                        {
                            Session = session,
                            Amount = fee,
                            Method = isCard ? PaymentMethod.Card : PaymentMethod.Cash,
                            Status = PaymentStatus.Success,
                            Provider = isCard ? "Mock" : "Gise",
                            TransactionId = "DEMO-" + Guid.NewGuid().ToString("N").Substring(0, 12).ToUpperInvariant(),
                            CardLast4 = isCard ? "0008" : null,
                            Message = "Demo verisi",
                            CreatedAt = paidAt.Value
                        });
                    }
                }
            }
        }

        // Şu an içeride olan araçlar (her otoparkta birkaç tane)
        var activeCount = 0;
        foreach (var (lot, lotZoneList, capacity) in lotZones)
        {
            var perLot = Math.Min(Math.Max(2, capacity / 12), Math.Max(0, capacity - 2));
            for (var i = 0; i < perLot; i++)
            {
                sessions.Add(new ParkingSession
                {
                    Plate = RandomPlate(rnd),
                    LotId = lot.Id,
                    ZoneId = lotZoneList[rnd.Next(lotZoneList.Count)].Id,
                    EntryTime = now.AddMinutes(-rnd.Next(10, 300)),
                    Status = SessionStatus.Active
                });
                activeCount++;
            }
        }

        // Terk edilmiş (azami süreyi aşan) araçlar — rastgele otoparklarda
        var abandonedCount = 3;
        for (var i = 0; i < abandonedCount; i++)
        {
            var (lot, lotZoneList, _) = lotZones[rnd.Next(lotZones.Count)];
            sessions.Add(new ParkingSession
            {
                Plate = RandomPlate(rnd),
                LotId = lot.Id,
                ZoneId = lotZoneList[rnd.Next(lotZoneList.Count)].Id,
                EntryTime = now.AddHours(-(settings.AbandonedThresholdHours + rnd.Next(2, 49))),
                Status = SessionStatus.Active
            });
        }

        db.ParkingSessions.AddRange(sessions);
        db.Payments.AddRange(payments);
        await db.SaveChangesAsync(ct);

        var completed = sessions.Count - activeCount - abandonedCount;
        return new DemoDataResultDto(completed, payments.Count, activeCount, abandonedCount,
            $"{completed} tamamlanmış oturum, {payments.Count} ödeme, {activeCount} açık ve {abandonedCount} terk edilmiş oturum üretildi.");
    }

    private static int PickHour(Random rnd)
    {
        var total = HourWeights.Sum();
        var x = rnd.Next(total);
        for (var h = 0; h < HourWeights.Length; h++)
        {
            x -= HourWeights[h];
            if (x < 0) return h;
        }
        return 12;
    }

    private static int PickDurationMinutes(Random rnd)
    {
        var p = rnd.NextDouble();
        if (p < 0.15) return rnd.Next(5, 15);     // ücretsiz kısa duruş
        if (p < 0.55) return rnd.Next(20, 121);   // 20 dk - 2 saat
        if (p < 0.85) return rnd.Next(121, 301);  // 2 - 5 saat
        return rnd.Next(301, 601);                // 5 - 10 saat
    }

    private static string RandomPlate(Random rnd)
    {
        var city = rnd.Next(1, 82).ToString("00");
        var letterCount = rnd.Next(1, 4);
        var letters = new string(Enumerable.Range(0, letterCount).Select(_ => PlateLetters[rnd.Next(PlateLetters.Length)]).ToArray());
        var digitCount = letterCount switch
        {
            1 => 4,
            2 => rnd.Next(3, 5),
            _ => rnd.Next(2, 4)
        };
        var digits = new string(Enumerable.Range(0, digitCount).Select(_ => (char)('0' + rnd.Next(10))).ToArray());
        if (digits[0] == '0') digits = "1" + digits.Substring(1);
        return city + letters + digits;
    }
}
