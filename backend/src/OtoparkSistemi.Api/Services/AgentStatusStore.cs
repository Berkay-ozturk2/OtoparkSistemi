using System.Collections.Concurrent;
using OtoparkSistemi.Api.Dtos;

namespace OtoparkSistemi.Api.Services;

/// <summary>Görüntü ajanlarının son heartbeat durumunu bellekte tutar (singleton).</summary>
public class AgentStatusStore
{
    /// <summary>Bu süre boyunca heartbeat gelmeyen ajan çevrimdışı sayılır.</summary>
    public const int OfflineAfterSeconds = 60;

    private readonly ConcurrentDictionary<string, AgentStatusDto> _agents = new(StringComparer.OrdinalIgnoreCase);

    public void Update(IEnumerable<AgentHeartbeat> beats, DateTime nowUtc)
    {
        foreach (var b in beats)
        {
            if (string.IsNullOrWhiteSpace(b.Id)) continue;
            var id = b.Id.Trim();
            // Ajan lotCode göndermezse varsayılan otopark (GAZI) kabul edilir
            _agents[id] = new AgentStatusDto(id, b.Type, b.Status, b.Fps, b.LastError, nowUtc, true,
                LotDefaults.Normalize(b.LotCode));
        }
    }

    /// <summary>lotCode verilirse yalnızca o otoparkın ajanları.</summary>
    public IReadOnlyList<AgentStatusDto> GetAll(DateTime nowUtc, string? lotCode = null) =>
        _agents.Values
            .Where(a => lotCode == null || string.Equals(a.LotCode, lotCode, StringComparison.OrdinalIgnoreCase))
            .Select(a => a with { IsOnline = (nowUtc - a.LastSeen).TotalSeconds <= OfflineAfterSeconds })
            .OrderBy(a => a.Id, StringComparer.OrdinalIgnoreCase)
            .ToList();
}
