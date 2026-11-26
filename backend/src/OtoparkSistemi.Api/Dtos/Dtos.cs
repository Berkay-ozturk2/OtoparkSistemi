using OtoparkSistemi.Api.Domain;

namespace OtoparkSistemi.Api.Dtos;

// Tüm DTO'lar JSON'da camelCase olarak serileştirilir; enum'lar string'dir.
// İstek kayıtlarındaki string alanlar bilinçli olarak nullable'dır; doğrulama servislerde yapılır.

public record ErrorResponse(string Message);

// ---------- Kimlik doğrulama ----------
public record LoginRequest(string? Email, string? Password);

public record RegisterRequest(
    string? FullName,
    string? Email,
    string? Phone,
    string? Password,
    bool KvkkAccepted,
    bool MarketingConsent);

public record UserDto(int Id, string FullName, string Email, string Phone, UserRole Role)
{
    public static UserDto From(User u) => new(u.Id, u.FullName, u.Email, u.Phone, u.Role);
}

public record LoginResponse(string Token, UserDto User);

// ---------- Otopark (herkese açık) ----------

/// <summary>
/// Free: normal araçlar için boş yer (= boş Standard cepler). Engelli cepler Disabled* alanlarında ayrıca verilir.
/// Total tüm (kullanımdaki) cepleri, Occupied/Reserved her iki türü kapsar.
/// </summary>
public record SummaryDto(
    string LotCode,
    int Total,
    int Occupied,
    int Free,
    int Reserved,
    double OccupancyRate,
    int DisabledTotal,
    int DisabledOccupied,
    int DisabledFree);

/// <summary>FreeSlots: normal araçlar için boş (Standard) cep sayısı.</summary>
public record ZoneDto(
    int Id,
    string Code,
    string Name,
    int Floor,
    int TotalSlots,
    int FreeSlots,
    int DisabledTotal,
    int DisabledFree);

public record SlotDto(
    int Id,
    string Code,
    string LotCode,
    string ZoneCode,
    int Floor,
    SlotType Type,
    bool IsOccupied,
    bool IsReserved,
    bool HasViolation,
    bool IsActive,
    DateTime UpdatedAt,
    int MapX,
    int MapY,
    int MapW,
    int MapH);

public record RecommendationDto(
    string LotCode,
    string? ZoneCode,
    string? ZoneName,
    int? Floor,
    int FreeSlots,
    string? SlotCode,
    SlotType? SlotType);

public record LocateDto(
    string Plate,
    string? ZoneCode,
    string? ZoneName,
    int? Floor,
    DateTime EntryTime,
    int DurationMinutes,
    decimal CurrentFee,
    bool IsPaid,
    string? LotCode,
    string? LotName);

// ---------- Çoklu otopark (v2) ----------
public record FloorDto(int Floor, string Name);

/// <summary>
/// Krokide çizilecek süs: type = road | entry | exit | building | elevator | label | green.
/// Floor: katlı otoparkta yalnızca o katta çizilir; null ise tüm katlarda çizilir.
/// </summary>
public record MapDecorDto(string Type, int X, int Y, int W, int H, string? Text, int? Floor = null);

public record ParkingLotDto(
    int Id,
    string Code,
    string Name,
    string? Address,
    string? Description,
    int MapWidth,
    int MapHeight,
    List<FloorDto> Floors,
    List<MapDecorDto> Decor,
    bool IsActive,
    double? Latitude = null,
    double? Longitude = null);

/// <summary>/api/parking/lots öğesi. FreeSlots = normal araçlar için boş (Standard) cep sayısı.</summary>
public record LotSummaryDto(
    int Id,
    string Code,
    string Name,
    string? Address,
    string? Description,
    List<FloorDto> Floors,
    int TotalSlots,
    int FreeSlots,
    int DisabledTotal,
    int DisabledFree,
    double OccupancyRate,
    bool IsActive,
    int MapWidth,
    int MapHeight,
    double? Latitude = null,
    double? Longitude = null);

public record LayoutZoneDto(int Id, string Code, string Name, int Floor);

public record LotLayoutDto(ParkingLotDto Lot, List<LayoutZoneDto> Zones, List<SlotDto> Slots);

public record UpdateLotRequest(string? Name, string? Address, string? Description, bool? IsActive,
    double? Latitude = null, double? Longitude = null);

public record UpdateSlotRequest(SlotType? Type, bool? IsActive);

public record TariffDto(int Id, string Name, int MinMinutes, int MaxMinutes, decimal Price, bool IsActive)
{
    public static TariffDto From(Tariff t) => new(t.Id, t.Name, t.MinMinutes, t.MaxMinutes, t.Price, t.IsActive);
}

// ---------- Görüntü servisi ----------
public record PlateEventRequest(
    string? CameraId,
    GateType Gate,
    string? Plate,
    double Confidence,
    bool FormatValid,
    DateTime? Timestamp,
    string? ImageBase64,
    string? LotCode = null);

