using System.Text.Json;
using Lockedscreen.Core.Interfaces;
using Lockedscreen.Core.Models;

namespace Lockedscreen.Storage.Repositories;

public sealed class LocalFileExamRepository : IExamRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    public async Task SaveAsync(ExamPackage package, CancellationToken cancellationToken = default)
    {
        StoragePaths.EnsureDirectories();
        var fileName = $"{package.Id}.lockedscreen_exam.json";
        var path = Path.Combine(StoragePaths.ExamsDirectory, fileName);
        var json = JsonSerializer.Serialize(package, JsonOptions);
        await File.WriteAllTextAsync(path, json, cancellationToken);
    }

    public async Task<ExamPackage?> LoadAsync(string examId, CancellationToken cancellationToken = default)
    {
        var path = Path.Combine(StoragePaths.ExamsDirectory, $"{examId}.lockedscreen_exam.json");
        if (!File.Exists(path))
        {
            return null;
        }

        var json = await File.ReadAllTextAsync(path, cancellationToken);
        return JsonSerializer.Deserialize<ExamPackage>(json, JsonOptions);
    }

    public Task<IReadOnlyList<ExamPackage>> ListAsync(CancellationToken cancellationToken = default)
    {
        StoragePaths.EnsureDirectories();
        var packages = new List<ExamPackage>();
        foreach (var file in Directory.EnumerateFiles(StoragePaths.ExamsDirectory, "*.lockedscreen_exam.json"))
        {
            var json = File.ReadAllText(file);
            var package = JsonSerializer.Deserialize<ExamPackage>(json, JsonOptions);
            if (package is not null)
            {
                packages.Add(package);
            }
        }

        return Task.FromResult<IReadOnlyList<ExamPackage>>(packages.OrderByDescending(p => p.CreatedUtc).ToList());
    }
}
