namespace OtoparkSistemi.Api.Services;

/// <summary>Sağlayıcıya iletilen kart bilgisi. Hiçbir zaman veritabanına yazılmaz veya loglanmaz.</summary>
public record CardInfo(string? HolderName, string? Number, string? ExpireMonth, string? ExpireYear, string? Cvc);

public record PaymentChargeRequest(decimal Amount, CardInfo Card, string Description);

public record PaymentProviderResult(bool Success, string? TransactionId, string Message);

/// <summary>Ödeme sağlayıcı soyutlaması. Payment:Provider = "Iyzico" için gerçek uygulama bu arayüzle eklenebilir.</summary>
public interface IPaymentProvider
{
    string Name { get; }
    Task<PaymentProviderResult> ChargeAsync(PaymentChargeRequest request, CancellationToken ct = default);
}

/// <summary>
/// iyzico sandbox davranışını taklit eden sahte sağlayıcı:
///  5528790000000008 ve 4766620000000001 → başarılı
///  4111111111111129 → "Yetersiz bakiye"
///  diğerleri → Luhn kontrolü geçerse başarılı
/// </summary>
public class MockPaymentProvider(TimeProvider clock) : IPaymentProvider
{
    private static readonly HashSet<string> SuccessCards = new() { "5528790000000008", "4766620000000001" };
    private const string InsufficientFundsCard = "4111111111111129";

    public string Name => "Mock";

    public Task<PaymentProviderResult> ChargeAsync(PaymentChargeRequest request, CancellationToken ct = default)
    {
        if (request.Amount <= 0m)
            return Fail("Geçersiz ödeme tutarı.");

        var number = CardHelper.Digits(request.Card.Number);
        if (number.Length < 12 || number.Length > 19)
            return Fail("Kart numarası geçersiz.");

        if (!IsExpiryValid(request.Card.ExpireMonth, request.Card.ExpireYear))
            return Fail("Kartın son kullanma tarihi geçersiz veya geçmiş.");

        var cvc = CardHelper.Digits(request.Card.Cvc);
        if (cvc.Length < 3 || cvc.Length > 4)
            return Fail("CVC kodu geçersiz.");

        if (number == InsufficientFundsCard)
            return Fail("Yetersiz bakiye.");

        if (SuccessCards.Contains(number) || CardHelper.LuhnCheck(number))
        {
            var txId = "MOCK-" + Guid.NewGuid().ToString("N").Substring(0, 12).ToUpperInvariant();
            return Task.FromResult(new PaymentProviderResult(true, txId, "Ödeme başarılı."));
        }

        return Fail("Kart numarası geçersiz (Luhn kontrolü başarısız).");
    }

    private bool IsExpiryValid(string? monthText, string? yearText)
    {
        if (!int.TryParse(monthText, out var month) || month < 1 || month > 12) return false;
        if (!int.TryParse(yearText, out var year)) return false;
        if (year < 100) year += 2000;
        if (year < 2000 || year > 2100) return false;

        var now = clock.GetUtcNow().UtcDateTime;
        var expiryEnd = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);
        return expiryEnd > now;
    }

    private static Task<PaymentProviderResult> Fail(string message) =>
        Task.FromResult(new PaymentProviderResult(false, null, message));
}
