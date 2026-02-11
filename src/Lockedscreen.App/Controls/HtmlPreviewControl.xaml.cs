using System.IO;
using System.Windows;
using System.Windows.Controls;

namespace Lockedscreen.App.Controls;

public partial class HtmlPreviewControl : UserControl
{
    public static readonly DependencyProperty HtmlProperty = DependencyProperty.Register(
        nameof(Html),
        typeof(string),
        typeof(HtmlPreviewControl),
        new PropertyMetadata(string.Empty, OnHtmlChanged));

    public HtmlPreviewControl()
    {
        InitializeComponent();
        Loaded += async (_, _) =>
        {
            await WebView.EnsureCoreWebView2Async();
            if (!string.IsNullOrWhiteSpace(Html))
            {
                WebView.NavigateToString(WrapHtml(Html));
            }
        };
    }

    public string Html
    {
        get => (string)GetValue(HtmlProperty);
        set => SetValue(HtmlProperty, value);
    }

    private static void OnHtmlChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is HtmlPreviewControl control && control.WebView.CoreWebView2 is not null)
        {
            control.WebView.NavigateToString(WrapHtml(e.NewValue as string ?? string.Empty));
        }
    }

    private static string WrapHtml(string body)
    {
        var localMathJax = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "MathJax", "tex-mml-chtml.js");
        var scriptSrc = File.Exists(localMathJax)
            ? new Uri(localMathJax).AbsoluteUri
            : "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";

        return $@"<!DOCTYPE html>
<html>
<head>
<meta charset='utf-8'>
<meta http-equiv='X-UA-Compatible' content='IE=edge'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<style>
body {{ font-family: 'Segoe UI', sans-serif; padding: 16px; color: #1C1F23; }}
</style>
<script>
window.MathJax = {{ tex: {{ inlineMath: [['$','$'], ['\\(','\\)']] }} }};
</script>
<script defer src='{scriptSrc}'></script>
</head>
<body>
{body}
</body>
</html>";
    }
}
