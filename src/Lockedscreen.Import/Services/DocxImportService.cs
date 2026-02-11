using System.Text;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Lockedscreen.Import.Models;

namespace Lockedscreen.Import.Services;

public sealed class DocxImportService
{
    public ImportResult Load(string path)
    {
        var warnings = new List<string>();
        try
        {
            using var doc = WordprocessingDocument.Open(path, false);
            var mainPart = doc.MainDocumentPart;
            var body = mainPart?.Document?.Body;
            if (body is null)
            {
                return new ImportResult
                {
                    Html = "<p>(empty)</p>",
                    Warnings = new List<string> { "DOCX contained no body content." }
                };
            }

            var html = ConvertBodyToHtml(body, mainPart, warnings);
            return new ImportResult
            {
                Html = html,
                Warnings = warnings
            };
        }
        catch (Exception ex)
        {
            warnings.Add($"DOCX conversion failed: {ex.Message}");
            var fallback = LoadAsPlainText(path);
            fallback.Warnings.AddRange(warnings);
            return fallback;
        }
    }

    private static string ConvertBodyToHtml(Body body, MainDocumentPart? mainPart, List<string> warnings)
    {
        var sb = new StringBuilder();
        foreach (var element in body.Elements())
        {
            if (element is Paragraph paragraph)
            {
                sb.Append("<p>");
                sb.Append(RenderParagraph(paragraph, mainPart, warnings));
                sb.Append("</p>");
            }
            else if (element is Table table)
            {
                sb.Append(RenderTable(table, mainPart, warnings));
            }
        }

        var html = sb.ToString();
        return string.IsNullOrWhiteSpace(html) ? "<p>(empty)</p>" : html;
    }

    private static string RenderTable(Table table, MainDocumentPart? mainPart, List<string> warnings)
    {
        warnings.Add("Table detected. Rendered with basic HTML table layout.");
        var sb = new StringBuilder();
        sb.Append("<table border='1' cellspacing='0' cellpadding='6'>");

        foreach (var row in table.Elements<TableRow>())
        {
            sb.Append("<tr>");
            foreach (var cell in row.Elements<TableCell>())
            {
                sb.Append("<td>");
                foreach (var paragraph in cell.Elements<Paragraph>())
                {
                    sb.Append("<p>");
                    sb.Append(RenderParagraph(paragraph, mainPart, warnings));
                    sb.Append("</p>");
                }
                sb.Append("</td>");
            }
            sb.Append("</tr>");
        }

        sb.Append("</table>");
        return sb.ToString();
    }

    private static string RenderParagraph(Paragraph paragraph, MainDocumentPart? mainPart, List<string> warnings)
    {
        var sb = new StringBuilder();
        foreach (var child in paragraph.Elements())
        {
            switch (child)
            {
                case Run run:
                    sb.Append(RenderRun(run, warnings));
                    break;
                case Hyperlink hyperlink:
                    sb.Append(RenderHyperlink(hyperlink, mainPart));
                    break;
                case DocumentFormat.OpenXml.Math.OfficeMath:
                    warnings.Add("OfficeMath detected. Math rendering is best-effort.");
                    sb.Append("<span class='math'>[Equation]</span>");
                    break;
            }
        }

        return sb.ToString();
    }

    private static string RenderHyperlink(Hyperlink hyperlink, MainDocumentPart? mainPart)
    {
        var text = string.Concat(hyperlink.Descendants<Text>().Select(t => t.Text));
        var href = "#";
        if (mainPart is not null && hyperlink.Id is not null)
        {
            var rel = mainPart.HyperlinkRelationships.FirstOrDefault(r => r.Id == hyperlink.Id);
            if (rel is not null)
            {
                href = rel.Uri.ToString();
            }
        }

        return $"<a href='{EscapeHtml(href)}'>{EscapeHtml(text)}</a>";
    }

    private static string RenderRun(Run run, List<string> warnings)
    {
        if (run.Descendants<Drawing>().Any())
        {
            warnings.Add("Image detected. Images are not rendered in the MVP converter.");
            return "<span class='image'>[Image]</span>";
        }

        var text = string.Concat(run.Descendants<Text>().Select(t => t.Text));
        if (run.Descendants<Break>().Any())
        {
            text += "<br/>";
        }

        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var escaped = EscapeHtml(text);
        var props = run.RunProperties;
        if (props?.Bold is not null)
        {
            escaped = $"<strong>{escaped}</strong>";
        }
        if (props?.Italic is not null)
        {
            escaped = $"<em>{escaped}</em>";
        }
        if (props?.Underline is not null)
        {
            escaped = $"<u>{escaped}</u>";
        }

        var vertical = props?.VerticalTextAlignment?.Val?.Value;
        if (vertical == VerticalPositionValues.Superscript)
        {
            escaped = $"<sup>{escaped}</sup>";
        }
        if (vertical == VerticalPositionValues.Subscript)
        {
            escaped = $"<sub>{escaped}</sub>";
        }

        return escaped;
    }

    private static string EscapeHtml(string input)
        => System.Net.WebUtility.HtmlEncode(input ?? string.Empty);

    private static ImportResult LoadAsPlainText(string path)
    {
        using var doc = WordprocessingDocument.Open(path, false);
        var text = doc.MainDocumentPart?.Document?.Body?.InnerText ?? string.Empty;
        var lines = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        var html = string.Join("", lines.Select(line => $"<p>{EscapeHtml(line)}</p>"));
        return new ImportResult
        {
            Html = string.IsNullOrWhiteSpace(html) ? "<p>(empty)</p>" : html,
            Warnings = new List<string> { "DOCX formatting could not be preserved. Displaying plain text." }
        };
    }
}
