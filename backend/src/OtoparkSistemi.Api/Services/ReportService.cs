using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>
/// UC-10 doluluk ve UC-11 gelir raporları.
/// Veri çekildikten sonra hesaplar bellekte yapılır (SQLite'ta decimal toplama / tarih farkı çevrilemediği için).
/// Saat/gün gruplaması Türkiye saatine (UTC+3) göredir.
/// lot parametresi verilirse yalnızca o otopark, verilmezse tüm otoparklar raporlanır.
/// </summary>
public class ReportService(AppDbContext db, TimeProvider clock)
{
    public const int MaxRangeDays = 366;
    public const int DefaultRangeDays = 30;

    public async Task<OccupancyReportDto> GetOccupancyAsync(DateTime? from, DateTime? to, string? lotCode = null, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        var (fromUtc, toUtc) = ResolveRange(from, to, now);
        var lotId = await ResolveLotIdAsync(lotCode, ct);

        var slotQuery = db.ParkingSlots.AsNoTracking().Where(s => s.IsActive);
        if (lotId.HasValue)
        {
            var id = lotId.Value;
            slotQuery = slotQuery.Where(s => s.Zone!.LotId == id);
        }
        var totalSlots = await slotQuery.CountAsync(ct);

        var sessionQuery = db.ParkingSessions.AsNoTracking()
            .Where(s => s.EntryTime < toUtc && (s.ExitTime == null || s.ExitTime > fromUtc));
        if (lotId.HasValue)
        {
            var id = lotId.Value;
            sessionQuery = sessionQuery.Where(s => s.LotId == id);
        }
        var raw = await sessionQuery
            .Select(s => new { s.EntryTime, s.ExitTime })
            .ToListAsync(ct);

        var sessions = raw.Select(s => (Entry: s.EntryTime, Exit: s.ExitTime)).ToList();
        var entries = sessions
            .Where(s => s.Entry >= fromUtc)
            .Select(s => (Local: TurkeyTime.ToLocal(s.Entry), s.Entry, s.Exit))
            .ToList();

        var days = LocalDays(fromUtc, toUtc);

        var hourly = new List<HourlyOccupancyDto>(24);
        for (var hour = 0; hour < 24; hour++)
        {
            var h = hour;
            var count = entries.Count(e => e.Local.Hour == h);
            var rates = new List<double>();
            if (totalSlots > 0)
            {
                foreach (var day in days)
                {
                    // Her günün ilgili saatinin ortasında (hh:30) içerideki araç sayısı örneklenir
                    var sampleUtc = TurkeyTime.ToUtc(day.AddHours(h).AddMinutes(30));
                    if (sampleUtc < fromUtc || sampleUtc >= toUtc || sampleUtc > now) continue;
                    var inside = sessions.Count(s => s.Entry <= sampleUtc && (s.Exit ?? now) > sampleUtc);
                    rates.Add(Math.Min(1d, (double)inside / totalSlots));
                }
            }
            var avgRate = rates.Count == 0 ? 0d : Math.Round(rates.Average(), 3);
            hourly.Add(new HourlyOccupancyDto(h, count, avgRate));
        }

        var daily = new List<DailyOccupancyDto>(days.Count);
        foreach (var day in days)
        {
            var d = day;
            var dayItems = entries.Where(e => e.Local.Date == d).ToList();
            int? peak = dayItems.Count == 0
                ? null
                : dayItems.GroupBy(e => e.Local.Hour)
                    .OrderByDescending(g => g.Count())
                    .ThenBy(g => g.Key)
                    .First().Key;
            daily.Add(new DailyOccupancyDto(
                d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                dayItems.Count,
                AverageDuration(dayItems.Select(x => (x.Entry, x.Exit))),
                peak));
        }

        return new OccupancyReportDto(
            fromUtc,
            toUtc,
            entries.Count,
            AverageDuration(entries.Select(x => (x.Entry, x.Exit))),
            hourly,
            daily);
    }

