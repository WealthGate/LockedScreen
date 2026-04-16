using System.Text;

namespace Lockedscreen.Security.Agent;

internal static class AgentLog
{
    public static void WriteLine(string message)
    {
        try
        {
            AgentPaths.EnsureRuntimeDirectory();
            File.AppendAllText(AgentPaths.LogPath, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}", Encoding.UTF8);
        }
        catch
        {
            // Best-effort logging only.
        }
    }
}
