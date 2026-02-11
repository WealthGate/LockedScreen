using System.Collections.ObjectModel;
using System.Windows.Threading;
using Lockedscreen.App.Services;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class StudentExamViewModel : ObservableObject
{
    private readonly MainViewModel _main;
    private readonly DispatcherTimer _timer;
    private ExamSession? _session;
    private int _currentIndex;
    private TimeSpan _timeRemaining;
    private string _timeRemainingText = "";

    public StudentExamViewModel(MainViewModel main)
    {
        _main = main;
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timer.Tick += (_, _) => Tick();
        NextCommand = new RelayCommand(_ => Move(1), _ => CanMove(1));
        PrevCommand = new RelayCommand(_ => Move(-1), _ => CanMove(-1));
        FlagCommand = new RelayCommand(_ => ToggleFlag());
        SubmitCommand = new RelayCommand(async _ => await SubmitAsync());
        ReviewCommand = new RelayCommand(_ =>
        {
            _main.StudentReview.Refresh();
            _main.NavigateTo(_main.StudentReview);
        });
        SelectChoiceCommand = new RelayCommand(choice =>
        {
            if (choice is Choice selected)
            {
                SelectChoice(selected);
            }
        });
    }

    public bool IsUrlExam => _session?.Package.SourceType == ExamSourceType.Url;
    public string? SourceUrl => _session?.Package.SourceUrl;
    public string StudentDisplay => _session is null ? string.Empty : string.IsNullOrWhiteSpace(_session.Student.StudentId)
        ? _session.Student.Name
        : $"{_session.Student.Name} ({_session.Student.StudentId})";

    public Question? CurrentQuestion => _session?.Package.Questions.ElementAtOrDefault(_currentIndex);
    public ObservableCollection<Choice> CurrentChoices { get; } = new();

    public string TimeRemainingText
    {
        get => _timeRemainingText;
        set => SetProperty(ref _timeRemainingText, value);
    }

    public int CurrentIndex
    {
        get => _currentIndex;
        set
        {
            if (SetProperty(ref _currentIndex, value))
            {
                RefreshQuestion();
            }
        }
    }

    public RelayCommand NextCommand { get; }
    public RelayCommand PrevCommand { get; }
    public RelayCommand FlagCommand { get; }
    public RelayCommand SubmitCommand { get; }
    public RelayCommand ReviewCommand { get; }
    public RelayCommand SelectChoiceCommand { get; }

    public void InitializeForSession(ExamSession session)
    {
        _session = session;
        _currentIndex = 0;
        _timeRemaining = TimeSpan.FromMinutes(session.Package.DurationMinutes);
        UpdateTimeText();
        RefreshQuestion();
        OnPropertyChanged(nameof(StudentDisplay));
        _timer.Start();
    }

    private void Tick()
    {
        if (_session is null)
        {
            return;
        }

        _timeRemaining = _timeRemaining.Subtract(TimeSpan.FromSeconds(1));
        if (_timeRemaining <= TimeSpan.Zero)
        {
            _timeRemaining = TimeSpan.Zero;
            UpdateTimeText();
            _timer.Stop();
            _ = SubmitAsync();
            return;
        }

        UpdateTimeText();
    }

    private void UpdateTimeText()
    {
        TimeRemainingText = $"{_timeRemaining:hh\\:mm\\:ss}";
    }

    private void RefreshQuestion()
    {
        CurrentChoices.Clear();
        var question = CurrentQuestion;
        if (question is null)
        {
            OnPropertyChanged(nameof(CurrentQuestion));
            return;
        }

        foreach (var choice in question.Choices.OrderBy(c => c.Order))
        {
            CurrentChoices.Add(choice);
        }

        OnPropertyChanged(nameof(CurrentQuestion));
    }

    private void SelectChoice(Choice choice)
    {
        if (_session is null || CurrentQuestion is null)
        {
            return;
        }

        var response = _session.GetResponse(CurrentQuestion.Id);
        response.SelectedChoiceId = choice.Id;
    }

    private void ToggleFlag()
    {
        if (_session is null || CurrentQuestion is null)
        {
            return;
        }

        var response = _session.GetResponse(CurrentQuestion.Id);
        response.FlaggedForReview = !response.FlaggedForReview;
    }

    private bool CanMove(int delta)
    {
        if (_session is null)
        {
            return false;
        }

        var next = _currentIndex + delta;
        return next >= 0 && next < _session.Package.Questions.Count;
    }

    private void Move(int delta)
    {
        if (CanMove(delta))
        {
            CurrentIndex += delta;
        }
    }

    private async Task SubmitAsync()
    {
        if (_session is null)
        {
            return;
        }

        _timer.Stop();
        var responses = _session.Responses.Values.ToList();
        var result = _main.Services.GradingService.Grade(
            _session.Package,
            _session.Student,
            responses,
            _session.StartedUtc,
            _main.Services.Clock.UtcNow);

        await _main.Services.ResultRepository.SaveAsync(result);
        _main.CurrentResult = result;
        _main.StudentResult.LoadResult(result, _session.Package);
        _main.NavigateTo(_main.StudentResult);
    }
}
