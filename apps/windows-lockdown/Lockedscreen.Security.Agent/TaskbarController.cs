namespace Lockedscreen.Security.Agent;

internal sealed class TaskbarController : IDisposable
{
    private readonly List<IntPtr> _handles = [];

    public void Hide()
    {
        foreach (var className in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" })
        {
            var handle = NativeMethods.FindWindow(className, null);
            if (handle != IntPtr.Zero)
            {
                _handles.Add(handle);
                NativeMethods.ShowWindowAsync(handle, NativeMethods.SwHide);
            }
        }
    }

    public void Dispose()
    {
        foreach (var handle in _handles.Distinct())
        {
            if (handle != IntPtr.Zero)
            {
                NativeMethods.ShowWindowAsync(handle, NativeMethods.SwShow);
            }
        }

        _handles.Clear();
    }
}
