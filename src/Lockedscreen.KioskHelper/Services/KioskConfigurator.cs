using System.Diagnostics;
using System.IO;
using System.Security.Principal;

namespace Lockedscreen.KioskHelper.Services;

public sealed class KioskConfigurator
{
    public bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }

    public async Task<string> CreateLocalUserAsync(string userName, string password)
    {
        var script = $"New-LocalUser -Name '{userName}' -Password (ConvertTo-SecureString '{password}' -AsPlainText -Force) -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires; Add-LocalGroupMember -Group 'Users' -Member '{userName}'";
        return await RunPowerShellAsync(script);
    }

    public async Task<string> EnableAssignedAccessAsync(string userName, string appPath)
    {
        var profileId = Guid.NewGuid().ToString("B");
        var xml = $@"<?xml version=""1.0"" encoding=""utf-8""?>
<AssignedAccessConfiguration>
  <Profiles>
    <Profile Id=""{profileId}"">
      <AllAppsList>
        <AllowedApps>
          <App DesktopAppPath=""{appPath}"" />
        </AllowedApps>
      </AllAppsList>
      <Taskbar ShowTaskbar=""false"" />
    </Profile>
  </Profiles>
  <Configs>
    <Config>
      <Account>{userName}</Account>
      <DefaultProfile Id=""{profileId}"" />
    </Config>
  </Configs>
</AssignedAccessConfiguration>";

        var tempPath = Path.Combine(Path.GetTempPath(), $"lockedscreen_kiosk_{Guid.NewGuid():N}.xml");
        await File.WriteAllTextAsync(tempPath, xml);
        var script = $"Set-AssignedAccess -ConfigurationFilePath '{tempPath}'";
        return await RunPowerShellAsync(script);
    }

    public async Task<string> DisableAssignedAccessAsync()
    {
        var script = "Clear-AssignedAccess";
        return await RunPowerShellAsync(script);
    }

    public async Task<string> OpenAssignedAccessSettingsAsync()
    {
        var script = "Start-Process 'ms-settings:assignedaccess'";
        return await RunPowerShellAsync(script);
    }

    public async Task<string> CheckWebView2RuntimeAsync()
    {
        var script = "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\*' | Where-Object { $_.Name -like '*WebView2*' } | Select-Object -First 1 | Format-List";
        return await RunPowerShellAsync(script);
    }

    private static async Task<string> RunPowerShellAsync(string script)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell",
            Arguments = $"-NoProfile -ExecutionPolicy Bypass -Command \"{script}\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi);
        if (process is null)
        {
            return "Failed to start PowerShell.";
        }

        var output = await process.StandardOutput.ReadToEndAsync();
        var error = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return string.IsNullOrWhiteSpace(error) ? output : $"{output}\nERROR: {error}";
    }
}
