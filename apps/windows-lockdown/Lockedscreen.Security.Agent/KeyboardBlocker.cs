using System.Runtime.InteropServices;

namespace Lockedscreen.Security.Agent;

internal sealed class KeyboardBlocker : IDisposable
{
    private readonly NativeMethods.LowLevelKeyboardProc _callback;
    private IntPtr _hookHandle;

    public KeyboardBlocker()
    {
        _callback = HookCallback;
    }

    public void Start()
    {
        var moduleHandle = NativeMethods.GetModuleHandle(null);
        _hookHandle = NativeMethods.SetWindowsHookEx(NativeMethods.WhKeyboardLl, _callback, moduleHandle, 0);
        if (_hookHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException("Unable to install the low-level keyboard hook.");
        }
    }

    public void Dispose()
    {
        if (_hookHandle != IntPtr.Zero)
        {
            NativeMethods.UnhookWindowsHookEx(_hookHandle);
            _hookHandle = IntPtr.Zero;
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0 || !IsKeyboardMessage(wParam))
        {
            return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        var data = Marshal.PtrToStructure<NativeMethods.KbdLlHookStruct>(lParam);
        var key = (Keys)data.VkCode;
        var altPressed = IsPressed(Keys.Menu) || IsPressed(Keys.LMenu) || IsPressed(Keys.RMenu);
        var ctrlPressed = IsPressed(Keys.ControlKey) || IsPressed(Keys.LControlKey) || IsPressed(Keys.RControlKey);
        var shiftPressed = IsPressed(Keys.ShiftKey) || IsPressed(Keys.LShiftKey) || IsPressed(Keys.RShiftKey);
        var winPressed = IsPressed(Keys.LWin) || IsPressed(Keys.RWin);

        var shouldBlock =
            key is Keys.LWin or Keys.RWin or Keys.Apps or Keys.Sleep ||
            key is Keys.PrintScreen or Keys.Snapshot ||
            key is Keys.BrowserBack or Keys.BrowserForward or Keys.BrowserHome or Keys.BrowserSearch or Keys.BrowserFavorites ||
            winPressed ||
            (altPressed && (key is Keys.Tab or Keys.Escape or Keys.F4 or Keys.Space)) ||
            (ctrlPressed && (key is Keys.Escape or Keys.LWin or Keys.RWin)) ||
            (ctrlPressed && shiftPressed && key is Keys.Escape) ||
            (ctrlPressed && altPressed && (key is Keys.Delete or Keys.Escape));

        if (shouldBlock)
        {
            AgentLog.WriteLine($"key-block vk={(int)key}");
            return (IntPtr)1;
        }

        return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static bool IsKeyboardMessage(IntPtr message) =>
        message == NativeMethods.WmKeyDown ||
        message == NativeMethods.WmKeyUp ||
        message == NativeMethods.WmSysKeyDown ||
        message == NativeMethods.WmSysKeyUp;

    private static bool IsPressed(Keys key) => (NativeMethods.GetAsyncKeyState((int)key) & 0x8000) != 0;
}
