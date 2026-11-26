using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

// Sürücü uç noktaları. Sözleşmede rol "Driver" olarak geçer; yönetici/operatör de kendi hesabıyla
// test edebilsin diye giriş yapmış her kullanıcıya açıktır (veriler daima kullanıcının kendisine aittir).

[ApiController]
[Route("api/vehicles")]
[Authorize]
public class VehiclesController(AppDbContext db, AuditService audit, TimeProvider clock) : ControllerBase
{
    public const int MaxVehiclesPerUser = 10;

    [HttpGet("my")]
    public async Task<ActionResult<List<VehicleDto>>> My(CancellationToken ct)
    {
        var userId = User.GetUserId();
        var vehicles = await db.Vehicles.AsNoTracking()
            .Where(v => v.UserId == userId)
            .OrderBy(v => v.Id)
            .ToListAsync(ct);
        var statuses = await PermitStatusesAsync(vehicles.Select(v => v.Plate).ToList(), ct);
        return Ok(vehicles
            .Select(v => new VehicleDto(v.Id, v.Plate, v.Nickname, statuses.TryGetValue(v.Plate, out var st) ? st : null))
            .ToList());
    }

    /// <summary>
    /// Plaka → engelli izni durumu. Geçerli (onaylı, süresi dolmamış) izin varsa Approved,
    /// yoksa plakanın en son başvurusunun durumu; hiç başvuru yoksa sözlükte yer almaz (null).
    /// </summary>
    private async Task<Dictionary<string, PermitStatus>> PermitStatusesAsync(List<string> plates, CancellationToken ct)
    {
        var result = new Dictionary<string, PermitStatus>(StringComparer.Ordinal);
        if (plates.Count == 0) return result;
        var permits = await db.DisabledPermits.AsNoTracking()
            .Where(p => plates.Contains(p.Plate))
            .ToListAsync(ct);
        var now = clock.GetUtcNow().UtcDateTime;
        foreach (var group in permits.GroupBy(p => p.Plate))
        {
            result[group.Key] = group.Any(p => PermitRules.IsValid(p, now))
                ? PermitStatus.Approved
                : group.OrderByDescending(p => p.Id).First().Status;
        }
        return result;
    }

    [HttpPost]
    public async Task<ActionResult<VehicleDto>> Create([FromBody] CreateVehicleRequest request, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var plate = PlateHelper.Normalize(request.Plate);
        if (!PlateHelper.IsValid(plate))
            throw AppException.BadRequest("Geçerli bir Türk plakası giriniz (ör. 34 ABC 123).");

        if (await db.Vehicles.AnyAsync(v => v.UserId == userId && v.Plate == plate, ct))
            throw AppException.Conflict("Bu plaka zaten hesabınıza kayıtlı.");
        if (await db.Vehicles.CountAsync(v => v.UserId == userId, ct) >= MaxVehiclesPerUser)
            throw AppException.BadRequest($"En fazla {MaxVehiclesPerUser} araç kaydedebilirsiniz.");

        var vehicle = new Vehicle
        {
            UserId = userId,
            Plate = plate,
            Nickname = string.IsNullOrWhiteSpace(request.Nickname) ? null : request.Nickname.Trim(),
            CreatedAt = clock.GetUtcNow().UtcDateTime
        };
        db.Vehicles.Add(vehicle);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Araç eklendi", $"Araç #{vehicle.Id} ({plate})", ct: ct);

        var statuses = await PermitStatusesAsync(new List<string> { plate }, ct);
        return StatusCode(StatusCodes.Status201Created,
            new VehicleDto(vehicle.Id, vehicle.Plate, vehicle.Nickname, statuses.TryGetValue(plate, out var st) ? st : null));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        var userId = User.GetUserId();
        var vehicle = await db.Vehicles.FirstOrDefaultAsync(v => v.Id == id && v.UserId == userId, ct)
                      ?? throw AppException.NotFound("Araç bulunamadı.");
        db.Vehicles.Remove(vehicle);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Araç silindi", $"Araç #{id} ({vehicle.Plate})", ct: ct);
        return NoContent();
    }
}

[ApiController]
[Route("api/reservations")]
[Authorize]
public class ReservationsController(ReservationService reservations, AuditService audit) : ControllerBase
{
    [HttpGet("my")]
    public async Task<ActionResult<List<ReservationDto>>> My(CancellationToken ct) =>
        Ok(await reservations.GetMyAsync(User.GetUserId(), ct));

