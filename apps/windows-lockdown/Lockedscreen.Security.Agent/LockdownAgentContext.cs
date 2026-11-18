namespace Lockedscreen.Security.Agent;

internal sealed class LockdownAgentContext : ApplicationContext
{
    private readonly AgentPolicy _policy;
    private readonly EventWaitHandle _stopSignal;
    private readonly System.Windows.Forms.Timer _stopTimer;
    private readonly KeyboardBlocker? _keyboardBlocker;
    private readonly TaskbarController? _taskbarController;
    private readonly ProcessEnforcer? _processEnforcer;
    private bool _resourcesDisposed;
    public bool KeyboardBlockingReady => _keyboardBlocker?.Ready == true;

    public LockdownAgentContext(AgentPolicy policy, EventWaitHandle stopSignal)
    {
        _policy = policy;
        _stopSignal = stopSignal;
        _stopTimer = new System.Windows.Forms.Timer { Interval = 250 };

        try
        {
            if (_policy.BlockSystemKeys)
            {
                _keyboardBlocker = new KeyboardBlocker();
                _keyboardBlocker.Start();
            }

            if (_policy.HideTaskbar)
            {
                _taskbarController = new TaskbarController();
                _taskbarController.Hide();
            }

            if (_policy.EnforceProcesses)
            {
                _processEnforcer = new ProcessEnforcer(_policy);
                _processEnforcer.Start();
            }

            var lastHeartbeat = DateTimeOffset.MinValue;
            _stopTimer.Tick += (_, _) =>
            {
                if (_stopSignal.WaitOne(0))
                {
                    ExitThread();
                    return;
                }
                if (DateTimeOffset.UtcNow - lastHeartbeat > TimeSpan.FromSeconds(1))
                {
                    try { AgentState.Write(_policy, KeyboardBlockingReady); }
                    catch { /* A stale heartbeat fails the desktop health check closed. */ }
                    lastHeartbeat = DateTimeOffset.UtcNow;
                }
            };
            _stopTimer.Start();
        }
        catch
        {
            ReleaseResources();
            throw;
        }
    }

    protected override void ExitThreadCore()
    {
        ReleaseResources();
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) ReleaseResources();
        base.Dispose(disposing);
    }

    private void ReleaseResources()
    {
        if (_resourcesDisposed) return;
        _resourcesDisposed = true;
        _stopTimer.Dispose();
        _processEnforcer?.Dispose();
        _taskbarController?.Dispose();
        _keyboardBlocker?.Dispose();
    }
}
