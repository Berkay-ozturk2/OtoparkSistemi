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
        await AddMissingColumnsAsync(db, logger, ct);
        await CreateMissingTablesAsync(db, logger, ct);
        await DbSeeder.SeedAsync(db, ct);
    }

    /// <summary>
    /// Veri SİLMEDEN eklenebilen yeni sütunlar. EnsureCreated var olan tabloya sütun eklemediği için
    /// sonradan eklenen alanlar burada ALTER TABLE ile eklenir (ör. otopark konumu — yol tarifi özelliği).
    /// Sütun zaten varsa hiçbir şey yapılmaz.
    /// </summary>
    public static async Task AddMissingColumnsAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        var sqlite = db.Database.IsSqlite();
        var columns = new[]
        {
            ("ParkingLots", "Latitude", sqlite ? "REAL" : "double precision"),
            ("ParkingLots", "Longitude", sqlite ? "REAL" : "double precision"),
            // Krokiden cep ataması: eski veritabanında FK kısıtı olmadan eklenir, ilişki EF tarafında çalışır.
            ("ParkingSessions", "SlotId", sqlite ? "INTEGER" : "integer"),
        };
        foreach (var (table, column, type) in columns)
        {
            if (await ColumnExistsAsync(db, table, column, ct)) continue;
            // Tablo/sütun adları sabit listeden gelir (kullanıcı girdisi değildir)
#pragma warning disable EF1002
            await db.Database.ExecuteSqlRawAsync($"ALTER TABLE \"{table}\" ADD COLUMN \"{column}\" {type} NULL", ct);
#pragma warning restore EF1002
            logger.LogInformation("Veritabanına sütun eklendi: {Table}.{Column} (veriler korundu)", table, column);
        }
    }

    /// <summary>Sonradan eklenen, veri silmeden oluşturulabilen tablolar.</summary>
    public static readonly string[] AddableTables = ["Subscriptions"];

    /// <summary>
    /// EnsureCreated var olan veritabanına yeni tablo eklemez. Eksik tablolar, EF'in bu sağlayıcı için ürettiği
    /// oluşturma betiğinden yalnızca o tabloya ait CREATE TABLE / CREATE INDEX ifadeleri çalıştırılarak eklenir
    /// (şema sürümü artırılmaz, mevcut veri korunur).
    /// </summary>
    public static async Task CreateMissingTablesAsync(AppDbContext db, ILogger logger, CancellationToken ct = default)
    {
        string? script = null;
        foreach (var table in AddableTables)
        {
            if (await TableExistsAsync(db, table, ct)) continue;
            script ??= db.Database.GenerateCreateScript();
            var quoted = $"\"{table}\"";
            var statements = script
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(s =>
                    s.StartsWith($"CREATE TABLE {quoted}", StringComparison.Ordinal) ||
                    (s.StartsWith("CREATE", StringComparison.Ordinal) && s.Contains("INDEX", StringComparison.Ordinal) &&
                     s.Contains($" ON {quoted}", StringComparison.Ordinal)))
                .ToList();
            if (statements.Count == 0)
            {
                logger.LogWarning("{Table} tablosu için oluşturma ifadesi bulunamadı.", table);
                continue;
            }
            // İfadeler EF modelinden üretilir (kullanıcı girdisi değildir)
#pragma warning disable EF1002
            foreach (var sql in statements)
                await db.Database.ExecuteSqlRawAsync(sql, ct);
#pragma warning restore EF1002
            logger.LogInformation("Veritabanına tablo eklendi: {Table} (veriler korundu)", table);
        }
    }

    public static async Task<bool> TableExistsAsync(AppDbContext db, string table, CancellationToken ct = default)
    {
#pragma warning disable EF1002
        var sql = db.Database.IsSqlite()
            ? $"SELECT COUNT(*) AS \"Value\" FROM sqlite_master WHERE type = 'table' AND name = '{table}'"
            : $"SELECT COUNT(*)::int AS \"Value\" FROM information_schema.tables WHERE table_name = '{table}'";
        var count = await db.Database.SqlQueryRaw<int>(sql).SingleAsync(ct);
#pragma warning restore EF1002
        return count > 0;
    }

    /// <summary>
    /// Sütun var mı? Şema kataloğundan bakılır. (Not: SQLite'ta SELECT "YokSutun" hata VERMEZ; bilinmeyen
    /// çift tırnaklı ad metin sabiti sayılır. Bu yüzden deneme-sorgusu yerine katalog kullanılır.)
    /// </summary>
    public static async Task<bool> ColumnExistsAsync(AppDbContext db, string table, string column, CancellationToken ct = default)
    {
#pragma warning disable EF1002
        var sql = db.Database.IsSqlite()
            ? $"SELECT COUNT(*) AS \"Value\" FROM pragma_table_info('{table}') WHERE name = '{column}'"
            : $"SELECT COUNT(*)::int AS \"Value\" FROM information_schema.columns WHERE table_name = '{table}' AND column_name = '{column}'";
        var count = await db.Database.SqlQueryRaw<int>(sql).SingleAsync(ct);
#pragma warning restore EF1002
        return count > 0;
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
