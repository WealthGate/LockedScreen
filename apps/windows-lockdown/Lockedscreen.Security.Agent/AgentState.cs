using System.Text.Json;
using System.Diagnostics;

namespace Lockedscreen.Security.Agent;

internal static class AgentState
{
    private sealed record State(bool Running, string SessionId, DateTimeOffset StartedAt, int ProcessId,
        long ProcessStartTicks, bool KeyboardBlockingReady, DateTimeOffset CheckedAt);

    public static void Write(AgentPolicy policy, bool keyboardBlockingReady)
    {
        using var process = Process.GetCurrentProcess();
        var state = new State(true, policy.SessionId, process.StartTime.ToUniversalTime(), Environment.ProcessId,
            process.StartTime.ToUniversalTime().Ticks, keyboardBlockingReady, DateTimeOffset.UtcNow);

        AgentPaths.EnsureRuntimeDirectory();
        var temporary = AgentPaths.StatePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state, AgentJson.Options));
        File.Move(temporary, AgentPaths.StatePath, overwrite: true);
    }

    public static object? Read()
    {
        if (!File.Exists(AgentPaths.StatePath))
        {
            return null;
        }

        try
        {
            var state = JsonSerializer.Deserialize<State>(File.ReadAllText(AgentPaths.StatePath), AgentJson.Options);
            if (state is null || DateTimeOffset.UtcNow - state.CheckedAt > TimeSpan.FromSeconds(10)) return null;
            using var process = Process.GetProcessById(state.ProcessId);
            if (process.HasExited || process.StartTime.ToUniversalTime().Ticks != state.ProcessStartTicks ||
                !string.Equals(process.MainModule?.FileName, Environment.ProcessPath, StringComparison.OrdinalIgnoreCase)) return null;
            return state;
        }
        catch { return null; }
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
