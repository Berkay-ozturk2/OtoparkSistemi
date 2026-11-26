using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>Ücret hesabı için ayarlar + aktif tarifeler.</summary>
public record FeeContext(SystemSettings Settings, IReadOnlyList<Tariff> Tariffs);

/// <summary>
/// Bir oturumun anlık ücret durumu.
/// GrossFee: tarife ücreti, Prepaid: rezervasyon ön ödemesi, NetFee: max(0, Gross − Prepaid),
/// Due: şu an ödenmesi gereken (NetFee − PaidAmount; ödeme sonrası grace süresi içindeyse 0).
/// </summary>
public record ChargeInfo(decimal GrossFee, decimal Prepaid, decimal NetFee, decimal Due, bool WithinGrace);

/// <summary>Bir cep türü (Standard / Disabled) için doluluk sayıları.</summary>
public class TypeCounts
{
    public int Total { get; set; }
    public int CameraOccupied { get; set; }
    public int Sessions { get; set; }
    public int Occupied { get; set; }
    public int Reserved { get; set; }
    public int Free { get; set; }

    /// <summary>
    /// dolu = min(toplam, max(kameranın dolu dediği, aktif oturum)),
    /// ayrılmış = min(geçerli onaylı rezervasyon, toplam − dolu), boş = toplam − dolu − ayrılmış.
    /// </summary>
    public void Compute(int reservationsWanted)
    {
        Occupied = Math.Min(Total, Math.Max(CameraOccupied, Sessions));
        Reserved = Math.Max(0, Math.Min(reservationsWanted, Total - Occupied));
        Free = Math.Max(0, Total - Occupied - Reserved);
    }
}

public class ZoneState(Zone zone, List<ParkingSlot> slots)
{
    public Zone Zone { get; } = zone;

    /// <summary>Bölgenin tüm cepleri (kullanım dışı olanlar dâhil; sayımlara yalnızca IsActive cepler girer).</summary>
    public List<ParkingSlot> Slots { get; } = slots;
    public TypeCounts Standard { get; } = new();
    public TypeCounts Disabled { get; } = new();
    public int ActiveSessions { get; set; }
    public HashSet<int> ReservedSlotIds { get; } = new();

    public int Total => Standard.Total + Disabled.Total;
    public int Occupied => Standard.Occupied + Disabled.Occupied;
    public int Reserved => Standard.Reserved + Disabled.Reserved;

    /// <summary>Normal araçlar için boş yer (= boş Standard cepler).</summary>
    public int Free => Standard.Free;

    public TypeCounts Counts(SlotType type) => type == SlotType.Disabled ? Disabled : Standard;
}

/// <summary>Öneri sonucu: bölge + cep türü + ilk boş cep.</summary>
public record ZoneRecommendation(ZoneState Zone, SlotType SlotType, int FreeSlots, string? SlotCode);

/// <summary>Bir otoparkın anlık doluluk görüntüsü.</summary>
public class OccupancySnapshot(ParkingLot lot)
{
    public ParkingLot Lot { get; } = lot;
    public List<ZoneState> Zones { get; } = new();
    public TypeCounts Standard { get; } = new();
    public TypeCounts Disabled { get; } = new();
    public HashSet<int> ViolationSlotIds { get; } = new();

    public int Total => Standard.Total + Disabled.Total;
    public int Occupied => Standard.Occupied + Disabled.Occupied;
    public int Reserved => Standard.Reserved + Disabled.Reserved;

    /// <summary>Normal araçlar için boş yer (= boş Standard cepler).</summary>
    public int Free => Standard.Free;

    /// <summary>Engelli izinli araçlar için boş yer (= boş Standard + boş Disabled).</summary>
    public int FreeForPermitHolders => Standard.Free + Disabled.Free;

    public double OccupancyRate => Total == 0 ? 0d : Math.Round((double)Occupied / Total, 4);

    public SummaryDto ToSummary() =>
        new(Lot.Code, Total, Occupied, Standard.Free, Reserved, OccupancyRate, Disabled.Total, Disabled.Occupied, Disabled.Free);