    public async Task<RevenueReportDto> GetRevenueAsync(DateTime? from, DateTime? to, string? groupBy, string? lotCode = null, CancellationToken ct = default)
    {
        var mode = (groupBy ?? "day").Trim().ToLowerInvariant();
        if (mode != "day" && mode != "week" && mode != "month")
            throw AppException.BadRequest("groupBy değeri day, week veya month olmalıdır.");

        var now = clock.GetUtcNow().UtcDateTime;
        var (fromUtc, toUtc) = ResolveRange(from, to, now);
        var lotId = await ResolveLotIdAsync(lotCode, ct);

        var paymentQuery = db.Payments.AsNoTracking()
            .Where(p => p.Status == PaymentStatus.Success && p.CreatedAt >= fromUtc && p.CreatedAt < toUtc);
        if (lotId.HasValue)
        {
            // Oturum ödemesi oturumun otoparkına, rezervasyon ön ödemesi rezervasyonun bölgesinin otoparkına sayılır
            var id = lotId.Value;
            paymentQuery = paymentQuery.Where(p =>
                (p.Session != null && p.Session.LotId == id)
                || (p.Reservation != null && p.Reservation.Zone != null && p.Reservation.Zone.LotId == id));
        }
        var payments = await paymentQuery
            .Select(p => new { p.Amount, p.Method, p.CreatedAt })
            .ToListAsync(ct);

        var total = payments.Sum(p => p.Amount);
        var count = payments.Count;
        var average = count == 0 ? 0m : Math.Round(total / count, 2, MidpointRounding.AwayFromZero);

        string KeyOf(DateTime local) => mode switch
        {
            "week" => StartOfWeek(local).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            "month" => local.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            _ => local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        };

        // Boş dönemler de 0 ile listelenir (grafik sürekliliği için)
        var periods = new List<string>();
        foreach (var day in LocalDays(fromUtc, toUtc))
        {
            var key = KeyOf(day);
            if (!periods.Contains(key)) periods.Add(key);
        }

        var grouped = payments
            .GroupBy(p => KeyOf(TurkeyTime.ToLocal(p.CreatedAt)))
            .ToDictionary(g => g.Key, g => (Amount: g.Sum(x => x.Amount), Count: g.Count()));

        var series = periods
            .Select(k => grouped.TryGetValue(k, out var v)
                ? new RevenueSeriesDto(k, v.Amount, v.Count)
                : new RevenueSeriesDto(k, 0m, 0))
            .ToList();

        var byMethod = new[] { PaymentMethod.Card, PaymentMethod.Cash }
            .Select(m => new RevenueByMethodDto(m, payments.Where(p => p.Method == m).Sum(p => p.Amount)))
            .ToList();

        return new RevenueReportDto(fromUtc, toUtc, total, count, average, series, byMethod);
    }

    // ---------------- yardımcılar ----------------

    /// <summary>Kod boşsa null (tüm otoparklar); bilinmeyen kod → 404 "Otopark bulunamadı".</summary>
    private async Task<int?> ResolveLotIdAsync(string? lotCode, CancellationToken ct)
    {
        var code = LotDefaults.NormalizeOptional(lotCode);
        if (code == null) return null;
        var id = await db.ParkingLots.AsNoTracking()
            .Where(l => l.Code == code)
            .Select(l => (int?)l.Id)
            .FirstOrDefaultAsync(ct);
        return id ?? throw AppException.NotFound("Otopark bulunamadı");
    }

    private static double AverageDuration(IEnumerable<(DateTime Entry, DateTime? Exit)> items)
    {
        var durations = items
            .Where(i => i.Exit.HasValue)
            .Select(i => (i.Exit!.Value - i.Entry).TotalMinutes)
            .ToList();
        return durations.Count == 0 ? 0d : Math.Round(durations.Average(), 1);
    }

    private static List<DateTime> LocalDays(DateTime fromUtc, DateTime toUtc)
    {
        var first = TurkeyTime.ToLocal(fromUtc).Date;
        var last = TurkeyTime.ToLocal(toUtc.AddTicks(-1)).Date;
        var days = new List<DateTime>();
        for (var d = first; d <= last; d = d.AddDays(1)) days.Add(d);
        return days;
    }

    private static DateTime StartOfWeek(DateTime local)
    {
        var diff = ((int)local.DayOfWeek + 6) % 7; // Pazartesi = 0
        return local.Date.AddDays(-diff);
    }

    /// <summary>
    /// from/to: verilmezse son 30 gün. Saat dilimi belirtilmemiş değerler Türkiye saati kabul edilir;
    /// yalnızca tarih verilen "to" o günü kapsar (ertesi gün 00:00'a kadar).
    /// </summary>
    private static (DateTime From, DateTime To) ResolveRange(DateTime? from, DateTime? to, DateTime nowUtc)
    {
        var toUtc = to.HasValue ? InputToUtc(to.Value, isEnd: true) : nowUtc;
        var fromUtc = from.HasValue ? InputToUtc(from.Value, isEnd: false) : toUtc.AddDays(-DefaultRangeDays);
        if (fromUtc >= toUtc)
            throw AppException.BadRequest("Başlangıç tarihi bitiş tarihinden önce olmalıdır.");
        if ((toUtc - fromUtc).TotalDays > MaxRangeDays)
            throw AppException.BadRequest($"Rapor aralığı en fazla {MaxRangeDays} gün olabilir.");
        return (fromUtc, toUtc);
    }

    private static DateTime InputToUtc(DateTime value, bool isEnd)
    {
        switch (value.Kind)
        {
            case DateTimeKind.Utc:
                return value;
            case DateTimeKind.Local:
                return value.ToUniversalTime();
            default:
                var local = isEnd && value.TimeOfDay == TimeSpan.Zero ? value.AddDays(1) : value;
                return TurkeyTime.ToUtc(local);
        }
    }
}
