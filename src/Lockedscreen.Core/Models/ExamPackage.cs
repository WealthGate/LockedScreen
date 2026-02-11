namespace Lockedscreen.Core.Models;

public sealed class ExamPackage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    public int DurationMinutes { get; set; } = 60;
    public DateTimeOffset? StartTimeUtc { get; set; }
    public string InstructionsHtml { get; set; } = string.Empty;
    public bool RequireStudentId { get; set; }
    public ExamSourceType SourceType { get; set; } = ExamSourceType.Typed;
    public string? SourceUrl { get; set; }
    public string? SourceHtml { get; set; }
    public List<Question> Questions { get; set; } = new();
    public ExamSettings Settings { get; set; } = new();
    public string UnlockPinSalt { get; set; } = string.Empty;
    public string UnlockPinHash { get; set; } = string.Empty;
    public string? UnlockPinHint { get; set; }
    public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
}