    /// <summary>
    /// Öneri: normal sürücüye asla engelli cep önerilmez (en çok boş Standard cebi olan bölge).
    /// disabled=true (izinli araç): boş engelli cebi olan bölge; yoksa normal öneri.
    /// Eşitlikte zemine yakın kat, sonra kod sırası.
    /// </summary>
    public ZoneRecommendation? Recommend(bool disabled = false)
    {
        if (disabled)
        {
            var dz = PickZone(SlotType.Disabled);
            if (dz != null)
                return new ZoneRecommendation(dz, SlotType.Disabled, dz.Disabled.Free, FirstFreeSlotCode(dz, SlotType.Disabled));
        }

        var z = PickZone(SlotType.Standard);
        return z == null ? null : new ZoneRecommendation(z, SlotType.Standard, z.Standard.Free, FirstFreeSlotCode(z, SlotType.Standard));
    }

    private ZoneState? PickZone(SlotType type) =>
        Zones.Where(z => z.Counts(type).Free > 0)
            .OrderByDescending(z => z.Counts(type).Free)
            .ThenBy(z => Math.Abs(z.Zone.Floor))
            .ThenBy(z => z.Zone.Code, StringComparer.Ordinal)
            .FirstOrDefault();

    public static string? FirstFreeSlotCode(ZoneState zone, SlotType type) =>
        zone.Slots
            .Where(s => s.IsActive && s.Type == type && !s.IsOccupied && !zone.ReservedSlotIds.Contains(s.Id))
            .OrderBy(s => s.Code, StringComparer.Ordinal)
            .Select(s => s.Code)
            .FirstOrDefault();
}

/// <summary>Cep durumu güncellemesinin sonucu: değişen cepler + açılan / kapanan ihlaller.</summary>
public record SlotUpdateResult(List<string> ChangedCodes, List<ViolationDto> OpenedViolations, List<ViolationResolvedDto> ResolvedViolations)
{
    public static SlotUpdateResult Empty() => new(new List<string>(), new List<ViolationDto>(), new List<ViolationResolvedDto>());
}

public class ParkingService(AppDbContext db, TimeProvider clock)
{
    /// <summary>Rezervasyon başlangıcından bu kadar dakika önce gelen araç rezervasyonlu kabul edilir.</summary>
    public const int ReservationEarlyArrivalMinutes = 30;

    public DateTime UtcNow => clock.GetUtcNow().UtcDateTime;

    // ---------------- Ayarlar / tarifeler ----------------

    public async Task<SystemSettings> GetSettingsAsync(CancellationToken ct = default)
    {
        var settings = await db.Settings.OrderBy(s => s.Id).FirstOrDefaultAsync(ct);
        if (settings == null)
        {
            settings = new SystemSettings { Id = 1, UpdatedAt = UtcNow };
            db.Settings.Add(settings);
            await db.SaveChangesAsync(ct);
        }
        return settings;
    }

    public async Task<FeeContext> GetFeeContextAsync(CancellationToken ct = default)
    {
        var settings = await GetSettingsAsync(ct);
        var tariffs = await db.Tariffs.AsNoTracking()
            .Where(t => t.IsActive)
            .OrderBy(t => t.MinMinutes)
            .ToListAsync(ct);
        return new FeeContext(settings, tariffs);
    }

    public async Task<List<TariffDto>> GetActiveTariffsAsync(CancellationToken ct = default)
    {
        var list = await db.Tariffs.AsNoTracking()
            .Where(t => t.IsActive)
            .OrderBy(t => t.MinMinutes)
            .ToListAsync(ct);
        return list.Select(TariffDto.From).ToList();
    }

    // ---------------- Ücret ----------------

    /// <summary>Oturumun ücret durumunu hesaplar. Rezervasyon ön ödemesi için s.Reservation yüklenmiş olmalıdır.</summary>
    public ChargeInfo ComputeCharge(ParkingSession s, FeeContext ctx, DateTime nowUtc)
    {
        if (s.Status == SessionStatus.Completed)
            return new ChargeInfo(s.Fee, 0m, s.Fee, 0m, false);

        var end = s.ExitTime ?? nowUtc;
        var gross = FeeCalculator.Calculate(end - s.EntryTime, ctx.Tariffs, ctx.Settings.FreeMinutes, ctx.Settings.DailyMaxFee);
        var prepaid = s.Reservation != null && s.Reservation.PaidAt.HasValue ? s.Reservation.Amount : 0m;
        var net = Math.Max(0m, gross - prepaid);

        var withinGrace = s.IsPaid
                          && s.PaidAt.HasValue
                          && nowUtc <= s.PaidAt.Value.AddMinutes(Math.Max(0, ctx.Settings.GracePeriodMinutes));

        // Grace süresi aşıldıysa: süre ücreti − ödenen = fark ücreti
        var due = withinGrace ? 0m : Math.Max(0m, net - s.PaidAmount);
        return new ChargeInfo(gross, prepaid, net, due, withinGrace);
    }

