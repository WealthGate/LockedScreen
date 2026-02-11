namespace Lockedscreen.App.Services;

public sealed class PinDialogService
{
    public bool TryGetPin(out string pin)
    {
        var dialog = new Views.UnlockPinDialog();
        var result = dialog.ShowDialog();
        pin = dialog.Pin;
        return result == true;
    }
}
