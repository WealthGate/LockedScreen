using Lockedscreen.Security.Protocol;
using Lockedscreen.Security.Service;
using System.ServiceProcess;

var coordinator = new LockdownCoordinator();
var server = new CompanionPipeServer(coordinator);

if (!Environment.UserInteractive)
{
    ServiceBase.Run(new CompanionWindowsService(server));
    return;
}

var cancellation = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    cancellation.Cancel();
};

if (args.Length > 0 && args[0].Equals("status", StringComparison.OrdinalIgnoreCase))
{
    Console.WriteLine("Lockedscreen native companion service is a long-running pipe server. Use `serve` or no arguments.");
    return;
}

try
{
    ServiceDiagnostics.WriteLine("service-start");
    await server.RunAsync(cancellation.Token);
}
catch (Exception exception)
{
    ServiceDiagnostics.WriteLine($"service-fatal {exception}");
    throw;
}
