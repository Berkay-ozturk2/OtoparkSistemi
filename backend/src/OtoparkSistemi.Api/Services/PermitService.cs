using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>
/// Engelli izni geçerlilik kuralları (sözleşme 11.1): yalnızca Approved ve süresi dolmamış
/// (ValidUntil boş ya da gelecekte) izin geçerlidir. Plaka normalize edilerek eşleşir.
/// Diğer servisler (giriş, rezervasyon, ihlal tespiti) bu statik yardımcıları kendi DbContext'leriyle kullanır.
/// </summary>
public static class PermitRules
{
    public static bool IsValid(DisabledPermit p, DateTime nowUtc) =>
        p.Status == PermitStatus.Approved && (!p.ValidUntil.HasValue || p.ValidUntil.Value > nowUtc);

    /// <summary>Plakanın geçerli izni var mı?</summary>
    public static async Task<bool> HasValidPermitAsync(AppDbContext db, string plate, DateTime nowUtc, CancellationToken ct = default)
    {
        var normalized = PlateHelper.Normalize(plate);
        if (normalized.Length == 0) return false;
        // Tarih karşılaştırması bellekte yapılır (sağlayıcıdan bağımsız)
        var permits = await db.DisabledPermits.AsNoTracking()
            .Where(p => p.Plate == normalized && p.Status == PermitStatus.Approved)
            .ToListAsync(ct);
        return permits.Any(p => IsValid(p, nowUtc));
    }

    /// <summary>Geçerli izni olan tüm plakalar.</summary>
    public static async Task<HashSet<string>> GetValidPlatesAsync(AppDbContext db, DateTime nowUtc, CancellationToken ct = default)
    {
        var permits = await db.DisabledPermits.AsNoTracking()
            .Where(p => p.Status == PermitStatus.Approved)
            .ToListAsync(ct);
        return permits.Where(p => IsValid(p, nowUtc)).Select(p => p.Plate).ToHashSet(StringComparer.Ordinal);
    }

    public static DisabledPermitDto ToDto(DisabledPermit p, DateTime nowUtc) =>
        new(p.Id, p.Plate, p.HolderName, p.UserId, p.User?.Email, p.DocumentNo, p.Status, p.ValidUntil, p.Note,
            p.CreatedAt, p.ReviewedAt, p.ReviewedBy, IsValid(p, nowUtc));
}

/// <summary>Engelli izni başvuruları: sürücü başvurusu, yönetici onay/ret/iptal, gişe kontrolü.</summary>
public class PermitService(AppDbContext db, IRealtimeNotifier notifier, TimeProvider clock)
{
    public const int MaxValidYears = 10;

    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    // ---------------- Sürücü ----------------

    /// <summary>Sürücünün başvuruları + kayıtlı araçlarının plakalarına verilmiş izinler.</summary>
    public async Task<List<DisabledPermitDto>> GetMyAsync(int userId, CancellationToken ct = default)
    {
        var plates = await db.Vehicles.AsNoTracking()
            .Where(v => v.UserId == userId)
            .Select(v => v.Plate)
            .ToListAsync(ct);

        var list = await db.DisabledPermits.AsNoTracking()
            .Include(p => p.User)
            .Where(p => p.UserId == userId || plates.Contains(p.Plate))
            .OrderByDescending(p => p.Id)
            .ToListAsync(ct);
        var now = Now;
        return list.Select(p => PermitRules.ToDto(p, now)).ToList();
    }

