using System.Text;

namespace Lockedscreen.Security.Service;

internal static class ServiceDiagnostics
{
    public static void WriteLine(string message)
    {
        try
        {
            ServicePaths.EnsureRuntimeDirectory();
            File.AppendAllText(ServicePaths.LogPath, $"{DateTimeOffset.UtcNow:O} {message}{Environment.NewLine}", Encoding.UTF8);
        }
        catch
        {
            // Best-effort logging only.
        }
    }
}
