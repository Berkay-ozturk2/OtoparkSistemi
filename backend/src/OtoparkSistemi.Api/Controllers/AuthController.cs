using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Data;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(AppDbContext db, TokenService tokens, AuditService audit, TimeProvider clock) : ControllerBase
{
    public const int MinPasswordLength = 6;

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Login([FromBody] LoginRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            throw AppException.BadRequest("E-posta ve parola zorunludur.");

        var email = request.Email.Trim().ToLowerInvariant();
        var account = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (account == null || !Passwords.Verify(request.Password, account.PasswordHash))
        {
            await audit.LogAsync("Başarısız giriş denemesi", null, email, ct);
            throw AppException.Unauthorized("E-posta veya parola hatalı.");
        }

        if (!account.IsActive)
            throw AppException.Forbidden("Hesabınız pasif durumda. Lütfen yöneticiyle iletişime geçin.");

        await audit.LogAsync("Giriş", null, account.Email, ct);
        return Ok(new LoginResponse(tokens.CreateToken(account), UserDto.From(account)));
    }

    [HttpPost("register")]
    [AllowAnonymous]
    public async Task<ActionResult<LoginResponse>> Register([FromBody] RegisterRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.FullName))
            throw AppException.BadRequest("Ad soyad zorunludur.");
        if (string.IsNullOrWhiteSpace(request.Email) || !request.Email.Contains('@'))
            throw AppException.BadRequest("Geçerli bir e-posta adresi giriniz.");
        if (string.IsNullOrEmpty(request.Password) || request.Password.Length < MinPasswordLength)
            throw AppException.BadRequest($"Parola en az {MinPasswordLength} karakter olmalıdır.");
        if (!request.KvkkAccepted)
            throw AppException.BadRequest("Kayıt için KVKK aydınlatma metnini onaylamanız gerekir.");

        var email = request.Email.Trim().ToLowerInvariant();
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
            throw AppException.Conflict("Bu e-posta adresi zaten kayıtlı.");

        var now = clock.GetUtcNow().UtcDateTime;
        var account = new Domain.User
        {
            FullName = request.FullName.Trim(),
            Email = email,
            Phone = (request.Phone ?? string.Empty).Trim(),
            PasswordHash = Passwords.Hash(request.Password),
            Role = UserRole.Driver,
            IsActive = true,
            KvkkAccepted = true,
            KvkkAcceptedAt = now,
            MarketingConsent = request.MarketingConsent,
            CreatedAt = now
        };
        db.Users.Add(account);
        await db.SaveChangesAsync(ct);

        await audit.LogAsync("Kayıt", $"Yeni sürücü hesabı #{account.Id} (pazarlama izni: {(request.MarketingConsent ? "evet" : "hayır")})", account.Email, ct);
        return Ok(new LoginResponse(tokens.CreateToken(account), UserDto.From(account)));
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> Me(CancellationToken ct)
    {
        var id = User.GetUserId();
        var account = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct)
                      ?? throw AppException.NotFound("Kullanıcı bulunamadı.");
        return Ok(UserDto.From(account));
    }
}
