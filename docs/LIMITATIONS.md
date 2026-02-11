# Limitations

## DOCX Import
- DOCX conversion uses the OpenXML SDK with a best-effort HTML renderer (no OpenXmlPowerTools).
- Complex layouts, tables, and images are not rendered in the MVP converter.
- OfficeMath equations are detected and flagged; rendering is best-effort.
- If conversion fails, the app falls back to plain text with warnings.

## Math Rendering
- HTML preview and question rendering rely on MathJax.
- The default build uses a CDN script for MathJax. For offline-only environments, bundle MathJax locally and update `HtmlPreviewControl` to reference local assets.

## Kiosk Variations
- Assigned Access for Win32 apps differs across Windows editions.
- Enterprise/Education editions have the most complete kiosk support.

## WebView2
- WebView2 runtime must be installed on the kiosk device.
