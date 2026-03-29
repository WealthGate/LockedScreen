using System.Diagnostics;

namespace Lockedscreen.Security.Agent;

internal sealed class ProcessEnforcer : IDisposable
{
    private readonly AgentPolicy _policy;
    private readonly System.Windows.Forms.Timer _timer;

    public ProcessEnforcer(AgentPolicy policy)
    {
        _policy = policy;
        _timer = new System.Windows.Forms.Timer
        {
            Interval = 1500
        };
        _timer.Tick += (_, _) => Enforce();
    }

    public void Start() => _timer.Start();

    public void Dispose() => _timer.Dispose();

    private void Enforce()
    {
        if (!_policy.EnforceProcesses || _policy.DisallowedNormalized.Count == 0)
        {
            return;
        }

        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.Id == Environment.ProcessId)
                {
                    continue;
                }

                var normalized = process.ProcessName.ToLowerInvariant();
                if (!_policy.DisallowedNormalized.Contains(normalized) &&
                    !_policy.DisallowedNormalized.Contains($"{normalized}.exe"))
                {
                    continue;
                }

                AgentLog.WriteLine($"process-kill name={process.ProcessName} pid={process.Id}");
                process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Best-effort enforcement only.
            }
        }

        if (_policy.MinimizeDisallowedForeground)
        {
            MinimizeDisallowedForeground();
        }
    }

    private void MinimizeDisallowedForeground()
    {
        var foreground = NativeMethods.GetForegroundWindow();
        if (foreground == IntPtr.Zero)
        {
            return;
        }

        NativeMethods.GetWindowThreadProcessId(foreground, out var processId);
        if (processId == 0 || processId == Environment.ProcessId)
        {
            return;
        }

        try
        {
            using var process = Process.GetProcessById((int)processId);
            var normalized = process.ProcessName.ToLowerInvariant();
            if (_policy.DisallowedNormalized.Contains(normalized) || _policy.DisallowedNormalized.Contains($"{normalized}.exe"))
            {
                NativeMethods.ShowWindowAsync(foreground, NativeMethods.SwMinimize);
                AgentLog.WriteLine($"foreground-minimize name={process.ProcessName} pid={process.Id}");
            }
        }
        catch
        {
            // Ignore transient process errors.
        }
    }
}
