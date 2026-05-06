import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { URL, URLSearchParams } from "node:url";

import { shell } from "electron";

import type { GoogleIntegrationSettings } from "@lockedscreen/shared-types";

import { googleClassroomDesktopOAuth, googleScopesToString, normalizeGoogleIntegrationSettings, validateGoogleIntegrationSettings } from "./google-integration-settings";
import type { OAuthTokenBundle, SecureTokenStore } from "./secure-token-store";

export interface GoogleOAuthConnectionResult {
  tokens: OAuthTokenBundle;
  profile: {
    email?: string;
    name?: string;
  };
}

export interface GoogleOAuthFlow {
  beginTeacherSignIn(connectionId: string, settings: GoogleIntegrationSettings): Promise<GoogleOAuthConnectionResult>;
  getAccessToken(connectionId: string, settings: GoogleIntegrationSettings): Promise<string>;
  signOut(connectionId: string, options?: { revoke?: boolean }): Promise<void>;
}

const toBase64Url = (input: Buffer): string =>
  input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const createPkce = () => {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};

const friendlyGoogleOAuthError = (error: string, description?: string): Error => {
  const detail = [error, description].filter(Boolean).join(" ").toLowerCase();

  if (error === "invalid_client" || detail.includes("invalid_client")) {
    return new Error(
      "Google rejected the desktop app client ID. Ask an admin to check that the Google OAuth client is a Desktop app client and that the client ID was copied correctly."
    );
  }

  if (
    detail.includes("test user") ||
    detail.includes("testing") ||
    detail.includes("not completed") ||
    detail.includes("not verified")
  ) {
    return new Error(
      "This Google app is still in testing and your account is not allowed yet. Ask the Google Cloud project owner to add your school account as a test user, or publish/verify the app."
    );
  }

  if (error === "access_denied" || detail.includes("access_denied")) {
    return new Error("Google sign-in was cancelled or the requested Classroom permissions were not approved.");
  }

  if (error === "invalid_grant" || detail.includes("invalid_grant")) {
    return new Error("Google Classroom needs you to sign in again. Reconnect Google Classroom and approve the Classroom read-only permissions.");
  }

  if (detail.includes("admin_policy_enforced")) {
    return new Error("Your school Google administrator has blocked this app. Ask the administrator to allow the Lockedscreen Google Classroom app.");
  }

  return new Error(description || error || "Google sign-in failed.");
};

const tokenExchangeError = (payload: Record<string, unknown>): Error => {
  const error = typeof payload.error === "string" ? payload.error : "";
  const description = typeof payload.error_description === "string" ? payload.error_description : undefined;
  const detail = [error, description].filter(Boolean).join(" ").toLowerCase();
  if (detail.includes("invalid_scope") || detail.includes("bad request")) {
    return new Error(
      "Google Classroom needs you to reconnect so Lockedscreen can receive the latest Classroom and Drive permissions."
    );
  }
  return friendlyGoogleOAuthError(error, description);
};

const createAuthorizationListener = async (
  expectedState: string
): Promise<{ redirectUri: string; waitForCode: () => Promise<string> }> =>
  new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description") ?? undefined;
      const state = requestUrl.searchParams.get("state");

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(
        error
          ? "<html><body><h2>Login failed</h2><p>You can close this window and return to Lockedscreen.</p></body></html>"
          : "<html><body><h2>Login complete</h2><p>You can close this window and return to Lockedscreen.</p></body></html>"
      );

      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }

      server.close();

      if (error) {
        pendingReject?.(friendlyGoogleOAuthError(error, errorDescription));
        return;
      }

      if (state !== expectedState) {
        pendingReject?.(new Error("OAuth callback state validation failed."));
        return;
      }

      if (!code) {
        pendingReject?.(new Error("OAuth callback did not include an authorization code."));
        return;
      }

      pendingResolve?.(code);
    });

    let pendingResolve: ((code: string) => void) | null = null;
    let pendingReject: ((error: Error) => void) | null = null;
    let timeout: NodeJS.Timeout | null = null;

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to start local OAuth callback server."));
        return;
      }

      const redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const waitForCode = () =>
        new Promise<string>((resolveCode, rejectCode) => {
          pendingResolve = resolveCode;
          pendingReject = rejectCode;
          timeout = setTimeout(() => {
            server.close();
            rejectCode(new Error("OAuth login timed out."));
          }, 180000);
        });

      resolve({ redirectUri, waitForCode });
    });
  });

