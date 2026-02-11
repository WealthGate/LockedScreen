using Lockedscreen.Core.Models;
using Lockedscreen.Core.Services;

namespace Lockedscreen.Tests;

public sealed class GradingServiceTests
{
    [Fact]
    public void GradesMultipleChoiceCorrectly()
    {
        var q1 = new Question
        {
            Id = "q1",
            PromptHtml = "<p>Q1</p>",
            Choices = new List<Choice>
            {
                new() { Id = "a", Label = "A", TextHtml = "A" },
                new() { Id = "b", Label = "B", TextHtml = "B" }
            },
            CorrectChoiceId = "a"
        };

        var q2 = new Question
        {
            Id = "q2",
            PromptHtml = "<p>Q2</p>",
            Choices = new List<Choice>
            {
                new() { Id = "c", Label = "A", TextHtml = "C" },
                new() { Id = "d", Label = "B", TextHtml = "D" }
            },
            CorrectChoiceId = "d"
        };

        var package = new ExamPackage
        {
            Name = "Sample",
            Questions = new List<Question> { q1, q2 }
        };

        var responses = new List<QuestionResponse>
        {
            new() { QuestionId = "q1", SelectedChoiceId = "a" },
            new() { QuestionId = "q2", SelectedChoiceId = "c" }
        };

        var grading = new GradingService();
        var result = grading.Grade(package, new StudentIdentity { Name = "Student" }, responses, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);

        Assert.Equal(2, result.TotalQuestions);
        Assert.Equal(1, result.CorrectQuestions);
        Assert.Equal(50.0, result.ScorePercent);
    }
}