    public SessionDto ToSessionDto(ParkingSession s, FeeContext ctx, DateTime nowUtc)
    {
        var end = s.ExitTime ?? nowUtc;
        decimal fee;
        bool isPaid;
        if (s.Status == SessionStatus.Active)
        {
            var c = ComputeCharge(s, ctx, nowUtc);
            fee = c.NetFee;
            isPaid = s.IsPaid && c.Due == 0m;
        }
        else
        {
            fee = s.Fee;
            isPaid = s.IsPaid;
        }

        return new SessionDto(s.Id, s.Plate, s.Lot?.Code, s.Lot?.Name, s.Zone?.Code, s.EntryTime, s.ExitTime,
            TimeHelper.MinutesBetween(s.EntryTime, end), fee, s.PaidAmount, isPaid, s.Status, s.IsDisabledPermit);
    }

    // ---------------- Otoparklar ----------------

    /// <summary>Kodla otopark (pasifler dâhil). Kod boşsa varsayılan otopark (GAZI). Bulunamazsa null.</summary>
    public async Task<ParkingLot?> FindLotAsync(string? lotCode, CancellationToken ct = default)
    {
        var code = LotDefaults.Normalize(lotCode);
        return await db.ParkingLots.AsNoTracking().FirstOrDefaultAsync(l => l.Code == code, ct);
    }

    /// <summary>Kodla otopark; kod boşsa GAZI. Bilinmeyen kod → 404 "Otopark bulunamadı".</summary>
    public async Task<ParkingLot> ResolveLotAsync(string? lotCode, CancellationToken ct = default) =>
        await FindLotAsync(lotCode, ct) ?? throw AppException.NotFound("Otopark bulunamadı");

    /// <summary>Filtre amaçlı: kod boşsa null (tüm otoparklar), bilinmeyen kod → 404.</summary>
    public async Task<ParkingLot?> ResolveOptionalLotAsync(string? lotCode, CancellationToken ct = default) =>
        string.IsNullOrWhiteSpace(lotCode) ? null : await ResolveLotAsync(lotCode, ct);

    /// <summary>Otopark listesi ve doluluk özetleri (FreeSlots = boş Standard cep).</summary>
    public async Task<List<LotSummaryDto>> GetLotsAsync(bool includeInactive = false, CancellationToken ct = default)
    {
        var lots = await db.ParkingLots.AsNoTracking()
            .Where(l => includeInactive || l.IsActive)
            .OrderBy(l => l.Id)
            .ToListAsync(ct);

        var result = new List<LotSummaryDto>(lots.Count);
        foreach (var lot in lots)
        {
            var snap = await GetLotSnapshotAsync(lot, ct);
            result.Add(ToLotSummary(snap));
        }
        return result;
    }

    public static LotSummaryDto ToLotSummary(OccupancySnapshot snap)
    {
        var lot = snap.Lot;
        return new LotSummaryDto(lot.Id, lot.Code, lot.Name, lot.Address, lot.Description, LotJson.Floors(lot),
            snap.Total, snap.Standard.Free, snap.Disabled.Total, snap.Disabled.Free, snap.OccupancyRate,
            lot.IsActive, lot.MapWidth, lot.MapHeight, lot.Latitude, lot.Longitude);
    }

    /// <summary>Krokiyi çizmek için tek çağrı: otopark + bölgeler + cepler.</summary>
    public async Task<LotLayoutDto> GetLayoutAsync(string lotCode, CancellationToken ct = default)
    {
        var lot = await ResolveLotAsync(lotCode, ct);
        var snap = await GetLotSnapshotAsync(lot, ct);
        var zones = snap.Zones
            .Select(z => new LayoutZoneDto(z.Zone.Id, z.Zone.Code, z.Zone.Name, z.Zone.Floor))
            .ToList();
        return new LotLayoutDto(LotJson.ToDto(lot), zones, ToSlotDtos(snap));
    }

