using System.Windows;

namespace Lockedscreen.App.Views;

public partial class UnlockPinDialog : Window
{
    public UnlockPinDialog()
    {
        InitializeComponent();
    }

    public string Pin { get; private set; } = string.Empty;

    private void Unlock_Click(object sender, RoutedEventArgs e)
    {
        Pin = PinBox.Password;
        DialogResult = true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
