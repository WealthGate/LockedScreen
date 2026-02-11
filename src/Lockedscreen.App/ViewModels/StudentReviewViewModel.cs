using System.Collections.ObjectModel;
using Lockedscreen.Core.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class StudentReviewViewModel : ObservableObject
{
    private readonly MainViewModel _main;

    public StudentReviewViewModel(MainViewModel main)
    {
        _main = main;
        FlaggedQuestions = new ObservableCollection<Question>();
        BackCommand = new RelayCommand(_ => _main.NavigateTo(_main.StudentExam));
        GoToQuestionCommand = new RelayCommand(param => GoToQuestion(param as Question));
    }

    public ObservableCollection<Question> FlaggedQuestions { get; }
    public RelayCommand BackCommand { get; }
    public RelayCommand GoToQuestionCommand { get; }

    public void Refresh()
    {
        FlaggedQuestions.Clear();
        if (_main.ActiveSession is null)
        {
            return;
        }

        foreach (var question in _main.ActiveSession.Package.Questions)
        {
            if (_main.ActiveSession.Responses.TryGetValue(question.Id, out var response) && response.FlaggedForReview)
            {
                FlaggedQuestions.Add(question);
            }
        }
    }

    private void GoToQuestion(Question? question)
    {
        if (question is null || _main.ActiveSession is null)
        {
            return;
        }

        var index = _main.ActiveSession.Package.Questions.FindIndex(q => q.Id == question.Id);
        if (index >= 0)
        {
            _main.StudentExam.CurrentIndex = index;
            _main.NavigateTo(_main.StudentExam);
        }
    }
}
