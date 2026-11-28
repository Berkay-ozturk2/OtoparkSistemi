using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

[ApiController]
[Route("api/operator")]
[Authorize(Roles = "Operator,Admin")]
public class OperatorController(
    AppDbContext db,
    GateService gate,
    ParkingService parking,
    PaymentService payments,
    AuditService audit,
    IRealtimeNotifier notifier,
    AgentStatusStore agents,
    TimeProvider clock) : ControllerBase
{
    public const int MaxViolationList = 500;

    /// <summary>UC-07: düşük güvenli / doğrulanamayan okumalar (eskiden yeniye). lot verilirse yalnızca o otopark.</summary>
    [HttpGet("review-queue")]
    public async Task<ActionResult<List<ReviewItemDto>>> ReviewQueue([FromQuery] string? lot, CancellationToken ct)
    {
        var lotFilter = await parking.ResolveOptionalLotAsync(lot, ct);
        var query = db.PlateReviews.AsNoTracking()
            .Include(r => r.GateEvent)
            .Where(r => r.Status == ReviewStatus.Pending);
        if (lotFilter != null)
        {
            var code = lotFilter.Code;
            query = query.Where(r => r.LotCode == code);
        }
        var list = await query.OrderBy(r => r.CreatedAt).ToListAsync(ct);

        return Ok(list.Select(r => new ReviewItemDto(
            r.Id, r.GateEventId, r.CameraId, r.Gate, r.PlateRead, r.Confidence,
            r.GateEvent?.ImageBase64, r.CreatedAt, r.LotCode)).ToList());
    }

    [HttpPost("review-queue/{id:int}/resolve")]
    public async Task<ActionResult<GateDecisionResponse>> Resolve(int id, [FromBody] ResolveReviewRequest request, CancellationToken ct)
    {
        var email = User.GetEmail();
        var result = await gate.ResolveReviewAsync(id, request.CorrectedPlate, request.Approve, email, ct);
        await audit.LogAsync(request.Approve ? "Onay kuyruğu: onaylandı" : "Onay kuyruğu: reddedildi",
            $"Kayıt #{id}, düzeltilmiş plaka: {request.CorrectedPlate ?? "-"}, karar: {result.Decision}", email, ct);
        return Ok(result);
    }

    /// <summary>Açık oturumlar; lot verilmezse tüm otoparklar.</summary>
    [HttpGet("sessions/active")]
    public async Task<ActionResult<List<SessionDto>>> ActiveSessions([FromQuery] string? lot, CancellationToken ct)
    {
        var lotFilter = await parking.ResolveOptionalLotAsync(lot, ct);
        var query = db.ParkingSessions.AsNoTracking()
            .Include(s => s.Zone)
            .Include(s => s.Lot)
            .Include(s => s.Reservation)
            .Where(s => s.Status == SessionStatus.Active);
        if (lotFilter != null)
        {
            var lotId = lotFilter.Id;
            query = query.Where(s => s.LotId == lotId);
        }
        var sessions = await query.OrderByDescending(s => s.EntryTime).ToListAsync(ct);

        var ctx = await parking.GetFeeContextAsync(ct);
        var now = parking.UtcNow;
        return Ok(sessions.Select(s => parking.ToSessionDto(s, ctx, now)).ToList());
    }

    [HttpGet("gate-events")]
    public async Task<ActionResult<List<GateEventDto>>> GateEvents([FromQuery] string? lot, [FromQuery] int limit = 50, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 500);
        var lotFilter = await parking.ResolveOptionalLotAsync(lot, ct);
        var query = db.GateEvents.AsNoTracking().Include(e => e.Session).ThenInclude(x => x!.Zone).AsQueryable();
        if (lotFilter != null)
        {
            var code = lotFilter.Code;
            query = query.Where(e => e.LotCode == code);
        }
        var list = await query
            .OrderByDescending(e => e.Id)
            .Take(limit)
            .ToListAsync(ct);
        return Ok(list.Select(GateEventDto.From).ToList());
    }

    [HttpPost("manual-entry")]
    public Task<ActionResult<GateDecisionResponse>> ManualEntry([FromBody] ManualPlateRequest request, CancellationToken ct) =>
        Manual(GateType.Entry, request, ct);

    [HttpPost("manual-exit")]
    public Task<ActionResult<GateDecisionResponse>> ManualExit([FromBody] ManualPlateRequest request, CancellationToken ct) =>
        Manual(GateType.Exit, request, ct);

    [HttpPost("sessions/{id:int}/cash-payment")]
    public async Task<ActionResult<PaymentResultDto>> CashPayment(int id, CancellationToken ct) =>
        Ok(await payments.CashPaymentAsync(id, User.GetEmail(), ct));

    /// <summary>El ile cep durumu düzeltme (kamera hatası vb.). lot verilmezse GAZI.</summary>
    [HttpPost("slots/{code}/override")]
    public async Task<ActionResult<SlotDto>> OverrideSlot(string code, [FromQuery] string? lot, [FromBody] SlotOverrideRequest request, CancellationToken ct)
    {
        var parkingLot = await parking.ResolveLotAsync(lot, ct);
        var normalized = (code ?? string.Empty).Trim().ToUpperInvariant();
        var lotId = parkingLot.Id;
        var exists = await db.ParkingSlots.AnyAsync(s => s.Code == normalized && s.Zone!.LotId == lotId, ct);
        if (!exists) throw AppException.NotFound("Cep bulunamadı.");

        var email = User.GetEmail();
        var result = await parking.ApplySlotStatesAsync(parkingLot, new[] { (normalized, request.Occupied, (double?)null) }, email, ct);
        await parking.PublishSlotUpdateAsync(notifier, parkingLot, result, ct);
        await audit.LogAsync("Cep durumu el ile değiştirildi",
            $"{parkingLot.Code}/{normalized} → {(request.Occupied ? "dolu" : "boş")}", email, ct);

        var slots = ParkingService.ToSlotDtos(await parking.GetLotSnapshotAsync(parkingLot, ct));
        var slot = slots.First(s => string.Equals(s.Code, normalized, StringComparison.OrdinalIgnoreCase));
        return Ok(slot);
    }

    /// <summary>Krokide tıklanan cebin ayrıntısı: durum, atanmış aracın plakası ve giriş saati.</summary>
    [HttpGet("slots/{id:int}/detail")]
    public async Task<ActionResult<SlotDetailDto>> SlotDetail(int id, [FromServices] SlotAssignmentService slots, CancellationToken ct) =>
        Ok(await slots.GetDetailAsync(id, ct));

    /// <summary>Aktif oturumdaki aracı cebe atar. Normal araç engelli cebe atanamaz → 422.</summary>
    [HttpPost("slots/{id:int}/assign")]
    public async Task<ActionResult<SlotDetailDto>> AssignSlot(int id, [FromBody] AssignSlotRequest request, [FromServices] SlotAssignmentService slots, CancellationToken ct) =>
        Ok(await slots.AssignAsync(id, request.Plate, User.GetEmail(), ct));

    [HttpDelete("slots/{id:int}/assign")]
    public async Task<ActionResult<SlotDetailDto>> UnassignSlot(int id, [FromServices] SlotAssignmentService slots, CancellationToken ct) =>
        Ok(await slots.UnassignAsync(id, User.GetEmail(), ct));

    [HttpGet("agents")]
    public ActionResult<IReadOnlyList<AgentStatusDto>> Agents([FromQuery] string? lot) =>
        Ok(agents.GetAll(clock.GetUtcNow().UtcDateTime, LotDefaults.NormalizeOptional(lot)));

    // ======================= Engelli yeri ihlalleri =======================

    /// <summary>İhlal listesi (yeniden eskiye). lot ve status (Open | Resolved | FalseAlarm) isteğe bağlı.</summary>
    [HttpGet("violations")]
    public async Task<ActionResult<List<ViolationDto>>> Violations([FromQuery] string? lot, [FromQuery] string? status, CancellationToken ct)
    {
        var lotFilter = await parking.ResolveOptionalLotAsync(lot, ct);
        var query = db.Violations.AsNoTracking()
            .Include(v => v.Lot)
            .Include(v => v.Slot).ThenInclude(s => s!.Zone)
            .AsQueryable();
        if (lotFilter != null)
        {
            var lotId = lotFilter.Id;
            query = query.Where(v => v.LotId == lotId);
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<ViolationStatus>(status.Trim(), ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
                throw AppException.BadRequest("Geçersiz durum. Open, Resolved veya FalseAlarm olmalıdır.");
            query = query.Where(v => v.Status == parsed);
        }

        var list = await query.OrderByDescending(v => v.Id).Take(MaxViolationList).ToListAsync(ct);
        return Ok(list.Select(v => ParkingService.ToViolationDto(v, v.Lot, v.Slot)).ToList());
    }

    /// <summary>Açık ihlali el ile kapatır: Resolved veya FalseAlarm (izinli araç ama oturum eşleşmedi).</summary>
    [HttpPost("violations/{id:int}/resolve")]
    public async Task<ActionResult<ViolationDto>> ResolveViolation(int id, [FromBody] ResolveViolationRequest request, CancellationToken ct)
    {
        if (request.Status is not (ViolationStatus.Resolved or ViolationStatus.FalseAlarm))
            throw AppException.BadRequest("Durum Resolved veya FalseAlarm olmalıdır.");

        var violation = await db.Violations
                            .Include(v => v.Lot)
                            .Include(v => v.Slot).ThenInclude(s => s!.Zone)
                            .FirstOrDefaultAsync(v => v.Id == id, ct)
                        ?? throw AppException.NotFound("İhlal kaydı bulunamadı.");
        if (violation.Status != ViolationStatus.Open)
            throw AppException.BadRequest("Bu ihlal zaten kapatılmış.");

        var email = User.GetEmail();
        violation.Status = request.Status.Value;
        violation.ResolvedAt = clock.GetUtcNow().UtcDateTime;
        violation.ResolvedBy = email;
        if (!string.IsNullOrWhiteSpace(request.Note))
            violation.Note = request.Note.Trim().Length <= 500 ? request.Note.Trim() : request.Note.Trim().Substring(0, 500);
        await db.SaveChangesAsync(ct);

        var dto = ParkingService.ToViolationDto(violation, violation.Lot, violation.Slot);
        await audit.LogAsync("Engelli yeri ihlali kapatıldı", $"İhlal #{id} ({dto.LotCode}/{dto.SlotCode}) → {dto.Status}", email, ct);
        await notifier.ViolationResolvedAsync(new ViolationResolvedDto(dto.Id, dto.LotCode, dto.SlotCode, dto.Status));
        if (violation.Lot != null)
            await parking.BroadcastSlotChangesAsync(notifier, violation.Lot, new[] { dto.SlotCode }, ct);
        return Ok(dto);
    }

    private async Task<ActionResult<GateDecisionResponse>> Manual(GateType gateType, ManualPlateRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Plate))
            throw AppException.BadRequest("Plaka giriniz.");

        var email = User.GetEmail();
        var result = await gate.ProcessAsync(new GateInput(
            "manuel", gateType, request.Plate, 1.0, FormatValid: true, IsManual: true, OperatorEmail: email,
            LotCode: request.LotCode), ct);

        await audit.LogAsync(gateType == GateType.Entry ? "Manuel giriş" : "Manuel çıkış",
            $"{result.LotCode}: {PlateHelper.Normalize(request.Plate)}: {result.Decision} - {result.Message}", email, ct);
        return Ok(result);
    }
}
