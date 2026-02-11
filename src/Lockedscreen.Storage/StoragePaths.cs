namespace Lockedscreen.Storage;

public static class StoragePaths
{
    public static string BaseDataDirectory => Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
    public static string ExamsDirectory => Path.Combine(BaseDataDirectory, "exams");
    public static string ResultsDirectory => Path.Combine(BaseDataDirectory, "results");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(ExamsDirectory);
        Directory.CreateDirectory(ResultsDirectory);
    }
}
