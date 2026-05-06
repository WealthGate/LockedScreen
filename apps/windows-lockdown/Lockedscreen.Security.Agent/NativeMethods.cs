using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;

namespace Lockedscreen.Security.Agent;

[SuppressMessage("Interoperability", "CA1401:P/Invokes should not be visible", Justification = "Internal native bindings.")]
internal static class NativeMethods
{
    public const int WhKeyboardLl = 13;
    public const int WmKeyDown = 0x0100;
    public const int WmKeyUp = 0x0101;
    public const int WmSysKeyDown = 0x0104;
    public const int WmSysKeyUp = 0x0105;
    public const int SwHide = 0;
    public const int SwShow = 5;
    public const int SwMinimize = 6;
    public const uint DesktopCreateWindow = 0x0002;
    public const uint DesktopEnumerate = 0x0040;
    public const uint DesktopWriteObjects = 0x0080;
    public const uint DesktopSwitchDesktop = 0x0100;
    public const uint DesktopAllAccess = 0x01FF;
    public const uint NormalPriorityClass = 0x00000020;
    public const uint CreateNewProcessGroup = 0x00000200;

    [StructLayout(LayoutKind.Sequential)]
    public struct KbdLlHookStruct
    {
        public uint VkCode;
        public uint ScanCode;
        public uint Flags;
        public uint Time;
        public nuint DwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct StartupInfo
    {
        public uint Cb;
        public string? LpReserved;
        public string? LpDesktop;
        public string? LpTitle;
        public uint DwX;
        public uint DwY;
        public uint DwXSize;
        public uint DwYSize;
        public uint DwXCountChars;
        public uint DwYCountChars;
        public uint DwFillAttribute;
        public uint DwFlags;
        public ushort WShowWindow;
        public ushort CbReserved2;
        public IntPtr LpReserved2;
        public IntPtr HStdInput;
        public IntPtr HStdOutput;
        public IntPtr HStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation
    {
        public IntPtr HProcess;
        public IntPtr HThread;
        public uint DwProcessId;
        public uint DwThreadId;
    }

    public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string? className, string? windowTitle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateDesktop(
        string lpszDesktop,
        string? lpszDevice,
        IntPtr pDevmode,
        uint dwFlags,
        uint dwDesiredAccess,
        IntPtr lpsa);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SwitchDesktop(IntPtr hDesktop);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CreateProcess(
        string? lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref StartupInfo lpStartupInfo,
        out ProcessInformation lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);
}
