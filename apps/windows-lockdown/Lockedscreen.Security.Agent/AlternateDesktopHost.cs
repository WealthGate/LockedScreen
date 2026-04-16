using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace Lockedscreen.Security.Agent;

internal sealed class AlternateDesktopHost
{
    public int Run(string[] args)
    {
        if (args.Length < 4)
        {
            throw new InvalidOperationException(
                "Usage: host-shell <policyBase64> <shellExecutablePath> <shellArgsBase64>");
        }

        var policy = DeserializePolicy(args[1]);
        var shellExecutablePath = args[2];
        var shellArgs = DeserializeArgs(args[3]);
        var desktopName = $"Lockedscreen-{policy.SessionId}";

        using var stopSignal = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\LockedscreenSecurityAgentStop");
        stopSignal.Reset();

        var originalDesktop = NativeMethods.OpenInputDesktop(0, false, NativeMethods.DesktopAllAccess);
        if (originalDesktop == IntPtr.Zero)
        {
            throw new InvalidOperationException("Unable to open the current input desktop.");
        }

        var alternateDesktop = NativeMethods.CreateDesktop(
            desktopName,
            null,
            IntPtr.Zero,
            0,
            NativeMethods.DesktopAllAccess,
            IntPtr.Zero);
        if (alternateDesktop == IntPtr.Zero)
        {
            NativeMethods.CloseDesktop(originalDesktop);
            throw new InvalidOperationException("Unable to create the alternate exam desktop.");
        }

        Process? agentProcess = null;
        Process? shellProcess = null;

        try
        {
            agentProcess = LaunchOnDesktop(GetCurrentExecutablePath(), ["run", args[1]], desktopName);
            shellProcess = LaunchOnDesktop(shellExecutablePath, shellArgs, desktopName);

            if (!NativeMethods.SwitchDesktop(alternateDesktop))
            {
                throw new InvalidOperationException("Unable to switch to the alternate exam desktop.");
            }

            AgentLog.WriteLine($"desktop-switch name={desktopName} shellPid={shellProcess.Id}");

            while (true)
            {
                if (stopSignal.WaitOne(250))
                {
                    AgentLog.WriteLine($"desktop-stop name={desktopName}");
                    break;
                }

                if (shellProcess.HasExited)
                {
                    AgentLog.WriteLine($"desktop-shell-exit name={desktopName} exitCode={shellProcess.ExitCode}");
                    break;
                }
            }
        }
        finally
        {
            TryStopProcess(shellProcess);
            stopSignal.Set();
            TryStopProcess(agentProcess);
            NativeMethods.SwitchDesktop(originalDesktop);
            NativeMethods.CloseDesktop(alternateDesktop);
            NativeMethods.CloseDesktop(originalDesktop);
        }

        return 0;
    }

    private static AgentPolicy DeserializePolicy(string policyBase64)
    {
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(policyBase64));
        return JsonSerializer.Deserialize<AgentPolicy>(json, AgentJson.Options) ??
               throw new InvalidOperationException("Unable to parse the alternate desktop policy.");
    }

    private static string[] DeserializeArgs(string argsBase64)
    {
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(argsBase64));
        return JsonSerializer.Deserialize<string[]>(json, AgentJson.Options) ?? [];
    }

    private static string GetCurrentExecutablePath() =>
        Environment.ProcessPath ?? throw new InvalidOperationException("Unable to resolve the current agent executable path.");

    private static Process LaunchOnDesktop(string executablePath, IEnumerable<string> args, string desktopName)
    {
        var startupInfo = new NativeMethods.StartupInfo
        {
            Cb = (uint)Marshal.SizeOf<NativeMethods.StartupInfo>(),
            LpDesktop = desktopName
        };

        var commandLine = BuildCommandLine(executablePath, args);
        if (!NativeMethods.CreateProcess(
                executablePath,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                NativeMethods.NormalPriorityClass | NativeMethods.CreateNewProcessGroup,
                IntPtr.Zero,
                null,
                ref startupInfo,
                out var processInfo))
        {
            throw new InvalidOperationException($"Unable to create a process on desktop \"{desktopName}\".");
        }

        NativeMethods.CloseHandle(processInfo.HThread);
        NativeMethods.CloseHandle(processInfo.HProcess);

        return Process.GetProcessById((int)processInfo.DwProcessId);
    }

    private static string BuildCommandLine(string executablePath, IEnumerable<string> args)
    {
        static string Quote(string value) =>
            value.Contains(' ') || value.Contains('"')
                ? "\"" + value.Replace("\"", "\\\"") + "\""
                : value;

        return string.Join(" ", new[] { Quote(executablePath) }.Concat(args.Select(Quote)));
    }

    private static void TryStopProcess(Process? process)
    {
        if (process is null)
        {
            return;
        }

        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(3000);
            }
        }
        catch
        {
            // Best-effort teardown only.
        }
        finally
        {
            process.Dispose();
        }
    }
}
