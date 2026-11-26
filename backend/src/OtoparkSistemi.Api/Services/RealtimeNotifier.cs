using Microsoft.AspNetCore.SignalR;
using OtoparkSistemi.Api.Dtos;
using OtoparkSistemi.Api.Hubs;

namespace OtoparkSistemi.Api.Services;

/// <summary>SignalR yayınları için soyutlama (testlerde boş uygulama kullanılır).</summary>
public interface IRealtimeNotifier
{
    Task SlotsUpdatedAsync(IReadOnlyList<SlotDto> slots);
    Task SummaryUpdatedAsync(SummaryDto summary);
    Task GateEventAsync(GateEventBroadcastDto gateEvent);
    Task ReviewQueueChangedAsync(int pendingCount, string? lotCode = null);
    Task AgentsUpdatedAsync(IReadOnlyList<AgentStatusDto> agents);
    Task ViolationDetectedAsync(ViolationDto violation);
    Task ViolationResolvedAsync(ViolationResolvedDto violation);
    Task PermitsChangedAsync(int pendingCount);
}

public class RealtimeNotifier(IHubContext<ParkingHub> hub, ILogger<RealtimeNotifier> logger) : IRealtimeNotifier
{
    public Task SlotsUpdatedAsync(IReadOnlyList<SlotDto> slots) =>
        SafeSend(() => hub.Clients.All.SendAsync("SlotsUpdated", slots), "SlotsUpdated");

    public Task SummaryUpdatedAsync(SummaryDto summary) =>
        SafeSend(() => hub.Clients.All.SendAsync("SummaryUpdated", summary), "SummaryUpdated");

    // Plaka içeren olaylar yalnızca operatör grubuna gider (KVKK)
    public Task GateEventAsync(GateEventBroadcastDto gateEvent) =>
        SafeSend(() => hub.Clients.Group(ParkingHub.OperatorsGroup).SendAsync("GateEvent", gateEvent), "GateEvent");

    // pendingCount tüm otoparkların toplamıdır; lotCode kuyruğu değiştiren olayın otoparkıdır
    public Task ReviewQueueChangedAsync(int pendingCount, string? lotCode = null) =>
        SafeSend(() => hub.Clients.Group(ParkingHub.OperatorsGroup).SendAsync("ReviewQueueChanged", new { pendingCount, lotCode }), "ReviewQueueChanged");

    public Task AgentsUpdatedAsync(IReadOnlyList<AgentStatusDto> agents) =>
        SafeSend(() => hub.Clients.Group(ParkingHub.OperatorsGroup).SendAsync("AgentsUpdated", agents), "AgentsUpdated");

    public Task ViolationDetectedAsync(ViolationDto violation) =>
        SafeSend(() => hub.Clients.Group(ParkingHub.OperatorsGroup).SendAsync("ViolationDetected", violation), "ViolationDetected");

    public Task ViolationResolvedAsync(ViolationResolvedDto violation) =>
        SafeSend(() => hub.Clients.Group(ParkingHub.OperatorsGroup).SendAsync("ViolationResolved", violation), "ViolationResolved");

    public Task PermitsChangedAsync(int pendingCount) =>
        SafeSend(() => hub.Clients.Group(ParkingHub.OperatorsGroup).SendAsync("PermitsChanged", new { pendingCount, lotCode = (string?)null }), "PermitsChanged");

    private async Task SafeSend(Func<Task> send, string eventName)
    {
        try
        {
            await send();
        }
        catch (Exception ex)
        {
            // Yayın hatası iş akışını bozmamalı
            logger.LogWarning(ex, "SignalR '{Event}' olayı yayınlanamadı.", eventName);
        }
    }
}

/// <summary>Hiçbir şey yayınlamayan uygulama (birim testleri için).</summary>
public class NullRealtimeNotifier : IRealtimeNotifier
{
    public Task SlotsUpdatedAsync(IReadOnlyList<SlotDto> slots) => Task.CompletedTask;
    public Task SummaryUpdatedAsync(SummaryDto summary) => Task.CompletedTask;
    public Task GateEventAsync(GateEventBroadcastDto gateEvent) => Task.CompletedTask;
    public Task ReviewQueueChangedAsync(int pendingCount, string? lotCode = null) => Task.CompletedTask;
    public Task AgentsUpdatedAsync(IReadOnlyList<AgentStatusDto> agents) => Task.CompletedTask;
    public Task ViolationDetectedAsync(ViolationDto violation) => Task.CompletedTask;
    public Task ViolationResolvedAsync(ViolationResolvedDto violation) => Task.CompletedTask;
    public Task PermitsChangedAsync(int pendingCount) => Task.CompletedTask;
}
