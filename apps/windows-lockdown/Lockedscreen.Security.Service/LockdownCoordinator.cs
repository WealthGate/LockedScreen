using System.Text;
using Lockedscreen.Security.Protocol;

namespace Lockedscreen.Security.Service;

internal sealed class LockdownCoordinator
{
    private static readonly string[] Capabilities =
    [
        "desktop-isolation",
        "process-supervision",
        "surface-policy"
    ];

    private readonly SemaphoreSlim _gate = new(1, 1);
    private ActiveSessionSummary? _activeSession;

    public async Task<NativeCompanionResponse> HandleAsync(NativeCompanionRequest request, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return request.Command.ToLowerInvariant() switch
            {
                "status" => Success("Native companion service is ready."),
                "begin-session" => BeginSession(request.BeginSession),
                "end-session" => EndSession(request.EndSession),
                _ => Failure("unsupported-command", $"Unsupported native companion command \"{request.Command}\".")
            };
        }
        finally
        {
            _gate.Release();
        }
    }

    private NativeCompanionResponse BeginSession(BeginSessionPayload? payload)
    {
        if (payload is null)
        {
            return Failure("missing-payload", "Begin-session requests require a payload.");
        }

        _activeSession = new ActiveSessionSummary
        {
            ExamId = payload.ExamId,
            PackageId = payload.PackageId,
            Mode = payload.Mode,
            StartedAt = DateTimeOffset.UtcNow
        };

        WriteAuditLine($"begin-session exam={payload.ExamId} package={payload.PackageId} mode={payload.Mode}");
        return Success($"Native lockdown session started for exam {payload.ExamId}.");
    }

    private NativeCompanionResponse EndSession(EndSessionPayload? payload)
    {
        var previous = _activeSession;
        _activeSession = null;
        WriteAuditLine($"end-session reason={(payload?.Reason ?? "Session ended")} previousExam={(previous?.ExamId ?? "none")}");
        return Success("Native lockdown session ended.");
    }

    private NativeCompanionResponse Success(string message) =>
        new()
        {
            Ok = true,
            Message = message,
            Status = new NativeCompanionStatus
            {
                ServiceMode = _activeSession is null ? "standby" : "active-session",
                SessionActive = _activeSession is not null,
                Capabilities = Capabilities,
                ActiveSession = _activeSession,
                UpdatedAt = DateTimeOffset.UtcNow
            }
        };

    private NativeCompanionResponse Failure(string errorCode, string message) =>
        new()
        {
            Ok = false,
            ErrorCode = errorCode,
            Message = message,
            Status = new NativeCompanionStatus
            {
                ServiceMode = _activeSession is null ? "standby" : "active-session",
                SessionActive = _activeSession is not null,
                Capabilities = Capabilities,
                ActiveSession = _activeSession,
                UpdatedAt = DateTimeOffset.UtcNow
            }
        };

    private static void WriteAuditLine(string message) => ServiceDiagnostics.WriteLine(message);
}
