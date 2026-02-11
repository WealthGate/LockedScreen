using System.Collections.ObjectModel;
using Lockedscreen.App.Services;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class StudentLoginViewModel : ObservableObject
{
    private readonly MainViewModel _main;
    private ExamPackage? _selectedExam;
    private string _studentName = string.Empty;
    private string _studentId = string.Empty;
    private string _status = string.Empty;

    public StudentLoginViewModel(MainViewModel main)
    {
        _main = main;
        Exams = new ObservableCollection<ExamPackage>();
        RefreshCommand = new RelayCommand(async _ => await RefreshAsync());
        StartExamCommand = new RelayCommand(_ => StartExam(), _ => SelectedExam is not null && !string.IsNullOrWhiteSpace(StudentName));
    }

    public ObservableCollection<ExamPackage> Exams { get; }

    public ExamPackage? SelectedExam
    {
        get => _selectedExam;
        set
        {
            if (SetProperty(ref _selectedExam, value))
            {
                StartExamCommand.RaiseCanExecuteChanged();
            }
        }
    }

    public string StudentName
    {
        get => _studentName;
        set
        {
            if (SetProperty(ref _studentName, value))
            {
                StartExamCommand.RaiseCanExecuteChanged();
            }
        }
    }

    public string StudentId
    {
        get => _studentId;
        set => SetProperty(ref _studentId, value);
    }

    public string Status
    {
        get => _status;
        set => SetProperty(ref _status, value);
    }

    public RelayCommand RefreshCommand { get; }
    public RelayCommand StartExamCommand { get; }

    public async Task RefreshAsync()
    {
        Exams.Clear();
        var list = await _main.Services.ExamRepository.ListAsync();
        foreach (var exam in list)
        {
            Exams.Add(exam);
        }
    }

    private void StartExam()
    {
        if (SelectedExam is null)
        {
            return;
        }

        if (SelectedExam.StartTimeUtc.HasValue && _main.Services.Clock.UtcNow < SelectedExam.StartTimeUtc.Value)
        {
            Status = $"Exam starts at {SelectedExam.StartTimeUtc.Value.ToLocalTime():f}.";
            return;
        }

        if (SelectedExam.RequireStudentId && string.IsNullOrWhiteSpace(StudentId))
        {
            Status = "Student ID is required.";
            return;
        }

        var session = new ExamSession
        {
            Package = SelectedExam,
            Student = new StudentIdentity
            {
                Name = StudentName,
                StudentId = string.IsNullOrWhiteSpace(StudentId) ? null : StudentId
            },
            StartedUtc = _main.Services.Clock.UtcNow
        };

        _main.ActiveSession = session;
        _main.CurrentResult = null;
        _main.ApplyTheme(SelectedExam.Settings.Theme);
        _main.Services.DensityService.ApplyDensity(SelectedExam.Settings.Density);
        _main.StudentExam.InitializeForSession(session);
        _main.NavigateTo(_main.StudentExam);
        Status = string.Empty;
    }
}
