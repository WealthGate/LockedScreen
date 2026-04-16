using System.ServiceProcess;

namespace Lockedscreen.Security.Service;

internal sealed class CompanionWindowsService : ServiceBase
{
    private readonly CompanionPipeServer _server;
    private CancellationTokenSource? _cancellation;
    private Task? _backgroundTask;

    public CompanionWindowsService(CompanionPipeServer server)
    {
        _server = server;
        ServiceName = "LockedscreenSecurityService";
        CanStop = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        _cancellation = new CancellationTokenSource();
        _backgroundTask = Task.Run(() => _server.RunAsync(_cancellation.Token), _cancellation.Token);
    }

    protected override void OnStop()
    {
        _cancellation?.Cancel();
        try
        {
            _backgroundTask?.Wait(TimeSpan.FromSeconds(5));
        }
        catch
        {
            // Service stop should not fail the SCM shutdown path.
        }
    }
}
