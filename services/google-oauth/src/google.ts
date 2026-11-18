import * as oauth from "oauth4webapi";

export type Role = "teacher" | "student";
export interface GoogleConfig { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_REDIRECT_URI: string }
export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  profile?: { email: string; name?: string };
}
export interface AuthorizationData { verifier: string; nonce: string; examSession?: boolean }
export interface GoogleProvider {
  authorize(config: GoogleConfig, role: Role, state: string, auth: AuthorizationData): Promise<string>;
  exchange(config: GoogleConfig, callback: URL, state: string, auth: AuthorizationData, role: Role): Promise<GoogleTokens>;
  refresh(config: GoogleConfig, token: string): Promise<GoogleTokens>;
  revoke(token: string): Promise<void>;
}

const server: oauth.AuthorizationServer = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs"
};
export const scopesFor = (role: Role): string[] => [
  "openid", "email", "profile", "https://www.googleapis.com/auth/drive.file",
  ...(role === "teacher" ? [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/spreadsheets"
  ] : ["https://www.googleapis.com/auth/classroom.coursework.me"])
];
const expiresAt = (seconds: unknown): string => new Date(Date.now() + Math.min(Math.max(Number(seconds) || 300, 1), 3600) * 1000).toISOString();

export const googleProvider: GoogleProvider = {
  async authorize(config, role, state, auth) {
    const url = new URL(server.authorization_endpoint!);
    url.search = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID, redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: "code", scope: scopesFor(role).join(" "), state, nonce: auth.nonce,
      code_challenge: await oauth.calculatePKCECodeChallenge(auth.verifier), code_challenge_method: "S256",
      access_type: role === "teacher" || auth.examSession ? "offline" : "online",
      prompt: role === "teacher" || auth.examSession ? "consent select_account" : "select_account"
    }).toString();
    return url.href;
  },
  async exchange(config, callback, state, auth, role) {
    const client: oauth.Client = { client_id: config.GOOGLE_CLIENT_ID };
    const params = oauth.validateAuthResponse(server, client, callback, state);
    const response = await oauth.authorizationCodeGrantRequest(server, client,
      oauth.ClientSecretPost(config.GOOGLE_CLIENT_SECRET), params, config.GOOGLE_REDIRECT_URI, auth.verifier);
    const tokens = await oauth.processAuthorizationCodeResponse(server, client, response, {
      expectedNonce: auth.nonce, requireIdToken: true
    });
    // Verify the Google JWT signature as well as the library's issuer, audience, nonce and expiry checks.
    await oauth.validateApplicationLevelSignature(server, response);
    const claims = oauth.getValidatedIdTokenClaims(tokens)!;
    if (claims.email_verified !== true || typeof claims.email !== "string") throw new Error("Unverified Google account.");
    const granted = new Set((tokens.scope ?? "").split(" "));
    if (tokens.scope && scopesFor(role).some((scope) => !["openid", "email", "profile"].includes(scope) && !granted.has(scope))) {
      throw new Error("Required Google permissions were not granted.");
    }
    return {
      accessToken: tokens.access_token, refreshToken: role === "teacher" || auth.examSession ? tokens.refresh_token : undefined,
      expiresAt: expiresAt(tokens.expires_in),
      profile: { email: claims.email, name: typeof claims.name === "string" ? claims.name : undefined }
    };
  },
  async refresh(config, token) {
    const client: oauth.Client = { client_id: config.GOOGLE_CLIENT_ID };
    const response = await oauth.refreshTokenGrantRequest(server, client, oauth.ClientSecretPost(config.GOOGLE_CLIENT_SECRET), token);
    const tokens = await oauth.processRefreshTokenResponse(server, client, response);
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? token, expiresAt: expiresAt(tokens.expires_in) };
  },
  async revoke(token) {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok && response.status !== 400) throw new Error("Google revocation failed.");
  }
};
