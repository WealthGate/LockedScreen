using Lockedscreen.Security.Agent;

var checks = 0;
void Check(bool value, string message)
{
    checks++;
    if (!value) throw new Exception(message);
}

// Pure event simulation. These tests never install hooks or change this PC's input behavior.
foreach (var combo in new[] {
    new[] { 0xA4, 0x09 }, new[] { 0xA5, 0x09 }, new[] { 0xA4, 0x1B },
    new[] { 0xA4, 0x73 }, new[] { 0xA4, 0x20 }, new[] { 0xA4, 0x25 },
    new[] { 0xA2, 0x1B }, new[] { 0xA3, 0x09 }, new[] { 0xA2, 0x10, 0x1B },
    new[] { 0x5B, 0x09 }, new[] { 0x5B, 0x44 }, new[] { 0x5C, 0x4C },
    new[] { 0xA2, 0x52 }, new[] { 0xA2, 0x4C }, new[] { 0xA2, 0x57 }
})
{
    var policy = new KeyboardPolicy();
    foreach (var key in combo[..^1]) policy.Process(key, true);
    var target = combo[^1];
    Check(policy.Process(target, true), $"Shortcut escaped: {string.Join(',', combo)}");
    Check(policy.Process(target, true), "Auto-repeat escaped");
    foreach (var key in combo[..^1]) policy.Process(key, false);
    Check(policy.Process(target, false), "Blocked key-up escaped after releasing modifier");
    Check(!policy.Process(0x41, true), "Normal typing blocked after modifier release");
}
foreach (var key in new[] { 0x5B, 0x5C, 0x5D, 0x5F, 0x2C, 0x7A, 0x7B, 0xA6, 0xAC, 0xB4, 0xB7 })
{
    var policy = new KeyboardPolicy();
    Check(policy.Process(key, true), $"Dedicated system key escaped: {key}");
    Check(policy.Process(key, false), "Dedicated system key-up escaped");
}
foreach (var key in new[] { 0x41, 0x30, 0x08, 0x0D, 0x09, 0x20, 0x25, 0x28 })
{
    var policy = new KeyboardPolicy();
    Check(!policy.Process(key, true), $"Ordinary exam input blocked: {key}");
    Check(!policy.Process(key, false), "Ordinary key-up blocked");
}
var seeded = new KeyboardPolicy();
foreach (var key in new[] { 0x5B, 0x5C })
{
    var policy = new KeyboardPolicy();
    var refused = false;
    try { policy.Seed(key, true); }
    catch (InvalidOperationException) { refused = true; }
    Check(refused, "Windows key held before hook startup must refuse startup");
    policy.Seed(key, false);
    Check(!policy.Process(0x41, true), "Released Windows key blocked normal typing");
}
seeded.Seed(0xA4, true);
Check(seeded.Process(0x09, true), "Modifier held before hook startup escaped");
Check(new KeyboardPolicy().Process(0x09, true, altFlag: true), "System Alt flag ignored");
foreach (var modifier in new[] { new[] { 0x11, 0xA2, 0x52 }, new[] { 0x12, 0xA5, 0x09 } })
{
    var policy = new KeyboardPolicy();
    policy.Seed(modifier[0], true);
    policy.Seed(modifier[1], true);
    Check(policy.Process(modifier[2], true), "Seeded modifier shortcut escaped");
    policy.Process(modifier[2], false);
    policy.Process(modifier[1], false);
    Check(!policy.Process(modifier[2], true), "Generic modifier alias stayed pressed after release");
}
Console.WriteLine($"PASS: {checks} keyboard policy assertions. No native hooks activated.");
