namespace Lockedscreen.App.ViewModels;

public sealed class ImportPreviewViewModel : ObservableObject
{
    private readonly MainViewModel _main;

    public ImportPreviewViewModel(MainViewModel main)
    {
        _main = main;
        BackCommand = new RelayCommand(_ => _main.NavigateTo(_main.CreateExam));
    }

    public string? SourceHtml => _main.Draft.SourceHtml;
    public IReadOnlyList<string> Warnings => _main.Draft.ImportWarnings;
    public RelayCommand BackCommand { get; }
}
