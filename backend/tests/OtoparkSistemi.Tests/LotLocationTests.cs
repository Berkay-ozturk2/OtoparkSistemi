using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using OtoparkSistemi.Api.Data;

namespace OtoparkSistemi.Tests;

/// <summary>Sözleşme bölüm 12: otopark konumları (harita ve yol tarifi).</summary>
public class LotLocationTests : IDisposable
{
    private readonly TestDb _t = new();

    public void Dispose() => _t.Dispose();

    [Fact]
    public async Task Seed_otoparklarin_hepsinin_Ankara_icinde_konumu_var()
    {
        var lots = await _t.Db.ParkingLots.AsNoTracking().ToListAsync();
        Assert.Equal(4, lots.Count);
        foreach (var lot in lots)
        {
            Assert.NotNull(lot.Latitude);
            Assert.NotNull(lot.Longitude);
            // Ankara merkezinin kabaca çevresi
            Assert.InRange(lot.Latitude!.Value, 39.80, 40.05);
            Assert.InRange(lot.Longitude!.Value, 32.60, 33.00);
        }
    }

    [Fact]
    public async Task Otopark_listesi_ve_kroki_konumu_dondurur()
    {
        var lots = await _t.Parking.GetLotsAsync();
        Assert.All(lots, l => Assert.True(l.Latitude.HasValue && l.Longitude.HasValue, l.Code));
        var merkez = lots.Single(l => l.Code == "MERKEZ");
        Assert.Equal(DbSeeder.DefaultLocations["MERKEZ"].Lat, merkez.Latitude!.Value, 5);

        var layout = await _t.Parking.GetLayoutAsync("HASTANE");
        Assert.Equal(DbSeeder.DefaultLocations["HASTANE"].Lng, layout.Lot.Longitude!.Value, 5);
    }

    [Fact]
    public async Task Eski_veritabanina_konum_sutunlari_veri_silinmeden_eklenir()
    {
        // Yol tarifi özelliğinden ÖNCEKİ şemayı taklit et: konum sütunları yok
        await _t.Db.Database.ExecuteSqlRawAsync("ALTER TABLE \"ParkingLots\" DROP COLUMN \"Latitude\"");
        await _t.Db.Database.ExecuteSqlRawAsync("ALTER TABLE \"ParkingLots\" DROP COLUMN \"Longitude\"");
        _t.Db.ChangeTracker.Clear();
        var usersBefore = await _t.Db.Users.CountAsync();

        await SchemaGuard.AddMissingColumnsAsync(_t.Db, NullLogger.Instance);
        await DbSeeder.SeedAsync(_t.Db);
        _t.Db.ChangeTracker.Clear();

        var lots = await _t.Db.ParkingLots.AsNoTracking().ToListAsync();
        Assert.Equal(4, lots.Count);                                   // otoparklar silinmedi
        Assert.All(lots, l => Assert.NotNull(l.Latitude));             // varsayılan konum dolduruldu
        Assert.Equal(usersBefore, await _t.Db.Users.CountAsync());     // kullanıcılar korundu

        // İkinci çağrı hiçbir şey yapmaz (sütunlar zaten var)
        await SchemaGuard.AddMissingColumnsAsync(_t.Db, NullLogger.Instance);
    }

    [Fact]
    public async Task Elle_girilen_konuma_seed_dokunmaz()
    {
        var gazi = await _t.Db.ParkingLots.SingleAsync(l => l.Code == "GAZI");
        gazi.Latitude = 39.9;
        gazi.Longitude = 32.8;
        await _t.Db.SaveChangesAsync();

        await DbSeeder.SeedAsync(_t.Db);
        _t.Db.ChangeTracker.Clear();

        var again = await _t.Db.ParkingLots.AsNoTracking().SingleAsync(l => l.Code == "GAZI");
        Assert.Equal(39.9, again.Latitude!.Value, 6);
        Assert.Equal(32.8, again.Longitude!.Value, 6);
    }
}
