using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed class WebSetup : Form
{
    private readonly Button student = new Button();
    private readonly Button teacher = new Button();
    private readonly Button cancel = new Button();
    private readonly Label status = new Label();
    private readonly ProgressBar progress = new ProgressBar();
    private CancellationTokenSource download;

    [STAThread]
    private static void Main()
    {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new WebSetup());
    }

    private WebSetup()
    {
        Text = "LockedScreen Setup " + Payloads.Version;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        ClientSize = new Size(510, 247);
        AutoScaleMode = AutoScaleMode.Font;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 6 };
        foreach (int height in new[] { 32, 46, 46, 36, 16, 35 })
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        layout.Controls.Add(new Label { Text = "Choose what to install", Dock = DockStyle.Fill,
            Font = new Font(Font.FontFamily, 14, FontStyle.Bold), TextAlign = ContentAlignment.MiddleLeft });
        AddChoice(layout, student, "Student: take exams", Payloads.Student);
        AddChoice(layout, teacher, "Teacher / School: create and take exams", Payloads.Teacher);
        status.Text = "Only the selected download will be installed.";
        status.Dock = DockStyle.Fill;
        status.TextAlign = ContentAlignment.MiddleLeft;
        layout.Controls.Add(status);
        progress.Dock = DockStyle.Fill;
        layout.Controls.Add(progress);
        cancel.Text = "Cancel";
        cancel.Anchor = AnchorStyles.Right;
        cancel.Click += (sender, args) => { if (download == null) Close(); else download.Cancel(); };
        layout.Controls.Add(cancel);
        CancelButton = cancel;
        Controls.Add(layout);
        FormClosing += (sender, args) => { if (download != null) { args.Cancel = true; download.Cancel(); } };
    }

    private void AddChoice(TableLayoutPanel layout, Button button, string title, Payload payload)
    {
        button.Text = String.Format("{0} ({1:0.0} MiB)", title, payload.Bytes / 1048576.0);
        button.Dock = DockStyle.Fill;
        button.Click += async (sender, args) => await Install(payload);
        layout.Controls.Add(button);
    }

    private async Task Install(Payload payload)
    {
        if (download != null) return;
        var directory = Path.Combine(Path.GetTempPath(), "LockedScreen-" + Guid.NewGuid().ToString("N"));
        var installer = Path.Combine(directory, payload.FileName);
        download = new CancellationTokenSource(TimeSpan.FromMinutes(30));
        student.Enabled = teacher.Enabled = false;
        bool completed = false;
        try
        {
            Directory.CreateDirectory(directory);
            status.Text = "Downloading " + payload.Role + "...";
            progress.Value = 0;
            await Fetch(payload, installer, download.Token);
            status.Text = "Opening the " + payload.Role + " installer...";
            cancel.Enabled = false;
            using (var child = Process.Start(new ProcessStartInfo(installer) { UseShellExecute = true, WorkingDirectory = directory }))
            {
                if (child == null) throw new IOException("Windows did not start the installer.");
                await Task.Run(() => child.WaitForExit());
                if (child.ExitCode != 0) throw new IOException("Installation did not complete.");
            }
            completed = true;
        }
        catch (OperationCanceledException) { status.Text = "Download stopped. Choose an option to try again."; }
        catch (Exception error)
        {
            if (cancel.Enabled && download.IsCancellationRequested)
                status.Text = "Download stopped. Choose an option to try again.";
            else
            {
                status.Text = "Setup did not complete.";
                MessageBox.Show(this, error.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
        finally
        {
            try { Directory.Delete(directory, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            download.Dispose();
            download = null;
            student.Enabled = teacher.Enabled = cancel.Enabled = true;
            if (completed) Close(); else progress.Value = 0;
        }
    }

    private async Task Fetch(Payload payload, string destination, CancellationToken token)
    {
        using (var client = new HttpClient())
            await Fetch(client, payload, destination, percent => progress.Value = percent, token);
    }

    internal static async Task Fetch(HttpClient client, Payload payload, string destination, Action<int> reportProgress, CancellationToken token)
    {
        using (var response = await client.GetAsync(payload.Url, HttpCompletionOption.ResponseHeadersRead, token))
        using (token.Register(response.Dispose))
        {
            response.EnsureSuccessStatusCode();
            using (var input = await response.Content.ReadAsStreamAsync())
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true))
            using (var hash = SHA256.Create())
            {
                var buffer = new byte[65536];
                long bytes = 0;
                int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length, token)) != 0)
                {
                    bytes += count;
                    if (bytes > payload.Bytes) throw new IOException("The download is larger than expected.");
                    hash.TransformBlock(buffer, 0, count, buffer, 0);
                    await output.WriteAsync(buffer, 0, count, token);
                    reportProgress((int)(bytes * 100 / payload.Bytes));
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                var actual = BitConverter.ToString(hash.Hash).Replace("-", "");
                if (bytes != payload.Bytes || !String.Equals(actual, payload.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("The download could not be verified. Nothing was installed.");
                token.ThrowIfCancellationRequested();
            }
        }
    }

    internal sealed class Payload
    {
        public readonly string Role, FileName, Sha256;
        public readonly long Bytes;
        public string Url { get { return "https://github.com/WealthGate/LockedScreen/releases/download/v" + Payloads.Version + "/" + FileName; } }
        public Payload(string role, string fileName, long bytes, string sha256)
        {
            Role = role; FileName = fileName; Bytes = bytes; Sha256 = sha256;
        }
    }
}
