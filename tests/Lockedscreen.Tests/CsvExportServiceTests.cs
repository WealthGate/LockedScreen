using Lockedscreen.Core.Models;
using Lockedscreen.Storage.Services;

namespace Lockedscreen.Tests;

public sealed class CsvExportServiceTests
{
    [Fact]
    public void ExportsCsvWithHeader()
    {
        var result = new ExamResult
        {
            ExamId = "exam1",
            ExamName = "Sample",
            Student = new StudentIdentity { Name = "Student" },
            StartedUtc = DateTimeOffset.Parse("2025-01-01T10:00:00Z"),
            SubmittedUtc = DateTimeOffset.Parse("2025-01-01T11:00:00Z"),
            TotalQuestions = 10,
            CorrectQuestions = 8,
            ScorePercent = 80.0
        };

        var service = new CsvExportService();
        var csv = service.ExportResults(new[] { result });

        Assert.Contains("ExamId,ExamName,StudentName", csv);
        Assert.Contains("exam1", csv);
        Assert.Contains("80.00", csv);
    }
}
