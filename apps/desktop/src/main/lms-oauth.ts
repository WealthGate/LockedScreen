import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { URL, URLSearchParams } from "node:url";

import { shell } from "electron";

import type {
  GoogleClassroomPublishResult,
  GoogleIntegrationSettings,
  LmsConnection,
  LmsCourse,
  LmsCourseWork,
  LmsProviderType,
  LmsStudent
} from "@lockedscreen/shared-types";

import {
  GoogleClassroomService,
  GoogleDesktopOAuthService,
  googleScopesToString,
  normalizeGoogleIntegrationSettings
} from "./integrations/google";
import type { OAuthVault } from "./oauth-vault";

interface OAuthConnectionSecrets {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
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

const providerAuthorizeUrl = (connection: LmsConnection): string => {
  if (connection.provider === "google-classroom") {
    return "https://accounts.google.com/o/oauth2/v2/auth";
  }

  if (connection.provider === "microsoft-365") {
    return `https://login.microsoftonline.com/${connection.tenantId?.trim() || "common"}/oauth2/v2.0/authorize`;
  }

  return connection.authorizeUrl?.trim() || "";
};

const providerTokenUrl = (connection: LmsConnection): string => {
  if (connection.provider === "google-classroom") {
    return "https://oauth2.googleapis.com/token";
  }

  if (connection.provider === "microsoft-365") {
    return `https://login.microsoftonline.com/${connection.tenantId?.trim() || "common"}/oauth2/v2.0/token`;
  }

  return connection.tokenUrl?.trim() || "";
};

const providerDefaultScope = (provider: LmsProviderType): string =>
  provider === "google-classroom"
    ? [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/classroom.courses.readonly",
        "https://www.googleapis.com/auth/classroom.coursework.students",
        "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
        "https://www.googleapis.com/auth/classroom.rosters.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets"
      ].join(" ")
    : provider === "microsoft-365"
      ? [
          "offline_access",
          "openid",
          "profile",
          "User.Read",
          "EduRoster.ReadBasic",
          "EduAssignments.ReadWriteBasic",
          "Files.ReadWrite"
        ].join(" ")
      : "openid profile email";

const providerAuthorizationParams = (
  connection: LmsConnection,
  redirectUri: string,
  state: string,
  codeChallenge: string
): URLSearchParams => {
  const params = new URLSearchParams({
    client_id: connection.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: connection.scope.trim() || providerDefaultScope(connection.provider),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  if (connection.provider === "google-classroom") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  return params;
};

const createAuthorizationListener = async (
  connection: LmsConnection,
  expectedState: string
): Promise<{ redirectUri: string; waitForCode: () => Promise<string> }> =>
  new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
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
        pendingReject?.(new Error(`${connection.label}: ${error}`));
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
  connection: LmsConnection,
  code: string,
  redirectUri: string,
  verifier: string
): Promise<OAuthConnectionSecrets> => {
  const body = new URLSearchParams({
    client_id: connection.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: connection.scope.trim() || providerDefaultScope(connection.provider)
  });
  if (connection.clientSecret?.trim()) {
    body.set("client_secret", connection.clientSecret.trim());
  }

  const response = await fetch(providerTokenUrl(connection), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(typeof payload.error_description === "string" ? payload.error_description : "Token exchange failed.");
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in ?? 0);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
  };
};

const refreshConnectionToken = async (
  connection: LmsConnection,
  refreshToken: string
): Promise<OAuthConnectionSecrets> => {
  const body = new URLSearchParams({
    client_id: connection.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  if (connection.clientSecret?.trim()) {
    body.set("client_secret", connection.clientSecret.trim());
  }

  const response = await fetch(providerTokenUrl(connection), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(typeof payload.error_description === "string" ? payload.error_description : "Token refresh failed.");
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : Number(payload.expires_in ?? 0);
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken,
    expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined
  };
};

const fetchGoogleProfile = async (accessToken: string): Promise<{ email?: string; name?: string }> => {
  const response = await fetch("https://classroom.googleapis.com/v1/userProfiles/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = (await response.json()) as Record<string, unknown>;
  const name = payload.name as Record<string, unknown> | undefined;
  return {
    email: typeof payload.emailAddress === "string" ? payload.emailAddress : undefined,
    name: typeof name?.fullName === "string" ? name.fullName : undefined
  };
};

const fetchMicrosoftProfile = async (accessToken: string): Promise<{ email?: string; name?: string }> => {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = (await response.json()) as Record<string, unknown>;
  return {
    email:
      typeof payload.userPrincipalName === "string"
        ? payload.userPrincipalName
        : typeof payload.mail === "string"
          ? payload.mail
          : undefined,
    name: typeof payload.displayName === "string" ? payload.displayName : undefined
  };
};

const fetchConnectionProfile = async (connection: LmsConnection, accessToken: string) => {
  if (connection.provider === "google-classroom") {
    return fetchGoogleProfile(accessToken);
  }

  if (connection.provider === "microsoft-365") {
    return fetchMicrosoftProfile(accessToken);
  }

  return {};
};

const googleSettingsFromConnection = (
  connection: LmsConnection,
  settings?: GoogleIntegrationSettings
): GoogleIntegrationSettings =>
  normalizeGoogleIntegrationSettings({
    ...(settings ?? {}),
    enabled: settings?.enabled ?? true,
    clientId: settings?.clientId?.trim() || connection.clientId,
    requestedScopes:
      settings?.requestedScopes && settings.requestedScopes.length > 0
        ? settings.requestedScopes
        : (connection.scope.trim() || providerDefaultScope("google-classroom")).split(/\s+/),
    connectionStatus: settings?.connectionStatus ?? connection.status,
    accountEmail: settings?.accountEmail ?? connection.accountEmail,
    accountName: settings?.accountName ?? connection.accountName,
    lastConnectedAt: settings?.lastConnectedAt ?? connection.lastConnectedAt,
    lastError: settings?.lastError ?? connection.lastError
  });

export const beginLmsOAuthConnection = async (
  connection: LmsConnection,
  vault: OAuthVault,
  googleSettings?: GoogleIntegrationSettings
): Promise<LmsConnection> => {
  if (connection.provider === "google-classroom") {
    const settings = googleSettingsFromConnection(connection, googleSettings);
    const oauth = new GoogleDesktopOAuthService(vault);
    const result = await oauth.beginTeacherSignIn(connection.id, settings);
    return {
      ...connection,
      label: result.profile.name || result.profile.email || connection.label,
      status: "connected",
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      accountEmail: result.profile.email,
      accountName: result.profile.name,
      lastConnectedAt: new Date().toISOString(),
      lastError: undefined,
      scope: googleScopesToString(settings),
      updatedAt: new Date().toISOString()
    };
  }

  if (!connection.clientId.trim()) {
    throw new Error(
      "This LMS needs a one-time school app connection setup before sign-in. Ask the school IT/admin to add the Google or Microsoft app connection, then teachers can sign in with their normal school account."
    );
  }

  const state = randomBytes(16).toString("hex");
  const pkce = createPkce();
  const authorization = await createAuthorizationListener(connection, state);
  const authUrl = providerAuthorizeUrl(connection);
  if (!authUrl) {
    throw new Error("Authorize URL is required for this LMS provider.");
  }

  const launchUrl = new URL(authUrl);
  const params = providerAuthorizationParams(connection, authorization.redirectUri, state, pkce.challenge);
  params.forEach((value, key) => launchUrl.searchParams.set(key, value));
  await shell.openExternal(launchUrl.toString());

  const code = await authorization.waitForCode();
  const tokens = await exchangeAuthorizationCode(connection, code, authorization.redirectUri, pkce.verifier);
  await vault.saveTokens(connection.id, tokens);
  const profile = await fetchConnectionProfile(connection, tokens.accessToken);

  return {
    ...connection,
    status: "connected",
    accountEmail: profile.email,
    accountName: profile.name,
    lastConnectedAt: new Date().toISOString(),
    lastError: undefined,
    scope: connection.scope.trim() || providerDefaultScope(connection.provider),
    updatedAt: new Date().toISOString()
  };
};

export const getConnectionAccessToken = async (
  connection: LmsConnection,
  vault: OAuthVault,
  googleSettings?: GoogleIntegrationSettings
): Promise<string> => {
  if (connection.provider === "google-classroom") {
    const oauth = new GoogleDesktopOAuthService(vault);
    return oauth.getAccessToken(connection.id, googleSettingsFromConnection(connection, googleSettings));
  }

  const secrets = await vault.getTokens(connection.id);
  if (!secrets?.accessToken) {
    throw new Error("This LMS connection is not authenticated.");
  }

  if (secrets.expiresAt && new Date(secrets.expiresAt).getTime() > Date.now() + 60_000) {
    return secrets.accessToken;
  }

  if (!secrets.refreshToken) {
    return secrets.accessToken;
  }

  const refreshed = await refreshConnectionToken(connection, secrets.refreshToken);
  await vault.saveTokens(connection.id, refreshed);
  return refreshed.accessToken;
};

export const signOutLmsConnection = async (
  connection: LmsConnection,
  vault: OAuthVault,
  options: { revoke?: boolean } = {}
): Promise<LmsConnection> => {
  if (connection.provider === "google-classroom") {
    const oauth = new GoogleDesktopOAuthService(vault);
    await oauth.signOut(connection.id, options);
  } else {
    await vault.deleteTokens(connection.id);
  }

  return {
    ...connection,
    status: "disconnected",
    accountEmail: "",
    accountName: "",
    lastConnectedAt: undefined,
    lastError: undefined,
    updatedAt: new Date().toISOString()
  };
};

export const listConnectionCourses = async (
  connection: LmsConnection,
  vault: OAuthVault,
  googleSettings?: GoogleIntegrationSettings
): Promise<LmsCourse[]> => {
  if (connection.provider === "google-classroom") {
    const oauth = new GoogleDesktopOAuthService(vault);
    const classroom = new GoogleClassroomService(oauth);
    return classroom.listCourses(connection.id, googleSettingsFromConnection(connection, googleSettings));
  }

  const accessToken = await getConnectionAccessToken(connection, vault);

  if (connection.provider === "microsoft-365") {
    const response = await fetch("https://graph.microsoft.com/v1.0/education/classes?$top=50", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = (await response.json()) as { value?: Array<Record<string, unknown>> };
    return (payload.value ?? []).map((course) => ({
      id: String(course.id ?? ""),
      name: String(course.displayName ?? "Untitled class"),
      section: typeof course.classCode === "string" ? course.classCode : undefined,
      alternateLink: typeof course.webUrl === "string" ? course.webUrl : undefined
    }));
  }

  return [];
};

export const listConnectionCourseWork = async (
  connection: LmsConnection,
  courseId: string,
  vault: OAuthVault,
  googleSettings?: GoogleIntegrationSettings
): Promise<LmsCourseWork[]> => {
  const normalizedCourseId = courseId.trim();
  if (!normalizedCourseId) {
    return [];
  }

  if (connection.provider === "google-classroom") {
    const oauth = new GoogleDesktopOAuthService(vault);
    const classroom = new GoogleClassroomService(oauth);
    return classroom.listCourseWork(connection.id, googleSettingsFromConnection(connection, googleSettings), normalizedCourseId);
  }

  const accessToken = await getConnectionAccessToken(connection, vault);

  if (connection.provider === "microsoft-365") {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/education/classes/${encodeURIComponent(normalizedCourseId)}/assignments?$top=50`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    const payload = (await response.json()) as { value?: Array<Record<string, unknown>> };
    return (payload.value ?? []).map((item) => ({
      id: String(item.id ?? ""),
      courseId: normalizedCourseId,
      title: String(item.displayName ?? "Untitled assignment"),
      alternateLink: typeof item.webUrl === "string" ? item.webUrl : undefined,
      dueAt: typeof item.dueDateTime === "string" ? item.dueDateTime : undefined,
      state: typeof item.status === "string" ? item.status : undefined
    }));
  }

  return [];
};

export const listConnectionStudents = async (
  connection: LmsConnection,
  courseId: string,
  vault: OAuthVault,
  googleSettings?: GoogleIntegrationSettings
): Promise<LmsStudent[]> => {
  const normalizedCourseId = courseId.trim();
  if (!normalizedCourseId) {
    return [];
  }

  if (connection.provider === "google-classroom") {
    const oauth = new GoogleDesktopOAuthService(vault);
    const classroom = new GoogleClassroomService(oauth);
    return classroom.listStudents(connection.id, googleSettingsFromConnection(connection, googleSettings), normalizedCourseId);
  }

  const accessToken = await getConnectionAccessToken(connection, vault);

  if (connection.provider === "microsoft-365") {
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/education/classes/${encodeURIComponent(normalizedCourseId)}/members?$top=100`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    const payload = (await response.json()) as { value?: Array<Record<string, unknown>> };
    return (payload.value ?? []).map((student) => ({
      id: String(student.id ?? ""),
      name: String(student.displayName ?? student.userPrincipalName ?? "Unnamed student"),
      email:
        typeof student.userPrincipalName === "string"
          ? student.userPrincipalName
          : typeof student.mail === "string"
            ? student.mail
            : undefined
    }));
  }

  return [];
};

export const publishConnectionCourseWork = async (
  connection: LmsConnection,
  request: {
    courseId: string;
    title: string;
    description: string;
    fileName: string;
    packageJson: string;
    maxPoints?: number;
  },
  vault: OAuthVault,
  googleSettings?: GoogleIntegrationSettings
): Promise<GoogleClassroomPublishResult> => {
  if (connection.provider !== "google-classroom") {
    throw new Error("Posting a Lockedscreen package is currently supported for Google Classroom connections.");
  }

  const oauth = new GoogleDesktopOAuthService(vault);
  const classroom = new GoogleClassroomService(oauth);
  return classroom.publishPackageCourseWork(connection.id, googleSettingsFromConnection(connection, googleSettings), request);
};
