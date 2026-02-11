using System.IO;
using System.Windows;
using Serilog;
using Lockedscreen.App.Services;
using Lockedscreen.App.ViewModels;
using Lockedscreen.Storage;

namespace Lockedscreen.App;

public partial class App : Application
{
    private AppServices? _services;

    private void Application_Startup(object sender, StartupEventArgs e)
    {
        StoragePaths.EnsureDirectories();
        Directory.CreateDirectory(Path.Combine(StoragePaths.BaseDataDirectory, "logs"));
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .WriteTo.File(Path.Combine(StoragePaths.BaseDataDirectory, "logs", "app.log"), rollingInterval: RollingInterval.Day)
            .CreateLogger();

        _services = new AppServices();
        _services.ThemeService.ApplyTheme(Core.Models.ThemePreference.System);
        _services.DensityService.ApplyDensity(Core.Models.LayoutDensity.Comfortable);

        var mainViewModel = new MainViewModel(_services);
        var window = new MainWindow { DataContext = mainViewModel };
        window.Show();
        _ = mainViewModel.ExaminerDashboard.RefreshAsync();
        _ = mainViewModel.StudentLogin.RefreshAsync();
    }
}
