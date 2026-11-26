using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using OtoparkSistemi.Api.Domain;

namespace OtoparkSistemi.Api.Services;

public class JwtOptions
{
    public string Key { get; set; } = string.Empty;
    public string Issuer { get; set; } = "OtoparkSistemi";
    public string Audience { get; set; } = "OtoparkSistemi.Web";
    public int ExpiresMinutes { get; set; } = 480;
}

/// <summary>Kısa claim adları kullanılır: sub, email, name, role (MapInboundClaims=false ile eşleşir).</summary>
public class TokenService(IOptions<JwtOptions> options, TimeProvider clock)
{
    public const string RoleClaim = "role";
    public const string NameClaim = "name";
    public const string EmailClaim = "email";
    public const string SubjectClaim = "sub";

    public string CreateToken(User user)
    {
        var opt = options.Value;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(opt.Key));
        var now = clock.GetUtcNow().UtcDateTime;

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(new[]
            {
                new Claim(SubjectClaim, user.Id.ToString()),
                new Claim(EmailClaim, user.Email),
                new Claim(NameClaim, user.FullName),
                new Claim(RoleClaim, user.Role.ToString())
            }),
            IssuedAt = now,
            NotBefore = now,
            Expires = now.AddMinutes(opt.ExpiresMinutes),
            Issuer = opt.Issuer,
            Audience = opt.Audience,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256)
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}

public static class ClaimsPrincipalExtensions
{
    public static int GetUserId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirst(TokenService.SubjectClaim)?.Value, out var id)
            ? id
            : throw AppException.Unauthorized("Geçersiz oturum bilgisi.");

    public static string? GetEmail(this ClaimsPrincipal user) => user.FindFirst(TokenService.EmailClaim)?.Value;
}
