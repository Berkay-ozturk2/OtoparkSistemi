using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>
/// Krokiden cep ayrıntısı ve araç–cep ataması (aşama 3).
/// Kural: engelli izni olmayan (normal) araç engelli park yerine atanamaz. Arayüz de engeller,
/// ancak kural burada ayrıca uygulanır; istemci atlansa bile atama reddedilir.
/// </summary>
public class SlotAssignmentService(
    AppDbContext db,
    ParkingService parking,
    IRealtimeNotifier notifier,
    AuditService audit,
    TimeProvider clock)
{
    public const string DisabledRuleMessage =
        "Normal araç engelli park yerine atanamaz. {0} plakalı aracın geçerli engelli izni yok; lütfen standart bir cep seçin.";

    private DateTime UtcNow => clock.GetUtcNow().UtcDateTime;

    public async Task<SlotDetailDto> GetDetailAsync(int slotId, CancellationToken ct = default)
    {
        var (slot, lot) = await LoadSlotAsync(slotId, ct);
        return await BuildDetailAsync(slot, lot, ct);
    }

    public async Task<SlotDetailDto> AssignAsync(int slotId, string? plate, string? actor, CancellationToken ct = default)
    {
        var normalized = PlateHelper.Normalize(plate);
        if (normalized.Length == 0) throw AppException.BadRequest("Plaka girin.");

        var (slot, lot) = await LoadSlotAsync(slotId, ct);
        if (!slot.IsActive) throw AppException.Conflict($"{slot.Code} cebi kullanım dışı; araç atanamaz.");

        var session = await db.ParkingSessions
            .Where(s => s.Status == SessionStatus.Active && s.LotId == lot.Id && s.Plate == normalized)
            .OrderByDescending(s => s.EntryTime)
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound($"{lot.Name} otoparkında {PlateHelper.Format(normalized)} plakalı aktif oturum yok. Önce giriş kaydı yapılmalı.");

        if (slot.Type == SlotType.Disabled && !await HasPermitAsync(session, ct))
            throw new AppException(422, string.Format(DisabledRuleMessage, PlateHelper.Format(normalized)));

        var other = await db.ParkingSessions.AsNoTracking()
            .Where(s => s.Status == SessionStatus.Active && s.SlotId == slot.Id && s.Id != session.Id)
            .Select(s => s.Plate)
            .FirstOrDefaultAsync(ct);
        if (other != null)
            throw AppException.Conflict($"{slot.Code} cebinde zaten {PlateHelper.Format(other)} plakalı araç kayıtlı.");

        var states = new List<(string Code, bool Occupied, double? Confidence)> { (slot.Code, true, null) };
        string? previousCode = null;
        if (session.SlotId.HasValue && session.SlotId != slot.Id)
        {
            previousCode = await db.ParkingSlots.Where(s => s.Id == session.SlotId).Select(s => s.Code).FirstOrDefaultAsync(ct);
            if (previousCode != null) states.Add((previousCode, false, null));
        }

        session.SlotId = slot.Id;
        await db.SaveChangesAsync(ct);

        var result = await parking.ApplySlotStatesAsync(lot, states, actor, ct);
        await parking.PublishSlotUpdateAsync(notifier, lot, result, ct);
        await audit.LogAsync("Araç cebe atandı",
            $"{lot.Code}/{slot.Code} ← {normalized}{(previousCode != null ? $" (önceki cep {previousCode})" : "")}", actor, ct);

        return await BuildDetailAsync(slot, lot, ct);
    }

    public async Task<SlotDetailDto> UnassignAsync(int slotId, string? actor, CancellationToken ct = default)
    {
        var (slot, lot) = await LoadSlotAsync(slotId, ct);
        var sessions = await db.ParkingSessions
            .Where(s => s.Status == SessionStatus.Active && s.SlotId == slot.Id)
            .ToListAsync(ct);
        if (sessions.Count == 0) throw AppException.NotFound($"{slot.Code} cebinde atanmış araç yok.");

        foreach (var s in sessions) s.SlotId = null;
        await db.SaveChangesAsync(ct);

        var result = await parking.ApplySlotStatesAsync(lot, new[] { (slot.Code, false, (double?)null) }, actor, ct);
        await parking.PublishSlotUpdateAsync(notifier, lot, result, ct);
        await audit.LogAsync("Cep ataması kaldırıldı",
            $"{lot.Code}/{slot.Code}: {string.Join(", ", sessions.Select(s => s.Plate))}", actor, ct);

        return await BuildDetailAsync(slot, lot, ct);
    }

    private async Task<bool> HasPermitAsync(ParkingSession session, CancellationToken ct) =>
        session.IsDisabledPermit || await PermitRules.HasValidPermitAsync(db, session.Plate, UtcNow, ct);

    private async Task<(ParkingSlot Slot, ParkingLot Lot)> LoadSlotAsync(int slotId, CancellationToken ct)
    {
        var slot = await db.ParkingSlots.Include(s => s.Zone).FirstOrDefaultAsync(s => s.Id == slotId, ct)
                   ?? throw AppException.NotFound("Cep bulunamadı.");
        var lot = await db.ParkingLots.FirstOrDefaultAsync(l => l.Id == slot.Zone!.LotId, ct)
                  ?? throw AppException.NotFound("Otopark bulunamadı");
        return (slot, lot);
    }

    private async Task<SlotDetailDto> BuildDetailAsync(ParkingSlot slot, ParkingLot lot, CancellationToken ct)
    {
        var dto = ParkingService.ToSlotDtos(await parking.GetLotSnapshotAsync(lot, ct)).First(s => s.Id == slot.Id);
        var session = await db.ParkingSessions.AsNoTracking()
            .Where(s => s.Status == SessionStatus.Active && s.SlotId == slot.Id)
            .OrderByDescending(s => s.EntryTime)
            .FirstOrDefaultAsync(ct);
        bool? permit = session == null ? null : await HasPermitAsync(session, ct);
        return new SlotDetailDto(
            dto.Id, dto.Code, dto.LotCode, dto.ZoneCode, slot.Zone?.Name, dto.Floor, dto.Type,
            dto.IsOccupied, dto.IsReserved, dto.HasViolation, dto.IsActive, dto.UpdatedAt,
            session?.Id, session?.Plate, session?.EntryTime, permit);
    }
}