    public async Task<DisabledPermitDto> CreateAsync(int userId, CreatePermitRequest req, CancellationToken ct = default)
    {
        var plate = PlateHelper.Normalize(req.Plate);
        if (!PlateHelper.IsValid(plate))
            throw AppException.BadRequest("Geçerli bir Türk plakası giriniz (ör. 34 ABC 123).");
        if (string.IsNullOrWhiteSpace(req.HolderName))
            throw AppException.BadRequest("İzin sahibinin adı soyadı zorunludur.");
        if (string.IsNullOrWhiteSpace(req.DocumentNo))
            throw AppException.BadRequest("Engelli belgesi / kart numarası zorunludur.");

        var ownsVehicle = await db.Vehicles.AnyAsync(v => v.UserId == userId && v.Plate == plate, ct);
        if (!ownsVehicle)
            throw AppException.BadRequest("Başvuru yapılan plaka hesabınıza kayıtlı araçlarınızdan biri olmalıdır.");

        await EnsureNoActivePermitAsync(plate, ct);

        var now = Now;
        var permit = new DisabledPermit
        {
            Plate = plate,
            HolderName = Truncate(req.HolderName.Trim(), 100),
            UserId = userId,
            DocumentNo = Truncate(req.DocumentNo.Trim(), 50),
            Status = PermitStatus.Pending,
            CreatedAt = now
        };
        db.DisabledPermits.Add(permit);
        await db.SaveChangesAsync(ct);
        await PublishPendingCountAsync(ct);

        await db.Entry(permit).Reference(p => p.User).LoadAsync(ct);
        return PermitRules.ToDto(permit, now);
    }

    // ---------------- Yönetici ----------------

    public async Task<List<DisabledPermitDto>> GetAllAsync(string? status, CancellationToken ct = default)
    {
        var query = db.DisabledPermits.AsNoTracking().Include(p => p.User).AsQueryable();
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<PermitStatus>(status.Trim(), ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
                throw AppException.BadRequest("Geçersiz durum. Pending, Approved, Rejected veya Revoked olmalıdır.");
            query = query.Where(p => p.Status == parsed);
        }

        var list = await query.OrderByDescending(p => p.Id).ToListAsync(ct);
        var now = Now;
        return list.Select(p => PermitRules.ToDto(p, now)).ToList();
    }

    /// <summary>Gişede belge görülerek doğrudan onaylı izin. Aynı plakanın bekleyen başvurusu varsa o onaylanır.</summary>
    public async Task<DisabledPermitDto> AdminCreateAsync(AdminCreatePermitRequest req, string? adminEmail, CancellationToken ct = default)
    {
        var plate = PlateHelper.Normalize(req.Plate);
        if (!PlateHelper.IsValid(plate))
            throw AppException.BadRequest("Geçerli bir Türk plakası giriniz (ör. 34 ABC 123).");
        if (string.IsNullOrWhiteSpace(req.HolderName))
            throw AppException.BadRequest("İzin sahibinin adı soyadı zorunludur.");

        var now = Now;
        var validUntil = ValidateValidUntil(req.ValidUntil, now);

        var existing = await db.DisabledPermits
            .Where(p => p.Plate == plate && (p.Status == PermitStatus.Pending || p.Status == PermitStatus.Approved))
            .OrderByDescending(p => p.Id)
            .ToListAsync(ct);
        if (existing.Any(p => PermitRules.IsValid(p, now)))
            throw AppException.Conflict("Bu plaka için geçerli bir engelli izni zaten var.");

        var permit = existing.FirstOrDefault(p => p.Status == PermitStatus.Pending);
        if (permit == null)
        {
            // Plaka bir kullanıcının aracıysa izni o kullanıcıya bağla
            var ownerId = await db.Vehicles.AsNoTracking()
                .Where(v => v.Plate == plate)
                .OrderBy(v => v.Id)
                .Select(v => (int?)v.UserId)
                .FirstOrDefaultAsync(ct);
            permit = new DisabledPermit { Plate = plate, UserId = ownerId, CreatedAt = now };
            db.DisabledPermits.Add(permit);
        }

        permit.HolderName = Truncate(req.HolderName.Trim(), 100);
        if (!string.IsNullOrWhiteSpace(req.DocumentNo)) permit.DocumentNo = Truncate(req.DocumentNo.Trim(), 50);
        permit.Status = PermitStatus.Approved;
        permit.ValidUntil = validUntil;
        permit.ReviewedAt = now;
        permit.ReviewedBy = adminEmail;
        await db.SaveChangesAsync(ct);
        await PublishPendingCountAsync(ct);

        await db.Entry(permit).Reference(p => p.User).LoadAsync(ct);
        return PermitRules.ToDto(permit, now);
    }

