using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Lockedscreen.Security.Protocol;

namespace Lockedscreen.Security.Service;

internal sealed class CompanionPipeServer
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly LockdownCoordinator _coordinator;

    public CompanionPipeServer(LockdownCoordinator coordinator)
    {
        _coordinator = coordinator;
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var listener = new TcpListener(IPAddress.Parse(NativeCompanionProtocol.Host), NativeCompanionProtocol.Port);
        listener.Start();
        ServiceDiagnostics.WriteLine($"listener-start host={NativeCompanionProtocol.Host} port={NativeCompanionProtocol.Port}");

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                TcpClient client;
                try
                {
                    client = await listener.AcceptTcpClientAsync(cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                using (client)
                using (var stream = client.GetStream())
                {
                    await HandleConnectionAsync(stream, cancellationToken);
                }
            }
        }
        finally
        {
            listener.Stop();
        }
    }

    private async Task HandleConnectionAsync(Stream stream, CancellationToken cancellationToken)
    {
        try
        {
            using var reader = new StreamReader(stream, Encoding.UTF8, false, 1024, true);
            using var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, true)
            {
                AutoFlush = true
            };

            var line = await reader.ReadLineAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(line))
            {
                await writer.WriteLineAsync(
                    JsonSerializer.Serialize(
                        new NativeCompanionResponse
                        {
                            Ok = false,
                            ErrorCode = "empty-request",
                            Message = "The native companion service received an empty request."
                        },
                        JsonOptions));
                return;
            }

            NativeCompanionRequest? request;
            try
            {
                request = JsonSerializer.Deserialize<NativeCompanionRequest>(line, JsonOptions);
            }
            catch (JsonException)
            {
                await writer.WriteLineAsync(
                    JsonSerializer.Serialize(
                        new NativeCompanionResponse
                        {
                            Ok = false,
                            ErrorCode = "invalid-json",
                            Message = "The native companion service could not parse the request."
                        },
                        JsonOptions));
                return;
            }

            if (request is null)
            {
                await writer.WriteLineAsync(
                    JsonSerializer.Serialize(
                        new NativeCompanionResponse
                        {
                            Ok = false,
                            ErrorCode = "invalid-request",
                            Message = "The native companion service received an invalid request."
                        },
                        JsonOptions));
                return;
            }

            ServiceDiagnostics.WriteLine($"request command={request.Command} requestId={request.RequestId}");
            var response = await _coordinator.HandleAsync(request, cancellationToken);
            await writer.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions));
        }
        catch (Exception exception)
        {
            ServiceDiagnostics.WriteLine($"pipe-error {exception}");
            throw;
        }
    }
}
