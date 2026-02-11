namespace Lockedscreen.Core.Models;

public sealed class ExamSettings
{
    public ThemePreference Theme { get; set; } = ThemePreference.System;
    public double FontScale { get; set; } = 1.0;
    public LayoutDensity Density { get; set; } = LayoutDensity.Comfortable;
    public bool ShowScoreOnSubmit { get; set; } = true;
    public bool AllowReviewAfterSubmit { get; set; } = true;
}
