using Lockedscreen.Core.Models;

namespace Lockedscreen.Core.Services;

public sealed class GradingService
{
    public ExamResult Grade(ExamPackage package, StudentIdentity student, IReadOnlyList<QuestionResponse> responses, DateTimeOffset startedUtc, DateTimeOffset submittedUtc)
    {
        var result = new ExamResult
        {
            ExamId = package.Id,
            ExamName = package.Name,
            Student = student,
            StartedUtc = startedUtc,
            SubmittedUtc = submittedUtc,
            TotalQuestions = package.Questions.Count,
            Responses = responses.ToList()
        };

        var correct = 0;
        foreach (var response in result.Responses)
        {
            var question = package.Questions.FirstOrDefault(q => q.Id == response.QuestionId);
            if (question is null)
            {
                response.IsCorrect = false;
                continue;
            }

            if (question.Type != QuestionType.MultipleChoice || string.IsNullOrWhiteSpace(question.CorrectChoiceId))
            {
                response.IsCorrect = false;
                continue;
            }

            response.IsCorrect = string.Equals(response.SelectedChoiceId, question.CorrectChoiceId, StringComparison.OrdinalIgnoreCase);
            if (response.IsCorrect)
            {
                correct++;
            }
        }

        result.CorrectQuestions = correct;
        result.ScorePercent = result.TotalQuestions == 0 ? 0 : Math.Round(100.0 * correct / result.TotalQuestions, 2);
        return result;
    }
}
