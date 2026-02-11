using System.Windows.Controls;
using Lockedscreen.App.ViewModels;

namespace Lockedscreen.App.Views;

public partial class CreateExamView : UserControl
{
    public CreateExamView()
    {
        InitializeComponent();
    }

    private void ThemeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DataContext is CreateExamViewModel viewModel)
        {
            viewModel.ApplyDraftTheme();
        }
    }

    private void DensitySelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DataContext is CreateExamViewModel viewModel)
        {
            viewModel.ApplyDraftDensity();
        }
    }
}