    // ---------------- Doluluk ----------------

    /// <summary>
    /// Doluluk kuralı (kamera olmasa da sistem çalışsın diye), her cep türü için ayrı:
    ///  dolu = min(toplam, max(kameranın dolu dediği cep sayısı, aktif oturum sayısı))
    ///  ayrılmış = şu an geçerli Confirmed rezervasyon sayısı (boş cep sayısıyla sınırlı)
    ///  boş = toplam − dolu − ayrılmış
    /// Engelli izinli oturumlar önce engelli cepleri doldurur (taşan kısım Standard'a sayılır), diğer oturumlar Standard'a.
    /// Kullanım dışı (IsActive=false) cepler sayılmaz. Bölge bazında aynı kural oturumun yazıldığı bölgeye göre uygulanır.
    /// </summary>
    public async Task<OccupancySnapshot> GetLotSnapshotAsync(ParkingLot lot, CancellationToken ct = default)
    {
        var now = UtcNow;
        var lotId = lot.Id;
        var zones = await db.Zones.AsNoTracking()
            .Include(z => z.Slots)
            .Where(z => z.LotId == lotId)
            .ToListAsync(ct);
        var zoneIds = zones.Select(z => z.Id).ToList();

        var sessions = await db.ParkingSessions.AsNoTracking()
            .Where(s => s.Status == SessionStatus.Active && s.LotId == lotId)
            .Select(s => new { s.ZoneId, s.IsDisabledPermit })
            .ToListAsync(ct);

        var windowStart = now.AddMinutes(ReservationEarlyArrivalMinutes);
        var reservations = await db.Reservations.AsNoTracking()
            .Where(r => r.Status == ReservationStatus.Confirmed
                        && r.StartTime <= windowStart && r.EndTime > now
                        && zoneIds.Contains(r.ZoneId))
            .Select(r => new { r.ZoneId, r.SlotType })
            .ToListAsync(ct);

        var violationSlotIds = await db.Violations.AsNoTracking()
            .Where(v => v.LotId == lotId && v.Status == ViolationStatus.Open)
            .Select(v => v.SlotId)
            .ToListAsync(ct);

        var snap = new OccupancySnapshot(lot);
        foreach (var id in violationSlotIds) snap.ViolationSlotIds.Add(id);

        foreach (var zone in zones.OrderBy(z => z.Floor).ThenBy(z => z.Code, StringComparer.Ordinal))
        {
            var slots = zone.Slots.OrderBy(s => s.Code, StringComparer.Ordinal).ToList();
            var state = new ZoneState(zone, slots);
            var zoneSessions = sessions.Where(s => s.ZoneId == zone.Id).ToList();
            state.ActiveSessions = zoneSessions.Count;
            FillCounts(state.Standard, state.Disabled, slots,
                permitSessions: zoneSessions.Count(s => s.IsDisabledPermit),
                otherSessions: zoneSessions.Count(s => !s.IsDisabledPermit),
                reservedStandard: reservations.Count(r => r.ZoneId == zone.Id && r.SlotType == SlotType.Standard),
                reservedDisabled: reservations.Count(r => r.ZoneId == zone.Id && r.SlotType == SlotType.Disabled));

            // Ayrılmış cepleri, kameranın boş gördüğü ceplerin sonundan işaretle (öneri baştan seçer)
            MarkReserved(state, SlotType.Standard);
            MarkReserved(state, SlotType.Disabled);

            snap.Zones.Add(state);
        }

        // Otopark geneli (bölgesi yazılmamış oturumlar da sayılır)
        FillCounts(snap.Standard, snap.Disabled, zones.SelectMany(z => z.Slots).ToList(),
            permitSessions: sessions.Count(s => s.IsDisabledPermit),
            otherSessions: sessions.Count(s => !s.IsDisabledPermit),
            reservedStandard: reservations.Count(r => r.SlotType == SlotType.Standard),
            reservedDisabled: reservations.Count(r => r.SlotType == SlotType.Disabled));
        return snap;
    }

