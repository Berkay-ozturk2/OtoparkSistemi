using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

public class ReservationService(AppDbContext db, ParkingService parking, TimeProvider clock)
{
    public const int MaxDurationHours = 24;
    public const int MaxDaysAhead = 30;

    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    /// <summary>lotCode boşsa varsayılan otopark (GAZI); bilinmeyen otopark → 404. slotType boşsa Standard.</summary>
    public async Task<ReservationQuoteDto> QuoteAsync(string? lotCode, string? zoneCode, SlotType? slotType, DateTime startTime, DateTime endTime, CancellationToken ct = default)
    {
        var lot = await parking.ResolveLotAsync(lotCode, ct);
        var type = slotType ?? SlotType.Standard;
        var start = TimeHelper.AsUtc(startTime);
        var end = TimeHelper.AsUtc(endTime);
        var error = ValidateRange(start, end, Now);
        if (error != null) return new ReservationQuoteDto(0m, false, error);
        if (!lot.IsActive) return new ReservationQuoteDto(0m, false, "Bu otopark şu anda hizmet dışı.");

        var zone = await FindZoneAsync(lot.Id, zoneCode, ct);
        if (zone == null) return new ReservationQuoteDto(0m, false, "Bölge bulunamadı.");

        var amount = await CalculateAmountAsync(start, end, ct);
        var free = await AvailableCountAsync(zone.Id, type, start, end, ct);
        var kind = type == SlotType.Disabled ? "engelli park yeri" : "cep";
        return free > 0
            ? new ReservationQuoteDto(amount, true, $"{zone.Name} için seçilen aralıkta {free} {kind} ayrılabilir.")
            : new ReservationQuoteDto(amount, false, $"Seçilen zaman aralığında bu bölgede ayrılabilir {kind} kalmadı.");
    }

    public async Task<ReservationDto> CreateAsync(int userId, CreateReservationRequest req, CancellationToken ct = default)
    {
        var plate = PlateHelper.Normalize(req.Plate);
        if (!PlateHelper.IsValid(plate))
            throw AppException.BadRequest("Geçerli bir Türk plakası giriniz (ör. 34 ABC 123).");

        var start = TimeHelper.AsUtc(req.StartTime);
        var end = TimeHelper.AsUtc(req.EndTime);
        var error = ValidateRange(start, end, Now);
        if (error != null) throw AppException.BadRequest(error);

        var lot = await parking.ResolveLotAsync(req.LotCode, ct);
        if (!lot.IsActive) throw AppException.BadRequest("Bu otopark şu anda hizmet dışı.");
        var zone = await FindZoneAsync(lot.Id, req.ZoneCode, ct) ?? throw AppException.NotFound("Bölge bulunamadı.");
        var type = req.SlotType ?? SlotType.Standard;

        // Engelli park yeri yalnızca geçerli engelli izni olan plakaya ayrılabilir
        if (type == SlotType.Disabled && !await PermitRules.HasValidPermitAsync(db, plate, Now, ct))
            throw AppException.Forbidden("Engelli park yeri rezervasyonu için onaylı engelli izni gerekir");

        var plateOverlap = await db.Reservations.AnyAsync(r =>
            r.Plate == plate
            && (r.Status == ReservationStatus.PendingPayment || r.Status == ReservationStatus.Confirmed || r.Status == ReservationStatus.CheckedIn)
            && r.StartTime < end && r.EndTime > start, ct);
        if (plateOverlap)
            throw AppException.Conflict("Bu plaka için seçilen aralıkla çakışan bir rezervasyon zaten var.");

        if (await AvailableCountAsync(zone.Id, type, start, end, ct) <= 0)
            throw AppException.Conflict(type == SlotType.Disabled
                ? "Seçilen zaman aralığında bu bölgede ayrılabilir engelli park yeri kalmadı."
                : "Seçilen zaman aralığında bu bölgede ayrılabilir cep kalmadı.");

        var amount = await CalculateAmountAsync(start, end, ct);
        var reservation = new Reservation
        {
            UserId = userId,
            Plate = plate,
            ZoneId = zone.Id,
            Zone = zone,
            SlotType = type,
            StartTime = start,
            EndTime = end,
            Amount = amount,
            // Ücretsiz rezervasyon (saatlik ücret 0) doğrudan onaylanır
            Status = amount > 0m ? ReservationStatus.PendingPayment : ReservationStatus.Confirmed,
            CreatedAt = Now
        };
        db.Reservations.Add(reservation);
        await db.SaveChangesAsync(ct);
        return ToDto(reservation);
    }

