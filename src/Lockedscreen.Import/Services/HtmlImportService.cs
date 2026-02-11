using Lockedscreen.Import.Models;

namespace Lockedscreen.Import.Services;

public sealed class HtmlImportService
{
    public ImportResult LoadFromFile(string path)
    {
        var html = File.ReadAllText(path);
        return new ImportResult
        {
            Html = NormalizeHtml(html)
        };
    }

    public ImportResult LoadFromString(string html)
    {
        return new ImportResult
        {
            Html = NormalizeHtml(html)
        };
    }

    private static string NormalizeHtml(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return "<p>(empty)</p>";
        }

        return html;
    }
}
