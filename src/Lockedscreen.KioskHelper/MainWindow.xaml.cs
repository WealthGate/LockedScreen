using System.Windows;
using Lockedscreen.KioskHelper.Services;

namespace Lockedscreen.KioskHelper;

public partial class MainWindow : Window
{
    private readonly KioskConfigurator _configurator = new();

    public MainWindow()
    {
        InitializeComponent();
        if (!_configurator.IsAdministrator())
        {
            AppendOutput("Warning: Run this helper as Administrator for kiosk setup.");
        }
    }

    private async void CreateUser_Click(object sender, RoutedEventArgs e)
    {
        var user = UserNameBox.Text.Trim();
        var password = PasswordBox.Password;
        AppendOutput(await _configurator.CreateLocalUserAsync(user, password));
    }

    private async void EnableKiosk_Click(object sender, RoutedEventArgs e)
    {
        var user = UserNameBox.Text.Trim();
        var appPath = AppPathBox.Text.Trim();
        AppendOutput(await _configurator.EnableAssignedAccessAsync(user, appPath));
    }

    private async void DisableKiosk_Click(object sender, RoutedEventArgs e)
    {
        AppendOutput(await _configurator.DisableAssignedAccessAsync());
    }

    private async void OpenSettings_Click(object sender, RoutedEventArgs e)
    {
        AppendOutput(await _configurator.OpenAssignedAccessSettingsAsync());
    }

    private async void CheckWebView_Click(object sender, RoutedEventArgs e)
    {
        AppendOutput(await _configurator.CheckWebView2RuntimeAsync());
    }

    private void AppendOutput(string output)
    {
        OutputBox.AppendText($"[{DateTime.Now:T}] {output}\n");
        OutputBox.ScrollToEnd();
    }
}
