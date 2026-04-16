namespace Lockedscreen.Security.Service;

internal static class ServicePaths
{
    private static readonly string RuntimeDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Lockedscreen",
        "SecurityService");

    public static string LogPath => Path.Combine(RuntimeDirectory, "service.log");

    public static void EnsureRuntimeDirectory()
    {
        Directory.CreateDirectory(RuntimeDirectory);
    }
}
