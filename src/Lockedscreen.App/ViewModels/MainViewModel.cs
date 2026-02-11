using Lockedscreen.App.Services;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    private readonly AppServices _services;
    private ObservableObject _currentViewModel;
    private string _title = "Lockedscreen";

    public MainViewModel(AppServices services)
    {
        _services = services;
        Draft = new ExamDraftViewModel();

        ExaminerDashboard = new ExaminerDashboardViewModel(this);
        CreateExam = new CreateExamViewModel(this);
        ImportPreview = new ImportPreviewViewModel(this);
        AnswerKey = new AnswerKeyViewModel(this);
        PublishPackage = new PublishPackageViewModel(this);
        StudentLogin = new StudentLoginViewModel(this);
        StudentExam = new StudentExamViewModel(this);
        StudentReview = new StudentReviewViewModel(this);
        StudentResult = new StudentResultViewModel(this);

        _currentViewModel = ExaminerDashboard;
        NavigateToExaminerCommand = new RelayCommand(_ => NavigateTo(ExaminerDashboard));
        NavigateToStudentCommand = new RelayCommand(_ => NavigateTo(StudentLogin));
    }

    public AppServices Services => _services;
    public ExamDraftViewModel Draft { get; }
    public ExamSession? ActiveSession { get; set; }
    public ExamResult? CurrentResult { get; set; }

    public ExaminerDashboardViewModel ExaminerDashboard { get; }
    public CreateExamViewModel CreateExam { get; }
    public ImportPreviewViewModel ImportPreview { get; }
    public AnswerKeyViewModel AnswerKey { get; }
    public PublishPackageViewModel PublishPackage { get; }
    public StudentLoginViewModel StudentLogin { get; }
    public StudentExamViewModel StudentExam { get; }
    public StudentReviewViewModel StudentReview { get; }
    public StudentResultViewModel StudentResult { get; }

    public ObservableObject CurrentViewModel
    {
        get => _currentViewModel;
        set => SetProperty(ref _currentViewModel, value);
    }

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
    }

    public RelayCommand NavigateToExaminerCommand { get; }
    public RelayCommand NavigateToStudentCommand { get; }

    public void NavigateTo(ObservableObject viewModel)
    {
        CurrentViewModel = viewModel;
    }

    public void ApplyTheme(ThemePreference preference) => _services.ThemeService.ApplyTheme(preference);
}
