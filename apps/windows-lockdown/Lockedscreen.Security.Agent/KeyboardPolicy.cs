namespace Lockedscreen.Security.Agent;

// Track events: asynchronous key state is stale inside a low-level hook callback.
internal sealed class KeyboardPolicy
{
    private readonly bool[] _pressed = new bool[256];
    private readonly bool[] _blocked = new bool[256];

    public void Seed(int key, bool pressed)
    {
        // Generic modifier aliases do not receive matching left/right key-up events.
        if (key is 0x10 or 0x11 or 0x12) return;
        // Its earlier key-down has already reached Windows; do not carry it into an exam.
        if (pressed && key is 0x5B or 0x5C)
            throw new InvalidOperationException("Release the Windows key before starting the exam, then try again.");
        if (key >= 0 && key < _pressed.Length) _pressed[key] = pressed;
    }

    public bool Process(int key, bool down, bool altFlag = false)
    {
        if (key < 0 || key >= _pressed.Length) return false;
        if (!down)
        {
            _pressed[key] = false;
            var blocked = _blocked[key];
            _blocked[key] = false;
            return blocked;
        }
        _pressed[key] = true;
        var alt = altFlag || _pressed[0x12] || _pressed[0xA4] || _pressed[0xA5];
        var ctrl = _pressed[0x11] || _pressed[0xA2] || _pressed[0xA3];
        var win = _pressed[0x5B] || _pressed[0x5C];
        // Reserved secure-attention sequences still require managed Windows Keyboard Filter.
        var block = win || key is 0x5B or 0x5C or 0x5D or 0x5F or 0x2C or 0x7A or 0x7B ||
            (key >= 0xA6 && key <= 0xAC) || (key >= 0xB4 && key <= 0xB7) ||
            (alt && key is 0x09 or 0x1B or 0x73 or 0x20 or 0x25 or 0x27) ||
            (ctrl && key is 0x1B or 0x09 or 0x4C or 0x4E or 0x4F or 0x50 or 0x51 or 0x52 or 0x53 or 0x54 or 0x57) ||
            (ctrl && alt && key is 0x2E or 0x1B);
        _blocked[key] |= block;
        return _blocked[key];
    }
}
