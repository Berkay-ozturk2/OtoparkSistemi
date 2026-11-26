using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Roles = "Admin")]
public class AdminController(
    AppDbContext db,
    ParkingService parking,
    DemoDataService demoData,
    PermitService permits,
    AuditService audit,
    IRealtimeNotifier notifier,
    TimeProvider clock) : ControllerBase
{
    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    // ======================= Tarifeler (UC-12) =======================

    [HttpGet("tariffs")]
    public async Task<ActionResult<List<TariffDto>>> GetTariffs(CancellationToken ct)
    {
        var list = await db.Tariffs.AsNoTracking().OrderBy(t => t.MinMinutes).ThenBy(t => t.Id).ToListAsync(ct);
        return Ok(list.Select(TariffDto.From).ToList());
    }

    [HttpPost("tariffs")]
    public async Task<ActionResult<TariffDto>> CreateTariff([FromBody] TariffRequest request, CancellationToken ct)
    {
        ValidateTariff(request);
        var tariff = new Tariff
        {
            Name = request.Name!.Trim(),
            MinMinutes = request.MinMinutes,
            MaxMinutes = request.MaxMinutes,
            Price = request.Price,
            IsActive = request.IsActive ?? true
        };
        db.Tariffs.Add(tariff);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Tarife eklendi", $"#{tariff.Id} {tariff.Name}: {tariff.MinMinutes}-{tariff.MaxMinutes} dk, {tariff.Price} TL", ct: ct);
        return StatusCode(StatusCodes.Status201Created, TariffDto.From(tariff));
    }

    [HttpPut("tariffs/{id:int}")]
    public async Task<ActionResult<TariffDto>> UpdateTariff(int id, [FromBody] TariffRequest request, CancellationToken ct)
    {
        ValidateTariff(request);
        var tariff = await db.Tariffs.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw AppException.NotFound("Tarife bulunamadı.");
        tariff.Name = request.Name!.Trim();
        tariff.MinMinutes = request.MinMinutes;
        tariff.MaxMinutes = request.MaxMinutes;
        tariff.Price = request.Price;
        if (request.IsActive.HasValue) tariff.IsActive = request.IsActive.Value;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Tarife güncellendi", $"#{tariff.Id} {tariff.Name}: {tariff.MinMinutes}-{tariff.MaxMinutes} dk, {tariff.Price} TL, aktif: {tariff.IsActive}", ct: ct);
        return Ok(TariffDto.From(tariff));
    }

    [HttpDelete("tariffs/{id:int}")]
    public async Task<IActionResult> DeleteTariff(int id, CancellationToken ct)
    {
        var tariff = await db.Tariffs.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw AppException.NotFound("Tarife bulunamadı.");
        db.Tariffs.Remove(tariff);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Tarife silindi", $"#{id} {tariff.Name}", ct: ct);
        return NoContent();
    }

    private static void ValidateTariff(TariffRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Name)) throw AppException.BadRequest("Tarife adı zorunludur.");
        if (r.MinMinutes < 0) throw AppException.BadRequest("Alt sınır negatif olamaz.");
        if (r.MaxMinutes <= r.MinMinutes) throw AppException.BadRequest("Üst sınır alt sınırdan büyük olmalıdır.");
        if (r.Price < 0m) throw AppException.BadRequest("Ücret negatif olamaz.");
    }

    // ======================= Ayarlar =======================

    [HttpGet("settings")]
    public async Task<ActionResult<SettingsDto>> GetSettings(CancellationToken ct) =>
        Ok(SettingsDto.From(await parking.GetSettingsAsync(ct)));

    [HttpPut("settings")]
    public async Task<ActionResult<SettingsDto>> UpdateSettings([FromBody] UpdateSettingsRequest r, CancellationToken ct)
    {
        if (r.ConfidenceThreshold is < 0d or > 1d) throw AppException.BadRequest("Güven eşiği 0 ile 1 arasında olmalıdır.");
        if (r.AbandonedThresholdHours is < 1 or > 24 * 60) throw AppException.BadRequest("Terk edilmiş araç eşiği 1-1440 saat olmalıdır.");
        if (r.GracePeriodMinutes is < 0 or > 240) throw AppException.BadRequest("Çıkış toleransı 0-240 dakika olmalıdır.");
        if (r.FreeMinutes is < 0 or > 1440) throw AppException.BadRequest("Ücretsiz süre 0-1440 dakika olmalıdır.");
        if (r.DailyMaxFee is < 0m) throw AppException.BadRequest("Günlük azami ücret negatif olamaz.");
        if (r.ReservationHourlyPrice is < 0m) throw AppException.BadRequest("Rezervasyon saatlik ücreti negatif olamaz.");
        if (r.DataRetentionDays is < 1 or > 3650) throw AppException.BadRequest("Veri saklama süresi 1-3650 gün olmalıdır.");

        var s = await parking.GetSettingsAsync(ct);
        if (r.ConfidenceThreshold.HasValue) s.ConfidenceThreshold = r.ConfidenceThreshold.Value;
        if (r.AbandonedThresholdHours.HasValue) s.AbandonedThresholdHours = r.AbandonedThresholdHours.Value;
        if (r.GracePeriodMinutes.HasValue) s.GracePeriodMinutes = r.GracePeriodMinutes.Value;
        if (r.FreeMinutes.HasValue) s.FreeMinutes = r.FreeMinutes.Value;
        if (r.DailyMaxFee.HasValue) s.DailyMaxFee = r.DailyMaxFee.Value;
        if (r.ReservationHourlyPrice.HasValue) s.ReservationHourlyPrice = r.ReservationHourlyPrice.Value;
        if (r.DataRetentionDays.HasValue) s.DataRetentionDays = r.DataRetentionDays.Value;
        s.UpdatedAt = Now;
        await db.SaveChangesAsync(ct);

        var dto = SettingsDto.From(s);
        await audit.LogAsync("Sistem ayarları güncellendi", dto.ToString(), ct: ct);
        return Ok(dto);
    }

    // ======================= Kullanıcılar (UC-13) =======================

    [HttpGet("users")]
    public async Task<ActionResult<List<AdminUserDto>>> GetUsers(CancellationToken ct)
    {
        var list = await db.Users.AsNoTracking().OrderBy(u => u.Id).ToListAsync(ct);
        return Ok(list.Select(AdminUserDto.From).ToList());
    }

    [HttpPost("users")]
    public async Task<ActionResult<AdminUserDto>> CreateUser([FromBody] CreateUserRequest r, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(r.FullName)) throw AppException.BadRequest("Ad soyad zorunludur.");
        if (string.IsNullOrWhiteSpace(r.Email) || !r.Email.Contains('@')) throw AppException.BadRequest("Geçerli bir e-posta adresi giriniz.");
        if (string.IsNullOrEmpty(r.Password) || r.Password.Length < AuthController.MinPasswordLength)
            throw AppException.BadRequest($"Parola en az {AuthController.MinPasswordLength} karakter olmalıdır.");

        var email = r.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct)) throw AppException.Conflict("Bu e-posta adresi zaten kayıtlı.");

        var now = Now;
        var account = new Domain.User
        {
            FullName = r.FullName.Trim(),
            Email = email,
            Phone = (r.Phone ?? string.Empty).Trim(),
            PasswordHash = Passwords.Hash(r.Password),
            Role = r.Role,
            IsActive = true,
            KvkkAccepted = true,
            KvkkAcceptedAt = now,
            CreatedAt = now
        };
        db.Users.Add(account);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Kullanıcı oluşturuldu", $"#{account.Id} {account.Email} ({account.Role})", ct: ct);
        return StatusCode(StatusCodes.Status201Created, AdminUserDto.From(account));
    }

    [HttpPut("users/{id:int}")]
    public async Task<ActionResult<AdminUserDto>> UpdateUser(int id, [FromBody] UpdateUserRequest r, CancellationToken ct)
    {
        var account = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw AppException.NotFound("Kullanıcı bulunamadı.");
        var selfId = User.GetUserId();
        if (id == selfId && ((r.Role.HasValue && r.Role.Value != UserRole.Admin) || r.IsActive == false))
            throw AppException.BadRequest("Kendi yönetici rolünüzü kaldıramaz veya hesabınızı pasifleştiremezsiniz.");

        if (!string.IsNullOrWhiteSpace(r.FullName)) account.FullName = r.FullName.Trim();
        if (r.Phone != null) account.Phone = r.Phone.Trim();
        if (r.Role.HasValue) account.Role = r.Role.Value;
        if (r.IsActive.HasValue) account.IsActive = r.IsActive.Value;
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Kullanıcı güncellendi", $"#{account.Id} {account.Email} rol: {account.Role}, aktif: {account.IsActive}", ct: ct);
        return Ok(AdminUserDto.From(account));
    }

    [HttpDelete("users/{id:int}")]
    public async Task<IActionResult> DeleteUser(int id, CancellationToken ct)
    {
        if (id == User.GetUserId()) throw AppException.BadRequest("Kendi hesabınızı silemezsiniz.");
        var account = await db.Users.FirstOrDefaultAsync(u => u.Id == id, ct) ?? throw AppException.NotFound("Kullanıcı bulunamadı.");
        db.Users.Remove(account);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Kullanıcı silindi", $"#{id} {account.Email}", ct: ct);
        return NoContent();
    }

    // ======================= Terk edilmiş araçlar (UC-09) =======================

    /// <summary>lot verilmezse tüm otoparklar.</summary>
    [HttpGet("abandoned")]
    public async Task<ActionResult<List<AbandonedSessionDto>>> Abandoned([FromQuery] string? lot, CancellationToken ct)
    {
        var lotFilter = await parking.ResolveOptionalLotAsync(lot, ct);
        var ctx = await parking.GetFeeContextAsync(ct);
        var threshold = ctx.Settings.AbandonedThresholdHours;
        var now = Now;
        var cutoff = now.AddHours(-threshold);

        var query = db.ParkingSessions.AsNoTracking()
            .Include(s => s.Zone)
            .Include(s => s.Lot)
            .Include(s => s.Reservation)
            .Where(s => s.Status == SessionStatus.Active && s.EntryTime < cutoff);
        if (lotFilter != null)
        {
            var lotId = lotFilter.Id;
            query = query.Where(s => s.LotId == lotId);
        }
        var sessions = await query.OrderBy(s => s.EntryTime).ToListAsync(ct);

        var result = sessions.Select(s =>
        {
            var d = parking.ToSessionDto(s, ctx, now);
            var overdue = Math.Round((now - s.EntryTime).TotalHours - threshold, 1);
            return new AbandonedSessionDto(d.Id, d.Plate, d.LotCode, d.LotName, d.ZoneCode, d.EntryTime, d.ExitTime,
                d.DurationMinutes, d.Fee, d.PaidAmount, d.IsPaid, d.Status, d.IsDisabledPermit, overdue);
        }).ToList();
        return Ok(result);
    }

    // ======================= Engelli izinleri =======================

    /// <summary>Tüm başvurular; status (Pending | Approved | Rejected | Revoked) ile süzülebilir.</summary>
    [HttpGet("permits")]
    public async Task<ActionResult<List<DisabledPermitDto>>> GetPermits([FromQuery] string? status, CancellationToken ct) =>
        Ok(await permits.GetAllAsync(status, ct));

    /// <summary>Gişede belge görülerek doğrudan onaylı izin.</summary>
    [HttpPost("permits")]
    public async Task<ActionResult<DisabledPermitDto>> CreatePermit([FromBody] AdminCreatePermitRequest request, CancellationToken ct)
    {
        var email = User.GetEmail();
        var dto = await permits.AdminCreateAsync(request, email, ct);
        await audit.LogAsync("Engelli izni verildi", $"İzin #{dto.Id} ({dto.Plate}), geçerlilik: {dto.ValidUntil?.ToString("yyyy-MM-dd") ?? "süresiz"}", email, ct);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    /// <summary>Onay / ret / iptal ve geçerlilik tarihi.</summary>
    [HttpPut("permits/{id:int}")]
    public async Task<ActionResult<DisabledPermitDto>> UpdatePermit(int id, [FromBody] UpdatePermitRequest request, CancellationToken ct)
    {
        var email = User.GetEmail();
        var dto = await permits.AdminUpdateAsync(id, request, email, ct);
        await audit.LogAsync("Engelli izni güncellendi", $"İzin #{dto.Id} ({dto.Plate}) → {dto.Status}", email, ct);
        return Ok(dto);
    }

    // ======================= Otoparklar ve cepler =======================

    /// <summary>Otopark listesi (pasifler dâhil).</summary>
    [HttpGet("lots")]
    public async Task<ActionResult<List<LotSummaryDto>>> GetLots(CancellationToken ct) =>
        Ok(await parking.GetLotsAsync(includeInactive: true, ct));

    [HttpPut("lots/{code}")]
    public async Task<ActionResult<LotSummaryDto>> UpdateLot(string code, [FromBody] UpdateLotRequest r, CancellationToken ct)
    {
        var normalized = LotDefaults.Normalize(code);
        var lot = await db.ParkingLots.FirstOrDefaultAsync(l => l.Code == normalized, ct)
                  ?? throw AppException.NotFound("Otopark bulunamadı");

        if (r.Name != null)
        {
            if (string.IsNullOrWhiteSpace(r.Name)) throw AppException.BadRequest("Otopark adı boş olamaz.");
            lot.Name = Truncate(r.Name.Trim(), 150);
        }
        if (r.Address != null) lot.Address = string.IsNullOrWhiteSpace(r.Address) ? null : Truncate(r.Address.Trim(), 300);
        if (r.Description != null) lot.Description = string.IsNullOrWhiteSpace(r.Description) ? null : Truncate(r.Description.Trim(), 1000);
        if (r.IsActive.HasValue) lot.IsActive = r.IsActive.Value;
        if (r.Latitude.HasValue != r.Longitude.HasValue)
            throw AppException.BadRequest("Konum için enlem ve boylam birlikte verilmelidir.");
        if (r.Latitude.HasValue && r.Longitude.HasValue)
        {
            if (r.Latitude.Value is < -90 or > 90 || r.Longitude.Value is < -180 or > 180)
                throw AppException.BadRequest("Geçersiz konum: enlem -90..90, boylam -180..180 olmalıdır.");
            lot.Latitude = Math.Round(r.Latitude.Value, 6);
            lot.Longitude = Math.Round(r.Longitude.Value, 6);
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Otopark güncellendi",
            $"{lot.Code}: {lot.Name}, aktif: {lot.IsActive}, konum: {lot.Latitude?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "-"}, {lot.Longitude?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "-"}", ct: ct);

        return Ok(ParkingService.ToLotSummary(await parking.GetLotSnapshotAsync(lot, ct)));
    }

    /// <summary>Krokide cebe tıklayıp engelli/normal yapma veya cebi kullanım dışı bırakma.</summary>
    [HttpPut("slots/{id:int}")]
    public async Task<ActionResult<SlotDto>> UpdateSlot(int id, [FromBody] UpdateSlotRequest r, CancellationToken ct)
    {
        if (r.Type.HasValue && !Enum.IsDefined(r.Type.Value))
            throw AppException.BadRequest("Geçersiz cep türü. Standard veya Disabled olmalıdır.");

        var slot = await db.ParkingSlots
                       .Include(s => s.Zone).ThenInclude(z => z!.Lot)
                       .FirstOrDefaultAsync(s => s.Id == id, ct)
                   ?? throw AppException.NotFound("Cep bulunamadı.");
        var lot = slot.Zone?.Lot ?? throw AppException.NotFound("Otopark bulunamadı");

        if (r.Type.HasValue) slot.Type = r.Type.Value;
        if (r.IsActive.HasValue) slot.IsActive = r.IsActive.Value;
        slot.UpdatedAt = Now;

        // Cep artık engelli değilse veya kullanım dışıysa açık ihlal kapatılır
        var resolved = new List<ViolationResolvedDto>();
        if (slot.Type != SlotType.Disabled || !slot.IsActive)
        {
            var open = await db.Violations
                .Where(v => v.SlotId == slot.Id && v.Status == ViolationStatus.Open)
                .ToListAsync(ct);
            foreach (var v in open)
            {
                v.Status = ViolationStatus.Resolved;
                v.ResolvedAt = Now;
                v.ResolvedBy = User.GetEmail();
                v.Note = "Cep türü / kullanım durumu değiştirildi";
                resolved.Add(new ViolationResolvedDto(v.Id, lot.Code, slot.Code, v.Status));
            }
        }
        await db.SaveChangesAsync(ct);
        await audit.LogAsync("Cep güncellendi", $"{lot.Code}/{slot.Code}: tür {slot.Type}, kullanımda: {slot.IsActive}", ct: ct);

        foreach (var v in resolved) await notifier.ViolationResolvedAsync(v);
        await parking.BroadcastSlotChangesAsync(notifier, lot, new[] { slot.Code }, ct);

        var snap = await parking.GetLotSnapshotAsync(lot, ct);
        return Ok(ParkingService.ToSlotDtos(snap).First(s => s.Id == slot.Id));
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value.Substring(0, max);

    // ======================= Denetim kayıtları =======================

    [HttpGet("audit-logs")]
    public async Task<ActionResult<List<AuditLogDto>>> AuditLogs([FromQuery] int limit = 100, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 1000);
        var list = await db.AuditLogs.AsNoTracking()
            .OrderByDescending(a => a.Id)
            .Take(limit)
            .Select(a => new AuditLogDto(a.Id, a.UserEmail, a.Action, a.Details, a.IpAddress, a.CreatedAt))
            .ToListAsync(ct);
        return Ok(list);
    }

    // ======================= KVKK talepleri =======================

    [HttpGet("privacy-requests")]
    public async Task<ActionResult<List<PrivacyRequestDto>>> GetPrivacyRequests(CancellationToken ct)
    {
        var list = await db.PrivacyRequests.AsNoTracking().OrderByDescending(p => p.Id).ToListAsync(ct);
        return Ok(list.Select(PrivacyRequestDto.From).ToList());
    }

    /// <summary>
    /// Talep durumunu günceller. "Delete" türündeki talep Resolved yapılırsa, plakaya ait
    /// tamamlanmış oturum ve geçiş kayıtlarındaki plaka anonimleştirilir.
    /// </summary>
    [HttpPut("privacy-requests/{id:int}")]
    public async Task<ActionResult<PrivacyRequestDto>> UpdatePrivacy(int id, [FromBody] UpdatePrivacyRequest r, CancellationToken ct)
    {
        var entity = await db.PrivacyRequests.FirstOrDefaultAsync(p => p.Id == id, ct) ?? throw AppException.NotFound("Başvuru bulunamadı.");
        entity.Status = r.Status;
        entity.Note = string.IsNullOrWhiteSpace(r.Note) ? entity.Note : r.Note.Trim();
        entity.ResolvedAt = r.Status == PrivacyRequestStatus.Open ? null : Now;

        var anonymized = 0;
        if (r.Status == PrivacyRequestStatus.Resolved && entity.Type == PrivacyRequestType.Delete && !string.IsNullOrEmpty(entity.Plate))
        {
            var plate = entity.Plate;
            var sessions = await db.ParkingSessions.Where(s => s.Plate == plate && s.Status == SessionStatus.Completed).ToListAsync(ct);
            foreach (var s in sessions) s.Plate = PlateHelper.Anonymize(s.Plate);
            var events = await db.GateEvents.Where(e => e.Plate == plate).ToListAsync(ct);
            foreach (var e in events)
            {
                e.Plate = PlateHelper.Anonymize(e.Plate);
                e.ImageBase64 = null;
            }
            anonymized = sessions.Count + events.Count;
        }

        await db.SaveChangesAsync(ct);
        await audit.LogAsync("KVKK başvurusu güncellendi", $"#{id} → {entity.Status}; anonimleştirilen kayıt: {anonymized}", ct: ct);
        return Ok(PrivacyRequestDto.From(entity));
    }

    // ======================= Demo verisi =======================

    [HttpPost("demo-data")]
    public async Task<ActionResult<DemoDataResultDto>> GenerateDemoData(CancellationToken ct)
    {
        var result = await demoData.GenerateAsync(ct);
        await audit.LogAsync("Demo verisi üretildi", result.Message, ct: ct);
        await parking.BroadcastAllSummariesAsync(notifier, ct);
        return Ok(result);
    }
}

[ApiController]
[Route("api/admin/reports")]
[Authorize(Roles = "Admin")]
public class ReportsController(ReportService reports) : ControllerBase
{
    /// <summary>UC-10 doluluk raporu. from/to verilmezse son 30 gün; lot verilmezse tüm otoparklar.</summary>
    [HttpGet("occupancy")]
    public async Task<ActionResult<OccupancyReportDto>> Occupancy([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? lot, CancellationToken ct) =>
        Ok(await reports.GetOccupancyAsync(from, to, lot, ct));

    /// <summary>UC-11 gelir raporu. groupBy: day | week | month.</summary>
    [HttpGet("revenue")]
    public async Task<ActionResult<RevenueReportDto>> Revenue([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? groupBy, [FromQuery] string? lot, CancellationToken ct) =>
        Ok(await reports.GetRevenueAsync(from, to, groupBy, lot, ct));
}
