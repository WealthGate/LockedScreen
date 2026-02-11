using Lockedscreen.Core.Interfaces;

namespace Lockedscreen.Core.Services;

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}
