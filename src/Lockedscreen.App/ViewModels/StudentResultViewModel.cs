using System.Windows;
using Lockedscreen.Core.Models;
using Lockedscreen.Core.Services;

namespace Lockedscreen.App.ViewModels;

public sealed class StudentResultViewModel : ObservableObject
{
    private readonly MainViewModel _main;
    private ExamResult? _result;
    private ExamPackage? _package;

    public StudentResultViewModel(MainViewModel main)
    {
        _main = main;
        BackToLoginCommand = new RelayCommand(_ => _main.NavigateTo(_main.StudentLogin));
        ReviewCommand = new RelayCommand(_ => Review(), _ => _package?.Settings.AllowReviewAfterSubmit == true);
        ExitExamCommand = new RelayCommand(_ => ExitExam());
    }

    public ExamResult? Result
    {
        get => _result;
        private set => SetProperty(ref _result, value);
    }

    public string ScoreText => Result is null ? string.Empty : $"{Result.CorrectQuestions}/{Result.TotalQuestions} ({Result.ScorePercent:F1}%)";

    public RelayCommand BackToLoginCommand { get; }
    public RelayCommand ReviewCommand { get; }
    public RelayCommand ExitExamCommand { get; }

    public void LoadResult(ExamResult result, ExamPackage package)
    {
        Result = result;
        _package = package;
        OnPropertyChanged(nameof(ScoreText));
    }

    private void Review()
    {
        _main.StudentReview.Refresh();
        _main.NavigateTo(_main.StudentReview);
    }

    private void ExitExam()
    {
        if (_package is null)
        {
            return;
        }

        if (_main.Services.PinDialogService.TryGetPin(out var pin) &&
            PinHasher.VerifyPin(pin, _package.UnlockPinSalt, _package.UnlockPinHash))
        {
            Application.Current.Shutdown();
        }
        else
        {
            MessageBox.Show("Invalid PIN.", "Unlock Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }
}
