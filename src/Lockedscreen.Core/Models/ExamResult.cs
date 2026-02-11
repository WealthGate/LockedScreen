namespace Lockedscreen.Core.Models;

public sealed class ExamResult
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string ExamId { get; set; } = string.Empty;
    public string ExamName { get; set; } = string.Empty;
    public StudentIdentity Student { get; set; } = new();
    public DateTimeOffset StartedUtc { get; set; }
    public DateTimeOffset SubmittedUtc { get; set; }
    public int TotalQuestions { get; set; }
    public int CorrectQuestions { get; set; }
    public double ScorePercent { get; set; }
    public List<QuestionResponse> Responses { get; set; } = new();
}
