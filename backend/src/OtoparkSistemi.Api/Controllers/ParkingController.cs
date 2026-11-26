using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

/// <summary>
/// Herkese açık otopark listesi, kroki, doluluk, öneri, araç bulma ve tarife uç noktaları.
/// lot parametresi verilmezse varsayılan otopark (GAZI) kullanılır; bilinmeyen kod → 404 "Otopark bulunamadı".
/// </summary>
[ApiController]
[Route("api/parking")]
[AllowAnonymous]
public class ParkingController(ParkingService parking) : ControllerBase
{
    /// <summary>Aktif otoparklar ve doluluk özetleri (freeSlots = normal araçlar için boş).</summary>
    [HttpGet("lots")]
    public async Task<ActionResult<List<LotSummaryDto>>> Lots(CancellationToken ct) =>
        Ok(await parking.GetLotsAsync(includeInactive: false, ct));

    /// <summary>Krokiyi çizmek için tek çağrı: otopark + bölgeler + cepler.</summary>
    [HttpGet("lots/{code}/layout")]
    public async Task<ActionResult<LotLayoutDto>> Layout(string code, CancellationToken ct) =>
        Ok(await parking.GetLayoutAsync(code, ct));

    [HttpGet("summary")]
    public async Task<ActionResult<SummaryDto>> Summary([FromQuery] string? lot, CancellationToken ct) =>
        Ok(await parking.GetSummaryAsync(lot, ct));

    [HttpGet("zones")]
    public async Task<ActionResult<List<ZoneDto>>> Zones([FromQuery] string? lot, CancellationToken ct) =>
        Ok(await parking.GetZonesAsync(lot, ct));

    [HttpGet("slots")]
    public async Task<ActionResult<List<SlotDto>>> Slots([FromQuery] string? lot, CancellationToken ct) =>
        Ok(await parking.GetSlotsAsync(lot, ct));

    /// <summary>disabled=true: engelli izinli sürücüye engelli cep önerilir; aksi hâlde asla engelli cep önerilmez.</summary>
    [HttpGet("recommendation")]
    public async Task<ActionResult<RecommendationDto>> Recommendation([FromQuery] string? lot, [FromQuery] bool disabled = false, CancellationToken ct = default) =>
        Ok(await parking.GetRecommendationAsync(lot, disabled, ct));

    /// <summary>Otopark parametresi gerekmez; aktif oturum hangi otoparktaysa o döner.</summary>
    [HttpGet("locate/{plate}")]
    public async Task<ActionResult<LocateDto>> Locate(string plate, CancellationToken ct) =>
        Ok(await parking.LocateAsync(plate, ct));

    [HttpGet("tariffs")]
    public async Task<ActionResult<List<TariffDto>>> Tariffs(CancellationToken ct) =>
        Ok(await parking.GetActiveTariffsAsync(ct));
}
