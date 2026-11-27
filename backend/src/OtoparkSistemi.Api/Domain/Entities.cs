namespace OtoparkSistemi.Api.Domain;

// Not: Tüm DateTime alanları UTC olarak saklanır (AppDbContext içindeki dönüştürücü Kind=Utc garantiler).

public class User
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; } = UserRole.Driver;
    public bool IsActive { get; set; } = true;
    public bool KvkkAccepted { get; set; }
    public DateTime? KvkkAcceptedAt { get; set; }
    public bool MarketingConsent { get; set; }
    public DateTime CreatedAt { get; set; }

    public List<Vehicle> Vehicles { get; set; } = new();
}

public class Vehicle
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    public string Plate { get; set; } = string.Empty;
    public string? Nickname { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Otopark (v2: çoklu otopark). Bölge ve cep kodları otopark içinde benzersizdir.
/// Katlar ve kroki süsleri JSON olarak saklanır (yalnızca görüntüleme amaçlı, sorgulanmaz).
/// </summary>
public class ParkingLot
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    public string? Description { get; set; }

    /// <summary>Kroki tuvalinin genişliği / yüksekliği (her otoparkta ayrı).</summary>
    public int MapWidth { get; set; } = 1000;
    public int MapHeight { get; set; } = 600;

    /// <summary>[{floor, name}] JSON dizisi.</summary>
    public string FloorsJson { get; set; } = "[]";

    /// <summary>[{type, x, y, w, h, text}] JSON dizisi (yollar, giriş/çıkış, bina, asansör, etiketler).</summary>
    public string DecorJson { get; set; } = "[]";

    /// <summary>Otopark girişinin coğrafi konumu (WGS84). Haritada gösterim ve yol tarifi için.</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }

    public List<Zone> Zones { get; set; } = new();
}

public class Zone
{
    public int Id { get; set; }
    public int LotId { get; set; }
    public ParkingLot? Lot { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int Floor { get; set; }

    public List<ParkingSlot> Slots { get; set; } = new();
}

public class ParkingSlot
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public int ZoneId { get; set; }
    public Zone? Zone { get; set; }

    /// <summary>Doluluk kamerasının (veya operatörün) bildirdiği durum.</summary>
    public bool IsOccupied { get; set; }
    public double? Confidence { get; set; }
    public DateTime UpdatedAt { get; set; }

    /// <summary>Normal / engelli park yeri.</summary>
    public SlotType Type { get; set; } = SlotType.Standard;

    /// <summary>false ise cep kullanım dışıdır (kapasiteye sayılmaz, krokide gösterilir).</summary>
    public bool IsActive { get; set; } = true;

    // Kroki koordinatları (otoparkın MapWidth x MapHeight tuvali)
    public int MapX { get; set; }
    public int MapY { get; set; }
    public int MapW { get; set; }
    public int MapH { get; set; }
}

public class ParkingSession
{
    public int Id { get; set; }
    public string Plate { get; set; } = string.Empty;

    /// <summary>Oturumun açıldığı otopark (eski/elle eklenmiş kayıtlarda boş olabilir).</summary>
    public int? LotId { get; set; }
    public ParkingLot? Lot { get; set; }

    /// <summary>Giriş anında plakanın geçerli engelli izni var mıydı.</summary>
    public bool IsDisabledPermit { get; set; }

    /// <summary>Girişte önerilen (veya rezervasyondaki) bölge.</summary>
    public int? ZoneId { get; set; }
    public Zone? Zone { get; set; }

    public int? ReservationId { get; set; }
    public Reservation? Reservation { get; set; }

    public DateTime EntryTime { get; set; }
    public DateTime? ExitTime { get; set; }

    /// <summary>Net ücret (tarife ücreti − rezervasyon ön ödemesi). Aktif oturumda son ödeme anındaki değerdir.</summary>
    public decimal Fee { get; set; }
    public decimal PaidAmount { get; set; }
    public bool IsPaid { get; set; }
    public DateTime? PaidAt { get; set; }
    public SessionStatus Status { get; set; } = SessionStatus.Active;
    public bool IsManualEntry { get; set; }
}

public class Reservation
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public User? User { get; set; }
    public string Plate { get; set; } = string.Empty;
    /// <summary>Otopark, bölge üzerinden belirlenir (Zone.LotId).</summary>
    public int ZoneId { get; set; }
    public Zone? Zone { get; set; }

    /// <summary>Standard kapasiteden mi, engelli kapasiteden mi ayrıldığı.</summary>
    public SlotType SlotType { get; set; } = SlotType.Standard;
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public decimal Amount { get; set; }
    public ReservationStatus Status { get; set; } = ReservationStatus.PendingPayment;
    public DateTime CreatedAt { get; set; }
    public DateTime? PaidAt { get; set; }
}

