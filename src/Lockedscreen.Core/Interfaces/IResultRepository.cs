using Lockedscreen.Core.Models;

namespace Lockedscreen.Core.Interfaces;

public interface IResultRepository
{
    Task SaveAsync(ExamResult result, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ExamResult>> ListAsync(string examId, CancellationToken cancellationToken = default);
}