    private static void FillCounts(TypeCounts standard, TypeCounts disabled, List<ParkingSlot> slots,
        int permitSessions, int otherSessions, int reservedStandard, int reservedDisabled)
    {
        var active = slots.Where(s => s.IsActive).ToList();
        standard.Total = active.Count(s => s.Type == SlotType.Standard);
        disabled.Total = active.Count(s => s.Type == SlotType.Disabled);
        standard.CameraOccupied = active.Count(s => s.Type == SlotType.Standard && s.IsOccupied);
        disabled.CameraOccupied = active.Count(s => s.Type == SlotType.Disabled && s.IsOccupied);

        disabled.Sessions = Math.Min(permitSessions, disabled.Total);
        standard.Sessions = otherSessions + (permitSessions - disabled.Sessions);

        standard.Compute(reservedStandard);
        disabled.Compute(reservedDisabled);
    }

    private static void MarkReserved(ZoneState state, SlotType type)
    {
        var count = state.Counts(type).Reserved;
        if (count <= 0) return;
        foreach (var slot in state.Slots.Where(s => s.IsActive && s.Type == type && !s.IsOccupied).Reverse().Take(count))
            state.ReservedSlotIds.Add(slot.Id);
    }

    /// <summary>Kod verilmezse varsayılan otopark (GAZI); bilinmeyen kod → 404.</summary>
    public async Task<OccupancySnapshot> GetSnapshotAsync(string? lotCode = null, CancellationToken ct = default) =>
        await GetLotSnapshotAsync(await ResolveLotAsync(lotCode, ct), ct);

    public async Task<SummaryDto> GetSummaryAsync(string? lotCode = null, CancellationToken ct = default) =>
        (await GetSnapshotAsync(lotCode, ct)).ToSummary();

    public async Task<List<ZoneDto>> GetZonesAsync(string? lotCode = null, CancellationToken ct = default)
    {
        var snap = await GetSnapshotAsync(lotCode, ct);
        return snap.Zones
            .Select(z => new ZoneDto(z.Zone.Id, z.Zone.Code, z.Zone.Name, z.Zone.Floor, z.Total, z.Standard.Free,
                z.Disabled.Total, z.Disabled.Free))
            .ToList();
    }

    public async Task<List<SlotDto>> GetSlotsAsync(string? lotCode = null, CancellationToken ct = default) =>
        ToSlotDtos(await GetSnapshotAsync(lotCode, ct));

    public static List<SlotDto> ToSlotDtos(OccupancySnapshot snap) =>
        snap.Zones
            .SelectMany(z => z.Slots.Select(s => new SlotDto(
                s.Id, s.Code, snap.Lot.Code, z.Zone.Code, z.Zone.Floor, s.Type, s.IsOccupied,
                z.ReservedSlotIds.Contains(s.Id), snap.ViolationSlotIds.Contains(s.Id), s.IsActive, s.UpdatedAt,
                s.MapX, s.MapY, s.MapW, s.MapH)))
            .ToList();

    /// <summary>disabled=false: asla engelli cep önerilmez. disabled=true: boş engelli cep (yoksa normal cep).</summary>
    public async Task<RecommendationDto> GetRecommendationAsync(string? lotCode = null, bool disabled = false, CancellationToken ct = default)
    {
        var snap = await GetSnapshotAsync(lotCode, ct);
        var rec = snap.Recommend(disabled);
        if (rec == null) return new RecommendationDto(snap.Lot.Code, null, null, null, 0, null, null);
        return new RecommendationDto(snap.Lot.Code, rec.Zone.Zone.Code, rec.Zone.Zone.Name, rec.Zone.Zone.Floor,
            rec.FreeSlots, rec.SlotCode, rec.SlotType);
    }

    // ---------------- Cep durumu + engelli yeri ihlali ----------------

    /// <summary>
    /// Kamera / operatör cep durumlarını otopark içinde (lot → bölge → cep) uygular. Bilinmeyen kodlar yok sayılır.
    /// Engelli cep boştan doluya geçtiğinde: otoparktaki dolu engelli cep sayısı &gt; içerideki geçerli izinli araç sayısı
    /// ise o cep için Open ihlal açılır (cep başına tek açık ihlal). Cep boşalınca açık ihlal "Araç ayrıldı" notuyla kapanır.
    /// </summary>
    public async Task<SlotUpdateResult> ApplySlotStatesAsync(
        ParkingLot lot,
        IEnumerable<(string Code, bool Occupied, double? Confidence)> states,
        string? actor = null,
        CancellationToken ct = default)
    {
        var now = UtcNow;
        var map = new Dictionary<string, (bool Occupied, double? Confidence)>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in states)
        {
            if (string.IsNullOrWhiteSpace(s.Code)) continue;
            map[s.Code.Trim()] = (s.Occupied, s.Confidence);
        }
        if (map.Count == 0) return SlotUpdateResult.Empty();