public class Payment
{
    public int Id { get; set; }
    public int? SessionId { get; set; }
    public ParkingSession? Session { get; set; }
    public int? ReservationId { get; set; }
    public Reservation? Reservation { get; set; }
    public decimal Amount { get; set; }
    public PaymentMethod Method { get; set; }
    public PaymentStatus Status { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string? TransactionId { get; set; }

    /// <summary>KVKK / PCI: kart numarasının yalnızca son 4 hanesi tutulur.</summary>
    public string? CardLast4 { get; set; }
    public string? Message { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class GateEvent
{
    public int Id { get; set; }

    /// <summary>Olayın gerçekleştiği otoparkın kodu.</summary>
    public string? LotCode { get; set; }
    public string CameraId { get; set; } = string.Empty;
    public GateType Gate { get; set; }
    public string Plate { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public bool FormatValid { get; set; }
    public GateDecision Decision { get; set; }
    public string Message { get; set; } = string.Empty;
    public bool IsManual { get; set; }
    public int? SessionId { get; set; }
    public ParkingSession? Session { get; set; }
    public string? SuggestedZone { get; set; }

    /// <summary>Önerilen cep (engelli izinli araçta engelli cep kodu).</summary>
    public string? SuggestedSlot { get; set; }

    /// <summary>Önerilen cebin türü (öneri yoksa null).</summary>
    public SlotType? SuggestedSlotType { get; set; }
    public bool IsDisabledPermit { get; set; }
    public decimal Fee { get; set; }

    /// <summary>Yalnızca plaka bölgesi kırpıntısı (KVKK). Saklama süresi sonunda silinir.</summary>
    public string? ImageBase64 { get; set; }

    /// <summary>Görüntü servisinin bildirdiği çekim zamanı.</summary>
    public DateTime? CapturedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public string? OperatorEmail { get; set; }
}

public class PlateReview
{
    public int Id { get; set; }
    public int GateEventId { get; set; }
    public GateEvent? GateEvent { get; set; }

    /// <summary>Okumanın yapıldığı otoparkın kodu.</summary>
    public string? LotCode { get; set; }
    public string CameraId { get; set; } = string.Empty;
    public GateType Gate { get; set; }
    public string PlateRead { get; set; } = string.Empty;
    public double Confidence { get; set; }
    public ReviewStatus Status { get; set; } = ReviewStatus.Pending;
    public string? CorrectedPlate { get; set; }
    public string? ResolvedBy { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class Tariff
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Dilim alt sınırı (hariç). Süre &gt; MinMinutes ve süre &lt;= MaxMinutes ise dilim uygulanır.</summary>
    public int MinMinutes { get; set; }
    public int MaxMinutes { get; set; }
    public decimal Price { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>Sistem ayarları (tek satır, Id = 1).</summary>
public class SystemSettings
{
    public int Id { get; set; } = 1;
    public double ConfidenceThreshold { get; set; } = 0.70;
    public int AbandonedThresholdHours { get; set; } = 24;
    public int GracePeriodMinutes { get; set; } = 15;
    public int FreeMinutes { get; set; } = 15;
    public decimal DailyMaxFee { get; set; } = 100m;
    public decimal ReservationHourlyPrice { get; set; } = 20m;
    public int DataRetentionDays { get; set; } = 30;

    /// <summary>Veritabanı şema sürümü (EnsureCreated ile oluşturulan eski şemayı tespit etmek için).</summary>
    public int SchemaVersion { get; set; } = Data.SchemaInfo.CurrentVersion;
    public DateTime UpdatedAt { get; set; }
}

public class AuditLog
{
    public int Id { get; set; }
    public string? UserEmail { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? Details { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class PrivacyRequest
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Plate { get; set; }
    public PrivacyRequestType Type { get; set; }
    public string? Message { get; set; }
    public PrivacyRequestStatus Status { get; set; } = PrivacyRequestStatus.Open;
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
}

/// <summary>
/// Engelli park izni. Yalnızca Approved ve süresi dolmamış (ValidUntil boş ya da gelecekte) izin geçerlidir.
/// KVKK saklama görevi bu kayıtlara dokunmaz (izin süresi boyunca saklanır).
/// </summary>
public class DisabledPermit
{
    public int Id { get; set; }
    public string Plate { get; set; } = string.Empty;
    public string HolderName { get; set; } = string.Empty;
    public int? UserId { get; set; }
    public User? User { get; set; }
    public string? DocumentNo { get; set; }
    public PermitStatus Status { get; set; } = PermitStatus.Pending;
    public DateTime? ValidUntil { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
}

/// <summary>Engelli park yerine izinsiz araç park etmesi (kamera ile tespit).</summary>
public class Violation
{
    public int Id { get; set; }
    public int LotId { get; set; }
    public ParkingLot? Lot { get; set; }
    public int SlotId { get; set; }
    public ParkingSlot? Slot { get; set; }
    public DateTime DetectedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public ViolationStatus Status { get; set; } = ViolationStatus.Open;
    public string? Note { get; set; }
    public string? ResolvedBy { get; set; }
}

/// <summary>
/// Aylık / yıllık abonelik. Sürücü başvurur (Pending), yönetici onaylar (Active) veya reddeder.
/// Başlangıç ve bitiş tarihleri onay anında kesinleşir; bitiş geçince abonelik kendiliğinden sona ermiş sayılır.
/// </summary>
public class Subscription
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public User? User { get; set; }
    public string Plate { get; set; } = string.Empty;
    public string HolderName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public int LotId { get; set; }
    public ParkingLot? Lot { get; set; }
    public SubscriptionPlan Plan { get; set; }

    /// <summary>Başvuru anındaki paket ücreti (sonradan fiyat değişse de korunur).</summary>
    public decimal Price { get; set; }
    public SubscriptionStatus Status { get; set; } = SubscriptionStatus.Pending;

    /// <summary>Başvuruda istenen başlangıç; onayda bugünden önceyse bugüne çekilir.</summary>
    public DateTime StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
}
