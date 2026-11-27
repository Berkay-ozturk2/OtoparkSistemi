using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>Paket ücretleri (appsettings: "Subscriptions": { "MonthlyPrice", "YearlyPrice" }).</summary>
public sealed class SubscriptionPricing
{
    public decimal MonthlyPrice { get; set; } = 1500m;
    public decimal YearlyPrice { get; set; } = 15000m;

    public decimal PriceOf(SubscriptionPlan plan) => plan == SubscriptionPlan.Yearly ? YearlyPrice : MonthlyPrice;

    public static int MonthsOf(SubscriptionPlan plan) => plan == SubscriptionPlan.Yearly ? 12 : 1;
}

/// <summary>Abonelik başvurusu (sürücü), onay / ret / iptal ve raporlar (yönetici).</summary>
public class SubscriptionService(AppDbContext db, SubscriptionPricing pricing, TimeProvider clock)
{
    /// <summary>İstenen başlangıç tarihi en fazla bu kadar gün ileride olabilir.</summary>
    public const int MaxStartDaysAhead = 60;

    /// <summary>Raporda "yakında bitecek" sayılan gün sayısı.</summary>
    public const int ExpiringSoonDays = 14;

    private DateTime Now => clock.GetUtcNow().UtcDateTime;

    // ---------------- Paketler ----------------

    public List<SubscriptionPlanDto> GetPlans()
    {
        var monthly = pricing.MonthlyPrice;
        var yearly = pricing.YearlyPrice;
        var yearlyMonthly = Math.Round(yearly / 12m, 2);
        var saving = monthly > 0 ? (int)Math.Round((1m - yearly / (monthly * 12m)) * 100m) : 0;
        return
        [
            new(SubscriptionPlan.Monthly, "Aylık", 1, monthly, monthly, 0),
            new(SubscriptionPlan.Yearly, "Yıllık", 12, yearly, yearlyMonthly, Math.Max(0, saving))
        ];
    }

    // ---------------- Sürücü ----------------

