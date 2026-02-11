using Lockedscreen.Core.Interfaces;
using Lockedscreen.Core.Services;
using Lockedscreen.Import.Services;
using Lockedscreen.Storage.Repositories;
using Lockedscreen.Storage.Services;

namespace Lockedscreen.App.Services;

public sealed class AppServices
{
    public IExamRepository ExamRepository { get; } = new LocalFileExamRepository();
    public IResultRepository ResultRepository { get; } = new LocalFileResultRepository();
    public CsvExportService CsvExportService { get; } = new();
    public DocxImportService DocxImportService { get; } = new();
    public HtmlImportService HtmlImportService { get; } = new();
    public GradingService GradingService { get; } = new();
    public IClock Clock { get; } = new SystemClock();
    public ThemeService ThemeService { get; } = new();
    public DensityService DensityService { get; } = new();
    public PinDialogService PinDialogService { get; } = new();
}
