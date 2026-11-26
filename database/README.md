# Veritabanı

Şema, backend'deki EF Core modelinden (`backend/src/OtoparkSistemi.Api/Domain/Entities.cs`,
`Data/AppDbContext.cs`) ilk açılışta otomatik oluşturulur (`EnsureCreated`), başlangıç verileri
`Data/DbSeeder.cs` ile eklenir.

- Varsayılan: SQLite (`otopark.db`) — kurulum gerektirmez.
- PostgreSQL 17: `scripts\postgresql_baslat.bat` (Docker) → kullanıcı `otopark`, parola `otopark123`, veritabanı `otopark`;
  ardından `appsettings.json` → `"Database": { "Provider": "PostgreSQL" }`.

Tablolar: Users, Vehicles, Zones, ParkingSlots, ParkingSessions, Reservations, Payments, GateEvents,
PlateReviews, Tariffs, SystemSettings, AuditLogs, PrivacyRequests.

ER diyagramı ve migration'lara geçiş (`dotnet ef migrations add Ilk`) için bkz. `backend/README.md`.
