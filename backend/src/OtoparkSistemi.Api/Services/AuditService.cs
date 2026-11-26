using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;

namespace OtoparkSistemi.Api.Services;

/// <summary>Önemli işlemleri (kullanıcı, eylem, IP) denetim kaydına yazar.</summary>
public class AuditService(AppDbContext db, IHttpContextAccessor httpContextAccessor, TimeProvider clock)
{
    public async Task LogAsync(string action, string? details = null, string? userEmail = null, CancellationToken ct = default)
    {
        var http = httpContextAccessor.HttpContext;
        var email = userEmail ?? http?.User.FindFirst("email")?.Value;
        var ip = http?.Connection.RemoteIpAddress?.ToString();

        db.AuditLogs.Add(new AuditLog
        {
            Action = Truncate(action, 100),
            Details = details == null ? null : Truncate(details, 1000),
            UserEmail = email,
            IpAddress = ip,
            CreatedAt = clock.GetUtcNow().UtcDateTime
        });
        await db.SaveChangesAsync(ct);
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value.Substring(0, max);
}
