namespace Lockedscreen.Security.Agent;

internal static class AgentPaths
{
    private static readonly string RuntimeDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Lockedscreen",
        "SecurityAgent");

    public static string StatePath => Path.Combine(RuntimeDirectory, "agent-state.json");

    public static string LogPath => Path.Combine(RuntimeDirectory, "agent.log");

    public static void EnsureRuntimeDirectory()
    {
        Directory.CreateDirectory(RuntimeDirectory);
    }
}
