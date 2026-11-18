using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

internal static class WebSetupTests
{
    private sealed class FakeDownload : HttpMessageHandler
    {
        internal Uri Requested;
        internal int RequestCount;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Requested = request.RequestUri;
            RequestCount++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {
                Content = new ByteArrayContent(new byte[] { 1, 2, 3 })
            });
        }
    }

    private static void Main()
    {
        string hash;
        using (var sha = SHA256.Create())
            hash = BitConverter.ToString(sha.ComputeHash(new byte[] { 1, 2, 3 })).Replace("-", "");
        foreach (var selected in new[] { Payloads.Student, Payloads.Teacher })
        {
            Check(selected, 3, hash, true);
            Check(selected, 3, new string('0', 64), false);
            Check(selected, 2, hash, false);
            Check(selected, 4, hash, false);
        }
        Console.WriteLine("Both role downloads verified; corrupted and wrong-size files rejected.");
    }

    private static void Check(WebSetup.Payload selected, long bytes, string hash, bool expected)
    {
        string destination = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        try
        {
            using (var handler = new FakeDownload())
            using (var client = new HttpClient(handler))
            {
                var payload = new WebSetup.Payload(selected.Role, selected.FileName, bytes, hash);
                bool verified = true;
                try { WebSetup.Fetch(client, payload, destination, _ => {}, CancellationToken.None).GetAwaiter().GetResult(); }
                catch (IOException) { verified = false; }
                if (verified != expected || handler.RequestCount != 1 || handler.Requested.AbsoluteUri != selected.Url)
                    throw new Exception("Download selection or verification failed: " + selected.Role);
            }
        }
        finally { File.Delete(destination); }
    }
}
