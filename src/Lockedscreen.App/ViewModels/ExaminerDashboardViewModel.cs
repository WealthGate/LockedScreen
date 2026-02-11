using System.Collections.ObjectModel;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class ExaminerDashboardViewModel : ObservableObject
{
    private readonly MainViewModel _main;
    private ExamPackage? _selectedExam;
    private bool _isBusy;

    public ExaminerDashboardViewModel(MainViewModel main)
    {
        _main = main;
        Exams = new ObservableCollection<ExamPackage>();
        RefreshCommand = new RelayCommand(async _ => await RefreshAsync());
        CreateNewCommand = new RelayCommand(_ => CreateNew());
        LoadSelectedCommand = new RelayCommand(async _ => await LoadSelectedAsync(), _ => SelectedExam is not null);
    }

    public ObservableCollection<ExamPackage> Exams { get; }

    public ExamPackage? SelectedExam
    {
        get => _selectedExam;
        set
        {
            if (SetProperty(ref _selectedExam, value))
            {
                LoadSelectedCommand.RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsBusy
    {
        get => _isBusy;
        set => SetProperty(ref _isBusy, value);
    }

    public RelayCommand RefreshCommand { get; }
    public RelayCommand CreateNewCommand { get; }
    public RelayCommand LoadSelectedCommand { get; }

    public async Task RefreshAsync()
    {
        IsBusy = true;
        Exams.Clear();
        var list = await _main.Services.ExamRepository.ListAsync();
        foreach (var exam in list)
        {
            Exams.Add(exam);
        }
        IsBusy = false;
    }

    private void CreateNew()
    {
        _main.Draft.Reset();
        _main.NavigateTo(_main.CreateExam);
    }

    private async Task LoadSelectedAsync()
    {
        if (SelectedExam is null)
        {
            return;
        }

        var loaded = await _main.Services.ExamRepository.LoadAsync(SelectedExam.Id);
        if (loaded is null)
        {
            return;
        }

        _main.Draft.Reset();
        _main.Draft.Name = loaded.Name;
        _main.Draft.DurationMinutes = loaded.DurationMinutes;
        _main.Draft.StartTimeLocal = loaded.StartTimeUtc?.ToLocalTime().DateTime;
        _main.Draft.InstructionsHtml = loaded.InstructionsHtml;
        _main.Draft.RequireStudentId = loaded.RequireStudentId;
        _main.Draft.SourceType = loaded.SourceType;
        _main.Draft.SourceUrl = loaded.SourceUrl;
        _main.Draft.SourceHtml = loaded.SourceHtml;
        _main.Draft.Settings.Theme = loaded.Settings.Theme;
        _main.Draft.Settings.FontScale = loaded.Settings.FontScale;
        _main.Draft.Settings.Density = loaded.Settings.Density;
        _main.Draft.Questions.Clear();
        foreach (var q in loaded.Questions.OrderBy(q => q.Order))
        {
            _main.Draft.Questions.Add(q);
        }

        _main.NavigateTo(_main.CreateExam);
    }
}
