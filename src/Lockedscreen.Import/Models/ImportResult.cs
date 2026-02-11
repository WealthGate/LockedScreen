namespace Lockedscreen.Import.Models;

public sealed class ImportResult
{
    public string Html { get; set; } = string.Empty;
    public List<string> Warnings { get; set; } = new();
}
