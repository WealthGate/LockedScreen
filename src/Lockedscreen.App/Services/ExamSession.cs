using Lockedscreen.Core.Models;

namespace Lockedscreen.App.Services;

public sealed class ExamSession
{
    public ExamPackage Package { get; init; } = new();
    public StudentIdentity Student { get; init; } = new();
    public DateTimeOffset StartedUtc { get; init; } = DateTimeOffset.UtcNow;
    public Dictionary<string, QuestionResponse> Responses { get; } = new();

    public QuestionResponse GetResponse(string questionId)
    {
        if (!Responses.TryGetValue(questionId, out var response))
        {
            response = new QuestionResponse { QuestionId = questionId };
            Responses[questionId] = response;
        }

        return response;
    }
}
