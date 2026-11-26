using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Middleware;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Api.Controllers;

/// <summary>
/// Görüntü işleme servisi → backend (makineler arası, X-Api-Key ile).
/// Gövdedeki lotCode isteğe bağlıdır; yoksa varsayılan otopark (GAZI).
/// </summary>
[ApiController]
[Route("api/vision")]
[AllowAnonymous]
[VisionApiKey]
public class VisionController(
    GateService gate,
    ParkingService parking,
    IRealtimeNotifier notifier,
    AgentStatusStore agents,
    TimeProvider clock) : ControllerBase
{
    [HttpPost("plate-events")]
    public async Task<ActionResult<GateDecisionResponse>> PlateEvent([FromBody] PlateEventRequest request, CancellationToken ct)
    {
        var result = await gate.ProcessAsync(new GateInput(
            request.CameraId,
            request.Gate,
            request.Plate,
            request.Confidence,
            request.FormatValid,
            IsManual: false,
            ImageBase64: request.ImageBase64,
            CapturedAt: request.Timestamp,
            LotCode: request.LotCode), ct);
        return Ok(result);
    }

    /// <summary>Cep kodları otopark içinde eşlenir; bilinmeyen kodlar yok sayılır. Engelli cep ihlal kuralı burada işler.</summary>
    [HttpPost("occupancy")]
    public async Task<IActionResult> Occupancy([FromBody] OccupancyRequest request, CancellationToken ct)
    {
        var lot = await parking.ResolveLotAsync(request.LotCode, ct);
        var states = (request.Slots ?? new List<OccupancySlotRequest>())
            .Where(s => !string.IsNullOrWhiteSpace(s.Code))
            .Select(s => (Code: s.Code!.Trim(), s.Occupied, s.Confidence))
            .ToList();

        var result = await parking.ApplySlotStatesAsync(lot, states, actor: null, ct);
        await parking.PublishSlotUpdateAsync(notifier, lot, result, ct);
        return NoContent();
    }

    [HttpPost("heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody] HeartbeatRequest request)
    {
        var now = clock.GetUtcNow().UtcDateTime;
        agents.Update(request.Agents ?? new List<AgentHeartbeat>(), now);
        await notifier.AgentsUpdatedAsync(agents.GetAll(now));
        return NoContent();
    }
}
