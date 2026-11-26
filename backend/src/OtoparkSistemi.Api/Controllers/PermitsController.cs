using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

/// <summary>
/// Engelli izni: sürücü başvurusu (giriş yapmış her kullanıcı, yalnızca kendi araçları için)
/// ve gişede hızlı kontrol (Operator, Admin). Yönetici işlemleri /api/admin/permits altındadır.
/// </summary>
[ApiController]
[Route("api/permits")]
[Authorize]
public class PermitsController(PermitService permits, AuditService audit) : ControllerBase
{
    [HttpGet("my")]
    public async Task<ActionResult<List<DisabledPermitDto>>> My(CancellationToken ct) =>
        Ok(await permits.GetMyAsync(User.GetUserId(), ct));

    /// <summary>Başvuru: plaka sürücünün araçlarından biri olmalı; bekleyen/onaylı başvuru varsa 409.</summary>
    [HttpPost]
    public async Task<ActionResult<DisabledPermitDto>> Create([FromBody] CreatePermitRequest request, CancellationToken ct)
    {
        var dto = await permits.CreateAsync(User.GetUserId(), request, ct);
        await audit.LogAsync("Engelli izni başvurusu", $"Başvuru #{dto.Id} ({dto.Plate})", ct: ct);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    /// <summary>Gişede hızlı kontrol: {plate, valid, permit}.</summary>
    [HttpGet("check/{plate}")]
    [Authorize(Roles = "Operator,Admin")]
    public async Task<ActionResult<PermitCheckDto>> Check(string plate, CancellationToken ct) =>
        Ok(await permits.CheckAsync(plate, ct));
}
