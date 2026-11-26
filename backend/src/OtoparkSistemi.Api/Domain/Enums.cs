namespace OtoparkSistemi.Api.Domain;

/// <summary>Kullanıcı rolleri: Sürücü, Otopark Görevlisi, Yönetici.</summary>
public enum UserRole
{
    Driver,
    Operator,
    Admin
}

/// <summary>Kamera / bariyer tipi.</summary>
public enum GateType
{
    Entry,
    Exit
}

/// <summary>Bariyer kararı.</summary>
public enum GateDecision
{
    Allowed,
    Denied,
    PendingReview
}

public enum SessionStatus
{
    Active,
    Completed
}

public enum ReservationStatus
{
    PendingPayment,
    Confirmed,
    CheckedIn,
    Completed,
    Cancelled,
    Expired
}

public enum PaymentMethod
{
    Card,
    Cash
}

public enum PaymentStatus
{
    Success,
    Failed
}

/// <summary>Operatör onay kuyruğundaki kaydın durumu.</summary>
public enum ReviewStatus
{
    Pending,
    Approved,
    Rejected
}

/// <summary>KVKK ilgili kişi talep türü.</summary>
public enum PrivacyRequestType
{
    Delete,
    Objection,
    Info
}

public enum PrivacyRequestStatus
{
    Open,
    Resolved,
    Rejected
}

/// <summary>Cep türü: normal veya engelli park yeri.</summary>
public enum SlotType
{
    Standard,
    Disabled
}

/// <summary>Engelli izni başvuru durumu.</summary>
public enum PermitStatus
{
    Pending,
    Approved,
    Rejected,
    Revoked
}

/// <summary>Engelli park yeri ihlal kaydının durumu.</summary>
public enum ViolationStatus
{
    Open,
    Resolved,
    FalseAlarm
}
