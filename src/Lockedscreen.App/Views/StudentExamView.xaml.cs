using System.Windows.Controls;
using Lockedscreen.App.ViewModels;

namespace Lockedscreen.App.Views;

public partial class StudentExamView : UserControl
{
    public StudentExamView()
    {
        InitializeComponent();
        DataContextChanged += async (_, _) =>
        {
            if (DataContext is StudentExamViewModel vm && vm.IsUrlExam && !string.IsNullOrWhiteSpace(vm.SourceUrl))
            {
                await ExamWebView.EnsureCoreWebView2Async();
                ExamWebView.Source = new Uri(vm.SourceUrl);
            }
        };
    }
}