        // Otoparkın cep sayısı küçük (≤ birkaç yüz); hepsini çekip bellekte eşlemek her iki sağlayıcıda da güvenli
        var lotId = lot.Id;
        var slots = await db.ParkingSlots
            .Include(s => s.Zone)
            .Where(s => s.Zone!.LotId == lotId)
            .ToListAsync(ct);

        var changed = new List<string>();
        var becameOccupied = new List<ParkingSlot>();
        var becameFree = new List<ParkingSlot>();
        foreach (var slot in slots)
        {
            if (!map.TryGetValue(slot.Code, out var state)) continue;
            if (state.Confidence.HasValue) slot.Confidence = state.Confidence;
            if (slot.IsOccupied != state.Occupied)
            {
                slot.IsOccupied = state.Occupied;
                slot.UpdatedAt = now;
                changed.Add(slot.Code);
                if (state.Occupied) becameOccupied.Add(slot);
                else becameFree.Add(slot);
            }
        }

        var opened = new List<ViolationDto>();
        var resolved = new List<ViolationResolvedDto>();

        if (changed.Count > 0)
        {
            var openViolations = await db.Violations
                .Where(v => v.LotId == lotId && v.Status == ViolationStatus.Open)
                .ToListAsync(ct);

            // Cep boşaldı → açık ihlal otomatik kapanır
            foreach (var slot in becameFree)
            {
                foreach (var v in openViolations.Where(x => x.SlotId == slot.Id && x.Status == ViolationStatus.Open))
                {
                    v.Status = ViolationStatus.Resolved;
                    v.ResolvedAt = now;
                    v.Note = "Araç ayrıldı";
                    v.ResolvedBy = "sistem";
                    resolved.Add(new ViolationResolvedDto(v.Id, lot.Code, slot.Code, v.Status));
                }
            }

            var newlyOccupiedDisabled = becameOccupied
                .Where(s => s.IsActive && s.Type == SlotType.Disabled)
                .OrderBy(s => s.Code, StringComparer.Ordinal)
                .ToList();
            if (newlyOccupiedDisabled.Count > 0)
            {
                var occupiedDisabled = slots.Count(s => s.IsActive && s.Type == SlotType.Disabled && s.IsOccupied);
                var permitInside = await CountPermitVehiclesInsideAsync(lotId, now, ct);
                var newViolations = new List<(Violation Entity, ParkingSlot Slot)>();
                // İzinsiz araç sayısı kadar ihlal açılır: aynı anda birden çok engelli cep dolsa bile
                // içerideki izinli araçların kapladığı kadarı ihlal sayılmaz.
                var excess = occupiedDisabled - permitInside;
                var stillOpen = openViolations.Count(x => x.Status == ViolationStatus.Open);
                foreach (var slot in newlyOccupiedDisabled)
                {
                    if (openViolations.Any(x => x.SlotId == slot.Id && x.Status == ViolationStatus.Open)) continue;
                    if (stillOpen + newViolations.Count >= excess) break;

                    var violation = new Violation
                    {
                        LotId = lotId,
                        SlotId = slot.Id,
                        DetectedAt = now,
                        Status = ViolationStatus.Open
                    };
                    db.Violations.Add(violation);
                    newViolations.Add((violation, slot));
                    db.AuditLogs.Add(new AuditLog
                    {
                        Action = "Engelli park yeri ihlali tespit edildi",
                        Details = $"{lot.Code} / {slot.Code}: dolu engelli cep {occupiedDisabled}, içerideki izinli araç {permitInside}",
                        UserEmail = actor ?? "sistem",
                        CreatedAt = now
                    });
                }

                await db.SaveChangesAsync(ct); // ihlal Id'leri için
                foreach (var (entity, slot) in newViolations)
                    opened.Add(ToViolationDto(entity, lot, slot));
            }
        }

