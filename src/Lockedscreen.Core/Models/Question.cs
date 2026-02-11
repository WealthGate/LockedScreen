using System.Text.Json.Serialization;

namespace Lockedscreen.Core.Models;

public sealed class Question
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public QuestionType Type { get; set; } = QuestionType.MultipleChoice;
    public string PromptHtml { get; set; } = string.Empty;
    public List<Choice> Choices { get; set; } = new();
    public string? CorrectChoiceId { get; set; }
    public string? ExplanationHtml { get; set; }
    public int Order { get; set; }

    [JsonIgnore]
    public bool HasAnswerKey => !string.IsNullOrWhiteSpace(CorrectChoiceId);
}
