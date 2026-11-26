using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace OtoparkSistemi.Api.Data;

/// <summary>Veritabanı şema sürümü. Şemayı değiştiren her sürümde bir artırılır.</summary>
public static class SchemaInfo
{
    /// <summary>1: tek otopark (ilk sürüm, SchemaVersion sütunu yoktu), 2: çoklu otopark + engelli yerleri.</summary>
    public const int CurrentVersion = 2;
}

/// <summary>
/// EnsureCreated ile oluşturulmuş ESKİ şemalı veritabanını tespit eder ve (prototip/geliştirme kolaylığı için)
/// silip yeniden oluşturur. Migration kullanılmadığı için eski bir otopark.db üzerinde yeni tablolar oluşmaz;
/// bu durumda uygulama ilk sorguda çökerdi.
/// Şema güncelse HİÇBİR ŞEY silinmez (ikinci ve sonraki açılışlarda veri korunur).
/// </summary>
public static class SchemaGuard
{
    public static async Task EnsureDatabaseAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        if (await NeedsResetAsync(db, logger, ct))
        {
            logger.LogWarning(
                "Veritabanı şeması eski sürümde (beklenen sürüm: {Version}). Prototip modunda veritabanı SİLİNİP yeniden oluşturuluyor; " +
                "önceki oturum/ödeme kayıtları kaybolur. Hazır kullanıcılar ve otoparklar yeniden eklenecek.",
                SchemaInfo.CurrentVersion);
            // SQLite bağlantı havuzu dosyayı açık tutabilir (Windows'ta silmeyi engeller)
            if (db.Database.IsSqlite()) SqliteConnection.ClearAllPools();
            await db.Database.EnsureDeletedAsync(ct);
        }

        await db.Database.EnsureCreatedAsync(ct);
        await DbSeeder.SeedAsync(db, ct);
    }

    /// <summary>
    /// true: veritabanı var, içinde tablo var ama şema eski (ParkingLots tablosu ya da SchemaVersion sütunu yok
    /// veya kayıtlı sürüm düşük). Veritabanı hiç yoksa veya boşsa false (EnsureCreated oluşturur).
    /// </summary>
    private static async Task<bool> NeedsResetAsync(AppDbContext db, ILogger logger, CancellationToken ct)
    {
        bool canConnect;
        try
        {
            canConnect = await db.Database.CanConnectAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogDebug(ex, "Veritabanına bağlanılamadı; yeni veritabanı oluşturulacak.");
            return false;
        }
        if (!canConnect) return false;

        // Eski şemada bile var olan "Users" tablosu yoksa veritabanı boştur → sıfırlamaya gerek yok
        bool hasUsersTable;
        try
        {
            await db.Users.AsNoTracking().AnyAsync(ct);
            hasUsersTable = true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            hasUsersTable = false;
        }
        if (!hasUsersTable) return false;

        try
        {
            // Eski şemada bu tablo / sütunlar yoktur → istisna fırlar
            await db.ParkingLots.AsNoTracking().AnyAsync(ct);
            await db.DisabledPermits.AsNoTracking().AnyAsync(ct);
            var version = await db.Settings.AsNoTracking()
                .OrderBy(s => s.Id)
                .Select(s => (int?)s.SchemaVersion)
                .FirstOrDefaultAsync(ct);
            // Ayar satırı yoksa seed ekler (sürüm güncel kabul edilir)
            return version.HasValue && version.Value < SchemaInfo.CurrentVersion;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogDebug(ex, "Şema denetimi başarısız: eski şema varsayılıyor.");
            return true;
        }
    }
}
