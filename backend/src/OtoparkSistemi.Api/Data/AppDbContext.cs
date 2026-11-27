using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using OtoparkSistemi.Api.Domain;

namespace OtoparkSistemi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Vehicle> Vehicles => Set<Vehicle>();
    public DbSet<ParkingLot> ParkingLots => Set<ParkingLot>();
    public DbSet<Zone> Zones => Set<Zone>();
    public DbSet<ParkingSlot> ParkingSlots => Set<ParkingSlot>();
    public DbSet<ParkingSession> ParkingSessions => Set<ParkingSession>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<GateEvent> GateEvents => Set<GateEvent>();
    public DbSet<PlateReview> PlateReviews => Set<PlateReview>();
    public DbSet<Tariff> Tariffs => Set<Tariff>();
    public DbSet<SystemSettings> Settings => Set<SystemSettings>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<PrivacyRequest> PrivacyRequests => Set<PrivacyRequest>();
    public DbSet<DisabledPermit> DisabledPermits => Set<DisabledPermit>();
    public DbSet<Violation> Violations => Set<Violation>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();

    // SQLite DateTime'ı Kind=Unspecified döndürür, Npgsql (timestamptz) ise Kind=Utc ister.
    // Bu dönüştürücüler yazarken UTC'ye çevirir, okurken Kind=Utc işaretler.
    private static readonly ValueConverter<DateTime, DateTime> UtcConverter =
        new(v => ToUtc(v), v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    private static readonly ValueConverter<DateTime?, DateTime?> NullableUtcConverter =
        new(v => v.HasValue ? ToUtc(v.Value) : v,
            v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);

    private static DateTime ToUtc(DateTime value)
    {
        if (value.Kind == DateTimeKind.Utc) return value;
        if (value.Kind == DateTimeKind.Local) return value.ToUniversalTime();
        return DateTime.SpecifyKind(value, DateTimeKind.Utc);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>(e =>
        {
            e.Property(x => x.FullName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Email).HasMaxLength(150).IsRequired();
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Phone).HasMaxLength(20);
            e.Property(x => x.PasswordHash).HasMaxLength(100);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(20);
            e.HasMany(x => x.Vehicles).WithOne(v => v.User).HasForeignKey(v => v.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Vehicle>(e =>
        {
            e.Property(x => x.Plate).HasMaxLength(32).IsRequired();
            e.Property(x => x.Nickname).HasMaxLength(50);
            e.HasIndex(x => new { x.UserId, x.Plate }).IsUnique();
            e.HasIndex(x => x.Plate);
        });

        modelBuilder.Entity<ParkingLot>(e =>
        {
            e.Property(x => x.Code).HasMaxLength(20).IsRequired();
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Name).HasMaxLength(150).IsRequired();
            e.Property(x => x.Address).HasMaxLength(300);
            e.Property(x => x.Description).HasMaxLength(1000);
            e.HasMany(x => x.Zones).WithOne(z => z.Lot).HasForeignKey(z => z.LotId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Zone>(e =>
        {
            e.Property(x => x.Code).HasMaxLength(10).IsRequired();
            // Bölge kodu otopark içinde benzersizdir
            e.HasIndex(x => new { x.LotId, x.Code }).IsUnique();
            e.Property(x => x.Name).HasMaxLength(100).IsRequired();
            e.HasMany(x => x.Slots).WithOne(s => s.Zone).HasForeignKey(s => s.ZoneId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ParkingSlot>(e =>
        {
            e.Property(x => x.Code).HasMaxLength(10).IsRequired();
            // Cep kodu otopark içinde benzersizdir (seed ve yönetim bunu korur); veritabanında bölge + kod benzersiz
            e.HasIndex(x => new { x.ZoneId, x.Code }).IsUnique();
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
        });

        modelBuilder.Entity<ParkingSession>(e =>
        {
            e.Property(x => x.Plate).HasMaxLength(32).IsRequired();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Fee).HasPrecision(10, 2);
            e.Property(x => x.PaidAmount).HasPrecision(10, 2);
            e.HasIndex(x => new { x.Plate, x.Status });
            e.HasIndex(x => x.EntryTime);
            e.HasOne(x => x.Zone).WithMany().HasForeignKey(x => x.ZoneId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Lot).WithMany().HasForeignKey(x => x.LotId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Reservation).WithMany().HasForeignKey(x => x.ReservationId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Reservation>(e =>
        {
            e.Property(x => x.Plate).HasMaxLength(32).IsRequired();
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.SlotType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Amount).HasPrecision(10, 2);
            e.HasIndex(x => new { x.ZoneId, x.StartTime });
            e.HasIndex(x => x.Plate);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Zone).WithMany().HasForeignKey(x => x.ZoneId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Payment>(e =>
        {
            e.Property(x => x.Amount).HasPrecision(10, 2);
            e.Property(x => x.Method).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Provider).HasMaxLength(30);
            e.Property(x => x.TransactionId).HasMaxLength(64);
            e.Property(x => x.CardLast4).HasMaxLength(4);
            e.Property(x => x.Message).HasMaxLength(200);
            e.Property(x => x.CreatedBy).HasMaxLength(150);
            e.HasIndex(x => x.CreatedAt);
            e.HasOne(x => x.Session).WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Reservation).WithMany().HasForeignKey(x => x.ReservationId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<GateEvent>(e =>
        {
            e.Property(x => x.LotCode).HasMaxLength(20);
            e.Property(x => x.SuggestedSlot).HasMaxLength(10);
            e.Property(x => x.SuggestedSlotType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.CameraId).HasMaxLength(50);
            e.Property(x => x.Plate).HasMaxLength(32);
            e.Property(x => x.Gate).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Decision).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Message).HasMaxLength(300);
            e.Property(x => x.SuggestedZone).HasMaxLength(10);
            e.Property(x => x.Fee).HasPrecision(10, 2);
            e.Property(x => x.OperatorEmail).HasMaxLength(150);
            e.HasIndex(x => x.CreatedAt);
            e.HasOne(x => x.Session).WithMany().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<PlateReview>(e =>
        {
            e.Property(x => x.LotCode).HasMaxLength(20);
            e.Property(x => x.CameraId).HasMaxLength(50);
            e.Property(x => x.Gate).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.PlateRead).HasMaxLength(32);
            e.Property(x => x.CorrectedPlate).HasMaxLength(32);
            e.Property(x => x.ResolvedBy).HasMaxLength(150);
            e.HasIndex(x => x.Status);
            e.HasOne(x => x.GateEvent).WithMany().HasForeignKey(x => x.GateEventId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Tariff>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(50);
            e.Property(x => x.Price).HasPrecision(10, 2);
        });

        modelBuilder.Entity<SystemSettings>(e =>
        {
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.DailyMaxFee).HasPrecision(10, 2);
            e.Property(x => x.ReservationHourlyPrice).HasPrecision(10, 2);
        });

        modelBuilder.Entity<AuditLog>(e =>
        {
            e.Property(x => x.UserEmail).HasMaxLength(150);
            e.Property(x => x.Action).HasMaxLength(100);
            e.Property(x => x.Details).HasMaxLength(1000);
            e.Property(x => x.IpAddress).HasMaxLength(64);
            e.HasIndex(x => x.CreatedAt);
        });

        modelBuilder.Entity<PrivacyRequest>(e =>
        {
            e.Property(x => x.FullName).HasMaxLength(100);
            e.Property(x => x.Email).HasMaxLength(150);
            e.Property(x => x.Plate).HasMaxLength(32);
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Message).HasMaxLength(2000);
            e.Property(x => x.Note).HasMaxLength(1000);
        });

        modelBuilder.Entity<DisabledPermit>(e =>
        {
            e.Property(x => x.Plate).HasMaxLength(32).IsRequired();
            e.Property(x => x.HolderName).HasMaxLength(100).IsRequired();
            e.Property(x => x.DocumentNo).HasMaxLength(50);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.ReviewedBy).HasMaxLength(150);
            e.HasIndex(x => x.Plate);
            e.HasIndex(x => x.Status);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Violation>(e =>
        {
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.ResolvedBy).HasMaxLength(150);
            e.HasIndex(x => new { x.LotId, x.Status });
            e.HasIndex(x => x.DetectedAt);
            e.HasOne(x => x.Lot).WithMany().HasForeignKey(x => x.LotId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Slot).WithMany().HasForeignKey(x => x.SlotId).OnDelete(DeleteBehavior.Cascade);
        });

        // Not: Bu tablo eski veritabanlarına SchemaGuard.CreateMissingTablesAsync ile (veri silinmeden) eklenir.
        // Sütun/uzunluk değişirse oradaki CREATE TABLE ifadeleri de güncellenmelidir.
        modelBuilder.Entity<Subscription>(e =>
        {
            e.Property(x => x.Plate).HasMaxLength(32).IsRequired();
            e.Property(x => x.HolderName).HasMaxLength(100).IsRequired();
            e.Property(x => x.Phone).HasMaxLength(20);
            e.Property(x => x.Plan).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Price).HasPrecision(10, 2);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.ReviewedBy).HasMaxLength(150);
            e.HasIndex(x => x.Plate);
            e.HasIndex(x => x.Status);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
            e.HasOne(x => x.Lot).WithMany().HasForeignKey(x => x.LotId).OnDelete(DeleteBehavior.Cascade);
        });

        // Tüm DateTime alanlarına UTC dönüştürücüsü uygula
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                if (property.ClrType == typeof(DateTime))
                    property.SetValueConverter(UtcConverter);
                else if (property.ClrType == typeof(DateTime?))
                    property.SetValueConverter(NullableUtcConverter);
            }
        }
    }
}
