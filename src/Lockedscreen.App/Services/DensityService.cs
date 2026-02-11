using System.Windows;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.Services;

public sealed class DensityService
{
    private static readonly Thickness ControlPaddingComfortable = new(10, 6, 10, 6);
    private static readonly Thickness ControlPaddingCompact = new(8, 4, 8, 4);
    private static readonly Thickness ButtonPaddingComfortable = new(14, 8, 14, 8);
    private static readonly Thickness ButtonPaddingCompact = new(12, 6, 12, 6);
    private static readonly Thickness GhostButtonPaddingComfortable = new(12, 8, 12, 8);
    private static readonly Thickness GhostButtonPaddingCompact = new(10, 6, 10, 6);
    private static readonly Thickness ComboBoxPaddingComfortable = new(8, 4, 8, 4);
    private static readonly Thickness ComboBoxPaddingCompact = new(6, 3, 6, 3);
    private static readonly Thickness ComboBoxItemPaddingComfortable = new(8, 6, 8, 6);
    private static readonly Thickness ComboBoxItemPaddingCompact = new(6, 4, 6, 4);

    public void ApplyDensity(LayoutDensity density)
    {
        var resources = Application.Current.Resources;
        var isCompact = density == LayoutDensity.Compact;

        resources["ControlPadding"] = isCompact ? ControlPaddingCompact : ControlPaddingComfortable;
        resources["ButtonPadding"] = isCompact ? ButtonPaddingCompact : ButtonPaddingComfortable;
        resources["GhostButtonPadding"] = isCompact ? GhostButtonPaddingCompact : GhostButtonPaddingComfortable;
        resources["ComboBoxPadding"] = isCompact ? ComboBoxPaddingCompact : ComboBoxPaddingComfortable;
        resources["ComboBoxItemPadding"] = isCompact ? ComboBoxItemPaddingCompact : ComboBoxItemPaddingComfortable;
    }
}
