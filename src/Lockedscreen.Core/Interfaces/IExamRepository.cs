using Lockedscreen.Core.Models;

namespace Lockedscreen.Core.Interfaces;

public interface IExamRepository
{
    Task SaveAsync(ExamPackage package, CancellationToken cancellationToken = default);
    Task<ExamPackage?> LoadAsync(string examId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ExamPackage>> ListAsync(CancellationToken cancellationToken = default);
}
