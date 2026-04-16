namespace Lockedscreen.Security.Protocol;

public static class NativeCompanionProtocol
{
    public const string PipeName = "LockedscreenSecurityPipe";

    public const string Host = "127.0.0.1";

    public const int Port = 47831;
}

public sealed record NativeCompanionRequest
{
    public string RequestId { get; init; } = Guid.NewGuid().ToString("N");

    public string Command { get; init; } = "status";

    public BeginSessionPayload? BeginSession { get; init; }

    public EndSessionPayload? EndSession { get; init; }
}

public sealed record BeginSessionPayload
{
    public required string ExamId { get; init; }

    public required string PackageId { get; init; }

    public required string Mode { get; init; }

    public DateTimeOffset RequestedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed record EndSessionPayload
{
    public string Reason { get; init; } = "Session ended";

    public DateTimeOffset RequestedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed record NativeCompanionResponse
{
    public bool Ok { get; init; }

    public string Message { get; init; } = string.Empty;

    public string? ErrorCode { get; init; }

    public NativeCompanionStatus Status { get; init; } = NativeCompanionStatus.Empty;
}

public sealed record NativeCompanionStatus
{
    public static NativeCompanionStatus Empty { get; } = new();

    public string ServiceMode { get; init; } = "standby";

    public bool SessionActive { get; init; }

    public string[] Capabilities { get; init; } = [];

    public ActiveSessionSummary? ActiveSession { get; init; }

    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;
}

public sealed record ActiveSessionSummary
{
    public required string ExamId { get; init; }

    public required string PackageId { get; init; }

    public required string Mode { get; init; }

    public DateTimeOffset StartedAt { get; init; } = DateTimeOffset.UtcNow;
}
