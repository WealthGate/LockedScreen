using System.Text.Json;

namespace Lockedscreen.Security.Agent;

internal static class AgentState
{
    public static void Write(AgentPolicy policy)
    {
        var state = new
        {
            running = true,
            policy.SessionId,
            startedAt = DateTimeOffset.UtcNow,
            processId = Environment.ProcessId
        };

        AgentPaths.EnsureRuntimeDirectory();
        File.WriteAllText(AgentPaths.StatePath, JsonSerializer.Serialize(state, AgentJson.Options));
    }

    public static object? Read()
    {
        if (!File.Exists(AgentPaths.StatePath))
        {
            return null;
        }

        return JsonSerializer.Deserialize<object>(File.ReadAllText(AgentPaths.StatePath), AgentJson.Options);
    }

    public static void Clear()
    {
        try
        {
            if (File.Exists(AgentPaths.StatePath))
            {
                File.Delete(AgentPaths.StatePath);
            }
        }
        catch
        {
            // Best-effort cleanup only.
        }
    }
}
