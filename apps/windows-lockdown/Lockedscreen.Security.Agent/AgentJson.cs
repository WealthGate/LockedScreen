using System.Text.Json;

namespace Lockedscreen.Security.Agent;

internal static class AgentJson
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };
}
