using System.Windows;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.Services;

public sealed class ThemeService
{
    private readonly ResourceDictionary _lightTheme = new() { Source = new Uri("Themes/Colors.Light.xaml", UriKind.Relative) };
    private readonly ResourceDictionary _darkTheme = new() { Source = new Uri("Themes/Colors.Dark.xaml", UriKind.Relative) };

    public void ApplyTheme(ThemePreference preference)
    {
        var appResources = Application.Current.Resources;
        var dictionaries = appResources.MergedDictionaries;
        for (var i = dictionaries.Count - 1; i >= 0; i--)
        {
            var source = dictionaries[i].Source?.ToString();
            if (source is null)
            {
                continue;
            }

            if (source.EndsWith("Themes/Colors.Light.xaml", StringComparison.OrdinalIgnoreCase) ||
                source.EndsWith("Themes/Colors.Dark.xaml", StringComparison.OrdinalIgnoreCase))
            {
                dictionaries.RemoveAt(i);
            }
        }

        switch (preference)
        {
            case ThemePreference.Light:
                dictionaries.Add(_lightTheme);
                break;
            case ThemePreference.Dark:
                dictionaries.Add(_darkTheme);
                break;
            case ThemePreference.System:
            default:
                var systemIsDark = SystemParameters.WindowGlassColor.R + SystemParameters.WindowGlassColor.G + SystemParameters.WindowGlassColor.B < 382;
                dictionaries.Add(systemIsDark ? _darkTheme : _lightTheme);
                break;
        }
    }
}