    [HttpPost("quote")]
    public async Task<ActionResult<ReservationQuoteDto>> Quote([FromBody] ReservationQuoteRequest request, CancellationToken ct) =>
        Ok(await reservations.QuoteAsync(request.LotCode, request.ZoneCode, request.SlotType, request.StartTime, request.EndTime, ct));

    [HttpPost]
    public async Task<ActionResult<ReservationDto>> Create([FromBody] CreateReservationRequest request, CancellationToken ct)
    {
        var dto = await reservations.CreateAsync(User.GetUserId(), request, ct);
        await audit.LogAsync("Rezervasyon oluşturuldu", $"Rezervasyon #{dto.Id}, {dto.Plate}, otopark {dto.LotCode}, bölge {dto.ZoneCode} ({dto.SlotType}), {dto.Amount} TL", ct: ct);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    [HttpDelete("{id:int}")]
    public async Task<ActionResult<ReservationDto>> Cancel(int id, CancellationToken ct)
    {
        var dto = await reservations.CancelAsync(User.GetUserId(), id, ct);
        await audit.LogAsync("Rezervasyon iptal edildi", $"Rezervasyon #{id}", ct: ct);
        return Ok(dto);
    }
}

[ApiController]
[Route("api/sessions")]
[Authorize]
public class SessionsController(AppDbContext db, ParkingService parking) : ControllerBase
{
    /// <summary>Sürücünün kayıtlı plakalarına ait oturum geçmişi (en yeni önce, en fazla 200).</summary>
    [HttpGet("my")]
    public async Task<ActionResult<List<SessionDto>>> My(CancellationToken ct)
    {
        var userId = User.GetUserId();
        var plates = await db.Vehicles.AsNoTracking()
            .Where(v => v.UserId == userId)
            .Select(v => v.Plate)
            .ToListAsync(ct);
        if (plates.Count == 0) return Ok(new List<SessionDto>());

        var sessions = await db.ParkingSessions.AsNoTracking()
            .Include(s => s.Zone)
            .Include(s => s.Lot)
            .Include(s => s.Reservation)
            .Where(s => plates.Contains(s.Plate))
            .OrderByDescending(s => s.EntryTime)
            .Take(200)
            .ToListAsync(ct);

        var ctx = await parking.GetFeeContextAsync(ct);
        var now = parking.UtcNow;
        return Ok(sessions.Select(s => parking.ToSessionDto(s, ctx, now)).ToList());
    }
}

[ApiController]
[Route("api/payments")]
[AllowAnonymous]
public class PaymentsController(PaymentService payments) : ControllerBase
{
    /// <summary>UC-03: girişsiz ödeme için tutar sorgulama.</summary>
    [HttpGet("quote/{plate}")]
    public async Task<ActionResult<PaymentQuoteDto>> Quote(string plate, CancellationToken ct) =>
        Ok(await payments.QuoteAsync(plate, ct));

    /// <summary>Kartla ödeme (oturum veya rezervasyon). Kart bilgisi saklanmaz; yalnızca son 4 hane.</summary>
    [HttpPost("pay")]
    public async Task<ActionResult<PaymentResultDto>> Pay([FromBody] PayRequest request, CancellationToken ct) =>
        Ok(await payments.PayAsync(request, ct));
}

[ApiController]
[Route("api/privacy")]
[AllowAnonymous]
public class PrivacyController(AppDbContext db, AuditService audit, TimeProvider clock) : ControllerBase
{
    /// <summary>KVKK ilgili kişi başvurusu (silme / itiraz / bilgi talebi).</summary>
    [HttpPost("requests")]
    public async Task<ActionResult<PrivacyRequestDto>> Create([FromBody] CreatePrivacyRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.FullName))
            throw AppException.BadRequest("Ad soyad zorunludur.");
        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@'))
            throw AppException.BadRequest("Geçerli bir e-posta adresi giriniz.");

        var plate = PlateHelper.Normalize(request.Plate);
        var entity = new PrivacyRequest
        {
            FullName = request.FullName.Trim(),
            Email = request.Email.Trim().ToLowerInvariant(),
            Plate = plate.Length == 0 ? null : plate,
            Type = request.Type,
            Message = string.IsNullOrWhiteSpace(request.Message) ? null : request.Message.Trim(),
            Status = PrivacyRequestStatus.Open,
            CreatedAt = clock.GetUtcNow().UtcDateTime
        };
        db.PrivacyRequests.Add(entity);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("KVKK başvurusu alındı", $"Başvuru #{entity.Id} ({entity.Type})", entity.Email, ct);

        return StatusCode(StatusCodes.Status201Created, PrivacyRequestDto.From(entity));
    }
}
