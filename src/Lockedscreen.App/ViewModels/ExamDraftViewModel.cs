using System.Collections.ObjectModel;
using Lockedscreen.Core.Models;
using Lockedscreen.Core.Services;

namespace Lockedscreen.App.ViewModels;

public sealed class ExamDraftViewModel : ObservableObject
{
    private string _name = string.Empty;
    private int _durationMinutes = 60;
    private DateTime? _startTimeLocal;
    private string _instructionsHtml = string.Empty;
    private bool _requireStudentId;
    private ExamSourceType _sourceType = ExamSourceType.Typed;
    private string? _sourcePath;
    private string? _sourceUrl;
    private string? _sourceHtml;
    private string _unlockPin = string.Empty;
    private string? _unlockPinHint;

    public string Name
    {
        get => _name;
        set => SetProperty(ref _name, value);
    }

    public int DurationMinutes
    {
        get => _durationMinutes;
        set => SetProperty(ref _durationMinutes, value);
    }

    public DateTime? StartTimeLocal
    {
        get => _startTimeLocal;
        set => SetProperty(ref _startTimeLocal, value);
    }

    public string InstructionsHtml
    {
        get => _instructionsHtml;
        set => SetProperty(ref _instructionsHtml, value);
    }

    public bool RequireStudentId
    {
        get => _requireStudentId;
        set => SetProperty(ref _requireStudentId, value);
    }

    public ExamSourceType SourceType
    {
        get => _sourceType;
        set => SetProperty(ref _sourceType, value);
    }

    public string? SourcePath
    {
        get => _sourcePath;
        set => SetProperty(ref _sourcePath, value);
    }

    public string? SourceUrl
    {
        get => _sourceUrl;
        set => SetProperty(ref _sourceUrl, value);
    }

    public string? SourceHtml
    {
        get => _sourceHtml;
        set => SetProperty(ref _sourceHtml, value);
    }

    public string UnlockPin
    {
        get => _unlockPin;
        set => SetProperty(ref _unlockPin, value);
    }

    public string? UnlockPinHint
    {
        get => _unlockPinHint;
        set => SetProperty(ref _unlockPinHint, value);
    }

    public ExamSettings Settings { get; } = new();
    public ObservableCollection<Question> Questions { get; } = new();
    public ObservableCollection<string> ImportWarnings { get; } = new();

    public ExamPackage ToPackage()
    {
        var salt = PinHasher.GenerateSalt();
        var hash = PinHasher.HashPin(UnlockPin, salt);

        return new ExamPackage
        {
            Name = Name,
            DurationMinutes = DurationMinutes,
            StartTimeUtc = StartTimeLocal.HasValue ? new DateTimeOffset(StartTimeLocal.Value).ToUniversalTime() : null,
            InstructionsHtml = InstructionsHtml,
            RequireStudentId = RequireStudentId,
            SourceType = SourceType,
            SourceUrl = SourceUrl,
            SourceHtml = SourceHtml,
            Questions = Questions.ToList(),
            Settings = Settings,
            UnlockPinSalt = salt,
            UnlockPinHash = hash,
            UnlockPinHint = UnlockPinHint
        };
    }

    public void Reset()
    {
        Name = string.Empty;
        DurationMinutes = 60;
        StartTimeLocal = null;
        InstructionsHtml = string.Empty;
        RequireStudentId = false;
        SourceType = ExamSourceType.Typed;
        SourcePath = null;
        SourceUrl = null;
        SourceHtml = null;
        UnlockPin = string.Empty;
        UnlockPinHint = null;
        Settings.Theme = ThemePreference.System;
        Settings.FontScale = 1.0;
        Settings.Density = LayoutDensity.Comfortable;
        Questions.Clear();
        ImportWarnings.Clear();
    }
}