    public async Task<List<ReservationDto>> GetMyAsync(int userId, CancellationToken ct = default)
    {
        var list = await db.Reservations.AsNoTracking()
            .Include(r => r.Zone).ThenInclude(z => z!.Lot)
            .Where(r => r.UserId == userId)
            .OrderByDescending(r => r.StartTime)
            .ToListAsync(ct);
        return list.Select(ToDto).ToList();
    }

    public async Task<ReservationDto> CancelAsync(int userId, int reservationId, CancellationToken ct = default)
    {
        var r = await db.Reservations.Include(x => x.Zone).ThenInclude(z => z!.Lot)
                    .FirstOrDefaultAsync(x => x.Id == reservationId && x.UserId == userId, ct)
                ?? throw AppException.NotFound("Rezervasyon bulunamadı.");

        if (r.Status != ReservationStatus.PendingPayment && r.Status != ReservationStatus.Confirmed)
            throw AppException.BadRequest("Bu rezervasyon iptal edilemez (durum: " + r.Status + ").");

        r.Status = ReservationStatus.Cancelled;
        await db.SaveChangesAsync(ct);
        return ToDto(r);
    }

    /// <summary>Otopark bilgisi için r.Zone.Lot yüklenmiş olmalıdır.</summary>
    public static ReservationDto ToDto(Reservation r) =>
        new(r.Id, r.Plate, r.Zone?.Lot?.Code, r.Zone?.Lot?.Name, r.Zone?.Code ?? string.Empty, r.Zone?.Name ?? string.Empty,
            r.SlotType, r.StartTime, r.EndTime, r.Amount, r.Status, r.CreatedAt);

    // ---------------- yardımcılar ----------------

    private static string? ValidateRange(DateTime start, DateTime end, DateTime now)
    {
        if (end <= start) return "Bitiş zamanı başlangıçtan sonra olmalıdır.";
        if (start < now.AddMinutes(-5)) return "Geçmiş bir zaman için rezervasyon yapılamaz.";
        if (start > now.AddDays(MaxDaysAhead)) return $"En fazla {MaxDaysAhead} gün sonrası için rezervasyon yapılabilir.";
        if ((end - start).TotalHours > MaxDurationHours) return $"Rezervasyon süresi en fazla {MaxDurationHours} saat olabilir.";
        return null;
    }

    /// <summary>Bölge kodu otopark içinde benzersizdir.</summary>
    private async Task<Zone?> FindZoneAsync(int lotId, string? zoneCode, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(zoneCode)) return null;
        var code = zoneCode.Trim().ToUpperInvariant();
        return await db.Zones.Include(z => z.Lot).FirstOrDefaultAsync(z => z.LotId == lotId && z.Code == code, ct);
    }

    /// <summary>Saat başı ücret × yukarı yuvarlanmış saat.</summary>
    private async Task<decimal> CalculateAmountAsync(DateTime start, DateTime end, CancellationToken ct)
    {
        var settings = await parking.GetSettingsAsync(ct);
        var hours = Math.Max(1, (int)Math.Ceiling((end - start).TotalHours));
        return hours * settings.ReservationHourlyPrice;
    }

    /// <summary>
    /// Bölgenin ilgili türdeki (Standard / Disabled) kullanımdaki cep sayısı − aynı türde çakışan
    /// (PendingPayment/Confirmed/CheckedIn) rezervasyon sayısı.
    /// </summary>
    private async Task<int> AvailableCountAsync(int zoneId, SlotType type, DateTime start, DateTime end, CancellationToken ct)
    {
        var capacity = await db.ParkingSlots.CountAsync(s => s.ZoneId == zoneId && s.IsActive && s.Type == type, ct);
        var overlapping = await db.Reservations.CountAsync(r =>
            r.ZoneId == zoneId
            && r.SlotType == type
            && (r.Status == ReservationStatus.PendingPayment || r.Status == ReservationStatus.Confirmed || r.Status == ReservationStatus.CheckedIn)
            && r.StartTime < end && r.EndTime > start, ct);
        return capacity - overlapping;
    }
}
