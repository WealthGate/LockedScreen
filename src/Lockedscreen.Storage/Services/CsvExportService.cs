using System.Text;
using Lockedscreen.Core.Models;

namespace Lockedscreen.Storage.Services;

public sealed class CsvExportService
{
    public string ExportResults(IEnumerable<ExamResult> results)
    {
        var sb = new StringBuilder();
        sb.AppendLine("ExamId,ExamName,StudentName,StudentId,StartedUtc,SubmittedUtc,TotalQuestions,CorrectQuestions,ScorePercent");
        foreach (var result in results)
        {
            sb.AppendLine(string.Join(",", new[]
            {
                Escape(result.ExamId),
                Escape(result.ExamName),
                Escape(result.Student.Name),
                Escape(result.Student.StudentId ?? string.Empty),
                Escape(result.StartedUtc.ToString("O")),
                Escape(result.SubmittedUtc.ToString("O")),
                result.TotalQuestions.ToString(),
                result.CorrectQuestions.ToString(),
                result.ScorePercent.ToString("F2")
            }));
        }

        return sb.ToString();
    }

    public async Task WriteResultsAsync(string path, IEnumerable<ExamResult> results, CancellationToken cancellationToken = default)
    {
        var csv = ExportResults(results);
        await File.WriteAllTextAsync(path, csv, cancellationToken);
    }

    private static string Escape(string value)
    {
        if (value.Contains('"') || value.Contains(',') || value.Contains('\n') || value.Contains('\r'))
        {
            return '"' + value.Replace("\"", "\"\"") + '"';
        }

        return value;
    }
}
