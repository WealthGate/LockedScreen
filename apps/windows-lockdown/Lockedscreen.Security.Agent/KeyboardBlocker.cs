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
        if (nCode < 0 || (wParam != NativeMethods.WmKeyDown && wParam != NativeMethods.WmSysKeyDown))
        {
            return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        var data = Marshal.PtrToStructure<NativeMethods.KbdLlHookStruct>(lParam);
        var key = (Keys)data.VkCode;
        var altPressed = (NativeMethods.GetAsyncKeyState((int)Keys.Menu) & 0x8000) != 0;
        var ctrlPressed = (NativeMethods.GetAsyncKeyState((int)Keys.ControlKey) & 0x8000) != 0;

        var shouldBlock =
            key is Keys.LWin or Keys.RWin or Keys.Apps ||
            key is Keys.PrintScreen or Keys.Snapshot ||
            (altPressed && (key is Keys.Tab or Keys.Escape or Keys.F4 or Keys.Space)) ||
            (ctrlPressed && (key is Keys.Escape or Keys.LWin or Keys.RWin)) ||
            (ctrlPressed && altPressed && (key is Keys.Delete or Keys.Escape));

        if (shouldBlock)
        {
            AgentLog.WriteLine($"key-block vk={(int)key}");
            return (IntPtr)1;
        }

        return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }
}
