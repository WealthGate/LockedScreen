using System.Collections.ObjectModel;
using Lockedscreen.Core.Models;
using Lockedscreen.Import.Models;

namespace Lockedscreen.App.ViewModels;

public sealed class CreateExamViewModel : ObservableObject
{
    private readonly MainViewModel _main;
    private string _statusMessage = string.Empty;

    public CreateExamViewModel(MainViewModel main)
    {
        _main = main;
        ImportWarnings = _main.Draft.ImportWarnings;
        AddQuestionCommand = new RelayCommand(_ => AddQuestion());
        RemoveQuestionCommand = new RelayCommand(q => RemoveQuestion(q as Question), q => q is Question);
        ImportDocxCommand = new RelayCommand(_ => ImportDocx());
        ImportHtmlCommand = new RelayCommand(_ => ImportHtml());
        SetUrlSourceCommand = new RelayCommand(_ => SetUrlSource());
        PreviewImportCommand = new RelayCommand(_ => _main.NavigateTo(_main.ImportPreview));
        NextToAnswerKeyCommand = new RelayCommand(_ => _main.NavigateTo(_main.AnswerKey));
    }

    public ExamDraftViewModel Draft => _main.Draft;
    public ObservableCollection<string> ImportWarnings { get; }

    public string StatusMessage
    {
        get => _statusMessage;
        set => SetProperty(ref _statusMessage, value);
    }

    public RelayCommand AddQuestionCommand { get; }
    public RelayCommand RemoveQuestionCommand { get; }
    public RelayCommand ImportDocxCommand { get; }
    public RelayCommand ImportHtmlCommand { get; }
    public RelayCommand SetUrlSourceCommand { get; }
    public RelayCommand PreviewImportCommand { get; }
    public RelayCommand NextToAnswerKeyCommand { get; }

    public void ApplyDraftTheme()
    {
        _main.ApplyTheme(Draft.Settings.Theme);
    }

    public void ApplyDraftDensity()
    {
        _main.Services.DensityService.ApplyDensity(Draft.Settings.Density);
    }

    private void AddQuestion()
    {
        var index = Draft.Questions.Count + 1;
        Draft.Questions.Add(new Question
        {
            Order = index,
            PromptHtml = $"<p>Question {index}</p>",
            Choices = new List<Choice>
            {
                new() { Label = "A", TextHtml = "<p>Option A</p>", Order = 1 },
                new() { Label = "B", TextHtml = "<p>Option B</p>", Order = 2 },
                new() { Label = "C", TextHtml = "<p>Option C</p>", Order = 3 },
                new() { Label = "D", TextHtml = "<p>Option D</p>", Order = 4 }
            }
        });
    }

    private void RemoveQuestion(Question? question)
    {
        if (question is null)
        {
            return;
        }

        Draft.Questions.Remove(question);
    }

    private void ImportDocx()
    {
        if (string.IsNullOrWhiteSpace(Draft.SourcePath))
        {
            StatusMessage = "Enter a DOCX file path.";
            return;
        }

        var result = _main.Services.DocxImportService.Load(Draft.SourcePath);
        ApplyImportResult(result, ExamSourceType.ImportedDocx);
        StatusMessage = "DOCX imported. Review preview for formatting.";
    }

    private void ImportHtml()
    {
        if (string.IsNullOrWhiteSpace(Draft.SourcePath))
        {
            StatusMessage = "Enter an HTML file path.";
            return;
        }

        var result = _main.Services.HtmlImportService.LoadFromFile(Draft.SourcePath);
        ApplyImportResult(result, ExamSourceType.ImportedHtml);
        StatusMessage = "HTML imported.";
    }

    private void SetUrlSource()
    {
        if (string.IsNullOrWhiteSpace(Draft.SourceUrl))
        {
            StatusMessage = "Enter a URL for the hosted exam.";
            return;
        }

        Draft.SourceType = ExamSourceType.Url;
        Draft.SourceHtml = null;
        ImportWarnings.Clear();
        StatusMessage = "URL source configured.";
    }

    private void ApplyImportResult(ImportResult result, ExamSourceType sourceType)
    {
        Draft.SourceType = sourceType;
        Draft.SourceHtml = result.Html;
        Draft.ImportWarnings.Clear();
        foreach (var warning in result.Warnings)
        {
            Draft.ImportWarnings.Add(warning);
        }
    }
}
