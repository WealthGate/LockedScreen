using Lockedscreen.Core.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class AnswerKeyViewModel : ObservableObject
{
    private readonly MainViewModel _main;

    public AnswerKeyViewModel(MainViewModel main)
    {
        _main = main;
        SetCorrectChoiceCommand = new RelayCommand(param => SetCorrectChoice(param));
        BackCommand = new RelayCommand(_ => _main.NavigateTo(_main.CreateExam));
        NextCommand = new RelayCommand(_ => _main.NavigateTo(_main.PublishPackage));
    }

    public IReadOnlyList<Question> Questions => _main.Draft.Questions;

    public RelayCommand SetCorrectChoiceCommand { get; }
    public RelayCommand BackCommand { get; }
    public RelayCommand NextCommand { get; }

    private void SetCorrectChoice(object? param)
    {
        if (param is not Tuple<Question, Choice> tuple)
        {
            return;
        }

        tuple.Item1.CorrectChoiceId = tuple.Item2.Id;
        OnPropertyChanged(nameof(Questions));
    }
}
