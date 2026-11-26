using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.BackgroundServices;

/// <summary>
/// Dakikada bir:
///  - Bitiş zamanı geçmiş Confirmed rezervasyonlar → Expired
///  - 15 dakikadır ödenmemiş PendingPayment rezervasyonlar → Cancelled
/// </summary>
public class ReservationExpiryWorker(IServiceScopeFactory scopeFactory, TimeProvider clock, ILogger<ReservationExpiryWorker> logger)
    : BackgroundService
{
    public const int PendingPaymentTimeoutMinutes = 15;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
            do
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var changed = await ApplyAsync(db, clock.GetUtcNow().UtcDateTime, stoppingToken);
                    if (changed > 0)
                    {
                        logger.LogInformation("{Count} rezervasyonun durumu güncellendi (süre aşımı).", changed);
                        var parking = scope.ServiceProvider.GetRequiredService<ParkingService>();
                        var notifier = scope.ServiceProvider.GetRequiredService<IRealtimeNotifier>();
                        await parking.BroadcastAllSummariesAsync(notifier, stoppingToken);
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "Rezervasyon süre aşımı görevi başarısız oldu.");
                }
            } while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // Uygulama kapanıyor
        }
    }

    public static async Task<int> ApplyAsync(AppDbContext db, DateTime nowUtc, CancellationToken ct = default)
    {
        var expired = await db.Reservations
            .Where(r => r.Status == ReservationStatus.Confirmed && r.EndTime < nowUtc)
            .ToListAsync(ct);
        foreach (var r in expired) r.Status = ReservationStatus.Expired;

        var pendingCutoff = nowUtc.AddMinutes(-PendingPaymentTimeoutMinutes);
        var stale = await db.Reservations
            .Where(r => r.Status == ReservationStatus.PendingPayment && r.CreatedAt < pendingCutoff)
            .ToListAsync(ct);
        foreach (var r in stale) r.Status = ReservationStatus.Cancelled;

        var changed = expired.Count + stale.Count;
        if (changed > 0) await db.SaveChangesAsync(ct);
        return changed;
    }
}
