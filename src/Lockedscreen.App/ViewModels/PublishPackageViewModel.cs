using Lockedscreen.Core.Services;

namespace Lockedscreen.App.ViewModels;

public sealed class PublishPackageViewModel : ObservableObject
{
    private readonly MainViewModel _main;
    private readonly ExamPackageValidator _validator = new();
    private string _status = string.Empty;
    private IReadOnlyList<string> _issues = Array.Empty<string>();

    public PublishPackageViewModel(MainViewModel main)
    {
        _main = main;
        PublishCommand = new RelayCommand(async _ => await PublishAsync());
        BackCommand = new RelayCommand(_ => _main.NavigateTo(_main.AnswerKey));
    }

    public ExamDraftViewModel Draft => _main.Draft;

    public IReadOnlyList<string> Issues
    {
        get => _issues;
        set => SetProperty(ref _issues, value);
    }

    public string Status
    {
        get => _status;
        set => SetProperty(ref _status, value);
    }

    public RelayCommand PublishCommand { get; }
    public RelayCommand BackCommand { get; }

    private async Task PublishAsync()
    {
        var package = Draft.ToPackage();
        var issues = _validator.Validate(package);
        Issues = issues;
        if (issues.Count > 0)
        {
            Status = "Fix the highlighted issues before publishing.";
            return;
        }

        await _main.Services.ExamRepository.SaveAsync(package);
        Status = "Exam package saved.";
        await _main.ExaminerDashboard.RefreshAsync();
        _main.NavigateTo(_main.ExaminerDashboard);
    }
}
