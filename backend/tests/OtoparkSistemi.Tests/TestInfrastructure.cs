using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

/// <summary>Elle ilerletilebilen saat.</summary>
public sealed class ManualTimeProvider(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now = _now.Add(by);
}

/// <summary>SQLite bellek içi veritabanı + seed verisi + servisler.</summary>
public sealed class TestDb : IDisposable
{
    private readonly SqliteConnection _connection;

    public AppDbContext Db { get; }
    public ManualTimeProvider Clock { get; }
    public ParkingService Parking { get; }
    public GateService Gate { get; }
    public PaymentService Payments { get; }
    public ReservationService Reservations { get; }
    public PermitService Permits { get; }

    public TestDb()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_connection)
            .Options;
        Db = new AppDbContext(options);
        Db.Database.EnsureCreated();
        DbSeeder.SeedAsync(Db).GetAwaiter().GetResult();

        Clock = new ManualTimeProvider(new DateTimeOffset(2026, 11, 25, 8, 0, 0, TimeSpan.Zero));
        Parking = new ParkingService(Db, Clock);
        Gate = new GateService(Db, Parking, new NullRealtimeNotifier(), Clock);
        var audit = new AuditService(Db, new HttpContextAccessor(), Clock);
        Payments = new PaymentService(Db, Parking, new MockPaymentProvider(Clock), audit, Clock);
        Reservations = new ReservationService(Db, Parking, Clock);
        Permits = new PermitService(Db, new NullRealtimeNotifier(), Clock);
    }

    public DateTime Now => Clock.GetUtcNow().UtcDateTime;

    public void Dispose()
    {
        Db.Dispose();
        _connection.Dispose();
    }
}
