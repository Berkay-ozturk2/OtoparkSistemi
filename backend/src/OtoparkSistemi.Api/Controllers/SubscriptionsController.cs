using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

/// <summary>
/// Abonelik: paket listesi (herkese açık), sürücünün başvuruları ve başvuru / geri çekme.
/// Yönetici işlemleri /api/admin/subscriptions altındadır.
/// </summary>
[ApiController]
[Route("api/subscriptions")]
[Authorize]
public class SubscriptionsController(SubscriptionService subscriptions, AuditService audit) : ControllerBase
{
    [HttpGet("plans")]
    [AllowAnonymous]
    public ActionResult<List<SubscriptionPlanDto>> Plans() => Ok(subscriptions.GetPlans());

    [HttpGet("my")]
    public async Task<ActionResult<List<SubscriptionDto>>> My(CancellationToken ct) =>
        Ok(await subscriptions.GetMyAsync(User.GetUserId(), ct));

    /// <summary>Başvuru: plaka sürücünün araçlarından biri olmalı; aynı otoparkta açık başvuru/abonelik varsa 409.</summary>
    [HttpPost]
    public async Task<ActionResult<SubscriptionDto>> Create([FromBody] CreateSubscriptionRequest request, CancellationToken ct)
    {
        var dto = await subscriptions.CreateAsync(User.GetUserId(), request, ct);
        await audit.LogAsync("Abonelik başvurusu", $"Başvuru #{dto.Id} ({dto.Plate}, {dto.LotCode}, {dto.Plan})", ct: ct);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    /// <summary>Bekleyen başvuruyu geri çekme.</summary>
    [HttpPost("{id:int}/cancel")]
    public async Task<ActionResult<SubscriptionDto>> Cancel(int id, CancellationToken ct)
    {
        var dto = await subscriptions.CancelOwnAsync(User.GetUserId(), id, ct);
        await audit.LogAsync("Abonelik başvurusu geri çekildi", $"Başvuru #{dto.Id} ({dto.Plate})", ct: ct);
        return Ok(dto);
    }
}

/// <summary>Yönetici: abonelik listesi, onay / ret / iptal ve aylık-yıllık rapor.</summary>
[ApiController]
[Route("api/admin/subscriptions")]
[Authorize(Roles = "Admin")]
public class AdminSubscriptionsController(SubscriptionService subscriptions, AuditService audit) : ControllerBase
{
    /// <summary>status (Pending | Active | Rejected | Cancelled) ve lot ile süzülebilir.</summary>
    [HttpGet]
    public async Task<ActionResult<List<SubscriptionDto>>> GetAll([FromQuery] string? status, [FromQuery] string? lot, CancellationToken ct) =>
        Ok(await subscriptions.GetAllAsync(status, lot, ct));

    [HttpPut("{id:int}")]
    public async Task<ActionResult<SubscriptionDto>> Update(int id, [FromBody] UpdateSubscriptionRequest request, CancellationToken ct)
    {
        var email = User.GetEmail();
        var dto = await subscriptions.AdminUpdateAsync(id, request, email, ct);
        await audit.LogAsync("Abonelik güncellendi", $"Abonelik #{dto.Id} ({dto.Plate}) → {dto.Status}", email, ct);
        return Ok(dto);
    }

    [HttpGet("report")]
    public async Task<ActionResult<SubscriptionReportDto>> Report([FromQuery] int? year, [FromQuery] string? lot, CancellationToken ct) =>
        Ok(await subscriptions.GetReportAsync(year, lot, ct));
}
