namespace Lockedscreen.Security.Agent;

internal sealed class LockdownAgentContext : ApplicationContext
{
    private readonly AgentPolicy _policy;
    private readonly EventWaitHandle _stopSignal;
    private readonly System.Threading.Timer _stopTimer;
    private readonly KeyboardBlocker? _keyboardBlocker;
    private readonly TaskbarController? _taskbarController;
    private readonly ProcessEnforcer? _processEnforcer;

    public LockdownAgentContext(AgentPolicy policy, EventWaitHandle stopSignal)
    {
        _policy = policy;
        _stopSignal = stopSignal;

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

        _stopTimer = new System.Threading.Timer(_ =>
        {
            if (_stopSignal.WaitOne(0))
            {
                ExitThread();
            }
        }, null, TimeSpan.Zero, TimeSpan.FromMilliseconds(250));
    }

    protected override void ExitThreadCore()
    {
        _stopTimer.Dispose();
        _processEnforcer?.Dispose();
        _taskbarController?.Dispose();
        _keyboardBlocker?.Dispose();
        base.ExitThreadCore();
    }
}
