using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Lockedscreen.Security.Protocol;

var request = BuildRequest(args);
var requestOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    WriteIndented = false
};
var outputOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    WriteIndented = true
};

try
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
    using var client = new TcpClient();
    await client.ConnectAsync(NativeCompanionProtocol.Host, NativeCompanionProtocol.Port, timeout.Token);
    using var stream = client.GetStream();

    using var reader = new StreamReader(stream, Encoding.UTF8, false, 1024, true);
    using var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, true)
    {
        AutoFlush = true
    };

    await writer.WriteLineAsync(JsonSerializer.Serialize(request, requestOptions));
    var line = await reader.ReadLineAsync(timeout.Token);

    if (string.IsNullOrWhiteSpace(line))
    {
        Console.Error.WriteLine("The native companion service returned an empty response.");
        return 1;
    }

    var response = JsonSerializer.Deserialize<NativeCompanionResponse>(line, outputOptions);
    Console.WriteLine(JsonSerializer.Serialize(response, outputOptions));
    return response?.Ok == true ? 0 : 1;
}
catch (Exception exception)
{
    Console.Error.WriteLine(exception.Message);
    return 1;
}

static NativeCompanionRequest BuildRequest(string[] args)
{
    if (args.Length == 0 || args[0].Equals("status", StringComparison.OrdinalIgnoreCase))
    {
        return new NativeCompanionRequest
        {
            Command = "status"
        };
    }

    if (args[0].Equals("begin-session", StringComparison.OrdinalIgnoreCase))
    {
        if (args.Length < 4)
        {
            throw new InvalidOperationException("Usage: begin-session <examId> <packageId> <mode>");
        }

        return new NativeCompanionRequest
        {
            Command = "begin-session",
            BeginSession = new BeginSessionPayload
            {
                ExamId = args[1],
                PackageId = args[2],
                Mode = args[3],
                RequestedAt = DateTimeOffset.UtcNow
            }
        };
    }

    if (args[0].Equals("end-session", StringComparison.OrdinalIgnoreCase))
    {
        return new NativeCompanionRequest
        {
            Command = "end-session",
            EndSession = new EndSessionPayload
            {
                Reason = args.Length > 1 ? string.Join(" ", args.Skip(1)) : "Session ended",
                RequestedAt = DateTimeOffset.UtcNow
            }
        };
    }

    throw new InvalidOperationException($"Unsupported command \"{args[0]}\".");
}
