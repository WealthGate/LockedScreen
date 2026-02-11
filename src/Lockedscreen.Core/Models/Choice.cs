namespace Lockedscreen.Core.Models;

public sealed class Choice
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Label { get; set; } = string.Empty;
    public string TextHtml { get; set; } = string.Empty;
    public int Order { get; set; }
}