    /// <summary>Onay / ret / iptal; geçerlilik tarihi ve not güncelleme.</summary>
    public async Task<DisabledPermitDto> AdminUpdateAsync(int id, UpdatePermitRequest req, string? adminEmail, CancellationToken ct = default)
    {
        var permit = await db.DisabledPermits.Include(p => p.User).FirstOrDefaultAsync(p => p.Id == id, ct)
                     ?? throw AppException.NotFound("Engelli izni bulunamadı.");
        var now = Now;

        if (req.Status.HasValue && !Enum.IsDefined(req.Status.Value))
            throw AppException.BadRequest("Geçersiz durum.");

        if (req.ValidUntil.HasValue)
            permit.ValidUntil = ValidateValidUntil(req.ValidUntil, now);

        if (req.Status.HasValue && req.Status.Value != permit.Status)
        {
            if (req.Status.Value == PermitStatus.Approved)
            {
                // Aynı plakada başka geçerli izin varsa çift onay engellenir
                var otherValid = (await db.DisabledPermits.AsNoTracking()
                        .Where(p => p.Plate == permit.Plate && p.Id != permit.Id && p.Status == PermitStatus.Approved)
                        .ToListAsync(ct))
                    .Any(p => PermitRules.IsValid(p, now));
                if (otherValid)
                    throw AppException.Conflict("Bu plaka için geçerli başka bir engelli izni zaten var.");
                if (permit.ValidUntil.HasValue && permit.ValidUntil.Value <= now)
                    throw AppException.BadRequest("Onay için geçerlilik tarihi gelecekte olmalıdır.");
            }
            permit.Status = req.Status.Value;
            permit.ReviewedAt = now;
            permit.ReviewedBy = adminEmail;
        }

        if (req.Note != null)
            permit.Note = string.IsNullOrWhiteSpace(req.Note) ? null : Truncate(req.Note.Trim(), 500);

        await db.SaveChangesAsync(ct);
        await PublishPendingCountAsync(ct);
        return PermitRules.ToDto(permit, now);
    }

    // ---------------- Gişe kontrolü ----------------

    public async Task<PermitCheckDto> CheckAsync(string plate, CancellationToken ct = default)
    {
        var normalized = PlateHelper.Normalize(plate);
        if (normalized.Length == 0) throw AppException.BadRequest("Plaka giriniz.");

        var now = Now;
        var permits = await db.DisabledPermits.AsNoTracking()
            .Include(p => p.User)
            .Where(p => p.Plate == normalized)
            .OrderByDescending(p => p.Id)
            .ToListAsync(ct);

        // Geçerli izin varsa o, yoksa en son başvuru gösterilir
        var valid = permits.FirstOrDefault(p => PermitRules.IsValid(p, now));
        var shown = valid ?? permits.FirstOrDefault();
        return new PermitCheckDto(normalized, valid != null, shown == null ? null : PermitRules.ToDto(shown, now));
    }

    public Task<int> CountPendingAsync(CancellationToken ct = default) =>
        db.DisabledPermits.CountAsync(p => p.Status == PermitStatus.Pending, ct);

    // ---------------- yardımcılar ----------------

    private async Task EnsureNoActivePermitAsync(string plate, CancellationToken ct)
    {
        var now = Now;
        var existing = await db.DisabledPermits.AsNoTracking()
            .Where(p => p.Plate == plate && (p.Status == PermitStatus.Pending || p.Status == PermitStatus.Approved))
            .ToListAsync(ct);
        if (existing.Any(p => p.Status == PermitStatus.Pending || PermitRules.IsValid(p, now)))
            throw AppException.Conflict("Bu plaka için bekleyen veya onaylı bir engelli izni başvurusu zaten var.");
    }

    private static DateTime? ValidateValidUntil(DateTime? value, DateTime now)
    {
        if (!value.HasValue) return null;
        var utc = TimeHelper.AsUtc(value.Value);
        if (utc <= now) throw AppException.BadRequest("Geçerlilik tarihi gelecekte olmalıdır.");
        if (utc > now.AddYears(MaxValidYears))
            throw AppException.BadRequest($"Geçerlilik süresi en fazla {MaxValidYears} yıl olabilir.");
        return utc;
    }

    private async Task PublishPendingCountAsync(CancellationToken ct) =>
        await notifier.PermitsChangedAsync(await CountPendingAsync(ct));

    private static string Truncate(string value, int max) => value.Length <= max ? value : value.Substring(0, max);
}
