using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using OtoparkSistemi.Api.Domain;
using OtoparkSistemi.Api.Services;

namespace OtoparkSistemi.Tests;

/// <summary>Aşama 3: krokiden cep ataması ve "normal araç engelli yere atanamaz" kuralı.</summary>
public class SlotAssignmentTests : IDisposable
{
    private readonly TestDb _t = new();
    private readonly SlotAssignmentService _svc;

    public SlotAssignmentTests()
    {
        var audit = new AuditService(_t.Db, new HttpContextAccessor(), _t.Clock);
        _svc = new SlotAssignmentService(_t.Db, _t.Parking, new NullRealtimeNotifier(), audit, _t.Clock);
    }

    public void Dispose() => _t.Dispose();

    private Task EnterAsync(string plate) =>
        _t.Gate.ProcessAsync(new GateInput("giris-1", GateType.Entry, plate, 0.95, true, IsManual: false, LotCode: "GAZI"));

    private Task<ParkingSlot> SlotAsync(string code) =>
        _t.Db.ParkingSlots.Include(s => s.Zone).FirstAsync(s => s.Code == code && s.Zone!.Lot!.Code == "GAZI");

    [Fact]
    public async Task Normal_vehicle_cannot_be_assigned_to_disabled_slot()
    {
        await EnterAsync("06ABC123");
        var disabled = await SlotAsync("A02");
        Assert.Equal(SlotType.Disabled, disabled.Type);

        var ex = await Assert.ThrowsAsync<AppException>(() => _svc.AssignAsync(disabled.Id, "06ABC123", "test", default));
        Assert.Equal(422, ex.StatusCode);
        Assert.Contains("engelli", ex.Message);

        var session = await _t.Db.ParkingSessions.AsNoTracking().FirstAsync(s => s.Plate == "06ABC123");
        Assert.Null(session.SlotId);
    }

    [Fact]
    public async Task Permit_vehicle_can_be_assigned_to_disabled_slot_and_detail_shows_plate()
    {
        await EnterAsync("06ENG061");
        var disabled = await SlotAsync("A02");

        var detail = await _svc.AssignAsync(disabled.Id, "06 eng 061", "test", default);

        Assert.Equal("06ENG061", detail.Plate);
        Assert.True(detail.IsOccupied);
        Assert.True(detail.IsDisabledPermit);
        Assert.NotNull(detail.EntryTime);
    }

    [Fact]
    public async Task Reassigning_moves_vehicle_and_frees_previous_slot()
    {
        await EnterAsync("06ABC123");
        var standard = await _t.Db.ParkingSlots
            .Where(s => s.Zone!.Lot!.Code == "GAZI" && s.Type == SlotType.Standard && s.IsActive && !s.IsOccupied)
            .OrderBy(s => s.Code).Take(2).ToListAsync();
        var (a, b) = (standard[0], standard[1]);

        await _svc.AssignAsync(a.Id, "06ABC123", "test", default);
        var moved = await _svc.AssignAsync(b.Id, "06ABC123", "test", default);
        var old = await _svc.GetDetailAsync(a.Id, default);

        Assert.Equal("06ABC123", moved.Plate);
        Assert.False(old.IsOccupied);
        Assert.Null(old.Plate);
    }

    [Fact]
    public async Task Assigning_without_active_session_is_rejected()
    {
        var a = await SlotAsync("A01");
        var ex = await Assert.ThrowsAsync<AppException>(() => _svc.AssignAsync(a.Id, "34XYZ999", "test", default));
        Assert.Equal(404, ex.StatusCode);
    }
}
