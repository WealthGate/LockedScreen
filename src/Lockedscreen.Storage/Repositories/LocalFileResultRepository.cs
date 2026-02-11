using System.Text.Json;
using Lockedscreen.Core.Interfaces;
using Lockedscreen.Core.Models;

namespace Lockedscreen.Storage.Repositories;

public sealed class LocalFileResultRepository : IResultRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    public async Task SaveAsync(ExamResult result, CancellationToken cancellationToken = default)
    {
        StoragePaths.EnsureDirectories();
        var fileName = $"{result.ExamId}_{result.Student.Name}_{result.SubmittedUtc:yyyyMMddHHmmss}.json";
        var safeName = string.Join("_", fileName.Split(Path.GetInvalidFileNameChars()));
        var path = Path.Combine(StoragePaths.ResultsDirectory, safeName);
        var json = JsonSerializer.Serialize(result, JsonOptions);
        await File.WriteAllTextAsync(path, json, cancellationToken);
    }

    public Task<IReadOnlyList<ExamResult>> ListAsync(string examId, CancellationToken cancellationToken = default)
    {
        StoragePaths.EnsureDirectories();
        var results = new List<ExamResult>();
        foreach (var file in Directory.EnumerateFiles(StoragePaths.ResultsDirectory, $"{examId}_*.json"))
        {
            var json = File.ReadAllText(file);
            var result = JsonSerializer.Deserialize<ExamResult>(json, JsonOptions);
            if (result is not null)
            {
                results.Add(result);
            }
        }

        return Task.FromResult<IReadOnlyList<ExamResult>>(results.OrderByDescending(r => r.SubmittedUtc).ToList());
    }
}
