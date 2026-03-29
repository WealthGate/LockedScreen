using System.Text;
using System.Text.Json;

namespace Lockedscreen.Security.Agent;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            ApplicationConfiguration.Initialize();

            if (args.Length == 0)
            {
                Console.Error.WriteLine("Usage: Lockedscreen.Security.Agent.exe <run|stop|status> [policyBase64]");
                return 1;
            }

            return args[0].ToLowerInvariant() switch
            {
                "run" => Run(args),
                "host-shell" => HostShell(args),
                "stop" => Stop(),
                "status" => Status(),
                _ => 1
            };
        }
        catch (Exception exception)
        {
            AgentLog.WriteLine($"fatal {exception}");
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }

    private static int Run(string[] args)
    {
        if (args.Length < 2)
        {
            throw new InvalidOperationException("The run command requires a base64-encoded agent policy.");
        }

        var json = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
        var policy = JsonSerializer.Deserialize<AgentPolicy>(json, AgentJson.Options) ??
                     throw new InvalidOperationException("Unable to parse the lockdown agent policy.");

        using var mutex = new Mutex(true, "Local\\LockedscreenSecurityAgent", out var createdNew);
        if (!createdNew)
        {
            AgentLog.WriteLine("agent-already-running");
            return 0;
        }

        using var stopSignal = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\LockedscreenSecurityAgentStop");
        stopSignal.Reset();

        AgentState.Write(policy);
        AgentLog.WriteLine($"agent-run session={policy.SessionId}");
        using var context = new LockdownAgentContext(policy, stopSignal);
        Application.Run(context);
        AgentState.Clear();
        AgentLog.WriteLine($"agent-exit session={policy.SessionId}");
        return 0;
    }

    private static int Stop()
    {
        using var stopSignal = new EventWaitHandle(false, EventResetMode.ManualReset, "Local\\LockedscreenSecurityAgentStop");
        stopSignal.Set();
        AgentLog.WriteLine("agent-stop-signal");
        return 0;
    }

    private static int Status()
    {
        var state = AgentState.Read();
        Console.WriteLine(JsonSerializer.Serialize(state ?? new { running = false }, AgentJson.Options));
        return 0;
    }

    private static int HostShell(string[] args) => new AlternateDesktopHost().Run(args);
}
