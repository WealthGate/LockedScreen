using Lockedscreen.Core.Models;

namespace Lockedscreen.Core.Services;

public sealed class ExamPackageValidator
{
    public IReadOnlyList<string> Validate(ExamPackage package)
    {
        var issues = new List<string>();
        if (string.IsNullOrWhiteSpace(package.Name))
        {
            issues.Add("Exam name is required.");
        }

        if (package.DurationMinutes <= 0)
        {
            issues.Add("Duration must be greater than 0.");
        }

        if (package.SourceType == ExamSourceType.Url && string.IsNullOrWhiteSpace(package.SourceUrl))
        {
            issues.Add("Source URL is required for URL-based exams.");
        }

        if (package.SourceType != ExamSourceType.Url && string.IsNullOrWhiteSpace(package.SourceHtml) && package.Questions.Count == 0)
        {
            issues.Add("Provide questions or imported content.");
        }

        if (string.IsNullOrWhiteSpace(package.UnlockPinHash) || string.IsNullOrWhiteSpace(package.UnlockPinSalt))
        {
            issues.Add("Unlock PIN is required.");
        }

        return issues;
    }
}
