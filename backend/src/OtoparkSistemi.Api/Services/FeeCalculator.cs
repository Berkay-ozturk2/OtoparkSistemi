using OtoparkSistemi.Api.Domain;

namespace OtoparkSistemi.Api.Services;

/// <summary>
/// Saf (yan etkisiz) ücret hesaplayıcı.
/// Kurallar:
///  - Süre (yukarı yuvarlanmış dakika) &lt;= freeMinutes ise ücretsiz.
///  - Aksi hâlde süreyi kapsayan aktif tarife dilimi uygulanır (MinMinutes &lt; dk &lt;= MaxMinutes).
///  - 24 saati aşan sürelerde her tam gün için dailyMaxFee + kalan sürenin dilim ücreti.
///  - Sonuç dailyMaxFee × (başlanan gün sayısı) tavanını geçmez.
/// </summary>
public static class FeeCalculator
{
    public const int MinutesPerDay = 1440;

    public static decimal Calculate(TimeSpan duration, IEnumerable<Tariff> tariffs, int freeMinutes, decimal dailyMaxFee)
    {
        if (duration <= TimeSpan.Zero) return 0m;

        var totalMinutes = (int)Math.Ceiling(duration.TotalMinutes);
        if (totalMinutes <= Math.Max(0, freeMinutes)) return 0m;

        var active = tariffs.Where(t => t.IsActive).OrderBy(t => t.MinMinutes).ToList();
        if (active.Count == 0) return 0m;

        var hasCap = dailyMaxFee > 0m;
        var fullDayFee = hasCap ? dailyMaxFee : SliceFee(MinutesPerDay, active);

        var fullDays = totalMinutes / MinutesPerDay;
        var remainder = totalMinutes % MinutesPerDay;

        var fee = fullDays * fullDayFee;
        if (remainder > 0)
        {
            var slice = SliceFee(remainder, active);
            fee += hasCap ? Math.Min(slice, dailyMaxFee) : slice;
        }

        if (hasCap)
        {
            var startedDays = (int)Math.Ceiling(totalMinutes / (double)MinutesPerDay);
            fee = Math.Min(fee, dailyMaxFee * startedDays);
        }

        return Math.Round(fee, 2, MidpointRounding.AwayFromZero);
    }

    /// <summary>Verilen dakikayı kapsayan dilimin ücreti. Kapsayan dilim yoksa en yakın üst (yoksa en uzun) dilim.</summary>
    private static decimal SliceFee(int minutes, List<Tariff> active)
    {
        var match = active.FirstOrDefault(t => minutes > t.MinMinutes && minutes <= t.MaxMinutes);
        if (match != null) return match.Price;

        var upper = active.Where(t => t.MaxMinutes >= minutes).OrderBy(t => t.MaxMinutes).FirstOrDefault();
        if (upper != null) return upper.Price;

        return active.OrderByDescending(t => t.MaxMinutes).First().Price;
    }
}
