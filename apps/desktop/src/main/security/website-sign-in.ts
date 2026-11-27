import type { NavigationGuard } from "@lockedscreen/shared-types";

const accountOrigins = new Set(["https://accounts.google.com", "https://accounts.youtube.com", "https://www.google.com"]);
const returnParameters = ["continue", "followup", "redirect_uri"];
const identityScopes = new Set(["openid", "email", "profile", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"]);

const secureUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
};

export const googleFormKey = (url: URL): string | undefined =>
  url.origin === "https://docs.google.com"
    ? /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9_-]+)\/(?:viewform|formResponse|viewscore|closedform)\/?$/.exec(url.pathname)?.[1]
    : undefined;

// Exact hosts, not a google.* wildcard. Google can relay the final session
// cookie via a regional account host (including Dominica).
const regionalAccounts = new Set(["accounts.google.dm", "accounts.google.ca", "accounts.google.fr", "accounts.google.co.uk"]);
const formsCookieBridge = (url: URL): boolean =>
  (url.hostname === "docs.google.com" && url.pathname === "/accounts/SetOSID") ||
  (regionalAccounts.has(url.hostname) && url.pathname === "/accounts/SetSID");

export const isWebsiteIdentityUrl = (url: URL): boolean => formsCookieBridge(url) || url.hostname === "accounts.google.com" ||
  (["accounts.youtube.com", "www.google.com"].includes(url.hostname) && /^\/accounts\/(?:SetSID|CheckCookie)$/.test(url.pathname));

const accountRoute = (url: URL): boolean => url.hostname === "accounts.google.com"
  ? /^\/(?:Login|ServiceLogin|ServiceLoginAuth|AccountChooser|InteractiveLogin|CheckCookie|RotateCookies|ListAccounts|Logout|signin(?:\/[^?#]*)?|v[23]\/signin(?:\/[^?#]*)?|_\/signin\/[^?#]+|o\/oauth2(?:\/[^?#]*)?)\/?$/.test(url.pathname)
  : formsCookieBridge(url) || /^\/accounts\/(?:SetSID|CheckCookie)$/.test(url.pathname);

// Only fixed labels may cross IPC. A blocked URL can contain sign-in tokens,
// an email address or a private Form identifier, even in its path.
export const blockedWebsiteStep = (value: string): string => {
  const url = secureUrl(value);
  if (!url) return "ROUTE-TRANSPORT";
  if (formsCookieBridge(url)) return "ROUTE-COOKIE-RETURN";
  if (url.hostname === "accounts.google.com") return accountRoute(url) ? "ROUTE-ACCOUNT-RETURN" : "ROUTE-ACCOUNT-PATH";
  if (url.hostname === "docs.google.com") return url.pathname.startsWith("/forms/") ? "ROUTE-FORM" : "ROUTE-DOCS-PATH";
  if (url.pathname === "/accounts/SetSID") return "ROUTE-REGIONAL-COOKIE";
  return "ROUTE-OTHER";
};

export const createWebsiteSignInPolicy = (guard: NavigationGuard) => {
  const start = secureUrl(guard.startUrl ?? "");
  let formKey = start ? googleFormKey(start) : undefined;
  const formsSession = Boolean(start && (formKey || start.hostname === "forms.gle" || start.hostname === "forms.google.com"));
  let signingIn = false;

  const examReturn = (value: string, depth = 0): boolean => {
    const url = secureUrl(value);
    if (!url || !start || guard.mode !== "link" || depth > 4) return false;
    if (isWebsiteIdentityUrl(url)) {
      if (formsCookieBridge(url) && (!formsSession || !formKey)) return false;
      if (formsCookieBridge(url) && !url.searchParams.has("continue")) return false;
      if (!accountRoute(url) || url.pathname.includes("/oauth2")) return false;
      const returns = returnParameters.flatMap(name => url.searchParams.getAll(name));
      return returns.length > 0 && returns.every(next => examReturn(next, depth + 1));
    }
    if (formsSession) {
      const key = googleFormKey(url);
      return Boolean(key && (!formKey || key === formKey));
    }
    // Website OAuth may return only to the configured assessment origin, never
    // to the publisher's OAuth callback or an arbitrary account/storage site.
    return !accountOrigins.has(url.origin) && url.origin === start.origin;
  };

  return {
    isSigningIn: () => signingIn,
    formNavigationAllowed(url: URL): boolean | undefined {
      if (!formsSession) return undefined;
      if (url.href === start?.href) return true;
      if (url.hostname === "docs.google.com" && url.pathname.startsWith("/forms/")) return Boolean(googleFormKey(url) && examReturn(url.href));
      if (url.hostname === "forms.gle" || url.hostname === "forms.google.com") return false;
      if (regionalAccounts.has(url.hostname)) return false;
      if (["google.com", "youtube.com", "googleusercontent.com", "gstatic.com", "googleapis.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return false;
      return undefined;
    },
    allows(url: URL): boolean {
      if (guard.mode !== "link" || !start || !secureUrl(url.href) || !isWebsiteIdentityUrl(url) || !accountRoute(url)) return false;
      const returns = returnParameters.flatMap(name => url.searchParams.getAll(name));
      if (formsCookieBridge(url) && (!formsSession || !formKey || !signingIn || !url.searchParams.has("continue"))) return false;
      if (returns.some(value => !examReturn(value))) return false;
      if (url.pathname.includes("/oauth2")) {
        const callbacks = url.searchParams.getAll("redirect_uri");
        const scopes = url.searchParams.getAll("scope");
        const scope = scopes[0] ?? "";
        if (formsSession || callbacks.length !== 1 || url.searchParams.getAll("response_type").join() !== "code" ||
          scopes.length !== 1 || !scope.trim() || scope.trim().split(/\s+/).some(value => !identityScopes.has(value))) return false;
      }
      if (!returns.length && !signingIn) return false;
      // Internal challenge pages can omit the return URL, but only after a
      // validated entry. Any explicit return remains checked at every step.
      signingIn = true;
      return true;
    },
    observe(value: string): "signing-in" | "exam" | "provider-rejected" | undefined {
      const url = secureUrl(value);
      if (!url) return undefined;
      const key = googleFormKey(url);
      if (formsSession && key && (!formKey || key === formKey)) formKey = key;
      if (isWebsiteIdentityUrl(url) && signingIn) {
        return /\/(?:rejected|denied)(?:\/|$)/.test(url.pathname) ? "provider-rejected" : "signing-in";
      }
      if (examReturn(value)) {
        signingIn = false;
        return "exam";
      }
      return undefined;
    }
  };
};
