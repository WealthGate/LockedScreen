using System.Runtime.InteropServices;

namespace Lockedscreen.Security.Agent;

internal sealed class KeyboardBlocker : IDisposable
{
    private readonly NativeMethods.LowLevelKeyboardProc _callback;
    private readonly KeyboardPolicy _policy = new();
    private readonly ManualResetEventSlim _ready = new(false);
    private Thread? _thread;
    private uint _threadId;
    private Exception? _failure;
    private bool _disposed;
    public bool Ready => _ready.IsSet && _failure is null && _thread?.IsAlive == true;

    public KeyboardBlocker()
    {
        _callback = HookCallback;
    }

    public void Start()
    {
        _thread = new Thread(Run) { IsBackground = true, Name = "LockedScreen keyboard filter" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        if (!_ready.Wait(TimeSpan.FromSeconds(5))) throw new InvalidOperationException("Keyboard filter startup timed out.");
        if (_failure is not null) throw new InvalidOperationException("Unable to install the keyboard filter.", _failure);
    }

    private void Run()
    {
        IntPtr hook = IntPtr.Zero;
        try
        {
            _threadId = NativeMethods.GetCurrentThreadId();
            // Create the message queue before publishing readiness or posting WM_QUIT.
            NativeMethods.PeekMessage(out _, IntPtr.Zero, 0, 0, 0);
            foreach (var key in new[] { 0x5B, 0x5C, 0xA2, 0xA3, 0xA4, 0xA5 })
                _policy.Seed(key, (NativeMethods.GetAsyncKeyState(key) & 0x8000) != 0);
            hook = NativeMethods.SetWindowsHookEx(NativeMethods.WhKeyboardLl, _callback, NativeMethods.GetModuleHandle(null), 0);
            if (hook == IntPtr.Zero) throw new InvalidOperationException($"SetWindowsHookEx failed ({Marshal.GetLastWin32Error()}).");
            _ready.Set();
            while (NativeMethods.GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                NativeMethods.TranslateMessage(ref message);
                NativeMethods.DispatchMessage(ref message);
            }
        }
        catch (Exception error) { _failure = error; }
        finally
        {
            if (hook != IntPtr.Zero) NativeMethods.UnhookWindowsHookEx(hook);
            _ready.Set();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_thread?.IsAlive == true)
        {
            NativeMethods.PostThreadMessage(_threadId, 0x0012, IntPtr.Zero, IntPtr.Zero);
            _thread.Join(TimeSpan.FromSeconds(3));
        }
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0 || !IsKeyboardMessage(wParam))
        {
            return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        var data = Marshal.PtrToStructure<NativeMethods.KbdLlHookStruct>(lParam);
        var down = wParam == NativeMethods.WmKeyDown || wParam == NativeMethods.WmSysKeyDown;
        if (_policy.Process((int)data.VkCode, down, (data.Flags & 0x20) != 0)) return (IntPtr)1;
        // No disk I/O, process inspection or asynchronous-state queries in this callback.
        return NativeMethods.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static bool IsKeyboardMessage(IntPtr message) =>
        message == NativeMethods.WmKeyDown ||
        message == NativeMethods.WmKeyUp ||
        message == NativeMethods.WmSysKeyDown ||
        message == NativeMethods.WmSysKeyUp;

}
