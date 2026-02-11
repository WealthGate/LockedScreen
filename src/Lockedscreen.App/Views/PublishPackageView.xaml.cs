using System.Windows.Controls;
using Lockedscreen.App.ViewModels;

namespace Lockedscreen.App.Views;

public partial class PublishPackageView : UserControl
{
    public PublishPackageView()
    {
        InitializeComponent();
        PinBox.PasswordChanged += (_, _) =>
        {
            if (DataContext is PublishPackageViewModel vm)
            {
                vm.Draft.UnlockPin = PinBox.Password;
            }
        };
    }
}
