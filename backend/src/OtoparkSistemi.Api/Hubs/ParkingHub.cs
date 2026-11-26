using Microsoft.AspNetCore.SignalR;

namespace OtoparkSistemi.Api.Hubs;

/// <summary>
/// /hubs/parking — anonim bağlantıya açıktır (yalnızca toplu doluluk verisi).
/// Operator/Admin JWT'si (?access_token=...) ile bağlanan istemciler "operators" grubuna eklenir.
/// </summary>
public class ParkingHub : Hub
{
    public const string OperatorsGroup = "operators";

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;
        if (user != null && (user.IsInRole("Operator") || user.IsInRole("Admin")))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, OperatorsGroup);
        }
        await base.OnConnectedAsync();
    }
}
