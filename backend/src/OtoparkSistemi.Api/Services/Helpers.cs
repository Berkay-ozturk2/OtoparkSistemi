using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace OtoparkSistemi.Api.Services;

/// <summary>İş kuralı ihlallerinde fırlatılır; ara katman {message} JSON'una çevirir.</summary>
public class AppException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;

    public static AppException BadRequest(string message) => new(400, message);
    public static AppException Unauthorized(string message) => new(401, message);
    public static AppException Forbidden(string message) => new(403, message);
    public static AppException NotFound(string message) => new(404, message);
    public static AppException Conflict(string message) => new(409, message);
}

/// <summary>Türk plakası normalize etme, doğrulama, biçimlendirme ve anonimleştirme.</summary>
public static class PlateHelper
{
    public const string HashPrefix = "HASH:";

    // İl kodu 01-81, 1-3 harf, 2-5 rakam
    private static readonly Regex Pattern = new(@"^(0[1-9]|[1-7][0-9]|8[01])([A-Z]{1,3})([0-9]{2,5})$", RegexOptions.Compiled);

    /// <summary>Büyük harf, boşluk/tire/nokta temizliği, Türkçe karakter dönüşümü ve "TR" ön eki silme.</summary>
    public static string Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;

        var sb = new StringBuilder(raw.Length);
        foreach (var ch in raw.Trim())
        {
            var c = ch switch
            {
                'ç' or 'Ç' => 'C',
                'ğ' or 'Ğ' => 'G',
                'ı' or 'İ' or 'i' => 'I',
                'ö' or 'Ö' => 'O',
                'ş' or 'Ş' => 'S',
                'ü' or 'Ü' => 'U',
                _ => char.ToUpperInvariant(ch)
            };
            if (c is (>= 'A' and <= 'Z') or (>= '0' and <= '9'))
                sb.Append(c);
        }

        var result = sb.ToString();
        // Uluslararası "TR" ön eki (ör. "TR 34 ABC 123")
        if (result.Length > 2 && result.StartsWith("TR", StringComparison.Ordinal) && char.IsDigit(result[2]))
            result = result.Substring(2);
        return result;
    }

    /// <summary>TR plaka biçimi: 1 harf → 4-5 rakam, 2 harf → 3-4 rakam, 3 harf → 2-3 rakam.</summary>
    public static bool IsValid(string? plate)
    {
        if (string.IsNullOrEmpty(plate)) return false;
        var m = Pattern.Match(plate);
        if (!m.Success) return false;
        var letters = m.Groups[2].Value.Length;
        var digits = m.Groups[3].Value.Length;
        return letters switch
        {
            1 => digits is 4 or 5,
            2 => digits is 3 or 4,
            3 => digits is 2 or 3,
            _ => false
        };
    }

    /// <summary>"34ABC123" → "34 ABC 123".</summary>
    public static string Format(string plate)
    {
        var m = Pattern.Match(plate ?? string.Empty);
        return m.Success ? $"{m.Groups[1].Value} {m.Groups[2].Value} {m.Groups[3].Value}" : plate ?? string.Empty;
    }

    /// <summary>KVKK: plakayı geri döndürülemez SHA-256 özetine çevirir ("HASH:xxxxxxxxxxxxxxxx").</summary>
    public static string Anonymize(string plate)
    {
        if (plate.StartsWith(HashPrefix, StringComparison.Ordinal)) return plate;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(plate)));
        return HashPrefix + hash.Substring(0, 16);
    }
}

public static class Passwords
{
    public static string Hash(string password) => BCrypt.Net.BCrypt.HashPassword(password);

    public static bool Verify(string password, string hash)
    {
        try
        {
            return BCrypt.Net.BCrypt.Verify(password, hash);
        }
        catch (Exception)
        {
            return false;
        }
    }
}

/// <summary>Türkiye saati (UTC+3) dönüşümleri. Rapor gruplaması bu saate göre yapılır.</summary>
public static class TurkeyTime
{
    private static readonly TimeZoneInfo Zone = Resolve();

    private static TimeZoneInfo Resolve()
    {
        foreach (var id in new[] { "Europe/Istanbul", "Turkey Standard Time" })
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }
        return TimeZoneInfo.CreateCustomTimeZone("TRT", TimeSpan.FromHours(3), "Türkiye Saati", "Türkiye Saati");
    }

    public static DateTime ToLocal(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Zone);

    public static DateTime ToUtc(DateTime local) =>
        DateTime.SpecifyKind(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), Zone), DateTimeKind.Utc);
}

public static class TimeHelper
{
    /// <summary>İstekten gelen tarihi UTC'ye çevirir. Sözleşme gereği saat dilimi belirtilmemiş değerler UTC kabul edilir.</summary>
    public static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };

    public static int MinutesBetween(DateTime start, DateTime end) =>
        (int)Math.Max(0, Math.Floor((end - start).TotalMinutes));
}

public static class Money
{
    /// <summary>45.5 → "45,50" (Türkçe gösterim, kültürden bağımsız).</summary>
    public static string Format(decimal amount) =>
        amount.ToString("0.00", CultureInfo.InvariantCulture).Replace('.', ',');
}

public static class CardHelper
{
    public static string Digits(string? number) =>
        new string((number ?? string.Empty).Where(char.IsDigit).ToArray());

    public static string? Last4(string? number)
    {
        var d = Digits(number);
        return d.Length >= 4 ? d.Substring(d.Length - 4) : null;
    }

    public static bool LuhnCheck(string digits)
    {
        if (string.IsNullOrEmpty(digits)) return false;
        var sum = 0;
        var alternate = false;
        for (var i = digits.Length - 1; i >= 0; i--)
        {
            var n = digits[i] - '0';
            if (n < 0 || n > 9) return false;
            if (alternate)
            {
                n *= 2;
                if (n > 9) n -= 9;
            }
            sum += n;
            alternate = !alternate;
        }
        return sum % 10 == 0;
    }
}
