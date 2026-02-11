namespace Lockedscreen.Core.Models;

public sealed class QuestionResponse
{
    public string QuestionId { get; set; } = string.Empty;
    public string? SelectedChoiceId { get; set; }
    public bool FlaggedForReview { get; set; }
    public bool IsCorrect { get; set; }
}
