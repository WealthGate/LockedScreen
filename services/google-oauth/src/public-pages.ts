import { marked } from "marked";
import privacyMarkdown from "../../../PRIVACY.md";

const origin = "https://auth.whsdominica.com";
const styles = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; color: #202020; background: #fff; letter-spacing: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-size: 16px; line-height: 1.7; }
header, main, footer { max-width: 860px; margin: 0 auto; padding: 24px; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; border-bottom: 1px solid #ddd; }
header a:first-child { font-weight: 700; text-decoration: none; color: inherit; }
main { padding-top: 28px; padding-bottom: 40px; }
h1 { margin: 0 0 20px; font-size: 30px; line-height: 1.25; }
h2 { margin: 30px 0 10px; font-size: 21px; line-height: 1.4; }
p { margin: 12px 0; }
li { margin: 6px 0; }
ul { padding-left: 24px; }
a { color: #006b67; text-underline-offset: 3px; overflow-wrap: anywhere; }
code { font-family: ui-monospace, monospace; font-size: 14px; overflow-wrap: anywhere; }
footer { border-top: 1px solid #ddd; font-size: 14px; }
@media (max-width: 480px) { header, main, footer { padding-left: 18px; padding-right: 18px; } h1 { font-size: 26px; } }
@media (prefers-color-scheme: dark) { :root { color: #e7e7e7; background: #151515; } a { color: #79d9ca; } header, footer { border-color: #414141; } }
`;

const documentResponse = (title: string, path: string, content: string, head: boolean): Response => new Response(
  head ? null : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="canonical" href="${origin}${path}"><style>${styles}</style></head><body><header><a href="/">LockedScreen</a><a href="/privacy">Privacy policy</a></header><main>${content}</main><footer>Published by Wealth Gate. <a href="https://github.com/WealthGate/LockedScreen">Project and support</a></footer></body></html>`,
  { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  } }
);

// This is repository-owned policy text, never Markdown supplied by a request or user.
const privacyHtml = marked.parse(privacyMarkdown, { async: false });

export const publicPage = (path: string, method: string): Response | null => {
  if (!["/", "/privacy", "/privacy/"].includes(path)) return null;
  if (method !== "GET" && method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (path === "/privacy/") return new Response(null, { status: 308, headers: { Location: `${origin}/privacy` } });
  if (path === "/privacy") return documentResponse("LockedScreen Privacy Policy", path, privacyHtml, method === "HEAD");
  return documentResponse("LockedScreen", "/", `<h1>LockedScreen</h1><p>LockedScreen is a Windows examination app published by Wealth Gate. Teachers prepare and distribute exam packages, and students take supervised exams in the app.</p><h2>Optional Google connection</h2><p>Teachers can connect their own Google account to prepare Classroom assignments and deliver examination files. The publisher-managed connection service keeps the Web OAuth client secret on the server, rather than in the desktop app.</p><p>For configured student LMS delivery, Google sign-in completes in the system browser before exam lockdown starts. Results are saved locally before delivery. Submission can use the prepared authorization without opening a browser or releasing lockdown; the invigilator PIN is required for final exit.</p><p><a href="/privacy">Read the privacy policy</a> for details about Google data, local storage, hosted connection records, retention, and contact information.</p>`, method === "HEAD");
};
