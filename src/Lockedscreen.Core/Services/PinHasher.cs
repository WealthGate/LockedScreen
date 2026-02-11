using System.Security.Cryptography;
using System.Text;

namespace Lockedscreen.Core.Services;

public static class PinHasher
{
    public static string HashPin(string pin, string salt)
    {
        var input = $"{pin}:{salt}";
        var bytes = Encoding.UTF8.GetBytes(input);
        var hash = SHA256.HashData(bytes);
        return Convert.ToHexString(hash);
    }

    public static bool VerifyPin(string pin, string salt, string expectedHash)
        => string.Equals(HashPin(pin, salt), expectedHash, StringComparison.OrdinalIgnoreCase);

    public static string GenerateSalt() => Guid.NewGuid().ToString("N");
}