const exchangeAuthorizationCode = async (
  settings: GoogleIntegrationSettings,
  code: string,
  redirectUri: string,
  verifier: string
): Promise<OAuthTokenBundle> => {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: googleScopesToString(settings)
  });
  if (settings.clientSecret?.trim()) {
    body.set("client_secret", settings.clientSecret.trim());
  }

  const response = await fetch(googleClassroomDesktopOAuth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw tokenExchangeError(payload);
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in ?? 0);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
  };
};

const refreshToken = async (
  settings: GoogleIntegrationSettings,
  refreshTokenValue: string
): Promise<OAuthTokenBundle> => {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue
  });
  if (settings.clientSecret?.trim()) {
    body.set("client_secret", settings.clientSecret.trim());
  }

  const response = await fetch(googleClassroomDesktopOAuth.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw tokenExchangeError(payload);
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in ?? 0);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : refreshTokenValue,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
  };
};

const fetchGoogleProfile = async (accessToken: string): Promise<{ email?: string; name?: string }> => {
  const response = await fetch(`${googleClassroomDesktopOAuth.classroomApiBaseUrl}/userProfiles/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const name = payload.name as Record<string, unknown> | undefined;
  return {
    email: typeof payload.emailAddress === "string" ? payload.emailAddress : undefined,
    name: typeof name?.fullName === "string" ? name.fullName : undefined
  };
};

const revokeGoogleToken = async (token: string): Promise<void> => {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ token })
  });

  if (!response.ok) {
    const payload = (await response.text()).trim();
    throw new Error(payload || "Google token revoke failed.");
  }
};

export class GoogleDesktopOAuthService implements GoogleOAuthFlow {
  constructor(private readonly tokenStore: SecureTokenStore) {}

  async beginTeacherSignIn(
    connectionId: string,
    settings: GoogleIntegrationSettings
  ): Promise<GoogleOAuthConnectionResult> {
    const normalized = normalizeGoogleIntegrationSettings(settings);
    validateGoogleIntegrationSettings(normalized);

    const state = randomBytes(16).toString("hex");
    const pkce = createPkce();
    const authorization = await createAuthorizationListener(state);
    const launchUrl = new URL(googleClassroomDesktopOAuth.authorizeUrl);
    const params = new URLSearchParams({
      client_id: normalized.clientId,
      response_type: "code",
      redirect_uri: authorization.redirectUri,
      scope: googleScopesToString(normalized),
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent"
    });

    params.forEach((value, key) => launchUrl.searchParams.set(key, value));
    await shell.openExternal(launchUrl.toString());

    const code = await authorization.waitForCode();
    const tokens = await exchangeAuthorizationCode(normalized, code, authorization.redirectUri, pkce.verifier);
    await this.tokenStore.saveTokens(connectionId, tokens);
    const profile = await fetchGoogleProfile(tokens.accessToken);

    return { tokens, profile };
  }

  async getAccessToken(connectionId: string, settings: GoogleIntegrationSettings): Promise<string> {
    const normalized = normalizeGoogleIntegrationSettings(settings);
    validateGoogleIntegrationSettings(normalized);
    const tokens = await this.tokenStore.getTokens(connectionId);
    if (!tokens?.accessToken) {
      throw new Error("Google Classroom is not connected.");
    }

    if (tokens.expiresAt && new Date(tokens.expiresAt).getTime() > Date.now() + 60_000) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken) {
      return tokens.accessToken;
    }

    const refreshed = await refreshToken(normalized, tokens.refreshToken);
    await this.tokenStore.saveTokens(connectionId, refreshed);
    return refreshed.accessToken;
  }

  /**
   * Clears local per-teacher tokens. When revoke is true, Google is asked to
   * invalidate the refresh token before the local encrypted vault entry is
   * removed. Local deletion still runs if Google's revoke endpoint fails.
   */
  async signOut(connectionId: string, options: { revoke?: boolean } = {}): Promise<void> {
    const tokens = await this.tokenStore.getTokens(connectionId);
    let revokeError: Error | null = null;

    if (options.revoke && (tokens?.refreshToken || tokens?.accessToken)) {
      try {
        await revokeGoogleToken(tokens.refreshToken ?? tokens.accessToken);
      } catch (error) {
        revokeError = error instanceof Error ? error : new Error("Google token revoke failed.");
      }
    }

    await this.tokenStore.deleteTokens(connectionId);

    if (revokeError) {
      throw revokeError;
    }
  }
}