public record GateDecisionResponse(
    int EventId,
    GateDecision Decision,
    string Message,
    int? SessionId,
    string? SuggestedZone,
    decimal Fee,
    string? SuggestedSlot = null,
    bool IsDisabledPermit = false,
    string? LotCode = null,
    SlotType? SlotType = null);

public record OccupancySlotRequest(string? Code, bool Occupied, double? Confidence);

public record OccupancyRequest(string? CameraId, DateTime? Timestamp, List<OccupancySlotRequest>? Slots, string? LotCode = null);

public record AgentHeartbeat(string? Id, string? Type, string? Status, double? Fps, string? LastError, string? LotCode = null);

public record HeartbeatRequest(List<AgentHeartbeat>? Agents);

public record AgentStatusDto(
    string Id,
    string? Type,
    string? Status,
    double? Fps,
    string? LastError,
    DateTime LastSeen,
    bool IsOnline,
    string? LotCode);

// ---------- Araçlar ----------
public record VehicleDto(int Id, string Plate, string? Nickname, PermitStatus? DisabledPermitStatus);

public record CreateVehicleRequest(string? Plate, string? Nickname);

// ---------- Rezervasyon ----------
public record ReservationDto(
    int Id,
    string Plate,
    string? LotCode,
    string? LotName,
    string ZoneCode,
    string ZoneName,
    SlotType SlotType,
    DateTime StartTime,
    DateTime EndTime,
    decimal Amount,
    ReservationStatus Status,
    DateTime CreatedAt);

/// <summary>lotCode verilmezse varsayılan otopark (GAZI), slotType verilmezse Standard.</summary>
public record ReservationQuoteRequest(
    string? LotCode,
    string? ZoneCode,
    SlotType? SlotType,
    DateTime StartTime,
    DateTime EndTime);

public record ReservationQuoteDto(decimal Amount, bool Available, string Message);

public record CreateReservationRequest(
    string? Plate,
    string? LotCode,
    string? ZoneCode,
    SlotType? SlotType,
    DateTime StartTime,
    DateTime EndTime);

// ---------- Oturumlar ----------
public record SessionDto(
    int Id,
    string Plate,
    string? LotCode,
    string? LotName,
    string? ZoneCode,
    DateTime EntryTime,
    DateTime? ExitTime,
    int DurationMinutes,
    decimal Fee,
    decimal PaidAmount,
    bool IsPaid,
    SessionStatus Status,
    bool IsDisabledPermit);

public record AbandonedSessionDto(
    int Id,
    string Plate,
    string? LotCode,
    string? LotName,
    string? ZoneCode,
    DateTime EntryTime,
    DateTime? ExitTime,
    int DurationMinutes,
    decimal Fee,
    decimal PaidAmount,
    bool IsPaid,
    SessionStatus Status,
    bool IsDisabledPermit,
    double OverdueHours);

// ---------- Ödeme ----------
public record PaymentQuoteDto(int SessionId, string Plate, DateTime EntryTime, int DurationMinutes, decimal Amount, bool IsPaid);

public record CardDto(string? HolderName, string? Number, string? ExpireMonth, string? ExpireYear, string? Cvc);

public record PayRequest(int? SessionId, int? ReservationId, CardDto? Card);

public record PaymentResultDto(int PaymentId, PaymentStatus Status, decimal Amount, string Message, string? TransactionId);

// ---------- KVKK ----------
public record CreatePrivacyRequest(string? FullName, string? Email, string? Plate, PrivacyRequestType Type, string? Message);

public record PrivacyRequestDto(
    int Id,
    string FullName,
    string Email,
    string? Plate,
    PrivacyRequestType Type,
    string? Message,
    PrivacyRequestStatus Status,
    string? Note,
    DateTime CreatedAt,
    DateTime? ResolvedAt)
{
    public static PrivacyRequestDto From(PrivacyRequest p) =>
        new(p.Id, p.FullName, p.Email, p.Plate, p.Type, p.Message, p.Status, p.Note, p.CreatedAt, p.ResolvedAt);
}

public record UpdatePrivacyRequest(PrivacyRequestStatus Status, string? Note);

// ---------- Operatör ----------
public record ReviewItemDto(
    int Id,
    int GateEventId,
    string CameraId,
    GateType Gate,
    string PlateRead,
    double Confidence,
    string? ImageBase64,
    DateTime CreatedAt,
    string? LotCode);

public record ResolveReviewRequest(string? CorrectedPlate, bool Approve);

/// <summary>lotCode verilmezse varsayılan otopark (GAZI).</summary>
public record ManualPlateRequest(string? Plate, string? LotCode = null);

public record SlotOverrideRequest(bool Occupied);

public record GateEventDto(
    int Id,
    string CameraId,
    GateType Gate,
    string Plate,
    double Confidence,
    GateDecision Decision,
    string Message,
    bool IsManual,
    DateTime CreatedAt,
    string? LotCode,
    bool IsDisabledPermit)
{
    public static GateEventDto From(GateEvent e) =>
        new(e.Id, e.CameraId, e.Gate, e.Plate, e.Confidence, e.Decision, e.Message, e.IsManual, e.CreatedAt,
            e.LotCode, e.IsDisabledPermit);
}

