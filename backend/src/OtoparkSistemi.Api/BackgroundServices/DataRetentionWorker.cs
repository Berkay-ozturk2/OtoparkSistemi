using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.BackgroundServices;

/// <summary>
/// KVKK veri saklama görevi (saatte bir):
///  - dataRetentionDays'ten eski TAMAMLANMIŞ oturumların, geçiş olaylarının, sonuçlanmış onay kayıtlarının ve
///    kapanmış rezervasyonların plakaları SHA-256 özetiyle ("HASH:...") anonimleştirilir.
///  - Plaka görüntüleri (imageBase64) min(dataRetentionDays, 7) günden eskiyse silinir.
///  - 90 günden eski denetim kayıtları silinir.
/// Engelli izinleri (DisabledPermit) BU GÖREVİN KAPSAMI DIŞINDADIR: izin kayıtları geçerlilik süresi boyunca
/// saklanır ve plakaları anonimleştirilmez (aksi hâlde izinli araç tanınamaz). İhlal kayıtları plaka içermez.
/// </summary>
public class DataRetentionWorker(IServiceScopeFactory scopeFactory, TimeProvider clock, ILogger<DataRetentionWorker> logger)
    : BackgroundService
{
    public const int AuditLogRetentionDays = 90;
    public const int MaxImageRetentionDays = 7;
    private const int BatchSize = 2000;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
            do
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var affected = await ApplyRetentionAsync(db, clock.GetUtcNow().UtcDateTime, stoppingToken);
                    if (affected > 0)
                        logger.LogInformation("KVKK saklama görevi: {Count} kayıt anonimleştirildi/silindi.", affected);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "KVKK veri saklama görevi başarısız oldu.");
                }
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // Uygulama kapanıyor
        }
    }

    /// <summary>Tek seferlik saklama işlemi (testten de çağrılabilir). Etkilenen kayıt sayısını döner.</summary>
    public static async Task<int> ApplyRetentionAsync(AppDbContext db, DateTime nowUtc, CancellationToken ct = default)
    {
        var settings = await db.Settings.AsNoTracking().OrderBy(s => s.Id).FirstOrDefaultAsync(ct);
        var retentionDays = Math.Max(1, settings?.DataRetentionDays ?? 30);
        var cutoff = nowUtc.AddDays(-retentionDays);
        var imageCutoff = nowUtc.AddDays(-Math.Min(retentionDays, MaxImageRetentionDays));
        var affected = 0;

        var sessions = await db.ParkingSessions
            .Where(s => s.Status == SessionStatus.Completed
                        && s.ExitTime != null && s.ExitTime < cutoff
                        && !s.Plate.StartsWith(PlateHelper.HashPrefix))
            .Take(BatchSize)
            .ToListAsync(ct);
        foreach (var s in sessions) s.Plate = PlateHelper.Anonymize(s.Plate);
        affected += sessions.Count;

        var oldEvents = await db.GateEvents
            .Where(e => e.CreatedAt < cutoff && !e.Plate.StartsWith(PlateHelper.HashPrefix))
            .Take(BatchSize)
            .ToListAsync(ct);
        foreach (var e in oldEvents)
        {
            e.Plate = PlateHelper.Anonymize(e.Plate);
            e.ImageBase64 = null;
        }
        affected += oldEvents.Count;

        var imageEvents = await db.GateEvents
            .Where(e => e.CreatedAt < imageCutoff && e.ImageBase64 != null)
            .Take(BatchSize)
            .ToListAsync(ct);
        foreach (var e in imageEvents) e.ImageBase64 = null;
        affected += imageEvents.Count;

        var reviews = await db.PlateReviews
            .Where(r => r.CreatedAt < cutoff
                        && r.Status != ReviewStatus.Pending
                        && !r.PlateRead.StartsWith(PlateHelper.HashPrefix))
            .Take(BatchSize)
            .ToListAsync(ct);
        foreach (var r in reviews)
        {
            r.PlateRead = PlateHelper.Anonymize(r.PlateRead);
            if (r.CorrectedPlate != null) r.CorrectedPlate = PlateHelper.Anonymize(r.CorrectedPlate);
        }
        affected += reviews.Count;

        var reservations = await db.Reservations
            .Where(r => r.EndTime < cutoff
                        && (r.Status == ReservationStatus.Completed || r.Status == ReservationStatus.Cancelled || r.Status == ReservationStatus.Expired)
                        && !r.Plate.StartsWith(PlateHelper.HashPrefix))
            .Take(BatchSize)
            .ToListAsync(ct);
        foreach (var r in reservations) r.Plate = PlateHelper.Anonymize(r.Plate);
        affected += reservations.Count;

        // Not: db.DisabledPermits'e bilinçli olarak dokunulmaz (bkz. sınıf açıklaması).
        await db.SaveChangesAsync(ct);

        var auditCutoff = nowUtc.AddDays(-AuditLogRetentionDays);
        affected += await db.AuditLogs.Where(a => a.CreatedAt < auditCutoff).ExecuteDeleteAsync(ct);

        return affected;
    }
}
