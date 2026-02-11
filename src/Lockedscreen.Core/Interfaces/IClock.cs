namespace Lockedscreen.Core.Interfaces;

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}
