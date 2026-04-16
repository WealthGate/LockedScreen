using System.Text.Json.Serialization;

namespace Lockedscreen.Security.Agent;

internal sealed record AgentPolicy
{
    public string SessionId { get; init; } = Guid.NewGuid().ToString("N");

    public bool HideTaskbar { get; init; } = true;

    public bool BlockSystemKeys { get; init; } = true;

    public bool EnforceProcesses { get; init; } = true;

    public string[] DisallowedProcessNames { get; init; } = [];

    public bool MinimizeDisallowedForeground { get; init; } = true;

    [JsonIgnore]
    public HashSet<string> DisallowedNormalized =>
        _disallowedNormalized ??= DisallowedProcessNames
            .Select(name => name.Trim().ToLowerInvariant())
            .Where(name => name.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

    [JsonIgnore]
    private HashSet<string>? _disallowedNormalized;
}