/// <summary>SignalR "GateEvent" yükü: GateEvent + önerilen bölge + bariyer durumu.</summary>
public record GateEventBroadcastDto(
    int Id,
    string CameraId,
    GateType Gate,
    string Plate,
    double Confidence,
    GateDecision Decision,
    string Message,
    bool IsManual,
    DateTime CreatedAt,
    int? SessionId,
    string? SuggestedZone,
    decimal Fee,
    string BarrierState,
    string? LotCode,
    bool IsDisabledPermit,
    string? SuggestedSlot,
    SlotType? SlotType);

// ---------- Engelli izinleri ----------

/// <summary>IsValid: Approved ve süresi dolmamış (sözleşmeye ek, salt okunur alan).</summary>
public record DisabledPermitDto(
    int Id,
    string Plate,
    string HolderName,
    int? UserId,
    string? UserEmail,
    string? DocumentNo,
    PermitStatus Status,
    DateTime? ValidUntil,
    string? Note,
    DateTime CreatedAt,
    DateTime? ReviewedAt,
    string? ReviewedBy,
    bool IsValid);

public record CreatePermitRequest(string? Plate, string? HolderName, string? DocumentNo);

public record AdminCreatePermitRequest(string? Plate, string? HolderName, string? DocumentNo, DateTime? ValidUntil);

public record UpdatePermitRequest(PermitStatus? Status, DateTime? ValidUntil, string? Note);

public record PermitCheckDto(string Plate, bool Valid, DisabledPermitDto? Permit);

// ---------- İhlaller ----------
public record ViolationDto(
    int Id,
    string LotCode,
    string LotName,
    string SlotCode,
    string? ZoneCode,
    int? Floor,
    DateTime DetectedAt,
    DateTime? ResolvedAt,
    ViolationStatus Status,
    string? Note,
    string? ResolvedBy);

public record ResolveViolationRequest(ViolationStatus? Status, string? Note);

/// <summary>SignalR "ViolationResolved" yükü.</summary>
public record ViolationResolvedDto(int Id, string LotCode, string SlotCode, ViolationStatus Status);

// ---------- Yönetici ----------
public record TariffRequest(string? Name, int MinMinutes, int MaxMinutes, decimal Price, bool? IsActive);

public record SettingsDto(
    double ConfidenceThreshold,
    int AbandonedThresholdHours,
    int GracePeriodMinutes,
    int FreeMinutes,
    decimal DailyMaxFee,
    decimal ReservationHourlyPrice,
    int DataRetentionDays)
{
    public static SettingsDto From(SystemSettings s) =>
        new(s.ConfidenceThreshold, s.AbandonedThresholdHours, s.GracePeriodMinutes, s.FreeMinutes,
            s.DailyMaxFee, s.ReservationHourlyPrice, s.DataRetentionDays);
}

/// <summary>Kısmi güncelleme: gönderilmeyen alanlar değişmez.</summary>
public record UpdateSettingsRequest(
    double? ConfidenceThreshold,
    int? AbandonedThresholdHours,
    int? GracePeriodMinutes,
    int? FreeMinutes,
    decimal? DailyMaxFee,
    decimal? ReservationHourlyPrice,
    int? DataRetentionDays);

public record AdminUserDto(int Id, string FullName, string Email, string Phone, UserRole Role, bool IsActive, DateTime CreatedAt)
{
    public static AdminUserDto From(User u) => new(u.Id, u.FullName, u.Email, u.Phone, u.Role, u.IsActive, u.CreatedAt);
}

public record CreateUserRequest(string? FullName, string? Email, string? Phone, string? Password, UserRole Role);

public record UpdateUserRequest(string? FullName, string? Phone, UserRole? Role, bool? IsActive);

public record AuditLogDto(int Id, string? UserEmail, string Action, string? Details, string? IpAddress, DateTime CreatedAt);

public record DemoDataResultDto(int Sessions, int Payments, int ActiveSessions, int AbandonedSessions, string Message);

// ---------- Raporlar ----------
public record HourlyOccupancyDto(int Hour, int Entries, double AverageOccupancyRate);

public record DailyOccupancyDto(string Date, int Entries, double AverageDurationMinutes, int? PeakHour);

public record OccupancyReportDto(
    DateTime From,
    DateTime To,
    int TotalEntries,
    double AverageDurationMinutes,
    List<HourlyOccupancyDto> Hourly,
    List<DailyOccupancyDto> Daily);

public record RevenueSeriesDto(string Period, decimal Amount, int Count);

public record RevenueByMethodDto(PaymentMethod Method, decimal Amount);

public record RevenueReportDto(
    DateTime From,
    DateTime To,
    decimal Total,
    int Count,
    decimal AveragePerSession,
    List<RevenueSeriesDto> Series,
    List<RevenueByMethodDto> ByMethod);
