import { hash, randomToken, seal, unseal } from "./crypto";
import { googleProvider, type AuthorizationData, type GoogleConfig, type GoogleProvider, type GoogleTokens, type Role } from "./google";
import { publicPage } from "./public-pages";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface Database { prepare(sql: string): Statement }
export interface Env extends GoogleConfig { DB: Database; TOKEN_ENCRYPTION_KEY: string }
interface Flow {
  id: string; challenge: string; role: Role; status: string; browser_hash: string | null;
  encrypted_payload: string; expires_at: number;
}
interface FlowPayload { auth?: AuthorizationData; result?: unknown; error?: string }
interface Session { encrypted_payload: string; expires_at: number }
const FLOW_TTL = 10 * 60_000;
const SESSION_TTL = 30 * 24 * 60 * 60_000;
const COOKIE = "__Host-lockedscreen-oauth";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CALLBACK = "https://auth.whsdominica.com/oauth/google/callback";
const ORIGIN = new URL(CALLBACK).origin;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function fail(status: number, code: string, message: string): never { throw new HttpError(status, code, message); }
const headers = {
  "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff", "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};
const json = (value: unknown, status = 200): Response => Response.json(value, { status, headers });
const page = (message: string, status = 200): Response => new Response(
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LockedScreen Google connection</title><body><h1>LockedScreen</h1><p>${message}</p><p>You can close this tab and return to LockedScreen.</p></body></html>`,
  { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Set-Cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` } }
);
const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) fail(415, "invalid_request", "A JSON request is required.");
  // Read a bounded stream even when Content-Length is missing or inaccurate.
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_request", "A request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.byteLength;
      if (length > 4096) { await reader.cancel(); fail(413, "invalid_request", "Request is too large."); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return fail(400, "invalid_request", "Invalid JSON request.");
  }
};
const requireConfig = (env: Env): void => {
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || env.GOOGLE_REDIRECT_URI !== CALLBACK ||
      !/^[A-Za-z0-9+/]{43}=$/.test(env.TOKEN_ENCRYPTION_KEY ?? "")) {
    fail(503, "service_not_ready", "The publisher Google connection service is not configured yet.");
  }
};
const rateLimit = async (env: Env, key: string, limit: number): Promise<void> => {
  const bucket = Math.floor(Date.now() / 60_000);
  const row = await env.DB.prepare(
    "INSERT INTO oauth_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count"
  ).bind(`${key}:${bucket}`, (bucket + 2) * 60_000).first<{ count: number }>();
  if (!row || row.count > limit) fail(429, "rate_limited", "Too many connection attempts. Wait a minute and try again.");
};
const googleError = (error: unknown): string => {
  const code = typeof error === "object" && error !== null && "error" in error ? String(error.error) : "";
  if (code === "invalid_client") return "The publisher Google client settings were rejected. Contact LockedScreen support.";
  if (code === "invalid_grant") return "Google authorization expired or was revoked. Connect your Google account again.";
  if (code === "access_denied") return "Google sign-in was cancelled or blocked by school policy. Ask your Google administrator to allow LockedScreen.";
  return "Google sign-in or token validation failed. Approve the required permissions and reconnect. If Google shows a school-policy or verification warning, contact your administrator or LockedScreen support.";
};
export const cleanup = async (env: Env): Promise<void> => {
  for (const table of ["oauth_flows", "oauth_sessions", "oauth_limits"]) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).bind(Date.now()).run();
  }
};