        await db.SaveChangesAsync(ct);
        return new SlotUpdateResult(changed, opened, resolved);
    }

    /// <summary>Otoparkta aktif oturumu olan ve geçerli engelli izni bulunan araç sayısı.</summary>
    public async Task<int> CountPermitVehiclesInsideAsync(int lotId, DateTime nowUtc, CancellationToken ct = default)
    {
        var plates = await db.ParkingSessions.AsNoTracking()
            .Where(s => s.Status == SessionStatus.Active && s.LotId == lotId)
            .Select(s => s.Plate)
            .ToListAsync(ct);
        if (plates.Count == 0) return 0;
        var valid = await PermitRules.GetValidPlatesAsync(db, nowUtc, ct);
        return plates.Distinct(StringComparer.Ordinal).Count(p => valid.Contains(p));
    }

    public static ViolationDto ToViolationDto(Violation v, ParkingLot? lot, ParkingSlot? slot) =>
        new(v.Id, lot?.Code ?? string.Empty, lot?.Name ?? string.Empty, slot?.Code ?? string.Empty,
            slot?.Zone?.Code, slot?.Zone?.Floor, v.DetectedAt, v.ResolvedAt, v.Status, v.Note, v.ResolvedBy);

    /// <summary>Cep güncellemesinin tüm yayınları: SlotsUpdated, SummaryUpdated, ViolationDetected/Resolved.</summary>
    public async Task PublishSlotUpdateAsync(IRealtimeNotifier notifier, ParkingLot lot, SlotUpdateResult result, CancellationToken ct = default)
    {
        await BroadcastSlotChangesAsync(notifier, lot, result.ChangedCodes, ct);
        foreach (var v in result.OpenedViolations) await notifier.ViolationDetectedAsync(v);
        foreach (var v in result.ResolvedViolations) await notifier.ViolationResolvedAsync(v);
    }

    /// <summary>Değişen cepler için SlotsUpdated ve ardından SummaryUpdated yayınlar (her ikisinde de lotCode var).</summary>
    public async Task BroadcastSlotChangesAsync(IRealtimeNotifier notifier, ParkingLot lot, IReadOnlyCollection<string> changedCodes, CancellationToken ct = default)
    {
        var snap = await GetLotSnapshotAsync(lot, ct);
        if (changedCodes.Count > 0)
        {
            var set = new HashSet<string>(changedCodes, StringComparer.OrdinalIgnoreCase);
            var changed = ToSlotDtos(snap).Where(s => set.Contains(s.Code)).ToList();
            await notifier.SlotsUpdatedAsync(changed);
        }
        await notifier.SummaryUpdatedAsync(snap.ToSummary());
    }

    /// <summary>Tüm aktif otoparkların özetini yayınlar (rezervasyon süre aşımı, demo verisi vb. sonrası).</summary>
    public async Task BroadcastAllSummariesAsync(IRealtimeNotifier notifier, CancellationToken ct = default)
    {
        var lots = await db.ParkingLots.AsNoTracking().Where(l => l.IsActive).OrderBy(l => l.Id).ToListAsync(ct);
        foreach (var lot in lots)
            await notifier.SummaryUpdatedAsync((await GetLotSnapshotAsync(lot, ct)).ToSummary());
    }

    // ---------------- Araç bulma (UC-06) ----------------

    /// <summary>Otopark parametresi gerekmez: aktif oturum hangi otoparktaysa o döner.</summary>
    public async Task<LocateDto> LocateAsync(string plate, CancellationToken ct = default)
    {
        var normalized = PlateHelper.Normalize(plate);
        if (normalized.Length == 0) throw AppException.BadRequest("Plaka giriniz.");

        var session = await db.ParkingSessions.AsNoTracking()
            .Include(s => s.Zone)
            .Include(s => s.Lot)
            .Include(s => s.Reservation)
            .Where(s => s.Plate == normalized && s.Status == SessionStatus.Active)
            .OrderByDescending(s => s.EntryTime)
            .FirstOrDefaultAsync(ct)
            ?? throw AppException.NotFound("Araç içeride bulunamadı");

        var now = UtcNow;
        var ctx = await GetFeeContextAsync(ct);
        var charge = ComputeCharge(session, ctx, now);
        return new LocateDto(
            session.Plate,
            session.Zone?.Code,
            session.Zone?.Name,
            session.Zone?.Floor,
            session.EntryTime,
            TimeHelper.MinutesBetween(session.EntryTime, now),
            charge.Due,
            session.IsPaid && charge.Due == 0m,
            session.Lot?.Code,
            session.Lot?.Name);
    }
}