    public async Task<List<SubscriptionDto>> GetMyAsync(int userId, CancellationToken ct = default)
    {
        var list = await Query()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.Id)
            .ToListAsync(ct);
        var now = Now;
        return list.Select(s => ToDto(s, now)).ToList();
    }

    public async Task<SubscriptionDto> CreateAsync(int userId, CreateSubscriptionRequest req, CancellationToken ct = default)
    {
        var plate = PlateHelper.Normalize(req.Plate);
        if (!PlateHelper.IsValid(plate))
            throw AppException.BadRequest("Geçerli bir Türk plakası giriniz (ör. 34 ABC 123).");
        if (req.Plan is null || !Enum.IsDefined(req.Plan.Value))
            throw AppException.BadRequest("Aylık veya yıllık paketlerden birini seçiniz.");
        if (string.IsNullOrWhiteSpace(req.HolderName) || req.HolderName.Trim().Length < 3)
            throw AppException.BadRequest("Abonelik sahibinin adını ve soyadını yazınız.");
        if (string.IsNullOrWhiteSpace(req.LotCode))
            throw AppException.BadRequest("Abone olmak istediğiniz otoparkı seçiniz.");

        var phone = NormalizePhone(req.Phone);

        var lotCode = LotDefaults.Normalize(req.LotCode);
        var lot = await db.ParkingLots.AsNoTracking().FirstOrDefaultAsync(l => l.Code == lotCode, ct)
                  ?? throw AppException.NotFound("Otopark bulunamadı.");
        if (!lot.IsActive)
            throw AppException.BadRequest("Bu otopark şu anda hizmet vermiyor; başka bir otopark seçiniz.");

        var ownsVehicle = await db.Vehicles.AnyAsync(v => v.UserId == userId && v.Plate == plate, ct);
        if (!ownsVehicle)
            throw AppException.BadRequest("Başvuru yapılan plaka, hesabınıza kayıtlı araçlarınızdan biri olmalıdır.");

        var now = Now;
        var today = now.Date;
        var start = req.StartDate.HasValue ? TimeHelper.AsUtc(req.StartDate.Value).Date : today;
        if (start < today)
            throw AppException.BadRequest("Başlangıç tarihi bugünden önce olamaz.");
        if (start > today.AddDays(MaxStartDaysAhead))
            throw AppException.BadRequest($"Başlangıç tarihi en fazla {MaxStartDaysAhead} gün sonrası olabilir.");

        await EnsureNoOpenSubscriptionAsync(plate, lot.Id, now, excludeId: null, ct);

        var sub = new Subscription
        {
            UserId = userId,
            Plate = plate,
            HolderName = Truncate(req.HolderName.Trim(), 100),
            Phone = phone,
            LotId = lot.Id,
            Plan = req.Plan.Value,
            Price = pricing.PriceOf(req.Plan.Value),
            Status = SubscriptionStatus.Pending,
            StartDate = start,
            CreatedAt = now
        };
        db.Subscriptions.Add(sub);
        await db.SaveChangesAsync(ct);
        return await GetDtoAsync(sub.Id, ct);
    }

    /// <summary>Sürücü yalnızca kendi BEKLEYEN başvurusunu geri çekebilir.</summary>
    public async Task<SubscriptionDto> CancelOwnAsync(int userId, int id, CancellationToken ct = default)
    {
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == userId, ct)
                  ?? throw AppException.NotFound("Abonelik başvurusu bulunamadı.");
        if (sub.Status != SubscriptionStatus.Pending)
            throw AppException.BadRequest("Yalnızca değerlendirme bekleyen başvurular geri çekilebilir.");
        sub.Status = SubscriptionStatus.Cancelled;
        sub.ReviewedAt = Now;
        await db.SaveChangesAsync(ct);
        return await GetDtoAsync(sub.Id, ct);
    }

    // ---------------- Yönetici ----------------

    public async Task<List<SubscriptionDto>> GetAllAsync(string? status, string? lotCode, CancellationToken ct = default)
    {
        var query = Query();
        if (!string.IsNullOrWhiteSpace(status))
        {
            if (!Enum.TryParse<SubscriptionStatus>(status.Trim(), ignoreCase: true, out var parsed) || !Enum.IsDefined(parsed))
                throw AppException.BadRequest("Geçersiz durum. Pending, Active, Rejected veya Cancelled olmalıdır.");
            query = query.Where(s => s.Status == parsed);
        }
        if (!string.IsNullOrWhiteSpace(lotCode))
        {
            var code = LotDefaults.Normalize(lotCode);
            query = query.Where(s => s.Lot!.Code == code);
        }

        var list = await query.OrderByDescending(s => s.Id).ToListAsync(ct);
        var now = Now;
        return list.Select(s => ToDto(s, now)).ToList();
    }

    public Task<int> CountPendingAsync(CancellationToken ct = default) =>
        db.Subscriptions.CountAsync(s => s.Status == SubscriptionStatus.Pending, ct);

    /// <summary>Onay (Pending → Active), ret (Pending → Rejected, gerekçe zorunlu) veya iptal (→ Cancelled).</summary>
    public async Task<SubscriptionDto> AdminUpdateAsync(int id, UpdateSubscriptionRequest req, string? adminEmail, CancellationToken ct = default)
    {
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.Id == id, ct)
                  ?? throw AppException.NotFound("Abonelik bulunamadı.");
        if (req.Status.HasValue && !Enum.IsDefined(req.Status.Value))
            throw AppException.BadRequest("Geçersiz durum.");

        var now = Now;
        var note = string.IsNullOrWhiteSpace(req.Note) ? null : Truncate(req.Note.Trim(), 500);

        if (req.Status.HasValue && req.Status.Value != sub.Status)
        {
            switch (req.Status.Value)
            {
                case SubscriptionStatus.Active:
                    if (sub.Status != SubscriptionStatus.Pending)
                        throw AppException.BadRequest("Yalnızca bekleyen başvurular onaylanabilir.");
                    await EnsureNoOpenSubscriptionAsync(sub.Plate, sub.LotId, now, excludeId: sub.Id, ct);
                    if (sub.StartDate < now.Date) sub.StartDate = now.Date;
                    sub.EndDate = sub.StartDate.AddMonths(SubscriptionPricing.MonthsOf(sub.Plan));
                    break;
                case SubscriptionStatus.Rejected:
                    if (sub.Status != SubscriptionStatus.Pending)
                        throw AppException.BadRequest("Yalnızca bekleyen başvurular reddedilebilir.");
                    if (note == null)
                        throw AppException.BadRequest("Ret gerekçesini yazınız; başvuru sahibi bu notu görür.");
                    break;
                case SubscriptionStatus.Cancelled:
                    if (sub.Status is not (SubscriptionStatus.Pending or SubscriptionStatus.Active))
                        throw AppException.BadRequest("Bu abonelik zaten kapanmış.");
                    break;
                default:
                    throw AppException.BadRequest("Abonelik tekrar bekleme durumuna alınamaz.");
            }
            sub.Status = req.Status.Value;
            sub.ReviewedAt = now;
            sub.ReviewedBy = adminEmail;
        }

        if (req.Note != null) sub.Note = note;

        await db.SaveChangesAsync(ct);
        return await GetDtoAsync(sub.Id, ct);
    }

    /// <summary>
    /// Yıllık rapor: onaylanan (Active ya da sonradan iptal edilen) abonelikler onay ayına göre sayılır; gelir paket
    /// ücretlerinin toplamıdır. Anlık sayılar (aktif, bekleyen, yakında bitecek) yıl filtresinden bağımsızdır.
    /// </summary>
    public async Task<SubscriptionReportDto> GetReportAsync(int? year, string? lotCode, CancellationToken ct = default)
    {
        var now = Now;
        var y = year ?? now.Year;
        if (y < 2000 || y > now.Year + 1) throw AppException.BadRequest("Geçersiz yıl.");

        var query = db.Subscriptions.AsNoTracking().Include(s => s.Lot).AsQueryable();
        if (!string.IsNullOrWhiteSpace(lotCode))
        {
            var code = LotDefaults.Normalize(lotCode);
            query = query.Where(s => s.Lot!.Code == code);
        }
        // Tarih hesapları bellekte yapılır (sağlayıcıdan bağımsız)
        var all = await query.ToListAsync(ct);

        var approved = all
            .Where(s => s.EndDate.HasValue && s.ReviewedAt.HasValue && s.ReviewedAt.Value.Year == y &&
                        s.Status is SubscriptionStatus.Active or SubscriptionStatus.Cancelled)
            .ToList();
        var months = Enumerable.Range(1, 12).Select(m =>
        {
            var inMonth = approved.Where(s => s.ReviewedAt!.Value.Month == m).ToList();
            return new SubscriptionReportMonthDto(
                m,
                inMonth.Count(s => s.Plan == SubscriptionPlan.Monthly),
                inMonth.Count(s => s.Plan == SubscriptionPlan.Yearly),
                inMonth.Sum(s => s.Price));
        }).ToList();

        var current = all.Where(s => IsCurrent(s, now)).ToList();
        var soon = now.AddDays(ExpiringSoonDays);
        return new SubscriptionReportDto(
            y,
            approved.Count(s => s.Plan == SubscriptionPlan.Monthly),
            approved.Count(s => s.Plan == SubscriptionPlan.Yearly),
            approved.Sum(s => s.Price),
            current.Count,
            current.Count(s => s.Plan == SubscriptionPlan.Monthly),
            current.Count(s => s.Plan == SubscriptionPlan.Yearly),
            all.Count(s => s.Status == SubscriptionStatus.Pending),
            current.Count(s => s.EndDate!.Value <= soon),
            months);
    }

    // ---------------- yardımcılar ----------------

    public static bool IsCurrent(Subscription s, DateTime now) =>
        s.Status == SubscriptionStatus.Active && s.EndDate.HasValue && s.StartDate <= now && s.EndDate.Value > now;

    public static bool IsExpired(Subscription s, DateTime now) =>
        s.Status == SubscriptionStatus.Active && s.EndDate.HasValue && s.EndDate.Value <= now;

    private IQueryable<Subscription> Query() =>
        db.Subscriptions.AsNoTracking().Include(s => s.User).Include(s => s.Lot);

    private async Task<SubscriptionDto> GetDtoAsync(int id, CancellationToken ct)
    {
        var s = await Query().FirstAsync(x => x.Id == id, ct);
        return ToDto(s, Now);
    }

    private static SubscriptionDto ToDto(Subscription s, DateTime now) =>
        new(s.Id, s.Plate, s.HolderName, s.Phone, s.UserId, s.User?.Email, s.Lot?.Code ?? string.Empty, s.Lot?.Name ?? string.Empty,
            s.Plan, s.Price, s.Status, s.StartDate, s.EndDate, s.Note, s.CreatedAt, s.ReviewedAt, s.ReviewedBy,
            IsCurrent(s, now), IsExpired(s, now));

    /// <summary>Aynı otoparkta aynı plakanın bekleyen veya süresi dolmamış onaylı aboneliği varsa 409.</summary>
    private async Task EnsureNoOpenSubscriptionAsync(string plate, int lotId, DateTime now, int? excludeId, CancellationToken ct)
    {
        var open = await db.Subscriptions.AsNoTracking()
            .Where(s => s.Plate == plate && s.LotId == lotId && s.Id != (excludeId ?? 0) &&
                        (s.Status == SubscriptionStatus.Pending || s.Status == SubscriptionStatus.Active))
            .ToListAsync(ct);
        if (open.Any(s => s.Status == SubscriptionStatus.Pending))
            throw AppException.Conflict("Bu plaka için bu otoparkta değerlendirme bekleyen bir başvuru zaten var.");
        if (open.Any(s => s.EndDate.HasValue && s.EndDate.Value > now))
            throw AppException.Conflict("Bu plakanın bu otoparkta devam eden bir aboneliği var.");
    }

    /// <summary>Boş bırakılabilir; doluysa 10 haneli (başında 0 olmadan) Türkiye cep/sabit numarası olmalı.</summary>
    private static string? NormalizePhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        if (digits.StartsWith("90", StringComparison.Ordinal) && digits.Length == 12) digits = digits[2..];
        if (digits.StartsWith('0') && digits.Length == 11) digits = digits[1..];
        if (digits.Length != 10 || digits[0] == '0')
            throw AppException.BadRequest("Telefon numarasını 05XX XXX XX XX biçiminde yazınız.");
        return "0" + digits.ToString(CultureInfo.InvariantCulture);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