export const createOAuthWorker = (google: GoogleProvider = googleProvider) => ({
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.origin !== ORIGIN && url.pathname !== "/health") return json({ error: "not_found" }, 404);
      const publicResponse = publicPage(url.pathname, request.method);
      if (publicResponse) return publicResponse;
      if (request.headers.has("origin") && request.headers.get("origin") !== ORIGIN) fail(403, "invalid_origin", "Request origin is not allowed.");
      requireConfig(env);
      if (url.pathname === "/health" && request.method === "GET") {
        await env.DB.prepare("SELECT id FROM oauth_flows LIMIT 1").first();
        return json({ status: "ready", version: "0.6.61" });
      }
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const ipKey = await hash(`${env.TOKEN_ENCRYPTION_KEY}:${ip}`);
      await rateLimit(env, `request:${ipKey}`, 120);

      if (url.pathname === "/v1/google/sign-in" && request.method === "POST") {
        await rateLimit(env, `start:${ipKey}`, 10);
        const body = await readJson(request);
        if ((body.role !== "teacher" && body.role !== "student") || typeof body.codeChallenge !== "string" || !TOKEN.test(body.codeChallenge)) {
          fail(400, "invalid_request", "A role and S256 code challenge are required.");
        }
        const id = randomToken();
        await env.DB.prepare("INSERT INTO oauth_flows(id, challenge, role, status, encrypted_payload, expires_at) VALUES (?, ?, ?, 'created', ?, ?)")
          .bind(id, body.codeChallenge, body.role, await seal(env.TOKEN_ENCRYPTION_KEY, `flow:${id}`, {}), Date.now() + FLOW_TTL).run();
        return json({ flowId: id, authorizeUrl: `${ORIGIN}/oauth/google/start?flow=${id}`, pollIntervalSeconds: 5 });
      }

      if (url.pathname === "/oauth/google/start" && request.method === "GET") {
        const id = url.searchParams.get("flow") ?? "";
        if (!TOKEN.test(id)) fail(400, "invalid_flow", "Invalid Google sign-in request.");
        const auth = { verifier: randomToken(), nonce: randomToken() };
        const browser = randomToken();
        const row = await env.DB.prepare(
          "UPDATE oauth_flows SET status = 'started', browser_hash = ?, encrypted_payload = ? WHERE id = ? AND status = 'created' AND expires_at > ? RETURNING *"
        ).bind(await hash(browser), await seal(env.TOKEN_ENCRYPTION_KEY, `flow:${id}`, { auth }), id, Date.now()).first<Flow>();
        if (!row) fail(400, "expired_flow", "This sign-in link has expired or was already opened. Connect again from LockedScreen.");
        const location = await google.authorize(env, row.role, id, auth);
        return new Response(null, { status: 302, headers: {
          ...headers, Location: location,
          "Set-Cookie": `${COOKIE}=${browser}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`
        } });
      }

      if (url.pathname === "/oauth/google/callback" && request.method === "GET") {
        const id = url.searchParams.get("state") ?? "";
        const browser = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim())
          .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
        if (!TOKEN.test(id) || !TOKEN.test(browser)) fail(400, "invalid_state", "Google callback could not be matched to this browser. Connect again from LockedScreen.");
        // Atomically claim this callback before exchanging the one-use Google code.
        const flow = await env.DB.prepare(
          "UPDATE oauth_flows SET status = 'exchanging' WHERE id = ? AND browser_hash = ? AND status = 'started' AND expires_at > ? RETURNING *"
        ).bind(id, await hash(browser), Date.now()).first<Flow>();
        if (!flow) fail(400, "invalid_state", "This Google callback expired or has already been used.");
        try {
          const payload = await unseal<FlowPayload>(env.TOKEN_ENCRYPTION_KEY, `flow:${id}`, flow.encrypted_payload);
          if (!payload.auth) throw new Error();
          const tokens = await google.exchange(env, url, id, payload.auth, flow.role);
          if (!tokens.profile?.email || !tokens.accessToken) throw new Error();
          let sessionToken: string | undefined;
          if (flow.role === "teacher") {
            if (!tokens.refreshToken) throw new Error("Google did not provide offline access.");
            sessionToken = randomToken();
            const key = await hash(sessionToken);
            await env.DB.prepare("INSERT INTO oauth_sessions(token_hash, encrypted_payload, expires_at) VALUES (?, ?, ?)")
              .bind(key, await seal(env.TOKEN_ENCRYPTION_KEY, `session:${key}`, tokens), Date.now() + SESSION_TTL).run();
          }
          const result = { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, profile: tokens.profile, sessionToken };
          await env.DB.prepare("UPDATE oauth_flows SET status = 'ready', encrypted_payload = ?, expires_at = ? WHERE id = ?")
            .bind(await seal(env.TOKEN_ENCRYPTION_KEY, `flow:${id}`, { result }), Date.now() + 60_000, id).run();
          return page("Google connection approved. Return to the LockedScreen window that started this connection.");
        } catch (error) {
          await env.DB.prepare("UPDATE oauth_flows SET status = 'failed', encrypted_payload = ? WHERE id = ?")
            .bind(await seal(env.TOKEN_ENCRYPTION_KEY, `flow:${id}`, { error: googleError(error) }), id).run();
          return page("Google connection was not completed. Return to LockedScreen for details, or contact your school administrator if Google blocked access.", 400);
        }
      }

      if (url.pathname === "/v1/google/claim" && request.method === "POST") {
        const body = await readJson(request);
        const id = typeof body.flowId === "string" ? body.flowId : "";
        const verifier = typeof body.codeVerifier === "string" ? body.codeVerifier : "";
        if (!TOKEN.test(id) || !TOKEN.test(verifier)) fail(400, "invalid_request", "Invalid sign-in proof.");
        const challenge = await hash(verifier);
        const flow = await env.DB.prepare("SELECT * FROM oauth_flows WHERE id = ? AND challenge = ? AND expires_at > ?")
          .bind(id, challenge, Date.now()).first<Flow>();
        if (!flow) fail(400, "expired_flow", "Sign-in expired, was already completed, or belongs to another device. Connect again.");
        if (!["ready", "failed"].includes(flow.status)) return json({ status: "pending" }, 202);
        // DELETE RETURNING prevents two concurrent poll requests redeeming the same result.
        const claimed = await env.DB.prepare("DELETE FROM oauth_flows WHERE id = ? AND challenge = ? AND status IN ('ready', 'failed') RETURNING *")
          .bind(id, challenge).first<Flow>();
        if (!claimed) fail(400, "expired_flow", "Sign-in was already completed. Connect again.");
        const payload = await unseal<FlowPayload>(env.TOKEN_ENCRYPTION_KEY, `flow:${id}`, claimed.encrypted_payload);
        if (payload.error) fail(400, "google_authorization_failed", payload.error);
        return json(payload.result);
      }

      if (["/v1/google/access-token", "/v1/google/disconnect"].includes(url.pathname) && request.method === "POST") {
        const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        if (!TOKEN.test(bearer)) fail(401, "not_connected", "Google Classroom needs you to reconnect.");
        const key = await hash(bearer);
        await rateLimit(env, `session:${key}`, 30);
        const session = await env.DB.prepare("SELECT * FROM oauth_sessions WHERE token_hash = ? AND expires_at > ?")
          .bind(key, Date.now()).first<Session>();
        if (!session) fail(401, "not_connected", "This Google connection expired. Reconnect Google Classroom.");
        const tokens = await unseal<GoogleTokens>(env.TOKEN_ENCRYPTION_KEY, `session:${key}`, session.encrypted_payload);
        if (url.pathname.endsWith("disconnect")) {
          const body = await readJson(request);
          await env.DB.prepare("DELETE FROM oauth_sessions WHERE token_hash = ?").bind(key).run();
          if (body.revoke === true && tokens.refreshToken) await google.revoke(tokens.refreshToken);
          return json({ status: "disconnected" });
        }
        if (Date.parse(tokens.expiresAt) > Date.now() + 60_000) return json({ accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
        try {
          if (!tokens.refreshToken) throw new Error();
          const refreshed = await google.refresh(env, tokens.refreshToken);
          await env.DB.prepare("UPDATE oauth_sessions SET encrypted_payload = ? WHERE token_hash = ?")
            .bind(await seal(env.TOKEN_ENCRYPTION_KEY, `session:${key}`, { ...tokens, ...refreshed }), key).run();
          return json({ accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt });
        } catch (error) {
          fail(401, "google_reconnect_required", googleError(error));
        }
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const message = error instanceof HttpError ? error.message : "The Google connection service is unavailable. Contact LockedScreen support.";
      if (url.pathname.startsWith("/oauth/")) return page(message, status);
      return json({ error: error instanceof HttpError ? error.code : "service_unavailable", message }, status);
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> { await cleanup(env); }
});

export default createOAuthWorker();
